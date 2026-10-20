// Parsing typed / pasted text into write forms (editors and single-cell paste). Pure; unit-tested.
import { MONTH_NAMES } from '../format/formatValue';
import { normalizeDate } from './normalize';

const SPACES = /[\s   ']/g;

/**
 * "1 200,5" / "1,200.5" / "1200.5" / "-3" / "12%" → number. The last of "," and "." is the decimal separator when
 * both occur; a lone "," is decimal unless it groups thousands ("1,200"), except in comma-decimal locales.
 */
export function parseNumber(text: string, locale = 'en-US'): number | null {
  let t = text.trim().replace(SPACES, '').replace(/%$/, '');
  if (!t) return null;
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    t = t.split(group).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    const commaDecimal = /^(ru|de|fr|es|it|pt|nl|pl|cs|sv|fi|nb|da|tr|uk|be|kk)/i.test(locale);
    const groups = t.split(',');
    const looksGrouped = groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g));
    t = !commaDecimal && looksGrouped ? groups.join('') : groups.length === 2 ? t.replace(',', '.') : groups.join('');
  } else if (lastDot !== -1 && t.indexOf('.') !== lastDot) {
    t = t.split('.').join(''); // "1.200.000"
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Currency text without symbols/codes: "250 000,00 €", "$1,200", "EUR 15000" → amount. */
export function parseCurrencyAmount(text: string, locale = 'en-US'): number | null {
  const stripped = text
    .trim()
    .replace(/[A-Z]{3}/gi, '')
    .replace(/[^\d.,\s  \-+()]/g, '');
  return parseNumber(stripped, locale);
}

export function parseBoolean(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'checked', 'x', '✓', '✔', 'on'].includes(t)) return true;
  if (['false', 'no', 'n', '0', 'unchecked', '', 'off'].includes(t)) return false;
  return null;
}

/** "3", "★★★☆☆", "3/5" → 0..5. */
export function parseRating(text: string): number | null {
  const t = text.trim();
  if (/^[★☆]+$/.test(t)) return [...t].filter((ch) => ch === '★').length;
  const m = /^(\d)(?:\s*\/\s*5)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 5 ? n : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoFromParts(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const iso = `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
  return normalizeDate(iso) === iso ? iso : null;
}

function monthIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(w));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Typed dates → 'YYYY-MM-DD': ISO, "mm/dd/yyyy" (the picker's field order), "dd.mm.yyyy", "Mar 1, 2026",
 * "1 Mar 2026", "today" / "tomorrow" / "yesterday" (relative to `today`).
 */
export function parseDateText(text: string, today: string): string | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  if (!t) return null;
  if (t === 'today') return today;
  if (t === 'tomorrow') return addDays(today, 1);
  if (t === 'yesterday') return addDays(today, -1);
  if (t === 'next week') return addDays(today, 7);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:t.*)?$/.exec(t);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(t);
  if (m) return isoFromParts(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(t);
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m && monthIndex(m[1] as string) !== -1)
    return isoFromParts(Number(m[3]), monthIndex(m[1] as string) + 1, Number(m[2]));
  m = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/.exec(t);
  if (m && monthIndex(m[2] as string) !== -1)
    return isoFromParts(Number(m[3]), monthIndex(m[2] as string) + 1, Number(m[1]));
  return null;
}

/** "12:30pm", "12:30 PM", "9am", "14:05" → minutes after midnight. */
export function parseTimeText(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];
  if (min > 59) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix.startsWith('p') && h !== 12) h += 12;
    if (suffix.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + min;
}

/**
 * Wall-clock date + minutes in a time zone → the UTC instant (ISO). Uses the zone's offset at that moment (two
 * passes settle DST transitions).
 */
export function zonedToInstant(isoDate: string, minutes: number, timeZone: string): string {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetAt(guess, timeZone);
  return new Date(guess).toISOString();
}

/** Offset (ms) of a time zone at an instant: local wall time − UTC. */
export function offsetAt(instant: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUtc - Math.floor(instant / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Timestamps: ISO, or a date text optionally followed by a time ("Mar 1, 2026 12:30pm", "10/09/2026 9:00"). */
export function parseTimestampText(text: string, today: string, timeZone: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const m = /^(.*?)(?:,?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?))?$/i.exec(t);
  const date = m ? parseDateText((m[1] ?? '').trim(), today) : null;
  if (!date) return null;
  const minutes = m?.[2] ? parseTimeText(m[2]) : 0;
  if (minutes === null) return null;
  return zonedToInstant(date, minutes, timeZone);
}

/** Full name → first (first word) + last (the rest), as Attio splits a typed name on save. */
export function splitName(full: string): { firstName: string; lastName: string; fullName: string } {
  const clean = full.trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: '', lastName: '', fullName: '' };
  const space = clean.indexOf(' ');
  if (space === -1) return { firstName: clean, lastName: '', fullName: clean };
  return { firstName: clean.slice(0, space), lastName: clean.slice(space + 1), fullName: clean };
}

/** Splits pasted / typed lists: commas, semicolons, new lines (and spaces for identifiers without spaces). */
export function splitList(text: string, alsoSpaces = false): string[] {
  return text
    .split(alsoSpaces ? /[,;\n\r\t ]+/ : /[,;\n\r\t]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
