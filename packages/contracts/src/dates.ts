// Calendar rules shared by the client and the server (decisions X-09 / X-10 in slice3-contracts.md, CROSS-DOMAIN
// B.24): local days in an IANA time zone, the user's week start (default from the locale), task deadline buckets and
// creation-date buckets. One implementation for tasks, notes date buckets and (later) reports.
//
// Week days are numbered like Date#getUTCDay(): 0 = Sunday … 6 = Saturday.

export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Regions whose week starts on Sunday / Saturday (CLDR weekData, abridged); everything else starts on Monday. */
const SUNDAY_REGIONS = new Set([
  'US',
  'CA',
  'MX',
  'BR',
  'JP',
  'KR',
  'TW',
  'HK',
  'MO',
  'IL',
  'IN',
  'PH',
  'TH',
  'ZA',
  'AU',
  'NZ',
  'SA',
  'PE',
  'CO',
  'VE',
  'GT',
  'HN',
  'NI',
  'PA',
  'PR',
  'DO',
  'SV',
  'JM',
  'KE',
  'ZW',
  'PK',
  'BT',
  'NP',
  'KH',
  'LA',
  'MM',
  'ID',
  'SG',
]);
const SATURDAY_REGIONS = new Set([
  'AE',
  'AF',
  'BH',
  'DJ',
  'DZ',
  'EG',
  'IQ',
  'IR',
  'JO',
  'KW',
  'LY',
  'OM',
  'QA',
  'SD',
  'SY',
]);
/** Region assumed for a bare language tag ("en" → US, "ru" → RU). */
const DEFAULT_REGION: Record<string, string> = { en: 'US', ja: 'JP', ko: 'KR', he: 'IL', pt: 'BR', zh: 'CN', ar: 'SA' };

/** Week start for a BCP 47 locale: ru / most of Europe → Monday, en-US → Sunday (X-10 default). */
export function weekStartForLocale(locale: string | null | undefined): WeekDay {
  if (!locale) return 1;
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return (info.firstDay % 7) as WeekDay;
    const region = loc.region ?? DEFAULT_REGION[loc.language] ?? '';
    if (SUNDAY_REGIONS.has(region)) return 0;
    if (SATURDAY_REGIONS.has(region)) return 6;
    return 1;
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Local days in a time zone

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function wallOf(instant: number, timeZone: string): Wall {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    y: parts.year as number,
    mo: parts.month as number,
    d: parts.day as number,
    h: (parts.hour as number) % 24,
    mi: parts.minute as number,
    s: parts.second as number,
  };
}

const wallMs = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);

/** Instant (ms) of local midnight starting `date` in the zone (a midnight skipped by DST resolves forward). */
function midnight(date: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d);
  const offset = (t: number) => wallMs(wallOf(t, timeZone)) - Math.floor(t / 1000) * 1000;
  let instant = guess - offset(guess);
  const second = offset(instant);
  if (guess - second !== instant) instant = guess - second;
  return instant;
}

