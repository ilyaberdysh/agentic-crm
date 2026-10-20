// Views (table | kanban) with one filter (predicate AST), sorts and columns; query snapshots ("MRL"): ordered id lists
// of (filter, sorts) materialised as 1000-id chunks; chunk paging; zebra selections; aggregates (A §4.10,
// internal-api-shapes §3, C1 §4–8, S1 §8.4).

import { createHash } from 'node:crypto';
import {
  type AddColumnInput,
  type AggregateInput,
  type AggregateOutput,
  addColumnInputSchema,
  aggregateInputSchema,
  type ColumnInput,
  type CreateViewInput,
  createViewInputSchema,
  isValidZebra,
  type KanbanCalculation,
  type KanbanConfigInput,
  type ListViewsInput,
  listViewsInputSchema,
  type Path,
  type Predicate,
  type QuerySnapshotInput,
  type QuerySnapshotOutput,
  querySnapshotInputSchema,
  type RemoveColumnInput,
  type ResolveSelectionInput,
  type ResolveSelectionOutput,
  rankAfter,
  rankSequence,
  removeColumnInputSchema,
  resolveSelectionInputSchema,
  type SetViewFilterInput,
  type SetViewSortsInput,
  type SnapshotChunkInput,
  type SnapshotChunkOutput,
  type Sort,
  setViewFilterInputSchema,
  setViewSortsInputSchema,
  snapshotChunkInputSchema,
  type UpdateColumnInput,
  type UpdateViewInput,
  updateColumnInputSchema,
  updateViewInputSchema,
  type View,
  type ViewColumn,
  zebraClamp,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { assertWithinLimit } from '../limits.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { aggregateSnapshot } from './aggregate.ts';
import { compileQuery } from './compiler.ts';
import { hasHistoryLeaf, resolvePredicate, walkPath } from './resolve.ts';

export const CHUNK_SIZE = 1000;
/** Snapshots stay resolvable for a working day (selections and bulk actions refer to them). */
export const SNAPSHOT_TTL_HOURS = 24;

export interface ViewSpec {
  id?: string;
  type: 'table' | 'kanban';
  title: string;
  sortOrder?: string;
  filter?: Predicate | null;
  sorts?: (Sort & { id?: string })[];
  columns?: ColumnInput[];
  kanbanPivotPath?: Path | null;
  kanban?: KanbanConfigInput;
  tableRecordColumnWidth?: number | null;
}

/** Columns, sorts and aggregates: the path starts at this object and every hop is valid (≤ 5 hops). */
async function validatePath(tx: Tx, def: DefInfo, path: Path): Promise<void> {
  const first = path[0];
  if (!first || first.entityDefinitionId !== def.id || !def.byId.has(first.attributeDefinitionId)) {
    throw badRequest('VALIDATION_ERROR', 'Attribute path must start at an attribute of this object');
  }
  try {
    await walkPath(tx, def, path);
  } catch (err) {
    if ((err as { code?: string }).code === 'UNSUPPORTED_FILTER') {
      throw badRequest('VALIDATION_ERROR', (err as Error).message);
    }
    throw err;
  }
}

/** Resolves and compiles the filter and sorts once, so invalid views are rejected at write time. */
async function validateQuery(tx: Tx, def: DefInfo, filter: Predicate | null, sorts: Sort[]): Promise<void> {
  const resolved = await resolvePredicate(tx, def, filter, {
    now: tx.now,
    timeZone: 'UTC',
    memberId: actingMemberId(tx.ctx),
  });
  await compileQuery(tx, def, resolved, sorts);
}

/**
 * A kanban grouping path (C2 kanban K1/K4): starts at the view's object, may traverse record references (a list's
 * `parent_record`), and ends at a single-value status or select attribute. Returns that attribute.
 */
export async function validateGroupBy(tx: Tx, def: DefInfo, path: Path): Promise<AttrDef> {
  await validatePath(tx, def, path);
  const { attrs } = await walkPath(tx, def, path);
  const leaf = attrs[attrs.length - 1] as AttrDef;
  if ((leaf.type !== 'pipeline' && leaf.type !== 'select') || leaf.isMultiselect || leaf.isArchived) {
    throw badRequest('VALIDATION_ERROR', 'A kanban view needs a status or select attribute to group by', {
      attribute_definition_id: leaf.id,
    });
  }
  return leaf;
}

const NUMERIC_TYPES = new Set(['number', 'currency', 'rating']);
const TEMPORAL_TYPES = new Set(['date', 'timestamp']);

/** The board calculation (K7): count/percent kinds on any attribute, sum/mean numeric, min/max numeric or dates. */
async function validateCalculation(tx: Tx, def: DefInfo, calc: KanbanCalculation): Promise<void> {
  await validatePath(tx, def, calc.path);
  const { attrs } = await walkPath(tx, def, calc.path);
  const leaf = attrs[attrs.length - 1] as AttrDef;
  const numeric = NUMERIC_TYPES.has(leaf.type) && !leaf.isMultiselect;
  const temporal = TEMPORAL_TYPES.has(leaf.type) && !leaf.isMultiselect;
  const ok =
    calc.aggregation === 'sum' || calc.aggregation === 'mean'
      ? numeric
      : calc.aggregation === 'min' || calc.aggregation === 'max'
        ? numeric || temporal
        : true;
  if (!ok) {
    throw badRequest('VALIDATION_ERROR', `"${calc.aggregation}" cannot be calculated on "${leaf.apiSlug}"`, {
      attribute_definition_id: leaf.id,
    });
  }
}

/** Inserts a view with its filter, sorts and columns (used by the service and by workspace bootstrap). */
export async function insertView(tx: Tx, def: DefInfo, spec: ViewSpec): Promise<string> {
  const id = spec.id ?? newId();
  const filter = spec.filter ?? null;
  const sorts = spec.sorts ?? [];
  const views = await tx.db
    .selectFrom('entity_views')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('entity_definition_id', '=', def.id)
    .executeTakeFirst();
  await assertWithinLimit(tx, 'views_per_object_hard', Number(views?.n ?? 0), 1, { entity_definition_id: def.id });
  await validateQuery(tx, def, filter, sorts);
  const kanban = spec.kanban ?? {};
  const pivot = kanban.groupBy ?? spec.kanbanPivotPath ?? null;
  if (spec.type === 'kanban') {
    if (!pivot) throw badRequest('VALIDATION_ERROR', 'A kanban view needs a status or select attribute to group by');
    await validateGroupBy(tx, def, pivot);
    if (kanban.calculation) await validateCalculation(tx, def, kanban.calculation);
  } else if (spec.kanban && Object.keys(spec.kanban).length > 0) {
    throw badRequest('VALIDATION_ERROR', 'Only kanban views have kanban settings');
  }
  const filterId = newId();
  await tx.db
    .insertInto('entity_filters')
    .values({
      id: filterId,
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      parent_type: 'entity-view',
      predicate: jsonb(filter),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  const last = (
    await tx.db
      .selectFrom('entity_views')
      .select((eb) => eb.fn.max('sort_order').as('m'))
      .where('entity_definition_id', '=', def.id)
      .executeTakeFirst()
  )?.m;
  await tx.db
    .insertInto('entity_views')
    .values({
      id,
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      type: spec.type,
      title: spec.title,
      sort_order: spec.sortOrder ?? rankAfter(last ?? null),
      entity_filter_id: filterId,
      kanban_pivot_path: jsonb(pivot),
      // Defaults on create (C2 kanban K1): icon labels, No stage column and time-in-stage chip visible.
      kanban_attribute_label_display_mode: spec.type === 'kanban' ? (kanban.showLabels ? 'text' : 'icon') : null,
      kanban_is_no_status_visible: spec.type === 'kanban' ? (kanban.showNoStage ?? true) : null,
      kanban_is_time_in_status_visible: spec.type === 'kanban' ? (kanban.showTimeInStage ?? true) : null,
      kanban_aggregation: jsonb(spec.type === 'kanban' ? (kanban.calculation ?? null) : null),
      kanban_hidden_stage_ids: kanban.hiddenStageIds ?? [],
      table_record_column_width: spec.tableRecordColumnWidth ?? null,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  await replaceSorts(tx, def, id, sorts);
  let lastColumn: string | null = null;
  const columns: ColumnInput[] = spec.columns?.length
    ? spec.columns
    : (kanban.cardAttributePaths?.map((path) => ({ path })) ?? []);
  for (const column of columns) {
    lastColumn = column.sortOrder ?? rankAfter(lastColumn);
    await insertColumn(tx, def, id, { ...column, sortOrder: lastColumn });
  }
  tx.emit('entity-view', id, { entityDefinitionId: def.id });
  tx.emit('entity-view-list', def.id, { entityDefinitionId: def.id });
  return id;
}

async function insertColumn(
  tx: Tx,
  def: DefInfo,
  viewId: string,
  column: ColumnInput & { id?: string },
): Promise<string> {
  await validatePath(tx, def, column.path);
  const id = column.id ?? newId();
  let sortOrder = column.sortOrder;
  if (!sortOrder) {
    const last = await tx.db
      .selectFrom('entity_view_attributes')
      .select((eb) => eb.fn.max('sort_order').as('m'))
      .where('entity_view_id', '=', viewId)
      .executeTakeFirst();
    sortOrder = rankAfter(last?.m ?? null);
  }
  await tx.db
    .insertInto('entity_view_attributes')
    .values({
      id,
      workspace_id: tx.workspaceId,
      entity_view_id: viewId,
      sort_order: sortOrder,
      path: jsonb(column.path),
      field: column.field ?? null,
      title: column.title ?? null,
      table_column_width: column.tableColumnWidth ?? null,
      table_column_aggregation_type: column.tableColumnAggregationType ?? null,
      display_configuration: jsonb(column.displayConfiguration ?? {}),
      created_at: tx.now,
    })
    .execute();
  return id;
}

async function replaceSorts(tx: Tx, def: DefInfo, viewId: string, sorts: (Sort & { id?: string })[]): Promise<void> {
  await tx.db.deleteFrom('entity_view_sorts').where('entity_view_id', '=', viewId).execute();
  let last: string | null = null;
  for (const s of sorts) {
    await validatePath(tx, def, s.path);
    last = rankAfter(last);
    await tx.db
      .insertInto('entity_view_sorts')
      .values({
        id: s.id ?? newId(),
        workspace_id: tx.workspaceId,
        entity_view_id: viewId,
        sort_order: last,
        path: jsonb(s.path),
        field: s.field ?? null,
        direction: s.direction,
        created_at: tx.now,
      })
      .execute();
  }
}

async function loadViews(
  tx: Tx,
  where: { viewId?: string; entityDefinitionId?: string; includeArchived?: boolean },
): Promise<View[]> {
  const views = await tx.db
    .selectFrom('entity_views as v')
    .innerJoin('entity_filters as f', 'f.id', 'v.entity_filter_id')
    .selectAll('v')
    .select('f.predicate')
    .$if(where.viewId !== undefined, (q) => q.where('v.id', '=', where.viewId as string))
    .$if(where.entityDefinitionId !== undefined, (q) =>
      q.where('v.entity_definition_id', '=', where.entityDefinitionId as string),
    )
    .$if(!where.includeArchived && where.viewId === undefined, (q) => q.where('v.is_archived', '=', false))
    .orderBy('v.sort_order')
    .execute();
  if (views.length === 0) return [];
  const ids = views.map((v) => v.id);
  const [columns, sorts] = await Promise.all([
    tx.db
      .selectFrom('entity_view_attributes')
      .selectAll()
      .where('entity_view_id', 'in', ids)
      .orderBy('sort_order')
      .execute(),
    tx.db
      .selectFrom('entity_view_sorts')
      .selectAll()
      .where('entity_view_id', 'in', ids)
      .orderBy('sort_order')
      .execute(),
  ]);
  return views.map((v) => ({
    id: v.id,
    workspaceId: v.workspace_id,
    entityDefinitionId: v.entity_definition_id,
    type: v.type,
    title: v.title,
    sortOrder: v.sort_order,
    entityFilterId: v.entity_filter_id,
    filter: (v.predicate ?? null) as Predicate | null,
    sorts: sorts
      .filter((s) => s.entity_view_id === v.id)
      .map((s) => ({
        id: s.id,
        sortOrder: s.sort_order,
        path: s.path as Path,
        ...(s.field ? { field: s.field } : {}),
        direction: s.direction,
      })),
    columns: columns
      .filter((c) => c.entity_view_id === v.id)
      .map(
        (c): ViewColumn => ({
          id: c.id,
          sortOrder: c.sort_order,
          path: c.path as Path,
          field: c.field,
          title: c.title,
          tableColumnWidth: c.table_column_width,
          tableColumnAggregationType: c.table_column_aggregation_type as ViewColumn['tableColumnAggregationType'],
          displayConfiguration: (c.display_configuration ?? {}) as Record<string, unknown>,
        }),
      ),
    kanbanPivotPath: (v.kanban_pivot_path ?? null) as Path | null,
    kanbanIsNoStatusVisible: v.kanban_is_no_status_visible,
    kanbanIsTimeInStatusVisible: v.kanban_is_time_in_status_visible,
    kanban:
      v.type === 'kanban'
        ? {
            groupBy: (v.kanban_pivot_path ?? null) as Path | null,
            hiddenStageIds: v.kanban_hidden_stage_ids ?? [],
            cardAttributePaths: columns.filter((c) => c.entity_view_id === v.id).map((c) => c.path as Path),
            showLabels: v.kanban_attribute_label_display_mode === 'text',
            showNoStage: v.kanban_is_no_status_visible ?? true,
            showTimeInStage: v.kanban_is_time_in_status_visible ?? true,
            calculation: (v.kanban_aggregation ?? null) as KanbanCalculation | null,
          }
        : null,
    tableRecordColumnWidth: v.table_record_column_width,
    isArchived: v.is_archived,
    createdBy: v.created_by as View['createdBy'],
    createdAt: v.created_at,
  }));
}

/**
 * Kanban card rows (K4 "Visible attributes"): the view's columns become exactly `paths`, in order. Columns whose path
 * is kept keep their id and settings (label, formatting); the others are removed.
 */
async function replaceColumnsByPaths(tx: Tx, def: DefInfo, view: View, paths: Path[]): Promise<void> {
  const key = (p: Path) => JSON.stringify(p.map((h) => [h.entityDefinitionId, h.attributeDefinitionId]));
  const unused = [...view.columns];
  const ranks = rankSequence(paths.length);
  for (const [i, path] of paths.entries()) {
    const at = unused.findIndex((c) => key(c.path) === key(path));
    const rank = ranks[i] as string;
    if (at >= 0) {
      const [kept] = unused.splice(at, 1);
      await tx.db
        .updateTable('entity_view_attributes')
        .set({ sort_order: rank })
        .where('id', '=', (kept as ViewColumn).id)
        .execute();
    } else {
      await insertColumn(tx, def, view.id, { path, sortOrder: rank });
    }
  }
  if (unused.length > 0) {
    await tx.db
      .deleteFrom('entity_view_attributes')
      .where(
        'id',
        'in',
        unused.map((c) => c.id),
      )
      .execute();
  }
}

async function requireView(tx: Tx, viewId: string): Promise<View> {
  const [view] = await loadViews(tx, { viewId });
  if (!view) throw notFound('The requested view could not be found', { entity_view_id: viewId });
  return view;
}

function touchView(tx: Tx, view: View): void {
  tx.emit('entity-view', view.id, { entityDefinitionId: view.entityDefinitionId });
  tx.emit('entity-view-list', view.entityDefinitionId, { entityDefinitionId: view.entityDefinitionId });
}

type SnapshotRow = { id: string; entity_definition_id: string; predicate: unknown; total: number; accurate_at: string };

async function requireSnapshot(tx: Tx, snapshotId: string): Promise<SnapshotRow> {
  const row = await tx.db
    .selectFrom('list_snapshots')
    .select(['id', 'entity_definition_id', 'predicate', 'total', 'accurate_at'])
    .where('id', '=', snapshotId)
    .where('expires_at', '>', tx.now)
    .executeTakeFirst();
  if (!row)
    throw notFound('The snapshot has expired or does not exist', { snapshot_id: snapshotId }, 'SNAPSHOT_NOT_FOUND');
  return row;
}

/** Ids at snapshot indices [start, start + size). */
async function idsInRange(tx: Tx, snapshotId: string, start: number, size: number): Promise<string[]> {
  if (size <= 0) return [];
  const firstChunk = Math.floor(start / CHUNK_SIZE);
  const lastChunk = Math.floor((start + size - 1) / CHUNK_SIZE);
  const chunks = await tx.db
    .selectFrom('list_snapshot_chunks')
    .select(['chunk_no', 'ids'])
    .where('snapshot_id', '=', snapshotId)
    .where('chunk_no', '>=', firstChunk)
    .where('chunk_no', '<=', lastChunk)
    .orderBy('chunk_no')
    .execute();
  const ids = chunks.flatMap((c) => c.ids);
  const offset = start - firstChunk * CHUNK_SIZE;
  return ids.slice(offset, offset + size);
}

export const viewOps = {
  async list(tx: Tx, input: ListViewsInput): Promise<View[]> {
    const data = listViewsInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    return loadViews(tx, { entityDefinitionId: def.id, includeArchived: data.includeArchived });
  },

  async get(tx: Tx, viewId: string): Promise<View> {
    return requireView(tx, viewId);
  },

  /** PUT create (idempotent per id). */
  async create(tx: Tx, input: CreateViewInput): Promise<View> {
    const data = createViewInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const existing = await tx.db.selectFrom('entity_views').select('id').where('id', '=', data.id).executeTakeFirst();
    if (existing) return requireView(tx, data.id);
    await insertView(tx, def, {
      id: data.id,
      type: data.type,
      title: data.title,
      ...(data.sortOrder ? { sortOrder: data.sortOrder } : {}),
      filter: data.filter ?? null,
      sorts: data.sorts ?? [],
      columns: data.columns ?? [],
      kanbanPivotPath: data.kanbanPivotPath ?? null,
      ...(data.kanban ? { kanban: data.kanban } : {}),
      tableRecordColumnWidth: data.tableRecordColumnWidth ?? null,
    });
    return requireView(tx, data.id);
  },

  async update(tx: Tx, input: UpdateViewInput): Promise<View> {
    const data = updateViewInputSchema.parse(input);
    const view = await requireView(tx, data.viewId);
    const def = await loadDefinition(tx, view.entityDefinitionId);
    const k = data.kanban ?? {};
    if (view.type !== 'kanban' && Object.keys(k).length > 0) {
      throw badRequest('VALIDATION_ERROR', 'Only kanban views have kanban settings');
    }
    const pivot = k.groupBy !== undefined ? k.groupBy : data.kanbanPivotPath;
    if (view.type === 'kanban' && pivot !== undefined) {
      if (pivot === null) throw badRequest('VALIDATION_ERROR', 'A kanban view needs a status or select attribute');
      await validateGroupBy(tx, def, pivot);
    }
    if (k.calculation) await validateCalculation(tx, def, k.calculation);
    const showNoStage = k.showNoStage ?? data.kanbanIsNoStatusVisible;
    const showTimeInStage = k.showTimeInStage ?? data.kanbanIsTimeInStatusVisible;
    await tx.db
      .updateTable('entity_views')
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
        ...(pivot !== undefined ? { kanban_pivot_path: jsonb(pivot) } : {}),
        ...(showNoStage !== undefined ? { kanban_is_no_status_visible: showNoStage } : {}),
        ...(showTimeInStage !== undefined ? { kanban_is_time_in_status_visible: showTimeInStage } : {}),
        ...(k.showLabels !== undefined
          ? { kanban_attribute_label_display_mode: k.showLabels ? ('text' as const) : ('icon' as const) }
          : {}),
        ...(k.hiddenStageIds !== undefined ? { kanban_hidden_stage_ids: [...new Set(k.hiddenStageIds)] } : {}),
        ...(k.calculation !== undefined ? { kanban_aggregation: jsonb(k.calculation) } : {}),
        ...(data.tableRecordColumnWidth !== undefined
          ? { table_record_column_width: data.tableRecordColumnWidth }
          : {}),
        ...(data.isArchived !== undefined ? { is_archived: data.isArchived } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', view.id)
      .execute();
    if (k.cardAttributePaths !== undefined) await replaceColumnsByPaths(tx, def, view, k.cardAttributePaths);
    touchView(tx, view);
    return requireView(tx, view.id);
  },

  async delete(tx: Tx, viewId: string): Promise<{ id: string }> {
    const view = await requireView(tx, viewId);
    await tx.db.deleteFrom('entity_views').where('id', '=', view.id).execute();
    await tx.db.deleteFrom('entity_filters').where('id', '=', view.entityFilterId).execute();
    touchView(tx, view);
    return { id: view.id };
  },

  /** "Save for everyone": replaces the whole filter. */
  async setFilter(tx: Tx, input: SetViewFilterInput): Promise<View> {
    const data = setViewFilterInputSchema.parse(input);
    const view = await requireView(tx, data.viewId);
    const def = await loadDefinition(tx, view.entityDefinitionId);
    await validateQuery(tx, def, data.filter, []);
    await tx.db
      .updateTable('entity_filters')
      .set({ predicate: jsonb(data.filter), updated_at: tx.now })
      .where('id', '=', view.entityFilterId)
      .execute();
    touchView(tx, view);
    return requireView(tx, view.id);
  },

  /** Full-array replace of the sorts. */
  async setSorts(tx: Tx, input: SetViewSortsInput): Promise<View> {
    const data = setViewSortsInputSchema.parse(input);
    const view = await requireView(tx, data.viewId);
    const def = await loadDefinition(tx, view.entityDefinitionId);
    await validateQuery(tx, def, null, data.sorts);
    await replaceSorts(tx, def, view.id, data.sorts);
    touchView(tx, view);
    return requireView(tx, view.id);
  },

  async addColumn(tx: Tx, input: AddColumnInput): Promise<View> {
    const data = addColumnInputSchema.parse(input);
    const view = await requireView(tx, data.viewId);
    if (!view.columns.some((c) => c.id === data.id)) {
      await insertColumn(tx, await loadDefinition(tx, view.entityDefinitionId), view.id, data);
      touchView(tx, view);
    }
    return requireView(tx, view.id);
  },

  async updateColumn(tx: Tx, input: UpdateColumnInput): Promise<View> {
    const data = updateColumnInputSchema.parse(input);
    const view = await requireView(tx, data.viewId);
    if (!view.columns.some((c) => c.id === data.columnId)) throw notFound('The requested column could not be found');
    await tx.db
      .updateTable('entity_view_attributes')
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.tableColumnWidth !== undefined ? { table_column_width: data.tableColumnWidth } : {}),
        ...(data.tableColumnAggregationType !== undefined
          ? { table_column_aggregation_type: data.tableColumnAggregationType }
          : {}),
        ...(data.displayConfiguration !== undefined ? { display_configuration: jsonb(data.displayConfiguration) } : {}),
        ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
      })
      .where('id', '=', data.columnId)
      .execute();
    touchView(tx, view);
    return requireView(tx, view.id);
  },

  async removeColumn(tx: Tx, input: RemoveColumnInput): Promise<View> {
    const data = removeColumnInputSchema.parse(input);
    const view = await requireView(tx, data.viewId);
    await tx.db
      .deleteFrom('entity_view_attributes')
      .where('id', '=', data.columnId)
      .where('entity_view_id', '=', view.id)
      .execute();
    touchView(tx, view);
    return requireView(tx, view.id);
  },

  /** Materialises (filter, sorts) as a snapshot; returns the total and the requested range (default first 1000). */
  async query(tx: Tx, input: QuerySnapshotInput): Promise<QuerySnapshotOutput> {
    const data = querySnapshotInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    let filter: Predicate | null = data.filter ?? null;
    let sorts: Sort[] = data.sorts ?? [];
    if (data.viewId) {
      const view = await requireView(tx, data.viewId);
      if (view.entityDefinitionId !== def.id)
        throw badRequest('VALIDATION_ERROR', 'The view belongs to another object');
      if (data.filter === undefined) filter = view.filter;
      if (data.sorts === undefined)
        sorts = view.sorts.map(({ path, field, direction }) => ({ path, direction, ...(field ? { field } : {}) }));
    }
    // Dynamic values (relative dates, current member) are fixed now; the snapshot keeps the resolved predicate so
    // aggregates and selections refer to exactly these rows.
    const resolved = await resolvePredicate(tx, def, filter, {
      now: tx.now,
      timeZone: data.timeZone ?? 'UTC',
      memberId: actingMemberId(tx.ctx),
    });
    const query = await compileQuery(tx, def, resolved, sorts);
    const snapshotId = newId();
    // History leaves (status "was") semi-join attribute_values: hash joins, not nested loops (S1 rule 7).
    const history = hasHistoryLeaf(resolved);
    if (history) await sql`SET LOCAL enable_nestloop = off`.execute(tx.db);
    const { rows } = await sql<{ total: number; first_chunk: string[] }>`
      SELECT total, first_chunk FROM snapshot_create(${snapshotId}::uuid, ${tx.workspaceId}::uuid, ${query}, ${CHUNK_SIZE})`.execute(
      tx.db,
    );
    if (history) await sql`SET LOCAL enable_nestloop = on`.execute(tx.db);
    const created = rows[0] as { total: number; first_chunk: string[] };
    await tx.db
      .insertInto('list_snapshots')
      .values({
        id: snapshotId,
        workspace_id: tx.workspaceId,
        entity_definition_id: def.id,
        query_hash: createHash('sha256')
          .update(JSON.stringify({ def: def.id, filter: resolved, sorts }))
          .digest('hex'),
        predicate: jsonb(resolved),
        sorts: jsonb(sorts),
        total: created.total,
        accurate_at: tx.now,
        expires_at: sql<string>`${tx.now}::timestamptz + make_interval(hours => ${SNAPSHOT_TTL_HOURS})`,
      })
      .execute();
    const { start, size } = data.initialRange;
    const ids =
      start === 0 && size <= CHUNK_SIZE
        ? created.first_chunk.slice(0, size)
        : await idsInRange(tx, snapshotId, start, size);
    return { snapshotId, entityDefinitionId: def.id, total: created.total, ids, start, accurateAt: tx.now };
  },

  /** Ids at [start, start + size) of a snapshot. */
  async chunk(tx: Tx, input: SnapshotChunkInput): Promise<SnapshotChunkOutput> {
    const data = snapshotChunkInputSchema.parse(input);
    const snap = await requireSnapshot(tx, data.snapshotId);
    return {
      snapshotId: snap.id,
      entityDefinitionId: snap.entity_definition_id,
      total: snap.total,
      ids: await idsInRange(tx, snap.id, data.start, data.size),
      start: data.start,
      accurateAt: snap.accurate_at,
    };
  },

  /** Resolves zebra edges over snapshot indices to ids (in snapshot order). */
  async resolveSelection(tx: Tx, input: ResolveSelectionInput): Promise<ResolveSelectionOutput> {
    const data = resolveSelectionInputSchema.parse(input);
    if (!isValidZebra(data.zebraEdges))
      throw badRequest('VALIDATION_ERROR', 'Selection edges must be sorted, increasing pairs');
    const snap = await requireSnapshot(tx, data.snapshotId);
    const edges = zebraClamp(data.zebraEdges, snap.total);
    const ids: string[] = [];
    for (let i = 0; i < edges.length; i += 2) {
      const s = edges[i] as number;
      ids.push(...(await idsInRange(tx, snap.id, s, (edges[i + 1] as number) - s)));
    }
    return { ids, total: snap.total };
  },

  /** Column aggregation: re-evaluates the snapshot's resolved filter on the projection (S1 rule 6). */
  async aggregate(tx: Tx, input: AggregateInput): Promise<AggregateOutput> {
    const data = aggregateInputSchema.parse(input);
    const snap = await requireSnapshot(tx, data.snapshotId);
    const def = await loadDefinition(tx, snap.entity_definition_id);
    await validatePath(tx, def, data.path);
    const result = await aggregateSnapshot(tx, def, (snap.predicate ?? null) as Predicate | null, {
      path: data.path,
      field: data.field,
      aggregation: data.aggregation,
    });
    return { ...result, accurateAt: tx.now };
  },

  /** Deletes expired snapshots of the workspace (slice-1 cleanup; see migration 0300 for the production plan). */
  async purgeExpired(tx: Tx): Promise<number> {
    const expired = await tx.db.selectFrom('list_snapshots').select('id').where('expires_at', '<=', tx.now).execute();
    if (expired.length === 0) return 0;
    const ids = expired.map((e) => e.id);
    await tx.db.deleteFrom('list_snapshot_chunks').where('snapshot_id', 'in', ids).execute();
    await tx.db.deleteFrom('list_snapshots').where('id', 'in', ids).execute();
    return ids.length;
  },
};
