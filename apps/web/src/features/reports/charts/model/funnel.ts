// The models of the funnel family: Funnel (area), Funnel Steps (bars) and Funnel Metric (one conversion figure).
import type { DatasetOutputFor, FunnelRow } from '@agentic-crm/contracts';
import { LABELS } from '../messages';
import type { ChartContext, ValueFormat } from '../types';
import type { ChartStateKind } from './cartesian';
import { formatMetricValue, formatPercentValue } from './format';
import { groupLabel, infoMap } from './labels';
import { CHART_LIMITS } from './settings';

export interface FunnelStage {
  /** Stage id; null = "All records" ("Total"). */
  key: string | null;
  label: string;
  /** Count, or the aggregate of the funnel's metric. */
  value: number | null;
  /** Records behind the value. */
  count: number;
  /** value ÷ the largest value, 0–1 (the height of the stage). */
  height: number;
  /** Converted from the previous stage, 0–100 (the first stage is 100). */
  converted: number | null;
  /** Dropped off against the previous stage, 0–100 and in value units. */
  dropOff: number | null;
  dropValue: number | null;
  previousValue: number | null;
}

export interface FunnelModel {
  type: 'funnel' | 'steps';
  stages: FunnelStage[];
  /** Tooltip row label of a stage's value: the object plural ("Projects") or the metric ("Budget (Sum)"). */
  valueLabel: string;
  valueFormat: ValueFormat;
}

export interface FunnelMetricModel {
  type: 'funnel-metric';
  caption: string;
  /** "17 %". */
  value: string;
  percent: number | null;
  /** Stage labels of the path ("Total", "Discovery", …). */
  path: string[];
  stages: FunnelStage[];
}

type FunnelOutput = DatasetOutputFor<'funnel'> | DatasetOutputFor<'funnel-metric'>;

function stagesOf(ctx: ChartContext, data: FunnelOutput): FunnelStage[] {
  const infos = infoMap(data.meta.groups.primary);
  const attr = ctx.primary ? { title: ctx.primary.title, type: ctx.primary.type } : null;
  const rows: FunnelRow[] = data.rows;
  const max = rows.reduce((m, r) => Math.max(m, r.value ?? 0), 0);
  return rows.map((r, i) => {
    const previous = i > 0 ? (rows[i - 1]?.value ?? null) : null;
    const value = r.value;
    const converted =
      i === 0 ? 100 : previous !== null && previous > 0 && value !== null ? (value / previous) * 100 : null;
    return {
      key: r.stage,
      label: r.stage === null ? LABELS.total : groupLabel(infos.get(r.stage), r.stage, attr),
      value,
      count: r.count,
      height: max > 0 && value !== null ? Math.max(0, value) / max : 0,
      converted,
      dropOff: i === 0 ? 0 : converted === null ? null : 100 - converted,
      dropValue: i === 0 ? 0 : previous !== null && value !== null ? previous - value : null,
      previousValue: previous,
    };
  });
}

export function buildFunnelModel(ctx: ChartContext, data: FunnelOutput): FunnelModel | ChartStateKind {
  const stages = stagesOf(ctx, data);
  const steps = ctx.report.visualisationType === 'steps';
  if (stages.length === 0 || stages.every((s) => !s.value)) return { kind: 'empty' };
  if (stages.length > CHART_LIMITS.funnelStages || data.meta.truncated) {
    return { kind: 'tooMany', nouns: steps ? 'funnel steps' : 'funnel stages' };
  }
  const withMetric = ctx.metric.singleSubCaption !== LABELS.records;
  return {
    type: steps ? 'steps' : 'funnel',
    stages,
    valueLabel: withMetric ? ctx.metric.tooltipLabel : ctx.sourcePlural,
    valueFormat: ctx.metric.format,
  };
}

export function buildFunnelMetricModel(ctx: ChartContext, data: FunnelOutput): FunnelMetricModel | ChartStateKind {
  const stages = stagesOf(ctx, data);
  if (stages.length === 0 || stages.every((s) => !s.value)) return { kind: 'empty' };
  const first = stages[0]?.value ?? null;
  const last = stages[stages.length - 1]?.value ?? null;
  const summary = data.type === 'funnel-metric' ? data.summary?.overallConversion : null;
  const fraction = summary ?? (first !== null && first > 0 && last !== null ? last / first : null);
  const percent = fraction === null ? null : fraction * 100;
  return {
    type: 'funnel-metric',
    caption: `Funnel Metric - ${ctx.statusTitle ?? ctx.primary?.title ?? 'Stage'}`,
    value: formatPercentValue(percent),
    percent,
    path: stages.map((s) => s.label),
    stages,
  };
}

/** A stage's value in the funnel's metric format ("12", "€43,000.00"). */
export const formatStageValue = (model: FunnelModel, value: number | null): string =>
  formatMetricValue(value, model.valueFormat);
