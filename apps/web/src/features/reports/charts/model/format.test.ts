import { beforeAll, describe, expect, it } from 'vitest';
import { setFormatSettings } from '../../../attributes/format/locale';
import {
  axisMagnitude,
  axisTickFormatter,
  changePercent,
  durationAxisUnit,
  formatChange,
  formatDuration,
  formatMetricValue,
  formatPercentValue,
} from './format';
import { durationTicks, niceStep, niceTicks, tickCountFor } from './ticks';

beforeAll(() => setFormatSettings({ locale: 'en-US', timeZone: 'UTC', weekStartsOn: 1 }));

const EUR = { kind: 'currency', currency: 'EUR', decimals: 2, display: 'symbol' } as const;
const H = 3_600_000;

describe('formatDuration', () => {
  it('writes "3hr 25m 7s" and leaves zero parts out', () => {
    expect(formatDuration(3 * H + 25 * 60_000 + 7_000)).toBe('3hr 25m 7s');
    expect(formatDuration(H)).toBe('1hr');
    expect(formatDuration(2 * 86_400_000 + 5_000)).toBe('2d 5s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(400)).toBe('<1s');
    expect(formatDuration(null)).toBe('–');
  });
});

describe('formatMetricValue', () => {
  it('formats counts, numbers, currency and durations like the table / tooltip', () => {
    expect(formatMetricValue(12, { kind: 'count' })).toBe('12');
    expect(formatMetricValue(470_000, EUR)).toBe('€470,000.00');
    expect(formatMetricValue(470_000, { ...EUR, decimals: 0 })).toBe('€470,000');
    expect(formatMetricValue(1234.5, { kind: 'number', decimals: 1, grouping: true })).toBe('1,234.5');
    expect(formatMetricValue(1234.5, { kind: 'number', decimals: null, grouping: false })).toBe('1234.5');
    expect(formatMetricValue(H, { kind: 'duration' })).toBe('1hr');
    expect(formatMetricValue(null, { kind: 'count' })).toBe('–');
  });
});

describe('percentages', () => {
  it('writes a space before the sign', () => {
    expect(formatPercentValue(44.44)).toBe('44 %');
    expect(formatPercentValue(100)).toBe('100 %');
    expect(formatPercentValue(0.4)).toBe('0.4 %');
    expect(formatPercentValue(null)).toBe('–');
  });

  it('formats change badges and relative change', () => {
    expect(changePercent(45_000, 250_000)).toBeCloseTo(-82, 5);
    expect(formatChange(changePercent(45_000, 250_000))).toBe('-82 %');
    expect(formatChange(12.4)).toBe('+12 %');
    expect(formatChange(0)).toBe('No change');
    expect(changePercent(10, 0)).toBeNull();
    expect(changePercent(0, 0)).toBe(0);
  });
});

describe('axis labels', () => {
  it('uses one unit for every tick of a currency axis ("€0k", "€500k")', () => {
    const ticks = [0, 100_000, 200_000, 300_000, 400_000, 500_000];
    const f = axisTickFormatter(EUR, ticks);
    expect(ticks.map(f)).toEqual(['€0k', '€100k', '€200k', '€300k', '€400k', '€500k']);
  });

  it('switches to millions', () => {
    const ticks = [0, 500_000, 1_000_000, 1_500_000];
    expect(axisMagnitude(ticks).suffix).toBe('M');
    expect(ticks.map(axisTickFormatter(EUR, ticks))).toEqual(['€0M', '€0.5M', '€1M', '€1.5M']);
  });

  it('keeps small counts as integers and compacts large ones', () => {
    expect([0, 2, 4, 6].map(axisTickFormatter({ kind: 'count' }, [0, 2, 4, 6]))).toEqual(['0', '2', '4', '6']);
    expect([0, 5000, 10000].map(axisTickFormatter({ kind: 'count' }, [0, 5000, 10000]))).toEqual(['0k', '5k', '10k']);
  });

  it('labels duration ticks in whole units and leaves the baseline unlabelled', () => {
    const ticks = [0, H, 2 * H, 3 * H];
    const f = axisTickFormatter({ kind: 'duration' }, ticks);
    expect(ticks.map(f)).toEqual(['', '1hr', '2hr', '3hr']);
    expect(durationAxisUnit(30 * 60_000)).toEqual({ div: 60_000, suffix: 'm' });
    expect(durationAxisUnit(86_400_000)).toEqual({ div: 86_400_000, suffix: 'd' });
  });
});

describe('nice ticks', () => {
  it('rounds the domain up to the step like the editor chart (470k → 0…500k in steps of 100k)', () => {
    expect(tickCountFor(652)).toBe(6);
    const t = niceTicks(0, 470_000, tickCountFor(652));
    expect(t.domain).toEqual([0, 500_000]);
    expect(t.ticks).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000]);
  });

  it('uses 4 ticks in a dashboard cell (target 300k, plot 245 px) and 200k steps for 730k in 216 px', () => {
    expect(tickCountFor(245)).toBe(3);
    expect(niceTicks(0, 730_000, tickCountFor(216)).ticks).toEqual([0, 200_000, 400_000, 600_000, 800_000]);
    expect(niceTicks(0, 730_000, tickCountFor(519)).ticks).toHaveLength(9);
    expect(niceTicks(0, 300_000, 3).ticks).toEqual([0, 100_000, 200_000, 300_000]);
  });

  it('keeps count ticks integer (14 → steps of 2; 3 → steps of 1)', () => {
    expect(niceTicks(0, 14, 6, { integers: true }).ticks).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(niceTicks(0, 3, 6, { integers: true }).ticks).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0, 0, 5, { integers: true }).domain).toEqual([0, 1]);
  });

  it('includes negative values', () => {
    const t = niceTicks(-30, 80, 5);
    expect(t.domain[0]).toBeLessThanOrEqual(-30);
    expect(t.ticks).toContain(0);
  });

  it('chooses 1-2-5 steps', () => {
    expect(niceStep(470_000, 6)).toBe(100_000);
    expect(niceStep(470_000, 7)).toBe(50_000);
    expect(niceStep(100, 4)).toBe(20);
    expect(niceStep(12, 4)).toBe(2);
  });

  it('puts duration ticks on whole hours and ends the domain at the data (6.83h → 1hr…6hr)', () => {
    const t = durationTicks(0, 6.83 * H, tickCountFor(653));
    expect(t.step).toBe(H);
    expect(t.ticks).toEqual([0, 1, 2, 3, 4, 5, 6].map((h) => h * H));
    expect(t.domain).toEqual([0, 6.83 * H]);
  });

  it('steps through minutes for short durations', () => {
    const t = durationTicks(0, 25 * 60_000, 5);
    expect(t.step).toBe(5 * 60_000);
  });
});
