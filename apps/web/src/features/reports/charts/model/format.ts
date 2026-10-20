// Number formatting of charts (chart-types §2 "Number formatting"): full values in tooltips and tables ("€470,000.00",
// "3hr 25m 7s", "44 %"), compact values on axes ("€500k", "€0k", "1hr"). Locale and grouping follow the app's single
// formatting locale (attributes/format).
import { formatCurrency, formatNumber } from '../../../attributes/format/formatValue';
import { getFormatSettings } from '../../../attributes/format/locale';
import type { ValueFormat } from '../types';

/** What a missing value (nothing contributes, e.g. the average of no values) looks like. */
export const NO_VALUE = '–';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const DURATION_UNITS = { second: SECOND, minute: MINUTE, hour: HOUR, day: DAY } as const;

/** "3hr 25m 7s", "2d 1hr", "45s", "0s": zero parts are left out; sub-second values read "<1s". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return NO_VALUE;
  const negative = ms < 0;
  let rest = Math.round(Math.abs(ms) / SECOND);
  if (rest === 0) return Math.abs(ms) > 0 ? '<1s' : '0s';
  const d = Math.floor(rest / 86_400);
  rest -= d * 86_400;
  const h = Math.floor(rest / 3600);
  rest -= h * 3600;
  const m = Math.floor(rest / 60);
  const s = rest - m * 60;
  const parts = [d && `${d}d`, h && `${h}hr`, m && `${m}m`, s && `${s}s`].filter(Boolean);
  return (negative ? '-' : '') + parts.join(' ');
}

/** A full-precision value in the metric's format (tooltips, calculated values). */
export function formatMetricValue(value: number | null, format: ValueFormat): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE;
  switch (format.kind) {
    case 'count':
      return formatNumber(value);
    case 'number':
      return formatNumber(value, { decimals: format.decimals, grouping: format.grouping ? 'default' : 'no-groups' });
    case 'currency':
      return formatCurrency(value, format.currency, {
        display: format.display,
        decimals: format.decimals === 0 ? 'no-decimals' : 'two-decimals',
      });
    case 'duration':
      return formatDuration(value);
  }
}

/** "44 %" (space before the sign); one decimal below 1 % so small shares do not read "0 %". */
export function formatPercentValue(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return NO_VALUE;
  const abs = Math.abs(percent);
  const rounded = abs > 0 && abs < 1 ? Math.round(percent * 10) / 10 : Math.round(percent);
  return `${formatNumber(rounded)} %`;
}

/** A change badge: "-82 %", "+12 %", "No change". */
export function formatChange(percent: number | null): string | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded === 0) return 'No change';
  return `${rounded > 0 ? '+' : '-'}${formatNumber(Math.abs(rounded))} %`;
}

/** Relative change of `current` against `previous` in percent (null when previous is 0 / missing). */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (previous === null || previous === 0) return current === null || current === 0 ? 0 : null;
  return (((current ?? 0) - previous) / Math.abs(previous)) * 100;
}

// ---- axes --------------------------------------------------------------------------------------------------------------

const MAGNITUDES = [
  { div: 1e9, suffix: 'B' },
  { div: 1e6, suffix: 'M' },
  { div: 1e3, suffix: 'k' },
] as const;

/** The unit all ticks of one axis share: thousands for ticks reaching 1,000 ("€0k", "€100k"), millions, billions. */
export function axisMagnitude(ticks: readonly number[]): { div: number; suffix: string } {
  const max = ticks.reduce((m, t) => Math.max(m, Math.abs(t)), 0);
  return MAGNITUDES.find((u) => max >= u.div) ?? { div: 1, suffix: '' };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const currencyCache = new Map<string, Intl.NumberFormat>();
function currencyFormat(locale: string, code: string, display: string): Intl.NumberFormat {
  const key = `${locale}|${code}|${display}`;
  let nf = currencyCache.get(key);
  if (!nf) {
    const options: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: code,
      currencyDisplay: display as Intl.NumberFormatOptions['currencyDisplay'],
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    };
    try {
      nf = new Intl.NumberFormat(locale, options);
    } catch {
      nf = new Intl.NumberFormat('en-US', { ...options, currency: 'USD', currencyDisplay: 'symbol' });
    }
    currencyCache.set(key, nf);
  }
  return nf;
}

/** Currency compact tick: the unit suffix is attached to the digits, the symbol keeps its place ("€500k"). */
function currencyTick(scaled: number, suffix: string, code: string, display: string): string {
  const parts = currencyFormat(getFormatSettings().locale, code, display).formatToParts(scaled);
  let last = -1;
  parts.forEach((p, i) => {
    if (p.type === 'integer' || p.type === 'fraction') last = i;
  });
  return parts.map((p, i) => p.value + (i === last ? suffix : '')).join('');
}

/** Duration axis unit for a tick step: whole days, hours, minutes or seconds. */
export function durationAxisUnit(step: number): { div: number; suffix: string } {
  if (step >= DAY && step % DAY === 0) return { div: DAY, suffix: 'd' };
  if (step >= HOUR && step % HOUR === 0) return { div: HOUR, suffix: 'hr' };
  if (step >= MINUTE && step % MINUTE === 0) return { div: MINUTE, suffix: 'm' };
  if (step >= SECOND) return { div: SECOND, suffix: 's' };
  return { div: 1, suffix: 'ms' };
}

/**
 * Formatter of the tick labels of a y axis ("€500k", "12", "6hr"). Durations leave the zero tick unlabelled (the
 * baseline), as Attio does.
 */
export function axisTickFormatter(format: ValueFormat, ticks: readonly number[]): (value: number) => string {
  if (format.kind === 'duration') {
    const step = ticks.length > 1 ? Math.abs((ticks[1] as number) - (ticks[0] as number)) : (ticks[0] ?? HOUR);
    const unit = durationAxisUnit(step || HOUR);
    return (v) => (v === 0 ? '' : `${formatNumber(round2(v / unit.div))}${unit.suffix}`);
  }
  const { div, suffix } = axisMagnitude(ticks);
  if (format.kind === 'currency') {
    return (v) => currencyTick(round2(v / div), suffix, format.currency, format.display);
  }
  return (v) => `${formatNumber(round2(v / div))}${suffix}`;
}
