// Plan and execution of an import (import.md I5–I6). Both walk every row through the strategies, children first
// (linked records and a list's parent records before the destination), with the same decision logic:
//   update            match on Record / Entry ID; no id → "Matching values missing"; unknown id → "No matching record
//                     found" (a linked one → the row fails with "The linked record was not found")
//   create-or-update  match on a unique attribute: no match → create, one → update, several → "Multiple matches
//                     found"; no value → create; list entries match on the parent record ("Update existing")
//   create            every row with data creates a record (list entries: "Add again")
// The plan evaluates rows against existing records only (duplicate rows in the file both plan "create" and merge at
// run time); it prefetches matches per page of rows. Execution re-decides each row against the
// database and writes through the record write path (createRecordInTx / ValueEngine) under a savepoint per
// strategy, so one failing row never undoes another. Multi-value attributes are appended to on update
// documents imports as additive), single values are replaced. Statuses and progress commit with the data.
import {
  type ImportFailureReason,
  type ImportPlannedOutcome,
  importFailureMessages,
  type RecordRef,
  type ValueInput,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { DomainError, valueError } from '../errors.ts';
import { newId } from '../ids.ts';
import { insertEntriesInTx } from '../lists/entries.ts';
import { loadList } from '../lists/model.ts';
import { engineFor } from '../records/engine.ts';
import { createRecordInTx } from '../records/service.ts';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { parseValue } from '../values/codecs.ts';
import { type CompiledMapping, isIdAttr, isParentRecordAttr, type StrategyNode } from './mapping.ts';
import { type NodeRowValues, nodeRowValues, type Resolver } from './resolve.ts';

export const PLAN_PAGE_ROWS = 2000;

/** What a strategy did (or plans to do) for one row. */
export interface NodeOutcome {
  node: StrategyNode;
  outcome: ImportPlannedOutcome;
  /** Records written (execution) or matched (plan). */
  instanceIds: string[];
  matchedIds: string[];
  failureReason: ImportFailureReason | null;
  /** Plan only: a record will be created (no id yet). */
  pendingCreate: boolean;
}

interface Item {
  action: 'create' | 'update' | 'fail';
  instanceId?: string;
  reason?: ImportFailureReason;
  /** Multi-reference nodes: the single match value this item writes. */
  matchValue?: unknown;
}

export interface Lookups {
  /** canonical unique key → live instance ids of the attribute's definition. */
  byUnique(attr: AttrDef, keys: string[]): Promise<Map<string, string[]>>;
  /** id → 'live' | 'merged'; absent = not found (or another object, or deleted). */
  byIds(def: DefInfo, ids: string[]): Promise<Map<string, 'live' | 'merged'>>;
  /** parent record id → live entries of the list. */
  entriesByParent(listDef: DefInfo, parentAttr: AttrDef, parentIds: string[]): Promise<Map<string, string[]>>;
}

/** Canonical keys of values for a unique lookup (values that do not parse are skipped). */
export function uniqueKeys(attr: AttrDef, values: unknown[]): string[] {
  const keys: string[] = [];
  for (const v of values) {
    try {
      const stored = parseValue(attr, v);
      if (stored) keys.push(stored.canonical);
    } catch {
      // invalid values never match
    }
  }
  return [...new Set(keys)];
}

const normId = (v: unknown) => String(v).toLowerCase();

export const dbLookups = (tx: Tx): Lookups => ({
  async byUnique(attr, keys) {
    const out = new Map<string, string[]>();
    if (keys.length === 0) return out;
    const { rows } = await sql<{ unique_key: string; instance_id: string }>`
      SELECT v.unique_key, v.instance_id FROM attribute_values v
      JOIN entity_instances i ON i.id = v.instance_id
      WHERE v.attribute_id = ${attr.id}::uuid AND v.unique_key = ANY(${keys}::text[]) AND v.active_until IS NULL
        AND i.archived_at IS NULL AND i.merged_at IS NULL`.execute(tx.db);
    for (const r of rows) out.set(r.unique_key, [...(out.get(r.unique_key) ?? []), r.instance_id]);
    return out;
  },
  async byIds(def, ids) {
    const out = new Map<string, 'live' | 'merged'>();
    if (ids.length === 0) return out;
    const rows = await tx.db
      .selectFrom('entity_instances')
      .select(['id', 'entity_definition_id', 'archived_at', 'merged_at'])
      .where('id', 'in', ids)
      .execute();
    for (const r of rows) {
      if (r.entity_definition_id !== def.id || r.archived_at !== null) continue;
      out.set(r.id, r.merged_at === null ? 'live' : 'merged');
    }
    return out;
  },
  async entriesByParent(listDef, parentAttr, parentIds) {
    const out = new Map<string, string[]>();
    if (parentIds.length === 0) return out;
    const { rows } = await sql<{ parent: string; entry: string }>`
      SELECT v.v_ref AS parent, v.instance_id AS entry FROM attribute_values v
      JOIN entity_instances i ON i.id = v.instance_id
      WHERE v.attribute_id = ${parentAttr.id}::uuid AND v.v_ref = ANY(${parentIds}::uuid[]) AND v.active_until IS NULL
        AND i.entity_definition_id = ${listDef.id}::uuid AND i.archived_at IS NULL AND i.merged_at IS NULL
      ORDER BY v.instance_id`.execute(tx.db);
    for (const r of rows) out.set(r.parent, [...(out.get(r.parent) ?? []), r.entry]);
    return out;
  },
});

/** Prefetched lookups for the plan (filled per page and node; misses query the database). */
class CachedLookups implements Lookups {
  private readonly unique = new Map<string, Map<string, string[]>>();
  private readonly ids = new Map<string, Map<string, string>>();
  private readonly entries = new Map<string, Map<string, string[]>>();
  constructor(private readonly db: Lookups) {}

  async prefetchUnique(attr: AttrDef, keys: string[]) {
    const map = this.unique.get(attr.id) ?? new Map<string, string[]>();
    const missing = keys.filter((k) => !map.has(k));
    for (let i = 0; i < missing.length; i += 5000) {
      const chunk = missing.slice(i, i + 5000);
      const found = await this.db.byUnique(attr, chunk);
      for (const k of chunk) map.set(k, found.get(k) ?? []);
    }
    this.unique.set(attr.id, map);
  }
  async prefetchIds(def: DefInfo, ids: string[]) {
    const map = this.ids.get(def.id) ?? new Map<string, string>();
    const unknown = [...new Set(ids)].filter((id) => !map.has(id) && /^[0-9a-f-]{36}$/.test(id));
    for (let i = 0; i < unknown.length; i += 5000) {
      const chunk = unknown.slice(i, i + 5000);
      const found = await this.db.byIds(def, chunk);
      for (const id of chunk) map.set(id, found.get(id) ?? 'none');
    }
    this.ids.set(def.id, map);
  }
  async prefetchEntries(listDef: DefInfo, parentAttr: AttrDef, parentIds: string[]) {
    const map = this.entries.get(listDef.id) ?? new Map<string, string[]>();
    const unknown = [...new Set(parentIds)].filter((id) => !map.has(id));
    for (let i = 0; i < unknown.length; i += 5000) {
      const chunk = unknown.slice(i, i + 5000);
      const found = await this.db.entriesByParent(listDef, parentAttr, chunk);
      for (const id of chunk) map.set(id, found.get(id) ?? []);
    }
    this.entries.set(listDef.id, map);
  }
  async byUnique(attr: AttrDef, keys: string[]) {
    await this.prefetchUnique(attr, keys);
    const map = this.unique.get(attr.id) as Map<string, string[]>;
    return new Map(keys.map((k) => [k, map.get(k) ?? []]));
  }
  async byIds(def: DefInfo, ids: string[]) {
    await this.prefetchIds(def, ids);
    const map = this.ids.get(def.id) as Map<string, string>;
    const out = new Map<string, 'live' | 'merged'>();
    for (const id of ids) {
      const v = map.get(id);
      if (v === 'live' || v === 'merged') out.set(id, v);
    }
    return out;
  }
  async entriesByParent(listDef: DefInfo, parentAttr: AttrDef, parentIds: string[]) {
    await this.prefetchEntries(listDef, parentAttr, parentIds);
    const map = this.entries.get(listDef.id) as Map<string, string[]>;
    return new Map(parentIds.map((id) => [id, map.get(id) ?? []]));
  }
}

/** Link values a node writes from its children's outcomes. */
interface Links {
  values: Map<AttrDef, ValueInput[]>;
  pending: Set<AttrDef>;
}

function childLinks(node: StrategyNode, children: NodeOutcome[]): Links | { fail: ImportFailureReason } {
  const values = new Map<AttrDef, ValueInput[]>();
  const pending = new Set<AttrDef>();
  for (const c of children) {
    const via = c.node.viaAttr as AttrDef;
    if (c.outcome === 'fail') {
      if (c.node.isParentRecord || c.failureReason === 'matching-entity-instance-not-found') {
        return { fail: 'linked-record-not-found' };
      }
      continue;
    }
    if (c.outcome === 'skip') {
      if (c.node.isParentRecord && node.mode !== 'update') return { fail: 'matching-values-missing' };
      continue;
    }
    if (c.pendingCreate) pending.add(via);
    const ids = c.instanceIds;
    if (ids.length === 0) continue;
    const inputs = ids.map((id) => ({ value: { entityDefinitionId: c.node.def.id, entityInstanceId: id } }));
    values.set(via, [...(values.get(via) ?? []), ...(via.isMultiselect ? inputs : inputs.slice(0, 1))]);
  }
  return { values, pending };
}

/** Required attributes a create would leave empty (defaults and system values count as provided). */
function missingRequired(def: DefInfo, provided: Set<string>): AttrDef | undefined {
  return def.attrs.find(
    (a) =>
      a.isRequired &&
      !a.isArchived &&
      !isIdAttr(a) &&
      a.defaultValue === null &&
      a.systemAttributeType !== 'created-at' &&
      a.systemAttributeType !== 'created-by' &&
      !provided.has(a.id),
  );
}

/** Decides one strategy for one row (no writes). */
export async function decide(
  node: StrategyNode,
  rv: NodeRowValues,
  children: NodeOutcome[],
  lookups: Lookups,
): Promise<{ items: Item[]; links: Links; failure: ImportFailureReason | null; matched: string[] }> {
  const linkResult = childLinks(node, children);
  const noLinks: Links = { values: new Map(), pending: new Set() };
  if ('fail' in linkResult) return { items: [], links: noLinks, failure: linkResult.fail, matched: [] };
  const links = linkResult;
  const hasData = rv.hasData || links.values.size > 0 || links.pending.size > 0;
  const items: Item[] = [];
  const matched: string[] = [];

  if (node.mode === 'update') {
    const ids = rv.matchValues.map(normId);
    if (ids.length === 0) {
      return { items, links, failure: hasData ? 'matching-values-missing' : null, matched };
    }
    const found = await lookups.byIds(node.def, ids);
    for (const id of node.multi ? ids : ids.slice(0, 1)) {
      const state = found.get(id);
      if (state === 'live') {
        matched.push(id);
        items.push({ action: 'update', instanceId: id });
      } else if (state === 'merged') items.push({ action: 'fail', reason: 'matching-entity-instance-is-merging' });
      else items.push({ action: 'fail', reason: 'matching-entity-instance-not-found' });
    }
  } else if (node.mode === 'create-or-update' && node.isListEntries) {
    const parent = children.find((c) => c.node.isParentRecord);
    const parentId = parent?.instanceIds[0];
    if (!parentId || parent?.pendingCreate) items.push({ action: 'create' });
    else {
      const parentAttr = node.matchAttr as AttrDef;
      const entries = (await lookups.entriesByParent(node.def, parentAttr, [parentId])).get(parentId) ?? [];
      if (entries.length === 0) items.push({ action: 'create' });
      else if (entries.length === 1) {
        matched.push(entries[0] as string);
        items.push({ action: 'update', instanceId: entries[0] as string });
      } else items.push({ action: 'fail', reason: 'multiple-matching-entity-instances' });
    }
  } else if (node.mode === 'create-or-update') {
    const attr = node.matchAttr as AttrDef;
    if (rv.matchValues.length === 0) {
      if (hasData) items.push({ action: 'create' });
    } else if (node.multi) {
      for (const value of rv.matchValues) {
        const keys = uniqueKeys(attr, [value]);
        const ids = [...new Set([...(await lookups.byUnique(attr, keys)).values()].flat())];
        if (ids.length === 0) items.push({ action: 'create', matchValue: value });
        else if (ids.length === 1) {
          matched.push(ids[0] as string);
          items.push({ action: 'update', instanceId: ids[0] as string, matchValue: value });
        } else items.push({ action: 'fail', reason: 'multiple-matching-entity-instances' });
      }
    } else {
      const keys = uniqueKeys(attr, rv.matchValues);
      const ids = [...new Set([...(await lookups.byUnique(attr, keys)).values()].flat())];
      if (ids.length === 0) items.push({ action: 'create' });
      else if (ids.length === 1) {
        matched.push(ids[0] as string);
        items.push({ action: 'update', instanceId: ids[0] as string });
      } else items.push({ action: 'fail', reason: 'multiple-matching-entity-instances' });
    }
  } else if (hasData) {
    items.push({ action: 'create' });
  }

  // Required values on create (A "required-value-not-provided").
  if (items.some((i) => i.action === 'create')) {
    const provided = new Set<string>([
      ...[...rv.values.keys()].map((a) => a.id),
      ...[...links.values.keys()].map((a) => a.id),
      ...[...links.pending].map((a) => a.id),
    ]);
    if (missingRequired(node.def, provided)) {
      for (const item of items) {
        if (item.action !== 'create') continue;
        item.action = 'fail';
        item.reason = 'required-value-not-provided';
      }
    }
  }
  return { items, links, failure: null, matched };
}

function summarize(
  items: Item[],
  failure: ImportFailureReason | null,
): { outcome: ImportPlannedOutcome; reason: ImportFailureReason | null } {
  if (failure) return { outcome: 'fail', reason: failure };
  if (items.length === 0) return { outcome: 'skip', reason: null };
  const firstFail = items.find((i) => i.action === 'fail');
  if (items.every((i) => i.action === 'fail')) return { outcome: 'fail', reason: firstFail?.reason ?? 'unknown-error' };
  if (items.some((i) => i.action === 'create')) return { outcome: 'create', reason: firstFail?.reason ?? null };
  return { outcome: 'update', reason: firstFail?.reason ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// Plan

export interface PlannedAssertion {
  strategyIndex: number;
  rowIndex: number;
  outcome: ImportPlannedOutcome;
  matchedIds: string[];
  failureReason: ImportFailureReason | null;
}

/** Plans every row of the job (paged), returning one assertion per (strategy, row). */
export async function planRows(
  tx: Tx,
  compiled: CompiledMapping,
  resolver: Resolver,
  jobId: string,
  onPage: (assertions: PlannedAssertion[]) => Promise<void>,
): Promise<void> {
  const lookups = new CachedLookups(dbLookups(tx));
  const deepestFirst = [...compiled.nodes].sort((a, b) => b.index - a.index);
  for (let start = 0; ; start += PLAN_PAGE_ROWS) {
    const rows = await tx.db
      .selectFrom('import_job_rows')
      .select(['row_index', 'cells'])
      .where('import_job_id', '=', jobId)
      .where('row_index', '>=', start)
      .where('row_index', '<', start + PLAN_PAGE_ROWS)
      .orderBy('row_index')
      .execute();
    if (rows.length === 0) {
      const more = await tx.db
        .selectFrom('import_job_rows')
        .select('row_index')
        .where('import_job_id', '=', jobId)
        .where('row_index', '>=', start)
        .limit(1)
        .executeTakeFirst();
      if (!more) break;
      continue;
    }
    const outcomes = new Map<number, Map<StrategyNode, NodeOutcome>>(rows.map((r) => [r.row_index, new Map()]));
    const page: PlannedAssertion[] = [];
    for (const node of deepestFirst) {
      const values = rows.map((r) => nodeRowValues(resolver, node, r.cells));
      // Prefetch this node's lookups for the page.
      if (node.mode === 'update') {
        await lookups.prefetchIds(
          node.def,
          values.flatMap((v) => v.matchValues.map(normId)),
        );
      } else if (node.mode === 'create-or-update' && !node.isListEntries && node.matchAttr) {
        await lookups.prefetchUnique(
          node.matchAttr,
          uniqueKeys(
            node.matchAttr,
            values.flatMap((v) => v.matchValues),
          ),
        );
      } else if (node.mode === 'create-or-update' && node.isListEntries && node.matchAttr) {
        const parentIds = rows.flatMap((r) => {
          const parent = [...(outcomes.get(r.row_index)?.values() ?? [])].find((o) => o.node.isParentRecord);
          return parent && !parent.pendingCreate ? parent.instanceIds : [];
        });
        await lookups.prefetchEntries(node.def, node.matchAttr, parentIds);
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as { row_index: number; cells: string[] };
        const rowOutcomes = outcomes.get(row.row_index) as Map<StrategyNode, NodeOutcome>;
        const children = node.children.map((c) => rowOutcomes.get(c) as NodeOutcome);
        const d = await decide(node, values[i] as NodeRowValues, children, lookups);
        const { outcome, reason } = summarize(d.items, d.failure);
        const instanceIds = d.items.filter((it) => it.action === 'update').map((it) => it.instanceId as string);
        rowOutcomes.set(node, {
          node,
          outcome,
          instanceIds,
          matchedIds: d.matched,
          failureReason: reason,
          pendingCreate: d.items.some((it) => it.action === 'create'),
        });
        page.push({
          strategyIndex: node.index,
          rowIndex: row.row_index,
          outcome,
          matchedIds: d.matched,
          failureReason: reason,
        });
      }
    }
    await onPage(page);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Execution

/** Domain errors raised by the write path → the import's failure reasons. */
export function failureReasonOf(err: unknown): ImportFailureReason {
  if (!(err instanceof DomainError)) return 'unknown-error';
  const reason = (err.details as { reason?: string }).reason;
  switch (err.code) {
    case 'VALUE_VALIDATION_FAILED':
      if (reason === 'required') return 'required-value-not-provided';
      if (reason === 'unknown-record' || reason === 'record-type-mismatch') return 'linked-record-not-found';
      return 'invalid-value';
    case 'UNIQUE_CONSTRAINT_VIOLATION':
      return 'unique-constraint-violation';
    case 'DUPLICATE_VALUE_IN_MULTISELECT':
    case 'VALIDATION_ERROR':
      return 'invalid-value';
    case 'ATTRIBUTE_ARCHIVED':
      return 'attribute-definition-not-found';
    case 'ATTRIBUTE_READ_ONLY':
      return 'unsupported-attribute-type';
    case 'FORBIDDEN':
      return 'permission-denied';
    case 'NOT_FOUND':
      return 'entity-definition-not-found';
    default:
      return 'unknown-error';
  }
}

export interface ExecutedNode extends NodeOutcome {
  status: 'created' | 'updated' | 'skipped' | 'failed';
}

async function writeItem(tx: Tx, node: StrategyNode, item: Item, rv: NodeRowValues, links: Links): Promise<string> {
  const engine = engineFor(tx);
  const values = new Map<AttrDef, ValueInput[]>(rv.values);
  if (node.multi && node.matchAttr && item.matchValue !== undefined) {
    values.clear();
    if (!isIdAttr(node.matchAttr)) values.set(node.matchAttr, [{ value: item.matchValue }]);
  }
  for (const [attr, inputs] of links.values) values.set(attr, [...(values.get(attr) ?? []), ...inputs]);
  if (item.action === 'create') {
    const id = newId();
    if (node.isListEntries) {
      // List entries are created by the entries service's write path (parent_record is read-only; the parents'
      // list_entries and timelines follow), recorded as the import.
      const list = await loadList(tx, node.def.id);
      const parent = values.get(list.parentAttr)?.[0]?.value as RecordRef | undefined;
      if (!parent) throw valueError(list.parentAttr.id, 'required', 'The entry has no parent record');
      await insertEntriesInTx(tx, list, [{ entryId: id, parent, values }]);
    } else await createRecordInTx(tx, node.def, id, values);
    return id;
  }
  const id = item.instanceId as string;
  await engine.lock([id]);
  for (const [attr, inputs] of values) {
    if (node.isListEntries && isParentRecordAttr(attr)) continue;
    await engine.setAttribute(node.def, id, attr, inputs, attr.isMultiselect ? 'append' : 'replace');
  }
  tx.emit('entity-instance', id, { entityDefinitionId: node.def.id });
  return id;
}

let savepointSeq = 0;

/**
 * Runs `fn` under a savepoint. Derived writes (projection, versions, search text, change_log) are finalised once per
 * batch (executeBatch); on error the savepoint is rolled back, the engine's pending work is finalised (refreshing a
 * rolled-back record recomputes it from its rolled-back values, a no-op) and a fresh engine takes over, so its lock
 * memo never claims a lock the rollback released.
 */
async function withSavepoint<T>(
  tx: Tx,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const name = sql.raw(`import_sp_${++savepointSeq}`);
  await sql`SAVEPOINT ${name}`.execute(tx.db);
  try {
    const value = await fn();
    await sql`RELEASE SAVEPOINT ${name}`.execute(tx.db);
    return { ok: true, value };
  } catch (error) {
    await sql`ROLLBACK TO SAVEPOINT ${name}`.execute(tx.db);
    await engineFor(tx).finalize();
    tx.memo.delete('value-engine');
    return { ok: false, error };
  }
}

/** Executes the strategies of one row that are still planned (`pending`); `done` holds earlier results. */
export async function executeRow(
  tx: Tx,
  compiled: CompiledMapping,
  resolver: Resolver,
  cells: string[],
  pending: Set<number>,
  done: Map<number, { status: string; entityInstanceIds: string[]; failureReason: string | null }>,
): Promise<Map<number, ExecutedNode>> {
  const lookups = dbLookups(tx);
  const results = new Map<number, ExecutedNode>();
  const outcomeOf = (node: StrategyNode): NodeOutcome => {
    const executed = results.get(node.index);
    if (executed) return executed;
    const prior = done.get(node.index);
    const status = prior?.status ?? 'skipped';
    return {
      node,
      outcome:
        status === 'failed' ? 'fail' : status === 'created' ? 'create' : status === 'updated' ? 'update' : 'skip',
      instanceIds: prior?.entityInstanceIds ?? [],
      matchedIds: [],
      failureReason: (prior?.failureReason as ImportFailureReason | null) ?? null,
      pendingCreate: false,
    };
  };
  for (const node of [...compiled.nodes].sort((a, b) => b.index - a.index)) {
    if (!pending.has(node.index)) continue;
    const rv = nodeRowValues(resolver, node, cells);
    const children = node.children.map(outcomeOf);
    const d = await decide(node, rv, children, lookups);
    const { reason } = summarize(d.items, d.failure);
    if (d.failure || d.items.length === 0) {
      results.set(node.index, {
        node,
        outcome: d.failure ? 'fail' : 'skip',
        status: d.failure ? 'failed' : 'skipped',
        instanceIds: [],
        matchedIds: d.matched,
        failureReason: d.failure,
        pendingCreate: false,
      });
      continue;
    }
    const written: string[] = [];
    let created = false;
    let firstFailure: ImportFailureReason | null = reason;
    for (const item of d.items) {
      if (item.action === 'fail') continue;
      const res = await withSavepoint(tx, () => writeItem(tx, node, item, rv, d.links));
      if (res.ok) {
        written.push(res.value);
        if (item.action === 'create') created = true;
      } else firstFailure ??= failureReasonOf(res.error);
    }
    const status = written.length === 0 ? 'failed' : created ? 'created' : 'updated';
    results.set(node.index, {
      node,
      outcome: status === 'failed' ? 'fail' : status === 'created' ? 'create' : 'update',
      status,
      instanceIds: written,
      matchedIds: d.matched,
      failureReason: status === 'failed' ? (firstFailure ?? 'unknown-error') : firstFailure,
      pendingCreate: false,
    });
  }
  return results;
}

export function failureMessage(reason: string | null): string | null {
  return reason
    ? (importFailureMessages[reason as ImportFailureReason] ?? importFailureMessages['unknown-error'])
    : null;
}
