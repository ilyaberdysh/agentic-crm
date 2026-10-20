import { beforeAll, describe, expect, it } from 'vitest';
import { setFormatSettings } from '../../../attributes/format/locale';
import * as fx from '../dev/fixtures';
import type { CartesianModel } from '../model/cartesian';
import { buildChart } from '../model/plan';
import { computeCartesianLayout, ROTATED_LABEL_MAX } from './layout';

beforeAll(() => setFormatSettings({ locale: 'en-US', timeZone: 'UTC', weekStartsOn: 1 }));

const model = (f: fx.Fixture): CartesianModel => {
  const plan = buildChart(f.ctx, f.data);
  if (plan.type !== 'cartesian') throw new Error('not a cartesian model');
  return plan;
};

// Inter 12/500 is ≈ 6.4 px per character.
const measure = (t: string) => t.length * 6.4;
const truncate = (t: string, max: number) => (measure(t) <= max ? t : `${t.slice(0, Math.floor(max / 6.4) - 1)}…`);

function layout(f: fx.Fixture, width: number, height: number, size: 'canvas' | 'cell' = 'canvas') {
  const m = model(f);
  return computeCartesianLayout({
    model: m,
    width,
    height,
    size,
    hasLegend: m.legend.length > 1 || Boolean(m.comparison),
    measure,
    truncate,
    ctxFormat: f.ctx.metric.format,
  });
}

describe('cartesian layout (measured from the Attio screenshots)', () => {
  it('puts the editor plot at x ≈ 155, y 38 and leaves 97 px on the right', () => {
    const l = layout(fx.barGrouped, 830, 790);
    expect(l.plot.x).toBeGreaterThan(145);
    expect(l.plot.x).toBeLessThan(165);
    expect(l.plot.y).toBe(38);
    expect(l.plot.x + l.plot.w).toBeCloseTo(830 - 97, 0);
    // 104 px below the baseline (labels, title, padding): the plot ends at 790 - 104.
    expect(l.plot.y + l.plot.h).toBeCloseTo(790 - 104, 0);
    expect(l.rotated).toBe(false);
    expect(l.yTicks.map((t) => t.label)).toEqual(['€0k', '€100k', '€200k', '€300k', '€400k', '€500k']);
  });

  it('starts the plot lower when there is a legend (115 px, like the segmented bar)', () => {
    const l = layout(fx.barSegmented, 830, 790);
    expect(l.plot.y).toBe(115);
    expect(l.legendTop).toBe(33);
  });

  it('uses the dashboard cell paddings (plot at x ≈ 108, 49 px on the right)', () => {
    const l = layout(fx.barGrouped, 385, 418, 'cell');
    expect(l.plot.x).toBeGreaterThan(100);
    expect(l.plot.x).toBeLessThan(115);
    expect(l.plot.x + l.plot.w).toBeCloseTo(385 - 49, 0);
    expect(l.titles).not.toBeNull();
  });

  it('rotates crowded labels −45° and gives the plot less height', () => {
    const flat = layout(fx.barGrouped, 830, 790);
    const crowded = layout(fx.barDate, 830, 790);
    expect(crowded.rotated).toBe(true);
    expect(crowded.plot.h).toBeLessThan(flat.plot.h - 30);
    // Rotated labels are cut at ≈ 70 px ("No Start d…").
    expect(crowded.xLabels.at(-1)?.text.endsWith('…')).toBe(true);
    expect(measure(crowded.xLabels.at(-1)?.text ?? '')).toBeLessThanOrEqual(ROTATED_LABEL_MAX);
  });

  it('rotates labels in a narrow cell (Discovery / Build / Review / Done in 228 px)', () => {
    expect(layout(fx.barGrouped, 385, 418, 'cell').rotated).toBe(true);
  });

  it('uses 3 ticks of 100k for a cell with a 300k target and 6 for the tall editor plot', () => {
    const cell = layout(fx.barTarget, 385, 418, 'cell');
    expect(cell.yTicks.length).toBeGreaterThanOrEqual(4);
    expect(cell.yTicks.length).toBeLessThanOrEqual(7);
  });

  it('keeps duration ticks on whole hours and leaves the baseline label empty', () => {
    const l = layout(fx.timeInStage, 830, 790);
    expect(l.yTicks.map((t) => t.label)).toEqual(['', '1hr', '2hr', '3hr', '4hr', '5hr', '6hr']);
    expect(l.domain[1]).toBeCloseTo(5.48 * 3_600_000 + (6.83 - 5.48) * 3_600_000, -3);
  });

  it('hides the titles with "Show axis labels" off', () => {
    const ctx = fx.chartContext('insights', 'bar', { settings: { axisLabelVisible: false } });
    const m = model({ ...fx.barGrouped, ctx });
    const l = computeCartesianLayout({
      model: m,
      width: 830,
      height: 790,
      size: 'canvas',
      hasLegend: false,
      measure,
      truncate,
      ctxFormat: ctx.metric.format,
    });
    expect(l.titles).toBeNull();
    expect(l.plot.x).toBeLessThan(100);
  });
});
