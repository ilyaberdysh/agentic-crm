// Date and time helpers of the evaluator (UTC calendar). Dates are "YYYY-MM-DD" strings, timestamps epoch ms.
import { FormulaRuntimeError } from './diagnostics.ts';

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateToMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new FormulaRuntimeError('invalid-argument', `Invalid date "${date}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function msToDate(ms: number): string {
  if (!Number.isFinite(ms)) throw new FormulaRuntimeError('invalid-argument', 'Invalid date');
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new FormulaRuntimeError('invalid-argument', 'Invalid date');
  return d.toISOString().slice(0, 10);
}

export function msToIso(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new FormulaRuntimeError('invalid-argument', 'Invalid timestamp');
  return d.toISOString();
}

/** ISO date ("2024-01-15") or ISO date-time text → date; null when unparsable. */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  const m = DATE_RE.exec(s);
  if (m) {
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const back = new Date(ms);
    if (back.getUTCDate() !== Number(m[3]) || back.getUTCMonth() !== Number(m[2]) - 1) return null;
    return s;
  }
  const ts = parseTimestampText(s);
  return ts === null ? null : msToDate(ts);
}

/** ISO date-time text (without a zone = UTC) or a bare date → epoch ms; null when unparsable. */
export function parseTimestampText(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  if (DATE_RE.test(s)) return parseDateText(s) === null ? null : dateToMs(s);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const ms = Date.parse(hasZone ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : ms;
}

const parts = (ms: number) => {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
    weekday: d.getUTCDay(),
  };
};

export { parts as dateParts };

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export type DateUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'quarters' | 'years';

export function parseUnit(unit: string): DateUnit {
  const u = unit.trim().toLowerCase();
  const map: Record<string, DateUnit> = {
    second: 'seconds',
    seconds: 'seconds',
    minute: 'minutes',
    minutes: 'minutes',
    hour: 'hours',
    hours: 'hours',
    day: 'days',
    days: 'days',
    week: 'weeks',
    weeks: 'weeks',
    month: 'months',
    months: 'months',
    quarter: 'quarters',
    quarters: 'quarters',
    year: 'years',
    years: 'years',
  };
  const out = map[u];
  if (!out) throw new FormulaRuntimeError('invalid-argument', `Unknown unit "${unit}"`);
  return out;
}

const FIXED_MS: Partial<Record<DateUnit, number>> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: DAY_MS,
  weeks: 7 * DAY_MS,
};

function addMonths(ms: number, months: number): number {
  const p = parts(ms);
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return Date.UTC(year, month - 1, day, p.hour, p.minute, p.second, p.millisecond);
}

/** Adds `n` units to an instant; months / quarters / years clamp the day to the end of the month. */
export function addUnits(ms: number, n: number, unit: DateUnit): number {
  const fixed = FIXED_MS[unit];
  if (fixed !== undefined) return ms + Math.round(n * fixed);
  const whole = Math.trunc(n);
  if (unit === 'months') return addMonths(ms, whole);
  if (unit === 'quarters') return addMonths(ms, whole * 3);
  return addMonths(ms, whole * 12);
}

/** Whole calendar months from a to b (a <= b). */
function fullMonths(a: number, b: number): number {
  const pa = parts(a);
  const pb = parts(b);
  let months = (pb.year - pa.year) * 12 + (pb.month - pa.month);
  if (addMonths(a, months) > b) months--;
  return Math.max(0, months);
}

/** Absolute difference in whole units. */
export function diffUnits(a: number, b: number, unit: DateUnit): number {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const fixed = FIXED_MS[unit];
  if (fixed !== undefined) return Math.floor((hi - lo) / fixed);
  const months = fullMonths(lo, hi);
  if (unit === 'months') return months;
  if (unit === 'quarters') return Math.floor(months / 3);
  return Math.floor(months / 12);
}

export function endOfMonth(ms: number): string {
  const p = parts(ms);
  return msToDate(Date.UTC(p.year, p.month - 1, daysInMonth(p.year, p.month)));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Formats an instant (UTC). Accepts date-fns style tokens (yyyy yy MMMM MMM MM M dd d do EEEE EEE HH H hh h mm m ss
 * s a Q) and the moment style the public docs use (YYYY YY DD D Do Q); text in single quotes or square brackets is
 * literal.
 */
export function formatDate(ms: number, format: string): string {
  const p = parts(ms);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const tokens: Record<string, () => string> = {
    yyyy: () => String(p.year),
    YYYY: () => String(p.year),
    yy: () => pad(p.year % 100),
    YY: () => pad(p.year % 100),
    MMMM: () => MONTHS[p.month - 1] as string,
    MMM: () => (MONTHS[p.month - 1] as string).slice(0, 3),
    MM: () => pad(p.month),
    M: () => String(p.month),
    do: () => ordinal(p.day),
    Do: () => ordinal(p.day),
    dd: () => pad(p.day),
    DD: () => pad(p.day),
    d: () => String(p.day),
    D: () => String(p.day),
    EEEE: () => WEEKDAYS[p.weekday] as string,
    dddd: () => WEEKDAYS[p.weekday] as string,
    EEE: () => (WEEKDAYS[p.weekday] as string).slice(0, 3),
    ddd: () => (WEEKDAYS[p.weekday] as string).slice(0, 3),
    HH: () => pad(p.hour),
    H: () => String(p.hour),
    hh: () => pad(h12),
    h: () => String(h12),
    mm: () => pad(p.minute),
    m: () => String(p.minute),
    ss: () => pad(p.second),
    s: () => String(p.second),
    a: () => (p.hour < 12 ? 'AM' : 'PM'),
    A: () => (p.hour < 12 ? 'AM' : 'PM'),
    Q: () => String(Math.floor((p.month - 1) / 3) + 1),
  };
  const names = Object.keys(tokens).sort((x, y) => y.length - x.length);
  let out = '';
  let i = 0;
  while (i < format.length) {
    const ch = format[i] as string;
    if (ch === "'" || ch === '[') {
      const close = format.indexOf(ch === "'" ? "'" : ']', i + 1);
      const end = close < 0 ? format.length : close;
      out += format.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const token = names.find((t) => format.startsWith(t, i));
    if (token) {
      out += (tokens[token] as () => string)();
      i += token.length;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Offset (ms) of a time zone at an instant: local wall clock − UTC. */
function zoneOffset(timeZone: string, ms: number): number {
  let dtf: Intl.DateTimeFormat;
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new FormulaRuntimeError('invalid-argument', `Unknown time zone "${timeZone}"`);
  }
  const values: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    values.year as number,
    (values.month as number) - 1,
    values.day as number,
    values.hour as number,
    values.minute as number,
    values.second as number,
  );
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** Reads the UTC wall-clock time of `ms` as a local time in `timeZone` and returns that instant. */
export function setTimezone(ms: number, timeZone: string): number {
  const first = ms - zoneOffset(timeZone, ms);
  return ms - zoneOffset(timeZone, first);
}
