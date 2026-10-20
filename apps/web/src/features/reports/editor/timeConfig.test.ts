import type { ReportTimeConfig } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { compareDisabledReason, comparisonLabel, comparisonOptions, RANGES, rangeOf, withDuration } from './timeConfig';

const env = { today: '2026-10-14', weekStart: 1 };
const config = (patch: Partial<ReportTimeConfig> = {}): ReportTimeConfig => ({
  duration: null,
  resolution: 'month',
  comparison: null,
  ...patch,
});

describe('rangeOf', () => {
  it('recognises the presets and equivalent durations', () => {
    expect(rangeOf(null)).toBe('all');
    expect(rangeOf(RANGES[3]?.duration ?? null)).toBe('6M');
    expect(rangeOf({ type: 'relative', value: '-P1Y' })).toBe('12M');
    expect(rangeOf({ type: 'relative', value: '-P0Y0M7DT0H0M0S' })).toBe('7D');
    expect(rangeOf({ type: 'x_to_date', value: 'month' })).toBeNull();
  });
});

describe('comparisonOptions', () => {
  it('offers the previous period for a relative range with its window', () => {
    const c = config({ duration: { type: 'relative', value: '-P0Y6M0DT0H0M0S' } });
    const options = comparisonOptions(c, env);
    const previous = options.find((o) => o.id === 'previous-period');
    expect(previous?.enabled).toBe(true);
    expect(previous?.label).toBe('Previous period 14 Oct 2025 - 14 Apr 2026');
    expect(options.filter((o) => o.enabled).map((o) => o.id)).toEqual(['previous-period']);
    expect(options.find((o) => o.id === 'previous-month')?.reason).toContain('Period to date');
  });

  it('offers the matching previous period and the previous year for a period to date', () => {
    const c = config({ duration: { type: 'x_to_date', value: 'month' } });
    const options = comparisonOptions(c, env);
    expect(options.filter((o) => o.enabled).map((o) => o.id)).toEqual(['previous-month', 'previous-year']);
    expect(options.find((o) => o.id === 'previous-month')?.label).toBe('Previous month 1 Sep 2026 - 14 Sep 2026');
    expect(options.find((o) => o.id === 'previous-year')?.label).toBe('Previous year 1 Oct 2025 - 14 Oct 2025');
  });
});

describe('compare availability and labels', () => {
  it('is disabled for All and for non bar / line charts', () => {
    expect(compareDisabledReason(config(), 'bar')).toContain("'All'");
    const c = config({ duration: { type: 'relative', value: '-P0Y3M0DT0H0M0S' } });
    expect(compareDisabledReason(c, 'pie')).toContain('line and bar');
    expect(compareDisabledReason(c, 'line')).toBeNull();
  });

  it('names the active comparison', () => {
    expect(comparisonLabel(config())).toBeNull();
    expect(comparisonLabel(config({ comparison: { type: 'previous_period' } }))).toBe('Previous period');
    expect(comparisonLabel(config({ comparison: { type: 'offset', value: '-P0Y1M0DT0H0M0S' } }))).toBe(
      'Previous month',
    );
    expect(comparisonLabel(config({ comparison: { type: 'offset', value: '-P1Y0M0DT0H0M0S' } }))).toBe('Previous year');
  });
});

describe('withDuration', () => {
  it('keeps a comparison that still fits and drops one that does not', () => {
    const c = config({
      duration: { type: 'relative', value: '-P0Y6M0DT0H0M0S' },
      comparison: { type: 'previous_period' },
    });
    expect(withDuration(c, { type: 'relative', value: '-P0Y3M0DT0H0M0S' }, env).comparison).toEqual({
      type: 'previous_period',
    });
    expect(withDuration(c, { type: 'x_to_date', value: 'month' }, env).comparison).toBeNull();
    expect(withDuration(c, null, env).comparison).toBeNull();
    const p = config({
      duration: { type: 'x_to_date', value: 'month' },
      comparison: { type: 'offset', value: '-P0Y1M0DT0H0M0S' },
    });
    expect(withDuration(p, { type: 'x_to_date', value: 'month' }, env).comparison).not.toBeNull();
    expect(withDuration(p, { type: 'x_to_date', value: 'quarter' }, env).comparison).toBeNull();
  });
});
