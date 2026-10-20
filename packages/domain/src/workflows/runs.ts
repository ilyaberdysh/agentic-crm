// workflows.runs.* and workflows.usage (BACKLOG 8.06–8.07; G runs.md §2–4; README §2.6; B.14): the run list with the
// last-7-days overview, a run with its frames and block executions (the run viewer), retry from a failed block (a new
// attempt frame in the same run), rerun (a new attempt from the trigger) or "retry with live workflow" (a new linked
// run on the live version with the same trigger output), cancel, and the credits usage.
import {
  type BlockExecution,
  type FailureReason,
  type ListRunsInput,
  listRunsInputSchema,
  type RerunInput,
  type RetryRunInput,
  type RunDetail,
  type RunFrame,
  type RunIdInput,
  type RunStats,
  rerunInputSchema,
  retryRunInputSchema,
  runIdInputSchema,
  type UsageInput,
  usageInputSchema,
  type WfType,
  WORKFLOW_LIMITS,
  type WorkflowRun,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { badRequest, DomainError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { type EngineDeps, type RunRow, startRun } from './engine.ts';
import { loadGraph } from './graph.ts';
import { accessOf, loadWorkflow, requireFlag } from './model.ts';

const stateConflict = (message: string) => new DomainError(409, 'WORKFLOW_STATE_CONFLICT', message);
const MAX_ATTEMPTS = 25;

async function loadRun(tx: Tx, runId: string, options: { forUpdate?: boolean } = {}): Promise<RunRow> {
  const run = await tx.db
    .selectFrom('workflow_runs')
    .selectAll()
    .where('id', '=', runId)
    .$if(options.forUpdate === true, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!run) throw notFound('The requested run could not be found', { workflow_run_id: runId });
  return run as RunRow;
}

async function toRuns(tx: Tx, rows: RunRow[]): Promise<WorkflowRun[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const fromIds = rows.map((r) => r.retried_from_run_id).filter((id): id is string => id !== null);
  const [from, to] = await Promise.all([
    fromIds.length
      ? tx.db.selectFrom('workflow_runs').select(['id', 'sequence_number']).where('id', 'in', fromIds).execute()
      : [],
    tx.db
      .selectFrom('workflow_runs')
      .select(['id', 'sequence_number', 'retried_from_run_id', 'created_at'])
      .where('retried_from_run_id', 'in', ids)
      .orderBy('created_at')
      .execute(),
  ]);
  const seqOf = new Map(from.map((r) => [r.id, r.sequence_number]));
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    versionId: r.version_id,
    sequenceNumber: r.sequence_number,
    status: r.status,
    triggerBlockId: r.trigger_block_id,
    triggerSlug: r.trigger_slug,
    cascadeDepth: r.cascade_depth,
    createdBy: (r.created_by as WorkflowRun['createdBy']) ?? null,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    failedAt: r.failed_at,
    canceledAt: r.canceled_at,
    canceledBy: (r.canceled_by as WorkflowRun['canceledBy']) ?? null,
    failureReason: (r.failure_reason as FailureReason | null) ?? null,
    errorMessage: r.error_message,
    creditsUsed: Number(r.credits_used),
    executionCount: r.execution_count,
    attemptCount: r.attempt_count,
    retriedFrom: r.retried_from_run_id
      ? { runId: r.retried_from_run_id, sequenceNumber: seqOf.get(r.retried_from_run_id) ?? 0 }
      : null,
    retriedTo: to
      .filter((t) => t.retried_from_run_id === r.id)
      .map((t) => ({ runId: t.id, sequenceNumber: t.sequence_number, createdAt: t.created_at })),
  }));
}

async function readableRun(tx: Tx, runId: string, flag: 'read_workflow' | 'update_workflow', forUpdate = false) {
  const run = await loadRun(tx, runId, { forUpdate });
  const workflow = await loadWorkflow(tx, run.workflow_id).catch(() => {
    throw notFound('The requested run could not be found', { workflow_run_id: runId });
  });
  await requireFlag(tx, workflow, flag);
  return { run, workflow };
}

function emitRun(tx: Tx, run: { id: string; workflow_id: string }): void {
  tx.emit('workflow-run', run.id, { workflowId: run.workflow_id });
  tx.emit('workflow-run-list', run.workflow_id, { workflowId: run.workflow_id });
}

