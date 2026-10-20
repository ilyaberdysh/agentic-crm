// Ask Agentic threads and turns: row loading, contract views, access (threads are private to their creator) and the
// invalidations of a change.
import type { AiAssistantPart, AiStep, AiThread, AiTurn, AiUserPart } from '@agentic-crm/contracts';
import type { AiThreadsTable, AiTurnStepsTable, AiTurnsTable } from '@agentic-crm/db';
import { type Selectable, sql } from '@agentic-crm/db';
import { DomainError, notFound } from '../../errors.ts';
import type { Tx } from '../../tx.ts';
import { userIdsOf } from '../settings.ts';

export type ThreadRow = Selectable<AiThreadsTable>;
export type TurnRow = Selectable<AiTurnsTable>;
export type StepRow = Selectable<AiTurnStepsTable>;

export const turnStateConflict = (message: string, details: Record<string, unknown> = {}) =>
  new DomainError(409, 'AI_TURN_STATE_CONFLICT', message, details);

export const threadNotFound = (threadId: string) =>
  notFound('This chat may have been deleted or expired', { thread_id: threadId });

/** The thread if it exists and belongs to `memberId` (other members' chats are invisible: 404). */
export async function loadThread(
  tx: Tx,
  threadId: string,
  memberId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ThreadRow> {
  let q = tx.db.selectFrom('ai_threads').selectAll().where('id', '=', threadId).where('deleted_at', 'is', null);
  if (options.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row || row.created_by_member_id !== memberId) throw threadNotFound(threadId);
  return row;
}

export async function loadTurn(
  tx: Tx,
  turnId: string,
  memberId: string,
  options: { forUpdate?: boolean } = {},
): Promise<{ turn: TurnRow; thread: ThreadRow }> {
  let q = tx.db.selectFrom('ai_turns').selectAll().where('id', '=', turnId);
  if (options.forUpdate) q = q.forUpdate();
  const turn = await q.executeTakeFirst();
  if (!turn) throw notFound('Turn not found', { turn_id: turnId });
  const thread = await loadThread(tx, turn.thread_id, memberId);
  return { turn, thread };
}

export async function loadSteps(tx: Tx, turnIds: string[]): Promise<Map<string, StepRow[]>> {
  const out = new Map<string, StepRow[]>();
  if (turnIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('ai_turn_steps')
    .selectAll()
    .where('turn_id', 'in', turnIds)
    .orderBy('turn_id')
    .orderBy('position')
    .execute();
  for (const r of rows) out.set(r.turn_id, [...(out.get(r.turn_id) ?? []), r]);
  return out;
}

export function stepView(row: StepRow): AiStep {
  return {
    id: row.id,
    index: row.position,
    status: row.status,
    parts: (row.parts ?? []) as unknown as AiAssistantPart[],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function pendingApprovalsOf(steps: AiStep[]): string[] {
  return steps.flatMap((s) =>
    s.parts.flatMap((p) => (p.type === 'tool' && p.toolStatus === 'awaiting-approval' ? [p.toolCallId] : [])),
  );
}

function refinementView(raw: unknown): AiTurn['refinement'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { type: string; instruction?: string };
  if (r.type === 'custom') return { type: 'custom', instruction: r.instruction ?? '' };
  return r.type === 'add-detail' || r.type === 'make-concise' ? { type: r.type } : null;
}

export function turnView(row: TurnRow, steps: StepRow[] = []): AiTurn {
  const stepViews = steps.map(stepView);
  return {
    id: row.id,
    threadId: row.thread_id,
    parentTurnId: row.parent_turn_id,
    role: row.role,
    parts: (row.role === 'user' ? (row.parts ?? []) : []) as unknown as AiUserPart[],
    status: row.status,
    model: row.model,
    modelMode: row.model_mode,
    refinement: refinementView(row.refinement),
    steps: stepViews,
    pendingApprovals: row.status === 'executing' ? pendingApprovalsOf(stepViews) : [],
    creditCost: row.credit_cost,
    contextTokens: row.context_tokens,
    failureReason: row.failure_reason,
    feedback: (row.feedback ?? null) as AiTurn['feedback'],
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    canceledAt: row.canceled_at,
    failedAt: row.failed_at,
  };
}

export async function threadCosts(tx: Tx, threadIds: string[]): Promise<Map<string, number>> {
  if (threadIds.length === 0) return new Map();
  const { rows } = await sql<{ thread_id: string; cost: string }>`
    SELECT thread_id::text, coalesce(sum(credit_cost), 0)::text AS cost FROM ai_turns
    WHERE thread_id = ANY(${threadIds}::uuid[]) GROUP BY thread_id`.execute(tx.db);
  return new Map(rows.map((r) => [r.thread_id, Number(r.cost)]));
}

export function threadView(row: ThreadRow, creditCost = 0): AiThread {
  return {
    id: row.id,
    title: row.title,
    aiTitle: row.ai_title,
    createdByMemberId: row.created_by_member_id,
    webSearchAllowed: row.web_search_allowed,
    creditCost,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One turn with its steps, as clients see it. */
export async function loadTurnView(tx: Tx, turnId: string): Promise<AiTurn> {
  const turn = await tx.db.selectFrom('ai_turns').selectAll().where('id', '=', turnId).executeTakeFirstOrThrow();
  const steps = await loadSteps(tx, [turnId]);
  return turnView(turn, steps.get(turnId) ?? []);
}

/** Invalidations of a thread change: private to the thread's creator (I4a). */
export async function emitThread(
  tx: Tx,
  thread: { id: string; created_by_member_id: string },
  changes: { turnIds?: string[]; list?: boolean } = {},
): Promise<void> {
  const audience = { userIds: await userIdsOf(tx, [thread.created_by_member_id]) };
  tx.emit('ai-thread', thread.id, { threadId: thread.id }, audience);
  if (changes.list !== false) tx.emit('ai-thread-list', null, {}, audience);
  for (const turnId of changes.turnIds ?? []) {
    tx.emit('ai-turn', turnId, { threadId: thread.id, turnId }, audience);
  }
  if (changes.turnIds?.length) tx.emit('ai-turn-list', thread.id, { threadId: thread.id }, audience);
}
