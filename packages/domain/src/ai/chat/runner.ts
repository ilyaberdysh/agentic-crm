// The Ask Agentic turn runner (ask-agentic §4–8, internals §2–4): one assistant turn = a loop of steps, each one
// streamed LLM call plus the tool calls it made. Read tools run at once as the asking member; write tools (and web
// search without permission) stop the loop with their tool parts in `awaiting-approval` — the turn stays `executing`
// and nothing is held in memory; approve / deny resume it from the database. Text and tool inputs stream as part
// snapshots through the hub (SSE + thread room); steps and the turn are persisted at step boundaries with `ai-turn`
// invalidations. Credits: checked before the first call, charged for each run segment (pause or end) on the turn.
//
// No database transaction is open during an LLM call; every write is its own short transaction (I1).

import { setTimeout as delay } from 'node:timers/promises';
import {
  type AiAssistantPart,
  type AiStreamEvent,
  type AiToolPart,
  type AiTurn,
  parseAiTargetModelChoice,
} from '@agentic-crm/contracts';
import { type Database, jsonb } from '@agentic-crm/db';
import Anthropic from '@anthropic-ai/sdk';
import { memberContext } from '../../context.ts';
import { DomainError } from '../../errors.ts';
import { newId } from '../../ids.ts';
import type { ModelGateway } from '../../model-gateway/gateway.ts';
import type { Policies } from '../../permissions.ts';
import { runInWorkspace, type Tx } from '../../tx.ts';
import { creditOps } from '../credits/ledger.ts';
import { InferenceError, type InferenceMessage, type InferenceUsage } from '../inference.ts';
import {
  addUsage,
  creditsFor,
  type LlmClient,
  type LlmContentBlockParam,
  type LlmMessageParam,
  type LlmResponse,
  type LlmToolResultBlockParam,
  type LlmUsage,
  requireKnownCost,
  ZERO_USAGE,
} from '../llm.ts';
import { memberSettingsOf } from '../settings.ts';
import { AI_TOOLS, aiTool } from '../tools/catalog.ts';
import { type ToolEnv, ToolError, toProviderTool } from '../tools/registry.ts';
import type { AiTurnHub } from './hub.ts';
import { emitThread, loadSteps, type StepRow, type ThreadRow, type TurnRow, turnView } from './model.ts';
import { historyMessages, stepMessages, systemBlocks, workspaceSystem } from './prompt.ts';

export const MAX_STEPS = 12;
const PART_FLUSH_MS = 40;

export interface RunnerDeps {
  database: Database;
  policies: Policies;
  llm: LlmClient;
  modelGateway: ModelGateway;
  hub: AiTurnHub;
  /** Turns executing in this process (cancel aborts them; tests await them). */
  running: Map<string, { abort: AbortController; done: Promise<void> }>;
}

/** Starts (or resumes) a turn in the background; a turn runs at most once at a time per process. */
export function startTurn(deps: RunnerDeps, workspaceId: string, memberId: string, turnId: string): Promise<void> {
  const existing = deps.running.get(turnId);
  if (existing) return existing.done;
  const abort = new AbortController();
  const done = executeTurn(deps, workspaceId, memberId, turnId, abort.signal)
    .catch((err) => {
      if (process.env.AI_RUNNER_LOG) console.error('[ai] turn failed', turnId, err);
    })
    .finally(() => {
      if (deps.running.get(turnId)?.abort === abort) deps.running.delete(turnId);
    });
  deps.running.set(turnId, { abort, done });
  return done;
}

