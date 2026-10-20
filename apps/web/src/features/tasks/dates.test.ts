import { createdBucketOf, createdBucketRanges, taskBucketBounds, taskBucketOf } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { deadlineChipLabel, deadlineInput, draftFromDeadline, dueLabel, zonedInstant } from './deadline';
import { type DateContext, numericOrderForLocale, parseNaturalDate } from './naturalDate';

// Friday 9 October 2026 (the day the Attio captures were taken), Sunday-start week (en-US).
const ctx: DateContext = { today: '2026-10-09', weekStart: 0, now: { hour: 10, minute: 0 }, numericOrder: 'mdy' };
const parse = (text: string, c: DateContext = ctx) => parseNaturalDate(text, c);
const dateOf = (text: string, c: DateContext = ctx) => parse(text, c)?.date ?? null;

describe('parseNaturalDate', () => {
  it('relative days', () => {
    expect(dateOf('today')).toBe('2026-10-09');
    expect(dateOf('Tomorrow')).toBe('2026-10-10');
    expect(dateOf('tmrw')).toBe('2026-10-10');
    expect(dateOf('yesterday')).toBe('2026-10-08');
    expect(dateOf('the day after tomorrow')).toBe('2026-10-11');
  });

  it('weekdays: "next friday" on a Friday is a week later (E README §2.7b)', () => {
    expect(dateOf('next friday')).toBe('2026-10-16');
    expect(dateOf('friday')).toBe('2026-10-16');
    expect(dateOf('monday')).toBe('2026-10-12');
    expect(dateOf('next tuesday')).toBe('2026-10-13');
    expect(dateOf('on wed')).toBe('2026-10-14');
    expect(dateOf('this saturday')).toBe('2026-10-10');
  });

  it('"next tuesday" depends on the week start', () => {
    // Wednesday 14 Oct: Monday-start week → next week starts Mon 19 → Tue 20; Sunday-start → Sun 18 → Tue 20 too,
    // but "next sunday" differs: Monday weeks end on Sunday.
    const wed = { ...ctx, today: '2026-10-14' };
    expect(dateOf('next tuesday', { ...wed, weekStart: 1 })).toBe('2026-10-20');
    expect(dateOf('next sunday', { ...wed, weekStart: 1 })).toBe('2026-10-25');
    expect(dateOf('next sunday', { ...wed, weekStart: 0 })).toBe('2026-10-18');
  });

  it('bare short weekdays and month names in prose are not dates', () => {
    expect(parse('Plan the sat launch party')).toBeNull();
    expect(parse('Enjoy the sun')).toBeNull();
    expect(parse('May the force be with you')).toBeNull();
    expect(parse('Upgrade to version 3.5')).toBeNull();
  });

  it('periods and offsets', () => {
    expect(dateOf('next week')).toBe('2026-10-11');
    expect(dateOf('next week', { ...ctx, weekStart: 1 })).toBe('2026-10-12');
    expect(dateOf('next month')).toBe('2026-11-01');
    expect(dateOf('end of month')).toBe('2026-10-31');
    expect(dateOf('by the end of the week')).toBe('2026-10-10');
    expect(dateOf('in 3 days')).toBe('2026-10-12');
    expect(dateOf('in a week')).toBe('2026-10-16');
    expect(dateOf('in two weeks')).toBe('2026-10-23');
    expect(dateOf('in 1 month')).toBe('2026-11-09');
    expect(dateOf('2 days from now')).toBe('2026-10-11');
  });

  it('calendar dates, rolling to next year once passed', () => {
    expect(dateOf('Oct 16')).toBe('2026-10-16');
    expect(dateOf('october 16th, 2027')).toBe('2027-10-16');
    expect(dateOf('16 October')).toBe('2026-10-16');
    expect(dateOf('5th of jan')).toBe('2027-01-05');
    expect(dateOf('2026-12-01')).toBe('2026-12-01');
    expect(dateOf('10/16')).toBe('2026-10-16');
    expect(dateOf('16/10', { ...ctx, numericOrder: 'dmy' })).toBe('2026-10-16');
    expect(dateOf('16.10.2026')).toBe('2026-10-16');
    expect(dateOf('Feb 30')).toBeNull();
  });

  it('finds the phrase inside a task title and keeps its span', () => {
    const text = '[seed] Prepare demo for @[seed] Cedar Health tomorrow at 3pm';
    const r = parse(text);
    expect(r?.date).toBe('2026-10-10');
    expect(r?.time).toEqual({ hour: 15, minute: 0 });
    expect(text.slice(r?.start, r?.end)).toBe('tomorrow at 3pm');
  });

  it('times: am/pm, 24 h, noon, before or after the date', () => {
    expect(parse('friday 9:30am')?.time).toEqual({ hour: 9, minute: 30 });
    expect(parse('tomorrow 15:45')?.time).toEqual({ hour: 15, minute: 45 });
    expect(parse('tomorrow at noon')?.time).toEqual({ hour: 12, minute: 0 });
    expect(parse('12am tomorrow')?.time).toEqual({ hour: 0, minute: 0 });
    expect(parse('next friday at 3')?.time).toEqual({ hour: 15, minute: 0 });
    expect(parse('Call Ana about 3pm slides')?.date).toBe('2026-10-09');
  });

  it('a time alone is today, or tomorrow once it has passed', () => {
    expect(parse('at 3pm')).toMatchObject({ date: '2026-10-09', time: { hour: 15, minute: 0 } });
    expect(parse('at 9am')).toMatchObject({ date: '2026-10-10', time: { hour: 9, minute: 0 } });
  });

  it('locale numeric order', () => {
    expect(numericOrderForLocale('en-US')).toBe('mdy');
    expect(numericOrderForLocale('ru-RU')).toBe('dmy');
    expect(numericOrderForLocale('en-GB')).toBe('dmy');
  });
});

