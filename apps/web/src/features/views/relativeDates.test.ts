import { describe, expect, it } from 'vitest';
import {
  customDaysOf,
  dateValueLabel,
  daysDuration,
  hourEpoch,
  presetDuration,
  presetOf,
  RELATIVE_PRESETS,
} from './relativeDates';

describe('relative date presets (C1 filters-sorts-calcs §4)', () => {
  it('lists the presets in menu order', () => {
    expect(RELATIVE_PRESETS.map((p) => p.label)).toEqual([
      'Today',
      'Tomorrow',
      'Yesterday',
      'One week ago',
      'One week from now',
      'One month ago',
      'One month from now',
    ]);
  });

  it('serialises as ISO-8601 durations (negative = past), shared with the server table', () => {
    expect(presetDuration('today')).toBe('P0D');
    expect(presetDuration('yesterday')).toBe('-P1D');
    expect(presetDuration('one-month-from-now')).toBe('P1M');
    expect(daysDuration(30, 'ago')).toBe('-P30D');
    expect(daysDuration(3, 'from-now')).toBe('P3D');
  });

  it("parses stored durations back, including Attio's long form", () => {
    expect(presetOf('-P7D')?.id).toBe('one-week-ago');
    expect(presetOf('-P0Y0M7DT0H0M0S')?.id).toBe('one-week-ago');
    expect(presetOf('PT1H')).toBeUndefined();
    expect(customDaysOf('-P0Y0M12DT0H0M0S')).toEqual({ days: 12, direction: 'ago' });
    expect(customDaysOf(presetDuration('one-week-ago'))).toBeNull();
  });

  it('labels values, with timestamp wording for today/tomorrow/yesterday', () => {
    expect(dateValueLabel({ kind: 'relative', duration: presetDuration('today') })).toBe('Today');
    expect(dateValueLabel({ kind: 'relative', duration: presetDuration('today') }, { timestamp: true })).toBe('Now');
    expect(dateValueLabel({ kind: 'relative', duration: daysDuration(3, 'from-now') })).toBe('3 days from now');
    expect(dateValueLabel({ kind: 'relative', duration: daysDuration(1, 'ago') })).toBe('Yesterday');
    expect(dateValueLabel({ kind: 'exact', date: '2026-03-01' })).toBe('Mar 1, 2026');
  });

  it('re-resolves hourly via an hour epoch', () => {
    const t = Date.UTC(2026, 9, 10, 12, 30);
    expect(hourEpoch(t)).toBe(hourEpoch(t + 29 * 60_000));
    expect(hourEpoch(t + 31 * 60_000)).toBe(hourEpoch(t) + 1);
  });
});