/** Live state of the turn being run: the view clients see, with coalesced part events. */
class LiveTurn {
  turn: AiTurn;
  private readonly pending = new Map<string, { stepId: string; index: number; part: AiAssistantPart }>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly hub: AiTurnHub,
    private readonly workspaceId: string,
    turn: AiTurn,
  ) {
    this.turn = turn;
  }

  private emit(event: AiStreamEvent): void {
    this.hub.publish({ workspaceId: this.workspaceId, threadId: this.turn.threadId, turnId: this.turn.id, event });
  }

  /** Full snapshot (structural changes: step added / finished, tool status, turn status). */
  snapshot(turn?: AiTurn): void {
    if (turn) this.turn = turn;
    this.flush();
    this.emit({ type: 'turn', seq: this.hub.nextSeq(), turn: structuredClone(this.turn) });
  }

  part(stepId: string, index: number, part: AiAssistantPart): void {
    const step = this.turn.steps.find((s) => s.id === stepId);
    if (step) step.parts[index] = part;
    this.pending.set(`${stepId}:${index}`, { stepId, index, part });
    if (part.status !== 'streaming') {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => this.flush(), PART_FLUSH_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const { stepId, index, part } of this.pending.values()) {
      this.emit({
        type: 'part',
        seq: this.hub.nextSeq(),
        turnId: this.turn.id,
        stepId,
        partIndex: index,
        part: structuredClone(part),
      });
    }
    this.pending.clear();
  }

  done(status: 'completed' | 'canceled' | 'failed' | 'awaiting-approval'): void {
    this.flush();
    this.emit({ type: 'done', seq: this.hub.nextSeq(), turnId: this.turn.id, status });
  }
}

interface Loaded {
  thread: ThreadRow;
  turn: TurnRow;
  steps: StepRow[];
  /** Thread path before this turn (root user turn … this turn's user turn). */
  history: LlmMessageParam[];
  system: string;
  allowWebSearch: 'always-ask' | 'auto-approve' | 'disabled';
}

async function load(tx: Tx, deps: RunnerDeps, turnId: string, memberId: string): Promise<Loaded | null> {
  const turn = await tx.db.selectFrom('ai_turns').selectAll().where('id', '=', turnId).forUpdate().executeTakeFirst();
  if (!turn || turn.role !== 'assistant' || turn.status !== 'executing') return null;
  const thread = await tx.db
    .selectFrom('ai_threads')
    .selectAll()
    .where('id', '=', turn.thread_id)
    .executeTakeFirstOrThrow();
  // The path root → this turn's user turn.
  const all = await tx.db.selectFrom('ai_turns').selectAll().where('thread_id', '=', thread.id).execute();
  const byId = new Map(all.map((t) => [t.id, t]));
  const path: TurnRow[] = [];
  for (let t = byId.get(turn.parent_turn_id ?? ''); t; t = t.parent_turn_id ? byId.get(t.parent_turn_id) : undefined) {
    path.unshift(t);
    if (path.length > 500) break;
  }
  const stepsByTurn = await loadSteps(tx, [...path.map((t) => t.id), turn.id]);
  const history = historyMessages(path.map((t) => ({ turn: t, steps: stepsByTurn.get(t.id) ?? [] })));
  // Try again with a refinement: the previous answer and the instruction follow the user message.
  const refinement = turn.refinement as { type: string; instruction?: string; previousAnswer?: string } | null;
  if (refinement) {
    const how =
      refinement.type === 'custom'
        ? (refinement.instruction ?? '')
        : refinement.type === 'add-detail'
          ? 'Add more detail.'
          : 'Make it more concise.';
    history.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `<previous_answer>\n${refinement.previousAnswer ?? ''}\n</previous_answer>\nRewrite the answer. ${how}`,
        },
      ],
    });
  }
  const settings = await memberSettingsOf(tx, memberId);
  return {
    thread,
    turn,
    steps: stepsByTurn.get(turn.id) ?? [],
    history,
    system: await workspaceSystem(tx, deps.policies, memberId),
    allowWebSearch: settings.allowWebSearch,
  };
}

function toolsFor(allowWebSearch: Loaded['allowWebSearch']) {
  return AI_TOOLS.filter((t) => t.kind !== 'web' || allowWebSearch !== 'disabled').map(toProviderTool);
}

function needsApproval(kind: string, thread: ThreadRow, allowWebSearch: Loaded['allowWebSearch']): boolean {
  if (kind === 'write') return true;
  if (kind === 'web') return !(allowWebSearch === 'auto-approve' || thread.web_search_allowed);
  return false;
}

