// Raw CSV cell → attribute values, per type. Pure functions:
// no database access; option, member and currency lookups come in through `ParseContext`.
//
//   text            as is (trimmed); Record ID / Entry ID must be a UUID
//   number          decimal separator point|comma; group separators (spaces, NBSP, ', and the other separator) are
//                   dropped; ±; at most 4 decimals (further digits are removed)
//   currency        a number; the attribute's currency code or symbol may surround it, other currencies are invalid
//   checkbox        1 true #t → checked; 0 false #f → unchecked (case-insensitive); blank → no value
//   date            iso: YYYY-MM-DD (a timestamp keeps its date); uk: 14/07/2024 14-07-2024 14 07 2024 14.07.2024,
//                   14 Jul 2024, 14th July, 2024; us: 07/14/2024 …, Jul 14 2024, July 14th, 2024 (month names are
//                   accepted in either order in both); foundation dates keep only the year
//   timestamp       iso: any prefix of 2024-11-01T01:02:03.456789Z (no offset = UTC); uk/us: "01:02:03 1 Nov 2024",
//                   "01:02 Nov 01 2024", or a date followed by a time ("Mar 1st 2026, 12:30pm"), in the job's zone
//   rating          integer 0–5; 0 = no value
//   select/status   option title (case-insensitive) or id; multi-select splits on ","; unknown titles are "missing"
//   actor-reference member id, email, full name, or first name — exactly one member must match
//   location        one-line address "1 Infinite Loop, Cupertino, CA, 95014, United States" → components
//   domain / email / phone   normalised like writes; multi-value attributes split on ","
//   personal-name   full name ("Nicolas Sharp"), or a first / last name part
import { currencyCodes } from '@agentic-crm/contracts';
import { normalizeDomain, normalizeEmail, normalizePhone } from '../values/normalize.ts';

export type DateFormat = 'iso' | 'us' | 'uk';
export type DecimalSeparator = 'point' | 'comma';
export type NameField = 'full-name' | 'first-name' | 'last-name';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------------------------
// Numbers

const GROUP_CHARS = /[\s   '’_]/g;

/** "1 200,50" (comma) → 1200.5; "12500,50" (point) → 1250050. Null when not a finite number. */
export function parseNumber(raw: string, separator: DecimalSeparator = 'point'): number | null {
  let s = raw.trim().replace(GROUP_CHARS, '');
  if (s === '') return null;
  if (separator === 'point') s = s.replace(/,/g, '');
  else s = s.replace(/\./g, '').replace(',', '.');
  if (s.includes(',')) return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const sign = m[1] === '-' ? '-' : '';
  const intPart = m[2] === '' ? '0' : (m[2] as string);
  let n: number;
  if (m[4] !== undefined) {
    n = Number(`${sign}${intPart}.${m[3] ?? '0'}e${m[4]}`);
    if (!Number.isFinite(n)) return null;
    return truncateDecimals(n);
  }
  const frac = (m[3] ?? '').slice(0, 4); // "additional decimal digits are removed"
  n = Number(`${sign}${intPart}${frac ? `.${frac}` : ''}`);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : n;
}

function truncateDecimals(n: number): number {
  const t = Math.trunc(n * 10_000) / 10_000;
  return Number.isFinite(t) ? t : n;
}

const COMMA_DECIMAL_GROUPED = /^[+-]?\d{1,3}(?:[.\s  ]\d{3})+,\d+$/;
const POINT_DECIMAL_GROUPED = /^[+-]?\d{1,3}(?:[,\s  ]\d{3})+\.\d+$/;

/**
 * The column's decimal separator. Point is the default and wins every ambiguous sample: with Point a comma is a
 * thousands separator, so "12500,50" reads as 1,250,050 (import.md I4, live run — the Budget column stayed on Point).
 * Comma is chosen only on unambiguous evidence: a decimal comma after dot / space thousands groups ("1.234,56",
 * "250 000,00 €", the ru-RU form our exports write), or values only the comma reading accepts ("1.234.567").
 */
export function detectDecimalSeparator(samples: string[]): DecimalSeparator {
  let point = 0;
  let comma = 0;
  for (const sample of samples) {
    // Currency symbols / codes around amounts do not decide the separator.
    const s = sample.replace(/[^\d.,\s  +-]/g, '').trim();
    if (COMMA_DECIMAL_GROUPED.test(s)) comma++;
    else if (POINT_DECIMAL_GROUPED.test(s)) point++;
    else {
      const p = parseNumber(s, 'point');
      const c = parseNumber(s, 'comma');
      if (p === null && c !== null) comma++;
      else if (c === null && p !== null) point++;
    }
  }
  return comma > point ? 'comma' : 'point';
}

// ---------------------------------------------------------------------------------------------------------------
// Currency

const symbolCache = new Map<string, string[]>();
/** Symbols a currency may be written with ("€", "$", "US$", "руб." …), from Intl. */
export function currencySymbols(code: string): string[] {
  const cached = symbolCache.get(code);
  if (cached) return cached;
  const out = new Set<string>([code]);
  for (const locale of ['en-US', 'en-GB', 'de-DE', 'ru-RU', 'fr-FR', 'ja-JP']) {
    for (const display of ['symbol', 'narrowSymbol'] as const) {
      try {
        const parts = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: code,
          currencyDisplay: display,
        }).formatToParts(1);
        const sym = parts.find((p) => p.type === 'currency')?.value;
        if (sym) out.add(sym);
      } catch {
        // unknown to this runtime
      }
    }
  }
  const list = [...out].sort((a, b) => b.length - a.length);
  symbolCache.set(code, list);
  return list;
}

