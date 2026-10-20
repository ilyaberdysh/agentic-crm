// Reports and dashboards (BACKLOG §9; H api §1–4, builder §1–11, README §3; CROSS-DOMAIN B.3, B.6, B.7, B.12, B.24,
// X-10, X-12). Shared by apps/api (procedures), packages/domain (services, dataset engine) and apps/web (editor,
// grid). Field names use camelCase (primary_metric → primaryMetric, …).
//
// Procedures (slice8-9-contracts.md):
//   dashboards.list/get/create/update/delete/duplicate/setLayout
//   reports.get/create/update/delete/duplicate/duplicateTo
//   reporting.dataset({type, …query, timeZone, weekStart?})         → {rows, meta, freshness}
//   reporting.reportDataset({reportId} | {draft}, timeZone, weekStart?) → the saved/draft report compiled with
//                                                                         datasetQueryForReport() and run
// Dashboard grants go through the slice-6 permissions.* procedures with resourceKind 'dashboard'.
import { z } from 'zod';
import {
  acceptAfterSchema,
  actorSchema,
  dateSchema,
  idOrSlugSchema,
  pathSchema,
  timestampSchema,
  uuidSchema,
} from './common.ts';
import { localDayRange } from './dates.ts';
import { accessScopeSchema } from './permissions.ts';
import type { AttributeType } from './schema.ts';
import { type Predicate, type PredicateLeaf, predicateSchema } from './views.ts';

// ---------------------------------------------------------------------------------------------------------------
// Enumerations

export const reportTypes = ['insights', 'historical', 'funnel', 'time-in-stage', 'stage-changed'] as const;
export const reportTypeSchema = z.enum(reportTypes);
export type ReportType = z.infer<typeof reportTypeSchema>;

/** UI names: Bar, Line, Pie, Map, Single metric, Funnel, Funnel Metric (`metric`), Funnel Steps (`steps`). */
export const visualisationTypes = ['bar', 'line', 'pie', 'map', 'single_metric', 'funnel', 'metric', 'steps'] as const;
export const visualisationTypeSchema = z.enum(visualisationTypes);
export type VisualisationType = z.infer<typeof visualisationTypeSchema>;

/** Visualisations a report type can store (builder §6 "Allowed visualisations per type"). */
export const visualisationsByType: Record<ReportType, readonly VisualisationType[]> = {
  insights: ['single_metric', 'bar', 'line', 'pie', 'map'],
  historical: ['bar', 'line', 'single_metric'],
  funnel: ['funnel', 'metric', 'steps'],
  'time-in-stage': ['bar'],
  'stage-changed': ['bar', 'line'],
};

/** Metric aggregations (UI: Average = mean, Sum, Min, Max, Count; median is ours). */
export const reportAggregations = ['count', 'sum', 'mean', 'min', 'max', 'median'] as const;
export const reportAggregationSchema = z.enum(reportAggregations);
export type ReportAggregation = z.infer<typeof reportAggregationSchema>;

export const timeResolutions = ['day', 'week', 'month', 'quarter', 'year'] as const;
export const timeResolutionSchema = z.enum(timeResolutions);
export type TimeResolution = z.infer<typeof timeResolutionSchema>;

/** Numeric codes in the returned plan: 0 = day … 4 = year; aggregations 1 = count … 5 = max. */
export const timeResolutionCodes: Record<TimeResolution, number> = { day: 0, week: 1, month: 2, quarter: 3, year: 4 };
export const aggregationCodes: Record<ReportAggregation, number> = {
  count: 1,
  sum: 2,
  mean: 3,
  min: 4,
  max: 5,
  median: 6,
};

export const sortPreferences = ['default_asc', 'default_desc', 'value_asc', 'value_desc'] as const;
export const sortPreferenceSchema = z.enum(sortPreferences);
export type SortPreference = z.infer<typeof sortPreferenceSchema>;

const ISO_DURATION_RE =
  /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
export const reportDurationSchema = z
  .string()
  .max(64)
  .refine((v) => ISO_DURATION_RE.test(v) && v !== 'P' && v !== '-P', 'Expected an ISO-8601 duration');

// ---------------------------------------------------------------------------------------------------------------
// Report settings (builder §3–11, api §1.3). Paths are arrays of hops (max 5); the server stores only the ids.

/** `{attributePath: null, field: null, aggregation: 'count'}` = Count Records. */
export const reportMetricSchema = z.object({
  attributePath: pathSchema.nullable(),
  /** Value sub-field (currency: 'raw_value'); null = the attribute's main field. */
  field: z.string().min(1).max(64).nullable().default(null),
  aggregation: reportAggregationSchema,
});
export type ReportMetric = z.infer<typeof reportMetricSchema>;
export const COUNT_RECORDS: ReportMetric = { attributePath: null, field: null, aggregation: 'count' };

export const reportGroupingSchema = z.object({
  attributePath: pathSchema,
  /**
   * Bucketing sub-field: pipeline_stage_id (status), select_option_id (select), country_code | locality | region
   * (location), first_name | last_name | full_name, normalized_email_address | email_domain, interacted_at |
   * owner_membership_id (interaction), value (others). null = the type's main field.
   */
  field: z.string().min(1).max(64).nullable().default(null),
  /** Select: the included option ids (null = all). */
  selectedValues: z.array(z.string().min(1).max(256)).max(1000).nullable().default(null),
  /** "Include empty values" / the "No stage" row. */
  nullGroupVisible: z.boolean().default(true),
  /** Show options/stages (and time buckets) without records. */
  emptyGroupsVisible: z.boolean().default(false),
  /** Status: the included stages (empty = all). */
  selectedPipelineStageIds: z.array(uuidSchema).max(1000).default([]),
});
export type ReportGrouping = z.infer<typeof reportGroupingSchema>;
export type ReportGroupingInput = z.input<typeof reportGroupingSchema>;

export const timeDurationSchema = z.discriminatedUnion('type', [
  /** Negative ISO duration back from now, e.g. '-P0Y6M0DT0H0M0S' (6M). */
  z.object({ type: z.literal('relative'), value: reportDurationSchema }),
  /** Period to date. */
  z.object({ type: z.literal('x_to_date'), value: z.enum(['week', 'month', 'quarter', 'year']) }),
]);
export type TimeDuration = z.infer<typeof timeDurationSchema>;

