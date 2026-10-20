// The chart-relevant settings of a report, read from any report type's settings object.
import type { ReportTimeConfig, SortPreference } from '@agentic-crm/contracts';
import type { ChartReport } from '../types';

export interface ChartSettings {
  axisLabelVisible: boolean;
  /** Insight only (other types always draw zero categories). */
  zerosVisible: boolean;
  barSegmentsStacked: boolean;
  sortPreference: SortPreference | null;
  targetValue: number | null;
  /** null for funnels. */
  timeConfig: ReportTimeConfig | null;
}

const bool = (o: Record<string, unknown>, key: string, fallback: boolean): boolean =>
  typeof o[key] === 'boolean' ? (o[key] as boolean) : fallback;

export function chartSettings(report: ChartReport): ChartSettings {
  const s = report.settings as unknown as Record<string, unknown>;
  const target = s.targetValue;
  return {
    axisLabelVisible: bool(s, 'axisLabelVisible', true),
    zerosVisible: bool(s, 'zerosVisible', true),
    barSegmentsStacked: bool(s, 'barSegmentsStacked', true),
    sortPreference: (s.sortPreference as SortPreference | null | undefined) ?? null,
    targetValue: typeof target === 'number' && Number.isFinite(target) ? target : null,
    timeConfig: (s.timeConfig as ReportTimeConfig | undefined) ?? null,
  };
}

/** Limits above which a chart refuses to draw ("Too many bars"); the nouns follow chart-types §2. */
export const CHART_LIMITS = {
  /** Bars (categories) of a bar chart. */
  bars: 100,
  /** Bar segments (categories × series) of a bar chart. */
  barSegments: 500,
  /** Points (categories × series) of a line chart. */
  points: 500,
  /** Funnel stages / steps. */
  funnelStages: 24,
  /** Pie slices drawn before the rest is merged into "Other". */
  pieSlices: 10,
} as const;
