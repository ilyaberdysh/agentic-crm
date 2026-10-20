// The one locale rule for value formatting (BACKLOG 2.x acceptance 8, CROSS-DOMAIN X-11, B.25).
//
//   Every number, currency amount and percentage the app draws — table cells, record fields, chips, editors and the
//   table's footer calculations — is formatted by `Intl` with ONE locale: the user's locale. Until users have a
//   locale preference that is the browser's `navigator.language`. Attio mixes en-US and the browser locale in one
//   footer row (filters-sorts-calcs §8); we deliberately do not.
//
//   Dates and times use Attio's fixed English patterns ("Mar 1, 2026", "Mar 1st 2026, 12:30pm", "4 days ago") because
//   the UI language is English, rendered in the user's time zone. Calendars start on the user's week-start day (X-10),
//   derived from the locale until a user preference exists.
//
// Tests and the e2e parity run pin the settings with `setFormatSettings` (the curated Attio screenshots were taken in
// a ru-RU / Europe/Moscow browser).
import { useSyncExternalStore } from 'react';

export interface FormatSettings {
  /** BCP 47 locale for numbers and currency, e.g. 'ru-RU'. */
  locale: string;
  /** IANA time zone for timestamps, e.g. 'Europe/Moscow'. */
  timeZone: string;
  /** First day of the week: 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
}

let override: Partial<FormatSettings> = {};
let cached: FormatSettings | null = null;
const listeners = new Set<() => void>();

function browserLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en-US';
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Week start of a locale (Intl.Locale week info where supported; Sunday for the Americas and a few others). */
export function weekStartForLocale(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info && typeof info.firstDay === 'number') return info.firstDay % 7; // 1 = Monday … 7 = Sunday
    const region = loc.maximize().region ?? '';
    return ['US', 'CA', 'MX', 'BR', 'JP', 'IL', 'PH', 'IN', 'KR', 'TW', 'HK', 'AU'].includes(region) ? 0 : 1;
  } catch {
    return 1;
  }
}

export function getFormatSettings(): FormatSettings {
  if (cached) return cached;
  const locale = override.locale ?? browserLocale();
  cached = {
    locale,
    timeZone: override.timeZone ?? browserTimeZone(),
    weekStartsOn: override.weekStartsOn ?? weekStartForLocale(locale),
  };
  return cached;
}

/** Pins (part of) the settings; `null` returns to the browser defaults. Re-renders subscribed components. */
export function setFormatSettings(patch: Partial<FormatSettings> | null): void {
  override = patch ? { ...override, ...patch } : {};
  cached = null;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Settings as React state (components re-render when they are pinned or changed). */
export function useFormatSettings(): FormatSettings {
  return useSyncExternalStore(subscribe, getFormatSettings, getFormatSettings);
}