/** "€ 1 200,50", "1200.5 EUR", "40.99" → 1200.5 / 40.99 when the marker is the attribute's currency. */
export function parseCurrency(
  raw: string,
  currencyCode: string,
  separator: DecimalSeparator = 'point',
): { value: number } | { error: 'Invalid number' | 'Invalid currency' } {
  let s = raw.trim();
  const lower = s.toLowerCase();
  for (const sym of currencySymbols(currencyCode)) {
    const l = sym.toLowerCase();
    if (lower.startsWith(l)) {
      s = s.slice(sym.length);
      break;
    }
    if (lower.endsWith(l)) {
      s = s.slice(0, s.length - sym.length);
      break;
    }
  }
  s = s.trim();
  if (/[a-z$€£¥₽₹₩₪₫₴₸]/i.test(s)) {
    const other = currencyCodes.some((c) => s.toUpperCase().includes(c)) || /[$€£¥₽₹₩₪₫₴₸]/.test(s);
    return { error: other ? 'Invalid currency' : 'Invalid number' };
  }
  const n = parseNumber(s, separator);
  return n === null ? { error: 'Invalid number' } : { value: n };
}

// ---------------------------------------------------------------------------------------------------------------
// Checkbox, rating

export function parseCheckbox(raw: string): boolean | null | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  if (s === '1' || s === 'true' || s === '#t') return true;
  if (s === '0' || s === 'false' || s === '#f') return false;
  return 'invalid';
}

/** 1–5 → stars; 0 → no value (null); anything else → 'invalid'. */
export function parseRating(raw: string): number | null | 'invalid' {
  const n = parseNumber(raw, 'point');
  if (n === null || !Number.isInteger(n) || n < 0 || n > 5) return 'invalid';
  return n === 0 ? null : n;
}

// ---------------------------------------------------------------------------------------------------------------
// Dates and timestamps

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7,
  july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12,
  december: 12,
}; // biome-ignore format: compact table

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function ymd(y: number, m: number, d: number): string | null {
  if (!(y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const NUMERIC_DATE = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/;
const DAY_MONTH_YEAR = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{4})$/i;
const MONTH_DAY_YEAR = /^([a-z]+)\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{4})$/i;

/** A calendar date 'YYYY-MM-DD' or null. ISO dates are accepted in every format (they are unambiguous). */
export function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s === '') return null;
  const iso = ISO_DATE.exec(s);
  if (iso) {
    if (s.length > 10 && /[T ]\d/.test(s.slice(10, 12))) {
      // A full timestamp: its UTC date.
      const t = parseIsoTimestamp(s);
      return t ? t.slice(0, 10) : null;
    }
    return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  if (format === 'iso') return null;
  const num = NUMERIC_DATE.exec(s);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const y = Number(num[3]);
    return format === 'uk' ? ymd(y, b, a) : ymd(y, a, b);
  }
  const dmy = DAY_MONTH_YEAR.exec(s);
  if (dmy) {
    const month = MONTHS[(dmy[2] as string).toLowerCase()];
    return month ? ymd(Number(dmy[3]), month, Number(dmy[1])) : null;
  }
  const mdy = MONTH_DAY_YEAR.exec(s);
  if (mdy) {
    const month = MONTHS[(mdy[1] as string).toLowerCase()];
    return month ? ymd(Number(mdy[3]), month, Number(mdy[2])) : null;
  }
  return null;
}

