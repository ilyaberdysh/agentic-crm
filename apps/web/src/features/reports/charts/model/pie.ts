// The model of a pie chart: slices sorted by value (descending, clockwise from 12 o'clock), the tail merged into "Other".
import type { DatasetOutputFor } from '@agentic-crm/contracts';
import { LABELS } from '../messages';
import type { ChartContext } from '../types';
import type { ChartStateKind } from './cartesian';
import { groupLabel, infoMap, naturalOrder } from './labels';
import { assignGroupColors, type ColorKey } from './palette';
import { CHART_LIMITS } from './settings';

export interface PieSlice {
  /** Group key; null = "No {attribute}"; OTHER_KEY for the merged tail. */
  key: string | null;
  label: string;
  value: number;
  /** Share of the total, 0–100. */
  percent: number;
  color: ColorKey;
  /** Number of groups merged into an "Other" slice. */
  merged?: number;
}

export interface PieModel {
  type: 'pie';
  slices: PieSlice[];
  total: number;
  groupTitle: string;
}

/** Key of the merged "Other" slice (no group can have it: group keys are ids, buckets or raw values). */
export const OTHER_KEY = '\u0000other';

export function buildPieModel(ctx: ChartContext, data: DatasetOutputFor<'pivot'>): PieModel | ChartStateKind {
  const meta = data.meta;
  const attr = ctx.primary ? { title: ctx.primary.title, type: ctx.primary.type } : null;
  const infos = infoMap(meta.groups.primary);
  const byGroup = new Map<string | null, number>();
  for (const r of data.rows) {
    if (r.value === null) continue;
    byGroup.set(r.group, (byGroup.get(r.group) ?? 0) + r.value);
  }
  if (byGroup.size === 0) return { kind: 'empty' };
  if ([...byGroup.values()].some((v) => v < 0)) return { kind: 'negative' };
  if (meta.truncated) return { kind: 'tooMany', nouns: 'segments' };

  const natural = [...byGroup.keys()].sort(naturalOrder(infos));
  const colors = assignGroupColors(
    natural.map((k) => ({ key: k, color: infos.get(k)?.color ?? null })),
    { checkbox: attr?.type === 'checkbox' },
  );
  const index = new Map(natural.map((k, i) => [k, i]));
  const positive = [...byGroup.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || (index.get(a[0]) ?? 0) - (index.get(b[0]) ?? 0));
  const total = positive.reduce((s, [, v]) => s + v, 0);
  if (positive.length === 0 || total <= 0) return { kind: 'empty' };

  const toSlice = ([key, value]: [string | null, number]): PieSlice => ({
    key,
    label: groupLabel(infos.get(key), key, attr),
    value,
    percent: (value / total) * 100,
    color: colors.get(key) ?? 'blue',
  });
  let slices: PieSlice[];
  if (positive.length > CHART_LIMITS.pieSlices) {
    const keep = positive.slice(0, CHART_LIMITS.pieSlices - 1);
    const rest = positive.slice(CHART_LIMITS.pieSlices - 1);
    const other = rest.reduce((s, [, v]) => s + v, 0);
    slices = [
      ...keep.map(toSlice),
      {
        key: OTHER_KEY,
        label: LABELS.other,
        value: other,
        percent: (other / total) * 100,
        color: 'nullGrey',
        merged: rest.length,
      },
    ];
  } else {
    slices = positive.map(toSlice);
  }
  return { type: 'pie', slices, total, groupTitle: ctx.primary?.title ?? '' };
}