export const timeComparisonSchema = z.discriminatedUnion('type', [
  /** Window shifted by a (negative) ISO duration, e.g. Previous month = '-P0Y1M0DT0H0M0S'. */
  z.object({ type: z.literal('offset'), value: reportDurationSchema }),
  /** The window of the same length right before (relative ranges). */
  z.object({ type: z.literal('previous_period') }),
]);
export type TimeComparison = z.infer<typeof timeComparisonSchema>;

export const reportTimeConfigSchema = z.object({
  /** null = All. */
  duration: timeDurationSchema.nullable().default(null),
  resolution: timeResolutionSchema.default('month'),
  comparison: timeComparisonSchema.nullable().default(null),
});
export type ReportTimeConfig = z.infer<typeof reportTimeConfigSchema>;

const targetValue = z.number().finite().nullable();

export const insightSettingsSchema = z.object({
  primaryMetric: reportMetricSchema,
  primaryGrouping: reportGroupingSchema.nullable(),
  /** "Segment by" (bar and line only). */
  secondaryGrouping: reportGroupingSchema.nullable(),
  singleMetricDecimalPlaces: z.number().int().min(0).max(4).nullable(),
  mapDisplayType: z.string().max(32).nullable(),
  mapFitBounds: z.boolean().nullable(),
  targetValue,
  axisLabelVisible: z.boolean(),
  zerosVisible: z.boolean(),
  barSegmentsStacked: z.boolean(),
  sortPreference: sortPreferenceSchema.nullable(),
  timeConfig: reportTimeConfigSchema,
});
export const historicalSettingsSchema = z.object({
  primaryMetric: reportMetricSchema,
  /** Shown as "Segmented by": status, select, multi-select and actor-reference attributes. */
  primaryGrouping: reportGroupingSchema.nullable(),
  primaryMetricIsHistoric: z.boolean(),
  /** Historical (values as they were at the time) vs Current (current values). */
  primaryGroupingIsHistoric: z.boolean(),
  targetValue,
  axisLabelVisible: z.boolean(),
  barSegmentsStacked: z.boolean(),
  timeConfig: reportTimeConfigSchema,
});
export const funnelSettingsSchema = z.object({
  /** null = Count Records. */
  metric: reportMetricSchema.nullable(),
  funnelAttributePath: pathSchema.nullable(),
  /** Stage order always follows the attribute's stage order. */
  funnelSelectedPipelineStageIds: z.array(uuidSchema).max(200),
  /** "All records" pseudo-stage (top of funnel). */
  topOfFunnelVisible: z.boolean(),
});
export const timeInStageSettingsSchema = z.object({
  primaryGrouping: reportGroupingSchema.nullable(),
  statusAttributePath: pathSchema.nullable(),
  /** null = all stages. */
  selectedStageIds: z.array(uuidSchema).max(200).nullable(),
  aggregation: z.enum(['mean', 'min', 'max']),
  targetValue,
  axisLabelVisible: z.boolean(),
  barSegmentsStacked: z.boolean(),
  sortPreference: sortPreferenceSchema.nullable(),
  timeConfig: reportTimeConfigSchema,
});
export const stageChangedSettingsSchema = z.object({
  primaryMetric: reportMetricSchema,
  statusAttributePath: pathSchema.nullable(),
  selectedStageIds: z.array(uuidSchema).max(200).nullable(),
  targetValue,
  axisLabelVisible: z.boolean(),
  barSegmentsStacked: z.boolean(),
  timeConfig: reportTimeConfigSchema,
});

export type InsightSettings = z.infer<typeof insightSettingsSchema>;
export type HistoricalSettings = z.infer<typeof historicalSettingsSchema>;
export type FunnelSettings = z.infer<typeof funnelSettingsSchema>;
export type TimeInStageSettings = z.infer<typeof timeInStageSettingsSchema>;
export type StageChangedSettings = z.infer<typeof stageChangedSettingsSchema>;
export interface ReportSettingsByType {
  insights: InsightSettings;
  historical: HistoricalSettings;
  funnel: FunnelSettings;
  'time-in-stage': TimeInStageSettings;
  'stage-changed': StageChangedSettings;
}
export type ReportSettings = ReportSettingsByType[ReportType];

export const reportSettingsSchemas = {
  insights: insightSettingsSchema,
  historical: historicalSettingsSchema,
  funnel: funnelSettingsSchema,
  'time-in-stage': timeInStageSettingsSchema,
  'stage-changed': stageChangedSettingsSchema,
} as const satisfies Record<ReportType, z.ZodType>;

const MONTHLY: ReportTimeConfig = { duration: null, resolution: 'month', comparison: null };

/** Settings a type starts with (builder §6, reducer `shared/change_report_type`). */
export function defaultReportSettings<T extends ReportType>(type: T): ReportSettingsByType[T] {
  const byType: ReportSettingsByType = {
    insights: {
      primaryMetric: COUNT_RECORDS,
      primaryGrouping: null,
      secondaryGrouping: null,
      singleMetricDecimalPlaces: null,
      mapDisplayType: null,
      mapFitBounds: null,
      targetValue: null,
      axisLabelVisible: true,
      zerosVisible: true,
      barSegmentsStacked: true,
      sortPreference: 'default_asc',
      timeConfig: MONTHLY,
    },
    historical: {
      primaryMetric: COUNT_RECORDS,
      primaryGrouping: null,
      primaryMetricIsHistoric: true,
      primaryGroupingIsHistoric: true,
      targetValue: null,
      axisLabelVisible: true,
      barSegmentsStacked: true,
      timeConfig: MONTHLY,
    },
    funnel: { metric: null, funnelAttributePath: null, funnelSelectedPipelineStageIds: [], topOfFunnelVisible: false },
    'time-in-stage': {
      primaryGrouping: null,
      statusAttributePath: null,
      selectedStageIds: null,
      aggregation: 'mean',
      targetValue: null,
      axisLabelVisible: true,
      barSegmentsStacked: false,
      sortPreference: 'default_asc',
      timeConfig: MONTHLY,
    },
    'stage-changed': {
      primaryMetric: COUNT_RECORDS,
      statusAttributePath: null,
      selectedStageIds: null,
      targetValue: null,
      axisLabelVisible: true,
      barSegmentsStacked: true,
      timeConfig: MONTHLY,
    },
  };
  return structuredClone(byType[type]) as ReportSettingsByType[T];
}

