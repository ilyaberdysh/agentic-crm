// Resolution of raw CSV cells into attribute values (C2 import.md §I3 "particle resolution types", §I4). Pure: the
// fake backend resolves with it and the wizard uses it for format auto-detection on create. Parsers follow Attio's
// observed behaviour: the decimal separator decides how "12500,50" reads (Point → 1,250,050; Comma → 12 500,50),
// dates follow the column's format (ISO / American / European, auto-detected from the samples), checkbox only takes
// true/false-like words ("no" is invalid), ratings 0–5, statuses/selects match option titles (unknown titles are
// "missing options" the user can create), users match by id, email or name. Empty cells are skipped.
import type { AttributeDefinition, PipelineStage, SelectOption, WorkspaceMember } from '@agentic-crm/contracts';
import { currencyCodes } from '@agentic-crm/contracts';
import { normalizeDomain, normalizeEmail, normalizePhone } from '../../attributes/values/normalize';
import { splitName } from '../../attributes/values/parse';
import type {
  DateFormat,
  DecimalSeparator,
  DistinctValue,
  NameField,
  PropertyConfig,
  ResolvedPart,
  ValueOverride,
} from '../data/contract';

export interface ResolveContext {
  options?: readonly SelectOption[];
  stages?: readonly PipelineStage[];
  members?: readonly WorkspaceMember[];
  config: PropertyConfig;
  field: NameField | null;
}