/** Foundation dates keep only the year: "1984" or a full date → '1984-01-01'. */
export function parseYearDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim();
  if (/^\d{4}$/.test(s)) return ymd(Number(s), 1, 1);
  const d = parseDate(s, format);
  return d ? `${d.slice(0, 4)}-01-01` : null;
}

/** Format whose parser accepts the most samples (ties: iso, then uk — the workspace is European, then us). */
export function detectDateFormat(samples: string[], parser: (raw: string, f: DateFormat) => string | null): DateFormat {
  const score: Record<DateFormat, number> = { iso: 0, uk: 0, us: 0 };
  for (const s of samples) for (const f of ['iso', 'uk', 'us'] as const) if (parser(s, f) !== null) score[f]++;
  if (score.iso >= score.uk && score.iso >= score.us && score.iso > 0) return 'iso';
  if (score.uk === 0 && score.us === 0) return 'iso';
  return score.us > score.uk ? 'us' : 'uk';
}

const ISO_PREFIX =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** Any prefix of '2024-11-01T01:02:03.456789234Z' (missing parts are zero, no offset = UTC) → ISO instant. */
export function parseIsoTimestamp(raw: string): string | null {
  const m = ISO_PREFIX.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  if (!ymd(y, mo, d)) return null;
  const h = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  const sec = m[6] ? Number(m[6]) : 0;
  if (h > 23 || mi > 59 || sec > 59) return null;
  const micros = (m[7] ?? '').slice(0, 6).padEnd(6, '0');
  let offsetMinutes = 0;
  const off = m[8];
  if (off && off.toUpperCase() !== 'Z') {
    const sign = off.startsWith('-') ? -1 : 1;
    const digits = off.slice(1).replace(':', '');
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0'));
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - offsetMinutes * 60_000;
  return `${new Date(ms).toISOString().slice(0, 19)}.${micros}Z`;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneParts(instant: number, timeZone: string) {
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, f);
  }
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return Date.UTC(
    parts.year as number,
    (parts.month as number) - 1,
    parts.day as number,
    (parts.hour as number) % 24,
    parts.minute as number,
    parts.second as number,
  );
}

/** Wall-clock time in a zone → UTC epoch ms (times skipped by DST resolve forward). */
export function wallTimeToInstant(date: string, h: number, mi: number, s: number, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let zone = timeZone;
  try {
    zoneParts(0, zone);
  } catch {
    zone = 'UTC';
  }
  const offset = (t: number) => zoneParts(t, zone) - Math.floor(t / 1000) * 1000;
  let instant = guess - offset(guess);
  const second = offset(instant);
  if (guess - second !== instant) instant = guess - second;
  return instant;
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;
const TIME_FIRST = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?,?\s+(.+)$/i;
const TIME_LAST = /^(.+?),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

function hours(h: number, ampm: string | undefined): number | null {
  if (!ampm) return h <= 23 ? h : null;
  if (h < 1 || h > 12) return null;
  const pm = ampm.toLowerCase() === 'pm';
  return (h % 12) + (pm ? 12 : 0);
}

/** A timestamp in the given format → ISO instant (microseconds) or null. */
export function parseTimestamp(raw: string, format: DateFormat, timeZone = 'UTC'): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s === '') return null;
  const iso = parseIsoTimestamp(s);
  if (iso) return iso;
  if (format === 'iso') return null;
  let datePart: string;
  let h = 0;
  let mi = 0;
  let sec = 0;
  const first = TIME_FIRST.exec(s);
  const last = first ? null : TIME_LAST.exec(s);
  if (first) {
    const hh = hours(Number(first[1]), first[4]);
    if (hh === null) return null;
    h = hh;
    mi = Number(first[2]);
    sec = Number(first[3] ?? 0);
    datePart = first[5] as string;
  } else if (last && !TIME.test(s)) {
    const hh = hours(Number(last[2]), last[5]);
    if (hh === null) return null;
    h = hh;
    mi = Number(last[3]);
    sec = Number(last[4] ?? 0);
    datePart = last[1] as string;
  } else {
    datePart = s;
  }
  if (mi > 59 || sec > 59) return null;
  const date = parseDate(datePart, format);
  if (!date) return null;
  const ms = wallTimeToInstant(date, h, mi, sec, timeZone);
  return `${new Date(ms).toISOString().slice(0, 19)}.000000Z`;
}

