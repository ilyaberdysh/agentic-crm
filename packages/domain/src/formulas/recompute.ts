// Formula recompute (formulas.md §5.4; acceptance 5: a dependency change updates the value within 2 s).
//
//   pumpFormulaRecompute — the worker's change_log subscription (cursor by transaction id, like the webhook and
//     workflow fan-outs): committed 'attribute-value-list' rows → dependent formulas' records (paths walked back via
//     formula_dependencies), new records (their created_at value), 'formula-recompute' rows (create / edit / daily
//     now() formulas), renamed options and archived / restored referenced attributes → every record. Small sets are recomputed inside the pass; large ones are batched into
//     `formula.recompute` jobs (or inline batches when the process has no job queue).
//   recomputeRecords — evaluates one formula for a batch of records and writes the results through the value engine
//     as the actor {type:'formula-attribute', id: attribute} (the public API shows it as `system`), plus the
//     records' entity annotations (complete / error). Unchanged values are not rewritten (no history noise), and the
//     writes raise no webhooks or workflow triggers (bulk formula writes, §5.1); dependent formulas still follow
//     because the writes are change_log rows like any other.
import type { Actor } from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import { compileFormula, type EvalEnv, evaluateFormula, type FormulaAnnotation } from '@agentic-crm/formula';
import type { ServiceContext } from '../context.ts';
import { systemContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { JOB_NAMES, type JobQueue } from '../jobs/queue.ts';
import { engineFor } from '../records/engine.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import { enterWorkspace, runAsOwner, runInWorkspace, type Tx } from '../tx.ts';
import { loadFormulaSchema, loadReferenceData } from './context.ts';
import { outputToWriteValue } from './values.ts';

export const RECOMPUTE_BATCH = 500;

export const formulaActor = (attributeId: string): Actor => ({ type: 'formula-attribute', id: attributeId });
export const formulaContext = (workspaceId: string, attributeId: string): ServiceContext => ({
  workspaceId,
  actor: formulaActor(attributeId),
});

/** Records a full recompute request (create, edit, daily now()) for the pump; audience nobody. */
export function requestFullRecompute(tx: Tx, attr: AttrDef, reason: string): void {
  tx.emit(
    'formula-recompute',
    attr.id,
    { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id, reason },
    { userIds: [] },
  );
}

async function liveInstances(tx: Tx, def: DefInfo, ids: string[] | null): Promise<string[]> {
  let q = tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where('entity_definition_id', '=', def.id)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null);
  if (ids !== null) {
    if (ids.length === 0) return [];
    q = q.where('id', 'in', ids);
  }
  const rows = await q.orderBy('id').execute();
  return rows.map((r) => r.id);
}

/** Runs `fn` with the value engine's events (webhooks, workflow triggers) of this transaction suppressed. */
async function withoutEvents<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const original = tx.event;
  tx.event = () => {};
  try {
    return await fn();
  } finally {
    tx.event = original;
  }
}

export interface RecomputeResult {
  evaluated: number;
  errors: number;
}

