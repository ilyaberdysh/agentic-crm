// The time toolbar's model (builder §3.6; H api §1.3 `time_config`): range presets (7D … All, Period to date),
// comparison options and their availability, and the readable window labels. Pure and unit-tested.
import {
  addDurationToDate,
  type ReportTimeConfig,
  type ReportWindowEnv,
  resolveReportWindow,
  type TimeComparison,
  type TimeDuration,
  type TimeResolution,
} from '@agentic-crm/contracts';

export interface RangeOption {
  id: '7D' | '1M' | '3M' | '6M' | '12M' | 'all';
  label: string;
  duration: TimeDuration | null;
}

const rel = (value: string): TimeDuration => ({ type: 'relative', value });

/** 7D, 1M, 3M, 6M, 12M, All (default All); stored as Attio does: negative ISO durations with explicit fields. */
export const RANGES: readonly RangeOption[] = [
  { id: '7D', label: '7D', duration: rel('-P0Y0M7DT0H0M0S') },
  { id: '1M', label: '1M', duration: rel('-P0Y1M0DT0H0M0S') },
  { id: '3M', label: '3M', duration: rel('-P0Y3M0DT0H0M0S') },
  { id: '6M', label: '6M', duration: rel('-P0Y6M0DT0H0M0S') },
  { id: '12M', label: '12M', duration: rel('-P0Y12M0DT0H0M0S') },
  { id: 'all', label: 'All', duration: null },
];

export const PERIODS_TO_DATE = [
  { id: 'week', label: 'Week to date' },
  { id: 'month', label: 'Month to date' },
  { id: 'quarter', label: 'Quarter to date' },
  { id: 'year', label: 'Year to date' },
] as const;

export const RESOLUTIONS: readonly { id: TimeResolution; label: string }[] = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'quarter', label: 'Quarterly' },
  { id: 'year', label: 'Yearly' },
];

/** Months and days of a relative duration (years × 12), for comparing "-P1Y" with "-P0Y12M…". */
function span(value: string): { months: number; days: number } | null {
  const m = /^-?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?/.exec(value);
  if (!m) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  return { months: n(1) * 12 + n(2), days: n(3) * 7 + n(4) };
}

/** The preset a duration is (null = a period to date or something custom). */
export function rangeOf(duration: TimeDuration | null): RangeOption['id'] | null {
  if (!duration) return 'all';
  if (duration.type !== 'relative') return null;
  const a = span(duration.value);
  if (!a) return null;
  for (const r of RANGES) {
    if (r.duration?.type !== 'relative') continue;
    const b = span(r.duration.value);
    if (b && b.months === a.months && b.days === a.days) return r.id;
  }
  return null;
}

// ---- comparison ----------------------------------------------------------------------------------------------------------

export interface ComparisonOption {
  id: string;
  label: string;
  comparison: TimeComparison;
  enabled: boolean;
  /** Tooltip of a disabled option. */
  reason: string | null;
}

const OFFSETS = {
  week: { value: '-P0Y0M7DT0H0M0S', label: 'Previous week' },
  month: { value: '-P0Y1M0DT0H0M0S', label: 'Previous month' },
  quarter: { value: '-P0Y3M0DT0H0M0S', label: 'Previous quarter' },
  year: { value: '-P1Y0M0DT0H0M0S', label: 'Previous year' },
} as const;

const PTD_ONLY = 'Only available for "Period to date" reports';

/** Compare menu entries for a time config (builder §3.6), with the windows they compare to in the labels. */
export function comparisonOptions(config: ReportTimeConfig, env: ReportWindowEnv): ComparisonOption[] {
  const duration = config.duration;
  const toDate = duration?.type === 'x_to_date' ? duration.value : null;
  const out: ComparisonOption[] = [];
  const windowLabel = (c: TimeComparison) => {
    const w = resolveReportWindow({ ...config, comparison: c }, env).comparison;
    return w ? ` ${formatDay(w.start)} - ${formatDay(w.end)}` : '';
  };
  const previous: TimeComparison = { type: 'previous_period' };
  out.push({
    id: 'previous-period',
    label: `Previous period${toDate ? '' : windowLabel(previous)}`,
    comparison: previous,
    enabled: !toDate,
    reason: toDate ? 'Not available for "Period to date" reports' : null,
  });
  for (const unit of ['week', 'month', 'quarter', 'year'] as const) {
    const comparison: TimeComparison = { type: 'offset', value: OFFSETS[unit].value };
    // A period to date compares with its own previous period and with the same period a year earlier.
    const enabled = toDate !== null && (toDate === unit || unit === 'year');
    out.push({
      id: `previous-${unit}`,
      label: `${OFFSETS[unit].label}${enabled ? windowLabel(comparison) : ''}`,
      comparison,
      enabled,
      reason: enabled ? null : PTD_ONLY,
    });
  }
  return out;
}

/** "Previous period", "Previous month" … for the active comparison. */
export function comparisonLabel(config: ReportTimeConfig): string | null {
  const c = config.comparison;
  if (!c) return null;
  if (c.type === 'previous_period') return 'Previous period';
  for (const unit of ['week', 'month', 'quarter', 'year'] as const) {
    if (OFFSETS[unit].value === c.value) return OFFSETS[unit].label;
  }
  const a = span(c.value);
  if (a?.months === 12 && a.days === 0) return 'Previous year';
  return 'Previous period';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "1 Oct 2024". */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Reasons the Compare button is disabled (builder §3.6), else null. */
export function compareDisabledReason(config: ReportTimeConfig, visualisation: string | null): string | null {
  if (!config.duration) return "Comparisons are not supported for the 'All' time period";
  if (visualisation !== 'bar' && visualisation !== 'line') return 'Only line and bar charts support time comparisons';
  return null;
}

/** A new config for a range choice: the comparison stays only while it is still an allowed option. */
export function withDuration(
  config: ReportTimeConfig,
  duration: TimeDuration | null,
  env: ReportWindowEnv,
): ReportTimeConfig {
  const next = { ...config, duration };
  if (!duration || !next.comparison) return { ...next, comparison: null };
  const same = (a: TimeComparison, b: TimeComparison) => JSON.stringify(a) === JSON.stringify(b);
  const keep = comparisonOptions(next, env).some(
    (o) => o.enabled && next.comparison && same(o.comparison, next.comparison),
  );
  return { ...next, comparison: keep ? next.comparison : null };
}

/** End of the window a "Previous year"-style offset points at (tests). */
export function shifted(date: string, offset: string): string {
  return addDurationToDate(date, offset);
}
