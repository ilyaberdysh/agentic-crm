// Views, the predicate AST, sorts and query snapshots (A §4.10, C1 filters-sorts-calcs §3–7,
// internal-api-shapes §3, CROSS-DOMAIN X-20 / B.5 / B.6).
import { z } from 'zod';
import {
  acceptAfterSchema,
  actorSchema,
  idOrSlugSchema,
  pathSchema,
  rankSchema,
  timestampSchema,
  uuidSchema,
} from './common.ts';

// ---------------------------------------------------------------------------------------------------------------
// One predicate AST: groups `{and}` / `{or}` and leaves
// `{path, mode, constraints}`. A `must` leaf matches when some current value at `path` satisfies all constraints;
// `must-not` when none does. A leaf without effective constraints means "has a value" (must) / "is empty" (must-not)
// — for ratings 0 counts as empty (C1 filters-sorts-calcs §3). Groups nest to any depth (the UI shows one nested
// level); paths traverse record references up to five hops.
// Dynamic values are resolved by the server at query time (snapshots.query `timeZone`, default UTC):
//   • ISO-8601 durations relative to now for dates and timestamps ('-P30D' = 30 days ago, 'P0D' = today): a date
//     resolves to the local calendar date, a timestamp to the instant floored to the local hour; `eq` on a timestamp
//     means the whole local day. Static 'YYYY-MM-DD' values on timestamps also compare by local day.
//   • 'current-member' for actor references and interaction owners.
// History leaves (`history: true`) match against every value the attribute ever had (current and retired), so
// status "was" / "was not" are `{history: true, constraints: [{field: 'pipeline_stage_id', operator: 'eq', value},
// {field: 'active_from', operator: 'lt' | 'gt', value}]}` with mode must / must-not. The stored view-filter blocks
// and workflow binary predicates are serialisations of this AST. The UI's sentence table is filter-sentences.ts.

export const filterOperators = [
  'eq',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'not-empty',
  'starts-with',
  'ends-with',
  'contains',
  'in',
  /** Multi-value attributes: the values include every listed value (`value` is an array). */
  'all',
] as const;
export const filterOperatorSchema = z.enum(filterOperators);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const constraintSchema = z.object({
  /** Queryable field of the attribute type, e.g. 'value', 'select_option_id', 'country_code', 'active_until'. */
  field: z.string().min(1).max(64),
  operator: filterOperatorSchema,
  value: z.unknown().optional(),
  valueType: z.enum(['static', 'dynamic']).default('static'),
});
export type Constraint = z.input<typeof constraintSchema>;

export type PredicateLeaf = {
  path: z.infer<typeof pathSchema>;
  mode: 'must' | 'must-not';
  constraints: Constraint[];
  /**
   * Evaluate over the attribute's whole value history instead of its current values (status "was"/"was not").
   * Status, select, record and actor references only. Fields: the id field, `lifecycle_phase` (status),
   * `active_from`, `active_until`.
   */
  history?: boolean;
};
export type Predicate = { and: Predicate[] } | { or: Predicate[] } | PredicateLeaf;

export const predicateLeafSchema = z.object({
  path: pathSchema,
  mode: z.enum(['must', 'must-not']),
  constraints: z.array(constraintSchema).max(10),
  history: z.boolean().optional(),
});

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(predicateSchema).max(100) }),
    z.object({ or: z.array(predicateSchema).max(100) }),
    predicateLeafSchema,
  ]),
) as z.ZodType<Predicate>;

/**
 * One sort. Multi-hop paths sort by an attribute of the (first) referenced record. Empty values sort last in both
 * directions; statuses and selects sort by option order, checkboxes unchecked first, actors by member name, text by
 * its normalised key (case- and accent-insensitive). Ties fall back to record id (creation order).
 */
export const sortSchema = z.object({
  path: pathSchema,
  /** Sort field of the attribute type, e.g. 'value', 'stage_sort_order', 'active_from', 'last_name'. */
  field: z.string().min(1).max(64).optional(),
  direction: z.enum(['asc', 'desc']),
});
export type Sort = z.infer<typeof sortSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Views