describe('due labels (E README §2.6)', () => {
  const now = '2026-10-09T09:00:00Z';
  const zone = 'Europe/Moscow';
  const endOf = (date: string) => new Date(Date.parse(`${date}T21:00:00Z`) - 1).toISOString(); // 23:59:59.999 MSK
  it('reads like Attio', () => {
    expect(dueLabel(endOf('2026-10-08'), now, zone)).toEqual({ text: 'Due yesterday', tone: 'overdue' });
    expect(dueLabel(endOf('2026-10-04'), now, zone)).toEqual({ text: 'Due 5 days ago', tone: 'overdue' });
    expect(dueLabel(endOf('2026-10-09'), now, zone)).toEqual({ text: 'Due today', tone: 'soon' });
    expect(dueLabel(endOf('2026-10-10'), now, zone)).toEqual({ text: 'Due tomorrow', tone: 'soon' });
    expect(dueLabel(endOf('2026-10-14'), now, zone)).toEqual({ text: 'Due in 5 days', tone: 'soon' });
    expect(dueLabel(endOf('2026-10-19'), now, zone)).toEqual({ text: 'Due Oct 19, 2026', tone: 'later' });
    expect(dueLabel(null, now, zone)).toBeNull();
  });

  it('a timed deadline earlier today is overdue', () => {
    expect(dueLabel('2026-10-09T06:00:00Z', now, zone)).toEqual({ text: 'Due today', tone: 'overdue' });
  });
});

