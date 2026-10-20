// Fixtures of the chart gallery and of the chart tests: the "[seed] Projects" data of the curated Attio screenshots
// (budget by phase, phase × priority, 12 → 9 → 4 → 2 funnel, durations of 3–7 hours) as `ChartContext` + `DatasetOutput`.
import type {
  DatasetGroupInfo,
  DatasetMeta,
  DatasetOutput,
  FunnelRow,
  InsightSettings,
  PivotRow,
  ReportType,
  TimeInStageRow,
  VisualisationType,
} from '@agentic-crm/contracts';
import { defaultReportSettings } from '@agentic-crm/contracts';
import type { ChartContext, ValueFormat } from '../types';

export const ENV: ChartContext['env'] = { today: '2026-10-14', weekStart: 1, timeZone: 'Europe/Moscow' };

const ID = '0197a5a0-0000-7000-8000-000000000000';
const freshness = {
  accurateAt: '2026-10-14T10:00:00.000Z',
  seq: '1',
  entityDefinitionIds: [],
  attributeDefinitionIds: [],
};

export const STAGES = {
  discovery: '0197a5a0-1000-7000-8000-000000000001',
  build: '0197a5a0-1000-7000-8000-000000000002',
  review: '0197a5a0-1000-7000-8000-000000000003',
  done: '0197a5a0-1000-7000-8000-000000000004',
} as const;

export const stageInfos: DatasetGroupInfo[] = [
  { key: STAGES.discovery, label: 'Discovery', color: 'block_light-green', order: 0 },
  { key: STAGES.build, label: 'Build', color: 'block_blue', order: 1 },
  { key: STAGES.review, label: 'Review', color: 'block_magenta', order: 2 },
  { key: STAGES.done, label: 'Done', color: 'block_grey', order: 3 },
];

export const PRIORITIES = {
  low: '0197a5a0-2000-7000-8000-000000000001',
  medium: '0197a5a0-2000-7000-8000-000000000002',
  high: '0197a5a0-2000-7000-8000-000000000003',
  critical: '0197a5a0-2000-7000-8000-000000000004',
} as const;

export const priorityInfos: DatasetGroupInfo[] = [
  { key: PRIORITIES.low, label: 'Low', color: 'pastel_grey', order: 0 },
  { key: PRIORITIES.medium, label: 'Medium', color: 'pastel_grey', order: 1 },
  { key: PRIORITIES.high, label: 'High', color: 'pastel_grey', order: 2 },
  { key: PRIORITIES.critical, label: 'Critical', color: 'pastel_grey', order: 3 },
];

export const EUR: ValueFormat = { kind: 'currency', currency: 'EUR', decimals: 2, display: 'symbol' };

export function metricOf(format: ValueFormat, over: Partial<ChartContext['metric']> = {}): ChartContext['metric'] {
  return {
    format,
    axisTitle: 'Budget › Sum',
    tooltipLabel: 'Budget (Sum)',
    singleCaption: 'Single Metric - Sum',
    singleSubCaption: 'Budget',
    ...over,
  };
}

export const COUNT_METRIC: ChartContext['metric'] = {
  format: { kind: 'count' },
  axisTitle: 'Count',
  tooltipLabel: 'Count',
  singleCaption: 'Single Metric - Count',
  singleSubCaption: 'Records',
};

function meta(over: Partial<DatasetMeta> & { groups: DatasetMeta['groups'] }): DatasetMeta {
  return {
    entityDefinitionId: ID,
    timeZone: ENV.timeZone,
    weekStart: ENV.weekStart,
    resolution: null,
    buckets: null,
    comparisonBuckets: null,
    totalRecords: 12,
    truncated: false,
    plan: [],
    durationMs: 12,
    ...over,
  };
}

export const pivot = (
  variant: 'insight' | 'historical' | 'stage-changed',
  rows: PivotRow[],
  m: Parameters<typeof meta>[0],
  comparisonRows: PivotRow[] | null = null,
): DatasetOutput => ({ type: 'pivot', variant, rows, comparisonRows, meta: meta(m), freshness });

