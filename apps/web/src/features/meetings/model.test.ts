import { describe, expect, it } from 'vitest';
import {
  applyMeetingFilters,
  calendarTile,
  currentOrNextIndex,
  dayBounds,
  dayLabel,
  defaultMeetingTimes,
  draftDuration,
  draftInstants,
  endDateOf,
  formatDuration,
  homeDateLabel,
  isPast,
  type MeetingTimes,
  meetingTimeLabel,
  normaliseFilters,
  parseClockTime,
  parseTypedParticipant,
  participantCountLabel,
  participantsError,
  rowTimeLabel,
  rsvpOf,
  shiftEnd,
  timelineVerb,
  windowMeetings,
} from './model';

const TZ = 'Europe/Moscow';
// Friday 9 October 2026, 18:30 in Moscow (UTC+3).
const NOW = new Date('2026-10-09T15:30:00Z');

const at = (iso: string): MeetingTimes['start'] => ({ at: iso, date: null });
const meeting = (start: string, end: string, extra: Partial<MeetingTimes> = {}): MeetingTimes => ({
  isAllDay: false,
  start: at(start),
  end: at(end),
  ...extra,
});

describe('durations and the time row', () => {
  it('formats durations', () => {
    expect([0, 30, 45, 60, 90, 120, 1440, 1500].map((m) => formatDuration(m * 60_000))).toEqual([
      '0m',
      '30m',
      '45m',
      '1h',
      '1h 30m',
      '2h',
      '1d',
      '25h',
    ]);
  });

  it('writes "Yesterday | 5:00 PM → 6:00 PM (1h)" (F §2.4)', () => {
    const m = meeting('2026-10-08T14:00:00Z', '2026-10-08T15:00:00Z');
    expect(meetingTimeLabel(m, NOW, TZ)).toBe('Yesterday | 5:00 PM → 6:00 PM (1h)');
  });

  it('labels today, tomorrow and other days', () => {
    expect(meetingTimeLabel(meeting('2026-10-09T16:00:00Z', '2026-10-09T16:30:00Z'), NOW, TZ)).toBe(
      'Today | 7:00 PM → 7:30 PM (30m)',
    );
    expect(meetingTimeLabel(meeting('2026-10-10T07:00:00Z', '2026-10-10T08:30:00Z'), NOW, TZ)).toBe(
      'Tomorrow | 10:00 AM → 11:30 AM (1h 30m)',
    );
    expect(meetingTimeLabel(meeting('2026-10-14T07:00:00Z', '2026-10-14T08:00:00Z'), NOW, TZ)).toContain('14 Oct |');
    expect(dayLabel('2025-03-02', '2026-10-09')).toBe('2 Mar 2025');
  });

  it('all-day meetings read "All day"', () => {
    const m: MeetingTimes = {
      isAllDay: true,
      start: { at: '2026-10-09T00:00:00Z', date: '2026-10-09' },
      end: { at: '2026-10-10T00:00:00Z', date: '2026-10-10' },
    };
    expect(meetingTimeLabel(m, NOW, TZ)).toBe('Today | All day');
    expect(rowTimeLabel(m, TZ)).toBe('All day');
    expect(rowTimeLabel(meeting('2026-10-09T14:00:00Z', '2026-10-09T15:15:00Z'), TZ)).toBe('5:00 PM - 6:15 PM');
  });

  it('tiles show the month and a two-digit day in the viewer zone', () => {
    expect(calendarTile(meeting('2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z'), TZ)).toEqual({
      month: 'OCT',
      day: '09',
    });
    // 22:30 UTC on the 8th is already the 9th in Moscow.
    expect(calendarTile(meeting('2026-10-08T22:30:00Z', '2026-10-08T23:00:00Z'), TZ).day).toBe('09');
    expect(calendarTile(meeting('2026-10-08T22:30:00Z', '2026-10-08T23:00:00Z'), 'UTC').day).toBe('08');
  });

  it('knows when a meeting is over', () => {
    expect(isPast(meeting('2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z'), NOW)).toBe(true);
    expect(isPast(meeting('2026-10-09T15:00:00Z', '2026-10-09T16:00:00Z'), NOW)).toBe(false);
  });
});