/** Evaluates one formula attribute for `instanceIds` (live records of its definition) and writes the results. */
export async function recomputeRecords(
  tx: Tx,
  attributeId: string,
  instanceIds: string[] | null,
): Promise<RecomputeResult> {
  const row = await tx.db
    .selectFrom('formula_attributes as f')
    .innerJoin('formula_attribute_snapshots as s', 's.id', 'f.active_snapshot_id')
    .select(['f.entity_definition_id', 's.id as snapshot_id', 's.plaintext', 's.annotations', 's.output_type_override'])
    .where('f.attribute_id', '=', attributeId)
    .executeTakeFirst();
  if (!row) return { evaluated: 0, errors: 0 };
  const def = await loadDefinition(tx, row.entity_definition_id);
  const attr = def.byId.get(attributeId);
  if (!attr || attr.isArchived || !attr.formula) return { evaluated: 0, errors: 0 };
  const ids = await liveInstances(tx, def, instanceIds);
  if (ids.length === 0) return { evaluated: 0, errors: 0 };

  const annotations = row.annotations as unknown as FormulaAnnotation[];
  const loaded = await loadFormulaSchema(tx, annotations, [def.id]);
  const compiled = compileFormula(
    { plaintext: row.plaintext, annotations },
    {
      entityDefinitionId: def.id,
      schema: loaded.schema,
      outputTypeOverride: (row.output_type_override ?? null) as never,
    },
  );
  const engine = engineFor(tx);
  await engine.lock(ids);
  const now = Date.parse(tx.now);
  const outcomes: { id: string; status: 'complete' | 'error'; error: string | null; message: string | null }[] = [];
  let errors = 0;
  // A formula that no longer checks (a referenced attribute was deleted) yields the runtime error for every record.
  const data = compiled.ok ? await loadReferenceData(tx, compiled.references, loaded.defs, ids) : null;
  await withoutEvents(tx, async () => {
    for (const id of ids) {
      let value: unknown = null;
      if (!compiled.ok || !data) {
        outcomes.push({
          id,
          status: 'error',
          error: 'referenced-attribute-missing-or-archived',
          message: compiled.diagnostics[0]?.message ?? null,
        });
        errors++;
      } else {
        const record = data.get(id);
        const env: EvalEnv = {
          now,
          ref: (i) => record?.values[i] ?? null,
          history: (i) => record?.history.get(i) ?? [],
        };
        const result = evaluateFormula(compiled, env);
        if (result.type === 'complete') {
          value = outputToWriteValue(compiled.outputType, result.outputValue);
          outcomes.push({ id, status: 'complete', error: null, message: null });
        } else {
          const code = result.type === 'evaluation_error' ? result.code : 'formula-feature-not-enabled';
          const message = result.type === 'evaluation_error' ? result.message : null;
          outcomes.push({ id, status: 'error', error: code, message: message === code ? null : message });
          errors++;
        }
      }
      // Output kinds always match the attribute type (the attribute type follows the formula's output type).
      if (compiled.ok && compiled.outputType !== attr.type) continue;
      try {
        await engine.asSystem(() =>
          engine.setAttribute(def, id, attr, value === null || value === undefined ? [] : [{ value }], 'replace'),
        );
      } catch (err) {
        // A result the attribute cannot hold (e.g. a phone number without a country code, a deleted record): the
        // record's value is cleared and the annotation carries the error. Database errors abort the batch.
        if (!(err instanceof DomainError)) throw err;
        const outcome = outcomes.at(-1);
        if (outcome) Object.assign(outcome, { status: 'error', error: 'invalid-argument', message: err.message });
        errors++;
        await engine.asSystem(() => engine.setAttribute(def, id, attr, [], 'replace'));
      }
    }
    await engine.finalize();
  });
  await upsertFormulaAnnotations(tx, def, attr, row.snapshot_id, outcomes);
  return { evaluated: ids.length, errors };
}

