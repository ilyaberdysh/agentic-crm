// Natural-language dates for task deadlines ("Smart parsing",b; decision X-09): finds a date
// phrase in free text ("Send deck tomorrow at 3pm", "next friday", "in 3 days", "Oct 16", "16/10") relative to the
// viewer's local today and week start. A phrase without a time means "that day" (stored as the end of the local day);
// a typed time is kept. The phrase stays in the task title; the caller only reads the result.
import { addDays, addMonths, startOfWeek, type WeekDay, weekDayOf } from '@agentic-crm/contracts';

export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface ParsedDate {
  /** Local calendar date 'YYYY-MM-DD'. */
  date: string;
  /** Explicit time of day, when one was typed. */
  time: TimeOfDay | null;
  /** The matched phrase in the input (start inclusive, end exclusive). */
  start: number;
  end: number;
}

export interface DateContext {
  /** The viewer's local today 'YYYY-MM-DD'. */
  today: string;
  weekStart: WeekDay;
  /** Current local time (for "at 3pm" alone: today, or tomorrow once it has passed). */
  now?: TimeOfDay;
  /** Numeric dates: 'mdy' (en-US, 10/16) or 'dmy' (most locales, 16/10). */
  numericOrder?: 'mdy' | 'dmy';
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAYS: Record<string, WeekDay> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const monthNames = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const fullWeekdays = Object.keys(WEEKDAYS)
  .filter((w) => w.endsWith('day'))
  .join('|');
const shortWeekdays = Object.keys(WEEKDAYS)
  .filter((w) => !w.endsWith('day'))
  .sort((a, b) => b.length - a.length)
  .join('|');
const numberWords = Object.keys(NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const UNIT = '(day|days|week|weeks|wk|wks|month|months|mo|year|years|yr|yrs)';
const ORD = '(?:st|nd|rd|th)?';
// Word boundaries that also work next to "@mentions" and punctuation.
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';

type Resolver = (m: RegExpExecArray, ctx: DateContext) => string | null;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // Feb 30
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

/** A day-month without a year: this year, or next year once it has passed. */
function upcoming(m: number, d: number, ctx: DateContext): string | null {
  const year = Number(ctx.today.slice(0, 4));
  const thisYear = isoDate(year, m, d);
  if (thisYear === null) return isoDate(year + 1, m, d);
  return thisYear < ctx.today ? isoDate(year + 1, m, d) : thisYear;
}

function lastDayOfMonth(date: string): string {
  return addDays(addMonths(date, 1), -1);
}

function shift(ctx: DateContext, amount: number, unit: string): string {
  if (unit.startsWith('d')) return addDays(ctx.today, amount);
  if (unit.startsWith('w')) return addDays(ctx.today, amount * 7);
  if (unit.startsWith('y')) {
    const [y, m, d] = ctx.today.split('-').map(Number) as [number, number, number];
    return isoDate(y + amount, m, d) ?? isoDate(y + amount, m, d - 1) ?? ctx.today;
  }
  // months: same day of month, clamped to the month's last day
  const target = addMonths(ctx.today, amount);
  const day = Number(ctx.today.slice(8, 10));
  const last = Number(lastDayOfMonth(target).slice(8, 10));
  return `${target.slice(0, 8)}${pad(Math.min(day, last))}`;
}

const amountOf = (word: string): number => NUMBERS[word] ?? Number(word);

function weekdayDate(word: string, qualifier: string | undefined, ctx: DateContext): string {
  const target = WEEKDAYS[word] as WeekDay;
  const todayDay = weekDayOf(ctx.today);
  if (qualifier === 'next') {
    // The weekday of next week ("next friday" on a Friday = in 7 days).
    const nextWeek = addDays(startOfWeek(ctx.today, ctx.weekStart), 7);
    return addDays(nextWeek, (target - ctx.weekStart + 7) % 7);
  }
  if (qualifier === 'this') {
    // The weekday of the current week (may be in the past only if the user insists; clamp to today).
    const thisWeek = startOfWeek(ctx.today, ctx.weekStart);
    const date = addDays(thisWeek, (target - ctx.weekStart + 7) % 7);
    return date < ctx.today ? addDays(date, 7) : date;
  }
  // Plain weekday: the next one after today ("friday" on a Friday = next week's).
  const ahead = (target - todayDay + 7) % 7 || 7;
  return addDays(ctx.today, ahead);
}

const DATE_PATTERNS: { re: RegExp; resolve: Resolver }[] = [
  { re: new RegExp(`${B}(the\\s+)?day\\s+after\\s+tomorrow${E}`, 'giu'), resolve: (_m, c) => addDays(c.today, 2) },
  { re: new RegExp(`${B}(today|tonight)${E}`, 'giu'), resolve: (_m, c) => c.today },
  { re: new RegExp(`${B}(tomorrow|tomorow|tmrw|tmr|tmrrw)${E}`, 'giu'), resolve: (_m, c) => addDays(c.today, 1) },
  { re: new RegExp(`${B}yesterday${E}`, 'giu'), resolve: (_m, c) => addDays(c.today, -1) },
  {
    // Full weekday names anywhere; "next fri", "this tue", "on sat" also take the short forms (a bare "sat" or
    // "sun" in a title is usually not a date).
    re: new RegExp(
      `${B}(?:(next|this|on|coming)\\s+)?(${fullWeekdays})${E}|${B}(next|this|on|coming)\\s+(${shortWeekdays})\\.?${E}`,
      'giu',
    ),
    resolve: (m, c) => {
      const word = ((m[2] ?? m[4]) as string).toLowerCase();
      const qualifier = ((m[1] ?? m[3]) as string | undefined)?.toLowerCase();
      return weekdayDate(
        word,
        qualifier === 'next' ? 'next' : qualifier === 'this' || qualifier === 'coming' ? 'this' : undefined,
        c,
      );
    },
  },
  {
    re: new RegExp(`${B}next\\s+(week|month|year)${E}`, 'giu'),
    resolve: (m, c) => {
      const unit = (m[1] as string).toLowerCase();
      if (unit === 'week') return addDays(startOfWeek(c.today, c.weekStart), 7);
      if (unit === 'month') return addMonths(`${c.today.slice(0, 8)}01`, 1);
      return `${Number(c.today.slice(0, 4)) + 1}-01-01`;
    },
  },
  {
    re: new RegExp(`${B}(?:by\\s+)?(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+)?(week|month|year)${E}`, 'giu'),
    resolve: (m, c) => {
      const unit = (m[1] as string).toLowerCase();
      if (unit === 'week') return addDays(startOfWeek(c.today, c.weekStart), 6);
      if (unit === 'month') return lastDayOfMonth(`${c.today.slice(0, 8)}01`);
      return `${c.today.slice(0, 4)}-12-31`;
    },
  },
  {
    re: new RegExp(`${B}in\\s+(\\d{1,3}|${numberWords})\\s+${UNIT}${E}`, 'giu'),
    resolve: (m, c) => shift(c, amountOf((m[1] as string).toLowerCase()), (m[2] as string).toLowerCase()),
  },
  {
    re: new RegExp(`${B}(\\d{1,3}|${numberWords})\\s+${UNIT}\\s+from\\s+(?:now|today)${E}`, 'giu'),
    resolve: (m, c) => shift(c, amountOf((m[1] as string).toLowerCase()), (m[2] as string).toLowerCase()),
  },
  {
    // "Oct 16", "October 16th, 2026", "oct. 16"
    re: new RegExp(`${B}(?:on\\s+)?(${monthNames})\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?${E}`, 'giu'),
    resolve: (m, c) => {
      const month = MONTHS[(m[1] as string).toLowerCase()] as number;
      const day = Number(m[2]);
      return m[3] ? isoDate(Number(m[3]), month, day) : upcoming(month, day, c);
    },
  },
  {
    // "16 Oct", "16th of October 2026"
    re: new RegExp(`${B}(?:on\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${monthNames})\\.?(?:,?\\s+(\\d{4}))?${E}`, 'giu'),
    resolve: (m, c) => {
      const month = MONTHS[(m[2] as string).toLowerCase()] as number;
      const day = Number(m[1]);
      return m[3] ? isoDate(Number(m[3]), month, day) : upcoming(month, day, c);
    },
  },
  {
    re: new RegExp(`${B}(\\d{4})-(\\d{2})-(\\d{2})${E}`, 'gu'),
    resolve: (m) => isoDate(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    // 10/16, 10/16/2026 (en-US) or 16/10 (day-first locales); dotted dates are day first and need two-digit parts
    // or a year ("16.10", "1.2.2027"), so "version 3.5" stays text.
    re: new RegExp(
      `${B}(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?${E}|${B}(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2}|\\d{4}))?${E}`,
      'gu',
    ),
    resolve: (m, c) => {
      const dotted = m[4] !== undefined;
      const a = Number(dotted ? m[4] : m[1]);
      const b = Number(dotted ? m[5] : m[2]);
      const yearText = dotted ? m[6] : m[3];
      if (dotted && !yearText && ((m[4] as string).length < 2 || (m[5] as string).length < 2)) return null;
      const [month, day] = dotted || c.numericOrder === 'dmy' ? [b, a] : [a, b];
      if (!yearText) return upcoming(month, day, c);
      const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
      return isoDate(year, month, day);
    },
  },
];

const TIME_PATTERNS: { re: RegExp; resolve: (m: RegExpExecArray) => TimeOfDay | null }[] = [
  {
    re: new RegExp(`${B}(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![\\p{L}\\p{N}_])`, 'giu'),
    resolve: (m) => {
      let hour = Number(m[1]);
      const minute = m[2] ? Number(m[2]) : 0;
      if (hour < 1 || hour > 12 || minute > 59) return null;
      const pm = (m[3] as string).toLowerCase().startsWith('p');
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
      return { hour, minute };
    },
  },
  {
    re: new RegExp(`${B}(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)${E}`, 'gu'),
    resolve: (m) => ({ hour: Number(m[1]), minute: Number(m[2]) }),
  },
  {
    re: new RegExp(`${B}(?:at\\s+)?(noon|midday|midnight)${E}`, 'giu'),
    resolve: (m) => ((m[1] as string).toLowerCase() === 'midnight' ? { hour: 0, minute: 0 } : { hour: 12, minute: 0 }),
  },
  {
    // "at 3" (afternoon for 1–7, else as typed)
    re: new RegExp(`${B}at\\s+(\\d{1,2})${E}(?!\\s*[/.:]\\d)`, 'giu'),
    resolve: (m) => {
      const n = Number(m[1]);
      if (n < 1 || n > 12) return null;
      return { hour: n <= 7 ? n + 12 : n, minute: 0 };
    },
  },
];

interface Hit<T> {
  start: number;
  end: number;
  value: T;
}

function firstHit<T>(
  text: string,
  patterns: { re: RegExp; resolve: (m: RegExpExecArray, ctx: DateContext) => T | null }[],
  ctx: DateContext,
): Hit<T>[] {
  const hits: Hit<T>[] = [];
  for (const { re, resolve } of patterns) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const value = resolve(m, ctx);
      if (value !== null) hits.push({ start: m.index, end: m.index + m[0].length, value });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  // Earliest first; at the same position the longest phrase wins.
  return hits.sort((a, b) => a.start - b.start || b.end - a.end);
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/** Only whitespace, "at" or "on" between two phrases. */
function adjacent(text: string, from: number, to: number): boolean {
  return /^\s*(?:at|on|,)?\s*$/i.test(text.slice(from, to));
}

/** The first date phrase in `text` (with an adjacent time, if any), or a time alone ("at 3pm" → today / tomorrow). */
export function parseNaturalDate(text: string, ctx: DateContext): ParsedDate | null {
  const dates = firstHit<string>(text, DATE_PATTERNS, ctx);
  const times = firstHit<TimeOfDay>(text, TIME_PATTERNS, ctx).filter((t) => !dates.some((d) => overlaps(d, t)));
  const date = dates[0];
  if (date) {
    const after = times.find((t) => t.start >= date.end && adjacent(text, date.end, t.start));
    const before = times.find((t) => t.end <= date.start && adjacent(text, t.end, date.start));
    const time = after ?? before;
    return {
      date: date.value,
      time: time?.value ?? null,
      start: Math.min(date.start, time?.start ?? date.start),
      end: Math.max(date.end, time?.end ?? date.end),
    };
  }
  const time = times[0];
  if (!time) return null;
  const passed =
    ctx.now !== undefined &&
    (time.value.hour < ctx.now.hour || (time.value.hour === ctx.now.hour && time.value.minute <= ctx.now.minute));
  return { date: passed ? addDays(ctx.today, 1) : ctx.today, time: time.value, start: time.start, end: time.end };
}

/** Numeric date order of a locale: en-US (and a few others) write month first. */
export function numericOrderForLocale(locale: string | undefined): 'mdy' | 'dmy' {
  if (!locale) return 'mdy';
  try {
    const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(Date.UTC(2026, 9, 16)));
    const month = parts.findIndex((p) => p.type === 'month');
    const day = parts.findIndex((p) => p.type === 'day');
    return month < day ? 'mdy' : 'dmy';
  } catch {
    return 'mdy';
  }
}