const row = (group: string | null, value: number | null, segment: string | null = null, count = 1): PivotRow => ({
  group,
  segment,
  value,
  count,
});

export function chartContext(
  reportType: ReportType,
  visualisationType: VisualisationType,
  over: Partial<Omit<ChartContext, 'report'>> & { settings?: Record<string, unknown> } = {},
): ChartContext {
  const { settings, ...rest } = over;
  const base = defaultReportSettings(reportType) as unknown as Record<string, unknown>;
  return {
    report: {
      reportType,
      visualisationType,
      settings: { ...base, ...(settings ?? {}) } as unknown as ChartContext['report']['settings'],
    },
    sourcePlural: 'Projects',
    metric: metricOf(EUR),
    primary: { title: 'Phase', type: 'pipeline', isTime: false },
    secondary: null,
    statusTitle: null,
    env: ENV,
    ...rest,
  };
}

export interface Fixture {
  id: string;
  title: string;
  ctx: ChartContext;
  data: DatasetOutput;
}

// ---- Insight: budget by phase ------------------------------------------------------------------------------------------

const budgetByPhase = [
  row(STAGES.discovery, 200_000),
  row(STAGES.build, 470_000),
  row(STAGES.review, 43_000),
  row(STAGES.done, 21_000),
];

const phaseMeta = { groups: { primary: stageInfos, secondary: null } };

/** Phase × priority (the tooltip screenshot: Discovery = 15k + 45k + 80k + 60k = 200k). */
const budgetByPhasePriority = [
  row(STAGES.discovery, 15_000, PRIORITIES.low),
  row(STAGES.discovery, 45_000, PRIORITIES.medium),
  row(STAGES.discovery, 80_000, PRIORITIES.high),
  row(STAGES.discovery, 60_000, PRIORITIES.critical),
  row(STAGES.build, 30_000, PRIORITIES.medium),
  row(STAGES.build, 190_000, PRIORITIES.high),
  row(STAGES.build, 250_000, PRIORITIES.critical),
  row(STAGES.review, 18_000, PRIORITIES.low),
  row(STAGES.review, 25_000, PRIORITIES.medium),
  row(STAGES.done, 9_000, PRIORITIES.low),
  row(STAGES.done, 12_000, PRIORITIES.medium),
];
const phasePriorityMeta = { groups: { primary: stageInfos, secondary: priorityInfos } };

export const barGrouped: Fixture = {
  id: 'bar-grouped-status',
  title: 'Bar: Budget (Sum) by Phase',
  ctx: chartContext('insights', 'bar'),
  data: pivot('insight', budgetByPhase, phaseMeta),
};

export const barSegmented: Fixture = {
  id: 'bar-segmented',
  title: 'Bar: by Phase, segmented by Priority (stacked)',
  ctx: chartContext('insights', 'bar', { secondary: { title: 'Priority', type: 'select' } }),
  data: pivot('insight', budgetByPhasePriority, phasePriorityMeta),
};

export const barSegmentedGrouped: Fixture = {
  id: 'bar-segmented-grouped',
  title: 'Bar: segmented, "Stack bars" off',
  ctx: chartContext('insights', 'bar', {
    secondary: { title: 'Priority', type: 'select' },
    settings: { barSegmentsStacked: false },
  }),
  data: pivot('insight', budgetByPhasePriority, phasePriorityMeta),
};

export const barTarget: Fixture = {
  id: 'bar-target',
  title: 'Bar with target 300,000, sorted by amount',
  ctx: chartContext('insights', 'bar', { settings: { targetValue: 300_000, sortPreference: 'value_desc' } }),
  data: pivot('insight', budgetByPhase, phaseMeta),
};

