// Calendar helpers (decisions X-09 / X-10; E README §2.1 date buckets, §2.6 deadline buckets).
import { describe, expect, it } from 'vitest';
import {
  createdBucketOf,
  createdBucketRanges,
  endOfLocalDay,
  localDateOf,
  localDayRange,
  startOfWeek,
  taskBucketBounds,
  taskBucketOf,
  weekStartForLocale,
} from '../src/dates.ts';

describe('week start from the locale (X-10)', () => {
  it.each([
    ['ru', 1],
    ['ru-RU', 1],
    ['de-DE', 1],
    ['en-GB', 1],
    ['en-US', 0],
    ['en', 0],
    ['ja-JP', 0],
    ['he-IL', 0],
    [null, 1],
    ['not a locale!', 1],
  ])('%s → %i', (locale, day) => {
    expect(weekStartForLocale(locale)).toBe(day);
  });
});

describe('local days', () => {
  it.each([
    // date, zone, start, end of day (X-09)
    ['2026-10-11', 'UTC', '2026-10-11T00:00:00.000Z', '2026-10-11T23:59:59.999Z'],
    ['2026-10-11', 'Europe/Moscow', '2026-10-10T21:00:00.000Z', '2026-10-11T20:59:59.999Z'],
    ['2026-10-11', 'America/New_York', '2026-10-11T04:00:00.000Z', '2026-10-12T03:59:59.999Z'],
    // DST: New York springs forward on 2026-03-08 (a 23-hour day)
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z'],
    // Berlin falls back on 2026-10-25 (a 25-hour day)
    ['2026-10-25', 'Europe/Berlin', '2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.999Z'],
  ])('%s in %s', (date, zone, start, end) => {
    expect(localDayRange(date, zone).start).toBe(start);
    expect(endOfLocalDay(date, zone)).toBe(end);
    expect(localDateOf(start, zone)).toBe(date);
  });

  it.each([
    ['2026-10-11', 1, '2026-10-05'], // Sunday → Monday start
    ['2026-10-11', 0, '2026-10-11'],
    ['2026-10-12', 1, '2026-10-12'],
    ['2026-10-10', 6, '2026-10-10'],
    ['2026-10-09', 6, '2026-10-03'],
  ] as const)('week of %s starting on day %i begins %s', (date, weekStart, expected) => {
    expect(startOfWeek(date, weekStart)).toBe(expected);
  });
});

describe('task deadline buckets (E README §2.6)', () => {
  // Wednesday 2026-10-14 12:00 in Moscow; week starts Monday → ends Sunday 2026-10-18 23:59:59.999 local.
  const now = '2026-10-14T09:00:00Z';
  const bounds = taskBucketBounds(now, 'Europe/Moscow', 1);

  it('computes the bounds in the viewer zone', () => {
    expect(bounds).toEqual({
      startOfToday: '2026-10-13T21:00:00.000Z',
      endOfToday: '2026-10-14T20:59:59.999Z',
      endOfWeek: '2026-10-18T20:59:59.999Z',
    });
    expect(taskBucketBounds(now, 'Europe/Moscow', 0).endOfWeek).toBe('2026-10-17T20:59:59.999Z');
  });

  it.each([
    [null, false, 'no-date'],
    ['2026-10-01T10:00:00Z', true, 'completed'],
    ['2026-10-12T10:00:00Z', false, 'overdue'],
    ['2026-10-13T20:59:59.999Z', false, 'overdue'],
    ['2026-10-13T21:00:00.000Z', false, 'today'],
    ['2026-10-14T20:59:59.999Z', false, 'today'],
    ['2026-10-15T10:00:00Z', false, 'this-week'],
    ['2026-10-18T20:59:59.999Z', false, 'this-week'],
    ['2026-10-18T21:00:00Z', false, 'later'],
  ] as const)('deadline %s (completed: %s) → %s', (deadlineAt, isCompleted, bucket) => {
    expect(taskBucketOf({ deadlineAt, isCompleted }, bounds)).toBe(bucket);
  });
});

describe('creation-date buckets (E README §2.1)', () => {
  it.each([
    // now (UTC zone, Monday weeks): Wednesday 2026-10-14
    ['2026-10-14T10:00:00Z', 'today'],
    ['2026-10-12T10:00:00Z', 'this-week'],
    ['2026-10-06T10:00:00Z', 'last-week'],
    ['2026-10-02T10:00:00Z', 'earlier-this-month'],
    ['2026-09-20T10:00:00Z', 'last-month'],
    ['2026-03-01T10:00:00Z', 'earlier-this-year'],
    ['2025-06-01T10:00:00Z', 'last-year'],
    ['2023-06-01T10:00:00Z', 'older'],
  ])('%s → %s', (createdAt, bucket) => {
    const ranges = createdBucketRanges('2026-10-14T12:00:00Z', 'UTC', 1);
    expect(createdBucketOf(createdAt, ranges)).toBe(bucket);
  });

  it('makes "earlier this month" empty when last week started before the 1st, and stays disjoint', () => {
    const ranges = createdBucketRanges('2026-10-03T12:00:00Z', 'UTC', 1); // Saturday; last week began Sep 21
    const earlier = ranges.find((r) => r.key === 'earlier-this-month');
    expect(earlier && earlier.from !== null && earlier.from >= earlier.to).toBe(true);
    expect(createdBucketOf('2026-09-24T10:00:00Z', ranges)).toBe('last-week');
    expect(createdBucketOf('2026-09-10T10:00:00Z', ranges)).toBe('last-month');
  });
});
