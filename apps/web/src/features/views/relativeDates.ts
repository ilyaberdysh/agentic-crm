// Relative-date filter values (C1 filters-sorts-calcs §4; CROSS-DOMAIN X-05) on top of the shared presets in
// packages/contracts (filter-sentences.ts): ISO-8601 durations with `valueType: 'dynamic'`, resolved by the server in
// the viewer's time zone (snapshots.query `timeZone`; dates → the local day, timestamps → floored to the local hour).
// Exact dates are static `YYYY-MM-DD` values (on timestamps they compare by local day).
import {
  daysAgo,
  daysFromNow,
  parseRelativeDate,
  type RelativeDatePresetId,
  relativeDatePresets,
} from '@agentic-crm/contracts';

/** A date filter value: relative to now, or one calendar day. */
export type DateValue = { kind: 'relative'; duration: string } | { kind: 'exact'; date: string };

export interface RelativePreset {
  id: RelativeDatePresetId;
  label: string;
  /** Label for timestamps ("Now" instead of "Today", C1 §4). */
  timestampLabel: string;
  duration: string;
}

export const RELATIVE_PRESETS: readonly RelativePreset[] = relativeDatePresets.map((p) => ({
  id: p.id,
  label: p.label,
  timestampLabel: p.timestampLabel,
  duration: p.value,
}));

export function presetDuration(id: RelativeDatePresetId): string {
  const preset = RELATIVE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown preset ${id}`);
  return preset.duration;
}

/** "Number of days ago..." / "...from now" values. */
export function daysDuration(days: number, direction: 'ago' | 'from-now'): string {
  return direction === 'ago' ? daysAgo(days) : daysFromNow(days);
}

/** The preset a stored duration encodes (also Attio's long form '-P0Y0M7DT0H0M0S'), if any. */
export function presetOf(duration: string): RelativePreset | undefined {
  const parsed = parseRelativeDate(duration);
  return parsed && 'preset' in parsed ? RELATIVE_PRESETS.find((p) => p.id === parsed.preset) : undefined;
}

/** Days of a "Number of days …" value, else null. */
export function customDaysOf(duration: string): { days: number; direction: 'ago' | 'from-now' } | null {
  const parsed = parseRelativeDate(duration);
  if (!parsed || 'preset' in parsed) return null;
  return 'daysAgo' in parsed
    ? { days: parsed.daysAgo, direction: 'ago' }
    : { days: parsed.daysFromNow, direction: 'from-now' };
}

const monthDay = (locale?: string) =>
  new Intl.DateTimeFormat(locale ?? 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Display label of a date value: preset label, "{n} days ago", or "Mar 1, 2026". */
export function dateValueLabel(value: DateValue, options: { timestamp?: boolean; locale?: string } = {}): string {
  if (value.kind === 'exact') {
    const d = new Date(`${value.date}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? value.date : monthDay(options.locale).format(d);
  }
  const preset = presetOf(value.duration);
  if (preset) return options.timestamp ? preset.timestampLabel : preset.label;
  const custom = customDaysOf(value.duration);
  if (custom) {
    const unit = custom.days === 1 ? 'day' : 'days';
    return custom.direction === 'ago' ? `${custom.days} ${unit} ago` : `${custom.days} ${unit} from now`;
  }
  return value.duration;
}

/** Local calendar day (YYYY-MM-DD) of a Date. */
export function toLocalDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The viewer's IANA time zone (relative dates resolve in it). */
export function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hour bucket for re-resolving relative filters (C1 §4: "Relative filters re-evaluate hourly"). Part of the snapshot
 * query key when the filter has dynamic values, so the table re-queries at the top of every hour.
 */
export function hourEpoch(now: number = Date.now()): number {
  return Math.floor(now / 3_600_000);
}