export const EMPTY_CONFIG: PropertyConfig = { dateFormat: null, timestampFormat: null, decimalSeparator: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Record ID / Entry ID: system id attributes, written as a match key only. */
export function isIdAttribute(attribute: Pick<AttributeDefinition, 'systemAttributeType' | 'apiSlug'>): boolean {
  return (
    attribute.systemAttributeType === 'id' || attribute.apiSlug === 'record_id' || attribute.apiSlug === 'entry_id'
  );
}

export function isParentRecordAttribute(attribute: Pick<AttributeDefinition, 'apiSlug' | 'systemAttributeType'>) {
  return attribute.apiSlug === 'parent_record' || attribute.systemAttributeType === 'parent-record';
}

// ---- numbers -------------------------------------------------------------------------------------------------------

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** "1,200.50" (point) / "1.200,50" (comma) → number; grouping characters of the other separator are ignored. */
export function parseNumberWith(text: string, separator: DecimalSeparator | null): number | null {
  let t = text.trim().replace(/[\s  ']/g, '');
  if (!t) return null;
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  t = t.replace(/%$/, '');
  if (separator === 'comma') t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const SYMBOLS: Record<string, string> = {
  '€': 'EUR',
  $: 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  '₽': 'RUB',
  '₹': 'INR',
  '₴': 'UAH',
};
const CODES = new Set<string>(currencyCodes);

/** "€12,500.50", "12 500,50 EUR", "USD 8000" → amount + code (null = the attribute's default currency). */
export function parseCurrencyWith(
  text: string,
  separator: DecimalSeparator | null,
): { currencyValue: number; currencyCode: string | null } | null {
  let code: string | null = null;
  let t = text.trim();
  const word = /\b([A-Za-z]{3})\b/.exec(t);
  if (word && CODES.has((word[1] as string).toUpperCase())) {
    code = (word[1] as string).toUpperCase();
    t = t.replace(word[0], '');
  }
  for (const [symbol, c] of Object.entries(SYMBOLS)) {
    if (t.includes(symbol)) {
      code = code ?? c;
      t = t.split(symbol).join('');
    }
  }
  const n = parseNumberWith(t, separator);
  return n === null ? null : { currencyValue: n, currencyCode: code };
}

// ---- dates ----------------------------------------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(y: number, m: number, d: number): string | null {
  const year = y < 100 ? 2000 + y : y;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(year, m - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(year).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;

/** One date in a column format → 'YYYY-MM-DD'. ISO dates are accepted in every format. */
export function parseDateWith(text: string, format: DateFormat | null): string | null {
  const t = text
    .trim()
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+/g, ' ');
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if (format === 'iso') return null;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return format === 'uk' ? isoDate(y, b, a) : isoDate(y, a, b);
  }
  // "15 May 2024" (European) / "May 15 2024", "May 15, 2024" (American)
  m = /^(\d{1,2}) ([a-z]+),? (\d{4})$/i.exec(t);
  if (m && format === 'uk' && monthOf(m[2] as string) > 0)
    return isoDate(Number(m[3]), monthOf(m[2] as string), Number(m[1]));
  m = /^([a-z]+) (\d{1,2}),? (\d{4})$/i.exec(t);
  if (m && format !== 'uk' && monthOf(m[1] as string) > 0)
    return isoDate(Number(m[3]), monthOf(m[1] as string), Number(m[2]));
  return null;
}

/** Timestamps: ISO 8601 (zone optional, UTC when absent), or a date in the column format + optional time (UTC). */
export function parseTimestampWith(text: string, format: DateFormat | null): string | null {
  const t = text.trim();
  if (!t) return null;
  const iso =
    /^(\d{4}-\d{1,2}-\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(t);
  if (iso) {
    const date = parseDateWith(iso[1] as string, 'iso');
    if (!date) return null;
    const time = `${pad(Number(iso[2] ?? 0))}:${iso[3] ?? '00'}:${pad(Number(iso[4] ?? 0))}`;
    const zone = iso[5] ? (iso[5].toUpperCase() === 'Z' ? 'Z' : iso[5].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : 'Z';
    const ms = Date.parse(`${date}T${time}${zone}`);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (format === 'iso') return null;
  const m = /^(.*?)(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(t);
  const date = m ? parseDateWith((m[1] ?? '').trim(), format) : null;
  if (!m || !date) return null;
  let hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const suffix = m[5]?.toLowerCase();
  if (suffix === 'pm' && hours < 12) hours += 12;
  if (suffix === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return new Date(`${date}T${pad(hours)}:${pad(minutes)}:${pad(Number(m[4] ?? 0))}Z`).toISOString();
}

/**
 * Format of a date / timestamp column from its samples (on create, I3: "14/07/2026" → European): ISO when every sample
 * is ISO, else the format that parses the most samples (American on a tie).
 */
export function detectDateFormat(samples: readonly string[], kind: 'date' | 'timestamp' = 'date'): DateFormat {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  const parse = kind === 'date' ? parseDateWith : parseTimestampWith;
  if (values.length > 0 && values.every((v) => parse(v, 'iso') !== null)) return 'iso';
  const us = values.filter((v) => parse(v, 'us') !== null).length;
  const uk = values.filter((v) => parse(v, 'uk') !== null).length;
  return uk > us ? 'uk' : values.length === 0 ? 'iso' : 'us';
}

// ---- other scalars --------------------------------------------------------------------------------------------------

const TRUE_WORDS = new Set(['true', '1', 'checked', 'x', '✓', '✔']);
const FALSE_WORDS = new Set(['false', '0', 'unchecked']);

export function parseCheckbox(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return null;
}

export function parseRatingValue(text: string): number | null {
  const t = text.trim();
  if (/^[★☆]+$/.test(t)) return [...t].filter((c) => c === '★').length;
  const m = /^(\d+)(?:\s*\/\s*5)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 5 ? n : null;
}

const split = (text: string) =>
  text
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

const byTitle = <T extends { title: string; isArchived: boolean; id: string }>(
  list: readonly T[] | undefined,
  title: string,
) => {
  const key = title.trim().toLowerCase();
  return list?.find((o) => !o.isArchived && (o.title.trim().toLowerCase() === key || o.id === title.trim()));
};

const memberLabel = (m: WorkspaceMember) => [m.firstName, m.lastName].filter(Boolean).join(' ').trim();

function findMember(members: readonly WorkspaceMember[] | undefined, text: string): WorkspaceMember | undefined {
  const t = text.trim().toLowerCase();
  return members?.find(
    (m) =>
      m.suspendedAt === null &&
      (m.id === text.trim() || m.emailAddress.toLowerCase() === t || memberLabel(m).toLowerCase() === t),
  );
}

function parseLocation(text: string): Record<string, string | null> {
  const parts = split(text.replace(/;/g, ','));
  if (parts.length <= 1) return { locality: text.trim() };
  const last = parts[parts.length - 1] as string;
  const country = /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : null;
  const rest = country ? parts.slice(0, -1) : parts;
  return { locality: rest[0] ?? null, region: rest.slice(1).join(', ') || null, countryCode: country };
}

const value = (v: unknown): ResolvedPart => ({ type: 'value', value: v });
const error = (message: string): ResolvedPart => ({ type: 'error', message });

/** One raw cell → resolved parts ([] when empty). */
export function resolveRaw(attribute: AttributeDefinition, raw: string, ctx: ResolveContext): ResolvedPart[] {
  const text = raw.trim();
  if (!text) return [];
  const { config } = ctx;
  if (isIdAttribute(attribute)) return UUID.test(text) ? [value(text.toLowerCase())] : [error('Invalid record ID')];
  switch (attribute.type) {
    case 'text':
      return [value(text)];
    case 'number': {
      const n = parseNumberWith(text, config.decimalSeparator);
      return n === null ? [error('Invalid number')] : [value(n)];
    }
    case 'currency': {
      const c = parseCurrencyWith(text, config.decimalSeparator);
      return c === null ? [error('Invalid number')] : [value(c)];
    }
    case 'checkbox': {
      const b = parseCheckbox(text);
      return b === null ? [error('Invalid checkbox')] : [value(b)];
    }
    case 'rating': {
      const n = parseRatingValue(text);
      if (n === null) return [error('Invalid rating')];
      return n === 0 ? [] : [value(n)];
    }
    case 'date': {
      const d = parseDateWith(text, config.dateFormat);
      return d ? [value(d)] : [error('Invalid date')];
    }
    case 'timestamp': {
      const t = parseTimestampWith(text, config.timestampFormat);
      return t ? [value(t)] : [error('Invalid timestamp')];
    }
    case 'pipeline': {
      const stage = byTitle(ctx.stages, text);
      return stage ? [value({ pipelineStageId: stage.id })] : [{ type: 'missing-option', title: text }];
    }
    case 'select': {
      const titles = attribute.isMultiselect ? split(text) : [text];
      return titles.map((title) => {
        const option = byTitle(ctx.options, title);
        return option ? value({ selectOptionId: option.id }) : { type: 'missing-option' as const, title };
      });
    }
    case 'actor-reference': {
      const parts = attribute.isMultiselect ? split(text) : [text];
      return parts.map((p) => {
        const m = findMember(ctx.members, p);
        return m ? value({ referencedActorType: 'workspace-member', referencedActorId: m.id }) : error('Invalid actor');
      });
    }
    case 'entity-reference': {
      const parts = attribute.isMultiselect ? split(text) : [text];
      const allowed = attribute.config.entityReferenceConfiguration?.allowedEntityDefinitionIds;
      return parts.map((p) =>
        UUID.test(p)
          ? value({
              entityInstanceId: p.toLowerCase(),
              ...(allowed?.length === 1 ? { entityDefinitionId: allowed[0] } : {}),
            })
          : error('Invalid record'),
      );
    }
    case 'domain': {
      const parts = attribute.isMultiselect ? split(text) : [text];
      return parts.map((p) => {
        const d = normalizeDomain(p);
        return d ? value(d.normalizedDomain) : error('Invalid domain');
      });
    }
    case 'email-address': {
      const parts = attribute.isMultiselect ? split(text) : [text];
      return parts.map((p) => (normalizeEmail(p) ? value(p) : error('Invalid email address')));
    }
    case 'phone-number': {
      const parts = attribute.isMultiselect ? split(text) : [text];
      return parts.map((p) => {
        const r = normalizePhone(p, null);
        return r.ok ? value({ originalPhoneNumber: p, countryCode: r.countryCode }) : error('Invalid phone number');
      });
    }
    case 'location':
      return [value(parseLocation(text))];
    case 'personal-name': {
      if (ctx.field === 'first_name') return [value({ firstName: text })];
      if (ctx.field === 'last_name') return [value({ lastName: text })];
      const name = splitName(text);
      return [value(name)];
    }
    case 'interaction':
      return [error('Unsupported attribute type')];
  }
}

// ---- distinct values ------------------------------------------------------------------------------------------------

/** The write-form values a distinct raw value imports (override first; unknown options and errors are dropped). */
export function effectiveValues(v: Pick<DistinctValue, 'resolved' | 'override'>): unknown[] {
  const o = v.override as ValueOverride | null;
  if (o) return 'skip' in o ? [] : o.values;
  return v.resolved.flatMap((p) => (p.type === 'value' ? [p.value] : []));
}

/** "Needs review": an error or an unknown option the user has not overridden. */
export function needsReview(v: Pick<DistinctValue, 'resolved' | 'override'>): boolean {
  return v.override === null && v.resolved.some((p) => p.type !== 'value');
}

/** Unknown option titles of a column (distinct, in first-seen order). */
export function missingOptionsOf(values: readonly Pick<DistinctValue, 'resolved' | 'override'>[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (v.override) continue;
    for (const p of v.resolved) {
      if (p.type !== 'missing-option') continue;
      const key = p.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p.title);
    }
  }
  return out;
}
