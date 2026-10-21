// Task deadlines on the client (due labels, deadline chip; decision X-09): what the row says
// ("Due yesterday" red, "Due in 5 days" orange, "Due Oct 19, 2026" grey), what the dialog chip says ("Tomorrow",
// "October 16, 2026"), and the deadline input sent to the server (a date → end of that local day; a typed time →
// that instant).
import { addDays, type DeadlineInput, localDateOf } from '@agentic-crm/contracts';
import type { TimeOfDay } from './naturalDate';

/** Whole calendar days from `from` to `to` ('YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type DueTone = 'overdue' | 'soon' | 'later';

export interface DueLabel {
  text: string;
  tone: DueTone;
}

/** Orange "Due in N days" up to a week ahead; later dates are absolute and grey. */
const SOON_DAYS = 7;

/** Row label of a deadline seen at `now` in the viewer's zone (null: no deadline). */
export function dueLabel(
  deadlineAt: string | null,
  now: Date | number | string,
  timeZone: string,
  locale = 'en-US',
): DueLabel | null {
  if (!deadlineAt) return null;
  const today = localDateOf(now, timeZone);
  const day = localDateOf(deadlineAt, timeZone);
  const diff = daysBetween(today, day);
  const overdue = Date.parse(deadlineAt) < new Date(now).getTime();
  if (diff < 0) return { text: diff === -1 ? 'Due yesterday' : `Due ${-diff} days ago`, tone: 'overdue' };
  if (diff === 0) return { text: 'Due today', tone: overdue ? 'overdue' : 'soon' };
  if (diff === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (diff <= SOON_DAYS) return { text: `Due in ${diff} days`, tone: 'soon' };
  return { text: `Due ${formatShortDate(day, locale)}`, tone: 'later' };
}

/** "Oct 19, 2026" */
export function formatShortDate(date: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "October 16, 2026" */
export function formatLongDate(date: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function formatTime(time: TimeOfDay, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 1, time.hour, time.minute)),
  );
}

/** A deadline being edited in a dialog: a local date, optionally with a time of day. */
export interface DraftDeadline {
  date: string;
  time: TimeOfDay | null;
}

/** Deadline chip text: "Today", "Tomorrow", "Yesterday" or "October 16, 2026" (+ ", 3:00 PM" when timed). */
export function deadlineChipLabel(deadline: DraftDeadline | null, today: string, locale = 'en-US'): string {
  if (!deadline) return 'No due date';
  const diff = daysBetween(today, deadline.date);
  const day =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : formatLongDate(deadline.date, locale);
  return deadline.time ? `${day}, ${formatTime(deadline.time, locale)}` : day;
}

/** The API input for a draft deadline (X-09: date-only → end of that day in the creator's zone). */
export function deadlineInput(deadline: DraftDeadline | null, timeZone: string): DeadlineInput {
  if (!deadline) return null;
  if (!deadline.time) return { kind: 'date', date: deadline.date, timeZone };
  return { kind: 'datetime', at: zonedInstant(deadline.date, deadline.time, timeZone) };
}

/** A stored deadline as a draft in the viewer's zone (date-only deadlines lose their 23:59:59.999). */
export function draftFromDeadline(deadlineAt: string | null, hasTime: boolean, timeZone: string): DraftDeadline | null {
  if (!deadlineAt) return null;
  const date = localDateOf(deadlineAt, timeZone);
  if (!hasTime) return { date, time: null };
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(deadlineAt));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { date, time: { hour, minute } };
}

/** The instant of a local wall-clock time in a zone (DST-safe by two-step offset correction). */
export function zonedInstant(date: string, time: TimeOfDay, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, time.hour, time.minute);
  const offsetAt = (instant: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return (
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) - instant
    );
  };
  let instant = wall - offsetAt(wall);
  const second = offsetAt(instant);
  if (wall - second !== instant) instant = wall - second;
  return new Date(instant).toISOString();
}

/** Deadline presets: Today, Tomorrow, Next week and No date. */
export function presetDate(preset: 'today' | 'tomorrow' | 'next-week', today: string, nextWeekStart: string): string {
  if (preset === 'today') return today;
  if (preset === 'tomorrow') return addDays(today, 1);
  return nextWeekStart;
}
