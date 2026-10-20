// The model of bar and line charts: Insight (grouped, segmented, date buckets with client-side window and comparison),
// Historical values, Stage changed and Time in stage all reduce to categories (x) × series (segments) × cells.
import type {
  DatasetGroupInfo,
  DatasetOutputFor,
  PivotRow,
  SortPreference,
  TimeResolution,
} from '@agentic-crm/contracts';
import { LABELS } from '../messages';
import type { ChartContext } from '../types';
import { type GroupAttr, groupLabel, infoMap, naturalOrder, noValueLabel } from './labels';
import { assignGroupColors, type ColorKey } from './palette';
import { CHART_LIMITS, chartSettings } from './settings';
import {
  bucketFullLabel,
  bucketLabel,
  bucketRangeLabel,
  insightTimeWindow,
  isPeriodIncomplete,
  spansYears,
} from './time';

export type CartesianKind = 'bar' | 'line';

export interface Category {
  /** The row key of the group (option / stage / record id, bucket start, raw value); null = "No {attribute}". */
  key: string | null;
  /** x-axis label ("Oct", "Discovery"). */
  label: string;
  /** Tooltip / table title ("Oct 2026", "Week commencing 5 Oct 2026"). */
  title: string;
  /** Bar colour when the chart has no segments (option colour, blue for time buckets, categorical otherwise). */
  color: ColorKey;
  /** The bucket is still running. */
  incomplete: boolean;
}

export interface Series {
  /** The row key of the segment; null = the single unsegmented series or "No {attribute}". */
  key: string | null;
  label: string;
  color: ColorKey;
}

export interface Cell {
  value: number | null;
  count: number;
}

export interface Comparison {
  /** Per category: the aligned previous-period value (all segments added up); null = no data. */
  values: (number | null)[];
  /** Per category: the title of the compared bucket ("Mar 2026"). */
  titles: string[];
  /** Legend labels: "Oct 2025 - Apr 2026" and "Apr - Oct". */
  previousRange: string;
  currentRange: string;
}

export interface CartesianModel {
  type: 'cartesian';
  kind: CartesianKind;
  categories: Category[];
  /** Natural (stacking) order: first = bottom of a stack. */
  series: Series[];
  /** Legend order: by total value, descending. Empty when no legend is shown. */
  legend: Series[];
  /** [category][series] */
  cells: Cell[][];
  /** Per category: the sum of its values (the "Bar total"). */
  totals: number[];
  stacked: boolean;
  /** Bars take the colour of their category (no segments). */
  colorByCategory: boolean;
  segmented: boolean;
  comparison: Comparison | null;
  target: number | null;
  axisLabelVisible: boolean;
  isTime: boolean;
  resolution: TimeResolution | null;
  xTitle: string | null;
  yTitle: string;
  /** Tooltip rows: the group attribute title ("Phase") and the segment attribute title ("Priority"). */
  groupTitle: string;
  segmentTitle: string | null;
  /** Value range of the data (stacks, comparison, target included): the y domain is derived from it. */
  range: [number, number];
}

export type ChartStateKind =
  | { kind: 'empty' }
  | { kind: 'noComparison' }
  | { kind: 'negative' }
  /** The visualisation has no renderer (Map). */
  | { kind: 'unsupported' }
  | { kind: 'tooMany'; nouns: string };

const sum = (values: readonly (number | null)[]): number => values.reduce<number>((s, v) => s + (v ?? 0), 0);

/** Adds two values where null = "no value": null only when neither side has one. */
const addNullable = (a: number | null | undefined, b: number | null): number | null =>
  (a === null || a === undefined) && b === null ? null : (a ?? 0) + (b ?? 0);

type PivotOutput = DatasetOutputFor<'pivot'>;
type TimeInStageOutput = DatasetOutputFor<'time-in-stage'>;

