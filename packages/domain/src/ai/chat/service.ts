// ai.threads.* and ai.turns.* (BACKLOG 10.01; ask-agentic §3–10; internals §2.4): the transactional half of every
// procedure. Procedures that start or resume a turn return what to run; the AI service starts the runner after the
// transaction committed (the runner reads the committed rows).
import {
  type AiThread,
  type AiThreadDetail,
  type AiToolPart,
  type AiTurn,
  type AiTurnFeedbackInput,
  type AllowWebSearchInput,
  type ApproveAiToolInput,
  aiTurnFeedbackInputSchema,
  allowWebSearchInputSchema,
  approveAiToolInputSchema,
  type CreateAiThreadInput,
  createAiThreadInputSchema,
  type DenyAiToolInput,
  denyAiToolInputSchema,
  type ListAiThreadsInput,
  listAiThreadsInputSchema,
  parseAiTargetModelChoice,
  type RenameAiThreadInput,
  type RetryAiTurnInput,
  renameAiThreadInputSchema,
  retryAiTurnInputSchema,
  type SendAiTurnInput,
  type SendAiTurnOutput,
  sendAiTurnInputSchema,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { badRequest } from '../../errors.ts';
import { newId } from '../../ids.ts';
import type { ModelGateway } from '../../model-gateway/gateway.ts';
import type { Policies } from '../../permissions.ts';
import type { Tx } from '../../tx.ts';
import { creditOps } from '../credits/ledger.ts';
import { modelInfo, workspaceModelFor } from '../llm.ts';
import { memberSettingsOf, requireMember, writeMemberSettings } from '../settings.ts';
import { aiTool } from '../tools/catalog.ts';
import {
  emitThread,
  loadSteps,
  loadThread,
  loadTurn,
  type StepRow,
  type ThreadRow,
  threadCosts,
  threadView,
  turnStateConflict,
  turnView,
} from './model.ts';
import { userMessageContent } from './prompt.ts';

/** Executing turns idle for longer than this (and not running here) were interrupted by a restart. */
const STALE_MS = 10 * 60_000;

export interface ChatEffects {
  /** Assistant turns to start / resume after commit. */
  start: string[];
  /** Turns canceled by this call (abort their in-process run). */
  canceled: string[];
}

async function threadDetail(
  tx: Tx,
  thread: ThreadRow,
  isRunning: (turnId: string) => boolean,
): Promise<AiThreadDetail> {
  const turns = await tx.db
    .selectFrom('ai_turns')
    .selectAll()
    .where('thread_id', '=', thread.id)
    .orderBy('created_at')
    // A user turn and its answer share created_at (one transaction): the user turn first.
    .orderBy(sql`role = 'assistant'`)
    .orderBy('id')
    .execute();
  const steps = await loadSteps(
    tx,
    turns.map((t) => t.id),
  );
  const views = turns.map((t) => turnView(t, steps.get(t.id) ?? []));
  // Recovery: an executing turn nobody runs any more (process restart) fails as "interrupted".
  const cutoff = new Date(Date.parse(tx.now) - STALE_MS).toISOString();
  for (const [i, t] of turns.entries()) {
    const view = views[i] as AiTurn;
    if (t.status !== 'executing' || view.pendingApprovals.length > 0 || isRunning(t.id) || t.updated_at > cutoff) {
      continue;
    }
    await tx.db
      .updateTable('ai_turns')
      .set({ status: 'failed', failed_at: tx.now, failure_reason: 'interrupted', updated_at: tx.now })
      .where('id', '=', t.id)
      .execute();
    views[i] = { ...view, status: 'failed', failedAt: tx.now, failureReason: 'interrupted' };
  }
  const costs = await threadCosts(tx, [thread.id]);
  return { thread: threadView(thread, costs.get(thread.id) ?? 0), turns: views };
}

function toolPartsOf(steps: StepRow[]): { step: StepRow; index: number; part: AiToolPart }[] {
  return steps.flatMap((step) =>
    ((step.parts ?? []) as unknown as AiToolPart[]).flatMap((part, index) =>
      part.type === 'tool' ? [{ step, index, part }] : [],
    ),
  );
}

async function writePart(tx: Tx, step: StepRow, index: number, part: AiToolPart): Promise<void> {
  const parts = [...((step.parts ?? []) as unknown as AiToolPart[])];
  parts[index] = part;
  step.parts = parts as never;
  await tx.db
    .updateTable('ai_turn_steps')
    .set({ parts: jsonb(parts) })
    .where('id', '=', step.id)
    .execute();
}

/** Cancels an executing assistant turn and atomically fences any durable local-model dispatch. */
async function cancelTurnRows(tx: Tx, turnId: string, models: ModelGateway): Promise<boolean> {
  const turn = await tx.db.selectFrom('ai_turns').selectAll().where('id', '=', turnId).forUpdate().executeTakeFirst();
  if (!turn || turn.status !== 'executing') return false;
  await tx.db
    .updateTable('ai_turns')
    .set({ status: 'canceled', canceled_at: tx.now, updated_at: tx.now })
    .where('id', '=', turnId)
    .execute();
  const steps = await loadSteps(tx, [turnId]);
  for (const step of steps.get(turnId) ?? []) {
    const invocationId =
      step.usage && typeof step.usage === 'object' && 'invocationId' in step.usage
        ? (step.usage as { invocationId?: unknown }).invocationId
        : null;
    if (typeof invocationId === 'string') await models.cancelRunnerInvocationInTransaction(tx, invocationId);
    if (step.status !== 'executing-llm' && step.status !== 'executing-tools') continue;
    const parts = ((step.parts ?? []) as unknown as Record<string, unknown>[]).map((p) => ({
      ...p,
      ...(p.status === 'streaming' ? { status: 'canceled' } : {}),
      ...(p.type === 'tool' &&
      ['awaiting-approval', 'awaiting-execution', 'executing', null].includes(p.toolStatus as string)
        ? { toolStatus: 'canceled' }
        : {}),
    }));
    await tx.db
      .updateTable('ai_turn_steps')
      .set({ status: 'canceled', parts: jsonb(parts), completed_at: tx.now })
      .where('id', '=', step.id)
      .execute();
  }
  return true;
}

export const chatOps = {
  async listThreads(tx: Tx, input?: ListAiThreadsInput): Promise<{ threads: AiThread[] }> {
    const data = listAiThreadsInputSchema.parse(input) ?? {};
    const memberId = requireMember(tx);
    let q = tx.db
      .selectFrom('ai_threads')
      .selectAll()
      .where('created_by_member_id', '=', memberId)
      .where('deleted_at', 'is', null);
    const query = data.query?.trim();
    if (query) {
      const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) => eb.or([eb('title', 'ilike', like), eb('ai_title', 'ilike', like)]));
    }
    const rows = await q
      .orderBy(data.sort === 'created' ? 'created_at' : 'updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(data.limit ?? 100)
      .execute();
    const costs = await threadCosts(
      tx,
      rows.map((r) => r.id),
    );
    return { threads: rows.map((r) => threadView(r, costs.get(r.id) ?? 0)) };
  },

  async getThread(tx: Tx, threadId: string, isRunning: (turnId: string) => boolean): Promise<AiThreadDetail> {
    const memberId = requireMember(tx);
    return threadDetail(tx, await loadThread(tx, threadId, memberId), isRunning);
  },

  async createThread(tx: Tx, input: CreateAiThreadInput): Promise<AiThread> {
    const data = createAiThreadInputSchema.parse(input);
    const memberId = requireMember(tx);
    const id = data.threadId ?? newId();
    const existing = await tx.db.selectFrom('ai_threads').selectAll().where('id', '=', id).executeTakeFirst();
    if (existing) {
      if (existing.created_by_member_id !== memberId || existing.deleted_at) {
        throw badRequest('VALIDATION_ERROR', 'This thread id is already in use');
      }
      return threadView(existing);
    }
    const row = await tx.db
      .insertInto('ai_threads')
      .values({ id, workspace_id: tx.workspaceId, created_by_member_id: memberId })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitThread(tx, row);
    return threadView(row);
  },

  async renameThread(tx: Tx, input: RenameAiThreadInput): Promise<AiThread> {
    const data = renameAiThreadInputSchema.parse(input);
    const memberId = requireMember(tx);
    await loadThread(tx, data.threadId, memberId, { forUpdate: true });
    const row = await tx.db
      .updateTable('ai_threads')
      .set({ title: data.title?.trim() || null, updated_at: tx.now })
      .where('id', '=', data.threadId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitThread(tx, row);
    return threadView(row, (await threadCosts(tx, [row.id])).get(row.id) ?? 0);
  },

  async deleteThread(tx: Tx, threadId: string, models: ModelGateway): Promise<{ id: string; canceled: string[] }> {
    const memberId = requireMember(tx);
    const thread = await loadThread(tx, threadId, memberId, { forUpdate: true });
    const executing = await tx.db
      .selectFrom('ai_turns')
      .select('id')
      .where('thread_id', '=', thread.id)
      .where('status', '=', 'executing')
      .execute();
    const canceled: string[] = [];
    for (const t of executing) if (await cancelTurnRows(tx, t.id, models)) canceled.push(t.id);
    await tx.db.updateTable('ai_threads').set({ deleted_at: tx.now }).where('id', '=', thread.id).execute();
    await emitThread(tx, thread);
    return { id: thread.id, canceled };
  },

  /** ai.turns.send: the user turn and an executing assistant turn (started after commit). */
  async send(
    tx: Tx,
    policies: Policies,
    input: SendAiTurnInput,
    models: ModelGateway,
  ): Promise<SendAiTurnOutput & ChatEffects> {
    const data = sendAiTurnInputSchema.parse(input);
    const memberId = requireMember(tx);
    let thread = await tx.db
      .selectFrom('ai_threads')
      .selectAll()
      .where('id', '=', data.threadId)
      .forUpdate()
      .executeTakeFirst();
    if (thread && (thread.created_by_member_id !== memberId || thread.deleted_at)) {
      thread = await loadThread(tx, data.threadId, memberId); // 404
    }
    if (data.userTurnId) {
      const replay = await tx.db
        .selectFrom('ai_turns')
        .select(['id', 'thread_id'])
        .where('id', '=', data.userTurnId)
        .executeTakeFirst();
      if (replay) {
        const assistant = await tx.db
          .selectFrom('ai_turns')
          .select('id')
          .where('parent_turn_id', '=', replay.id)
          .orderBy('created_at')
          .executeTakeFirst();
        return {
          threadId: replay.thread_id,
          userTurnId: replay.id,
          turnId: assistant?.id ?? replay.id,
          start: [],
          canceled: [],
        };
      }
    }
    const target = parseAiTargetModelChoice(data.model);
    if (target) await models.assertTargetAvailable(tx, target);
    else await creditOps.assertAvailable(tx, { memberId, spend: 'ask' });
    if (!thread) {
      thread = await tx.db
        .insertInto('ai_threads')
        .values({ id: data.threadId, workspace_id: tx.workspaceId, created_by_member_id: memberId })
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    // Parent: the given assistant turn, or the thread's latest turn (root when empty).
    let parentId: string | null = null;
    if (data.parentTurnId) {
      const parent = await tx.db
        .selectFrom('ai_turns')
        .select(['id', 'thread_id', 'role'])
        .where('id', '=', data.parentTurnId)
        .executeTakeFirst();
      if (!parent || parent.thread_id !== thread.id || parent.role !== 'assistant') {
        throw badRequest('VALIDATION_ERROR', 'parentTurnId must be an assistant turn of this thread');
      }
      parentId = parent.id;
    } else {
      const latest = await tx.db
        .selectFrom('ai_turns')
        .select(['id', 'role'])
        .where('thread_id', '=', thread.id)
        .where('role', '=', 'assistant')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      parentId = latest?.id ?? null;
    }
    // Sending interrupts a running parent.
    const canceled: string[] = [];
    if (parentId && (await cancelTurnRows(tx, parentId, models))) canceled.push(parentId);

    const settings = await memberSettingsOf(tx, memberId);
    const annotations = data.annotations ?? [];
    const { blocks, preferredModel } = await userMessageContent(tx, policies, {
      memberId,
      content: data.content,
      annotations,
      context: data.context,
      timeZone: data.timeZone ?? 'UTC',
    });
    let model: string;
    let mode: 'auto' | 'manual';
    if (data.model && data.model !== 'auto') {
      if (!target && !modelInfo(data.model)) throw badRequest('VALIDATION_ERROR', `Unknown model "${data.model}"`);
      model = data.model;
      mode = 'manual';
    } else if (preferredModel && modelInfo(preferredModel)) {
      model = preferredModel;
      mode = 'manual';
    } else if (!data.model && settings.defaultModel && modelInfo(settings.defaultModel)) {
      model = settings.defaultModel;
      mode = 'manual';
    } else {
      model = await workspaceModelFor(tx, 'ask');
      mode = 'auto';
    }
    const userTurnId = data.userTurnId ?? newId();
    const turnId = data.turnId ?? newId();
    const ctx = data.context;
    const interests = [
      ...(ctx?.records ?? []).map((r) => ({
        type: 'interest' as const,
        interestType: 'entity-instance' as const,
        params: { entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId },
        prominence: 'high' as const,
      })),
      ...(ctx?.call
        ? [
            {
              type: 'interest' as const,
              interestType:
                ctx.call.startTime !== undefined
                  ? ('call-recording-transcript-selection' as const)
                  : ('call-recording' as const),
              params: { ...ctx.call },
              prominence: 'high' as const,
            },
          ]
        : []),
      ...(ctx?.meeting
        ? [
            {
              type: 'interest' as const,
              interestType: 'meeting' as const,
              params: { ...ctx.meeting },
              prominence: 'high' as const,
            },
          ]
        : []),
      ...(ctx?.listId
        ? [
            {
              type: 'interest' as const,
              interestType: 'list' as const,
              params: { listId: ctx.listId },
              prominence: 'low' as const,
            },
          ]
        : []),
    ];
    await tx.db
      .insertInto('ai_turns')
      .values([
        {
          id: userTurnId,
          workspace_id: tx.workspaceId,
          thread_id: thread.id,
          parent_turn_id: parentId,
          role: 'user',
          parts: jsonb([{ type: 'text', content: data.content, annotations }, ...interests]),
          llm_content: JSON.stringify(blocks),
          source: data.source ?? 'composer',
          time_zone: data.timeZone ?? null,
          status: 'completed',
          created_by_member_id: memberId,
          completed_at: tx.now,
        },
        {
          id: turnId,
          workspace_id: tx.workspaceId,
          thread_id: thread.id,
          parent_turn_id: userTurnId,
          role: 'assistant',
          time_zone: data.timeZone ?? null,
          status: 'executing',
          model,
          model_mode: mode,
          created_by_member_id: memberId,
        },
      ])
      .execute();
    await tx.db.updateTable('ai_threads').set({ updated_at: tx.now }).where('id', '=', thread.id).execute();
    await emitThread(tx, thread, { turnIds: [userTurnId, turnId, ...canceled] });
    return { threadId: thread.id, userTurnId, turnId, start: [turnId], canceled };
  },

  /** Try again: a sibling assistant turn under the same user turn (other model / refinement). */
  async retry(tx: Tx, input: RetryAiTurnInput, models: ModelGateway): Promise<{ turnId: string } & ChatEffects> {
    const data = retryAiTurnInputSchema.parse(input);
    const memberId = requireMember(tx);
    const { turn, thread } = await loadTurn(tx, data.turnId, memberId, { forUpdate: true });
    if (turn.role !== 'assistant') throw badRequest('VALIDATION_ERROR', 'Only assistant turns can be retried');
    if (turn.status === 'executing') throw turnStateConflict('This answer is still being generated');
    let model = turn.model ?? (await workspaceModelFor(tx, 'ask'));
    let mode = turn.model_mode ?? 'auto';
    if (data.model) {
      if (data.model === 'auto') {
        model = await workspaceModelFor(tx, 'ask');
        mode = 'auto';
      } else {
        if (!parseAiTargetModelChoice(data.model) && !modelInfo(data.model))
          throw badRequest('VALIDATION_ERROR', `Unknown model "${data.model}"`);
        model = data.model;
        mode = 'manual';
      }
    }
    const target = parseAiTargetModelChoice(model);
    if (target) await models.assertTargetAvailable(tx, target);
    else await creditOps.assertAvailable(tx, { memberId, spend: 'ask' });
    let refinement: Record<string, unknown> | null = null;
    if (data.refinement) {
      const steps = (await loadSteps(tx, [turn.id])).get(turn.id) ?? [];
      const previous = steps
        .flatMap((s) => (s.parts as unknown as { type: string; content?: string }[]) ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => p.content ?? '')
        .join('\n');
      refinement = { ...data.refinement, previousAnswer: previous.slice(0, 20_000) };
    }
    const id = data.newTurnId ?? newId();
    await tx.db
      .insertInto('ai_turns')
      .values({
        id,
        workspace_id: tx.workspaceId,
        thread_id: thread.id,
        parent_turn_id: turn.parent_turn_id,
        role: 'assistant',
        time_zone: turn.time_zone,
        status: 'executing',
        model,
        model_mode: mode,
        refinement: jsonb(refinement),
        created_by_member_id: memberId,
      })
      .execute();
    await tx.db.updateTable('ai_threads').set({ updated_at: tx.now }).where('id', '=', thread.id).execute();
    await emitThread(tx, thread, { turnIds: [id] });
    return { turnId: id, start: [id], canceled: [] };
  },

  async approve(tx: Tx, input: ApproveAiToolInput): Promise<{ turn: AiTurn } & ChatEffects> {
    const data = approveAiToolInputSchema.parse(input);
    const memberId = requireMember(tx);
    const { turn, thread } = await loadTurn(tx, data.turnId, memberId, { forUpdate: true });
    const steps = (await loadSteps(tx, [turn.id])).get(turn.id) ?? [];
    const found = toolPartsOf(steps).find((t) => t.part.toolCallId === data.toolCallId);
    if (turn.status !== 'executing' || !found || found.part.toolStatus !== 'awaiting-approval') {
      throw turnStateConflict('This action is no longer waiting for approval', { tool_call_id: data.toolCallId });
    }
    let amendment: unknown = null;
    if (data.input !== undefined) {
      const tool = aiTool(found.part.tool);
      const parsed = tool?.input.safeParse(data.input);
      if (!parsed?.success) {
        throw badRequest('VALIDATION_ERROR', 'The edited action is invalid', {
          issues: parsed?.error?.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) ?? [],
        });
      }
      amendment = parsed.data;
    }
    await writePart(tx, found.step, found.index, {
      ...found.part,
      inputAmendment: amendment,
      toolStatus: 'awaiting-execution',
    });
    const pending = toolPartsOf(steps).some((t) => t.part.toolStatus === 'awaiting-approval');
    await emitThread(tx, thread, { turnIds: [turn.id], list: false });
    return { turn: turnView(turn, steps), start: pending ? [] : [turn.id], canceled: [] };
  },

  async deny(tx: Tx, input: DenyAiToolInput): Promise<{ turn: AiTurn } & ChatEffects> {
    const data = denyAiToolInputSchema.parse(input);
    const memberId = requireMember(tx);
    const { turn, thread } = await loadTurn(tx, data.turnId, memberId, { forUpdate: true });
    const steps = (await loadSteps(tx, [turn.id])).get(turn.id) ?? [];
    const found = toolPartsOf(steps).find((t) => t.part.toolCallId === data.toolCallId);
    if (turn.status !== 'executing' || !found || found.part.toolStatus !== 'awaiting-approval') {
      throw turnStateConflict('This action is no longer waiting for approval', { tool_call_id: data.toolCallId });
    }
    await writePart(tx, found.step, found.index, { ...found.part, toolStatus: 'canceled', error: data.reason ?? null });
    const pending = toolPartsOf(steps).some((t) => t.part.toolStatus === 'awaiting-approval');
    await emitThread(tx, thread, { turnIds: [turn.id], list: false });
    return { turn: turnView(turn, steps), start: pending ? [] : [turn.id], canceled: [] };
  },

  /** Web search permission card: "Allow" (this thread) or "Always allow" (member setting); approves pending searches. */
  async allowWebSearch(tx: Tx, input: AllowWebSearchInput): Promise<{ thread: AiThread } & ChatEffects> {
    const data = allowWebSearchInputSchema.parse(input);
    const memberId = requireMember(tx);
    const thread = await loadThread(tx, data.threadId, memberId, { forUpdate: true });
    const updated = await tx.db
      .updateTable('ai_threads')
      .set({ web_search_allowed: true, updated_at: tx.now })
      .where('id', '=', thread.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (data.always) {
      await writeMemberSettings(tx, memberId, { allow_web_search: 'auto-approve' });
      tx.emit('ai-settings', null, { memberId });
    }
    const executing = await tx.db
      .selectFrom('ai_turns')
      .selectAll()
      .where('thread_id', '=', thread.id)
      .where('status', '=', 'executing')
      .forUpdate()
      .execute();
    const start: string[] = [];
    for (const turn of executing) {
      const steps = (await loadSteps(tx, [turn.id])).get(turn.id) ?? [];
      let touched = false;
      for (const t of toolPartsOf(steps)) {
        if (t.part.toolStatus === 'awaiting-approval' && aiTool(t.part.tool)?.kind === 'web') {
          await writePart(tx, t.step, t.index, { ...t.part, toolStatus: 'awaiting-execution' });
          touched = true;
        }
      }
      if (touched && !toolPartsOf(steps).some((t) => t.part.toolStatus === 'awaiting-approval')) start.push(turn.id);
    }
    await emitThread(tx, updated, { turnIds: executing.map((t) => t.id) });
    return { thread: threadView(updated), start, canceled: [] };
  },

  async cancel(tx: Tx, turnId: string, models: ModelGateway): Promise<{ canceled: string[]; start: string[] }> {
    const memberId = requireMember(tx);
    const { turn, thread } = await loadTurn(tx, turnId, memberId, { forUpdate: true });
    const canceled = (await cancelTurnRows(tx, turn.id, models)) ? [turn.id] : [];
    await emitThread(tx, thread, { turnIds: [turn.id], list: false });
    return { canceled, start: [] };
  },

  async feedback(tx: Tx, input: AiTurnFeedbackInput): Promise<AiTurn> {
    const data = aiTurnFeedbackInputSchema.parse(input);
    const memberId = requireMember(tx);
    const { turn, thread } = await loadTurn(tx, data.turnId, memberId, { forUpdate: true });
    if (turn.role !== 'assistant') throw badRequest('VALIDATION_ERROR', 'Feedback applies to answers');
    const updated = await tx.db
      .updateTable('ai_turns')
      .set({
        feedback: jsonb(
          data.feedback
            ? {
                type: data.feedback.type,
                issueType: data.feedback.issueType ?? null,
                reason: data.feedback.reason ?? null,
              }
            : null,
        ),
      })
      .where('id', '=', turn.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitThread(tx, thread, { turnIds: [turn.id], list: false });
    return turnView(updated, (await loadSteps(tx, [turn.id])).get(turn.id) ?? []);
  },
};