export const barCheckbox: Fixture = {
  id: 'bar-checkbox',
  title: 'Bar: count by a checkbox, with a "No" bucket',
  ctx: chartContext('insights', 'bar', {
    metric: COUNT_METRIC,
    primary: { title: 'Strategic', type: 'checkbox', isTime: false },
  }),
  data: pivot('insight', [row('true', 5), row('false', 7), row(null, 1)], {
    groups: {
      primary: [
        { key: 'false', label: 'false', color: null, order: 0 },
        { key: 'true', label: 'true', color: null, order: 1 },
        { key: null, label: null, color: null, order: 2 },
      ],
      secondary: null,
    },
  }),
};

/** Countries: many categories, long labels (rotated, truncated). */
export const barManyCategories: Fixture = {
  id: 'bar-many-categories',
  title: 'Bar: 18 text categories (rotated, truncated labels)',
  ctx: chartContext('insights', 'bar', {
    metric: COUNT_METRIC,
    primary: { title: 'Primary location › Country', type: 'location', isTime: false },
    settings: { sortPreference: 'value_desc' },
  }),
  data: (() => {
    const names = [
      'United States',
      'United Kingdom',
      'Germany',
      'France',
      'Netherlands',
      'Spain',
      'Italy',
      'Poland',
      'Sweden',
      'Norway',
      'Denmark',
      'Finland',
      'Switzerland',
      'Austria',
      'Belgium',
      'Ireland',
      'Portugal',
      'Czech Republic',
    ];
    return pivot(
      'insight',
      names.map((n, i) => row(n, 30 - i, null)),
      { groups: { primary: names.map((n, i) => ({ key: n, label: n, color: null, order: i })), secondary: null } },
    );
  })(),
};

// ---- Insight: date buckets -------------------------------------------------------------------------------------------------

const BUCKETS_2025_10 = [
  '2025-10-01',
  '2025-11-01',
  '2025-12-01',
  '2026-01-01',
  '2026-02-01',
  '2026-03-01',
  '2026-04-01',
  '2026-05-01',
  '2026-06-01',
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
];
const monthlyBudget: [string, number][] = [
  ['2025-12-01', 12_000],
  ['2026-01-01', 9_000],
  ['2026-03-01', 250_000],
  ['2026-04-01', 70_000],
  ['2026-05-01', 18_000],
  ['2026-06-01', 25_000],
  ['2026-07-01', 120_000],
  ['2026-08-01', 30_000],
  ['2026-09-01', 45_000],
  ['2026-10-01', 80_000],
];
const dateMeta = (buckets: string[]) => ({
  resolution: 'month' as const,
  buckets,
  groups: {
    primary: buckets.map((k, order) => ({ key: k, label: k, color: null, order })),
    secondary: null,
  },
});

const startDate = { title: 'Start date', type: 'date' as const, isTime: true };

export const barDate: Fixture = {
  id: 'bar-date-group',
  title: 'Bar: grouped by Start date (All, monthly, "No Start date")',
  ctx: chartContext('insights', 'bar', { primary: startDate, settings: { targetValue: 300_000 } }),
  data: pivot(
    'insight',
    [...monthlyBudget.map(([b, v]) => row(b, v)), row(null, 15_000)],
    dateMeta(BUCKETS_2025_10.slice(2)),
  ),
};

export const barCompare: Fixture = {
  id: 'bar-time-compare',
  title: 'Bar: 6M compared with the previous period',
  ctx: chartContext('insights', 'bar', {
    primary: startDate,
    settings: {
      targetValue: 300_000,
      timeConfig: {
        duration: { type: 'relative', value: '-P0Y6M0DT0H0M0S' },
        resolution: 'month',
        comparison: { type: 'previous_period' },
      },
    } satisfies Partial<InsightSettings>,
  }),
  data: pivot(
    'insight',
    monthlyBudget.map(([b, v]) => row(b, v)),
    dateMeta(BUCKETS_2025_10),
  ),
};

export const barCompareEmpty: Fixture = {
  id: 'bar-compare-empty',
  title: 'Bar: comparison window without data (state)',
  ctx: chartContext('insights', 'bar', {
    primary: startDate,
    settings: {
      timeConfig: {
        duration: { type: 'relative', value: '-P0Y3M0DT0H0M0S' },
        resolution: 'month',
        comparison: { type: 'previous_period' },
      },
    } satisfies Partial<InsightSettings>,
  }),
  data: pivot(
    'insight',
    [row('2026-08-01', 30_000), row('2026-09-01', 45_000), row('2026-10-01', 80_000)],
    dateMeta(['2026-08-01', '2026-09-01', '2026-10-01']),
  ),
};

