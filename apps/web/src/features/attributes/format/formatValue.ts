// Value formatting (CROSS-DOMAIN B.25): one module keyed by attribute type + column overrides, one locale (X-11, see
// ./locale.ts). Cells, record fields, chips, clipboard text and the table's footer calculations all format here.
import type { AggregateOutput, AggregationKind } from '@agentic-crm/contracts';
import type { AttributeDefinition, AttributeValue, DisplayConfiguration, ValueField, ValueLookup } from '../types';
import { currentValues, read } from '../values/shapes';
import { type FormatSettings, getFormatSettings } from './locale';

// ---- numbers ------------------------------------------------------------------------------------------------------

export interface NumberFormatOptions {
  /** Fixed decimals 0–4; null/undefined = as stored (up to 10). */
  decimals?: number | null;
  grouping?: 'default' | 'no-groups' | null;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = nfCache.get(key);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat(locale, options);
    } catch {
      nf = new Intl.NumberFormat('en-US', options);
    }
    nfCache.set(key, nf);
  }
  return nf;
}

/** `1200.5` → "1 200,5" (ru-RU) / "1,200.5" (en-US); `decimals: 2` → "1 200,50"; `no-groups` → "1200,5". */
export function formatNumber(n: number, options: NumberFormatOptions = {}, settings = getFormatSettings()): string {
  const fixed = options.decimals ?? null;
  return numberFormat(settings.locale, {
    minimumFractionDigits: fixed ?? 0,
    maximumFractionDigits: fixed ?? 10,
    useGrouping: options.grouping !== 'no-groups',
  }).format(n);
}

export interface CurrencyFormatOptions {
  display?: 'symbol' | 'narrowSymbol' | 'code' | 'name' | null;
  decimals?: 'two-decimals' | 'no-decimals' | null;
  grouping?: 'default' | 'no-groups' | null;
}

/** `250000, 'EUR'` → "250 000,00 €" (ru-RU), "€250,000.00" (en-US); display `code` → "250 000,00 EUR". */
export function formatCurrency(
  amount: number,
  code: string,
  options: CurrencyFormatOptions = {},
  settings = getFormatSettings(),
): string {
  const digits = options.decimals === 'no-decimals' ? 0 : 2;
  const display = options.display ?? 'symbol';
  try {
    return numberFormat(settings.locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: display,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: options.grouping !== 'no-groups',
    }).format(amount);
  } catch {
    return `${formatNumber(amount, { decimals: digits, grouping: options.grouping }, settings)} ${code}`;
  }
}

/** `41.666…` (a percentage 0–100) → "41,67 %" (ru-RU) / "41.67%" (en-US); at most 2 decimals. */
export function formatPercent(percent: number, settings = getFormatSettings()): string {
  return numberFormat(settings.locale, { style: 'percent', maximumFractionDigits: 2 }).format(percent / 100);
}

// ---- dates (fixed English patterns, user time zone) --------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Calendar parts of an instant in a time zone. */
export function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(instant);
  } catch {
    return zonedParts(instant, 'UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
  };
}

