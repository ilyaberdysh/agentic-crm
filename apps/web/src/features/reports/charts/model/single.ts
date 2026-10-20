// The model of the single-metric visualisation.
import type { DatasetOutputFor } from '@agentic-crm/contracts';
import type { ChartContext } from '../types';
import type { ChartStateKind } from './cartesian';
import { formatMetricValue } from './format';

export interface SingleMetricModel {
  type: 'single';
  /** "Single Metric - Sum". */
  caption: string;
  /** "€734,000.00". */
  value: string;
  /** "Records" / the attribute title. */
  subCaption: string;
  raw: number | null;
}

/**
 * The value of an ungrouped pivot (one row). A historical pivot rendered as a single metric carries one row per time
 * bucket: the latest bucket is the current value.
 */
export function buildSingleMetricModel(
  ctx: ChartContext,
  data: DatasetOutputFor<'pivot'>,
): SingleMetricModel | ChartStateKind {
  const rows = data.rows;
  if (rows.length === 0) return { kind: 'empty' };
  let raw: number | null;
  const ungrouped = rows.find((r) => r.group === null && r.segment === null);
  if (ungrouped) raw = ungrouped.value;
  else {
    const latest = [...rows].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '')).at(-1);
    const bucket = latest?.group ?? null;
    const atLatest = rows.filter((r) => r.group === bucket);
    raw = atLatest.every((r) => r.value === null) ? null : atLatest.reduce((s, r) => s + (r.value ?? 0), 0);
  }
  return {
    type: 'single',
    caption: ctx.metric.singleCaption,
    value: formatMetricValue(raw, ctx.metric.format),
    subCaption: ctx.metric.singleSubCaption,
    raw,
  };
}
