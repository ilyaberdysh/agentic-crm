// The calculated-values table under the chart (builder §3.7) and its CSV export: the table follows the chart's own
// order, filters (window, zeros, included groups) and colours, so a row and the chart element it describes line up.
import type { DatasetOutput } from '@agentic-crm/contracts';
import { LABELS } from '../messages';
import type { ChartContext } from '../types';
import type { CartesianModel } from './cartesian';
import { formatMetricValue, formatPercentValue } from './format';
import type { FunnelModel } from './funnel';
import { cellHighlightKey, groupHighlightKey } from './keys';
import type { ColorKey } from './palette';
import type { PieModel } from './pie';
import { buildChart } from './plan';
import { commencingTitle } from './time';

export interface TableColumn {
  key: string;
  title: string;
  align: 'left' | 'right';
}

export interface TableCell {
  /** Formatted text ("€470,000.00"). */
  text: string;
  /** Machine value for CSV (numbers stay numbers, no grouping). */
  raw: string | number | null;
}

export interface TableRow {
  /** Highlight key shared with the chart (`groupHighlightKey` / `cellHighlightKey`). */
  key: string;
  cells: TableCell[];
  /** Colour dot before the first cell. */
  swatch: ColorKey | null;
  /** "Period incomplete". */
  flag?: string;
}

export interface CalculatedTable {
  columns: TableColumn[];
  rows: TableRow[];
}

const text = (t: string): TableCell => ({ text: t, raw: t });
const num = (value: number | null, formatted: string): TableCell => ({ text: formatted, raw: value });

function cartesianTable(ctx: ChartContext, m: CartesianModel): CalculatedTable {
  const fmt = (v: number | null) => formatMetricValue(v, ctx.metric.format);
  const first = m.isTime && m.resolution ? commencingTitle(m.resolution) : m.groupTitle;
  const columns: TableColumn[] = [{ key: 'group', title: first, align: 'left' }];
  if (m.segmented) columns.push({ key: 'segment', title: m.segmentTitle ?? '', align: 'left' });
  columns.push({ key: 'value', title: m.yTitle, align: 'right' });
  if (m.comparison) {
    columns.push({ key: 'previous', title: LABELS.previousPeriod, align: 'right' });
  }
  const rows: TableRow[] = [];
  m.categories.forEach((cat, ci) => {
    const flag = cat.incomplete ? LABELS.periodIncomplete : undefined;
    const previous = m.comparison ? num(m.comparison.values[ci] ?? null, fmt(m.comparison.values[ci] ?? null)) : null;
    if (m.segmented) {
      m.series.forEach((s, si) => {
        const cell = m.cells[ci]?.[si];
        if (!cell || cell.value === null) return;
        rows.push({
          key: cellHighlightKey(cat.key, s.key),
          swatch: s.color,
          flag,
          cells: [text(cat.title), text(s.label), num(cell.value, fmt(cell.value))],
        });
      });
      return;
    }
    const value = m.cells[ci]?.[0]?.value ?? null;
    rows.push({
      key: groupHighlightKey(cat.key),
      swatch: m.colorByCategory ? cat.color : 'blue',
      flag,
      cells: [text(cat.title), num(value, fmt(value)), ...(previous ? [previous] : [])],
    });
  });
  return { columns, rows };
}

function pieTable(ctx: ChartContext, m: PieModel): CalculatedTable {
  return {
    columns: [
      { key: 'group', title: m.groupTitle, align: 'left' },
      { key: 'value', title: ctx.metric.axisTitle, align: 'right' },
    ],
    rows: m.slices.map((s) => ({
      key: groupHighlightKey(s.key),
      swatch: s.color,
      cells: [text(s.label), num(s.value, formatMetricValue(s.value, ctx.metric.format))],
    })),
  };
}

function funnelTable(ctx: ChartContext, m: FunnelModel): CalculatedTable {
  return {
    columns: [
      { key: 'stage', title: ctx.primary?.title ?? 'Stage', align: 'left' },
      { key: 'value', title: m.valueLabel, align: 'right' },
      { key: 'converted', title: LABELS.converted, align: 'right' },
      { key: 'dropOff', title: LABELS.dropOff, align: 'right' },
    ],
    rows: m.stages.map((s) => ({
      key: groupHighlightKey(s.key),
      swatch: 'blue',
      cells: [
        text(s.label),
        num(s.value, formatMetricValue(s.value, m.valueFormat)),
        num(s.converted === null ? null : Math.round(s.converted * 100) / 100, formatPercentValue(s.converted)),
        num(s.dropOff === null ? null : Math.round(s.dropOff * 100) / 100, formatPercentValue(s.dropOff)),
      ],
    })),
  };
}

/** The table of a chart, or null when the chart has nothing to list (a state, a single value). */
export function calculatedTable(ctx: ChartContext, data: DatasetOutput): CalculatedTable | null {
  const plan = buildChart(ctx, data);
  switch (plan.type) {
    case 'cartesian':
      return cartesianTable(ctx, plan);
    case 'pie':
      return pieTable(ctx, plan);
    case 'funnel':
    case 'steps':
      return funnelTable(ctx, plan);
    case 'funnel-metric':
      return {
        columns: [
          { key: 'stage', title: ctx.primary?.title ?? 'Stage', align: 'left' },
          { key: 'converted', title: LABELS.converted, align: 'right' },
        ],
        rows: plan.stages.map((s) => ({
          key: groupHighlightKey(s.key),
          swatch: 'blue',
          cells: [
            text(s.label),
            num(s.converted === null ? null : Math.round(s.converted * 100) / 100, formatPercentValue(s.converted)),
          ],
        })),
      };
    case 'single':
      return {
        columns: [{ key: 'value', title: ctx.metric.axisTitle, align: 'right' }],
        rows: [{ key: groupHighlightKey(null), swatch: 'blue', cells: [num(plan.raw, plan.value)] }],
      };
    default:
      return null;
  }
}

const csvEscape = (v: string | number | null): string => {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** RFC 4180 CSV of a table (header row, then the machine values; no grouping separators in numbers). */
export function csvOf(table: CalculatedTable): string {
  const lines = [table.columns.map((c) => csvEscape(c.title)).join(',')];
  for (const row of table.rows) lines.push(row.cells.map((c) => csvEscape(c.raw)).join(','));
  return lines.join('\r\n');
}