/** Local calendar date ('YYYY-MM-DD') of an instant in the zone. */
export function localDateOf(instant: string | number | Date, timeZone: string): string {
  const w = wallOf(new Date(instant).getTime(), timeZone);
  return `${String(w.y).padStart(4, '0')}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** Calendar arithmetic on a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const [y, mo] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Day of the week of a calendar date (0 = Sunday). */
export function weekDayOf(date: string): WeekDay {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() as WeekDay;
}

/** [start, end) of a local day as ISO instants. */
export function localDayRange(date: string, timeZone: string): { start: string; end: string } {
  return {
    start: new Date(midnight(date, timeZone)).toISOString(),
    end: new Date(midnight(addDays(date, 1), timeZone)).toISOString(),
  };
}

/** End of a local day: 23:59:59.999 in the zone (X-09: date-only deadlines). */
export function endOfLocalDay(date: string, timeZone: string): string {
  return new Date(midnight(addDays(date, 1), timeZone) - 1).toISOString();
}

/** First day ('YYYY-MM-DD') of the week containing `date`. */
export function startOfWeek(date: string, weekStart: WeekDay): string {
  const back = (weekDayOf(date) - weekStart + 7) % 7;
  return addDays(date, -back);
}

// ---------------------------------------------------------------------------------------------------------------
// Task deadline buckets (E README §2.6 "Group by Due date"; X-09/X-10)

export const taskBuckets = ['overdue', 'today', 'this-week', 'later', 'no-date', 'completed'] as const;
export type TaskBucket = (typeof taskBuckets)[number];

export interface TaskBucketBounds {
  /** Start of the viewer's today (ISO). Deadlines before it are overdue. */
  startOfToday: string;
  /** End of today, inclusive (23:59:59.999 local). */
  endOfToday: string;
  /** End of the current week, inclusive (the day before the next week start, 23:59:59.999 local). */
  endOfWeek: string;
}

export function taskBucketBounds(now: string | number | Date, timeZone: string, weekStart: WeekDay): TaskBucketBounds {
  const today = localDateOf(now, timeZone);
  const nextWeek = addDays(startOfWeek(today, weekStart), 7);
  return {
    startOfToday: localDayRange(today, timeZone).start,
    endOfToday: endOfLocalDay(today, timeZone),
    endOfWeek: endOfLocalDay(addDays(nextWeek, -1), timeZone),
  };
}

/**
 * Bucket of a task: completed tasks → 'completed'; no deadline → 'no-date'; deadline before today → 'overdue'
 * (included in "Today"); ≤ end of today → 'today'; ≤ end of week → 'this-week'; else 'later'.
 */
export function taskBucketOf(
  task: { deadlineAt: string | null; isCompleted: boolean },
  bounds: TaskBucketBounds,
): TaskBucket {
  if (task.isCompleted) return 'completed';
  if (task.deadlineAt === null) return 'no-date';
  const t = Date.parse(task.deadlineAt);
  if (t < Date.parse(bounds.startOfToday)) return 'overdue';
  if (t <= Date.parse(bounds.endOfToday)) return 'today';
  if (t <= Date.parse(bounds.endOfWeek)) return 'this-week';
  return 'later';
}

// ---------------------------------------------------------------------------------------------------------------
// Creation-date buckets (E README §2.1 notes page: 8 keyed queries with local-midnight boundaries)

export const createdBuckets = [
  'today',
  'this-week',
  'last-week',
  'earlier-this-month',
  'last-month',
  'earlier-this-year',
  'last-year',
  'older',
] as const;
export type CreatedBucket = (typeof createdBuckets)[number];

export interface CreatedBucketRange {
  key: CreatedBucket;
  /** Inclusive start (ISO) or null = unbounded. */
  from: string | null;
  /** Exclusive end (ISO). Empty buckets have from >= to. */
  to: string;
}

/**
 * The 8 creation-date ranges, newest first. "Earlier this month" is empty when last week started before the 1st;
 * "earlier this year" ends where "last month" starts.
 */
export function createdBucketRanges(
  now: string | number | Date,
  timeZone: string,
  weekStart: WeekDay,
): CreatedBucketRange[] {
  const today = localDateOf(now, timeZone);
  const at = (date: string) => localDayRange(date, timeZone).start;
  const thisWeek = startOfWeek(today, weekStart);
  const lastWeek = addDays(thisWeek, -7);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonth = addMonths(monthStart, -1);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const lastYear = `${String(Number(today.slice(0, 4)) - 1).padStart(4, '0')}-01-01`;
  const min = (a: string, b: string) => (a < b ? a : b);
  // Ranges are disjoint: a newer bucket wins where keyed queries would overlap (e.g. last week spanning
  // the 1st of the month). Last week always starts after the 1st of last month.
  return [
    { key: 'today', from: at(today), to: at(addDays(today, 1)) },
    { key: 'this-week', from: at(thisWeek), to: at(today) },
    { key: 'last-week', from: at(lastWeek), to: at(thisWeek) },
    { key: 'earlier-this-month', from: at(monthStart), to: at(lastWeek > monthStart ? lastWeek : monthStart) },
    { key: 'last-month', from: at(lastMonth), to: at(min(monthStart, lastWeek)) },
    { key: 'earlier-this-year', from: at(yearStart), to: at(lastMonth > yearStart ? lastMonth : yearStart) },
    { key: 'last-year', from: at(lastYear), to: at(min(yearStart, lastMonth)) },
    { key: 'older', from: null, to: at(lastYear) },
  ];
}

/** Bucket of a creation instant (first matching non-empty range). */
export function createdBucketOf(createdAt: string, ranges: CreatedBucketRange[]): CreatedBucket {
  const t = Date.parse(createdAt);
  for (const r of ranges) {
    const from = r.from === null ? Number.NEGATIVE_INFINITY : Date.parse(r.from);
    if (t >= from && t < Date.parse(r.to)) return r.key;
  }
  return 'today'; // in the future (clock skew)
}