/** Grouping fields when a group-by is picked (builder §6, `B:19810#756735`). */
export function defaultGrouping(
  attributePath: z.input<typeof pathSchema>,
  field: string | null = null,
): ReportGrouping {
  return {
    attributePath,
    field,
    selectedValues: null,
    nullGroupVisible: true,
    emptyGroupsVisible: false,
    selectedPipelineStageIds: [],
  };
}

/** Parses a (partial) settings object over `base` (default: the type's defaults); throws ZodError when invalid. */
export function parseReportSettings<T extends ReportType>(
  type: T,
  partial: Record<string, unknown> | null | undefined,
  base: ReportSettingsByType[T] = defaultReportSettings(type),
): ReportSettingsByType[T] {
  const merged = { ...base, ...(partial ?? {}) };
  return reportSettingsSchemas[type].parse(merged) as ReportSettingsByType[T];
}

/**
 * The visualisation a report should have after a configuration change (builder §3.4 normaliser, conservative: the
 * rules that need attribute types — Line, Map — are left to the client). null for a new Insight → Single metric.
 */
export function normaliseVisualisation(
  type: ReportType,
  settings: ReportSettings,
  requested: VisualisationType | null | undefined,
): VisualisationType {
  const allowed = visualisationsByType[type];
  let v = requested && allowed.includes(requested) ? requested : null;
  if (type === 'insights') {
    const s = settings as InsightSettings;
    if (!s.primaryGrouping) return 'single_metric';
    if (v === null || v === 'single_metric') v = 'bar';
    if (s.secondaryGrouping && (v === 'pie' || v === 'map')) v = 'bar';
    return v;
  }
  if (type === 'historical' && v === 'single_metric' && (settings as HistoricalSettings).primaryGrouping) return 'bar';
  return v ?? (allowed[0] as VisualisationType);
}

// ---------------------------------------------------------------------------------------------------------------
// Entities

const reportBase = {
  id: uuidSchema,
  workspaceId: uuidSchema,
  /** The dashboard and cell the report sits in (a report belongs to exactly one cell). */
  dashboardId: uuidSchema,
  cellId: uuidSchema,
  /** Data source: an object or a list (its collection-entry definition). */
  entityDefinitionId: uuidSchema,
  /** The report filter (entity filter with parent_type 'entity-report'); null when the report has no filter. */
  entityFilterId: uuidSchema.nullable(),
  filter: predicateSchema.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  visualisationType: visualisationTypeSchema,
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};
export const reportSchema = z.discriminatedUnion('reportType', [
  z.object({ ...reportBase, reportType: z.literal('insights'), settings: insightSettingsSchema }),
  z.object({ ...reportBase, reportType: z.literal('historical'), settings: historicalSettingsSchema }),
  z.object({ ...reportBase, reportType: z.literal('funnel'), settings: funnelSettingsSchema }),
  z.object({ ...reportBase, reportType: z.literal('time-in-stage'), settings: timeInStageSettingsSchema }),
  z.object({ ...reportBase, reportType: z.literal('stage-changed'), settings: stageChangedSettingsSchema }),
]);
export type Report = z.infer<typeof reportSchema>;

export const dashboardSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  title: z.string(),
  /** '' after UI creation; may be null. */
  description: z.string().nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardCellSchema = z.object({
  id: uuidSchema,
  dashboardId: uuidSchema,
  reportId: uuidSchema,
  /** Columns of the 12-column grid (4–12). */
  width: z.number().int().min(4).max(12),
  sortOrder: z.string(),
  createdAt: timestampSchema,
});
export type DashboardCell = z.infer<typeof dashboardCellSchema>;

export const dashboardFlags = [
  'administrate_reporting_dashboard_permissions',
  'read_reporting_dashboard',
  'update_reporting_dashboard',
  'delete_reporting_dashboard',
] as const;
export type DashboardFlag = (typeof dashboardFlags)[number];

/** The viewer's resolved access (H api §1.5 batch-get-resolved-action-policies). */
export const dashboardAccessSchema = z.object({
  level: accessScopeSchema,
  flags: z.object(
    Object.fromEntries(dashboardFlags.map((f) => [f, z.boolean()])) as Record<DashboardFlag, z.ZodBoolean>,
  ),
  /** Admins can always manage grants (OQ-067). */
  canManagePermissions: z.boolean(),
});
export type DashboardAccess = z.infer<typeof dashboardAccessSchema>;

export const reportThumbnailSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  reportType: reportTypeSchema,
  visualisationType: visualisationTypeSchema,
});