/** Rows of a pivot or time-in-stage dataset in one shape: group = x category, segment = series. */
function rowsOf(data: PivotOutput | TimeInStageOutput): PivotRow[] {
  if (data.type === 'pivot') return data.rows;
  return data.rows.map((r) => ({ group: r.stage, segment: r.group, value: r.value, count: r.count }));
}

function sortCategories(
  keys: (string | null)[],
  by: {
    preference: SortPreference | null;
    order: (a: string | null, b: string | null) => number;
    total: (key: string | null) => number;
  },
): (string | null)[] {
  const { preference, order, total } = by;
  const natural = [...keys].sort(order);
  switch (preference) {
    case 'default_desc':
      return natural.reverse();
    case 'value_asc':
      return [...natural].sort((a, b) => total(a) - total(b));
    case 'value_desc':
      return [...natural].sort((a, b) => total(b) - total(a));
    default:
      return natural;
  }
}

/**
 * Builds the model of a bar / line chart; a `ChartStateKind` when there is nothing to draw (no rows, no comparison
 * rows) or too much.
 */
export function buildCartesianModel(
  ctx: ChartContext,
  data: PivotOutput | TimeInStageOutput,
): CartesianModel | ChartStateKind {
  const settings = chartSettings(ctx.report);
  const kind: CartesianKind = ctx.report.visualisationType === 'line' ? 'line' : 'bar';
  const rows = rowsOf(data);
  const meta = data.meta;
  const isTime = Boolean(ctx.primary?.isTime);
  const resolution: TimeResolution | null = isTime
    ? (meta.resolution ?? settings.timeConfig?.resolution ?? 'month')
    : null;
  const env = ctx.env;
  const primaryAttr: GroupAttr | null = ctx.primary ? { title: ctx.primary.title, type: ctx.primary.type } : null;
  const secondaryAttr: GroupAttr | null = ctx.secondary;
  const primaryInfos = infoMap(meta.groups.primary);
  const secondaryInfos = infoMap(meta.groups.secondary);
  const segmented = Boolean(secondaryAttr);

  // ---- categories ----------------------------------------------------------------------------------------------------
  let keys: (string | null)[];
  let comparisonKeys: string[] | null = null;
  let currentBuckets: string[] = [];
  const hasComparisonRequest =
    isTime && Boolean(settings.timeConfig?.comparison) && settings.timeConfig?.duration !== null;
  if (isTime && resolution) {
    const fetched =
      meta.buckets ?? [...new Set(rows.map((r) => r.group).filter((g): g is string => g !== null))].sort();
    if (data.type === 'pivot' && data.variant === 'insight' && settings.timeConfig) {
      const w = insightTimeWindow(settings.timeConfig, fetched, env);
      currentBuckets = w.buckets;
      comparisonKeys = w.comparisonBuckets;
      keys = [...w.buckets];
      if (w.open && rows.some((r) => r.group === null)) keys.push(null);
    } else {
      currentBuckets = fetched;
      comparisonKeys = meta.comparisonBuckets ?? null;
      keys = [...fetched];
    }
  } else {
    keys = [...new Set(rows.map((r) => r.group))];
  }

  // Cell values by (group, segment).
  const cellMap = new Map<string, Cell>();
  const cellKey = (g: string | null, s: string | null) => `${g ?? '∅'}\u0001${s ?? '∅'}`;
  const known = new Set(keys);
  for (const r of rows) {
    if (!known.has(r.group)) continue;
    const k = cellKey(r.group, r.segment);
    const prev = cellMap.get(k);
    cellMap.set(k, { value: addNullable(prev?.value, r.value), count: (prev?.count ?? 0) + r.count });
  }

  // ---- series ----------------------------------------------------------------------------------------------------------
  let segmentKeys: (string | null)[] = [null];
  if (segmented) {
    const present = new Set<string | null>();
    for (const r of rows) if (known.has(r.group)) present.add(r.segment);
    // The "No {attribute}" segment only counts when some record falls into it (the server returns zero rows for it).
    if (present.has(null) && !rows.some((r) => r.segment === null && r.count > 0 && known.has(r.group))) {
      present.delete(null);
    }
    segmentKeys = [...present].sort(naturalOrder(secondaryInfos));
  }
  const valueOf = (g: string | null, s: string | null): number | null => cellMap.get(cellKey(g, s))?.value ?? null;
  const totalOf = (g: string | null): number => sum(segmentKeys.map((s) => valueOf(g, s)));

  // Zero categories ("Show zeros" off hides what is 0).
  if (!settings.zerosVisible) {
    keys = keys.filter((g) => segmentKeys.some((s) => (valueOf(g, s) ?? 0) !== 0));
  }
  if (keys.length === 0 || rows.length === 0) return { kind: 'empty' };

  // Series colours follow the natural (option) order; side-by-side bars are then ordered like the legend (by total).
  const seriesColors = segmented
    ? assignGroupColors(
        segmentKeys.map((k) => ({ key: k, color: secondaryInfos.get(k)?.color ?? null })),
        { checkbox: secondaryAttr?.type === 'checkbox' },
      )
    : null;
  if (kind === 'bar' && segmented && !settings.barSegmentsStacked) {
    const natural = new Map(segmentKeys.map((k, i) => [k, i]));
    const segTotal = (seg: string | null) => sum(keys.map((g) => valueOf(g, seg)));
    segmentKeys = [...segmentKeys].sort(
      (a, b) => segTotal(b) - segTotal(a) || (natural.get(a) ?? 0) - (natural.get(b) ?? 0),
    );
  }

  // ---- order -----------------------------------------------------------------------------------------------------------
  if (!isTime) {
    keys = sortCategories(keys, {
      preference: kind === 'bar' ? settings.sortPreference : null,
      order: naturalOrder(primaryInfos),
      total: totalOf,
    });
  }

  // ---- colours & labels -----------------------------------------------------------------------------------------------
  const spans = spansYears(currentBuckets);
  const primaryColors = isTime
    ? null
    : assignGroupColors(
        keys.map((k) => ({ key: k, color: primaryInfos.get(k)?.color ?? null })),
        { checkbox: primaryAttr?.type === 'checkbox' },
      );
  const categories: Category[] = keys.map((key) => {
    if (isTime && resolution) {
      if (key === null) {
        const label = noValueLabel(primaryAttr);
        return { key, label, title: label, color: 'nullGrey', incomplete: false };
      }
      return {
        key,
        label: bucketLabel(key, resolution, spans),
        title: bucketFullLabel(key, resolution),
        color: 'blue',
        incomplete: isPeriodIncomplete(key, resolution, env),
      };
    }
    const label = groupLabel(primaryInfos.get(key), key, primaryAttr);
    return { key, label, title: label, color: primaryColors?.get(key) ?? 'blue', incomplete: false };
  });

  const series: Series[] = segmentKeys.map((key) =>
    segmented
      ? {
          key,
          label: groupLabel(secondaryInfos.get(key) as DatasetGroupInfo | undefined, key, secondaryAttr),
          color: seriesColors?.get(key) ?? 'blue',
        }
      : { key, label: ctx.metric.tooltipLabel, color: 'blue' },
  );

  const cells: Cell[][] = keys.map((g) =>
    segmentKeys.map((s) => cellMap.get(cellKey(g, s)) ?? { value: null, count: 0 }),
  );
  const totals = keys.map(totalOf);

  // ---- comparison ------------------------------------------------------------------------------------------------------
  let comparison: Comparison | null = null;
  if (hasComparisonRequest && resolution) {
    const mapped = keys.map((g) => (g === null ? -1 : currentBuckets.indexOf(g)));
    const values: (number | null)[] = [];
    const titles: string[] = [];
    if (data.type === 'pivot' && data.variant === 'insight') {
      // Client side: every bucket was fetched; the comparison bucket is the one at the same position of its window.
      const byBucket = new Map<string, number | null>();
      for (const r of rows) {
        if (r.group !== null) byBucket.set(r.group, addNullable(byBucket.get(r.group), r.value));
      }
      mapped.forEach((i) => {
        const b = i >= 0 ? comparisonKeys?.[i] : undefined;
        values.push(b !== undefined && byBucket.has(b) ? (byBucket.get(b) ?? null) : null);
        titles.push(b !== undefined ? bucketFullLabel(b, resolution) : '');
      });
    } else {
      const byBucket = new Map<string, number | null>();
      for (const r of data.type === 'pivot' ? (data.comparisonRows ?? []) : []) {
        if (r.group !== null) byBucket.set(r.group, addNullable(byBucket.get(r.group), r.value));
      }
      mapped.forEach((i) => {
        const bucket = i >= 0 ? currentBuckets[i] : undefined;
        values.push(bucket !== undefined && byBucket.has(bucket) ? (byBucket.get(bucket) ?? null) : null);
        const compared = i >= 0 ? comparisonKeys?.[i] : undefined;
        titles.push(compared !== undefined ? bucketFullLabel(compared, resolution) : '');
      });
    }
    if (values.every((v) => v === null)) return { kind: 'noComparison' };
    const prevBuckets = comparisonKeys ?? [];
    comparison = {
      values,
      titles,
      previousRange: bucketRangeLabel(prevBuckets, resolution),
      currentRange: bucketRangeLabel(currentBuckets, resolution),
    };
  }

  // ---- legend ----------------------------------------------------------------------------------------------------------
  const seriesTotal = (si: number) => sum(cells.map((row) => row[si]?.value ?? null));
  const legend =
    segmented && series.length > 1
      ? series
          .map((s, i) => ({ s, i, total: seriesTotal(i) }))
          .sort((a, b) => b.total - a.total || a.i - b.i)
          .map((x) => x.s)
      : [];

  // ---- limits ----------------------------------------------------------------------------------------------------------
  if (meta.truncated)
    return { kind: 'tooMany', nouns: kind === 'line' ? 'points' : segmented ? 'bar segments' : 'bars' };
  if (kind === 'bar' && categories.length > CHART_LIMITS.bars) return { kind: 'tooMany', nouns: 'bars' };
  if (kind === 'bar' && categories.length * series.length > CHART_LIMITS.barSegments) {
    return { kind: 'tooMany', nouns: 'bar segments' };
  }
  if (kind === 'line' && categories.length * series.length > CHART_LIMITS.points)
    return { kind: 'tooMany', nouns: 'points' };

  // ---- range -----------------------------------------------------------------------------------------------------------
  const stacked = kind === 'bar' && segmented && settings.barSegmentsStacked;
  const all: number[] = [];
  cells.forEach((row, ci) => {
    if (stacked) {
      all.push(sum(row.map((c) => (c.value !== null && c.value > 0 ? c.value : 0))));
      all.push(sum(row.map((c) => (c.value !== null && c.value < 0 ? c.value : 0))));
    } else {
      for (const c of row) if (c.value !== null) all.push(c.value);
    }
    const prev = comparison?.values[ci];
    if (prev !== null && prev !== undefined) all.push(prev);
  });
  if (settings.targetValue !== null) all.push(settings.targetValue);
  const range: [number, number] = [Math.min(0, ...all), Math.max(0, ...all)];

  return {
    type: 'cartesian',
    kind,
    categories,
    series,
    legend,
    cells,
    totals,
    stacked,
    colorByCategory: !segmented && kind === 'bar',
    segmented,
    comparison,
    target: settings.targetValue,
    axisLabelVisible: settings.axisLabelVisible,
    isTime,
    resolution,
    xTitle: comparison ? LABELS.time : (ctx.primary?.title ?? null),
    yTitle: ctx.metric.axisTitle,
    groupTitle: ctx.primary?.title ?? '',
    segmentTitle: segmented ? (secondaryAttr?.title ?? null) : null,
    range,
  };
}
