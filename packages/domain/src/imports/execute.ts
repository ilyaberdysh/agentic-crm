// Worker side of an import (the `import.run` job). Resumable and idempotent: each batch is one transaction that
// writes the records, their history and change_log (I1) together with the assertion statuses and the progress, so a
// retry after a crash continues with the rows still `planned`. Cancel takes the job row lock between batches.
// Writes are recorded as the import actor {type: 'import', id: jobId}.
import type { Database } from '@agentic-crm/db';
import { sql } from '@agentic-crm/db';
import type { ServiceContext } from '../context.ts';
import { engineFor } from '../records/engine.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { RUNNABLE_STATUSES, requireJob, touchJob } from './model.ts';
import { Resolver } from './resolve.ts';
import { executeRow } from './run.ts';
import { loadImport, storePlan } from './service.ts';

export const IMPORT_BATCH_ROWS = 100;

export interface ExecuteImportOptions {
  batchSize?: number;
  /** Stop between batches (worker shutdown); the job is retried and resumes. */
  signal?: AbortSignal;
  /** Tests: process at most this many batches, then return (status stays 'executing'). */
  maxBatches?: number;
}

export interface ExecuteImportResult {
  status: string;
  batches: number;
  processedRows: number;
}

export class ImportInterruptedError extends Error {
  constructor() {
    super('Import interrupted (worker shutting down); it resumes on retry');
    this.name = 'ImportInterruptedError';
  }
}

export function importContext(workspaceId: string, jobId: string): ServiceContext {
  return { workspaceId, actor: { type: 'import', id: jobId } };
}

/** Prepares (plans if needed) and moves the job to 'executing'; returns the status when there is nothing to run. */
async function prepare(tx: Tx, jobId: string): Promise<{ runnable: boolean; status: string }> {
  const loaded = await loadImport(tx, jobId, { lock: true });
  const { job } = loaded;
  if (!RUNNABLE_STATUSES.has(job.status)) return { runnable: false, status: job.status };
  if (job.plan_status !== 'ready') {
    await tx.db
      .updateTable('import_jobs')
      .set({ status: 'preparing', updated_at: tx.now })
      .where('id', '=', job.id)
      .execute();
    await storePlan(tx, loaded);
  }
  await tx.db
    .updateTable('import_jobs')
    .set({ status: 'executing', started_execution_at: job.started_execution_at ?? tx.now, updated_at: tx.now })
    .where('id', '=', job.id)
    .execute();
  touchJob(tx, job);
  return { runnable: true, status: 'executing' };
}

/** One batch of rows; `done` when no planned row is left or the job is no longer executing (canceled). */
export async function executeBatch(tx: Tx, jobId: string, batchSize: number): Promise<{ done: boolean; rows: number }> {
  const job = await requireJob(tx, jobId, { lock: true });
  if (job.status !== 'executing') return { done: true, rows: 0 };
  const { rows: pendingRows } = await sql<{ row_index: number }>`
    SELECT DISTINCT row_index FROM import_job_assertions
    WHERE import_job_id = ${job.id}::uuid AND status = 'planned'
    ORDER BY row_index LIMIT ${batchSize}`.execute(tx.db);
  if (pendingRows.length === 0) return { done: true, rows: 0 };
  const rowIndexes = pendingRows.map((r) => r.row_index);
  const loaded = await loadImport(tx, jobId);
  const resolver = await Resolver.load(tx, loaded.compiled, loaded.job);
  const cells = await tx.db
    .selectFrom('import_job_rows')
    .select(['row_index', 'cells'])
    .where('import_job_id', '=', job.id)
    .where('row_index', 'in', rowIndexes)
    .execute();
  const cellsOf = new Map(cells.map((c) => [c.row_index, c.cells]));
  const assertions = await tx.db
    .selectFrom('import_job_assertions')
    .select(['row_index', 'strategy_index', 'status', 'entity_instance_ids', 'failure_reason'])
    .where('import_job_id', '=', job.id)
    .where('row_index', 'in', rowIndexes)
    .execute();
  const updates: { s: number; r: number; st: string; ids: string[]; f: string | null }[] = [];
  for (const rowIndex of rowIndexes) {
    const mine = assertions.filter((a) => a.row_index === rowIndex);
    const pending = new Set(mine.filter((a) => a.status === 'planned').map((a) => a.strategy_index));
    const done = new Map(
      mine
        .filter((a) => a.status !== 'planned')
        .map((a) => [
          a.strategy_index,
          { status: a.status, entityInstanceIds: a.entity_instance_ids, failureReason: a.failure_reason },
        ]),
    );
    const results = await executeRow(tx, loaded.compiled, resolver, cellsOf.get(rowIndex) ?? [], pending, done);
    for (const [index, r] of results) {
      updates.push({ s: index, r: rowIndex, st: r.status, ids: r.instanceIds, f: r.failureReason });
    }
    // Strategies the current mapping no longer has (never happens after confirm) would stay planned forever.
    for (const index of pending) {
      if (!results.has(index)) updates.push({ s: index, r: rowIndex, st: 'skipped', ids: [], f: null });
    }
  }
  await engineFor(tx).finalize();
  if (updates.length > 0) {
    await sql`
      UPDATE import_job_assertions a
      SET status = u.st, entity_instance_ids = ARRAY(SELECT jsonb_array_elements_text(u.ids))::uuid[],
          failure_reason = u.f, executed_at = ${tx.now}::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS u(s int, r int, st text, ids jsonb, f text)
      WHERE a.import_job_id = ${job.id}::uuid AND a.strategy_index = u.s AND a.row_index = u.r
        AND a.status = 'planned'`.execute(tx.db);
  }
  await tx.db
    .updateTable('import_jobs')
    .set((eb) => ({ progress_done: eb('progress_done', '+', updates.length), updated_at: tx.now }))
    .where('id', '=', job.id)
    .execute();
  touchJob(tx, job);
  return { done: false, rows: rowIndexes.length };
}