describe('RSVP and the timeline sentence', () => {
  it('maps statuses to the pill labels', () => {
    expect(rsvpOf('accepted', true).label).toBe('Attended');
    expect(rsvpOf('accepted', false).label).toBe('Attending');
    expect(rsvpOf('tentative', false).label).toBe('Maybe');
    expect(rsvpOf('declined', true).label).toBe('Declined');
    expect(rsvpOf('pending', false).label).toBe('Pending');
    expect(rsvpOf('accepted', true).tone).toBe('positive');
    expect(rsvpOf('declined', false).tone).toBe('critical');
  });

  it('writes the sentence by status and by past / upcoming (D §3.8)', () => {
    expect(timelineVerb('accepted', true)).toBe('attended a meeting');
    expect(timelineVerb('accepted', false)).toBe('is attending a meeting');
    expect(timelineVerb('pending', false)).toBe('was invited to a meeting');
    expect(timelineVerb('pending', true)).toBe('was invited to a meeting');
    expect(timelineVerb('declined', false)).toBe('declined a meeting invitation');
    expect(timelineVerb(null, true)).toBeNull();
  });

  it('counts participants', () => {
    expect(participantCountLabel(1)).toBe('1 participant');
    expect(participantCountLabel(3)).toBe('3 participants');
  });
});

describe('New meeting defaults and validation', () => {
  it('starts at the next half hour and lasts 30 minutes', () => {
    // 18:30 Moscow: already on the half hour.
    expect(defaultMeetingTimes(NOW, TZ)).toEqual({
      date: '2026-10-09',
      start: { hour: 18, minute: 30 },
      end: { hour: 19, minute: 0 },
    });
    expect(defaultMeetingTimes(new Date('2026-10-09T15:31:00Z'), TZ).start).toEqual({ hour: 19, minute: 0 });
    expect(defaultMeetingTimes(new Date('2026-10-09T15:59:00Z'), TZ).end).toEqual({ hour: 19, minute: 30 });
  });

  it('rolls into the next day near midnight', () => {
    const t = defaultMeetingTimes(new Date('2026-10-09T20:50:00Z'), TZ); // 23:50 Moscow
    expect(t.date).toBe('2026-10-10');
    expect(t.start).toEqual({ hour: 0, minute: 0 });
    expect(t.end).toEqual({ hour: 0, minute: 30 });
  });

  it('a meeting ending after midnight ends on the next day', () => {
    const times = { date: '2026-10-09', start: { hour: 23, minute: 30 }, end: { hour: 0, minute: 0 } };
    expect(endDateOf(times)).toBe('2026-10-10');
    expect(draftDuration(times)).toBe('30m');
    const instants = draftInstants(times, TZ);
    expect(instants.start).toBe('2026-10-09T20:30:00.000Z');
    expect(instants.end).toBe('2026-10-09T21:00:00.000Z');
  });

  it('moves the end with the start', () => {
    const times = { date: '2026-10-09', start: { hour: 10, minute: 0 }, end: { hour: 11, minute: 30 } };
    expect(shiftEnd(times, { hour: 14, minute: 0 }).end).toEqual({ hour: 15, minute: 30 });
  });

  it('parses typed times', () => {
    expect(parseClockTime('11:00 PM')).toEqual({ hour: 23, minute: 0 });
    expect(parseClockTime('11pm')).toEqual({ hour: 23, minute: 0 });
    expect(parseClockTime('9 a')).toEqual({ hour: 9, minute: 0 });
    expect(parseClockTime('12:15 am')).toEqual({ hour: 0, minute: 15 });
    expect(parseClockTime('12 pm')).toEqual({ hour: 12, minute: 0 });
    expect(parseClockTime('21:15')).toEqual({ hour: 21, minute: 15 });
    expect(parseClockTime('930')).toEqual({ hour: 9, minute: 30 });
    expect(parseClockTime('25:00')).toBeNull();
    expect(parseClockTime('13 pm')).toBeNull();
    expect(parseClockTime('soon')).toBeNull();
  });

  it('needs two participants', () => {
    expect(participantsError(0)).toBe('At least two participants are required');
    expect(participantsError(1)).toBe('At least two participants are required');
    expect(participantsError(2)).toBeNull();
  });

  it('parses typed participants', () => {
    expect(parseTypedParticipant('Jane@Example.com')).toEqual({ emailAddress: 'jane@example.com', name: null });
    expect(parseTypedParticipant('Jane Cooper <jane@example.com>')).toEqual({
      emailAddress: 'jane@example.com',
      name: 'Jane Cooper',
    });
    expect(parseTypedParticipant('not an address')).toBeNull();
    expect(parseTypedParticipant('a@b')).toBeNull();
  });
});

