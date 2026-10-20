// Run viewer model: the canvas overlay of one attempt (latest execution per block over the attempts up to
// it, the outcome each block took, the paths taken), the failed execution to retry from, runtime labels. Pure.
import type { ExecutionStatus } from '@agentic-crm/contracts';
import type { BlockExecution, RunDetail } from '../types';

export interface AttemptOverlay {
  statusByBlock: Map<string, ExecutionStatus>;
  outcomeByBlock: Map<string, string>;
  taken: Set<string>;
  latestByBlock: Map<string, BlockExecution>;
}

export function attemptsOf(detail: Pick<RunDetail, 'frames'>): number[] {
  return [...new Set(detail.frames.filter((f) => f.type !== 'loop-iteration').map((f) => f.attempt))].sort(
    (a, b) => a - b,
  );
}

export function overlayFor(detail: Pick<RunDetail, 'executions'>, attempt: number): AttemptOverlay {
  const executions = detail.executions.filter((e) => e.attempt <= attempt);
  const latestByBlock = new Map<string, BlockExecution>();
  for (const e of executions) {
    const prev = latestByBlock.get(e.blockId);
    if (!prev || e.attempt > prev.attempt || (e.attempt === prev.attempt && e.createdAt >= prev.createdAt))
      latestByBlock.set(e.blockId, e);
  }
  const byId = new Map(executions.map((e) => [e.id, e]));
  const taken = new Set<string>();
  for (const e of executions) {
    const parent = e.parentExecutionId ? byId.get(e.parentExecutionId) : undefined;
    if (parent?.outcome) taken.add(`${parent.blockId}:${parent.outcome}:${e.blockId}`);
  }
  const statusByBlock = new Map<string, ExecutionStatus>();
  const outcomeByBlock = new Map<string, string>();
  for (const [blockId, e] of latestByBlock) {
    statusByBlock.set(blockId, e.status);
    if (e.outcome) outcomeByBlock.set(blockId, e.outcome);
  }
  return { statusByBlock, outcomeByBlock, taken, latestByBlock };
}

/** The failed execution "Retry from failed" restarts (latest attempt). */
export function failedExecution(detail: Pick<RunDetail, 'executions'>): BlockExecution | null {
  const failed = detail.executions.filter((e) => e.status === 'failed');
  return failed.sort((a, b) => b.attempt - a.attempt || (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

/** The trigger execution ("Retry from start"). */
export function triggerExecution(detail: Pick<RunDetail, 'executions' | 'run'>): BlockExecution | null {
  return detail.executions.find((e) => e.blockId === detail.run.triggerBlockId && e.attempt === 1) ?? null;
}

export function runtimeLabel(e: Pick<BlockExecution, 'startedAt' | 'completedAt' | 'failedAt' | 'createdAt'>): string {
  const start = Date.parse(e.startedAt ?? e.createdAt);
  const end = Date.parse(e.completedAt ?? e.failedAt ?? '');
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';
  const ms = Math.max(0, end - start);
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function statusLabel(status: ExecutionStatus, trigger: boolean): string {
  switch (status) {
    case 'completed':
      return trigger ? 'Triggered' : 'Completed';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    case 'delayed':
      return 'Delayed';
    case 'queued':
      return 'Queued';
    default:
      return 'Running';
  }
}