async function finish(tx: Tx, jobId: string): Promise<string> {
  const job = await requireJob(tx, jobId, { lock: true });
  if (job.status !== 'executing') return job.status;
  const left = await tx.db
    .selectFrom('import_job_assertions')
    .select('row_index')
    .where('import_job_id', '=', job.id)
    .where('status', '=', 'planned')
    .limit(1)
    .executeTakeFirst();
  if (left) return job.status;
  await tx.db
    .updateTable('import_jobs')
    .set({ status: 'completed', completed_at: tx.now, updated_at: tx.now })
    .where('id', '=', job.id)
    .execute();
  touchJob(tx, job);
  return 'completed';
}

/** Runs an import to completion (or cancellation). Safe to call again: finished work is never redone. */
export async function executeImport(
  database: Database,
  workspaceId: string,
  jobId: string,
  options: ExecuteImportOptions = {},
): Promise<ExecuteImportResult> {
  const ctx = importContext(workspaceId, jobId);
  const prepared = await runInWorkspace(database, ctx, (tx) => prepare(tx, jobId));
  if (!prepared.runnable) return { status: prepared.status, batches: 0, processedRows: 0 };
  let batches = 0;
  let processedRows = 0;
  for (;;) {
    if (options.signal?.aborted) throw new ImportInterruptedError();
    if (options.maxBatches !== undefined && batches >= options.maxBatches) {
      return { status: 'executing', batches, processedRows };
    }
    const result = await runInWorkspace(database, ctx, (tx) =>
      executeBatch(tx, jobId, options.batchSize ?? IMPORT_BATCH_ROWS),
    );
    if (result.done) break;
    batches++;
    processedRows += result.rows;
  }
  const status = await runInWorkspace(database, ctx, (tx) => finish(tx, jobId));
  return { status, batches, processedRows };
}

/** After the last retry: the job failed; its remaining rows fail with "retries exceeded". */
export async function failImport(
  database: Database,
  workspaceId: string,
  jobId: string,
  reason: string,
): Promise<void> {
  await runInWorkspace(database, importContext(workspaceId, jobId), async (tx) => {
    const job = await requireJob(tx, jobId, { lock: true });
    if (!RUNNABLE_STATUSES.has(job.status)) return;
    await tx.db
      .updateTable('import_job_assertions')
      .set({ status: 'failed', failure_reason: 'retries-exceeded', executed_at: tx.now })
      .where('import_job_id', '=', job.id)
      .where('status', '=', 'planned')
      .execute();
    await tx.db
      .updateTable('import_jobs')
      .set({ status: 'failed', failure_reason: reason.slice(0, 500), completed_at: tx.now, updated_at: tx.now })
      .where('id', '=', job.id)
      .execute();
    touchJob(tx, job);
  });
}
