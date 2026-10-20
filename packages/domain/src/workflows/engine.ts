// The run engine (BACKLOG 8.06, 8.08, 8.11; G runs.md, README §4.4–4.5; slice8-9-contracts: own graph interpreter on
// pg-boss).
//
// A run starts with its trigger execution (completed, outputs = the trigger payload) and the queued executions of the
// paths leaving it. `processRun` then executes one block per transaction, as the workflow actor: the block's writes,
// its execution record (evaluated inputs, outcome, outputs, cost), the credits ledger and the next queued executions
// commit together, so a retried or duplicated job never repeats a block. A block that throws rolls its transaction
// back; a second transaction records the failure (reason per runs.md §5), fails the run and notifies subscribers once
// a day per workflow and failure reason.
//
// Delays park their execution as `delayed` until `resume_at` and enqueue a delayed `workflow.run` job (the minute tick
// sweeps overdue ones). Loops run their body once per item in a child frame ("loop-iteration"); each iteration is one
// execution of the loop block (outcome `next`, outputs item / position / count), then one with outcome `done`.
// Safety: at most WORKFLOW_LIMITS.maxExecutionsPerRun executions per run; a workflow's own writes never retrigger it
// (the trigger fan-out skips the cause's workflow) and cascades between workflows stop at maxCascadeDepth.
import { createHash } from 'node:crypto';
import {
  type Actor,
  blockDefinition,
  type FailureReason,
  MANUAL_TRIGGER_SLUGS,
  type ManualTriggerInput,
  manualTriggerInputSchema,
  WORKFLOW_LIMITS,
} from '@agentic-crm/contracts';
import { type Database, jsonb, type Selectable, sql, type WorkflowRunsTable } from '@agentic-crm/db';
import { ZodError } from 'zod';
import { systemContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { newId } from '../ids.ts';
import { JOB_NAMES, type JobQueue } from '../jobs/queue.ts';
import { notify } from '../notifications/produce.ts';
import { loadDefinition } from '../schema/model.ts';
import { enterWorkspace, runAsOwner, runInWorkspace, type Tx } from '../tx.ts';
import { type DomainEvent, normalizeEvents } from '../webhooks/events.ts';
import { nextCronRun } from './cron.ts';
import { type BlockRow, type Graph, loadGraph, loadTypeEnv, outcomesOf, typing } from './graph.ts';
import { loadWorkflow, requireFlag, UNTITLED, type WorkflowRow, workflowNotFound } from './model.ts';
import { type ExecRow, Resolver, StepError } from './runtime.ts';
import { outputTypesOf, STEP_HANDLERS, type StepDeps, type StepResult } from './steps.ts';

export type RunRow = Selectable<WorkflowRunsTable>;

export interface EngineDeps extends StepDeps {
  database: Database;
  jobs: JobQueue;
  /** The workflow clock (delays, schedules); tests move it. */
  clock: () => Date;
}

const stateConflict = (message: string) => new DomainError(409, 'WORKFLOW_STATE_CONFLICT', message);

function workflowCtx(workspaceId: string, run: { id: string; workflow_id: string; cascade_depth: number }) {
  return {
    workspaceId,
    actor: { type: 'workflow' as const, id: run.workflow_id },
    workflowRun: { runId: run.id, workflowId: run.workflow_id, depth: run.cascade_depth },
  };
}

function emitRun(tx: Tx, run: { id: string; workflow_id: string }): void {
  tx.emit('workflow-run', run.id, { workflowId: run.workflow_id });
  tx.emit('workflow-run-list', run.workflow_id, { workflowId: run.workflow_id });
}

/** Runtime actor form of a change_log / context actor. */
export function actorValue(actor: Actor | null): { actorType: string; actorId: string | null } | null {
  return actor ? { actorType: actor.type, actorId: actor.id } : null;
}

async function enqueue(tx: Tx, deps: EngineDeps, runId: string, startAfterSeconds?: number): Promise<void> {
  await deps.jobs.send(
    tx,
    JOB_NAMES.workflowRun,
    { workspaceId: tx.workspaceId, runId },
    startAfterSeconds && startAfterSeconds > 0 ? { startAfterSeconds } : {},
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Executions

interface QueueArgs {
  run: { id: string; workflow_id: string };
  graph: Graph;
  parent: { id: string; block_id: string };
  outcome: string;
  frameId: string;
  attempt: number;
}

/** Queues the blocks the paths of (parent block, outcome) lead to; enforces the per-run execution cap. */
async function queueSuccessors(tx: Tx, a: QueueArgs): Promise<number> {
  const targets = a.graph.paths.filter(
    (p) => p.source_block_id === a.parent.block_id && p.source_outcome === a.outcome,
  );
  if (targets.length === 0) return 0;
  await reserveExecutions(tx, a.run.id, targets.length);
  for (const p of targets) {
    const block = a.graph.blocks.get(p.target_block_id);
    if (!block) continue;
    await tx.db
      .insertInto('workflow_block_executions')
      .values({
        id: newId(),
        workspace_id: tx.workspaceId,
        run_id: a.run.id,
        frame_id: a.frameId,
        block_id: block.id,
        slug: block.slug,
        parent_execution_id: a.parent.id,
        status: 'queued',
        outcome: null,
        inputs: null,
        outputs: null,
        output_types: null,
        state: null,
        cost: null,
        cost_is_final: null,
        failure_reason: null,
        error_message: null,
        resume_at: null,
        attempt: a.attempt,
        started_at: null,
        completed_at: null,
        failed_at: null,
      })
      .execute();
  }
  return targets.length;
}

async function reserveExecutions(tx: Tx, runId: string, n: number): Promise<void> {
  const row = await tx.db
    .updateTable('workflow_runs')
    .set((eb) => ({ execution_count: eb('execution_count', '+', n) }))
    .where('id', '=', runId)
    .returning('execution_count')
    .executeTakeFirstOrThrow();
  if (row.execution_count > WORKFLOW_LIMITS.maxExecutionsPerRun) {
    throw new StepError(
      'exceeded-max-executions',
      `Workflow runs are limited to ${WORKFLOW_LIMITS.maxExecutionsPerRun} block executions`,
    );
  }
}

async function insertFrame(
  tx: Tx,
  runId: string,
  f: {
    parentFrameId: string | null;
    type: 'root' | 'retry' | 'loop-iteration';
    attempt: number;
    loopExecutionId?: string;
    iteration?: number;
  },
): Promise<string> {
  const id = newId();
  await tx.db
    .insertInto('workflow_run_frames')
    .values({
      id,
      workspace_id: tx.workspaceId,
      run_id: runId,
      parent_frame_id: f.parentFrameId,
      type: f.type,
      attempt: f.attempt,
      loop_execution_id: f.loopExecutionId ?? null,
      iteration: f.iteration ?? null,
      completed_at: null,
    })
    .execute();
  return id;
}

/** A completed execution (trigger, loop iterations). */
async function insertCompleted(
  tx: Tx,
  e: {
    runId: string;
    frameId: string;
    block: BlockRow;
    parentExecutionId: string | null;
    outcome: string;
    outputs: Record<string, unknown> | null;
    outputTypes: Record<string, unknown> | null;
    state?: unknown;
    attempt: number;
  },
): Promise<string> {
  const id = newId();
  await tx.db
    .insertInto('workflow_block_executions')
    .values({
      id,
      workspace_id: tx.workspaceId,
      run_id: e.runId,
      frame_id: e.frameId,
      block_id: e.block.id,
      slug: e.block.slug,
      parent_execution_id: e.parentExecutionId,
      status: 'completed',
      outcome: e.outcome,
      inputs: null,
      outputs: jsonb(e.outputs),
      output_types: jsonb(e.outputTypes),
      state: jsonb(e.state ?? null),
      cost: null,
      cost_is_final: null,
      failure_reason: null,
      error_message: null,
      resume_at: null,
      attempt: e.attempt,
      started_at: tx.now,
      completed_at: tx.now,
      failed_at: null,
    })
    .execute();
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// Starting runs

export interface StartRunArgs {
  workflow: WorkflowRow;
  versionId: string;
  triggerBlockId: string;
  payload: Record<string, unknown>;
  createdBy: Actor | null;
  cascadeDepth: number;
  retriedFromRunId?: string | null;
}

/** Creates a run on an immutable version (trigger execution + first queued blocks) and enqueues its job. */
export async function startRun(tx: Tx, deps: EngineDeps, a: StartRunArgs): Promise<RunRow> {
  const graph = await loadGraph(tx, a.versionId);
  const trigger = graph.blocks.get(a.triggerBlockId);
  if (!trigger || trigger.block_type !== 'trigger') throw stateConflict('The trigger of this run no longer exists');
  const counter = await tx.db
    .updateTable('workflows')
    .set((eb) => ({ run_count: eb('run_count', '+', 1) }))
    .where('id', '=', a.workflow.id)
    .returning('run_count')
    .executeTakeFirstOrThrow();
  const runId = newId();
  const tooDeep = a.cascadeDepth > WORKFLOW_LIMITS.maxCascadeDepth;
  await tx.db
    .insertInto('workflow_runs')
    .values({
      id: runId,
      workspace_id: tx.workspaceId,
      workflow_id: a.workflow.id,
      version_id: a.versionId,
      sequence_number: counter.run_count,
      status: tooDeep ? 'failed' : 'queued',
      trigger_block_id: trigger.id,
      trigger_slug: trigger.slug,
      trigger_payload: jsonb({ outcome: 'done', data: a.payload }),
      cascade_depth: a.cascadeDepth,
      retried_from_run_id: a.retriedFromRunId ?? null,
      created_by: jsonb(a.createdBy),
      started_at: null,
      completed_at: null,
      failed_at: tooDeep ? tx.now : null,
      canceled_at: null,
      canceled_by: null,
      failure_reason: tooDeep ? 'cascade-depth-exceeded' : null,
      error_message: tooDeep
        ? `Workflows triggered each other more than ${WORKFLOW_LIMITS.maxCascadeDepth} times in a row`
        : null,
      execution_count: 1,
    })
    .execute();
  const frameId = await insertFrame(tx, runId, { parentFrameId: null, type: 'root', attempt: 1 });
  const t = typing(graph, await loadTypeEnv(tx));
  const triggerExecId = await insertCompleted(tx, {
    runId,
    frameId,
    block: trigger,
    parentExecutionId: null,
    outcome: 'done',
    outputs: a.payload,
    outputTypes: outputTypesOf(outcomesOf(t, trigger).find((o) => o.slug === 'done')),
    attempt: 1,
  });
  const run = { id: runId, workflow_id: a.workflow.id };
  if (tooDeep) {
    await tx.db.updateTable('workflow_run_frames').set({ status: 'failed' }).where('id', '=', frameId).execute();
    await tx.db.updateTable('workflows').set({ last_run_failed_at: tx.now }).where('id', '=', a.workflow.id).execute();
    await notifyFailure(tx, a.workflow, {
      runId,
      versionId: a.versionId,
      reason: 'cascade-depth-exceeded',
      message: 'Workflows triggered each other too many times',
    });
  } else {
    await queueSuccessors(tx, {
      run,
      graph,
      parent: { id: triggerExecId, block_id: trigger.id },
      outcome: 'done',
      frameId,
      attempt: 1,
    });
    await enqueue(tx, deps, runId);
  }
  emitRun(tx, run);
  tx.emit('workflow', a.workflow.id, { workflowId: a.workflow.id });
  return (await tx.db
    .selectFrom('workflow_runs')
    .selectAll()
    .where('id', '=', runId)
    .executeTakeFirstOrThrow()) as RunRow;
}

// ---------------------------------------------------------------------------------------------------------------
// Failure notifications (runs §6: once a day per workflow and unique failure reason)

async function notifyFailure(
  tx: Tx,
  workflow: WorkflowRow,
  f: { runId: string; versionId: string; reason: FailureReason; message: string | null },
): Promise<void> {
  const subscribers = await tx.db
    .selectFrom('workflow_notification_subscriptions')
    .select('member_id')
    .where('workflow_id', '=', workflow.id)
    .execute();
  if (subscribers.length === 0) return;
  const day = tx.now.slice(0, 10);
  const reasonKey = createHash('sha256')
    .update(`${f.reason}\n${(f.message ?? '').slice(0, 500)}`)
    .digest('hex')
    .slice(0, 16);
  const title = workflow.title?.trim() ? workflow.title : (workflow.ai_title ?? UNTITLED);
  await notify(
    tx,
    subscribers.map((s) => ({
      type: 'workflow-run-failed' as const,
      recipientMemberId: s.member_id,
      payload: {
        workflowId: workflow.id,
        workflowTitle: title,
        workflowVersionId: f.versionId,
        workflowRunId: f.runId,
        failureReason: f.reason,
        errorMessage: f.message,
      },
      actor: { type: 'workflow', id: workflow.id },
      dedupeKey: `workflow-run-failed:${workflow.id}:${reasonKey}:${day}`,
    })),
  );
}

function classify(err: unknown): { reason: FailureReason; message: string } {
  if (err instanceof StepError) return { reason: err.reason, message: err.message };
  if (err instanceof ZodError) return { reason: 'inputs-invalid', message: err.issues[0]?.message ?? 'Invalid input' };
  if (err instanceof DomainError) {
    if (err.statusCode === 403) {
      return {
        reason: 'execution-error',
        message: `This workflow does not have permission to do this: ${err.message}`,
      };
    }
    if (err.statusCode === 400 || err.statusCode === 422) return { reason: 'inputs-invalid', message: err.message };
    return { reason: 'execution-error', message: err.message };
  }
  const e = err as Error;
  return { reason: 'execution-error', message: `Error thrown: ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}` };
}

/** Records a failed block (or run) in its own transaction after the step's transaction rolled back. */
async function recordFailure(
  deps: EngineDeps,
  workspaceId: string,
  header: RunHeader,
  execId: string | null,
  failure: { reason: FailureReason; message: string },
  inputs: Record<string, unknown> | null,
): Promise<void> {
  await runInWorkspace(deps.database, workflowCtx(workspaceId, header), async (tx) => {
    const run = await tx.db
      .selectFrom('workflow_runs')
      .selectAll()
      .where('id', '=', header.id)
      .forUpdate()
      .executeTakeFirst();
    if (!run || (run.status !== 'queued' && run.status !== 'executing')) return;
    if (execId) {
      const exec = await tx.db
        .updateTable('workflow_block_executions')
        .set({
          status: 'failed',
          failure_reason: failure.reason,
          error_message: failure.message,
          inputs: jsonb(inputs),
          started_at: tx.now,
          failed_at: tx.now,
          cost: 0,
          cost_is_final: true,
        })
        .where('id', '=', execId)
        .returning('frame_id')
        .executeTakeFirst();
      if (exec) await markFrameChain(tx, exec.frame_id, 'failed');
    }
    await tx.db
      .updateTable('workflow_runs')
      .set({ status: 'failed', failed_at: tx.now, failure_reason: failure.reason, error_message: failure.message })
      .where('id', '=', run.id)
      .execute();
    await tx.db
      .updateTable('workflows')
      .set({ last_run_failed_at: tx.now })
      .where('id', '=', run.workflow_id)
      .execute();
    const workflow = await tx.db
      .selectFrom('workflows')
      .selectAll()
      .where('id', '=', run.workflow_id)
      .executeTakeFirst();
    if (workflow) {
      await notifyFailure(tx, workflow, { runId: run.id, versionId: run.version_id, ...failure });
    }
    emitRun(tx, run);
    tx.emit('workflow', run.workflow_id, { workflowId: run.workflow_id });
  });
}

/** Sets a frame and its ancestors to `status`. */
async function markFrameChain(tx: Tx, frameId: string, status: 'failed' | 'executing'): Promise<void> {
  let id: string | null = frameId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const frame: { parent_frame_id: string | null } | undefined = await tx.db
      .updateTable('workflow_run_frames')
      .set({ status, completed_at: null })
      .where('id', '=', id)
      .returning('parent_frame_id')
      .executeTakeFirst();
    id = frame?.parent_frame_id ?? null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Executing a run

interface RunHeader {
  id: string;
  workflow_id: string;
  version_id: string;
  cascade_depth: number;
}

type StepState =
  | { state: 'continue' }
  | { state: 'waiting'; until: string }
  | { state: 'finished'; status: string }
  | { state: 'failed' };

const PENDING = ['queued', 'executing', 'delayed'] as const;

/** Iteration frames whose subtree has nothing pending complete; the loop moves to its next item or to `done`. */
async function advanceLoops(tx: Tx, run: RunRow, graph: Graph): Promise<boolean> {
  const frames = await tx.db.selectFrom('workflow_run_frames').selectAll().where('run_id', '=', run.id).execute();
  const iterations = frames.filter((f) => f.type === 'loop-iteration' && f.status === 'executing');
  if (iterations.length === 0) return false;
  const pending = await tx.db
    .selectFrom('workflow_block_executions')
    .select(['frame_id', (eb) => eb.fn.countAll<string>().as('n')])
    .where('run_id', '=', run.id)
    .where('status', 'in', [...PENDING])
    .groupBy('frame_id')
    .execute();
  const pendingOf = new Map(pending.map((p) => [p.frame_id, Number(p.n)]));
  const children = new Map<string, string[]>();
  for (const f of frames) {
    if (f.parent_frame_id) children.set(f.parent_frame_id, [...(children.get(f.parent_frame_id) ?? []), f.id]);
  }
  const subtree = (id: string): number =>
    (pendingOf.get(id) ?? 0) + (children.get(id) ?? []).reduce((n, c) => n + subtree(c), 0);
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = frames.find((f) => f.id === id);
    while (cur?.parent_frame_id) {
      d++;
      const parent: string = cur.parent_frame_id;
      cur = frames.find((f) => f.id === parent);
    }
    return d;
  };
  const ready = iterations.filter((f) => subtree(f.id) === 0).sort((a, b) => depthOf(b.id) - depthOf(a.id));
  const frame = ready[0];
  if (!frame?.loop_execution_id) return false;
  await tx.db
    .updateTable('workflow_run_frames')
    .set({ status: 'completed', completed_at: tx.now })
    .where('id', '=', frame.id)
    .execute();
  const loopExec = await tx.db
    .selectFrom('workflow_block_executions')
    .selectAll()
    .where('id', '=', frame.loop_execution_id)
    .executeTakeFirstOrThrow();
  const state = loopExec.state as unknown as LoopState;
  // The items live on the loop's first execution only (iterations reference it).
  let items = state.items;
  if (!items && state.firstExecutionId) {
    const first = await tx.db
      .selectFrom('workflow_block_executions')
      .select('state')
      .where('id', '=', state.firstExecutionId)
      .executeTakeFirstOrThrow();
    items = (first.state as unknown as LoopState).items;
  }
  const all = items ?? [];
  const block = graph.blocks.get(loopExec.block_id) as BlockRow;
  const next = state.index + 1;
  await reserveExecutions(tx, run.id, 1);
  if (next < all.length) {
    await nextIteration(tx, run, graph, block, all, { ...state, items: undefined, index: next });
  } else {
    const doneId = await insertCompleted(tx, {
      runId: run.id,
      frameId: state.frameId,
      block,
      parentExecutionId: state.parentExecutionId,
      outcome: 'done',
      outputs: null,
      outputTypes: null,
      attempt: state.attempt,
    });
    await queueSuccessors(tx, {
      run,
      graph,
      parent: { id: doneId, block_id: block.id },
      outcome: 'done',
      frameId: state.frameId,
      attempt: state.attempt,
    });
  }
  return true;
}

interface LoopState {
  /** On the loop's first execution only. */
  items?: unknown[];
  firstExecutionId?: string;
  index: number;
  limit: number | null;
  frameId: string;
  parentExecutionId: string | null;
  attempt: number;
}

/** One loop iteration: an execution of the loop block (outcome `next`) and a frame for its body. */
async function nextIteration(
  tx: Tx,
  run: RunRow,
  graph: Graph,
  block: BlockRow,
  items: unknown[],
  state: LoopState,
  existingExecutionId?: string,
): Promise<void> {
  const outputs = {
    item: items[state.index] ?? null,
    position: state.index,
    count: state.index + 1,
    limit: state.limit ?? items.length,
    total_count: items.length,
  };
  const t = typing(graph, await loadTypeEnv(tx));
  const outputTypes = outputTypesOf(outcomesOf(t, block).find((o) => o.slug === 'next'));
  let execId = existingExecutionId;
  if (execId) {
    await tx.db
      .updateTable('workflow_block_executions')
      .set({
        status: 'completed',
        outcome: 'next',
        outputs: jsonb(outputs),
        output_types: jsonb(outputTypes),
        state: jsonb({ ...state, items, firstExecutionId: execId }),
        completed_at: tx.now,
      })
      .where('id', '=', execId)
      .execute();
  } else {
    execId = await insertCompleted(tx, {
      runId: run.id,
      frameId: state.frameId,
      block,
      parentExecutionId: state.parentExecutionId,
      outcome: 'next',
      outputs,
      outputTypes,
      state,
      attempt: state.attempt,
    });
  }
  const frameId = await insertFrame(tx, run.id, {
    parentFrameId: state.frameId,
    type: 'loop-iteration',
    attempt: state.attempt,
    loopExecutionId: execId,
    iteration: state.index,
  });
  await queueSuccessors(tx, {
    run,
    graph,
    parent: { id: execId, block_id: block.id },
    outcome: 'next',
    frameId,
    attempt: state.attempt,
  });
}

interface ProcessCache {
  graphs: Map<string, Graph>;
}

async function graphOf(tx: Tx, cache: ProcessCache, versionId: string): Promise<Graph> {
  let g = cache.graphs.get(versionId);
  if (!g) {
    g = await loadGraph(tx, versionId);
    cache.graphs.set(versionId, g);
  }
  return g;
}

/** Executes the next ready block of a run (one transaction). */
async function step(deps: EngineDeps, workspaceId: string, header: RunHeader, cache: ProcessCache): Promise<StepState> {
  const holder: { execId: string | null; inputs: Record<string, unknown> | null } = { execId: null, inputs: null };
  try {
    return await runInWorkspace(deps.database, workflowCtx(workspaceId, header), async (tx) => {
      holder.execId = null;
      holder.inputs = null;
      const run = (await tx.db
        .selectFrom('workflow_runs')
        .selectAll()
        .where('id', '=', header.id)
        .forUpdate()
        .executeTakeFirst()) as RunRow | undefined;
      if (!run || (run.status !== 'queued' && run.status !== 'executing')) {
        return { state: 'finished', status: run?.status ?? 'missing' } as StepState;
      }
      if (run.status === 'queued') {
        await tx.db
          .updateTable('workflow_runs')
          .set({ status: 'executing', started_at: run.started_at ?? tx.now })
          .where('id', '=', run.id)
          .execute();
        emitRun(tx, run);
      }
      const now = deps.clock().toISOString();
      const graph = await graphOf(tx, cache, run.version_id);
      const exec = await tx.db
        .selectFrom('workflow_block_executions')
        .selectAll()
        .where('run_id', '=', run.id)
        .where((eb) =>
          eb.or([eb('status', '=', 'queued'), eb.and([eb('status', '=', 'delayed'), eb('resume_at', '<=', now)])]),
        )
        .orderBy('seq')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (!exec) {
        if (await advanceLoops(tx, run, graph)) {
          emitRun(tx, run);
          return { state: 'continue' } as StepState;
        }
        const delayed = await tx.db
          .selectFrom('workflow_block_executions')
          .select((eb) => eb.fn.min('resume_at').as('until'))
          .where('run_id', '=', run.id)
          .where('status', '=', 'delayed')
          .executeTakeFirst();
        if (delayed?.until) return { state: 'waiting', until: delayed.until } as StepState;
        await tx.db
          .updateTable('workflow_runs')
          .set({ status: 'completed', completed_at: tx.now })
          .where('id', '=', run.id)
          .execute();
        await tx.db
          .updateTable('workflow_run_frames')
          .set({ status: 'completed', completed_at: tx.now })
          .where('run_id', '=', run.id)
          .where('status', '=', 'executing')
          .execute();
        emitRun(tx, run);
        return { state: 'finished', status: 'completed' } as StepState;
      }
      const frame = await tx.db
        .selectFrom('workflow_run_frames')
        .select(['attempt'])
        .where('id', '=', exec.frame_id)
        .executeTakeFirstOrThrow();
      const block = graph.blocks.get(exec.block_id);
      holder.execId = exec.id;
      if (exec.status === 'delayed') {
        await tx.db
          .updateTable('workflow_block_executions')
          .set({ status: 'completed', outcome: 'done', completed_at: tx.now })
          .where('id', '=', exec.id)
          .execute();
        if (block) {
          await queueSuccessors(tx, {
            run,
            graph,
            parent: exec,
            outcome: 'done',
            frameId: exec.frame_id,
            attempt: frame.attempt,
          });
        }
        emitRun(tx, run);
        return { state: 'continue' } as StepState;
      }
      if (!block) throw new StepError('execution-error', 'This block no longer exists in the version');
      const def = blockDefinition(block.slug);
      const handler = STEP_HANDLERS[block.slug];
      if (!def?.available || !handler) throw new StepError('block-not-available', 'This block is not available yet');
      const env = await loadTypeEnv(tx);
      // Variables resolve against the executions on the path that led here (the parent chain).
      const { rows: executions } = await sql<ExecRow>`
        WITH RECURSIVE chain AS (
          SELECT e.id, e.block_id, e.outcome, e.status, e.parent_execution_id, e.outputs, 1 AS depth
          FROM workflow_block_executions e WHERE e.id = ${exec.parent_execution_id}::uuid
          UNION ALL
          SELECT e.id, e.block_id, e.outcome, e.status, e.parent_execution_id, e.outputs, c.depth + 1
          FROM workflow_block_executions e JOIN chain c ON e.id = c.parent_execution_id
          WHERE c.depth < ${WORKFLOW_LIMITS.maxExecutionsPerRun + 10}
        )
        SELECT id, block_id, outcome, status, parent_execution_id, outputs FROM chain`.execute(tx.db);
      const workflow = await tx.db
        .selectFrom('workflows')
        .select(['title', 'ai_title', 'timezone'])
        .where('id', '=', run.workflow_id)
        .executeTakeFirst();
      const inputs: Record<string, unknown> = {};
      holder.inputs = inputs;
      const result: StepResult = await handler({
        tx,
        deps,
        env,
        config: block.config,
        resolver: new Resolver(
          tx,
          env,
          deps.policies,
          new Map(executions.map((e) => [e.id, e as ExecRow])),
          exec.parent_execution_id,
        ),
        inputs,
        workflowId: run.workflow_id,
        workflowTitle: workflow?.title?.trim() ? workflow.title : (workflow?.ai_title ?? UNTITLED),
        runId: run.id,
        executionId: exec.id,
        blockId: block.id,
        slug: block.slug,
        now: new Date(now),
        timeZone: workflow?.timezone ?? 'UTC',
      });
      const t = typing(graph, env);
      if (result.kind === 'delay' && Date.parse(result.until) > Date.parse(now)) {
        await tx.db
          .updateTable('workflow_block_executions')
          .set({ status: 'delayed', resume_at: result.until, inputs: jsonb(inputs), started_at: tx.now })
          .where('id', '=', exec.id)
          .execute();
        await enqueue(tx, deps, run.id, Math.ceil((Date.parse(result.until) - Date.parse(now)) / 1000));
        emitRun(tx, run);
        return { state: 'continue' } as StepState;
      }
      if (result.kind === 'loop') {
        const cap = Math.min(result.limit ?? result.items.length, WORKFLOW_LIMITS.maxLoopIterations);
        const items = result.items.slice(0, cap);
        await tx.db
          .updateTable('workflow_block_executions')
          .set({ inputs: jsonb(inputs), started_at: tx.now })
          .where('id', '=', exec.id)
          .execute();
        if (items.length === 0) {
          await tx.db
            .updateTable('workflow_block_executions')
            .set({ status: 'completed', outcome: 'done', completed_at: tx.now })
            .where('id', '=', exec.id)
            .execute();
          await queueSuccessors(tx, {
            run,
            graph,
            parent: exec,
            outcome: 'done',
            frameId: exec.frame_id,
            attempt: frame.attempt,
          });
        } else {
          await nextIteration(
            tx,
            run,
            graph,
            block,
            items,
            {
              index: 0,
              limit: result.limit,
              frameId: exec.frame_id,
              parentExecutionId: exec.parent_execution_id,
              attempt: frame.attempt,
            },
            exec.id,
          );
        }
        emitRun(tx, run);
        return { state: 'continue' } as StepState;
      }
      const outcome = result.kind === 'delay' ? 'done' : result.outcome;
      const outputs = result.kind === 'delay' ? null : (result.outputs ?? null);
      const cost =
        def.cost.type === 'fixed'
          ? def.cost.amount
          : def.cost.type === 'dynamic' && result.kind === 'outcome'
            ? Math.max(0, Math.ceil(result.cost ?? 0))
            : 0;
      await tx.db
        .updateTable('workflow_block_executions')
        .set({
          status: 'completed',
          outcome,
          inputs: jsonb(inputs),
          outputs: jsonb(outputs),
          output_types: jsonb(outcome ? outputTypesOf(outcomesOf(t, block).find((o) => o.slug === outcome)) : null),
          cost: def.cost.type === 'free' ? null : cost,
          cost_is_final: def.cost.type === 'free' ? null : true,
          started_at: tx.now,
          completed_at: tx.now,
        })
        .where('id', '=', exec.id)
        .execute();
      if (cost > 0) {
        await tx.db
          .insertInto('workflow_credit_usage')
          .values({
            id: newId(),
            workspace_id: tx.workspaceId,
            amount: cost,
            workflow_id: run.workflow_id,
            run_id: run.id,
            execution_id: exec.id,
          })
          .execute();
        await tx.db
          .updateTable('workflow_runs')
          .set({ credits_used: sql<string>`credits_used + ${cost}` })
          .where('id', '=', run.id)
          .execute();
      }
      if (outcome) {
        await queueSuccessors(tx, {
          run,
          graph,
          parent: exec,
          outcome,
          frameId: exec.frame_id,
          attempt: frame.attempt,
        });
      }
      emitRun(tx, run);
      return { state: 'continue' } as StepState;
    });
  } catch (err) {
    await recordFailure(deps, workspaceId, header, holder.execId, classify(err), holder.inputs);
    return { state: 'failed' };
  }
}

export interface ProcessResult {
  status: string;
  steps: number;
  waitingUntil: string | null;
}

/** Executes a run until it finishes, waits for a delay, or `maxSteps` blocks ran (the job re-enqueues itself). */
export async function processRun(
  deps: EngineDeps,
  workspaceId: string,
  runId: string,
  options: { maxSteps?: number; signal?: AbortSignal } = {},
): Promise<ProcessResult> {
  const header = await runInWorkspace(deps.database, systemContext(workspaceId, 'workflow-engine'), (tx) =>
    tx.db
      .selectFrom('workflow_runs')
      .select(['id', 'workflow_id', 'version_id', 'cascade_depth', 'status'])
      .where('id', '=', runId)
      .executeTakeFirst(),
  );
  if (!header) return { status: 'missing', steps: 0, waitingUntil: null };
  const cache: ProcessCache = { graphs: new Map() };
  const max = options.maxSteps ?? 2 * WORKFLOW_LIMITS.maxExecutionsPerRun;
  let steps = 0;
  for (;;) {
    if (options.signal?.aborted || steps >= max) {
      await runInWorkspace(deps.database, systemContext(workspaceId, 'workflow-engine'), (tx) =>
        enqueue(tx, deps, runId),
      );
      return { status: 'executing', steps, waitingUntil: null };
    }
    const r = await step(deps, workspaceId, header, cache);
    steps++;
    if (r.state === 'continue') continue;
    if (r.state === 'waiting') return { status: 'executing', steps, waitingUntil: r.until };
    if (r.state === 'failed') return { status: 'failed', steps, waitingUntil: null };
    return { status: r.status, steps, waitingUntil: null };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger fan-out (B.28)

interface TriggerRow {
  workflow_id: string;
  version_id: string;
  block_id: string;
  slug: string;
  entity_definition_id: string | null;
  attribute_id: string | null;
}

interface Match {
  trigger: TriggerRow;
  payload: Record<string, unknown>;
}

/** Matches one transaction's events against the live triggers (one run per record and trigger). */
export function matchEvents(
  raw: DomainEvent[],
  triggers: TriggerRow[],
  actor: Actor | null,
  at: string,
  cause: { workflowId: string } | null,
): Match[] {
  const normalized = normalizeEvents(raw);
  const who = actorValue(actor);
  const out: Match[] = [];
  const seen = new Set<string>();
  const push = (t: TriggerRow, key: string, payload: Record<string, unknown>) => {
    const k = `${t.workflow_id}:${t.block_id}:${key}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ trigger: t, payload });
  };
  const ref = (definition: unknown, instance: unknown) => ({
    entityDefinitionId: definition,
    entityInstanceId: instance,
  });
  for (const t of triggers) {
    // A workflow's own writes never start it again (README §4.5).
    if (cause?.workflowId === t.workflow_id) continue;
    if (actor?.type === 'workflow' && actor.id === t.workflow_id) continue;
    switch (t.slug) {
      case 'on-record-created':
        for (const e of normalized) {
          if (e.event_type === 'record.created' && e.id.object_id === t.entity_definition_id) {
            push(t, String(e.id.record_id), { entity_instance: ref(e.id.object_id, e.id.record_id), actor: who, at });
          }
        }
        break;
      case 'on-record-updated':
        for (const e of normalized) {
          if (
            e.event_type === 'record.updated' &&
            e.id.object_id === t.entity_definition_id &&
            (t.attribute_id === null || e.id.attribute_id === t.attribute_id)
          ) {
            push(t, String(e.id.record_id), { entity_instance: ref(e.id.object_id, e.id.record_id), actor: who, at });
          }
        }
        break;
      case 'on-attribute-invalidated':
        for (const e of raw) {
          const isRecord = e.event_type === 'record.updated';
          const isEntry = e.event_type === 'list-entry.updated';
          if (!isRecord && !isEntry) continue;
          const def = isRecord ? e.id.object_id : e.id.list_id;
          const inst = isRecord ? e.id.record_id : e.id.entry_id;
          if (def === t.entity_definition_id && e.id.attribute_id === t.attribute_id) {
            push(t, String(inst), { entity_instance: ref(def, inst), actor: who, at });
          }
        }
        break;
      case 'on-list-entry-created':
        for (const e of normalized) {
          if (e.event_type === 'list-entry.created' && e.id.list_id === t.entity_definition_id) {
            push(t, String(e.id.entry_id), { entity_instance: ref(e.id.list_id, e.id.entry_id), actor: who, at });
          }
        }
        break;
      case 'on-list-entry-updated':
        for (const e of normalized) {
          if (
            e.event_type === 'list-entry.updated' &&
            e.id.list_id === t.entity_definition_id &&
            (t.attribute_id === null || e.id.attribute_id === t.attribute_id)
          ) {
            push(t, String(e.id.entry_id), { entity_instance: ref(e.id.list_id, e.id.entry_id), actor: who, at });
          }
        }
        break;
      case 'on-task-created':
        for (const e of normalized) {
          if (e.event_type === 'task.created')
            push(t, String(e.id.task_id), { task: { taskId: e.id.task_id }, actor: who, at });
        }
        break;
      case 'on-note-created':
        for (const e of normalized) {
          if (e.event_type !== 'note.created') continue;
          if (t.entity_definition_id !== null && e.parent_object_id !== t.entity_definition_id) continue;
          push(t, String(e.id.note_id), { note: { noteId: e.id.note_id }, actor: who, at });
        }
        break;
      case 'on-call-recording-created':
        for (const e of normalized) {
          if (e.event_type !== 'call-recording.created') continue;
          push(t, String(e.id.call_recording_id), {
            call_recording: { meeting_id: e.id.meeting_id, call_recording_id: e.id.call_recording_id },
          });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

async function liveTriggers(tx: Tx): Promise<TriggerRow[]> {
  return tx.db
    .selectFrom('workflow_triggers as t')
    .innerJoin('workflows as w', 'w.id', 't.workflow_id')
    .select(['t.workflow_id', 't.version_id', 't.block_id', 't.slug', 't.entity_definition_id', 't.attribute_id'])
    .where('w.status', '=', 'live')
    .where('w.deleted_at', 'is', null)
    .whereRef('w.active_version_id', '=', 't.version_id')
    .execute();
}

/** Worker: committed 'workflow-events' rows → runs (cursor by transaction id, as the webhook fan-out). */
export async function fanOutTriggers(deps: EngineDeps): Promise<{ events: number; runs: number }> {
  return runAsOwner(deps.database, async (trx) => {
    const state = await trx
      .selectFrom('workflow_trigger_state')
      .select(['xid_cursor'])
      .where('id', '=', 1)
      .forUpdate()
      .executeTakeFirst();
    const { rows: snap } = await sql<{ upper: string }>`
      SELECT coalesce(
        (SELECT min(x) FROM pg_snapshot_xip(q.s) x
          WHERE NOT EXISTS (
            SELECT 1 FROM pg_stat_activity a
            WHERE a.backend_xid = x::xid AND a.datname IS DISTINCT FROM current_database())),
        pg_snapshot_xmax(q.s))::text AS upper
      FROM (SELECT pg_current_snapshot() AS s) q`.execute(trx);
    const upper = (snap[0] as { upper: string }).upper;
    if (!state) {
      await sql`INSERT INTO workflow_trigger_state (id, xid_cursor) VALUES (1, ${upper}::xid8) ON CONFLICT DO NOTHING`.execute(
        trx,
      );
      return { events: 0, runs: 0 };
    }
    const { rows } = await sql<{
      id: string;
      workspace_id: string;
      scope: { events?: DomainEvent[]; cause?: { runId: string; workflowId: string; depth: number } | null };
      actor: Actor | null;
      created_at: string;
    }>`
      SELECT c.id::text AS id, c.workspace_id::text AS workspace_id, c.scope, c.actor, c.created_at
      FROM change_log c
      WHERE c.xid >= ${state.xid_cursor}::xid8 AND c.xid < ${upper}::xid8 AND c.resource = 'workflow-events'
      ORDER BY c.id`.execute(trx);
    let events = 0;
    let runs = 0;
    const byWorkspace = new Map<string, typeof rows>();
    for (const r of rows) byWorkspace.set(r.workspace_id, [...(byWorkspace.get(r.workspace_id) ?? []), r]);
    for (const [workspaceId, wsRows] of byWorkspace) {
      const tx = await enterWorkspace(trx, systemContext(workspaceId, 'workflow-trigger'));
      const triggers = await liveTriggers(tx);
      const workflows = new Map<string, WorkflowRow>();
      for (const row of wsRows) {
        const list = row.scope.events ?? [];
        events += list.length;
        const cause = row.scope.cause ?? null;
        const at = new Date(row.created_at).toISOString();
        for (const m of matchEvents(list, triggers, row.actor, at, cause)) {
          let workflow = workflows.get(m.trigger.workflow_id);
          if (!workflow) {
            workflow = await tx.db
              .selectFrom('workflows')
              .selectAll()
              .where('id', '=', m.trigger.workflow_id)
              .executeTakeFirstOrThrow();
            workflows.set(workflow.id, workflow);
          }
          await startRun(tx, deps, {
            workflow,
            versionId: m.trigger.version_id,
            triggerBlockId: m.trigger.block_id,
            payload: m.payload,
            createdBy: null,
            cascadeDepth: (cause?.depth ?? 0) + 1,
          });
          runs++;
        }
      }
      await tx.flush();
      await sql`SELECT set_config('role', 'none', true)`.execute(trx);
    }
    await sql`UPDATE workflow_trigger_state SET xid_cursor = ${upper}::xid8, updated_at = now() WHERE id = 1`.execute(
      trx,
    );
    return { events, runs };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Minute tick: recurring schedules and overdue delays

export async function tick(
  deps: EngineDeps,
  options: { now?: Date } = {},
): Promise<{ scheduled: number; resumed: number }> {
  const now = (options.now ?? deps.clock()).toISOString();
  return runAsOwner(deps.database, async (trx) => {
    const due = await trx
      .selectFrom('workflow_schedules')
      .selectAll()
      .where('next_run_at', '<=', now)
      .orderBy('next_run_at')
      .limit(200)
      .forUpdate()
      .skipLocked()
      .execute();
    let scheduled = 0;
    for (const s of due) {
      const tx = await enterWorkspace(trx, systemContext(s.workspace_id, 'workflow-schedule'));
      const workflow = await tx.db
        .selectFrom('workflows')
        .selectAll()
        .where('id', '=', s.workflow_id)
        .executeTakeFirst();
      if (workflow?.status === 'live' && workflow.active_version_id === s.version_id && !workflow.deleted_at) {
        await startRun(tx, deps, {
          workflow,
          versionId: s.version_id,
          triggerBlockId: s.block_id,
          payload: { triggered_at: s.next_run_at },
          createdBy: null,
          cascadeDepth: 1,
        });
        scheduled++;
      }
      const next = nextCronRun(s.cron, s.timezone, now);
      if (next) {
        await tx.db
          .updateTable('workflow_schedules')
          .set({ next_run_at: next, last_run_at: s.next_run_at })
          .where('id', '=', s.id)
          .execute();
      } else await tx.db.deleteFrom('workflow_schedules').where('id', '=', s.id).execute();
      await tx.flush();
      await sql`SELECT set_config('role', 'none', true)`.execute(trx);
    }
    // Delayed continuations whose job went missing (more than a minute overdue) are kicked again.
    const { rows: overdue } = await sql<{ run_id: string; workspace_id: string }>`
      SELECT DISTINCT e.run_id, e.workspace_id FROM workflow_block_executions e
      JOIN workflow_runs r ON r.id = e.run_id
      WHERE e.status = 'delayed' AND e.resume_at <= ${now}::timestamptz - interval '1 minute'
        AND r.status IN ('queued', 'executing')
      LIMIT 200`.execute(trx);
    for (const r of overdue) {
      const tx = await enterWorkspace(trx, systemContext(r.workspace_id, 'workflow-schedule'));
      await enqueue(tx, deps, r.run_id);
      await sql`SELECT set_config('role', 'none', true)`.execute(trx);
    }
    return { scheduled, resumed: overdue.length };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Manual, record-action, list-entry-action and note-action triggers

export async function triggerManual(
  tx: Tx,
  deps: EngineDeps,
  input: ManualTriggerInput,
): Promise<{ runs: { runId: string; sequenceNumber: number; versionId: string }[] }> {
  const data = manualTriggerInputSchema.parse(input);
  const workflow = await loadWorkflow(tx, data.workflowId);
  await requireFlag(tx, workflow, 'read_workflow');
  if (workflow.status !== 'live' || !workflow.active_version_id) {
    throw stateConflict('Publish changes to manually trigger this workflow');
  }
  const graph = await loadGraph(tx, workflow.active_version_id);
  const triggers = [...graph.blocks.values()].filter(
    (b) => b.block_type === 'trigger' && MANUAL_TRIGGER_SLUGS.includes(b.slug),
  );
  const pick = (slug: string) => {
    const t = triggers.find((b) => b.slug === slug);
    if (!t) throw stateConflict('This workflow cannot be triggered this way');
    return t;
  };
  const actor = tx.ctx.actor;
  const base = { actor: actorValue(actor), at: tx.now };
  const runs: { runId: string; sequenceNumber: number; versionId: string }[] = [];
  const start = async (block: BlockRow, payload: Record<string, unknown>) => {
    const run = await startRun(tx, deps, {
      workflow,
      versionId: workflow.active_version_id as string,
      triggerBlockId: block.id,
      payload,
      createdBy: actor.type === 'system' ? null : actor,
      cascadeDepth: (tx.ctx.workflowRun?.depth ?? 0) + 1,
    });
    runs.push({ runId: run.id, sequenceNumber: run.sequence_number, versionId: run.version_id });
  };
  const records = async (refs: { entityDefinitionId: string; entityInstanceId: string }[], slug: string) => {
    const block = pick(slug);
    const expected = (() => {
      const e = block.config.entries.object ?? block.config.entries.list;
      return e?.type === 'agentic-crm-object' ? e.entityDefinitionId : e?.type === 'agentic-crm-list' ? e.listId : null;
    })();
    for (const ref of refs) {
      const def = await loadDefinition(tx, ref.entityDefinitionId);
      if (expected && def.id !== expected && def.apiSlug !== expected) {
        throw new DomainError(
          400,
          'VALIDATION_ERROR',
          `This workflow runs on records of another ${slug === 'on-list-entry-action' ? 'list' : 'object'}`,
        );
      }
      await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
      const live = await tx.db
        .selectFrom('entity_instances')
        .select('id')
        .where('id', '=', ref.entityInstanceId)
        .where('entity_definition_id', '=', def.id)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      if (!live) throw new DomainError(404, 'NOT_FOUND', 'The requested record could not be found');
      await start(block, {
        entity_instance: { entityDefinitionId: def.id, entityInstanceId: ref.entityInstanceId },
        ...base,
      });
    }
  };
  if (data.recordRefs?.length) await records(data.recordRefs, 'on-record-action');
  else if (data.entryRefs?.length) await records(data.entryRefs, 'on-list-entry-action');
  else if (data.noteIds?.length) {
    const block = pick('on-note-action');
    for (const noteId of data.noteIds) {
      const note = await tx.db
        .selectFrom('notes')
        .select('id')
        .where('id', '=', noteId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!note) throw new DomainError(404, 'NOT_FOUND', 'Note not found');
      await start(block, { note: { noteId }, ...base });
    }
  } else await start(pick('on-manual-run'), base);
  return { runs };
}

/** "Webhook received": a POST to the workflow's hook URL starts one run with the raw body. */
export async function triggerWebhook(
  tx: Tx,
  deps: EngineDeps,
  workflowId: string,
  body: string,
): Promise<{ runId: string } | null> {
  const workflow = await tx.db
    .selectFrom('workflows')
    .selectAll()
    .where('id', '=', workflowId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!workflow) throw workflowNotFound(workflowId);
  if (workflow.status !== 'live' || !workflow.active_version_id) return null;
  const graph = await loadGraph(tx, workflow.active_version_id);
  const block = [...graph.blocks.values()].find((b) => b.slug === 'on-inbound-webhook');
  if (!block) return null;
  const run = await startRun(tx, deps, {
    workflow,
    versionId: workflow.active_version_id,
    triggerBlockId: block.id,
    payload: { request_body: body, triggered_at: tx.now },
    createdBy: null,
    cascadeDepth: 1,
  });
  return { runId: run.id };
}