/** Index rows (dashboards index, favourites cards, Settings → Dashboards). */
export const dashboardSummarySchema = dashboardSchema.extend({
  /** The caller's favourite of this dashboard (null = not a favourite). */
  favoriteId: uuidSchema.nullable(),
  reportCount: z.number().int(),
  /** Reports in cell order (thumbnails, report chips). */
  reports: z.array(reportThumbnailSchema),
  access: dashboardAccessSchema,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const dashboardDetailSchema = z.object({
  dashboard: dashboardSchema,
  /** Cells in rank order, each with its report; reports on sources the viewer cannot read are left out. */
  cells: z.array(dashboardCellSchema.extend({ report: reportSchema })),
  /** Reports hidden from the viewer (no access to their object or list; `2LT5Zy`). */
  hiddenReportCount: z.number().int(),
  access: dashboardAccessSchema,
  favoriteId: uuidSchema.nullable(),
});
export type DashboardDetail = z.infer<typeof dashboardDetailSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Inputs

export const listDashboardsInputSchema = z
  .object({
    /** Title contains (index search, `?query=`). */
    query: z.string().max(200).optional(),
    /** 'admin' = Settings → Dashboards: admins see every dashboard, including ones without a grant. */
    scope: z.enum(['member', 'admin']).default('member'),
    acceptAfter: acceptAfterSchema,
  })
  .optional();
export type ListDashboardsInput = z.input<typeof listDashboardsInputSchema>;

export const getDashboardInputSchema = z.object({
  dashboardId: uuidSchema,
  /** 'admin': Settings → Dashboards → Reports tab (admins, without a grant). */
  scope: z.enum(['member', 'admin']).default('member'),
  acceptAfter: acceptAfterSchema,
});
export type GetDashboardInput = z.input<typeof getDashboardInputSchema>;

export const DEFAULT_DASHBOARD_TITLE = 'New Dashboard';
export const DEFAULT_REPORT_TITLE = 'New report';

export const createDashboardInputSchema = z.object({
  id: uuidSchema,
  title: z.string().max(256).default(DEFAULT_DASHBOARD_TITLE),
  description: z.string().max(4000).nullable().default(''),
});
export type CreateDashboardInput = z.input<typeof createDashboardInputSchema>;

export const updateDashboardInputSchema = z.object({
  dashboardId: uuidSchema,
  title: z.string().max(256).optional(),
  description: z.string().max(4000).nullable().optional(),
});
export type UpdateDashboardInput = z.input<typeof updateDashboardInputSchema>;

export const deleteDashboardInputSchema = z.object({ dashboardId: uuidSchema });
export type DeleteDashboardInput = z.input<typeof deleteDashboardInputSchema>;

export const duplicateDashboardInputSchema = z.object({
  dashboardId: uuidSchema,
  /** Client-minted id of the copy (cells and reports of the copy get server-minted ids). */
  newDashboardId: uuidSchema,
  /** Default "Copy of {title}". */
  title: z.string().max(256).optional(),
});
export type DuplicateDashboardInput = z.input<typeof duplicateDashboardInputSchema>;

/** `cells/shuffle`: every cell of the dashboard with its new rank and width (H api §2, README §3.3). */
export const setDashboardLayoutInputSchema = z.object({
  dashboardId: uuidSchema,
  cells: z
    .array(z.object({ cellId: uuidSchema, sortOrder: z.string().min(1).max(256), width: z.number().int() }))
    .max(500),
});
export type SetDashboardLayoutInput = z.input<typeof setDashboardLayoutInputSchema>;

export const getReportInputSchema = z.object({ reportId: uuidSchema, acceptAfter: acceptAfterSchema });
export type GetReportInput = z.input<typeof getReportInputSchema>;

export const createReportInputSchema = z.object({
  id: uuidSchema,
  dashboardId: uuidSchema,
  /** Client-minted id of the cell placing the report on the dashboard. */
  cellId: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  filter: predicateSchema.nullable().default(null),
  title: z.string().max(256).default(DEFAULT_REPORT_TITLE),
  description: z.string().max(4000).nullable().default(null),
  reportType: reportTypeSchema,
  /** Omitted / invalid → normalised (normaliseVisualisation). */
  visualisationType: visualisationTypeSchema.nullable().optional(),
  /** Partial settings over the type's defaults. */
  settings: z.record(z.string(), z.unknown()).optional(),
  /** New reports are full width at the bottom (H README §3.3). */
  width: z.number().int().min(4).max(12).default(12),
  /** Default: a rank after the last cell. */
  sortOrder: z.string().min(1).max(256).optional(),
});
export type CreateReportInput = z.input<typeof createReportInputSchema>;

export const updateReportInputSchema = z.object({
  reportId: uuidSchema,
  /** Changing the data source clears the filter and every attribute-based setting (builder §2.2). */
  entityDefinitionId: idOrSlugSchema.optional(),
  filter: predicateSchema.nullable().optional(),
  title: z.string().max(256).optional(),
  description: z.string().max(4000).nullable().optional(),
  /** Changing the type resets its settings to the type's defaults (builder §2.1) before `settings` apply. */
  reportType: reportTypeSchema.optional(),
  visualisationType: visualisationTypeSchema.nullable().optional(),
  /** Partial settings over the current ones (or over the new type's defaults). */
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateReportInput = z.input<typeof updateReportInputSchema>;

export const deleteReportInputSchema = z.object({ reportId: uuidSchema });
export type DeleteReportInput = z.input<typeof deleteReportInputSchema>;

/** Duplicate: a copy right after the source cell, same width (H README §3.6). */
export const duplicateReportInputSchema = z.object({
  reportId: uuidSchema,
  newReportId: uuidSchema,
  newCellId: uuidSchema,
});
export type DuplicateReportInput = z.input<typeof duplicateReportInputSchema>;

/** Duplicate to…: a copy at the end of another dashboard (full width unless given). */
export const duplicateReportToInputSchema = z.object({
  reportId: uuidSchema,
  targetDashboardId: uuidSchema,
  newReportId: uuidSchema,
  newCellId: uuidSchema,
  width: z.number().int().min(4).max(12).default(12),
});
export type DuplicateReportToInput = z.input<typeof duplicateReportToInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Dataset engine (H api §4): one query language for every chart.

export const datasetMetricSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('record-count') }),
  z.object({
    type: z.literal('attribute'),
    path: pathSchema,
    field: z.string().min(1).max(64).nullable().default(null),
    /** count = number of records with a value. */
    aggregation: reportAggregationSchema,
  }),
]);
export type DatasetMetric = z.infer<typeof datasetMetricSchema>;
export type DatasetMetricInput = z.input<typeof datasetMetricSchema>;

export const datasetGroupingSchema = z.object({
  path: pathSchema,
  field: z.string().min(1).max(64).nullable().default(null),
  includeNullGroup: z.boolean().default(true),
  /** Select/status: every option or stage (also ones without records); time buckets: every bucket of the range. */
  includeEmptyGroups: z.boolean().default(false),
  /** Keep only these group keys (option/stage ids, record ids, raw values); null = all. */
  selectedValues: z.array(z.string().min(1).max(256)).max(1000).nullable().default(null),
  /** Historical pivots: group by the value as it was at each point in time (true) or by the current value. */
  historic: z.boolean().default(true),
});
export type DatasetGrouping = z.infer<typeof datasetGroupingSchema>;
export type DatasetGroupingInput = z.input<typeof datasetGroupingSchema>;

