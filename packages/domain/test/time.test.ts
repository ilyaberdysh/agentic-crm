// Relative-date resolution in the viewer's time zone (X-05, C1 filters-sorts-calcs §4): calendar dates, instants
// floored to the local hour, local day bounds across DST changes, month-end clamping.
import { describe, expect, it } from 'vitest';
import {
  addIsoDuration,
  isValidTimeZone,
  localDate,
  localDayBounds,
  relativeInstant,
  relativeLocalDate,
} from '../src/time.ts';

describe('relative dates', () => {
  it.each([
    // [now, duration, zone, expected local date]
    ['2026-10-10T12:00:00Z', 'P0D', 'UTC', '2026-10-10'],
    ['2026-10-10T22:30:00Z', 'P0D', 'Europe/Moscow', '2026-10-11'], // 01:30 next day in Moscow
    ['2026-10-10T03:00:00Z', 'P0D', 'America/Los_Angeles', '2026-10-09'],
    ['2026-10-10T12:00:00Z', '-P1D', 'UTC', '2026-10-09'],
    ['2026-10-10T12:00:00Z', 'P1D', 'UTC', '2026-10-11'],
    ['2026-10-10T12:00:00Z', '-P7D', 'UTC', '2026-10-03'],
    ['2026-10-10T12:00:00Z', '-P0Y0M30DT0H0M0S', 'UTC', '2026-09-10'], // Attio's stored form
    ['2026-03-31T12:00:00Z', '-P1M', 'UTC', '2026-02-28'], // clamped to the month's end
    ['2026-01-31T12:00:00Z', 'P1M', 'Europe/Berlin', '2026-02-28'],
    ['2028-03-31T12:00:00Z', '-P1M', 'UTC', '2028-02-29'],
  ])('%s %s in %s → %s', (now, duration, zone, expected) => {
    expect(relativeLocalDate(now, duration, zone)).toBe(expected);
  });

  it.each([
    // [now, duration, zone, expected instant floored to the local hour]
    ['2026-10-10T12:34:56Z', 'P0D', 'UTC', '2026-10-10T12:00:00.000Z'],
    ['2026-10-10T12:34:56Z', '-P1D', 'UTC', '2026-10-09T12:00:00.000Z'],
    ['2026-10-10T12:34:56Z', 'P0D', 'Asia/Kolkata', '2026-10-10T12:30:00.000Z'], // 18:04 local → 18:00
    ['2026-10-10T12:34:56Z', 'P1D', 'Europe/Moscow', '2026-10-11T12:00:00.000Z'],
    // Across the Berlin spring-forward night: 30 Mar 10:15 CEST − 1 day = 29 Mar 10:00 CEST (08:00Z).
    ['2026-03-30T08:15:00Z', '-P1D', 'Europe/Berlin', '2026-03-29T08:00:00.000Z'],
  ])('%s %s in %s → %s', (now, duration, zone, expected) => {
    expect(relativeInstant(now, duration, zone)).toBe(expected);
  });

  it('local day bounds follow DST changes', () => {
    expect(localDayBounds('2026-10-10', 'UTC')).toEqual({
      start: '2026-10-10T00:00:00.000Z',
      end: '2026-10-11T00:00:00.000Z',
    });
    // Berlin springs forward on 29 March 2026: a 23-hour day.
    expect(localDayBounds('2026-03-29', 'Europe/Berlin')).toEqual({
      start: '2026-03-28T23:00:00.000Z',
      end: '2026-03-29T22:00:00.000Z',
    });
    // New York falls back on 1 November 2026: a 25-hour day.
    expect(localDayBounds('2026-11-01', 'America/New_York')).toEqual({
      start: '2026-11-01T04:00:00.000Z',
      end: '2026-11-02T05:00:00.000Z',
    });
    expect(localDate('2026-11-01T04:30:00Z', 'America/New_York')).toBe('2026-11-01');
  });

  it('validates zones and keeps dynamic defaults working', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(addIsoDuration('2026-10-10T12:00:00.000Z', 'PT0S')).toBe('2026-10-10T12:00:00.000Z');
    expect(addIsoDuration('2026-10-10T12:00:00.000Z', 'P1Y')).toBe('2027-10-10T12:00:00.000Z');
  });
});