describe('Home widget', () => {
  it('labels the date button', () => {
    expect(homeDateLabel('2026-10-09', '2026-10-09')).toBe('Today, Oct 9');
    expect(homeDateLabel('2026-10-10', '2026-10-09')).toBe('Tomorrow, Oct 10');
    expect(homeDateLabel('2026-10-08', '2026-10-09')).toBe('Yesterday, Oct 8');
    expect(homeDateLabel('2026-10-12', '2026-10-09')).toBe('Monday, Oct 12');
  });

  it('bounds a local day in the viewer zone', () => {
    expect(dayBounds('2026-10-09', TZ)).toEqual({ from: '2026-10-08T21:00:00.000Z', to: '2026-10-09T21:00:00.000Z' });
  });

  const me = 'member-me';
  const base = {
    id: 'a',
    status: 'confirmed' as const,
    conferenceUrl: 'https://meet.example/x' as string | null,
    participants: [{ memberId: me, status: 'accepted' as const }],
    ...meeting('2026-10-09T16:00:00Z', '2026-10-09T17:00:00Z'),
  };

  it('applies the filters menu', () => {
    const allDay = { ...base, id: 'b', isAllDay: true };
    const noConf = { ...base, id: 'c', conferenceUrl: null };
    const declined = { ...base, id: 'd', participants: [{ memberId: me, status: 'declined' as const }] };
    const cancelled = { ...base, id: 'e', status: 'cancelled' as const };
    const all = [base, allDay, noConf, declined, cancelled];
    const ids = (f: Parameters<typeof applyMeetingFilters>[1]) => applyMeetingFilters(all, f, me).map((m) => m.id);
    expect(ids({ allDay: true, withoutConferencing: true, declined: true })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ allDay: false, withoutConferencing: true, declined: true })).toEqual(['a', 'c', 'd']);
    expect(ids({ allDay: true, withoutConferencing: false, declined: true })).toEqual(['a', 'b', 'd']);
    expect(ids({ allDay: true, withoutConferencing: true, declined: false })).toEqual(['a', 'b', 'c']);
  });

  it('normalises persisted filters', () => {
    expect(normaliseFilters(null)).toEqual({ allDay: true, withoutConferencing: true, declined: true });
    expect(normaliseFilters({ allDay: false, declined: 'x' })).toEqual({
      allDay: false,
      withoutConferencing: true,
      declined: true,
    });
  });

  it('windows long days around the current meeting', () => {
    const list = Array.from({ length: 9 }, (_, i) =>
      meeting(
        `2026-10-09T${String(8 + i).padStart(2, '0')}:00:00Z`,
        `2026-10-09T${String(9 + i).padStart(2, '0')}:00:00Z`,
      ),
    );
    const w = windowMeetings(list, 4, 5);
    expect(w.earlier).toHaveLength(2);
    expect(w.shown).toHaveLength(5);
    expect(w.later).toHaveLength(2);
    expect(windowMeetings(list.slice(0, 4), 1)).toEqual({ earlier: [], shown: list.slice(0, 4), later: [] });
    expect(windowMeetings(list, 8).later).toHaveLength(0);
    expect(windowMeetings(list, null).earlier).toHaveLength(0);
  });

  it('finds the current or next meeting', () => {
    const list = [
      meeting('2026-10-09T08:00:00Z', '2026-10-09T09:00:00Z'),
      meeting('2026-10-09T15:00:00Z', '2026-10-09T16:00:00Z'),
      meeting('2026-10-09T17:00:00Z', '2026-10-09T18:00:00Z'),
    ];
    expect(currentOrNextIndex(list, NOW)).toBe(1);
    expect(currentOrNextIndex(list, new Date('2026-10-09T18:30:00Z'))).toBeNull();
  });
});