/** Calendar window in the viewer's zone: local dates, both inclusive; null = open end. */
export const datasetWindowSchema = z.object({ start: dateSchema.nullable(), end: dateSchema.nullable() });
export type DatasetWindow = z.infer<typeof datasetWindowSchema>;

export const datasetTimeConfigSchema = z.object({
  resolution: timeResolutionSchema.default('month'),
  start: dateSchema.nullable().default(null),
  end: dateSchema.nullable().default(null),
  /** A second window computed with the same query (Compare); rows are aligned to the main window's buckets. */
  comparison: z.object({ start: dateSchema, end: dateSchema }).nullable().default(null),
});
export type DatasetTimeConfig = z.infer<typeof datasetTimeConfigSchema>;
export type DatasetTimeConfigInput = z.input<typeof datasetTimeConfigSchema>;

const viewerFields = {
  /** IANA zone of the viewer: time buckets of timestamps, relative filter values. */
  timeZone: z.string().min(1).max(64).default('UTC'),
  /** 0 = Sunday … 6 = Saturday; default: the member's preference, else the locale's (X-10). */
  weekStart: z.number().int().min(0).max(6).optional(),
  /** Include the generated SQL in meta (debugging). */
  debug: z.boolean().optional(),
  acceptAfter: acceptAfterSchema,
};

const queryBase = {
  entityDefinitionId: idOrSlugSchema,
  /** The report filter; evaluated on current values (also for history-based types). */
  filter: predicateSchema.nullable().default(null),
};

/**
 * pivot — Insight (current values), Historical values (as-of each time bucket) and Stage changed (status values by
 * the bucket they started in):
 *   insight       rows = (group, segment) → metric over current values; a date/timestamp grouping is bucketed by
 *                 timeConfig.resolution in the viewer's zone (dates without zone) and limited to timeConfig.start/end
 *   historical    rows = (bucket, segment) → metric as of each bucket's end (the current bucket: now); the segment
 *                 is primaryGrouping, by its value at that time (historic) or its current value
 *   stage-changed rows = (bucket, stage) → metric over the status values that started in the bucket
 */
export const pivotQuerySchema = z.object({
  type: z.literal('pivot'),
  variant: z.enum(['insight', 'historical', 'stage-changed']).default('insight'),
  ...queryBase,
  metric: datasetMetricSchema.default({ type: 'record-count' }),
  /** Historical: aggregate the metric attribute's value at each point in time (else its current value). */
  metricIsHistoric: z.boolean().default(true),
  primaryGrouping: datasetGroupingSchema.nullable().default(null),
  secondaryGrouping: datasetGroupingSchema.nullable().default(null),
  /** Stage changed: the status attribute and the stages to count (null = all). */
  statusAttributePath: pathSchema.nullable().default(null),
  selectedStageIds: z.array(uuidSchema).max(200).nullable().default(null),
  timeConfig: datasetTimeConfigSchema.nullable().default(null),
  ...viewerFields,
});

/**
 * funnel — per stage (in the attribute's stage order) the records that reached or passed it at any time (all status
 * values, current and retired; non-strict progression); with `includeAllRecords` a first row (stage null) counts
 * every record. A metric replaces counts by the aggregate of the records' current values.
 * funnel-metric — the same rows plus conversion between consecutive stages and overall (`summary`).
 */
export const funnelQuerySchema = z.object({
  type: z.literal('funnel'),
  ...queryBase,
  statusAttributePath: pathSchema,
  stageIds: z.array(uuidSchema).min(1).max(200),
  includeAllRecords: z.boolean().default(false),
  metric: datasetMetricSchema.nullable().default(null),
  ...viewerFields,
});
export const funnelMetricQuerySchema = funnelQuerySchema.extend({ type: z.literal('funnel-metric') });

/**
 * time-in-stage — per stage (and group) the aggregate of the durations of the status values ("stays"): active_until
 * (or now, for the current stay) − active_from, in milliseconds. `range` keeps stays that started in the window.
 */
export const timeInStageQuerySchema = z.object({
  type: z.literal('time-in-stage'),
  ...queryBase,
  statusAttributePath: pathSchema,
  selectedStageIds: z.array(uuidSchema).max(200).nullable().default(null),
  aggregation: z.enum(['mean', 'min', 'max', 'median']).default('mean'),
  primaryGrouping: datasetGroupingSchema.nullable().default(null),
  range: datasetWindowSchema.nullable().default(null),
  ...viewerFields,
});

export const datasetInputSchema = z.discriminatedUnion('type', [
  pivotQuerySchema,
  funnelQuerySchema,
  funnelMetricQuerySchema,
  timeInStageQuerySchema,
]);
export type DatasetInput = z.input<typeof datasetInputSchema>;
export type DatasetQuery = z.infer<typeof datasetInputSchema>;
export type PivotQuery = z.infer<typeof pivotQuerySchema>;
export type FunnelQuery = z.infer<typeof funnelQuerySchema> | z.infer<typeof funnelMetricQuerySchema>;
export type TimeInStageQuery = z.infer<typeof timeInStageQuerySchema>;

/** Rows of a pivot. `group`/`segment` keys: option/stage/record/member ids, 'YYYY-MM-DD' bucket starts, raw values. */
export const pivotRowSchema = z.object({
  group: z.string().nullable(),
  segment: z.string().nullable(),
  /** The metric; null when no value contributes (e.g. the average of nothing). */
  value: z.number().nullable(),
  /** Records (or status values, for stage changed) behind the value. */
  count: z.number().int(),
});
export type PivotRow = z.infer<typeof pivotRowSchema>;

export const funnelRowSchema = z.object({
  /** null = the "All records" step. */
  stage: uuidSchema.nullable(),
  count: z.number().int(),
  /** The metric (= count without a metric). */
  value: z.number().nullable(),
  /** value ÷ the previous step's value (null for the first step or a zero previous value). */
  conversionFromPrevious: z.number().nullable(),
  conversionFromFirst: z.number().nullable(),
});
export type FunnelRow = z.infer<typeof funnelRowSchema>;

