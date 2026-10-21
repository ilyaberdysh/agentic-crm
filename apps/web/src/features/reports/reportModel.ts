// What the pages know about report types, visualisations and aggregations (builder, chart-types): names,
// descriptions, icons, which visualisations a configuration allows (and why a disabled one is), defaults and the
// small formatting helpers shared by cells, editor and viewer.
import type {
  AttributeDefinition,
  AttributeType,
  Path,
  ReportAggregation,
  ReportGrouping,
  ReportMetric,
  ReportSettings,
  ReportType,
  VisualisationType,
} from '@agentic-crm/contracts';
import { visualisationsByType } from '@agentic-crm/contracts';
import type { IconGlyph } from '@agentic-crm/ui';
import {
  BarIcon,
  FunnelIcon,
  FunnelMetricIcon,
  FunnelStepsIcon,
  HistoricalIcon,
  InsightIcon,
  LineIcon,
  MapIcon,
  PieIcon,
  SingleMetricIcon,
  StageChangedIcon,
  TimeInStageIcon,
} from './icons';

export interface ReportTypeMeta {
  id: ReportType;
  title: string;
  description: string;
  group: 'own' | 'pipeline';
  icon: IconGlyph;
}

/** The type picker's cards, in order (step 1; strings `+KJg00`, `KZFHD/`, `TenaZR`, `VotX0X`, `zG4DnL`). */
export const REPORT_TYPES: readonly ReportTypeMeta[] = [
  {
    id: 'insights',
    title: 'Insight',
    description: 'Report on the current state of your business',
    group: 'own',
    icon: InsightIcon,
  },
  {
    id: 'historical',
    title: 'Historical values',
    description: 'See how your data has changed over time',
    group: 'own',
    icon: HistoricalIcon,
  },
  {
    id: 'funnel',
    title: 'Funnel',
    description: 'Track progress and conversion through your pipelines',
    group: 'pipeline',
    icon: FunnelIcon,
  },
  {
    id: 'time-in-stage',
    title: 'Time in stage',
    description: 'Track how much time is spent in your pipelines',
    group: 'pipeline',
    icon: TimeInStageIcon,
  },
  {
    id: 'stage-changed',
    title: 'Stage changed',
    description: 'See how many records move to specific stages',
    group: 'pipeline',
    icon: StageChangedIcon,
  },
];

export const reportTypeMeta = (type: ReportType): ReportTypeMeta =>
  REPORT_TYPES.find((t) => t.id === type) as ReportTypeMeta;

export const VISUALISATION_META: Record<VisualisationType, { title: string; icon: IconGlyph }> = {
  single_metric: { title: 'Single metric', icon: SingleMetricIcon },
  bar: { title: 'Bar', icon: BarIcon },
  pie: { title: 'Pie', icon: PieIcon },
  line: { title: 'Line', icon: LineIcon },
  map: { title: 'Map', icon: MapIcon },
  funnel: { title: 'Funnel', icon: FunnelIcon },
  metric: { title: 'Funnel Metric', icon: FunnelMetricIcon },
  steps: { title: 'Funnel Steps', icon: FunnelStepsIcon },
};

/** Glyph of a report in chips and favourite thumbnails. */
export const visualisationIcon = (v: VisualisationType): IconGlyph => VISUALISATION_META[v]?.icon ?? BarIcon;

export const AGGREGATION_LABELS: Record<ReportAggregation, string> = {
  count: 'Count',
  sum: 'Sum',
  mean: 'Average',
  min: 'Min',
  max: 'Max',
  median: 'Median',
};

/** Aggregations of a numeric metric in the select (Average, Sum, Min, Max, Count; builder). */
export const METRIC_AGGREGATIONS: readonly ReportAggregation[] = ['mean', 'sum', 'min', 'max', 'count'];
export const TIME_IN_STAGE_AGGREGATIONS = ['mean', 'min', 'max'] as const;

export const NUMERIC_TYPES: ReadonlySet<AttributeType> = new Set(['number', 'currency', 'rating']);

export function isNumericAttribute(attr: Pick<AttributeDefinition, 'type' | 'isMultiselect'>): boolean {
  return NUMERIC_TYPES.has(attr.type) && !attr.isMultiselect;
}

/** Status and single-select attributes (stage-like groupings, funnels). */
export function isStageAttribute(attr: Pick<AttributeDefinition, 'type' | 'isMultiselect'>): boolean {
  return (attr.type === 'pipeline' || attr.type === 'select') && !attr.isMultiselect;
}

/** Historical "Segment by": status, select, multi-select and actor-reference attributes (builder). */
export function isSegmentableAttribute(attr: Pick<AttributeDefinition, 'type'>): boolean {
  return attr.type === 'pipeline' || attr.type === 'select' || attr.type === 'actor-reference';
}

const CHRONOLOGICAL: ReadonlySet<AttributeType> = new Set(['date', 'timestamp']);

/** Whether a grouping buckets time (shows the time toolbar). */
export function isTimeGrouping(
  attr: Pick<AttributeDefinition, 'type'> | undefined | null,
  field: string | null | undefined,
): boolean {
  if (!attr) return false;
  return CHRONOLOGICAL.has(attr.type) || field === 'interacted_at';
}

// ---- visualisations ------------------------------------------------------------------------------------------------

export interface VisualisationOption {
  id: VisualisationType;
  enabled: boolean;
  /** Tooltip of a disabled option (builder table). */
  reason: string | null;
}

