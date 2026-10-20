// Time buckets: labels ("Oct", "Dec 2025", "Week commencing 5 Oct 2026"), the in-progress bucket, and the client-side
// window / comparison of Insight reports that group by a date or timestamp (builder §3.6: Insight fetches every bucket;
// the duration and the comparison are applied on the client).
import {
  bucketStartOf,
  bucketsBetween,
  type ReportTimeConfig,
  resolveReportWindow,
  type TimeResolution,
} from '@agentic-crm/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function parts(bucket: string): { y: number; m: number; d: number } {
  const [y, m, d] = bucket.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

export const yearOf = (bucket: string): number => parts(bucket).y;

/** Whether a list of buckets crosses a year boundary (labels then carry the year). */
export function spansYears(buckets: readonly string[]): boolean {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return first !== undefined && last !== undefined && yearOf(first) !== yearOf(last);
}

/** "5 Oct 2026". */
export function formatDay(bucket: string): string {
  const { y, m, d } = parts(bucket);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Axis label of a bucket: "Oct", "Dec 2025", "5 Oct", "Q4", "2026" (the year is added when the range spans years). */
export function bucketLabel(bucket: string, resolution: TimeResolution, withYear: boolean): string {
  const { y, m, d } = parts(bucket);
  switch (resolution) {
    case 'year':
      return String(y);
    case 'quarter':
      return `Q${Math.floor((m - 1) / 3) + 1}${withYear ? ` ${y}` : ''}`;
    case 'month':
      return `${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
    case 'week':
    case 'day':
      return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
  }
}

/** Tooltip / table label of a bucket: "Sep 2026", "Week commencing 5 Oct 2026", "5 Oct 2026", "Q3 2026", "2026". */
export function bucketFullLabel(bucket: string, resolution: TimeResolution): string {
  if (resolution === 'week') return `Week commencing ${formatDay(bucket)}`;
  if (resolution === 'day') return formatDay(bucket);
  return bucketLabel(bucket, resolution, true);
}

/** Column title of a bucket column in tables: "Month commencing". */
export function commencingTitle(resolution: TimeResolution): string {
  const name = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }[resolution];
  return `${name} commencing`;
}

/** "Oct 2025 - Apr 2026" / "Apr - Oct": the range of a list of buckets (years only when it spans years). */
export function bucketRangeLabel(buckets: readonly string[], resolution: TimeResolution): string {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (first === undefined || last === undefined) return '';
  const withYear = resolution === 'year' ? true : spansYears(buckets);
  const a = bucketLabel(first, resolution, withYear);
  const b = bucketLabel(last, resolution, withYear);
  return a === b ? a : `${a} - ${b}`;
}

/** The bucket containing `today` is still running ("Period incomplete"). */
export function isPeriodIncomplete(
  bucket: string,
  resolution: TimeResolution,
  env: { today: string; weekStart: number },
): boolean {
  return bucketStartOf(env.today, resolution, env.weekStart) === bucket;
}

export interface InsightTimeWindow {
  /** Buckets drawn (the window; every fetched bucket for "All"). */
  buckets: string[];
  /** The comparison window's buckets, aligned by index to `buckets` (null = no comparison). */
  comparisonBuckets: string[] | null;
  /** All = the duration is open (the "No {attribute}" bucket stays in). */
  open: boolean;
}

/**
 * Applies the duration and the comparison of an Insight's time config to the fetched buckets. "All" keeps every
 * bucket; a range draws every bucket of the window (empty ones included, as Attio) and aligns the comparison window's
 * buckets to them by position.
 */
export function insightTimeWindow(
  timeConfig: ReportTimeConfig,
  fetched: readonly string[],
  env: { today: string; weekStart: number },
): InsightTimeWindow {
  const window = resolveReportWindow(timeConfig, env);
  if (!window.start || !window.end) return { buckets: [...fetched], comparisonBuckets: null, open: true };
  const resolution = timeConfig.resolution;
  const buckets = bucketsBetween(window.start, window.end, resolution, env.weekStart);
  const comparisonBuckets = window.comparison
    ? bucketsBetween(window.comparison.start, window.comparison.end, resolution, env.weekStart)
    : null;
  return { buckets, comparisonBuckets, open: false };
}