// ---------------------------------------------------------------------------------------------------------------
// Multi-value splitting, names, locations

/** "a, b,,c" → ['a', 'b', 'c'] (multiple values are comma-separated). */
export function splitValues(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/** "Nicolas Sharp" → first "Nicolas", last "Sharp"; one word → first name only. */
export function splitFullName(raw: string): { firstName: string; lastName: string; fullName: string } {
  const fullName = raw.trim().replace(/\s+/g, ' ');
  const space = fullName.indexOf(' ');
  if (space < 0) return { firstName: fullName, lastName: '', fullName };
  return { firstName: fullName.slice(0, space), lastName: fullName.slice(space + 1), fullName };
}

export function isUuid(raw: string): boolean {
  return UUID_RE.test(raw.trim());
}

/** Region codes Intl still names but that are not current ISO 3166-1 codes (UK → GB, DD → DE, …). */
const DEPRECATED_REGIONS = new Set([
  'AN',
  'BU',
  'CS',
  'DD',
  'DY',
  'FX',
  'HV',
  'NH',
  'NT',
  'QO',
  'RH',
  'SU',
  'TP',
  'UK',
  'VD',
  'YD',
  'YU',
  'ZR',
  'EU',
  'EZ',
  'UN',
  'ZZ',
]);

let countryIndex: Map<string, string> | null = null;
/** Lower-case English country names (and ISO alpha-2 / common aliases) → ISO 3166-1 alpha-2. */
function countries(): Map<string, string> {
  if (countryIndex) return countryIndex;
  const index = new Map<string, string>();
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    names = null;
  }
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (DEPRECATED_REGIONS.has(code)) continue;
      const name = names?.of(code);
      if (name && name !== code && !/^Unknown/i.test(name)) {
        // Deprecated aliases (UK → "United Kingdom") must not shadow the canonical code (GB).
        if (!index.has(name.toLowerCase())) index.set(name.toLowerCase(), code);
        if (!index.has(code.toLowerCase())) index.set(code.toLowerCase(), code);
      }
    }
  }
  // biome-ignore format: compact table
  const aliases: [string, string][] = [
    ['usa', 'US'], ['u.s.', 'US'], ['u.s.a.', 'US'], ['united states of america', 'US'], ['america', 'US'],
    ['uk', 'GB'], ['u.k.', 'GB'], ['england', 'GB'], ['scotland', 'GB'], ['wales', 'GB'], ['great britain', 'GB'],
    ['russia', 'RU'], ['russian federation', 'RU'], ['россия', 'RU'], ['south korea', 'KR'], ['korea', 'KR'],
    ['czech republic', 'CZ'], ['uae', 'AE'], ['holland', 'NL'], ['the netherlands', 'NL'], ['türkiye', 'TR'],
    ['turkey', 'TR'], ['vietnam', 'VN'], ['ivory coast', 'CI'], ['hong kong', 'HK'],
  ];
  for (const [alias, code] of aliases) index.set(alias, code);
  countryIndex = index;
  return index;
}

export function countryCodeOf(raw: string): string | null {
  return countries().get(raw.trim().toLowerCase().replace(/\s+/g, ' ')) ?? null;
}

export interface ParsedLocation {
  line1: string | null;
  line2: string | null;
  line3: string | null;
  line4: string | null;
  locality: string | null;
  region: string | null;
  postcode: string | null;
  countryCode: string | null;
  latitude: string | null;
  longitude: string | null;
}

const POSTCODE = /^(?=.*\d)[A-Z0-9][A-Z0-9 -]{1,9}$/i;

/**
 * One-line address → components (street, city, region/state, postcode and country may all sit in one
 * column): the country is recognised from the last part, a postcode (with digits) before it, then the remaining
 * parts read from the end as region, locality and street lines. "London, United Kingdom" → locality London;
 * "Germany" → country only.
 */
