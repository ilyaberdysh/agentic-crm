import { describe, expect, it } from 'vitest';
import { formatAbsoluteDate, formatCreatedAt, formatDistanceAgo, ordinal } from './format';

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [9, '9th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [30, '30th'],
    [31, '31st'],
  ])('%i -> %s', (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});

describe('absolute dates', () => {
  it('writes "Oct 9th 2026" and "9th Oct 2026 1:46 PM" in the given zone', () => {
    const iso = '2026-10-09T10:46:00Z';
    expect(formatAbsoluteDate(iso, 'Europe/Moscow')).toBe('Oct 9th 2026');
    expect(formatCreatedAt(iso, 'Europe/Moscow')).toBe('9th Oct 2026 1:46 PM');
    expect(formatCreatedAt(iso, 'UTC')).toBe('9th Oct 2026 10:46 AM');
  });
  it('moves to the next day across midnight in the zone', () => {
    expect(formatAbsoluteDate('2026-10-08T22:30:00Z', 'Europe/Moscow')).toBe('Oct 9th 2026');
    expect(formatAbsoluteDate('2026-10-08T22:30:00Z', 'UTC')).toBe('Oct 8th 2026');
  });
  it('is empty for an invalid date', () => {
    expect(formatAbsoluteDate('nope', 'UTC')).toBe('');
    expect(formatCreatedAt('nope', 'UTC')).toBe('');
  });
});

describe('formatDistanceAgo (date-fns wording)', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const ago = (ms: number) => formatDistanceAgo(new Date(now - ms).toISOString(), now);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  it('covers seconds to hours', () => {
    expect(ago(10_000)).toBe('less than a minute ago');
    expect(ago(40_000)).toBe('1 minute ago');
    expect(ago(5 * MIN)).toBe('5 minutes ago');
    expect(ago(50 * MIN)).toBe('about 1 hour ago');
    expect(ago(15 * HOUR)).toBe('about 15 hours ago');
  });
  it('covers days to years', () => {
    expect(ago(30 * HOUR)).toBe('1 day ago');
    expect(ago(12 * DAY)).toBe('12 days ago');
    expect(ago(35 * DAY)).toBe('about 1 month ago');
    expect(ago(100 * DAY)).toBe('3 months ago');
    expect(ago(380 * DAY)).toBe('about 1 year ago');
    expect(ago(500 * DAY)).toBe('over 1 year ago');
    expect(ago(700 * DAY)).toBe('almost 2 years ago');
  });
  it('treats a future date as "less than a minute ago" and an invalid one as empty', () => {
    expect(formatDistanceAgo(new Date(now + HOUR).toISOString(), now)).toBe('less than a minute ago');
    expect(formatDistanceAgo('nope', now)).toBe('');
  });
});