export const timeInStageRowSchema = z.object({
  stage: uuidSchema,
  group: z.string().nullable(),
  /** Milliseconds. */
  value: z.number().nullable(),
  /** Stays behind the value. */
  count: z.number().int(),
});
export type TimeInStageRow = z.infer<typeof timeInStageRowSchema>;

/** Display data of a group key (labels and colours are resolved by the server; order = natural order). */
export const datasetGroupInfoSchema = z.object({
  key: z.string().nullable(),
  label: z.string().nullable(),
  /** Option/stage colour token. */
  color: z.string().nullable(),
  order: z.number().int(),
});
export type DatasetGroupInfo = z.infer<typeof datasetGroupInfoSchema>;

export const datasetPlanStepSchema = z.object({ op: z.string(), detail: z.string() });
export type DatasetPlanStep = z.infer<typeof datasetPlanStepSchema>;

export const datasetMetaSchema = z.object({
  entityDefinitionId: uuidSchema,
  timeZone: z.string(),
  weekStart: z.number().int(),
  resolution: timeResolutionSchema.nullable(),
  /** Time buckets ('YYYY-MM-DD' local bucket starts) of the window, in order (time pivots). */
  buckets: z.array(z.string()).nullable(),
  comparisonBuckets: z.array(z.string()).nullable(),
  groups: z.object({
    primary: z.array(datasetGroupInfoSchema).nullable(),
    secondary: z.array(datasetGroupInfoSchema).nullable(),
  }),
  /** Records matching the filter (the data source's size for this report). */
  totalRecords: z.number().int(),
  /** More than 1,000 groups (× 20 segments): only the largest are returned. */
  truncated: z.boolean(),
  /** Query plan for debugging. */
  plan: z.array(datasetPlanStepSchema),
  sql: z.array(z.string()).optional(),
  durationMs: z.number(),
});
export type DatasetMeta = z.infer<typeof datasetMetaSchema>;

/**
 * Freshness token: the result reflects every change up to `seq` (a change_log cursor). A `report-stale`
 * invalidation with a larger seq whose entityDefinitionId is in `entityDefinitionIds` and whose
 * attributeDefinitionIds are null or intersect `attributeDefinitionIds` makes the result stale ("New data").
 */
export const datasetFreshnessSchema = z.object({
  accurateAt: timestampSchema,
  seq: z.string(),
  entityDefinitionIds: z.array(uuidSchema),
  attributeDefinitionIds: z.array(uuidSchema),
});
export type DatasetFreshness = z.infer<typeof datasetFreshnessSchema>;

export const funnelSummarySchema = z.object({
  steps: z.array(z.object({ from: uuidSchema.nullable(), to: uuidSchema, conversion: z.number().nullable() })),
  /** Last step ÷ first step. */
  overallConversion: z.number().nullable(),
});

export const datasetOutputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pivot'),
    variant: z.enum(['insight', 'historical', 'stage-changed']),
    rows: z.array(pivotRowSchema),
    /** Rows of the comparison window; `group` is the aligned bucket of the main window. */
    comparisonRows: z.array(pivotRowSchema).nullable(),
    meta: datasetMetaSchema,
    freshness: datasetFreshnessSchema,
  }),
  z.object({
    type: z.literal('funnel'),
    rows: z.array(funnelRowSchema),
    summary: funnelSummarySchema.nullable(),
    meta: datasetMetaSchema,
    freshness: datasetFreshnessSchema,
  }),
  z.object({
    type: z.literal('funnel-metric'),
    rows: z.array(funnelRowSchema),
    /** Conversion between consecutive steps and overall. */
    summary: funnelSummarySchema.nullable(),
    meta: datasetMetaSchema,
    freshness: datasetFreshnessSchema,
  }),
  z.object({
    type: z.literal('time-in-stage'),
    rows: z.array(timeInStageRowSchema),
    meta: datasetMetaSchema,
    freshness: datasetFreshnessSchema,
  }),
]);
export type DatasetOutput = z.infer<typeof datasetOutputSchema>;
/** The output of a query type (`DatasetOutputFor<'pivot'>`). */
export type DatasetOutputFor<T extends DatasetOutput['type']> = Extract<DatasetOutput, { type: T }>;

/** A report as the editor holds it (unsaved draft) — enough to compile a dataset query. */
export const reportDraftSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  filter: predicateSchema.nullable().default(null),
  reportType: reportTypeSchema,
  visualisationType: visualisationTypeSchema.nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type ReportDraft = z.input<typeof reportDraftSchema>;

export const reportDatasetInputSchema = z.object({
  /** A saved report, or an unsaved draft (exactly one). */
  reportId: uuidSchema.optional(),
  draft: reportDraftSchema.optional(),
  timeZone: viewerFields.timeZone,
  weekStart: viewerFields.weekStart,
  debug: viewerFields.debug,
  acceptAfter: acceptAfterSchema,
});
export type ReportDatasetInput = z.input<typeof reportDatasetInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Report → dataset query (shared by the server's reportDataset and the client)

interface Duration {
  sign: 1 | -1;
  years: number;
  months: number;
  weeks: number;
  days: number;
}

function parseDuration(value: string): Duration {
  const m = ISO_DURATION_RE.exec(value);
  if (!m) throw new Error(`Invalid ISO-8601 duration: ${value}`);
  const n = (i: number) => Number(m[i] ?? 0);
  // Time parts are ignored: windows are whole local days.
  return { sign: m[1] ? -1 : 1, years: n(2), months: n(3), weeks: n(4), days: n(5) };
}

/** Calendar arithmetic on 'YYYY-MM-DD' (months clamp to the target month's length). */
export function addDurationToDate(date: string, duration: string, factor: 1 | -1 = 1): string {
  const d = parseDuration(duration);
  const s = d.sign * factor;
  const [y, mo, day] = date.split('-').map(Number) as [number, number, number];
  const months = (d.years * 12 + d.months) * s;
  const first = new Date(Date.UTC(y, mo - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)));
  shifted.setUTCDate(shifted.getUTCDate() + (d.weeks * 7 + d.days) * s);
  return shifted.toISOString().slice(0, 10);
}