// ---- Insight: line ---------------------------------------------------------------------------------------------------------

export const lineSingle: Fixture = {
  id: 'line-single',
  title: 'Line: Budget (Sum) by Phase',
  ctx: chartContext('insights', 'line'),
  data: pivot('insight', budgetByPhase, phaseMeta),
};

export const lineSegmentedTarget: Fixture = {
  id: 'line-segmented-target',
  title: 'Line: segmented by Priority, target 300,000',
  ctx: chartContext('insights', 'line', {
    secondary: { title: 'Priority', type: 'select' },
    settings: { targetValue: 300_000 },
  }),
  data: pivot('insight', budgetByPhasePriority, phasePriorityMeta),
};

// ---- Insight: pie, single metric -----------------------------------------------------------------------------------------------

export const pie: Fixture = {
  id: 'pie',
  title: 'Pie: Budget (Sum) by Phase',
  ctx: chartContext('insights', 'pie'),
  data: pivot('insight', budgetByPhase, phaseMeta),
};

export const pieOther: Fixture = {
  id: 'pie-other',
  title: 'Pie: 13 categories (merged into Other)',
  ctx: chartContext('insights', 'pie', {
    metric: COUNT_METRIC,
    primary: { title: 'Company', type: 'entity-reference', isTime: false },
  }),
  data: (() => {
    const names = [
      'Acme',
      'Globex',
      'Initech',
      'Umbrella',
      'Hooli',
      'Stark',
      'Wayne',
      'Wonka',
      'Soylent',
      'Tyrell',
      'Cyberdyne',
      'Aperture',
      'Oscorp',
    ];
    return pivot(
      'insight',
      names.map((n, i) => row(n, 40 - i * 3)),
      { groups: { primary: names.map((n, i) => ({ key: n, label: n, color: null, order: i })), secondary: null } },
    );
  })(),
};

export const pieNegative: Fixture = {
  id: 'pie-negative',
  title: 'Pie with a negative value (state)',
  ctx: chartContext('insights', 'pie'),
  data: pivot('insight', [row(STAGES.discovery, 200_000), row(STAGES.build, -40_000)], phaseMeta),
};

export const singleCount: Fixture = {
  id: 'single-count',
  title: 'Single metric: Count',
  ctx: chartContext('insights', 'single_metric', { metric: COUNT_METRIC, primary: null }),
  data: pivot('insight', [row(null, 12)], { groups: { primary: null, secondary: null } }),
};

export const singleCurrency: Fixture = {
  id: 'single-currency',
  title: 'Single metric: Sum of Budget',
  ctx: chartContext('insights', 'single_metric', { primary: null }),
  data: pivot('insight', [row(null, 734_000)], { groups: { primary: null, secondary: null } }),
};

// ---- Historical values, Stage changed --------------------------------------------------------------------------------------

const HIST_BUCKETS = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
const histMeta = (secondary: DatasetGroupInfo[] | null, buckets = HIST_BUCKETS) => ({
  resolution: 'month' as const,
  buckets,
  groups: { primary: buckets.map((k, order) => ({ key: k, label: k, color: null, order })), secondary },
});

export const historicalSegmented: Fixture = {
  id: 'historical-segmented',
  title: 'Historical bar: Budget (Sum) segmented by Phase',
  ctx: chartContext('historical', 'bar', {
    primary: { title: 'Time', type: null, isTime: true },
    secondary: { title: 'Phase', type: 'pipeline' },
    settings: {
      timeConfig: { duration: { type: 'relative', value: '-P0Y3M0DT0H0M0S' }, resolution: 'month', comparison: null },
    },
  }),
  data: pivot(
    'historical',
    [
      row('2026-10-01', 200_000, STAGES.discovery),
      row('2026-10-01', 470_000, STAGES.build),
      row('2026-10-01', 43_000, STAGES.review),
      row('2026-10-01', 21_000, STAGES.done),
    ],
    histMeta(stageInfos),
  ),
};