/** Runs one tool call as the asking member (its own transaction); errors become an error tool result. */
async function runTool(
  deps: RunnerDeps,
  workspaceId: string,
  memberId: string,
  timeZone: string,
  part: AiToolPart,
  usage: { total: LlmUsage },
): Promise<{ part: AiToolPart; result: LlmToolResultBlockParam }> {
  const tool = aiTool(part.tool);
  const input = part.inputAmendment ?? part.input;
  const fail = (message: string) => ({
    part: { ...part, toolStatus: 'failed' as const, error: message },
    result: {
      type: 'tool_result' as const,
      tool_use_id: part.toolCallId,
      is_error: true,
      content: JSON.stringify({ error: message }),
    },
  });
  if (!tool) return fail(`Unknown tool "${part.tool}"`);
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) {
    return fail(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  try {
    const result = await runInWorkspace(deps.database, memberContext(workspaceId, memberId), (tx) => {
      const env: ToolEnv = {
        tx,
        policies: deps.policies,
        llm: deps.llm,
        memberId,
        timeZone,
        addUsage: (u) => {
          usage.total = addUsage(usage.total, u);
        },
      };
      return tool.execute(env, parsed.data);
    });
    return {
      part: { ...part, toolStatus: 'completed', outputDigest: result.digest, error: null },
      result: { type: 'tool_result', tool_use_id: part.toolCallId, content: JSON.stringify(result.output) },
    };
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    if (err instanceof DomainError && err.statusCode < 500) {
      return fail(err.statusCode === 403 ? `Permission denied: ${err.message}` : err.message);
    }
    throw err;
  }
}

async function saveStep(
  tx: Tx,
  step: { id: string; status: StepRow['status']; parts: AiAssistantPart[] } & Partial<{
    llmContent: string;
    toolResults: LlmToolResultBlockParam[];
    usage: LlmUsage;
    completed: boolean;
  }>,
): Promise<void> {
  await tx.db
    .updateTable('ai_turn_steps')
    .set({
      status: step.status,
      parts: jsonb(step.parts),
      ...(step.llmContent !== undefined ? { llm_content: step.llmContent } : {}),
      ...(step.toolResults !== undefined ? { tool_results: JSON.stringify(step.toolResults) } : {}),
      ...(step.usage !== undefined ? { usage: jsonb(step.usage) } : {}),
      ...(step.completed ? { completed_at: tx.now } : {}),
    })
    .where('id', '=', step.id)
    .execute();
}

/** Charges the credits of this run segment (the turn's cost so far minus what was charged) and stores the cost. */
async function chargeTurn(tx: Tx, turn: TurnRow, segment: LlmUsage, memberId: string): Promise<number> {
  const current = await tx.db
    .selectFrom('ai_turns')
    .select(['micro_usd', 'credit_cost'])
    .where('id', '=', turn.id)
    .executeTakeFirstOrThrow();
  const micro = Number(current.micro_usd) + requireKnownCost(segment.microUsd);
  const credits = creditsFor(micro);
  const delta = credits - (current.credit_cost ?? 0);
  if (delta > 0) {
    await creditOps.charge(tx, {
      source: 'ask-turn',
      memberId,
      spend: 'ask',
      usage: segment,
      credits: delta,
      ref: { type: 'ai-turn', id: turn.id },
    });
  }
  await tx.db
    .updateTable('ai_turns')
    .set({ micro_usd: micro, credit_cost: credits, updated_at: tx.now })
    .where('id', '=', turn.id)
    .execute();
  return credits;
}

async function finishTurn(
  deps: RunnerDeps,
  live: LiveTurn,
  workspaceId: string,
  memberId: string,
  turnId: string,
  status: 'completed' | 'failed',
  extra: { failureReason?: string; contextTokens?: number | null; segment: LlmUsage },
): Promise<void> {
  const ctx = memberContext(workspaceId, memberId);
  const view = await runInWorkspace(deps.database, ctx, async (tx) => {
    const turn = await tx.db
      .selectFrom('ai_turns')
      .selectAll()
      .where('id', '=', turnId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const thread = await tx.db
      .selectFrom('ai_threads')
      .selectAll()
      .where('id', '=', turn.thread_id)
      .executeTakeFirstOrThrow();
    // Saved targets are paid directly by the provider/runner owner. Their nullable cost lives in model_invocations.
    if (!parseAiTargetModelChoice(turn.model)) await chargeTurn(tx, turn, extra.segment, memberId);
    if (turn.status === 'executing') {
      await tx.db
        .updateTable('ai_turns')
        .set({
          status,
          ...(status === 'completed' ? { completed_at: tx.now } : { failed_at: tx.now }),
          failure_reason: extra.failureReason ?? null,
          ...(extra.contextTokens !== undefined ? { context_tokens: extra.contextTokens } : {}),
          updated_at: tx.now,
        })
        .where('id', '=', turnId)
        .execute();
    }
    await tx.db.updateTable('ai_threads').set({ updated_at: tx.now }).where('id', '=', thread.id).execute();
    await emitThread(tx, thread, { turnIds: [turnId] });
    const steps = await loadSteps(tx, [turnId]);
    return turnView(
      await tx.db.selectFrom('ai_turns').selectAll().where('id', '=', turnId).executeTakeFirstOrThrow(),
      steps.get(turnId) ?? [],
    );
  });
  live.snapshot(view);
  live.done(view.status === 'executing' ? 'completed' : (view.status as 'completed' | 'failed' | 'canceled'));
}

/** Gives the thread an AI title after its first answer (fast model; charged with the turn). */
async function titleThread(deps: RunnerDeps, thread: ThreadRow, question: string, answer: string): Promise<LlmUsage> {
  if (thread.ai_title) return ZERO_USAGE;
  const res = await deps.llm.complete({
    purpose: 'ask-title',
    system:
      'Write a short title (at most 6 words, no quotes, no trailing period) for a CRM assistant conversation, in ' +
      'the language of the question.',
    messages: [{ role: 'user', content: `Question: ${question.slice(0, 2000)}\n\nAnswer: ${answer.slice(0, 2000)}` }],
    maxTokens: 2000,
  });
  const title = res.text
    .trim()
    .replace(/^["'“]|["'”.]$/g, '')
    .slice(0, 120);
  if (title) {
    await runInWorkspace(deps.database, memberContext(thread.workspace_id, thread.created_by_member_id), async (tx) => {
      const updated = await tx.db
        .updateTable('ai_threads')
        .set({ ai_title: title })
        .where('id', '=', thread.id)
        .where('ai_title', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (updated) await emitThread(tx, updated);
    });
  }
  return res.usage;
}

function userText(history: LlmMessageParam[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role !== 'user' || typeof m.content === 'string') continue;
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text);
    if (text.length) return text[text.length - 1] as string;
  }
  return '';
}

/** Text-only cross-provider history excludes signed reasoning and executable provider tool blocks. */
function targetHistory(history: LlmMessageParam[]): InferenceMessage[] {
  return history.flatMap((message) => {
    if (message.role === 'system') return [];
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .flatMap((block) => {
              if (block.type === 'text') return [block.text];
              if (block.type === 'tool_result' && typeof block.content === 'string')
                return [`Tool result from the preceding conversation: ${block.content}`];
              return [];
            })
            .join('\n');
    return content.trim() ? [{ role: message.role, content }] : [];
  });
}

/** Bounded first product consumer of the saved-target gateway: attached CRM context, text answers, no tools. */
async function executeTargetTurn(
  deps: RunnerDeps,
  loaded: Loaded,
  live: LiveTurn,
  target: { targetId: string; expectedVersion: number },
  signal: AbortSignal,
): Promise<void> {
  const { workspace_id: workspaceId, created_by_member_id: memberId, id: turnId } = loaded.turn;
  const ctx = memberContext(workspaceId, memberId);
  const stepId = newId();
  let invocationId: string | null = null;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  try {
    if (signal.aborted) return;
    await runInWorkspace(deps.database, ctx, async (tx) => {
      await tx.db
        .insertInto('ai_turn_steps')
        .values({
          id: stepId,
          workspace_id: workspaceId,
          turn_id: turnId,
          position: 0,
          status: 'executing-llm',
        })
        .execute();
    });
    live.turn.steps.push({
      id: stepId,
      index: 0,
      status: 'executing-llm',
      parts: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    live.snapshot();
    const result = await deps.modelGateway.invoke(
      ctx,
      {
        ...target,
        request: {
          purpose: 'ask',
          system:
            `You are Ask Agentic, a CRM assistant. Answer using the supplied conversation and CRM context. ` +
            `You have no tools in this mode. Explain when the supplied context is insufficient. ` +
            `Do not claim to search, change records, create tasks, or browse the web.\n\n${loaded.system}`,
          messages: targetHistory(loaded.history),
          maxTokens: 4096,
          signal: bounded,
        },
      },
      async (tx, reservedId) => {
        invocationId = reservedId;
        const turn = await tx.db
          .selectFrom('ai_turns')
          .select('status')
          .where('id', '=', turnId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (turn.status !== 'executing') throw new InferenceError('canceled', 'The Ask turn was canceled');
        await tx.db
          .updateTable('ai_turn_steps')
          .set({ usage: jsonb({ invocationId: reservedId }) })
          .where('id', '=', stepId)
          .execute();
      },
    );
    let text: string;
    let usage: InferenceUsage;
    if (result.kind === 'completed') {
      if (result.response.refused) throw new InferenceError('provider', 'The provider declined the request');
      text = result.response.text;
      usage = result.response.usage;
    } else {
      invocationId = result.invocationId;
      for (;;) {
        bounded.throwIfAborted();
        const state = await deps.modelGateway.getRunnerInvocation(ctx, invocationId);
        if (state.outcome === 'completed') {
          text = state.text ?? '';
          usage = state.usage;
          break;
        }
        if (state.outcome !== 'pending')
          throw new InferenceError('provider', 'The runner could not complete the answer');
        await delay(250, undefined, { signal: bounded });
      }
    }
    if (signal.aborted) return;
    const part: AiAssistantPart = { id: newId(), type: 'text', status: 'completed', content: text };
    const saved = await runInWorkspace(deps.database, ctx, async (tx) => {
      const turn = await tx.db
        .selectFrom('ai_turns')
        .select('status')
        .where('id', '=', turnId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (turn.status !== 'executing') return false;
      await tx.db
        .updateTable('ai_turn_steps')
        .set({
          status: 'completed',
          parts: jsonb([part]),
          llm_content: JSON.stringify([{ type: 'text', text }]),
          usage: jsonb({ ...usage, invocationId: result.invocationId }),
          completed_at: tx.now,
        })
        .where('id', '=', stepId)
        .execute();
      if (!loaded.thread.ai_title)
        await tx.db
          .updateTable('ai_threads')
          .set({ ai_title: userText(loaded.history).trim().slice(0, 120) || 'Untitled chat' })
          .where('id', '=', loaded.thread.id)
          .where('ai_title', 'is', null)
          .execute();
      return true;
    });
    if (!saved) return;
    live.part(stepId, 0, part);
    await finishTurn(deps, live, workspaceId, memberId, turnId, 'completed', {
      segment: ZERO_USAGE,
      contextTokens: usage.inputTokens,
    });
  } catch {
    if (invocationId) await deps.modelGateway.cancelRunnerInvocation(ctx, invocationId).catch(() => {});
    if (signal.aborted) return; // cancel() already persisted the canceled state.
    await runInWorkspace(deps.database, ctx, (tx) =>
      saveStep(tx, {
        id: stepId,
        status: 'failed',
        parts: [],
        completed: true,
      }),
    );
    await finishTurn(deps, live, workspaceId, memberId, turnId, 'failed', {
      failureReason: bounded.aborted && invocationId ? 'runner-unavailable' : 'provider-error',
      segment: ZERO_USAGE,
    });
  }
}

export async function executeTurn(
  deps: RunnerDeps,
  workspaceId: string,
  memberId: string,
  turnId: string,
  signal: AbortSignal,
): Promise<void> {
  const ctx = memberContext(workspaceId, memberId);
  const loaded = await runInWorkspace(deps.database, ctx, (tx) => load(tx, deps, turnId, memberId));
  if (!loaded) return;
  const { thread } = loaded;
  const timeZone = loaded.turn.time_zone ?? 'UTC';
  const live = new LiveTurn(deps.hub, workspaceId, turnView(loaded.turn, loaded.steps));
  const usage = { total: { ...ZERO_USAGE } };
  let contextTokens: number | null = null;

  const target = parseAiTargetModelChoice(loaded.turn.model);
  if (target) {
    await executeTargetTurn(deps, loaded, live, target, signal);
    return;
  }

  // Credits: a turn that cannot be paid fails before calling the model.
  try {
    await runInWorkspace(deps.database, ctx, (tx) => creditOps.assertAvailable(tx, { memberId, spend: 'ask' }));
  } catch (err) {
    if (err instanceof DomainError && err.code === 'CREDITS_EXHAUSTED') {
      await finishTurn(deps, live, workspaceId, memberId, turnId, 'failed', {
        failureReason: 'credits-exhausted',
        segment: ZERO_USAGE,
      });
      return;
    }
    throw err;
  }

  const steps = [...loaded.steps];
  const turnMessages: LlmMessageParam[] = stepMessages(steps);
  const userContent = loaded.history;

  try {
    // Resume: the last step paused for approvals; run the approved calls and record the denied ones.
    const last = steps[steps.length - 1];
    if (last && last.status === 'executing-tools') {
      const parts = [...((last.parts ?? []) as unknown as AiAssistantPart[])];
      const toolParts = parts.filter((p): p is AiToolPart => p.type === 'tool');
      if (toolParts.some((p) => p.toolStatus === 'awaiting-approval')) {
        live.done('awaiting-approval');
        return;
      }
      const results: LlmToolResultBlockParam[] = last.tool_results
        ? (JSON.parse(last.tool_results) as LlmToolResultBlockParam[])
        : [];
      const answered = new Set(results.map((r) => r.tool_use_id));
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i] as AiAssistantPart;
        if (p.type !== 'tool' || answered.has(p.toolCallId)) continue;
        if (p.toolStatus === 'awaiting-execution') {
          const running: AiToolPart = { ...p, toolStatus: 'executing' };
          live.part(last.id, i, running);
          const outcome = await runTool(deps, workspaceId, memberId, timeZone, running, usage);
          parts[i] = outcome.part;
          live.part(last.id, i, outcome.part);
          results.push(outcome.result);
        } else {
          results.push({
            type: 'tool_result',
            tool_use_id: p.toolCallId,
            content: JSON.stringify({ error: 'The user declined this action.' }),
          });
        }
      }
      const allDenied = toolParts.every((p) => p.toolStatus === 'canceled');
      await runInWorkspace(deps.database, ctx, (tx) =>
        saveStep(tx, { id: last.id, status: 'completed', parts, toolResults: results, completed: true }),
      );
      last.status = 'completed';
      last.tool_results = JSON.stringify(results);
      last.parts = parts as never;
      turnMessages.length = 0;
      turnMessages.push(...stepMessages(steps));
      if (allDenied) {
        // Everything was declined: the turn ends without another model call (observed for web search).
        await finishTurn(deps, live, workspaceId, memberId, turnId, 'completed', { segment: usage.total });
        return;
      }
    }

    const tools = toolsFor(loaded.allowWebSearch);
    for (let position = steps.length; position < MAX_STEPS; position++) {
      if (signal.aborted) return;
      const stepId = newId();
      await runInWorkspace(deps.database, ctx, async (tx) => {
        await tx.db
          .insertInto('ai_turn_steps')
          .values({ id: stepId, workspace_id: workspaceId, turn_id: turnId, position, status: 'executing-llm' })
          .execute();
      });
      const step = {
        id: stepId,
        index: position,
        status: 'executing-llm' as const,
        parts: [] as AiAssistantPart[],
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      live.turn.steps.push(step);
      live.snapshot();

      // Block index → part index (thinking → reasoning, text → text, tool_use → tool).
      const partOf = new Map<number, number>();
      const now = () => new Date().toISOString();
      let response: LlmResponse;
      try {
        response = await deps.llm.stream(
          {
            purpose: 'ask',
            model: loaded.turn.model ?? undefined,
            system: systemBlocks(loaded.system),
            messages: [...userContent, ...turnMessages],
            tools,
            signal,
          },
          {
            onBlockStart(index, block) {
              let part: AiAssistantPart | null = null;
              const id = newId();
              if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                part = { id, type: 'reasoning', status: 'streaming', startedAt: now(), completedAt: null };
              } else if (block.type === 'text') {
                part = { id, type: 'text', status: 'streaming', content: '' };
              } else if (block.type === 'tool_use' && block.id && block.name) {
                const tool = aiTool(block.name);
                part = {
                  id,
                  type: 'tool',
                  status: 'streaming',
                  toolCallId: block.id,
                  tool: block.name,
                  input: null,
                  inputRaw: '',
                  inputAmendment: null,
                  toolStatus: null,
                  requiresApproval: tool ? needsApproval(tool.kind, thread, loaded.allowWebSearch) : false,
                  outputDigest: null,
                  error: null,
                };
              }
              if (!part) return;
              partOf.set(index, step.parts.length);
              step.parts.push(part);
              live.part(stepId, step.parts.length - 1, part);
            },
            onTextDelta(index, _delta, snapshot) {
              const i = partOf.get(index);
              const part = i === undefined ? undefined : step.parts[i];
              if (i === undefined || part?.type !== 'text') return;
              const next = { ...part, content: snapshot };
              step.parts[i] = next;
              live.part(stepId, i, next);
            },
            onToolInputDelta(index, _delta, snapshot) {
              const i = partOf.get(index);
              const part = i === undefined ? undefined : step.parts[i];
              if (i === undefined || part?.type !== 'tool') return;
              const next = { ...part, inputRaw: snapshot };
              step.parts[i] = next;
              live.part(stepId, i, next);
            },
            onBlockStop(index) {
              const i = partOf.get(index);
              const part = i === undefined ? undefined : step.parts[i];
              if (i === undefined || !part) return;
              const next: AiAssistantPart =
                part.type === 'reasoning'
                  ? { ...part, status: 'completed', completedAt: now() }
                  : { ...part, status: 'completed' };
              step.parts[i] = next;
              live.part(stepId, i, next);
            },
          },
        );
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError || signal.aborted) return; // canceled: cancel() wrote the state
        const message =
          err instanceof DomainError ? err.message : 'Something went wrong while generating this response';
        const parts = step.parts.map((p) => (p.status === 'streaming' ? { ...p, status: 'failed' as const } : p));
        await runInWorkspace(deps.database, ctx, (tx) =>
          saveStep(tx, { id: stepId, status: 'failed', parts, completed: true }),
        );
        step.parts = parts;
        await finishTurn(deps, live, workspaceId, memberId, turnId, 'failed', {
          failureReason: err instanceof DomainError && err.code === 'AI_PROVIDER_ERROR' ? 'provider-error' : 'error',
          segment: usage.total,
        });
        if (process.env.AI_RUNNER_LOG) console.error('[ai] step failed', message);
        return;
      }
      usage.total = addUsage(usage.total, response.usage);
      contextTokens = response.usage.inputTokens + response.usage.cacheReadTokens + response.usage.cacheWriteTokens;

      // Parts from the final message (the stream may skip blocks a fake or a fallback did not stream).
      const parts: AiAssistantPart[] = [];
      for (const [index, block] of response.message.content.entries()) {
        const i = partOf.get(index);
        const streamed = i === undefined ? undefined : step.parts[i];
        if (block.type === 'text') {
          parts.push({ id: streamed?.id ?? newId(), type: 'text', status: 'completed', content: block.text });
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          parts.push(
            streamed?.type === 'reasoning'
              ? { ...streamed, status: 'completed', completedAt: streamed.completedAt ?? now() }
              : { id: newId(), type: 'reasoning', status: 'completed', startedAt: now(), completedAt: now() },
          );
        } else if (block.type === 'tool_use') {
          const tool = aiTool(block.name);
          parts.push({
            id: streamed?.id ?? newId(),
            type: 'tool',
            status: 'completed',
            toolCallId: block.id,
            tool: block.name,
            input: block.input ?? null,
            inputRaw: JSON.stringify(block.input ?? {}),
            inputAmendment: null,
            toolStatus: null,
            requiresApproval: tool ? needsApproval(tool.kind, thread, loaded.allowWebSearch) : false,
            outputDigest: null,
            error: null,
          });
        }
      }
      step.parts = parts;
      const llmContent = JSON.stringify(response.message.content);

      if (response.refused) {
        await runInWorkspace(deps.database, ctx, (tx) =>
          saveStep(tx, { id: stepId, status: 'failed', parts, llmContent, usage: response.usage, completed: true }),
        );
        await finishTurn(deps, live, workspaceId, memberId, turnId, 'failed', {
          failureReason: 'provider-refused-request',
          segment: usage.total,
          contextTokens,
        });
        return;
      }

      const toolIndexes = parts.flatMap((p, i) => (p.type === 'tool' ? [i] : []));
      if (toolIndexes.length === 0) {
        await runInWorkspace(deps.database, ctx, (tx) =>
          saveStep(tx, { id: stepId, status: 'completed', parts, llmContent, usage: response.usage, completed: true }),
        );
        const answer = parts.flatMap((p) => (p.type === 'text' ? [p.content] : [])).join('\n');
        try {
          usage.total = addUsage(usage.total, await titleThread(deps, thread, userText(userContent), answer));
        } catch {
          // A missing title never fails the answer.
        }
        await finishTurn(deps, live, workspaceId, memberId, turnId, 'completed', {
          segment: usage.total,
          contextTokens,
        });
        return;
      }

      // Tool calls: run reads now, park writes (and unpermitted web searches) for approval.
      const results: LlmToolResultBlockParam[] = [];
      const truncated = response.stopReason === 'max_tokens';
      let awaiting = false;
      for (const i of toolIndexes) {
        const part = parts[i] as AiToolPart;
        const tool = aiTool(part.tool);
        const parsed = tool?.input.safeParse(part.input);
        if (truncated || !tool || !parsed?.success) {
          const error = truncated
            ? 'The tool input was cut off; call the tool again with a shorter input.'
            : !tool
              ? `Unknown tool "${part.tool}"`
              : `Invalid input: ${parsed?.error?.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`;
          parts[i] = { ...part, toolStatus: 'failed', error };
          results.push({
            type: 'tool_result',
            tool_use_id: part.toolCallId,
            is_error: true,
            content: JSON.stringify({ INVALID_JSON: part.inputRaw, error }),
          });
          live.part(stepId, i, parts[i] as AiAssistantPart);
          continue;
        }
        if (part.requiresApproval) {
          parts[i] = { ...part, toolStatus: 'awaiting-approval' };
          awaiting = true;
          live.part(stepId, i, parts[i] as AiAssistantPart);
          continue;
        }
        const running: AiToolPart = { ...part, toolStatus: 'executing' };
        live.part(stepId, i, running);
        const outcome = await runTool(deps, workspaceId, memberId, timeZone, running, usage);
        parts[i] = outcome.part;
        live.part(stepId, i, outcome.part);
        results.push(outcome.result);
      }

      if (awaiting) {
        const view = await runInWorkspace(deps.database, ctx, async (tx) => {
          await saveStep(tx, {
            id: stepId,
            status: 'executing-tools',
            parts,
            llmContent,
            toolResults: results,
            usage: response.usage,
          });
          const turn = await tx.db
            .selectFrom('ai_turns')
            .selectAll()
            .where('id', '=', turnId)
            .executeTakeFirstOrThrow();
          await chargeTurn(tx, turn, usage.total, memberId);
          await tx.db.updateTable('ai_turns').set({ context_tokens: contextTokens }).where('id', '=', turnId).execute();
          await emitThread(tx, thread, { turnIds: [turnId], list: false });
          const steps2 = await loadSteps(tx, [turnId]);
          return turnView(
            await tx.db.selectFrom('ai_turns').selectAll().where('id', '=', turnId).executeTakeFirstOrThrow(),
            steps2.get(turnId) ?? [],
          );
        });
        live.snapshot(view);
        live.done('awaiting-approval');
        return;
      }

      await runInWorkspace(deps.database, ctx, async (tx) => {
        await saveStep(tx, {
          id: stepId,
          status: 'completed',
          parts,
          llmContent,
          toolResults: results,
          usage: response.usage,
          completed: true,
        });
        await emitThread(tx, thread, { turnIds: [turnId], list: false });
      });
      turnMessages.push(
        { role: 'assistant', content: response.message.content as unknown as LlmContentBlockParam[] },
        { role: 'user', content: results },
      );
      steps.push({ id: stepId, position } as StepRow);
    }

    // Step budget used up: end the turn with what was said so far.
    await finishTurn(deps, live, workspaceId, memberId, turnId, 'completed', { segment: usage.total, contextTokens });
  } catch (err) {
    if (signal.aborted) return;
    await finishTurn(deps, live, workspaceId, memberId, turnId, 'failed', {
      failureReason: 'error',
      segment: usage.total,
    }).catch(() => {});
    throw err;
  }
}