/** Today's calendar date in the user's time zone, 'YYYY-MM-DD'. */
export function todayIso(now = new Date(), settings = getFormatSettings()): string {
  const p = zonedParts(now, settings.timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Days from calendar date a to b ('YYYY-MM-DD'). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 'YYYY-MM-DD' → "Mar 1, 2026". */
export function formatDateAbsolute(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "today", "yesterday", "in 3 days", "4 days ago", "2 months ago", "1 year ago". */
export function formatDateRelative(iso: string, now = new Date(), settings = getFormatSettings()): string {
  const days = daysBetween(todayIso(now, settings), iso.slice(0, 10));
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return relativeFromDays(days);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function relativeFromDays(days: number): string {
  const abs = Math.abs(days);
  let text: string;
  if (abs < 30) text = plural(abs, 'day');
  else if (Math.round(abs / 30.44) <= 12) text = plural(Math.max(1, Math.round(abs / 30.44)), 'month');
  else text = plural(Math.max(1, Math.round(abs / 365.25)), 'year');
  return days < 0 ? `${text} ago` : `in ${text}`;
}

/** Instant → "now", "13 minutes ago", "6 hours ago", "4 days ago", "12 months ago", "in 2 days". */
export function formatRelativeTime(iso: string, now = new Date()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diff = ms - now.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'now';
  let text: string;
  if (abs < hour) text = plural(Math.round(abs / minute), 'minute');
  else if (abs < day) text = plural(Math.round(abs / hour), 'hour');
  else return relativeFromDays(Math.round(diff / day));
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

/** Instant → "Mar 1st 2026, 12:30pm" in the user's time zone. */
export function formatTimestampAbsolute(iso: string, settings = getFormatSettings()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const p = zonedParts(new Date(ms), settings.timeZone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${MONTHS[p.month - 1]} ${ordinal(p.day)} ${p.year}, ${h12}:${String(p.minute).padStart(2, '0')}${
    p.hour < 12 ? 'am' : 'pm'
  }`;
}

/** Edit-history timestamps: "9 Oct 2026 5:06 PM" (C1 README §3.6). */
export function formatHistoryTimestamp(iso: string, settings = getFormatSettings()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const p = zonedParts(new Date(ms), settings.timeZone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year} ${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

// ---- per type -------------------------------------------------------------------------------------------------------

let countryNames: Intl.DisplayNames | null = null;
/** 'GB' → "United Kingdom" (English UI). */
export function countryName(code: string): string {
  try {
    countryNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return countryNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Effective number formatting: column override, else attribute configuration. */
export function numberOptions(attribute: AttributeDefinition, format?: DisplayConfiguration): NumberFormatOptions {
  const cfg = attribute.config.numberConfiguration;
  const col = format?.numberConfiguration;
  return {
    decimals: col?.decimalPlaces ?? cfg?.defaultDecimalPlaces ?? null,
    grouping: col?.groups ?? cfg?.defaultGroups ?? 'default',
  };
}

export function currencyOptions(attribute: AttributeDefinition, format?: DisplayConfiguration): CurrencyFormatOptions {
  const cfg = attribute.config.currencyConfiguration;
  const col = format?.currencyConfiguration;
  return {
    display: col?.displayType ?? cfg?.defaultDisplayType ?? 'symbol',
    decimals: col?.decimalPlaces ?? cfg?.defaultDecimalPlaces ?? 'two-decimals',
    grouping: col?.groups ?? cfg?.defaultGroups ?? 'default',
  };
}

export function currencyCodeOf(attribute: AttributeDefinition, stored: string | null | undefined): string {
  return stored ?? attribute.config.currencyConfiguration?.defaultCurrencyCode ?? 'USD';
}

export function dateDisplay(format?: DisplayConfiguration): 'absolute' | 'relative' {
  return format?.datetimeConfiguration?.displayType === 'relative' ? 'relative' : 'absolute';
}

export function memberName(member: { firstName: string; lastName: string; emailAddress: string } | undefined): string {
  if (!member) return '';
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  return name || member.emailAddress;
}

/** Full address on one line: "1 Main St, London, SW1, United Kingdom". */
export function formatAddress(l: NonNullable<ReturnType<typeof read.location>>): string {
  return [
    l.line1,
    l.line2,
    l.line3,
    l.line4,
    l.locality,
    l.region,
    l.postcode,
    l.countryCode && countryName(l.countryCode),
  ]
    .filter((x): x is string => Boolean(x))
    .join(', ');
}

/** One location component for a sub-field column (`locality` | `region` | `country_code` | `postcode` | `line_1`…). */
export function locationField(l: NonNullable<ReturnType<typeof read.location>>, field: string): string {
  switch (field) {
    case 'locality':
      return l.locality ?? '';
    case 'region':
      return l.region ?? '';
    case 'country_code':
      return l.countryCode ? countryName(l.countryCode) : '';
    case 'postcode':
      return l.postcode ?? '';
    case 'line_1':
      return l.line1 ?? '';
    case 'line_2':
      return l.line2 ?? '';
    case 'line_3':
      return l.line3 ?? '';
    case 'line_4':
      return l.line4 ?? '';
    default:
      return formatAddress(l);
  }
}

export interface FormatValueOptions {
  field?: ValueField;
  format?: DisplayConfiguration;
  /** Resolves option, stage, member and record titles (default: the app's query cache). */
  lookup?: ValueLookup;
  now?: Date;
  settings?: FormatSettings;
  /** Joins multiple values (default ", "). */
  separator?: string;
}

/** Display text of one read value. */
export function formatOne(attribute: AttributeDefinition, value: unknown, options: FormatValueOptions = {}): string {
  const settings = options.settings ?? getFormatSettings();
  const { field, format, lookup } = options;
  switch (attribute.type) {
    case 'text':
      return read.text(value) ?? '';
    case 'number': {
      const n = read.number(value);
      return n === null ? '' : formatNumber(n, numberOptions(attribute, format), settings);
    }
    case 'rating': {
      const n = read.number(value);
      return n === null ? '' : String(n);
    }
    case 'checkbox': {
      const b = read.checkbox(value);
      return b === null ? '' : b ? 'true' : 'false';
    }
    case 'currency': {
      const c = read.currency(value);
      return c
        ? formatCurrency(
            c.currencyValue,
            currencyCodeOf(attribute, c.currencyCode),
            currencyOptions(attribute, format),
            settings,
          )
        : '';
    }
    case 'date': {
      const d = read.date(value);
      if (!d) return '';
      return dateDisplay(format) === 'relative' ? formatDateRelative(d, options.now, settings) : formatDateAbsolute(d);
    }
    case 'timestamp': {
      const t = read.timestamp(value);
      if (!t) return '';
      return dateDisplay(format) === 'relative'
        ? formatRelativeTime(t, options.now)
        : formatTimestampAbsolute(t, settings);
    }
    case 'pipeline': {
      const id = read.pipeline(value);
      return id ? (lookup?.stage(attribute, id)?.title ?? '') : '';
    }
    case 'select': {
      const id = read.select(value);
      return id ? (lookup?.option(attribute, id)?.title ?? '') : '';
    }
    case 'entity-reference': {
      const r = read.reference(value);
      return r ? (lookup?.recordTitle(r.entityDefinitionId, r.entityInstanceId) ?? r.entityInstanceId) : '';
    }
    case 'actor-reference': {
      const a = read.actor(value);
      if (!a) return '';
      if (a.referencedActorType === 'workspace-member') return memberName(lookup?.member(a.referencedActorId));
      return actorTypeLabel(a.referencedActorType);
    }
    case 'location': {
      const l = read.location(value);
      return l ? locationField(l, field ?? '') : '';
    }
    case 'domain':
      return read.domain(value)?.normalizedDomain ?? '';
    case 'email-address':
      return read.email(value)?.originalEmailAddress ?? '';
    case 'phone-number':
      return read.phone(value)?.originalPhoneNumber ?? '';
    case 'interaction': {
      const i = read.interaction(value);
      if (!i) return '';
      if (field === 'owner_membership_id')
        return i.ownerMembershipId ? memberName(lookup?.member(i.ownerMembershipId)) : '';
      return dateDisplay(format) === 'absolute' && field === 'interacted_at'
        ? formatTimestampAbsolute(i.interactedAt, settings)
        : formatRelativeTime(i.interactedAt, options.now);
    }
    case 'personal-name': {
      const n = read.name(value);
      if (!n) return '';
      if (field === 'first_name') return n.firstName;
      if (field === 'last_name') return n.lastName;
      return n.fullName || [n.firstName, n.lastName].filter(Boolean).join(' ');
    }
  }
}

export function actorTypeLabel(type: string): string {
  switch (type) {
    case 'api-token':
      return 'API token';
    case 'system':
      return 'System';
    case 'workflow':
    case 'workflow-run':
      return 'Workflow';
    case 'import':
      return 'Import';
    case 'app':
      return 'App';
    // Slice 10: values computed by a formula ("Formula", formulas.md §4.8) or written by AI autofill.
    case 'formula-attribute':
      return 'Formula';
    case 'ai-autofill-attribute':
      return 'AI autofill';
    default:
      return type;
  }
}

/**
 * Plain-text display of an attribute's current values (cells as text, clipboard, aria labels, exports).
 * Multiple values are joined with ", ".
 */
export function formatValue(
  attribute: AttributeDefinition,
  values: readonly AttributeValue[],
  options: FormatValueOptions = {},
): string {
  const list = currentValues(values);
  return list
    .map((v) => formatOne(attribute, v.value, options))
    .filter((s) => s.length > 0)
    .join(options.separator ?? ', ');
}

// ---- footer calculations (filters-sorts-calcs §8) ------------------------------------------------------------------

/** Every kind `snapshots.aggregate` answers (contracts `aggregationKinds`). */
export type { AggregationKind } from '@agentic-crm/contracts';

const COUNT_KINDS = new Set<AggregationKind>([
  'count_empty',
  'count_not_empty',
  'count_checked',
  'count_unchecked',
  'count_unique',
  'filled',
]);
const PERCENT_KINDS = new Set<AggregationKind>([
  'percent_empty',
  'percent_not_empty',
  'percent_checked',
  'percent_unchecked',
]);

/** Grey suffix after the value ("12 filled", "6,00 avg", "41,67 % checked"; checkbox "empty" = not checked). */
export function aggregateSuffix(kind: AggregationKind, attribute: Pick<AttributeDefinition, 'type'>): string {
  const checkbox = attribute.type === 'checkbox';
  switch (kind) {
    case 'count_empty':
    case 'percent_empty':
      return checkbox ? 'not checked' : 'empty';
    case 'count_not_empty':
    case 'percent_not_empty':
    case 'filled':
      return checkbox ? 'checked' : 'filled';
    case 'count_checked':
    case 'percent_checked':
      return 'checked';
    case 'count_unchecked':
    case 'percent_unchecked':
      return 'not checked';
    case 'count_unique':
      return 'unique';
    case 'mean':
      return 'avg';
    default:
      return kind;
  }
}

/**
 * Footer text of a calculation, split into the value and the grey suffix: `{value: "734 000,00 €", suffix: "sum"}`,
 * `{value: "6,00", suffix: "avg"}`, `{value: "41,67 %", suffix: "checked"}`, `{value: "12", suffix: "filled"}`.
 * `value` is the locale-independent number of `snapshots.aggregate` (counts; percents 0–100; sums / means as plain
 * numbers); `extra.valueText` carries dates and instants (earliest / latest, date min / max). Same locale and the
 * same number / currency / date formatting as the cells (X-11).
 */
export function formatAggregate(
  kind: AggregationKind,
  value: number | null,
  attribute: AttributeDefinition,
  format?: DisplayConfiguration,
  settings = getFormatSettings(),
  extra: { valueText?: string | null; currencyCode?: string | null } = {},
): { value: string; suffix: string } {
  const suffix = aggregateSuffix(kind, attribute);
  if (extra.valueText) {
    const t = extra.valueText;
    const text =
      /^\d{4}-\d{2}-\d{2}$/.test(t) || attribute.type === 'date'
        ? dateDisplay(format) === 'relative'
          ? formatDateRelative(t.slice(0, 10), undefined, settings)
          : formatDateAbsolute(t)
        : dateDisplay(format) === 'relative'
          ? formatRelativeTime(t)
          : formatTimestampAbsolute(t, settings);
    return { value: text, suffix };
  }
  if (value === null) return { value: '–', suffix };
  if (COUNT_KINDS.has(kind)) return { value: formatNumber(value, {}, settings), suffix };
  if (PERCENT_KINDS.has(kind)) return { value: formatPercent(value, settings), suffix };
  if (attribute.type === 'currency') {
    const code = extra.currencyCode ?? currencyCodeOf(attribute, null);
    return { value: formatCurrency(value, code, currencyOptions(attribute, format), settings), suffix };
  }
  const col = format?.numberConfiguration;
  return {
    value: formatNumber(value, { decimals: col?.decimalPlaces ?? 2, grouping: col?.groups ?? 'default' }, settings),
    suffix,
  };
}

/** `formatAggregate` over a `snapshots.aggregate` response. */
export function formatAggregateResult(
  result: Pick<AggregateOutput, 'aggregation' | 'value' | 'valueText' | 'currencyCode'>,
  attribute: AttributeDefinition,
  format?: DisplayConfiguration,
  settings = getFormatSettings(),
): { value: string; suffix: string } {
  return formatAggregate(result.aggregation, result.value, attribute, format, settings, {
    valueText: result.valueText,
    currencyCode: result.currencyCode,
  });
}