export const historicalLine: Fixture = {
  id: 'historical-line',
  title: 'Historical line: Count (single series)',
  ctx: chartContext('historical', 'line', {
    metric: COUNT_METRIC,
    primary: { title: 'Time', type: null, isTime: true },
    secondary: null,
  }),
  data: pivot(
    'historical',
    [row('2026-07-01', 3), row('2026-08-01', 5), row('2026-09-01', 9), row('2026-10-01', 12)],
    histMeta(null),
  ),
};

export const stageChanged: Fixture = {
  id: 'stage-changed',
  title: 'Stage changed: Count by Date changed (stacked by stage)',
  ctx: chartContext('stage-changed', 'bar', {
    metric: COUNT_METRIC,
    primary: { title: 'Date changed', type: null, isTime: true },
    secondary: { title: 'Phase', type: 'pipeline' },
    statusTitle: 'Phase',
  }),
  data: pivot(
    'stage-changed',
    [
      row('2026-10-01', 5, STAGES.discovery),
      row('2026-10-01', 5, STAGES.build),
      row('2026-10-01', 2, STAGES.review),
      row('2026-10-01', 2, STAGES.done),
    ],
    histMeta(stageInfos, ['2026-10-01']),
  ),
};

// ---- Time in stage ----------------------------------------------------------------------------------------------------------------

const H = 3_600_000;
const tis = (stage: string, value: number, group: string | null = null): TimeInStageRow => ({
  stage,
  group,
  value,
  count: 3,
});

const timeInStageMeta = (secondary: DatasetGroupInfo[] | null) => meta({ groups: { primary: stageInfos, secondary } });

const TIS_METRIC: ChartContext['metric'] = {
  format: { kind: 'duration' },
  axisTitle: 'Average time in status',
  tooltipLabel: 'Average time in status',
  singleCaption: 'Average time in status',
  singleSubCaption: 'Phase',
};

export const timeInStage: Fixture = {
  id: 'time-in-stage',
  title: 'Time in stage: average time in status',
  ctx: chartContext('time-in-stage', 'bar', {
    metric: TIS_METRIC,
    statusTitle: 'Phase',
    settings: { barSegmentsStacked: false },
  }),
  data: {
    type: 'time-in-stage',
    rows: [
      tis(STAGES.discovery, 5.47 * H),
      tis(STAGES.build, 5.48 * H),
      tis(STAGES.review, 6.83 * H),
      tis(STAGES.done, 6.83 * H),
    ],
    meta: timeInStageMeta(null),
    freshness,
  },
};

export const timeInStageGrouped: Fixture = {
  id: 'time-in-stage-grouped',
  title: 'Time in stage: grouped by Priority (grouped bars)',
  ctx: chartContext('time-in-stage', 'bar', {
    metric: TIS_METRIC,
    statusTitle: 'Phase',
    secondary: { title: 'Priority', type: 'select' },
    settings: { barSegmentsStacked: false },
  }),
  data: {
    type: 'time-in-stage',
    rows: [
      tis(STAGES.discovery, 3.4 * H, PRIORITIES.medium),
      tis(STAGES.discovery, 6.83 * H, PRIORITIES.low),
      tis(STAGES.discovery, 6.83 * H, PRIORITIES.high),
      tis(STAGES.discovery, 6.83 * H, PRIORITIES.critical),
      tis(STAGES.build, 6.83 * H, PRIORITIES.low),
      tis(STAGES.build, 6.83 * H, PRIORITIES.high),
      tis(STAGES.build, 6.83 * H, PRIORITIES.critical),
      tis(STAGES.review, 6.83 * H, PRIORITIES.medium),
      tis(STAGES.review, 6.83 * H, PRIORITIES.low),
      tis(STAGES.done, 6.83 * H, PRIORITIES.medium),
      tis(STAGES.done, 6.83 * H, PRIORITIES.critical),
    ],
    meta: timeInStageMeta(priorityInfos),
    freshness,
  },
};

