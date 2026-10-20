// Nice axis ticks (chart-types §2: 4–7 ticks depending on the height, counts as integers, durations in whole units).
import { DURATION_UNITS } from './format';

export interface Ticks {
  domain: [number, number];
  ticks: number[];
  step: number;
}

/** The d3 "nice" step (1, 2, 5 × 10^k) closest to `range / count`. */
export function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
  return factor * 10 ** power;
}

/**
 * The tick count asked of the 1-2-5 step: one per ≈ 70 px, between 3 and 6. Measured against the evidence: the editor
 * plot (650 px) and the historical plot (520 px) ask for 6 (470k → 100k steps, 730k → 100k), dashboard cells (216–245 px)
 * for 3 (730k → 200k, 300k → 100k). The ticks drawn are 4–7 depending on the data.
 */
export function tickCountFor(plotHeight: number): number {
  return Math.max(3, Math.min(6, Math.floor(plotHeight / 70)));
}

function range(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) out.push(Math.round((lo + i * step) * 1e10) / 1e10);
  return out;
}

export interface NiceOptions {
  /** Count axes: integer steps only. */
  integers?: boolean;
  /** Extend the domain to a multiple of the step (default true; durations keep the data maximum). */
  nice?: boolean;
}

/** Ticks of a linear value axis over [min, max] (the baseline 0 is always included). */
export function niceTicks(min: number, max: number, count: number, options: NiceOptions = {}): Ticks {
  const lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (hi === lo) hi = lo + 1;
  let step = niceStep(hi - lo, count);
  if (options.integers) step = Math.max(1, Math.round(step));
  const niceLo = Math.floor(lo / step + 1e-9) * step;
  const niceHi = Math.ceil(hi / step - 1e-9) * step;
  const domain: [number, number] = options.nice === false ? [lo, hi] : [niceLo, niceHi];
  return { domain, ticks: range(niceLo, niceHi, step).filter((t) => t <= domain[1] + 1e-9), step };
}

const { second, minute, hour, day } = DURATION_UNITS;
const DURATION_STEPS = [
  1,
  5,
  10,
  50,
  100,
  500,
  second,
  2 * second,
  5 * second,
  10 * second,
  15 * second,
  30 * second,
  minute,
  2 * minute,
  5 * minute,
  10 * minute,
  15 * minute,
  30 * minute,
  hour,
  2 * hour,
  3 * hour,
  6 * hour,
  12 * hour,
  day,
  2 * day,
  7 * day,
  14 * day,
  30 * day,
  90 * day,
  365 * day,
];

/** Ticks of a duration axis (ms): whole seconds / minutes / hours / days; the domain ends at the data maximum. */
export function durationTicks(min: number, max: number, count: number): Ticks {
  const lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (hi === lo) hi = lo + hour;
  const raw = (hi - lo) / Math.max(1, count);
  // The step closest to the raw one (on a log scale): 1.14 h → 1 hr, 1.5 h → 2 hr.
  const step = DURATION_STEPS.reduce((best, s) =>
    Math.abs(Math.log(s / raw)) < Math.abs(Math.log(best / raw)) ? s : best,
  );
  const first = Math.floor(lo / step) * step;
  const ticks = range(first, Math.ceil(hi / step) * step, step).filter((t) => t >= lo - 1e-6 && t <= hi + 1e-6);
  return { domain: [lo, hi], ticks, step };
}