export const viewTypeSchema = z.enum(['table', 'kanban']);
export const columnAggregationSchema = z.enum([
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'mean',
  'max',
  'min',
]);

export const viewColumnSchema = z.object({
  id: uuidSchema,
  sortOrder: z.string(),
  path: pathSchema,
  field: z.string().nullable(),
  title: z.string().nullable(),
  tableColumnWidth: z.number().int().nullable(),
  tableColumnAggregationType: columnAggregationSchema.nullable(),
  displayConfiguration: z.record(z.string(), z.unknown()),
});
export type ViewColumn = z.infer<typeof viewColumnSchema>;

export const viewSortSchema = sortSchema.extend({ id: uuidSchema, sortOrder: z.string() });
export type ViewSort = z.infer<typeof viewSortSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Kanban configuration (C2 kanban K1–K7; A §4.10 kanban_* fields). One board-wide calculation (K7) whose count and
// percent kinds follow the table rule (X-23: computed from total and filled rows, percent rounded to 2 decimals).

export const kanbanCalculationKinds = [
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'mean',
  'max',
  'min',
] as const;
export const kanbanCalculationSchema = z.object({
  /** Path from the view's object (multi-hop through parent_record allowed: "Parent Record › Deal value"). */
  path: pathSchema,
  field: z.string().max(64).nullable().optional(),
  aggregation: z.enum(kanbanCalculationKinds),
});
export type KanbanCalculation = z.infer<typeof kanbanCalculationSchema>;

/**
 * Kanban settings of a view. `groupBy` is the status or (single) select attribute the columns come from: own
 * (`[list.stage]`) or through `parent_record` (`[list.parent_record, deals.stage]`). `cardAttributePaths` are the
 * view's columns (card rows), in order. Collapsed stages / card display mode are per-browser (client-only).
 */
export const kanbanConfigSchema = z.object({
  groupBy: pathSchema.nullable(),
  /** Stages hidden on this view ("Hide stage", Visible columns). */
  hiddenStageIds: z.array(uuidSchema),
  cardAttributePaths: z.array(pathSchema),
  /** "Show attribute labels" display mode: `text`; off = `icon`. */
  showLabels: z.boolean(),
  /** The "No stage" column (Visible columns → No status). */
  showNoStage: z.boolean(),
  /** The time-in-stage chip on cards. */
  showTimeInStage: z.boolean(),
  calculation: kanbanCalculationSchema.nullable(),
});
export type KanbanConfig = z.infer<typeof kanbanConfigSchema>;

/** Partial kanban settings for views.create / views.update; `cardAttributePaths` replaces the view's columns. */
export const kanbanConfigInputSchema = z.object({
  groupBy: pathSchema.optional(),
  hiddenStageIds: z.array(uuidSchema).max(500).optional(),
  cardAttributePaths: z.array(pathSchema).max(100).optional(),
  showLabels: z.boolean().optional(),
  showNoStage: z.boolean().optional(),
  showTimeInStage: z.boolean().optional(),
  calculation: kanbanCalculationSchema.nullable().optional(),
});
export type KanbanConfigInput = z.input<typeof kanbanConfigInputSchema>;

export const viewSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  type: viewTypeSchema,
  title: z.string(),
  sortOrder: z.string(),
  entityFilterId: uuidSchema,
  filter: predicateSchema.nullable(),
  sorts: z.array(viewSortSchema),
  columns: z.array(viewColumnSchema),
  kanbanPivotPath: pathSchema.nullable(),
  kanbanIsNoStatusVisible: z.boolean().nullable(),
  kanbanIsTimeInStatusVisible: z.boolean().nullable(),
  /** Kanban settings (null for table views). */
  kanban: kanbanConfigSchema.nullable(),
  tableRecordColumnWidth: z.number().int().nullable(),
  isArchived: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type View = z.infer<typeof viewSchema>;