/** First local date of the period of `resolution` that contains `date` (weeks start on `weekStart`). */
export function bucketStartOf(date: string, resolution: TimeResolution, weekStart: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  switch (resolution) {
    case 'day':
      return date;
    case 'week': {
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      return iso(y, mo, d - ((dow - weekStart + 7) % 7));
    }
    case 'month':
      return iso(y, mo, 1);
    case 'quarter':
      return iso(y, Math.floor((mo - 1) / 3) * 3 + 1, 1);
    case 'year':
      return iso(y, 1, 1);
  }
}

const RESOLUTION_STEP: Record<TimeResolution, string> = {
  day: 'P1D',
  week: 'P1W',
  month: 'P1M',
  quarter: 'P3M',
  year: 'P1Y',
};

/** Bucket starts from the bucket of `start` to the bucket of `end` (inclusive). */
export function bucketsBetween(start: string, end: string, resolution: TimeResolution, weekStart: number): string[] {
  const out: string[] = [];
  let b = bucketStartOf(start, resolution, weekStart);
  const last = bucketStartOf(end, resolution, weekStart);
  for (let i = 0; b <= last && i < 10_000; i++) {
    out.push(b);
    b = addDurationToDate(bucketStartOf(b, resolution, weekStart), RESOLUTION_STEP[resolution]);
  }
  return out;
}

export interface ReportWindowEnv {
  /** Local date of "now" in the viewer's zone ('YYYY-MM-DD'). */
  today: string;
  weekStart: number;
}

const PERIOD_STEP: Record<'week' | 'month' | 'quarter' | 'year', string> = {
  week: '-P1W',
  month: '-P1M',
  quarter: '-P3M',
  year: '-P1Y',
};

/**
 * The concrete window of a report's time config (builder §3.6): All = open; a relative range = [today + duration,
 * today]; period to date = [start of the current period, today]. The comparison window is the main window shifted by
 * the offset (Previous period: by the range's own length).
 */
export function resolveReportWindow(
  timeConfig: ReportTimeConfig,
  env: ReportWindowEnv,
): { start: string | null; end: string | null; comparison: { start: string; end: string } | null } {
  const { duration, comparison } = timeConfig;
  if (!duration) return { start: null, end: null, comparison: null };
  const end = env.today;
  const start =
    duration.type === 'relative'
      ? addDurationToDate(env.today, duration.value)
      : bucketStartOf(env.today, duration.value, env.weekStart);
  if (!comparison) return { start, end, comparison: null };
  let offset: string;
  let factor: 1 | -1 = 1;
  if (comparison.type === 'offset') offset = comparison.value;
  else if (duration.type === 'relative') {
    offset = duration.value;
    // A positive duration would shift forward; previous period always goes back.
    if (!duration.value.startsWith('-')) factor = -1;
  } else offset = PERIOD_STEP[duration.value];
  return {
    start,
    end,
    comparison: { start: addDurationToDate(start, offset, factor), end: addDurationToDate(end, offset, factor) },
  };
}

function toDatasetMetric(metric: ReportMetric | null): DatasetMetric {
  if (!metric || metric.attributePath === null) return { type: 'record-count' };
  return { type: 'attribute', path: metric.attributePath, field: metric.field, aggregation: metric.aggregation };
}

function toDatasetGrouping(
  g: ReportGrouping,
  historic = true,
  includeEmptyGroups = g.emptyGroupsVisible,
): DatasetGrouping {
  const stages = g.selectedPipelineStageIds.length > 0 ? g.selectedPipelineStageIds : null;
  return {
    path: g.attributePath,
    field: g.field,
    includeNullGroup: g.nullGroupVisible,
    includeEmptyGroups,
    selectedValues: stages ?? g.selectedValues,
    historic,
  };
}

/** Thrown when a report is not complete enough to run (e.g. a funnel without a status attribute). */
export class IncompleteReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteReportError';
  }
}

/**
 * Compiles a saved or draft report into its dataset query (H api §4.1–4.3). Insights fetch every time bucket (the
 * range and comparison of a date grouping apply on the client); historical values and stage changed
 * send the resolved window and comparison.
 */