async function upsertFormulaAnnotations(
  tx: Tx,
  def: DefInfo,
  attr: AttrDef,
  snapshotId: string,
  outcomes: { id: string; status: 'complete' | 'error'; error: string | null; message: string | null }[],
): Promise<void> {
  if (outcomes.length === 0) return;
  for (let i = 0; i < outcomes.length; i += 1000) {
    const chunk = outcomes.slice(i, i + 1000);
    await sql`
      INSERT INTO entity_annotations AS e (workspace_id, entity_definition_id, attribute_id, instance_id, formula_status,
        formula_status_changed_at, formula_snapshot_id, formula_error, formula_error_message, updated_at)
      SELECT ${tx.workspaceId}::uuid, ${def.id}::uuid, ${attr.id}::uuid, r.id, r.status, ${tx.now}::timestamptz,
        ${snapshotId}::uuid, r.error, r.message, ${tx.now}::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS r(id uuid, status text, error text, message text)
      ON CONFLICT (attribute_id, instance_id) DO UPDATE SET
        formula_status = excluded.formula_status,
        formula_status_changed_at = excluded.formula_status_changed_at,
        formula_snapshot_id = excluded.formula_snapshot_id,
        formula_error = excluded.formula_error,
        formula_error_message = excluded.formula_error_message,
        updated_at = excluded.updated_at`.execute(tx.db);
  }
  tx.emit('entity-annotation', attr.id, {
    entityDefinitionId: def.id,
    attributeDefinitionId: attr.id,
    entityInstanceIds: outcomes.map((o) => o.id),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Dependency graph

interface DependencyRow {
  formula_attribute_id: string;
  formula_entity_definition_id: string;
  depends_on_attribute_id: string;
  hop_index: number;
  path: { entityDefinitionId: string; attributeDefinitionId: string }[];
}

async function dependencies(tx: Tx): Promise<DependencyRow[]> {
  const rows = await tx.db
    .selectFrom('formula_dependencies')
    .select(['formula_attribute_id', 'formula_entity_definition_id', 'depends_on_attribute_id', 'hop_index', 'path'])
    .execute();
  return rows as unknown as DependencyRow[];
}

/** formula attribute → attributes it references (every hop of every path). */
export function dependencyGraph(
  rows: { formula_attribute_id: string; depends_on_attribute_id: string }[],
  formulaIds: Iterable<string> = [],
) {
  const graph = new Map<string, Set<string>>();
  // Formulas without references (constants) are nodes too.
  for (const id of formulaIds) graph.set(id, new Set());
  for (const r of rows) {
    let set = graph.get(r.formula_attribute_id);
    if (!set) {
      set = new Set();
      graph.set(r.formula_attribute_id, set);
    }
    set.add(r.depends_on_attribute_id);
  }
  return graph;
}

/** Number of formulas in the longest chain ending at `id` (1 = references no formula). */
export function upDepth(graph: Map<string, Set<string>>, id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return Number.POSITIVE_INFINITY;
  const deps = graph.get(id);
  if (!deps) return 1;
  seen.add(id);
  let best = 0;
  for (const d of deps) if (graph.has(d)) best = Math.max(best, upDepth(graph, d, seen));
  seen.delete(id);
  return 1 + best;
}

/** Number of formulas in the longest chain starting at `id` and following its dependents. */
export function downDepth(graph: Map<string, Set<string>>, id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return Number.POSITIVE_INFINITY;
  seen.add(id);
  let best = 0;
  for (const [formula, deps] of graph) if (deps.has(id)) best = Math.max(best, downDepth(graph, formula, seen));
  seen.delete(id);
  return 1 + best;
}

/** Whether following references from `start` reaches `target` (circular formula). */
export function reaches(graph: Map<string, Set<string>>, start: string, target: string): boolean {
  const stack = [...(graph.get(start) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const x = stack.pop() as string;
    if (x === target) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const y of graph.get(x) ?? []) stack.push(y);
  }
  return false;
}

/** Records of the formula's definition affected when the dependency's attribute changed on `changedIds`. */
async function affectedRecords(tx: Tx, dep: DependencyRow, changedIds: string[]): Promise<string[]> {
  let ids = changedIds;
  for (let k = dep.hop_index - 1; k >= 0 && ids.length > 0; k--) {
    const hop = dep.path[k] as { attributeDefinitionId: string };
    const rows = await tx.db
      .selectFrom('attribute_values')
      .select('instance_id')
      .distinct()
      .where('attribute_id', '=', hop.attributeDefinitionId)
      .where('v_ref', 'in', ids)
      .where('active_until', 'is', null)
      .execute();
    ids = rows.map((r) => r.instance_id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------
// Pump (worker) and jobs

export interface RecomputeDeps {
  database: Database;
  /** Batches beyond the inline limit become `formula.recompute` jobs; null = compute every batch inline. */
  jobs: JobQueue | null;
}

export interface PumpResult {
  rows: number;
  recomputed: number;
  enqueued: number;
  failed: number;
}

interface ChangeRow {
  resource: string;
  resource_id: string | null;
  scope: { entityDefinitionId?: string; attributeDefinitionId?: string; entityInstanceIds?: string[] };
}

type Work = Map<string, Set<string> | 'all'>;

function addWork(work: Work, attributeId: string, ids: Iterable<string> | 'all'): void {
  const current = work.get(attributeId);
  if (current === 'all') return;
  if (ids === 'all') {
    work.set(attributeId, 'all');
    return;
  }
  const set = current ?? new Set<string>();
  for (const id of ids) set.add(id);
  work.set(attributeId, set);
}

async function workFor(tx: Tx, rows: ChangeRow[]): Promise<{ work: Work; order: string[] }> {
  const deps = await dependencies(tx);
  const formulas = await tx.db
    .selectFrom('formula_attributes')
    .select(['attribute_id', 'entity_definition_id'])
    .execute();
  const work: Work = new Map();
  const byDependency = new Map<string, DependencyRow[]>();
  for (const d of deps)
    byDependency.set(d.depends_on_attribute_id, [...(byDependency.get(d.depends_on_attribute_id) ?? []), d]);
  const formulasByDef = new Map<string, string[]>();
  for (const f of formulas)
    formulasByDef.set(f.entity_definition_id, [...(formulasByDef.get(f.entity_definition_id) ?? []), f.attribute_id]);
  const createdAt = formulasByDef.size
    ? await tx.db
        .selectFrom('attribute_definitions')
        .select(['id', 'entity_definition_id'])
        .where('system_attribute_type', '=', 'created-at')
        .where('entity_definition_id', 'in', [...formulasByDef.keys()])
        .execute()
    : [];
  const createdAtAttr = new Map(createdAt.map((r) => [r.id, r.entity_definition_id]));
  const formulaIds = new Set(formulas.map((f) => f.attribute_id));

  for (const row of rows) {
    if (row.resource === 'formula-recompute') {
      const id = row.scope.attributeDefinitionId ?? row.resource_id;
      if (id && formulaIds.has(id)) addWork(work, id, 'all');
      continue;
    }
    if (row.resource === 'select-option-list' || row.resource === 'attribute-definition') {
      // A renamed option / stage (text results) or an archived / restored referenced attribute: every record of the
      // dependent formulas.
      const id = row.scope.attributeDefinitionId ?? row.resource_id;
      // A restored formula attribute catches up too.
      if (row.resource === 'attribute-definition' && id && formulaIds.has(id)) addWork(work, id, 'all');
      for (const dep of (id ? byDependency.get(id) : undefined) ?? []) addWork(work, dep.formula_attribute_id, 'all');
      continue;
    }
    const attributeId = row.resource_id;
    const changed = row.scope.entityInstanceIds;
    if (!attributeId || !changed || changed.length === 0) continue;
    const newRecordsOf = createdAtAttr.get(attributeId);
    if (newRecordsOf) for (const f of formulasByDef.get(newRecordsOf) ?? []) addWork(work, f, changed);
    for (const dep of byDependency.get(attributeId) ?? []) {
      addWork(work, dep.formula_attribute_id, await affectedRecords(tx, dep, changed));
    }
  }
  const graph = dependencyGraph(deps, formulaIds);
  const order = [...work.keys()].sort((a, b) => upDepth(graph, a) - upDepth(graph, b));
  return { work, order };
}

/** One recompute pass over committed change_log rows (the worker calls it every ~250 ms). */
export async function pumpFormulaRecompute(
  deps: RecomputeDeps,
  options: { inlineLimit?: number } = {},
): Promise<PumpResult> {
  const inlineLimit = options.inlineLimit ?? RECOMPUTE_BATCH;
  return runAsOwner(deps.database, async (trx) => {
    const state = await trx
      .selectFrom('formula_recompute_state')
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
    const result: PumpResult = { rows: 0, recomputed: 0, enqueued: 0, failed: 0 };
    if (!state) {
      await sql`INSERT INTO formula_recompute_state (id, xid_cursor) VALUES (1, ${upper}::xid8) ON CONFLICT DO NOTHING`.execute(
        trx,
      );
      return result;
    }
    const { rows } = await sql<ChangeRow & { workspace_id: string }>`
      SELECT c.workspace_id::text AS workspace_id, c.resource, c.resource_id::text AS resource_id, c.scope
      FROM change_log c
      WHERE c.xid >= ${state.xid_cursor}::xid8 AND c.xid < ${upper}::xid8
        AND c.resource IN ('attribute-value-list', 'formula-recompute', 'select-option-list', 'attribute-definition')
        AND EXISTS (SELECT 1 FROM formula_attributes f WHERE f.workspace_id = c.workspace_id)
      ORDER BY c.id`.execute(trx);
    result.rows = rows.length;
    const byWorkspace = new Map<string, ChangeRow[]>();
    for (const r of rows) byWorkspace.set(r.workspace_id, [...(byWorkspace.get(r.workspace_id) ?? []), r]);
    for (const [workspaceId, wsRows] of byWorkspace) {
      const planner = await enterWorkspace(trx, systemContext(workspaceId, 'formula-recompute'));
      const { work, order } = await workFor(planner, wsRows);
      for (const attributeId of order) {
        const target = work.get(attributeId) as Set<string> | 'all';
        await sql`SAVEPOINT formula_recompute`.execute(trx);
        try {
          const tx = await enterWorkspace(trx, formulaContext(workspaceId, attributeId));
          const ids = target === 'all' ? null : [...target];
          if (ids !== null && ids.length <= inlineLimit) {
            const r = await recomputeRecords(tx, attributeId, ids);
            result.recomputed += r.evaluated;
          } else {
            const all = await allIdsOf(tx, attributeId, ids);
            for (let i = 0; i < all.length; i += RECOMPUTE_BATCH) {
              const batch = all.slice(i, i + RECOMPUTE_BATCH);
              if (deps.jobs) {
                await deps.jobs.send(tx, JOB_NAMES.formulaRecompute, { workspaceId, attributeId, instanceIds: batch });
                result.enqueued += batch.length;
              } else {
                const r = await recomputeRecords(tx, attributeId, batch);
                result.recomputed += r.evaluated;
              }
            }
          }
          await tx.flush();
          await sql`RELEASE SAVEPOINT formula_recompute`.execute(trx);
        } catch {
          // One broken formula must not stall the others: its rows are skipped; the next change retries it.
          await sql`ROLLBACK TO SAVEPOINT formula_recompute`.execute(trx);
          result.failed++;
        }
      }
      await sql`SELECT set_config('role', 'none', true)`.execute(trx);
    }
    await sql`UPDATE formula_recompute_state SET xid_cursor = ${upper}::xid8, updated_at = now() WHERE id = 1`.execute(
      trx,
    );
    return result;
  });
}

async function allIdsOf(tx: Tx, attributeId: string, ids: string[] | null): Promise<string[]> {
  if (ids !== null) return ids;
  const f = await tx.db
    .selectFrom('formula_attributes')
    .select('entity_definition_id')
    .where('attribute_id', '=', attributeId)
    .executeTakeFirst();
  if (!f) return [];
  return liveInstances(tx, await loadDefinition(tx, f.entity_definition_id), null);
}

/** Job handler: one batch of one formula in its own transaction. */
export function runRecomputeJob(
  database: Database,
  data: { workspaceId: string; attributeId: string; instanceIds: string[] },
): Promise<RecomputeResult> {
  return runInWorkspace(database, formulaContext(data.workspaceId, data.attributeId), (tx) =>
    recomputeRecords(tx, data.attributeId, data.instanceIds),
  );
}

/** Daily: every formula using now() / today() is recomputed (full recompute request per formula). */
export async function requestDailyRecompute(database: Database): Promise<{ formulas: number }> {
  return runAsOwner(database, async (trx) => {
    const rows = await trx
      .selectFrom('formula_attributes')
      .select(['workspace_id', 'attribute_id', 'entity_definition_id'])
      .where('uses_now', '=', true)
      .execute();
    for (const r of rows) {
      const tx = await enterWorkspace(trx, systemContext(r.workspace_id, 'formula-daily'));
      tx.emit(
        'formula-recompute',
        r.attribute_id,
        { entityDefinitionId: r.entity_definition_id, attributeDefinitionId: r.attribute_id, reason: 'daily' },
        { userIds: [] },
      );
      await tx.flush();
      await sql`SELECT set_config('role', 'none', true)`.execute(trx);
    }
    return { formulas: rows.length };
  });
}
