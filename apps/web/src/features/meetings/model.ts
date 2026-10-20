// Meeting view logic: time rows and durations,
// the viewer's RSVP pill, the timeline sentence, the mini calendar tile, the "New meeting" defaults and validation,
// and the Home widget's day window. Pure and unit-tested.

import type { MeetingParticipantStatus } from '@agentic-crm/contracts';
import { addDays, localDateOf } from '@agentic-crm/contracts';
import { formatClock, wallParts } from '../email/model';
import { type DraftDeadline, zonedInstant } from '../tasks/deadline';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface MeetingTimes {
  isAllDay: boolean;
  start: { at: string; date: string | null };
  end: { at: string; date: string | null };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "30m", "1h", "1h 30m", "2d" (days only when a whole number of them). */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const days = Math.floor(minutes / 1440);
  if (days >= 1 && minutes % 1440 === 0) return `${days}d`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "Today", "Tomorrow", "Yesterday", else "9 Oct" (with the year when it is not this year). */
export function dayLabel(date: string, today: string): string {
  const diff = dayDiff(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const base = `${d} ${MONTHS[mo - 1]}`;
  return y === Number(today.slice(0, 4)) ? base : `${base} ${y}`;
}

/** The local date a meeting starts on (all-day meetings carry it; others derive it in the viewer's zone). */
export function startDateOf(m: Pick<MeetingTimes, 'isAllDay' | 'start'>, timeZone: string): string {
  return m.isAllDay && m.start.date ? m.start.date : localDateOf(m.start.at, timeZone);
}

/** "5:00 PM → 6:00 PM (1h)", or "All day". */
export function timeRangeLabel(m: MeetingTimes, timeZone: string): string {
  if (m.isAllDay) return 'All day';
  const start = wallParts(m.start.at, timeZone);
  const end = wallParts(m.end.at, timeZone);
  const duration = formatDuration(Date.parse(m.end.at) - Date.parse(m.start.at));
  return `${formatClock(start)} → ${formatClock(end)} (${duration})`;
}

/** The modal's time row: "Yesterday | 5:00 PM → 6:00 PM (1h)" / "Today | All day". */
export function meetingTimeLabel(m: MeetingTimes, now: Date | number, timeZone: string): string {
  const today = localDateOf(now, timeZone);
  return `${dayLabel(startDateOf(m, timeZone), today)} | ${timeRangeLabel(m, timeZone)}`;
}

/** Home widget row time: "5:00 PM - 6:00 PM" or "All day". */
export function rowTimeLabel(m: MeetingTimes, timeZone: string): string {
  if (m.isAllDay) return 'All day';
  return `${formatClock(wallParts(m.start.at, timeZone))} - ${formatClock(wallParts(m.end.at, timeZone))}`;
}

/** The mini calendar tile of the modal: month abbreviation and two-digit day ("OCT" / "09"). */
export function calendarTile(
  m: Pick<MeetingTimes, 'isAllDay' | 'start'>,
  timeZone: string,
): { month: string; day: string } {
  const date = startDateOf(m, timeZone);
  const [, mo, d] = date.split('-').map(Number) as [number, number, number];
  return { month: (MONTHS[mo - 1] as string).toUpperCase(), day: String(d).padStart(2, '0') };
}

/** Whether the meeting is over at `now` (all-day meetings end at the start of their end date). */
export function isPast(m: Pick<MeetingTimes, 'end' | 'isAllDay'>, now: Date | number): boolean {
  const end = m.isAllDay && m.end.date ? Date.parse(`${m.end.date}T00:00:00Z`) : Date.parse(m.end.at);
  return end <= new Date(now).getTime();
}

// ---- RSVP ------------------------------------------------------------------------------------------------------------

export type RsvpTone = 'positive' | 'neutral' | 'warning' | 'critical';

export interface Rsvp {
  label: 'Attended' | 'Attending' | 'Maybe' | 'Declined' | 'Pending';
  tone: RsvpTone;
}

/** Participant status pill: "Attended" when the meeting is over and the RSVP was yes. */
export function rsvpOf(status: MeetingParticipantStatus, past: boolean): Rsvp {
  switch (status) {
    case 'accepted':
      return past ? { label: 'Attended', tone: 'positive' } : { label: 'Attending', tone: 'positive' };
    case 'tentative':
      return { label: 'Maybe', tone: 'warning' };
    case 'declined':
      return { label: 'Declined', tone: 'critical' };
    default:
      return { label: 'Pending', tone: 'neutral' };
  }
}

/** The verb phrase of a timeline meeting event (D), by the attending member's RSVP and whether it is over. */
export function timelineVerb(memberStatus: MeetingParticipantStatus | null, past: boolean): string | null {
  switch (memberStatus) {
    case 'accepted':
      return past ? 'attended a meeting' : 'is attending a meeting';
    case 'declined':
      return 'declined a meeting invitation';
    case 'tentative':
      return past ? 'was invited to a meeting' : 'might attend a meeting';
    case 'pending':
      return 'was invited to a meeting';
    default:
      return null;
  }
}

export function participantCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'participant' : 'participants'}`;
}

// ---- New meeting dialog ----------------------------------------------------------------------------------------------

export interface ClockTime {
  hour: number;
  minute: number;
}

export interface MeetingDraftTimes {
  date: string;
  start: ClockTime;
  end: ClockTime;
}

/** Default time of a new meeting: now rounded up to the next half hour, lasting 30 minutes (D). */
export function defaultMeetingTimes(now: Date | number, timeZone: string): MeetingDraftTimes {
  const w = wallParts(now, timeZone);
  const minutes = Math.ceil((w.hour * 60 + w.minute) / 30) * 30;
  let date = localDateOf(now, timeZone);
  let startMinutes = minutes;
  if (startMinutes >= 1440) {
    startMinutes -= 1440;
    date = addDays(date, 1);
  }
  const endMinutes = (startMinutes + 30) % 1440;
  return {
    date,
    start: { hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 },
    end: { hour: Math.floor(endMinutes / 60), minute: endMinutes % 60 },
  };
}

/** The end instant's local date: a meeting ending at or before its start crosses midnight. */
export function endDateOf(times: MeetingDraftTimes): string {
  const start = times.start.hour * 60 + times.start.minute;
  const end = times.end.hour * 60 + times.end.minute;
  return end <= start ? addDays(times.date, 1) : times.date;
}

/** "(30m)" duration of a draft. */
export function draftDuration(times: MeetingDraftTimes): string {
  const start = times.start.hour * 60 + times.start.minute;
  let end = times.end.hour * 60 + times.end.minute;
  if (end <= start) end += 1440;
  return formatDuration((end - start) * 60_000);
}

/** The API start / end of a draft in the viewer's zone. */
export function draftInstants(times: MeetingDraftTimes, timeZone: string): { start: string; end: string } {
  return {
    start: zonedInstant(times.date, times.start, timeZone),
    end: zonedInstant(endDateOf(times), times.end, timeZone),
  };
}

/** Moves the end with the start (keeping the duration) when the start changes. */
export function shiftEnd(times: MeetingDraftTimes, nextStart: ClockTime): MeetingDraftTimes {
  const oldStart = times.start.hour * 60 + times.start.minute;
  let oldEnd = times.end.hour * 60 + times.end.minute;
  if (oldEnd <= oldStart) oldEnd += 1440;
  const length = oldEnd - oldStart;
  const end = (nextStart.hour * 60 + nextStart.minute + length) % 1440;
  return { ...times, start: nextStart, end: { hour: Math.floor(end / 60), minute: end % 60 } };
}

/** "11:00 PM" */
export function formatClockTime(t: ClockTime): string {
  return formatClock(t);
}

/**
 * Parses what a person types into a time field: "11:00 PM", "11pm", "9 a", "9:30", "21:15" — null when it is not a
 * time. Without am/pm the hour is read as typed on a 24-hour clock.
 */
export function parseClockTime(raw: string): ClockTime | null {
  const text = raw.trim().toLowerCase().replace(/\./g, '');
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(a|p|am|pm)?$/.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12;
    if (suffix.startsWith('p')) hour += 12;
  } else if (hour > 23) return null;
  return { hour, minute };
}

export const MIN_PARTICIPANTS = 2;
export const MIN_PARTICIPANTS_MESSAGE = 'At least two participants are required';

export function participantsError(count: number): string | null {
  return count < MIN_PARTICIPANTS ? MIN_PARTICIPANTS_MESSAGE : null;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** A typed participant: a plain address or "Name <address>". */
export function parseTypedParticipant(raw: string): { emailAddress: string; name: string | null } | null {
  const text = raw.trim();
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  const address = (named?.[2] ?? text).trim();
  if (!EMAIL.test(address)) return null;
  const name = named?.[1]?.replace(/^"|"$/g, '').trim();
  return { emailAddress: address.toLowerCase(), name: name || null };
}

/** The draft deadline form used by the shared date picker: only the date matters here. */
export const asDeadline = (date: string): DraftDeadline => ({ date, time: null });

// ---- Home widget -------------------------------------------------------------------------------------------------------

/** Start and end instants  of a local date in the viewer's zone. */
export function dayBounds(date: string, timeZone: string): { from: string; to: string } {
  return {
    from: zonedInstant(date, { hour: 0, minute: 0 }, timeZone),
    to: zonedInstant(addDays(date, 1), { hour: 0, minute: 0 }, timeZone),
  };
}

/** The header date button: "Today, Oct 9", "Tomorrow, Oct 10", "Yesterday, Oct 8", else "Monday, Oct 12". */
export function homeDateLabel(date: string, today: string): string {
  const [, mo, d] = date.split('-').map(Number) as [number, number, number];
  const short = `${MONTHS[mo - 1]} ${d}`;
  const diff = dayDiff(today, date);
  if (diff === 0) return `Today, ${short}`;
  if (diff === 1) return `Tomorrow, ${short}`;
  if (diff === -1) return `Yesterday, ${short}`;
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${weekday}, ${short}`;
}