export function datasetQueryForReport(
  report: {
    entityDefinitionId: string;
    filter: Predicate | null;
    reportType: ReportType;
    visualisationType: VisualisationType | null;
    settings: ReportSettings;
  },
  env: ReportWindowEnv & { timeZone: string },
): DatasetQuery {
  const common = {
    entityDefinitionId: report.entityDefinitionId,
    filter: report.filter,
    timeZone: env.timeZone,
    weekStart: env.weekStart,
  };
  switch (report.reportType) {
    case 'insights': {
      const s = report.settings as InsightSettings;
      return pivotQuerySchema.parse({
        type: 'pivot',
        variant: 'insight',
        ...common,
        metric: toDatasetMetric(s.primaryMetric),
        // "Show zeros" keeps the options, stages and time buckets without records on the axis (builder §3.4).
        primaryGrouping: s.primaryGrouping
          ? toDatasetGrouping(s.primaryGrouping, true, s.primaryGrouping.emptyGroupsVisible || s.zerosVisible)
          : null,
        secondaryGrouping: s.primaryGrouping && s.secondaryGrouping ? toDatasetGrouping(s.secondaryGrouping) : null,
        timeConfig: s.primaryGrouping ? { resolution: s.timeConfig.resolution } : null,
      });
    }
    case 'historical': {
      const s = report.settings as HistoricalSettings;
      const window = resolveReportWindow(s.timeConfig, env);
      return pivotQuerySchema.parse({
        type: 'pivot',
        variant: 'historical',
        ...common,
        metric: toDatasetMetric(s.primaryMetric),
        metricIsHistoric: s.primaryMetricIsHistoric,
        primaryGrouping: s.primaryGrouping ? toDatasetGrouping(s.primaryGrouping, s.primaryGroupingIsHistoric) : null,
        timeConfig: { resolution: s.timeConfig.resolution, ...window },
      });
    }
    case 'stage-changed': {
      const s = report.settings as StageChangedSettings;
      if (!s.statusAttributePath) throw new IncompleteReportError('Choose a status attribute');
      const window = resolveReportWindow(s.timeConfig, env);
      return pivotQuerySchema.parse({
        type: 'pivot',
        variant: 'stage-changed',
        ...common,
        metric: toDatasetMetric(s.primaryMetric),
        statusAttributePath: s.statusAttributePath,
        selectedStageIds: s.selectedStageIds,
        timeConfig: { resolution: s.timeConfig.resolution, ...window },
      });
    }
    case 'funnel': {
      const s = report.settings as FunnelSettings;
      if (!s.funnelAttributePath) throw new IncompleteReportError('Choose a status attribute');
      if (s.funnelSelectedPipelineStageIds.length === 0) throw new IncompleteReportError('Select stages');
      return (report.visualisationType === 'metric' ? funnelMetricQuerySchema : funnelQuerySchema).parse({
        type: report.visualisationType === 'metric' ? 'funnel-metric' : 'funnel',
        ...common,
        statusAttributePath: s.funnelAttributePath,
        stageIds: s.funnelSelectedPipelineStageIds,
        includeAllRecords: s.topOfFunnelVisible,
        metric: s.metric ? toDatasetMetric(s.metric) : null,
      });
    }
    case 'time-in-stage': {
      const s = report.settings as TimeInStageSettings;
      if (!s.statusAttributePath) throw new IncompleteReportError('Choose a status attribute');
      const window = resolveReportWindow(s.timeConfig, env);
      return timeInStageQuerySchema.parse({
        type: 'time-in-stage',
        ...common,
        statusAttributePath: s.statusAttributePath,
        selectedStageIds: s.selectedStageIds,
        aggregation: s.aggregation,
        primaryGrouping: s.primaryGrouping ? toDatasetGrouping(s.primaryGrouping) : null,
        range: window.start || window.end ? { start: window.start, end: window.end } : null,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Dashboard grid (H README §3.3): 12 columns, cells 4–12 wide, packed greedily into rows in rank order; the last cell
// of every row stretches so the row fills 12 columns. Rows are 458 px high.

export const DASHBOARD_COLUMNS = 12;
export const MIN_CELL_WIDTH = 4;
export const DASHBOARD_ROW_HEIGHT_PX = 458;

export const clampCellWidth = (width: number) =>
  Math.min(DASHBOARD_COLUMNS, Math.max(MIN_CELL_WIDTH, Math.round(width)));

/** Rows of cells (already in rank order) with the width each cell renders at. */
export function packDashboardRows<T extends { width: number }>(cells: T[]): { cell: T; renderWidth: number }[][] {
  const rows: { cell: T; renderWidth: number }[][] = [];
  let row: { cell: T; renderWidth: number }[] = [];
  let used = 0;
  for (const cell of cells) {
    const w = clampCellWidth(cell.width);
    if (row.length > 0 && used + w > DASHBOARD_COLUMNS) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ cell, renderWidth: w });
    used += w;
  }
  if (row.length > 0) rows.push(row);
  for (const r of rows) {
    const total = r.reduce((s, c) => s + c.renderWidth, 0);
    const last = r[r.length - 1] as { cell: T; renderWidth: number };
    last.renderWidth += DASHBOARD_COLUMNS - total;
  }
  return rows;
}

/**
 * Splits 12 columns evenly over n cells (remainder to the first cells, min 4) — a row that receives a dropped cell
 * (H README §3.3).
 */
export function evenRowWidths(n: number): number[] {
  const count = Math.max(1, Math.min(3, n));
  const base = Math.floor(DASHBOARD_COLUMNS / count);
  const rest = DASHBOARD_COLUMNS - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------
// Contributing data / drill-down (builder §3.7): the report filter AND "the grouping attribute has this group key".
// The result is a predicate for snapshots.query (a regular record table of the data source).

const ID_FIELDS: Partial<Record<AttributeType, string>> = {
  pipeline: 'pipeline_stage_id',
  select: 'select_option_id',
  'entity-reference': 'target_entity_instance_id',
  'actor-reference': 'referenced_actor_id',
};

/**
 * Filter of the records behind one group (a bar, slice or point): `key` is a row's `group`/`segment` key (null = the
 * "No value" group). Time keys are bucket starts: dates match [start, next bucket), timestamps the same local range in
 * `time.timeZone`. `attributeType` is the grouping attribute's type (the leaf of `grouping.path`).
 */
export function contributingDataFilter(
  base: Predicate | null,
  grouping: { path: z.input<typeof pathSchema>; field?: string | null },
  attributeType: AttributeType,
  key: string | null,
  time?: { resolution: TimeResolution; timeZone: string; weekStart: number },
): Predicate {
  const path = grouping.path;
  const field = grouping.field ?? ID_FIELDS[attributeType] ?? 'value';
  let leaf: PredicateLeaf;
  if (key === null) {
    // No value: checkboxes are "not checked", everything else "is empty".
    leaf =
      attributeType === 'checkbox'
        ? { path, mode: 'must-not', constraints: [{ field, operator: 'eq', value: true }] }
        : { path, mode: 'must-not', constraints: [] };
  } else if ((attributeType === 'date' || attributeType === 'timestamp' || field === 'interacted_at') && time) {
    const next = addDurationToDate(key, RESOLUTION_STEP[time.resolution]);
    const [start, end] =
      attributeType === 'date'
        ? [key, next]
        : [localDayRange(key, time.timeZone).start, localDayRange(next, time.timeZone).start];
    leaf = {
      path,
      mode: 'must',
      constraints: [
        { field, operator: 'gte', value: start },
        { field, operator: 'lt', value: end },
      ],
    };
  } else if (attributeType === 'checkbox') {
    leaf =
      key === 'true'
        ? { path, mode: 'must', constraints: [{ field, operator: 'eq', value: true }] }
        : { path, mode: 'must-not', constraints: [{ field, operator: 'eq', value: true }] };
  } else if (attributeType === 'number' || attributeType === 'currency' || attributeType === 'rating') {
    leaf = { path, mode: 'must', constraints: [{ field, operator: 'eq', value: Number(key) }] };
  } else {
    leaf = { path, mode: 'must', constraints: [{ field, operator: 'eq', value: key }] };
  }
  return base ? { and: [base, leaf] } : leaf;
}