export const columnInputSchema = z.object({
  id: uuidSchema.optional(),
  path: pathSchema,
  field: z.string().max(64).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  tableColumnWidth: z.number().int().min(40).max(2000).nullable().optional(),
  tableColumnAggregationType: columnAggregationSchema.nullable().optional(),
  displayConfiguration: z.record(z.string(), z.unknown()).optional(),
  sortOrder: rankSchema.optional(),
});
export type ColumnInput = z.input<typeof columnInputSchema>;

export const sortInputSchema = sortSchema.extend({ id: uuidSchema.optional() });

/** Create a view with its filter, sorts and columns in one call (PUT with a client UUID; idempotent). */
export const createViewInputSchema = z.object({
  id: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  type: viewTypeSchema.default('table'),
  title: z.string().trim().min(1).max(200),
  sortOrder: rankSchema.optional(),
  filter: predicateSchema.nullable().optional(),
  sorts: z.array(sortInputSchema).max(5).optional(),
  columns: z.array(columnInputSchema).max(200).optional(),
  kanbanPivotPath: pathSchema.nullable().optional(),
  /** Kanban settings (`groupBy` overrides `kanbanPivotPath`; `cardAttributePaths` become the columns). */
  kanban: kanbanConfigInputSchema.optional(),
  tableRecordColumnWidth: z.number().int().nullable().optional(),
});
export type CreateViewInput = z.input<typeof createViewInputSchema>;

export const updateViewInputSchema = z.object({
  viewId: uuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
  sortOrder: rankSchema.optional(),
  kanbanPivotPath: pathSchema.nullable().optional(),
  kanbanIsNoStatusVisible: z.boolean().optional(),
  kanbanIsTimeInStatusVisible: z.boolean().optional(),
  /** Partial kanban settings of a kanban view (see kanbanConfigSchema). */
  kanban: kanbanConfigInputSchema.optional(),
  tableRecordColumnWidth: z.number().int().nullable().optional(),
  isArchived: z.boolean().optional(),
});
export type UpdateViewInput = z.input<typeof updateViewInputSchema>;

/** "Save for everyone" replaces the whole filter (C1 §3.1). */
export const setViewFilterInputSchema = z.object({ viewId: uuidSchema, filter: predicateSchema.nullable() });
export type SetViewFilterInput = z.input<typeof setViewFilterInputSchema>;
/** Full-array replace of the view's sorts (max 5). */
export const setViewSortsInputSchema = z.object({ viewId: uuidSchema, sorts: z.array(sortInputSchema).max(5) });
export type SetViewSortsInput = z.input<typeof setViewSortsInputSchema>;

export const addColumnInputSchema = columnInputSchema.extend({ viewId: uuidSchema, id: uuidSchema });
export type AddColumnInput = z.input<typeof addColumnInputSchema>;
export const updateColumnInputSchema = z.object({
  viewId: uuidSchema,
  columnId: uuidSchema,
  title: z.string().max(200).nullable().optional(),
  tableColumnWidth: z.number().int().min(40).max(2000).nullable().optional(),
  tableColumnAggregationType: columnAggregationSchema.nullable().optional(),
  displayConfiguration: z.record(z.string(), z.unknown()).optional(),
  sortOrder: rankSchema.optional(),
});
export type UpdateColumnInput = z.input<typeof updateColumnInputSchema>;
export const removeColumnInputSchema = z.object({ viewId: uuidSchema, columnId: uuidSchema });
export type RemoveColumnInput = z.input<typeof removeColumnInputSchema>;

export const listViewsInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  includeArchived: z.boolean().default(false),
});
export type ListViewsInput = z.input<typeof listViewsInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Query snapshots

/**
 * Materialise the ordered id list of (filter, sorts) — or of a saved view's filter and sorts — as a snapshot and
 * return the total and the first chunk (default 1000 ids).
 */