export function parseLocation(raw: string): ParsedLocation | null {
  const parts = raw
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return null;
  const loc: ParsedLocation = {
    line1: null,
    line2: null,
    line3: null,
    line4: null,
    locality: null,
    region: null,
    postcode: null,
    countryCode: null,
    latitude: null,
    longitude: null,
  };
  const country = countryCodeOf(parts[parts.length - 1] as string);
  if (country && (parts.length > 1 || (parts[0] as string).length > 2 || /^[A-Z]{2}$/.test(parts[0] as string))) {
    loc.countryCode = country;
    parts.pop();
  }
  const last = parts[parts.length - 1];
  if (last !== undefined && parts.length > 1) {
    const regionPostcode = /^([A-Za-z][A-Za-z .]{0,30}?)\s+(\d[\dA-Z -]{2,9})$/.exec(last);
    if (POSTCODE.test(last) && /\d/.test(last) && !/^\d+\s+\S+\s+\S+/.test(last)) {
      loc.postcode = last;
      parts.pop();
    } else if (regionPostcode) {
      loc.region = (regionPostcode[1] as string).trim();
      loc.postcode = (regionPostcode[2] as string).trim();
      parts.pop();
    }
  }
  if (loc.region === null && parts.length >= 2) loc.region = parts.pop() as string;
  if (parts.length >= 1) loc.locality = parts.pop() as string;
  const lines = parts.slice(0, 4);
  if (parts.length > 4) lines[3] = parts.slice(3).join(', ');
  loc.line1 = lines[0] ?? null;
  loc.line2 = lines[1] ?? null;
  loc.line3 = lines[2] ?? null;
  loc.line4 = lines[3] ?? null;
  if (Object.values(loc).every((v) => v === null)) return null;
  return loc;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-attribute resolution

export interface OptionRef {
  id: string;
  title: string;
}

export interface MemberRef {
  id: string;
  emailAddress: string;
  firstName: string;
  lastName: string;
}

export interface ParseContext {
  type:
    | 'text'
    | 'number'
    | 'checkbox'
    | 'currency'
    | 'date'
    | 'timestamp'
    | 'rating'
    | 'pipeline'
    | 'select'
    | 'entity-reference'
    | 'actor-reference'
    | 'location'
    | 'domain'
    | 'email-address'
    | 'phone-number'
    | 'interaction'
    | 'personal-name';
  /** Split the cell into several values on ",". */
  multi: boolean;
  /** Record ID / Entry ID: the cell must be a UUID (written as text, used as the match key). */
  isId: boolean;
  /** System 'foundation-date': year only. */
  yearOnly: boolean;
  field: NameField | null;
  dateFormat: DateFormat;
  timestampFormat: DateFormat;
  decimalSeparator: DecimalSeparator;
  timeZone: string;
  currencyCode: string;
  /** Live options / stages (title lookups are case-insensitive). */
  options: OptionRef[];
  members: MemberRef[];
}

export interface Resolution {
  /** Values in the attribute's write form (a name part: the string; Record ID: the UUID string). */
  values: unknown[];
  errors: string[];
  /** Unknown select / status titles. */
  missing: string[];
  empty: boolean;
}

const ok = (values: unknown[]): Resolution => ({ values, errors: [], missing: [], empty: false });
const fail = (error: string): Resolution => ({ values: [], errors: [error], missing: [], empty: false });
const EMPTY: Resolution = { values: [], errors: [], missing: [], empty: true };

function optionIndex(ctx: ParseContext): { byTitle: Map<string, string>; ids: Set<string> } {
  const byTitle = new Map<string, string>();
  const ids = new Set<string>();
  for (const o of ctx.options) {
    ids.add(o.id.toLowerCase());
    const key = o.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, o.id);
  }
  return { byTitle, ids };
}

const optionIndexCache = new WeakMap<ParseContext, ReturnType<typeof optionIndex>>();

function matchMember(members: MemberRef[], raw: string): string | null | 'ambiguous' {
  const s = raw.trim().toLowerCase();
  const tiers: ((m: MemberRef) => boolean)[] = [
    (m) => m.id.toLowerCase() === s,
    (m) => m.emailAddress.toLowerCase() === s,
    (m) => `${m.firstName} ${m.lastName}`.trim().toLowerCase().replace(/\s+/g, ' ') === s.replace(/\s+/g, ' '),
    (m) => m.firstName.trim().toLowerCase() === s,
  ];
  for (const test of tiers) {
    const hits = members.filter(test);
    if (hits.length === 1) return (hits[0] as MemberRef).id;
    if (hits.length > 1) return 'ambiguous';
  }
  return null;
}