async function stats(tx: Tx, workflowId: string): Promise<RunStats> {
  const since = new Date(Date.parse(tx.now) - 7 * 86_400_000).toISOString();
  const row = await tx.db
    .selectFrom('workflow_runs')
    .select((eb) => [
      eb.fn.countAll<string>().as('runs'),
      sql<string>`count(*) FILTER (WHERE status = 'completed')`.as('completed'),
      sql<string>`count(*) FILTER (WHERE status = 'failed')`.as('failed'),
      sql<string>`count(*) FILTER (WHERE status IN ('queued', 'executing'))`.as('executing'),
      sql<string>`coalesce(sum(credits_used), 0)`.as('credits'),
      eb.fn.max('created_at').as('latest'),
    ])
    .where('workflow_id', '=', workflowId)
    .where('created_at', '>=', since)
    .executeTakeFirst();
  return {
    last7DaysRuns: Number(row?.runs ?? 0),
    last7DaysCompleted: Number(row?.completed ?? 0),
    last7DaysFailed: Number(row?.failed ?? 0),
    last7DaysExecuting: Number(row?.executing ?? 0),
    last7DaysCredits: Number(row?.credits ?? 0),
    latestRunAt: (row?.latest as string | null) ?? null,
  };
}

export function runOps(deps: EngineDeps) {
  return {
    async list(
      tx: Tx,
      input: ListRunsInput,
    ): Promise<{ runs: WorkflowRun[]; nextCursor: string | null; overview: RunStats }> {
      const data = listRunsInputSchema.parse(input);
      const workflow = await loadWorkflow(tx, data.workflowId);
      await requireFlag(tx, workflow, 'read_workflow');
      const before = data.cursor ? Number(data.cursor) : null;
      const rows = await tx.db
        .selectFrom('workflow_runs')
        .selectAll()
        .where('workflow_id', '=', workflow.id)
        .$if(before !== null && Number.isFinite(before), (q) => q.where('sequence_number', '<', before as number))
        .$if(data.statuses !== undefined && data.statuses.length > 0, (q) =>
          q.where('status', 'in', data.statuses as string[] as never),
        )
        .orderBy('sequence_number', 'desc')
        .limit(data.limit + 1)
        .execute();
      const page = rows.slice(0, data.limit) as RunRow[];
      return {
        runs: await toRuns(tx, page),
        nextCursor: rows.length > data.limit ? String(page[page.length - 1]?.sequence_number) : null,
        overview: await stats(tx, workflow.id),
      };
    },

    async get(tx: Tx, input: RunIdInput): Promise<RunDetail> {
      const data = runIdInputSchema.parse(input);
      const { run } = await readableRun(tx, data.runId, 'read_workflow');
      const [frames, executions] = await Promise.all([
        tx.db
          .selectFrom('workflow_run_frames')
          .selectAll()
          .where('run_id', '=', run.id)
          .orderBy('created_at')
          .orderBy('id')
          .execute(),
        tx.db.selectFrom('workflow_block_executions').selectAll().where('run_id', '=', run.id).orderBy('seq').execute(),
      ]);
      const blockOf = new Map(executions.map((e) => [e.id, e]));
      const taken = new Map<string, { sourceBlockId: string; outcome: string; targetBlockId: string }>();
      for (const e of executions) {
        const parent = e.parent_execution_id ? blockOf.get(e.parent_execution_id) : undefined;
        if (!parent?.outcome) continue;
        const key = `${parent.block_id}:${parent.outcome}:${e.block_id}`;
        taken.set(key, { sourceBlockId: parent.block_id, outcome: parent.outcome, targetBlockId: e.block_id });
      }
      const attemptOf = new Map(frames.map((f) => [f.id, f.attempt]));
      return {
        run: (await toRuns(tx, [run]))[0] as WorkflowRun,
        frames: frames.map(
          (f): RunFrame => ({
            id: f.id,
            parentFrameId: f.parent_frame_id,
            type: f.type,
            attempt: f.attempt,
            status: f.status,
            loopExecutionId: f.loop_execution_id,
            iteration: f.iteration,
            createdAt: f.created_at,
            completedAt: f.completed_at,
          }),
        ),
        executions: executions.map(
          (e): BlockExecution => ({
            id: e.id,
            runId: e.run_id,
            frameId: e.frame_id,
            blockId: e.block_id,
            slug: e.slug,
            parentExecutionId: e.parent_execution_id,
            status: e.status,
            outcome: e.outcome,
            inputs: e.inputs ?? null,
            outputs: (e.outputs as Record<string, unknown> | null) ?? null,
            outputTypes: (e.output_types as Record<string, WfType> | null) ?? null,
            cost: e.cost === null ? null : { amount: Number(e.cost), isFinal: e.cost_is_final ?? true },
            failureReason: (e.failure_reason as FailureReason | null) ?? null,
            errorMessage: e.error_message,
            resumeAt: e.resume_at,
            attempt: attemptOf.get(e.frame_id) ?? e.attempt,
            createdAt: e.created_at,
            startedAt: e.started_at,
            completedAt: e.completed_at,
            failedAt: e.failed_at,
          }),
        ),
        takenPaths: [...taken.values()],
      };
    },

    /** "Retry from failed" (or from any block of the run, e.g. the trigger = "Retry from start"). */
    async retry(tx: Tx, input: RetryRunInput): Promise<WorkflowRun> {
      const data = retryRunInputSchema.parse(input);
      const { run } = await readableRun(tx, data.runId, 'update_workflow', true);
      if (run.status !== 'failed' && run.status !== 'canceled')
        throw stateConflict('Unable to retry: the run has not failed');
      const exec = await tx.db
        .selectFrom('workflow_block_executions')
        .selectAll()
        .where('id', '=', data.fromBlockExecutionId)
        .where('run_id', '=', run.id)
        .executeTakeFirst();
      if (!exec)
        throw badRequest('VALIDATION_ERROR', 'Unknown block execution', {
          block_execution_id: data.fromBlockExecutionId,
        });
      if (exec.block_id === run.trigger_block_id) return restartFromTrigger(tx, deps, run);
      if (exec.status !== 'failed' && exec.status !== 'canceled') {
        throw stateConflict('Only a failed or canceled block can be retried');
      }
      return newAttempt(tx, deps, run, async (attempt) => {
        const frameId = newId();
        await tx.db
          .insertInto('workflow_run_frames')
          .values({
            id: frameId,
            workspace_id: tx.workspaceId,
            run_id: run.id,
            parent_frame_id: exec.frame_id,
            type: 'retry',
            attempt,
            loop_execution_id: null,
            iteration: null,
            completed_at: null,
          })
          .execute();
        // The failed block's frame and its ancestors run again.
        let id: string | null = exec.frame_id;
        while (id) {
          const f: { parent_frame_id: string | null } | undefined = await tx.db
            .updateTable('workflow_run_frames')
            .set({ status: 'executing', completed_at: null })
            .where('id', '=', id)
            .returning('parent_frame_id')
            .executeTakeFirst();
          id = f?.parent_frame_id ?? null;
        }
        await tx.db
          .updateTable('workflow_runs')
          .set((eb) => ({ execution_count: eb('execution_count', '+', 1) }))
          .where('id', '=', run.id)
          .execute();
        await tx.db
          .insertInto('workflow_block_executions')
          .values({
            id: newId(),
            workspace_id: tx.workspaceId,
            run_id: run.id,
            frame_id: frameId,
            block_id: exec.block_id,
            slug: exec.slug,
            parent_execution_id: exec.parent_execution_id,
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
            attempt,
            started_at: null,
            completed_at: null,
            failed_at: null,
          })
          .execute();
        // Canceled branches of the same run resume as well.
        await tx.db
          .updateTable('workflow_block_executions')
          .set({ status: 'queued' })
          .where('run_id', '=', run.id)
          .where('status', '=', 'canceled')
          .where('id', '!=', exec.id)
          .execute();
      });
    },

    /** Rerun: a new attempt from the trigger; `live` = a new run on the live version with the same trigger output. */
    async rerun(tx: Tx, input: RerunInput): Promise<WorkflowRun> {
      const data = rerunInputSchema.parse(input);
      const { run, workflow } = await readableRun(tx, data.runId, 'update_workflow', true);
      if (!data.live) {
        if (run.status === 'queued' || run.status === 'executing') throw stateConflict('This run is still running');
        return restartFromTrigger(tx, deps, run);
      }
      if (workflow.status !== 'live' || !workflow.active_version_id) {
        throw stateConflict('Publish changes to manually trigger this workflow');
      }
      const graph = await loadGraph(tx, workflow.active_version_id);
      const trigger = graph.blocks.get(run.trigger_block_id);
      if (!trigger || trigger.slug !== run.trigger_slug) {
        throw stateConflict('The live version of this workflow has no compatible trigger');
      }
      const payload = ((run.trigger_payload as { data?: Record<string, unknown> }).data ?? {}) as Record<
        string,
        unknown
      >;
      const created = await startRun(tx, deps, {
        workflow,
        versionId: workflow.active_version_id,
        triggerBlockId: trigger.id,
        payload,
        createdBy: tx.ctx.actor,
        cascadeDepth: 1,
        retriedFromRunId: run.id,
      });
      emitRun(tx, run);
      return (await toRuns(tx, [created]))[0] as WorkflowRun;
    },

    async cancel(tx: Tx, input: RunIdInput): Promise<WorkflowRun> {
      const data = runIdInputSchema.parse(input);
      const { run } = await readableRun(tx, data.runId, 'update_workflow', true);
      if (run.status !== 'queued' && run.status !== 'executing')
        throw stateConflict('Only a running run can be canceled');
      await tx.db
        .updateTable('workflow_block_executions')
        .set({ status: 'canceled' })
        .where('run_id', '=', run.id)
        .where('status', 'in', ['queued', 'executing', 'delayed'])
        .execute();
      await tx.db
        .updateTable('workflow_run_frames')
        .set({ status: 'canceled', completed_at: tx.now })
        .where('run_id', '=', run.id)
        .where('status', '=', 'executing')
        .execute();
      await tx.db
        .updateTable('workflow_runs')
        .set({ status: 'canceled', canceled_at: tx.now, canceled_by: jsonb(tx.ctx.actor) })
        .where('id', '=', run.id)
        .execute();
      emitRun(tx, run);
      return (await toRuns(tx, [await loadRun(tx, run.id)]))[0] as WorkflowRun;
    },

    /** Credits usage (Billing → Credits usage): per day and per workflow over a period (default: this month). */
    async usage(tx: Tx, input: UsageInput = {}) {
      const data = usageInputSchema.parse(input);
      const today = tx.now.slice(0, 10);
      const from = data.from ?? `${today.slice(0, 7)}-01`;
      const to = data.to ?? today;
      const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
      const rows = await tx.db
        .selectFrom('workflow_credit_usage')
        .select(['workflow_id', 'amount', 'created_at'])
        .where('created_at', '>=', `${from}T00:00:00Z`)
        .where('created_at', '<', end)
        .$if(data.workflowId !== undefined, (q) => q.where('workflow_id', '=', data.workflowId as string))
        .execute();
      const byDay = new Map<string, number>();
      const byWorkflow = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const amount = Number(r.amount);
        total += amount;
        const day = r.created_at.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + amount);
        byWorkflow.set(r.workflow_id, (byWorkflow.get(r.workflow_id) ?? 0) + amount);
      }
      const ids = [...byWorkflow.keys()];
      const titles = ids.length
        ? await tx.db.selectFrom('workflows').select(['id', 'title', 'ai_title']).where('id', 'in', ids).execute()
        : [];
      const access = await accessOf(tx, ids);
      return {
        period: { from, to },
        type: 'automation-credits-used' as const,
        totalCredits: total,
        allowance: WORKFLOW_LIMITS.monthlyCreditAllowance,
        byDay: [...byDay.entries()].sort().map(([date, credits]) => ({ date, credits })),
        byType: [{ type: 'workflow-block-execution' as const, label: 'Workflows', credits: total }],
        byWorkflow: [...byWorkflow.entries()]
          .map(([workflowId, credits]) => {
            const w = titles.find((t) => t.id === workflowId);
            const readable = access.get(workflowId)?.flags.read_workflow ?? false;
            return {
              workflowId,
              title: readable ? (w?.title?.trim() ? w.title : (w?.ai_title ?? 'Untitled Workflow')) : null,
              credits,
            };
          })
          .sort((a, b) => b.credits - a.credits),
      };
    },
  };
}