export const querySnapshotInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  /** Use the saved filter and sorts of this view; `filter`/`sorts`, when given, override them (unsaved drafts). */
  viewId: uuidSchema.optional(),
  filter: predicateSchema.nullable().optional(),
  sorts: z.array(sortSchema).max(5).optional(),
  /** IANA time zone of the viewer for relative dates and date-only timestamp comparisons (default UTC). */
  timeZone: z.string().min(1).max(64).optional(),
  initialRange: z
    .object({ start: z.number().int().min(0), size: z.number().int().min(0).max(5000) })
    .default({ start: 0, size: 1000 }),
  acceptAfter: acceptAfterSchema,
});
export type QuerySnapshotInput = z.input<typeof querySnapshotInputSchema>;
export const querySnapshotOutputSchema = z.object({
  snapshotId: uuidSchema,
  entityDefinitionId: uuidSchema,
  total: z.number().int(),
  ids: z.array(uuidSchema),
  start: z.number().int(),
  accurateAt: timestampSchema,
});
export type QuerySnapshotOutput = z.infer<typeof querySnapshotOutputSchema>;

export const snapshotChunkInputSchema = z.object({
  snapshotId: uuidSchema,
  start: z.number().int().min(0),
  size: z.number().int().min(1).max(5000).default(1000),
});
export type SnapshotChunkInput = z.input<typeof snapshotChunkInputSchema>;
export const snapshotChunkOutputSchema = querySnapshotOutputSchema;
export type SnapshotChunkOutput = QuerySnapshotOutput;

/** Selection as zebra edges over snapshot indices (see zebra.ts). */
export const resolveSelectionInputSchema = z.object({
  snapshotId: uuidSchema,
  zebraEdges: z.array(z.number().int().min(0)).max(20_000),
});
export type ResolveSelectionInput = z.input<typeof resolveSelectionInputSchema>;
export const resolveSelectionOutputSchema = z.object({ ids: z.array(uuidSchema), total: z.number().int() });
export type ResolveSelectionOutput = z.infer<typeof resolveSelectionOutputSchema>;

/**
 * Footer calculations. The supported column kinds (count/percent empty/not empty, sum,
 * mean, min, max; on checkboxes "empty" = not checked), explicit checkbox aliases, and our extras (unique count,
 * median, earliest/latest for dates and timestamps). 'filled' is the slice-1 name of count_not_empty.
 */
export const aggregationKinds = [
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'count_checked',
  'count_unchecked',
  'percent_checked',
  'percent_unchecked',
  'count_unique',
  'sum',
  'mean',
  'median',
  'min',
  'max',
  'earliest',
  'latest',
  'filled',
] as const;
export const aggregationKindSchema = z.enum(aggregationKinds);
export type AggregationKind = z.infer<typeof aggregationKindSchema>;

/**
 * Column aggregation over a snapshot: re-evaluates the snapshot's (resolved) filter on the projection. A multi-hop
 * path aggregates the first referenced record's value per row.
 */
export const aggregateInputSchema = z.object({
  snapshotId: uuidSchema,
  path: pathSchema,
  field: z.string().max(64).optional(),
  aggregation: aggregationKindSchema,
});
export type AggregateInput = z.input<typeof aggregateInputSchema>;
/**
 * `value` is locale-independent: counts as integers, percentages 0–100 rounded to 2 decimals, sums/means/medians as
 * plain numbers (sum over no values = 0; mean/median/min/max = null). Dates and timestamps (earliest/latest, min/max)
 * come back in `valueText` ('YYYY-MM-DD' or ISO instant) with `value` null. Formatting is the client's (X-11).
 */
export const aggregateOutputSchema = z.object({
  aggregation: aggregationKindSchema,
  value: z.number().nullable(),
  valueText: z.string().nullable(),
  /** Records in the snapshot (the filter re-evaluated now). */
  total: z.number().int(),
  /** Records with a value (checkbox: checked; rating: > 0). */
  filled: z.number().int(),
  /** Currency attributes: the attribute's default currency for sums/means. */
  currencyCode: z.string().nullable(),
  accurateAt: timestampSchema,
});
export type AggregateOutput = z.infer<typeof aggregateOutputSchema>;
