// Tooltip contents per chart type (chart-types §2/§3): plain data the view draws as the dark/light card.
import { LABELS } from '../messages';
import type { ChartContext } from '../types';
import type { CartesianModel } from './cartesian';
import { changePercent, formatChange, formatMetricValue, formatPercentValue } from './format';
import type { FunnelModel, FunnelStage } from './funnel';
import type { ColorKey } from './palette';
import type { PieModel, PieSlice } from './pie';

export type TipRow =
  | { kind: 'title'; text: string }
  | { kind: 'row'; label: string; value: string }
  | { kind: 'divider' }
  | { kind: 'note'; text: string };

export interface TipBlock {
  /** The 4 px rule on the left. */
  color: ColorKey;
  rows: TipRow[];
}

export interface TooltipContent {
  /** A line above the blocks: "Budget (Sum)" + the change badge of a comparison. */
  header?: { text: string; badge?: { text: string; tone: 'down' | 'up' | 'flat' } };
  blocks: TipBlock[];
}

const title = (text: string): TipRow => ({ kind: 'title', text });
const row = (label: string, value: string): TipRow => ({ kind: 'row', label, value });
const note = (text: string): TipRow => ({ kind: 'note', text });
const DIVIDER: TipRow = { kind: 'divider' };

/**
 * Tooltip of a bar segment / line point. `si` = the hovered series (null: the whole bar, e.g. a comparison band).
 * Segmented stacked bars end with the "Bar total"; a comparison shows the current and the previous bucket with the
 * change badge.
 */
export function cartesianTooltip(ctx: ChartContext, m: CartesianModel, ci: number, si: number | null): TooltipContent {
  const cat = m.categories[ci];
  if (!cat) return { blocks: [] };
  const fmt = (v: number | null) => formatMetricValue(v, ctx.metric.format);
  const series = si === null ? undefined : m.series[si];
  const cell = si === null ? undefined : m.cells[ci]?.[si];
  const color: ColorKey = m.segmented ? (series?.color ?? 'blue') : m.colorByCategory ? cat.color : 'blue';

  if (m.comparison) {
    const current = m.segmented ? (m.totals[ci] ?? null) : (m.cells[ci]?.[0]?.value ?? null);
    const previous = m.comparison.values[ci] ?? null;
    const change = changePercent(current, previous);
    const text = formatChange(change);
    const current_rows: TipRow[] = [title(cat.title), row(ctx.metric.tooltipLabel, fmt(current))];
    if (cat.incomplete) current_rows.push(note(LABELS.periodIncomplete));
    return {
      header: {
        text: ctx.metric.tooltipLabel,
        badge: text ? { text, tone: change === null || change === 0 ? 'flat' : change < 0 ? 'down' : 'up' } : undefined,
      },
      blocks: [
        { color: m.colorByCategory ? cat.color : 'blue', rows: current_rows },
        { color: 'cyan', rows: [title(m.comparison.titles[ci] ?? ''), row(ctx.metric.tooltipLabel, fmt(previous))] },
      ],
    };
  }

  const rows: TipRow[] = [
    title(cat.title),
    row(ctx.metric.tooltipLabel, fmt(cell?.value ?? m.cells[ci]?.[0]?.value ?? null)),
  ];
  if (m.segmented && series) rows.push(row(m.segmentTitle ?? '', series.label));
  if (m.segmented && m.stacked) {
    rows.push(DIVIDER, row(LABELS.barTotal, fmt(m.totals[ci] ?? null)));
  }
  if (cat.incomplete) rows.push(note(LABELS.periodIncomplete));
  return { blocks: [{ color, rows }] };
}

/** "{group}" / "{attribute}" / "{agg}" + value / "{pct} %" "of overall". */
export function pieTooltip(ctx: ChartContext, m: PieModel, slice: PieSlice): TooltipContent {
  return {
    blocks: [
      {
        color: slice.color,
        rows: [
          row(m.groupTitle, slice.label),
          row(ctx.metric.tooltipLabel, formatMetricValue(slice.value, ctx.metric.format)),
          row(LABELS.ofOverall, formatPercentValue(slice.percent)),
        ],
      },
    ],
  };
}

/** "{stage}" / "Converted" + % / "{plural}" + count / divider / "Drop-off" + % / "{plural}" + count. */
export function funnelTooltip(m: FunnelModel, stage: FunnelStage): TooltipContent {
  const fmt = (v: number | null) => formatMetricValue(v, m.valueFormat);
  return {
    blocks: [
      {
        color: 'blue',
        rows: [
          title(stage.label),
          row(LABELS.converted, formatPercentValue(stage.converted)),
          row(m.valueLabel, fmt(stage.value)),
          DIVIDER,
          row(LABELS.dropOff, formatPercentValue(stage.dropOff)),
          row(m.valueLabel, fmt(stage.dropValue)),
        ],
      },
    ],
  };
}