describe('deadline chip and input (X-09)', () => {
  it('chip text', () => {
    expect(deadlineChipLabel({ date: '2026-10-09', time: null }, '2026-10-09')).toBe('Today');
    expect(deadlineChipLabel({ date: '2026-10-10', time: null }, '2026-10-09')).toBe('Tomorrow');
    expect(deadlineChipLabel({ date: '2026-10-16', time: null }, '2026-10-09')).toBe('October 16, 2026');
    expect(deadlineChipLabel({ date: '2026-10-10', time: { hour: 15, minute: 0 } }, '2026-10-09')).toBe(
      'Tomorrow, 3:00 PM',
    );
    expect(deadlineChipLabel(null, '2026-10-09')).toBe('No due date');
  });

  it('a date is sent as a local date; a time as the zoned instant', () => {
    expect(deadlineInput({ date: '2026-10-10', time: null }, 'Europe/Moscow')).toEqual({
      kind: 'date',
      date: '2026-10-10',
      timeZone: 'Europe/Moscow',
    });
    expect(deadlineInput({ date: '2026-10-10', time: { hour: 15, minute: 0 } }, 'Europe/Moscow')).toEqual({
      kind: 'datetime',
      at: '2026-10-10T12:00:00.000Z',
    });
    expect(deadlineInput(null, 'UTC')).toBeNull();
  });

  it('zoned instants across DST', () => {
    expect(zonedInstant('2026-03-29', { hour: 12, minute: 0 }, 'Europe/Berlin')).toBe('2026-03-29T10:00:00.000Z');
    expect(zonedInstant('2026-03-28', { hour: 12, minute: 0 }, 'Europe/Berlin')).toBe('2026-03-28T11:00:00.000Z');
    expect(zonedInstant('2026-11-01', { hour: 9, minute: 30 }, 'America/New_York')).toBe('2026-11-01T14:30:00.000Z');
  });

  it('round-trips stored deadlines', () => {
    expect(draftFromDeadline('2026-10-10T20:59:59.999Z', false, 'Europe/Moscow')).toEqual({
      date: '2026-10-10',
      time: null,
    });
    expect(draftFromDeadline('2026-10-10T12:00:00.000Z', true, 'Europe/Moscow')).toEqual({
      date: '2026-10-10',
      time: { hour: 15, minute: 0 },
    });
  });
});

describe('buckets in the viewer zone and week start (B.24, X-10)', () => {
  it('task deadline buckets: Sunday-start week ends Saturday', () => {
    const bounds = taskBucketBounds('2026-10-09T09:00:00Z', 'Europe/Moscow', 0);
    const b = (deadlineAt: string | null, isCompleted = false) => taskBucketOf({ deadlineAt, isCompleted }, bounds);
    expect(b('2026-10-08T20:59:59.999Z')).toBe('overdue');
    expect(b('2026-10-09T20:59:59.999Z')).toBe('today');
    expect(b('2026-10-10T20:59:59.999Z')).toBe('this-week');
    expect(b('2026-10-11T20:59:59.999Z')).toBe('later');
    expect(b(null)).toBe('no-date');
    expect(b('2026-10-01T00:00:00Z', true)).toBe('completed');
  });

  it('Monday-start week keeps Sunday in this week', () => {
    const bounds = taskBucketBounds('2026-10-09T09:00:00Z', 'Europe/Moscow', 1);
    expect(taskBucketOf({ deadlineAt: '2026-10-11T20:59:59.999Z', isCompleted: false }, bounds)).toBe('this-week');
  });

  it('note creation buckets', () => {
    const ranges = createdBucketRanges('2026-10-14T09:00:00Z', 'UTC', 1);
    expect(createdBucketOf('2026-10-14T08:00:00Z', ranges)).toBe('today');
    expect(createdBucketOf('2026-10-12T08:00:00Z', ranges)).toBe('this-week');
    expect(createdBucketOf('2026-10-06T08:00:00Z', ranges)).toBe('last-week');
    expect(createdBucketOf('2026-10-02T08:00:00Z', ranges)).toBe('earlier-this-month');
    expect(createdBucketOf('2026-09-15T08:00:00Z', ranges)).toBe('last-month');
    expect(createdBucketOf('2026-03-15T08:00:00Z', ranges)).toBe('earlier-this-year');
    expect(createdBucketOf('2025-03-15T08:00:00Z', ranges)).toBe('last-year');
    expect(createdBucketOf('2023-03-15T08:00:00Z', ranges)).toBe('older');
  });
});
