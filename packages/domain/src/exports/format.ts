// Server-side value formatting for exports — the same rules as the app's formatValue (apps/web
// features/attributes/format): ONE locale for every number, currency amount and percentage (the user's; X-11, B.25),
// dates and times in fixed English patterns in the user's time zone. Exports always use the absolute date
// patterns ("4 days ago" would go stale in a file). Multiple values are joined with ", ".
import type { AttributeType } from '@agentic-crm/contracts';

export interface ExportFormatSettings {
  locale: string;
  timeZone: string;
  /** Prefix formula-like cells (workspace setting exportFormulaInjectionPrefix, slice 6). */
  formulaPrefix?: boolean;
}

export interface ColumnFormat {
  numberConfiguration?: { decimalPlaces?: number | null; groups?: 'default' | 'no-groups' | null };
  currencyConfiguration?: {
    displayType?: 'symbol' | 'narrowSymbol' | 'code' | 'name' | null;
    decimalPlaces?: 'two-decimals' | 'no-decimals' | null;
    groups?: 'default' | 'no-groups' | null;
  };
}

export interface FormatAttribute {
  type: AttributeType;
  config: {
    numberConfiguration?: { defaultDecimalPlaces?: number | null; defaultGroups?: 'default' | 'no-groups' };
    currencyConfiguration?: {
      defaultCurrencyCode?: string;
      defaultDisplayType?: 'code' | 'name' | 'narrowSymbol' | 'symbol';
      defaultDecimalPlaces?: 'two-decimals' | 'no-decimals';
      defaultGroups?: 'default' | 'no-groups';
    };
  };
}

/** Titles and names the formatter needs (options, stages, members, record labels). */
export interface FormatLookups {
  optionTitle(optionId: string): string | undefined;
  memberName(memberId: string): string | undefined;
  recordLabel(entityInstanceId: string): string | undefined;
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

/** `1200.5` → "1 200,5" (ru-RU) / "1,200.5" (en-US). */
export function formatNumber(
  n: number,
  options: { decimals?: number | null; grouping?: 'default' | 'no-groups' | null },
  settings: ExportFormatSettings,
): string {
  const fixed = options.decimals ?? null;
  return numberFormat(settings.locale, {
    minimumFractionDigits: fixed ?? 0,
    maximumFractionDigits: fixed ?? 10,
    useGrouping: options.grouping !== 'no-groups',
  }).format(n);
}

/** `250000, 'EUR'` → "250 000,00 €" (ru-RU), "€250,000.00" (en-US). */
export function formatCurrency(
  amount: number,
  code: string,
  options: {
    display?: 'symbol' | 'narrowSymbol' | 'code' | 'name' | null;
    decimals?: 'two-decimals' | 'no-decimals' | null;
    grouping?: 'default' | 'no-groups' | null;
  },
  settings: ExportFormatSettings,
): string {
  const digits = options.decimals === 'no-decimals' ? 0 : 2;
  try {
    return numberFormat(settings.locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: options.display ?? 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: options.grouping !== 'no-groups',
    }).format(amount);
  } catch {
    return `${formatNumber(amount, { decimals: digits, grouping: options.grouping ?? null }, settings)} ${code}`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

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

/** 'YYYY-MM-DD' → "Mar 1, 2026". */
export function formatDateAbsolute(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function zonedParts(instant: Date, timeZone: string) {
  let f = partsCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
      });
    } catch {
      return zonedParts(instant, 'UTC');
    }
    partsCache.set(timeZone, f);
  }
  const parts = f.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** Instant → "Mar 1st 2026, 12:30pm" in the user's time zone. */
export function formatTimestampAbsolute(iso: string, settings: ExportFormatSettings): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const p = zonedParts(new Date(ms), settings.timeZone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${MONTHS[p.month - 1]} ${ordinal(p.day)} ${p.year}, ${h12}:${String(p.minute).padStart(2, '0')}${
    p.hour < 12 ? 'am' : 'pm'
  }`;
}

let countryNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    countryNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return countryNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

type Loc = Record<string, string | null>;

function formatAddress(l: Loc): string {
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

function locationField(l: Loc, field: string | null): string {
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
    default:
      return type;
  }
}

/** Display text of one read-form value (same cases as the app's formatOne). */
export function formatOne(
  attr: FormatAttribute,
  value: unknown,
  field: string | null,
  format: ColumnFormat | undefined,
  lookups: FormatLookups,
  settings: ExportFormatSettings,
): string {
  if (value === null || value === undefined) return '';
  const v = value as Record<string, unknown>;
  switch (attr.type) {
    case 'text':
      return String(value);
    case 'number': {
      const cfg = attr.config.numberConfiguration;
      const col = format?.numberConfiguration;
      return formatNumber(
        Number(value),
        {
          decimals: col?.decimalPlaces ?? cfg?.defaultDecimalPlaces ?? null,
          grouping: col?.groups ?? cfg?.defaultGroups ?? 'default',
        },
        settings,
      );
    }
    case 'rating':
      return String(value);
    case 'checkbox':
      return value ? 'true' : 'false';
    case 'currency': {
      const cfg = attr.config.currencyConfiguration;
      const col = format?.currencyConfiguration;
      const code = (v.currencyCode as string | null) ?? cfg?.defaultCurrencyCode ?? 'USD';
      return formatCurrency(
        Number(v.currencyValue),
        code,
        {
          display: col?.displayType ?? cfg?.defaultDisplayType ?? 'symbol',
          decimals: col?.decimalPlaces ?? cfg?.defaultDecimalPlaces ?? 'two-decimals',
          grouping: col?.groups ?? cfg?.defaultGroups ?? 'default',
        },
        settings,
      );
    }
    case 'date':
      return formatDateAbsolute(String(value));
    case 'timestamp':
      return formatTimestampAbsolute(String(value), settings);
    case 'pipeline':
      return lookups.optionTitle(String(v.pipelineStageId)) ?? '';
    case 'select':
      return lookups.optionTitle(String(v.selectOptionId)) ?? '';
    case 'entity-reference':
      return lookups.recordLabel(String(v.entityInstanceId)) ?? '';
    case 'actor-reference':
      return v.referencedActorType === 'workspace-member'
        ? (lookups.memberName(String(v.referencedActorId)) ?? '')
        : actorTypeLabel(String(v.referencedActorType));
    case 'location':
      return locationField(v as Loc, field);
    case 'domain':
      return String(v.normalizedDomain ?? '');
    case 'email-address':
      return String(v.originalEmailAddress ?? v.normalizedEmailAddress ?? '');
    case 'phone-number':
      return String(v.originalPhoneNumber ?? v.normalizedPhoneNumber ?? '');
    case 'interaction':
      if (field === 'owner_membership_id') {
        return v.ownerMembershipId ? (lookups.memberName(String(v.ownerMembershipId)) ?? '') : '';
      }
      return v.interactedAt ? formatTimestampAbsolute(String(v.interactedAt), settings) : '';
    case 'personal-name': {
      if (field === 'first_name') return String(v.firstName ?? '');
      if (field === 'last_name') return String(v.lastName ?? '');
      return String(v.fullName || [v.firstName, v.lastName].filter(Boolean).join(' '));
    }
  }
}

/** Values of one cell, formatted and joined with ", ". */
export function formatCell(
  attr: FormatAttribute,
  values: unknown[],
  field: string | null,
  format: ColumnFormat | undefined,
  lookups: FormatLookups,
  settings: ExportFormatSettings,
): string {
  return values
    .map((value) => formatOne(attr, value, field, format, lookups, settings))
    .filter((s) => s.length > 0)
    .join(', ');
}