async function newAttempt(
  tx: Tx,
  deps: EngineDeps,
  run: RunRow,
  prepare: (attempt: number) => Promise<void>,
): Promise<WorkflowRun> {
  if (run.attempt_count >= MAX_ATTEMPTS) throw stateConflict('Retry limit reached');
  const attempt = run.attempt_count + 1;
  await prepare(attempt);
  await tx.db
    .updateTable('workflow_runs')
    .set({
      status: 'queued',
      attempt_count: attempt,
      failed_at: null,
      failure_reason: null,
      error_message: null,
      completed_at: null,
      canceled_at: null,
      canceled_by: null,
    })
    .where('id', '=', run.id)
    .execute();
  await deps.jobs.send(tx, 'workflow.run', { workspaceId: tx.workspaceId, runId: run.id });
  emitRun(tx, run);
  return (await toRuns(tx, [await loadRun(tx, run.id)]))[0] as WorkflowRun;
}

/** A new attempt frame that starts again from the trigger's output; pending work of earlier attempts is dropped. */
async function restartFromTrigger(tx: Tx, deps: EngineDeps, run: RunRow): Promise<WorkflowRun> {
  return newAttempt(tx, deps, run, async (attempt) => {
    await tx.db
      .updateTable('workflow_block_executions')
      .set({ status: 'canceled' })
      .where('run_id', '=', run.id)
      .where('status', 'in', ['queued', 'executing', 'delayed'])
      .execute();
    const root = await tx.db
      .selectFrom('workflow_run_frames')
      .select('id')
      .where('run_id', '=', run.id)
      .where('type', '=', 'root')
      .executeTakeFirstOrThrow();
    const frameId = newId();
    await tx.db
      .insertInto('workflow_run_frames')
      .values({
        id: frameId,
        workspace_id: tx.workspaceId,
        run_id: run.id,
        parent_frame_id: root.id,
        type: 'retry',
        attempt,
        loop_execution_id: null,
        iteration: null,
        completed_at: null,
      })
      .execute();
    const graph = await loadGraph(tx, run.version_id);
    const trigger = graph.blocks.get(run.trigger_block_id);
    if (!trigger) throw stateConflict('The trigger of this run no longer exists');
    const triggerExec = await tx.db
      .selectFrom('workflow_block_executions')
      .select(['outputs', 'output_types'])
      .where('run_id', '=', run.id)
      .where('block_id', '=', trigger.id)
      .orderBy('seq')
      .limit(1)
      .executeTakeFirst();
    const execId = newId();
    await tx.db
      .insertInto('workflow_block_executions')
      .values({
        id: execId,
        workspace_id: tx.workspaceId,
        run_id: run.id,
        frame_id: frameId,
        block_id: trigger.id,
        slug: trigger.slug,
        parent_execution_id: null,
        status: 'completed',
        outcome: 'done',
        inputs: null,
        outputs: jsonb(triggerExec?.outputs ?? null),
        output_types: jsonb(triggerExec?.output_types ?? null),
        state: null,
        cost: null,
        cost_is_final: null,
        failure_reason: null,
        error_message: null,
        resume_at: null,
        attempt,
        started_at: tx.now,
        completed_at: tx.now,
        failed_at: null,
      })
      .execute();
    const targets = graph.paths.filter((p) => p.source_block_id === trigger.id && p.source_outcome === 'done');
    await tx.db
      .updateTable('workflow_runs')
      .set((eb) => ({ execution_count: eb('execution_count', '+', 1 + targets.length) }))
      .where('id', '=', run.id)
      .execute();
    for (const p of targets) {
      const block = graph.blocks.get(p.target_block_id);
      if (!block) continue;
      await tx.db
        .insertInto('workflow_block_executions')
        .values({
          id: newId(),
          workspace_id: tx.workspaceId,
          run_id: run.id,
          frame_id: frameId,
          block_id: block.id,
          slug: block.slug,
          parent_execution_id: execId,
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
          attempt,
          started_at: null,
          completed_at: null,
          failed_at: null,
        })
        .execute();
    }
  });
}
