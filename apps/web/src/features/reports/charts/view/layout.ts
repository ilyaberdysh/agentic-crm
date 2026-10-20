// Geometry of bar / line charts, measured from the Attio screenshots (1512×945): plot origin, axis label gutters,
// title positions, rotated labels. Pure given a text measurer, so it is unit-testable.
import { scaleBand, scaleLinear } from '@visx/scale';
import type { CartesianModel } from '../model/cartesian';
import { axisTickFormatter } from '../model/format';
import { durationTicks, niceTicks, tickCountFor } from '../model/ticks';

export type ChartSize = 'cell' | 'canvas';

export interface YTick {
  value: number;
  /** px from the plot top. */
  y: number;
  label: string;
}

export interface XLabel {
  index: number;
  text: string;
  /** px from the plot left (the band centre). */
  x: number;
}

export interface CartesianLayout {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  domain: [number, number];
  yTicks: YTick[];
  /** Tick label gutter width. */
  yLabelWidth: number;
  xLabels: XLabel[];
  rotated: boolean;
  /** Max width of an unrotated label. */
  xLabelWidth: number;
  /** Centre of the y title (x) and the x title's top. */
  titles: { yX: number; xTop: number } | null;
  legendTop: number;
  /** Value → px from the plot top. */
  y: ReturnType<typeof scaleLinear<number>>;
  /** px of the band start / band width per category index. */
  bandX: (i: number) => number;
  bandWidth: number;
  step: number;
}

export interface LayoutInput {
  model: CartesianModel;
  width: number;
  height: number;
  size: ChartSize;
  hasLegend: boolean;
  measure: (text: string) => number;
  truncate: (text: string, maxWidth: number) => string;
  ctxFormat: Parameters<typeof axisTickFormatter>[0];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Max width of a rotated label ("No Start d…"): ≈ 70 px, the extra 50 px under the baseline in the evidence. */
export const ROTATED_LABEL_MAX = 70;

export function computeCartesianLayout(input: LayoutInput): CartesianLayout {
  const { model, width, height, size, hasLegend, measure, truncate } = input;
  const canvas = size === 'canvas';
  const titles = model.axisLabelVisible;
  const padLeft = titles ? (canvas ? clamp(width * 0.082, 12, 68) : clamp(width * 0.06, 8, 23)) : 16;
  const padRight = canvas ? clamp(width * 0.117, 16, 97) : clamp(width * 0.127, 16, 49);
  const compactHeight = height < 300;
  const top = hasLegend ? (compactHeight ? 70 : canvas ? 115 : 114) : compactHeight ? 20 : canvas ? 38 : 37;
  const titleBottom = canvas ? 33 : 17;
  const bottomPad = titles ? titleBottom : 12;
  const labelGap = 17;
  const titleBlock = titles ? 18 + 20 : 0;

  const n = model.categories.length;
  const labels = model.categories.map((c) => c.label);
  const tickCountFor0 = (plotH: number) => tickCountFor(plotH);
  const isDuration = input.ctxFormat.kind === 'duration';
  const isCount = input.ctxFormat.kind === 'count';

  const ticksFor = (plotH: number) => {
    const count = tickCountFor0(plotH);
    return isDuration
      ? durationTicks(model.range[0], model.range[1], count)
      : niceTicks(model.range[0], model.range[1], count, { integers: isCount });
  };

  // First pass: plot height without rotated labels, to get the ticks and the gutter.
  const h0 = Math.max(60, height - top - (labelGap + 16 + titleBlock + bottomPad));
  const t0 = ticksFor(h0);
  const fmt0 = axisTickFormatter(input.ctxFormat, t0.ticks);
  const yLabelWidth = Math.max(0, ...t0.ticks.map((t) => measure(fmt0(t))));
  const left = padLeft + (titles ? 20 + 20 : 0) + yLabelWidth + 8;
  const plotW = Math.max(40, width - left - padRight);
  const step = plotW / Math.max(1, n);
  const widths = labels.map((l) => measure(l));
  const maxW = Math.max(0, ...widths);
  const rotated = n > 1 ? maxW > step - 8 : maxW > plotW;
  const rotatedText = rotated ? labels.map((l) => truncate(l, ROTATED_LABEL_MAX)) : labels;
  const rotatedMax = rotated ? Math.min(ROTATED_LABEL_MAX, Math.max(0, ...rotatedText.map((l) => measure(l)))) : 0;
  const labelZone = rotated ? Math.ceil((rotatedMax + 16) * Math.SQRT1_2) : 16;

  // Second pass with the real plot height.
  const plotH = Math.max(60, height - top - (labelGap + labelZone + titleBlock + bottomPad));
  const t = ticksFor(plotH);
  const fmt = axisTickFormatter(input.ctxFormat, t.ticks);
  const y = scaleLinear<number>({ domain: t.domain, range: [plotH, 0] });
  const bands = scaleBand<number>({
    domain: Array.from({ length: n }, (_, i) => i),
    range: [0, plotW],
    paddingInner: 0.1,
    paddingOuter: 0.05,
  });
  const bandWidth = bands.bandwidth();
  return {
    width,
    height,
    plot: { x: left, y: top, w: plotW, h: plotH },
    domain: t.domain,
    yTicks: t.ticks.map((value) => ({ value, y: y(value), label: fmt(value) })),
    yLabelWidth,
    xLabels: rotatedText
      .map((text, index) => ({ index, text, x: (bands(index) ?? 0) + bandWidth / 2 }))
      // Rotated labels need ≈ 15 px each: a very dense axis shows every k-th label (the last one is always kept).
      .filter((l) => !rotated || step >= 15 || l.index % Math.ceil(15 / step) === 0 || l.index === n - 1),
    rotated,
    xLabelWidth: Math.max(8, step - 8),
    titles: titles ? { yX: padLeft + 10, xTop: height - bottomPad - 20 } : null,
    legendTop: compactHeight ? 14 : 33,
    y,
    bandX: (i) => bands(i) ?? 0,
    bandWidth,
    step,
  };
}