// ---- Funnel family -------------------------------------------------------------------------------------------------------------------

const frow = (stage: string | null, count: number, value = count): FunnelRow => ({
  stage,
  count,
  value,
  conversionFromPrevious: null,
  conversionFromFirst: null,
});

const funnelCtx = (visualisationType: 'funnel' | 'steps' | 'metric', over: Parameters<typeof chartContext>[2] = {}) =>
  chartContext('funnel', visualisationType, {
    metric: COUNT_METRIC,
    statusTitle: 'Phase',
    ...over,
  });

const funnelMeta = (rows: FunnelRow[]) =>
  meta({
    groups: {
      primary: [...stageInfos, { key: null, label: null, color: null, order: 4 }].filter((i) =>
        rows.some((r) => r.stage === i.key),
      ),
      secondary: null,
    },
  });

const FUNNEL_ROWS = [frow(STAGES.discovery, 12), frow(STAGES.build, 9), frow(STAGES.review, 4), frow(STAGES.done, 2)];
const FUNNEL_ALL = [frow(null, 12), ...FUNNEL_ROWS];

export const funnel: Fixture = {
  id: 'funnel',
  title: 'Funnel: Discovery 12 → Build 9 → Review 4 → Done 2',
  ctx: funnelCtx('funnel'),
  data: { type: 'funnel', rows: FUNNEL_ROWS, summary: null, meta: funnelMeta(FUNNEL_ROWS), freshness },
};

export const funnelAll: Fixture = {
  id: 'funnel-all-records',
  title: 'Funnel with "All records" (Total)',
  ctx: funnelCtx('funnel'),
  data: { type: 'funnel', rows: FUNNEL_ALL, summary: null, meta: funnelMeta(FUNNEL_ALL), freshness },
};

export const funnelSteps: Fixture = {
  id: 'funnel-steps',
  title: 'Funnel Steps',
  ctx: funnelCtx('steps'),
  data: { type: 'funnel', rows: FUNNEL_ROWS, summary: null, meta: funnelMeta(FUNNEL_ROWS), freshness },
};

export const funnelMetricSum: Fixture = {
  id: 'funnel-metric-budget',
  title: 'Funnel Steps with a metric (Budget sum)',
  ctx: funnelCtx('steps', { metric: metricOf(EUR) }),
  data: {
    type: 'funnel',
    rows: [
      frow(STAGES.discovery, 12, 734_000),
      frow(STAGES.build, 9, 551_000),
      frow(STAGES.review, 4, 90_000),
      frow(STAGES.done, 2, 30_000),
    ],
    summary: null,
    meta: funnelMeta(FUNNEL_ROWS),
    freshness,
  },
};

export const funnelMetric: Fixture = {
  id: 'funnel-metric',
  title: 'Funnel Metric',
  ctx: funnelCtx('metric'),
  data: {
    type: 'funnel-metric',
    rows: FUNNEL_ROWS,
    summary: { steps: [], overallConversion: 2 / 12 },
    meta: funnelMeta(FUNNEL_ROWS),
    freshness,
  },
};

/** Every chart fixture, in gallery order. */
export const FIXTURES: Fixture[] = [
  barGrouped,
  barSegmented,
  barSegmentedGrouped,
  barTarget,
  barCheckbox,
  barManyCategories,
  barDate,
  barCompare,
  lineSingle,
  lineSegmentedTarget,
  pie,
  pieOther,
  singleCount,
  singleCurrency,
  historicalSegmented,
  historicalLine,
  stageChanged,
  timeInStage,
  timeInStageGrouped,
  funnel,
  funnelAll,
  funnelSteps,
  funnelMetricSum,
  funnelMetric,
];

/** Fixtures that end in a state instead of a chart. */
export const STATE_FIXTURES: Fixture[] = [barCompareEmpty, pieNegative];