/** Resolves one raw cell for a property. Never throws. */
export function resolveCell(ctx: ParseContext, raw: string): Resolution {
  const trimmed = raw.trim();
  if (trimmed === '') return EMPTY;
  if (ctx.type === 'personal-name') {
    if (ctx.field === 'first-name' || ctx.field === 'last-name') return ok([trimmed]);
    return ok([splitFullName(trimmed).fullName]);
  }
  if (ctx.isId) {
    const parts = ctx.multi ? splitValues(trimmed) : [trimmed];
    const bad = parts.find((p) => !isUuid(p));
    return bad === undefined ? ok(parts.map((p) => p.toLowerCase())) : fail('Invalid ID');
  }
  const pieces = ctx.multi ? splitValues(trimmed) : [trimmed];
  const values: unknown[] = [];
  const errors = new Set<string>();
  const missing: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const key = JSON.stringify(v);
    if (seen.has(key)) return;
    seen.add(key);
    values.push(v);
  };
  for (const piece of pieces) {
    switch (ctx.type) {
      case 'text':
        push(trimmed);
        break;
      case 'number': {
        const n = parseNumber(piece, ctx.decimalSeparator);
        if (n === null) errors.add('Invalid number');
        else push(n);
        break;
      }
      case 'currency': {
        const c = parseCurrency(piece, ctx.currencyCode, ctx.decimalSeparator);
        if ('error' in c) errors.add(c.error);
        else push({ currencyValue: c.value, currencyCode: ctx.currencyCode });
        break;
      }
      case 'checkbox': {
        const b = parseCheckbox(piece);
        if (b === 'invalid') errors.add('Invalid checkbox');
        else if (b !== null) push(b);
        break;
      }
      case 'rating': {
        const r = parseRating(piece);
        if (r === 'invalid') errors.add('Invalid rating');
        else if (r !== null) push(r);
        break;
      }
      case 'date': {
        const d = ctx.yearOnly ? parseYearDate(piece, ctx.dateFormat) : parseDate(piece, ctx.dateFormat);
        if (d === null) errors.add('Invalid date');
        else push(d);
        break;
      }
      case 'timestamp': {
        const t = parseTimestamp(piece, ctx.timestampFormat, ctx.timeZone);
        if (t === null) errors.add('Invalid timestamp');
        else push(t);
        break;
      }
      case 'select':
      case 'pipeline': {
        let index = optionIndexCache.get(ctx);
        if (!index) {
          index = optionIndex(ctx);
          optionIndexCache.set(ctx, index);
        }
        const key = piece.toLowerCase();
        const id = index.byTitle.get(key) ?? (index.ids.has(key) ? key : undefined);
        if (id) push(ctx.type === 'select' ? { selectOptionId: id } : { pipelineStageId: id });
        else if (!missing.some((m) => m.toLowerCase() === key)) missing.push(piece);
        break;
      }
      case 'actor-reference': {
        const id = matchMember(ctx.members, piece);
        if (id === null || id === 'ambiguous') errors.add('Invalid actor');
        else push({ referencedActorType: 'workspace-member', referencedActorId: id });
        break;
      }
      case 'location': {
        const loc = parseLocation(trimmed);
        if (loc) push(loc);
        break;
      }
      case 'domain': {
        const d = normalizeDomain(piece);
        if (!d) errors.add('Invalid domain');
        else push(d.normalizedDomain);
        break;
      }
      case 'email-address': {
        const e = normalizeEmail(piece);
        if (!e) errors.add('Invalid email address');
        else push(e.originalEmailAddress);
        break;
      }
      case 'phone-number': {
        const p = normalizePhone(piece, null);
        if (!p.ok) errors.add('Invalid phone number');
        else push(p.originalPhoneNumber);
        break;
      }
      default:
        errors.add('Unsupported attribute type');
    }
    if (ctx.type === 'text' || ctx.type === 'location') break;
  }
  return { values, errors: [...errors], missing, empty: false };
}

/** Particle resolution type of a property. */
export function resolutionTypeOf(
  type: ParseContext['type'],
  opts: { isId: boolean; field: NameField | null; systemAttributeType: string | null },
): string {
  if (opts.isId) return 'text:uuid';
  switch (type) {
    case 'personal-name':
      return opts.field === 'first-name'
        ? 'personal-name:first-name'
        : opts.field === 'last-name'
          ? 'personal-name:last-name'
          : 'personal-name:value';
    case 'pipeline':
      return 'pipeline:value';
    case 'date':
      return opts.systemAttributeType === 'foundation-date' ? 'date:foundation-date' : 'date:value';
    case 'text':
      switch (opts.systemAttributeType) {
        case 'facebook':
          return 'text:facebook';
        case 'instagram':
          return 'text:instagram';
        case 'twitter':
          return 'text:twitter';
        case 'linked-in':
          return 'text:linked-in-person';
        default:
          return 'text:value';
      }
    default:
      return `${type}:value`;
  }
}