export interface MeetingFilters {
  allDay: boolean;
  withoutConferencing: boolean;
  declined: boolean;
}

export const DEFAULT_MEETING_FILTERS: MeetingFilters = { allDay: true, withoutConferencing: true, declined: true };

export function normaliseFilters(raw: unknown): MeetingFilters {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof MeetingFilters, unknown>>;
  const pick = (k: keyof MeetingFilters) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : true);
  return { allDay: pick('allDay'), withoutConferencing: pick('withoutConferencing'), declined: pick('declined') };
}

export interface HomeMeetingLike extends MeetingTimes {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  conferenceUrl: string | null;
  participants: readonly { memberId: string | null; status: MeetingParticipantStatus }[];
}

/** The viewer's own RSVP on a meeting, if they take part. */
export function myStatus(m: Pick<HomeMeetingLike, 'participants'>, memberId: string): MeetingParticipantStatus | null {
  return m.participants.find((p) => p.memberId === memberId)?.status ?? null;
}

/** Which meetings the Home list shows: cancelled never; the other filters per the "Meeting filters" menu. */
export function applyMeetingFilters<T extends HomeMeetingLike>(
  list: readonly T[],
  filters: MeetingFilters,
  memberId: string,
): T[] {
  return list.filter((m) => {
    if (m.status === 'cancelled') return false;
    if (!filters.allDay && m.isAllDay) return false;
    if (!filters.withoutConferencing && !m.conferenceUrl) return false;
    if (!filters.declined && myStatus(m, memberId) === 'declined') return false;
    return true;
  });
}

export interface WindowedMeetings<T> {
  earlier: T[];
  shown: T[];
  later: T[];
}

/**
 * At most `max` meetings are visible; earlier ones collapse into "{n} past events", later ones into "{n} more
 * events". For today the window centres on the current or next meeting.
 */
export function windowMeetings<T extends MeetingTimes>(
  list: readonly T[],
  anchor: number | null,
  max = 5,
): WindowedMeetings<T> {
  if (list.length <= max) return { earlier: [], shown: [...list], later: [] };
  const center = anchor ?? 0;
  let start = Math.max(0, Math.min(center - Math.floor(max / 2), list.length - max));
  if (start < 0) start = 0;
  return { earlier: list.slice(0, start), shown: list.slice(start, start + max), later: list.slice(start + max) };
}

/** Index of the meeting in progress, else the next one to start (for the auto-expanded row); null when all are over. */
export function currentOrNextIndex(list: readonly MeetingTimes[], now: Date | number): number | null {
  const t = new Date(now).getTime();
  const i = list.findIndex((m) => !m.isAllDay && Date.parse(m.end.at) > t);
  return i === -1 ? null : i;
}