/** Attribute (and field) at the end of a path, resolved by the caller from the schema. */
export type LeafResolver = (path: Path) => Pick<AttributeDefinition, 'type' | 'isMultiselect'> | undefined;

const LINE_TYPES: ReadonlySet<AttributeType> = new Set([
  'timestamp',
  'date',
  'number',
  'rating',
  'select',
  'pipeline',
  'currency',
]);

const NEEDS_GROUP = 'Available when you configure a "Group by" attribute';
const NEEDS_NO_GROUP = 'Available when no "Group by" attribute is configured';
const NEEDS_LINE_GROUP = 'Available when you configure a numeric or chronological "Group by" attribute';

function lineAllowed(g: ReportGrouping | null, leaf: LeafResolver): boolean {
  if (!g) return false;
  const attr = leaf(g.attributePath);
  if (!attr) return false;
  return LINE_TYPES.has(attr.type) || g.field === 'interacted_at';
}

/**
 * The visualisation select's options for a configuration, enabled ones first in the select's order (Single metric,
 * Bar, Pie, Line, Map for insights), disabled ones last (builder, "Allowed visualisations per type").
 */
export function visualisationOptions(
  reportType: ReportType,
  settings: ReportSettings,
  leaf: LeafResolver,
): VisualisationOption[] {
  const opt = (id: VisualisationType, enabled: boolean, reason: string): VisualisationOption => ({
    id,
    enabled,
    reason: enabled ? null : reason,
  });
  let list: VisualisationOption[];
  switch (reportType) {
    case 'insights': {
      const s = settings as Extract<ReportSettings, { primaryGrouping: unknown; secondaryGrouping: unknown }>;
      const grouped = Boolean(s.primaryGrouping);
      const segmented = Boolean(s.secondaryGrouping);
      list = [
        opt('single_metric', !grouped, NEEDS_NO_GROUP),
        opt('bar', grouped, NEEDS_GROUP),
        opt('pie', grouped && !segmented, segmented ? 'Only line and bar charts support "Segment by"' : NEEDS_GROUP),
        opt('line', lineAllowed(s.primaryGrouping, leaf), NEEDS_LINE_GROUP),
        opt('map', false, 'Map charts are not available yet'),
      ];
      break;
    }
    case 'historical': {
      const s = settings as Extract<ReportSettings, { primaryMetricIsHistoric: boolean }>;
      const single = !s.primaryMetricIsHistoric && s.primaryMetric.attributePath !== null && !s.primaryGrouping;
      list = [
        opt('bar', true, ''),
        opt('line', true, ''),
        opt('single_metric', single, 'Available for a current-value metric without "Segment by"'),
      ];
      break;
    }
    case 'funnel':
      list = [opt('funnel', true, ''), opt('metric', true, ''), opt('steps', true, '')];
      break;
    case 'stage-changed':
      list = [opt('bar', true, ''), opt('line', true, '')];
      break;
    case 'time-in-stage':
      list = [opt('bar', true, '')];
      break;
  }
  const allowed = visualisationsByType[reportType];
  list = list.filter((o) => allowed.includes(o.id));
  return [...list.filter((o) => o.enabled), ...list.filter((o) => !o.enabled)];
}

/** Keeps `current` when still allowed, else the first allowed option (builder normaliser). */
export function normaliseVisualisationChoice(
  reportType: ReportType,
  settings: ReportSettings,
  current: VisualisationType | null | undefined,
  leaf: LeafResolver,
): VisualisationType {
  const options = visualisationOptions(reportType, settings, leaf);
  const hit = options.find((o) => o.id === current && o.enabled);
  if (hit) return hit.id;
  // A new insight is a single metric until a group by is configured.
  return (options.find((o) => o.enabled)?.id ?? options[0]?.id ?? 'bar') as VisualisationType;
}

// ---- metric helpers --------------------------------------------------------------------------------------------------

export const isCountRecords = (m: ReportMetric | null | undefined): boolean => !m || m.attributePath === null;

/** Metric changed to Count Records. */
export const COUNT_METRIC: ReportMetric = { attributePath: null, field: null, aggregation: 'count' };

/** Default aggregation when a numeric attribute is picked (builder: Sum). */
export const DEFAULT_NUMERIC_AGGREGATION: ReportAggregation = 'sum';

/** "Sorted by <b>stage order</b>" text parts for the sort button (builder). */
export function sortLabel(
  sort: string | null,
  naturalOrder: 'stage order' | 'select option order' | 'alphabetically',
): { prefix: string; strong: string } {
  const value = sort === 'value_asc' || sort === 'value_desc';
  if (value) return { prefix: 'Sorted by', strong: 'amount' };
  if (naturalOrder === 'alphabetically') return { prefix: 'Sorted', strong: 'alphabetically' };
  return { prefix: 'Sorted by', strong: naturalOrder };
}

// ---- paths -----------------------------------------------------------------------------------------------------------

/** Every attribute path a report's settings reference (the schema the pages need to resolve labels and types). */
export function settingsPaths(settings: ReportSettings): Path[] {
  const s = settings as unknown as Record<string, unknown>;
  const out: Path[] = [];
  const add = (p: unknown) => {
    if (Array.isArray(p) && p.length > 0) out.push(p as Path);
  };
  for (const key of ['primaryMetric', 'metric', 'primaryGrouping', 'secondaryGrouping']) {
    const v = s[key] as { attributePath?: unknown } | null | undefined;
    if (v) add(v.attributePath);
  }
  add(s.statusAttributePath);
  add(s.funnelAttributePath);
  return out;
}
