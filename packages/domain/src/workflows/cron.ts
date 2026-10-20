// Recurring schedule trigger (block-catalog §3 `on-recurring-schedule`): the Daily / Weekly / Monthly / Advanced
// configuration compiles to a 5-field cron expression (minute hour day-of-month month day-of-week), evaluated in the
// trigger's IANA time zone. Day-of-month and day-of-week combine with OR when both are restricted (Vixie cron).
import type { BlockConfig } from '@agentic-crm/contracts';
import { isValidTimeZone, zonedInstant, zonedWallClock } from '../time.ts';
import { entryOf, stringOf } from './graph.ts';

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function field(text: string, min: number, max: number, names: string[] = [], nameOffset = 0): Set<number> {
  const out = new Set<number>();
  const num = (s: string): number => {
    const i = names.indexOf(s.toLowerCase());
    if (i >= 0) return i + nameOffset;
    if (!/^\d+$/.test(s)) throw new Error(`Invalid cron value "${s}"`);
    return Number(s);
  };
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/') as [string, string | undefined];
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step "${part}"`);
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-') as [string, string];
      lo = num(a);
      hi = num(b);
    } else {
      lo = num(range);
      hi = stepText === undefined ? lo : max;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron value out of range "${part}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parses a 5-field cron expression; throws with a readable message when invalid. */
export function parseCron(expression: string): CronSpec {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression has five fields: minute hour day month weekday');
  const [mi, h, dom, mo, dow] = parts as [string, string, string, string, string];
  const weekdays = field(dow, 0, 7, DAYS);
  if (weekdays.has(7)) {
    weekdays.delete(7);
    weekdays.add(0);
  }
  return {
    minutes: field(mi, 0, 59),
    hours: field(h, 0, 23),
    days: field(dom, 1, 31),
    months: field(mo, 1, 12, MONTHS, 1),
    weekdays,
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

function dayMatches(spec: CronSpec, y: number, mo: number, d: number): boolean {
  if (!spec.months.has(mo)) return false;
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const domOk = spec.days.has(d);
  const dowOk = spec.weekdays.has(weekday);
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

/** The first instant strictly after `afterIso` matching the expression in `timeZone` (null within 5 years: none). */
export function nextCronRun(expression: string, timeZone: string, afterIso: string): string | null {
  const spec = parseCron(expression);
  const start = zonedWallClock(afterIso, timeZone);
  const hours = [...spec.hours].sort((a, b) => a - b);
  const minutes = [...spec.minutes].sort((a, b) => a - b);
  const startDay = Date.UTC(start.y, start.mo - 1, start.d);
  for (let i = 0; i < 366 * 5; i++) {
    const day = new Date(startDay + i * 86_400_000);
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    if (!dayMatches(spec, y, mo, d)) continue;
    for (const h of hours) {
      if (i === 0 && h < start.h) continue;
      for (const m of minutes) {
        if (i === 0 && h === start.h && m <= start.mi) continue;
        const instant = zonedInstant(y, mo, d, h, m, timeZone);
        if (Date.parse(instant) > Date.parse(afterIso)) return instant;
      }
    }
  }
  return null;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function numbers(expr: ReturnType<typeof entryOf>): number[] {
  if (!expr || expr.type !== 'array') return [];
  return expr.items.flatMap((i) => (i.type === 'number' ? [i.value] : i.type === 'string' ? [Number(i.value)] : []));
}

/** The cron expression and zone of a schedule trigger config, or an error message for the editor. */
export function scheduleOf(config: BlockConfig): { cron: string; timeZone: string } | { error: string; path: string } {
  const mode = stringOf(entryOf(config, 'mode')) ?? 'daily';
  const timeZone = stringOf(entryOf(config, 'timezone')) ?? 'UTC';
  if (!isValidTimeZone(timeZone)) return { error: 'Unknown time zone', path: 'timezone' };
  let cron: string;
  if (mode === 'advanced-cron') {
    cron = stringOf(entryOf(config, 'cron_expression'))?.trim() ?? '';
    if (!cron) return { error: 'This input is required.', path: 'cron_expression' };
  } else {
    const time = stringOf(entryOf(config, 'time_of_day')) ?? '12:00';
    const m = TIME_RE.exec(time);
    if (!m) return { error: 'Use the 24-hour format (00:00 - 23:59)', path: 'time_of_day' };
    const hm = `${Number(m[2])} ${Number(m[1])}`;
    if (mode === 'daily') cron = `${hm} * * *`;
    else if (mode === 'weekly') {
      const days = numbers(entryOf(config, 'days_of_week')).filter((d) => d >= 0 && d <= 7);
      if (days.length === 0) return { error: 'Select at least one day', path: 'days_of_week' };
      cron = `${hm} * * ${[...new Set(days)].sort((a, b) => a - b).join(',')}`;
    } else if (mode === 'monthly') {
      const days = numbers(entryOf(config, 'days_of_month')).filter((d) => d >= 1 && d <= 31);
      if (days.length === 0) return { error: 'Select at least one day', path: 'days_of_month' };
      cron = `${hm} ${[...new Set(days)].sort((a, b) => a - b).join(',')} * *`;
    } else return { error: 'Unknown frequency', path: 'mode' };
  }
  try {
    parseCron(cron);
  } catch (err) {
    return { error: (err as Error).message, path: mode === 'advanced-cron' ? 'cron_expression' : 'mode' };
  }
  return { cron, timeZone };
}
