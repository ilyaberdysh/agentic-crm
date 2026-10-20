// Per-type value codecs: write form (contracts valueInputSchemas) → typed storage columns of attribute_values, and
// storage → read form (contracts valueOutputSchemas). Storage layout per type:
//   text            v_text                          display = text
//   number, rating  v_num
//   currency        v_num = value, v_text = code (NULL = attribute default)
//   checkbox        v_bool · date v_date · timestamp v_ts
//   select/pipeline v_ref = option/stage id
//   entity-ref      v_ref = target instance, v_ref_def = target definition
//   actor-ref       v_ref = actor id, v_text = actor type
//   location        v_json = full object                 display = locality
//   domain          v_text = normalized, v_json {rootDomain}            display = normalized
//   email-address   v_text = normalized, v_json {original…, domain…}    display = normalized
//   phone-number    v_text = normalized, v_json {originalPhoneNumber, countryCode}
//   interaction     v_ts = interactedAt, v_ref = owner member, v_text = type, v_json {interactionHeaderId, mailboxId}
//   personal-name   v_text = full name, v_json {firstName, lastName}     display = full name
// `display` feeds sort_key = left(norm_key(display), 128); `canonical` is the identity used for duplicate detection in
// multi-value attributes and, for unique attributes, stored as unique_key.
import { type AttributeType, currencyCodes, valueInputSchemas } from '@agentic-crm/contracts';
import type { Json } from '@agentic-crm/db';
import { valueError } from '../errors.ts';
import type { AttrDef } from '../schema/model.ts';
import { normalizeDate, normalizeDomain, normalizeEmail, normalizePhone, normalizeTimestamp } from './normalize.ts';

export interface StoredValue {
  v_text: string | null;
  v_num: number | null;
  v_ts: string | null;
  v_date: string | null;
  v_bool: boolean | null;
  v_ref: string | null;
  v_ref_def: string | null;
  v_json: Json | null;
  display: string | null;
  canonical: string;
}

/** A stored attribute_values row as read back (subset used by codecs). */
export interface ValueRowLike {
  v_text: string | null;
  v_num: string | number | null;
  v_ts: string | null;
  v_date: string | null;
  v_bool: boolean | null;
  v_ref: string | null;
  v_ref_def: string | null;
  v_json: unknown;
}

const empty = (): Omit<StoredValue, 'canonical'> => ({
  v_text: null,
  v_num: null,
  v_ts: null,
  v_date: null,
  v_bool: null,
  v_ref: null,
  v_ref_def: null,
  v_json: null,
  display: null,
});

const CURRENCIES = new Set<string>(currencyCodes);
const LOCATION_KEYS = [
  'line1',
  'line2',
  'line3',
  'line4',
  'locality',
  'region',
  'postcode',
  'countryCode',
  'latitude',
  'longitude',
] as const;

/**
 * Validates and normalises one write-form value. Returns null for "no value" inputs (empty text, empty name), which
 * the engine treats like an omitted value. Reference existence (options, records, members) is checked by the engine.
 */
export function parseValue(attr: AttrDef, raw: unknown): StoredValue | null {
  const schema = valueInputSchemas[attr.type];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw valueError(
      attr.id,
      'invalid',
      `Invalid value for ${attr.type} attribute "${attr.apiSlug}": ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  const v = parsed.data as never;
  return PARSERS[attr.type](attr, v);
}

type Parser = (attr: AttrDef, value: never) => StoredValue | null;

const PARSERS: Record<AttributeType, Parser> = {
  text: (_a, s: string) => (s === '' ? null : { ...empty(), v_text: s, display: s, canonical: s }),
  number: (_a, n: number) => ({ ...empty(), v_num: n, canonical: String(n) }),
  rating: (_a, n: number) => ({ ...empty(), v_num: n, canonical: String(n) }),
  checkbox: (_a, b: boolean) => ({ ...empty(), v_bool: b, canonical: String(b) }),
  currency: (a, c: { currencyValue: number; currencyCode?: string | null }) => {
    const code = c.currencyCode ? c.currencyCode.toUpperCase() : null;
    if (code !== null && !CURRENCIES.has(code))
      throw valueError(a.id, 'invalid-currency', `Unsupported currency code ${code}`);
    return { ...empty(), v_num: c.currencyValue, v_text: code, canonical: `${code ?? ''}:${c.currencyValue}` };
  },
  date: (a, s: string) => {
    const d = normalizeDate(s);
    if (!d) throw valueError(a.id, 'invalid-date', `Invalid date "${s}"`);
    return { ...empty(), v_date: d, canonical: d };
  },
  timestamp: (a, s: string) => {
    const t = normalizeTimestamp(s);
    if (!t) throw valueError(a.id, 'invalid-timestamp', `Invalid timestamp "${s}"`);
    return { ...empty(), v_ts: t, canonical: t };
  },
  pipeline: (_a, v: { pipelineStageId: string }) => {
    const id = v.pipelineStageId.toLowerCase();
    return { ...empty(), v_ref: id, canonical: id };
  },
  select: (_a, v: { selectOptionId: string }) => {
    const id = v.selectOptionId.toLowerCase();
    return { ...empty(), v_ref: id, canonical: id };
  },
  'entity-reference': (_a, v: { entityDefinitionId?: string; entityInstanceId: string }) => {
    const id = v.entityInstanceId.toLowerCase();
    return { ...empty(), v_ref: id, v_ref_def: v.entityDefinitionId?.toLowerCase() ?? null, canonical: id };
  },
  'actor-reference': (_a, v: { referencedActorType: string; referencedActorId: string }) => {
    const id = v.referencedActorId.toLowerCase();
    return { ...empty(), v_ref: id, v_text: v.referencedActorType, canonical: `${v.referencedActorType}:${id}` };
  },
  location: (a, v: Partial<Record<(typeof LOCATION_KEYS)[number], string | null>>) => {
    const loc: Record<string, string | null> = {};
    for (const k of LOCATION_KEYS) {
      const s = v[k];
      loc[k] = typeof s === 'string' && s.trim() !== '' ? s.trim() : null;
    }
    if (loc.countryCode !== null) {
      loc.countryCode = (loc.countryCode as string).toUpperCase();
      if (!/^[A-Z]{2}$/.test(loc.countryCode))
        throw valueError(a.id, 'invalid-country', 'Country code must be ISO 3166-1 alpha-2');
    }
    if (Object.values(loc).every((x) => x === null)) return null;
    return { ...empty(), v_json: loc, display: loc.locality ?? null, canonical: JSON.stringify(loc) };
  },
  domain: (a, v: string | { domain: string }) => {
    const n = normalizeDomain(typeof v === 'string' ? v : v.domain);
    if (!n) throw valueError(a.id, 'invalid-domain', 'Invalid domain');
    return {
      ...empty(),
      v_text: n.normalizedDomain,
      v_json: { rootDomain: n.rootDomain },
      display: n.normalizedDomain,
      canonical: n.normalizedDomain,
    };
  },
  'email-address': (a, v: string | { emailAddress: string }) => {
    const n = normalizeEmail(typeof v === 'string' ? v : v.emailAddress);
    if (!n) throw valueError(a.id, 'invalid-email', 'Invalid email address');
    const { normalizedEmailAddress, ...rest } = n;
    return {
      ...empty(),
      v_text: normalizedEmailAddress,
      v_json: rest,
      display: normalizedEmailAddress,
      canonical: normalizedEmailAddress,
    };
  },
  'phone-number': (a, v: string | { originalPhoneNumber: string; countryCode?: string | null }) => {
    const input = typeof v === 'string' ? { originalPhoneNumber: v, countryCode: null } : v;
    const n = normalizePhone(input.originalPhoneNumber, input.countryCode);
    if (!n.ok)
      throw valueError(
        a.id,
        n.reason,
        n.reason === 'MISSING_COUNTRY_CODE' ? 'Phone number needs a country code' : 'Invalid phone number',
      );
    return {
      ...empty(),
      v_text: n.normalizedPhoneNumber,
      v_json: { originalPhoneNumber: n.originalPhoneNumber, countryCode: n.countryCode },
      display: n.normalizedPhoneNumber,
      canonical: n.normalizedPhoneNumber,
    };
  },
  interaction: (
    a,
    v: {
      interactionHeaderId?: string | null;
      interactionType: string;
      interactedAt: string;
      ownerMembershipId?: string | null;
      mailboxId?: string | null;
    },
  ) => {
    const at = normalizeTimestamp(v.interactedAt);
    if (!at) throw valueError(a.id, 'invalid-timestamp', 'Invalid interactedAt');
    return {
      ...empty(),
      v_ts: at,
      v_ref: v.ownerMembershipId ?? null,
      v_text: v.interactionType,
      v_json: { interactionHeaderId: v.interactionHeaderId ?? null, mailboxId: v.mailboxId ?? null },
      canonical: `${v.interactionType}:${at}:${v.interactionHeaderId ?? ''}`,
    };
  },
  'personal-name': (_a, v: { firstName?: string; lastName?: string; fullName?: string }) => {
    const firstName = (v.firstName ?? '').trim();
    const lastName = (v.lastName ?? '').trim();
    const fullName = (v.fullName ?? '').trim() || [firstName, lastName].filter(Boolean).join(' ');
    if (!firstName && !lastName && !fullName) return null;
    return {
      ...empty(),
      v_text: fullName,
      v_json: { firstName, lastName },
      display: fullName,
      canonical: JSON.stringify([firstName, lastName, fullName]),
    };
  },
};

const num = (x: string | number | null) => (x === null ? null : Number(x));
const obj = (x: unknown) => (x ?? {}) as Record<string, unknown>;

/** Storage → read form. */
export function readValue(type: AttributeType, row: ValueRowLike): unknown {
  switch (type) {
    case 'text':
      return row.v_text;
    case 'number':
    case 'rating':
      return num(row.v_num);
    case 'checkbox':
      return row.v_bool;
    case 'currency':
      return { currencyValue: num(row.v_num), currencyCode: row.v_text };
    case 'date':
      return row.v_date;
    case 'timestamp':
      return row.v_ts;
    case 'pipeline':
      return { pipelineStageId: row.v_ref };
    case 'select':
      return { selectOptionId: row.v_ref };
    case 'entity-reference':
      return { entityDefinitionId: row.v_ref_def, entityInstanceId: row.v_ref };
    case 'actor-reference':
      return { referencedActorType: row.v_text, referencedActorId: row.v_ref };
    case 'location':
      return Object.fromEntries(LOCATION_KEYS.map((k) => [k, (obj(row.v_json)[k] as string | null) ?? null]));
    case 'domain':
      return { normalizedDomain: row.v_text, rootDomain: obj(row.v_json).rootDomain ?? null };
    case 'email-address':
      return { ...obj(row.v_json), normalizedEmailAddress: row.v_text };
    case 'phone-number':
      return {
        originalPhoneNumber: obj(row.v_json).originalPhoneNumber ?? row.v_text,
        countryCode: obj(row.v_json).countryCode ?? null,
        normalizedPhoneNumber: row.v_text,
      };
    case 'interaction':
      return {
        interactionHeaderId: obj(row.v_json).interactionHeaderId ?? null,
        interactionType: row.v_text,
        interactedAt: row.v_ts,
        ownerMembershipId: row.v_ref,
        mailboxId: obj(row.v_json).mailboxId ?? null,
      };
    case 'personal-name':
      return {
        firstName: obj(row.v_json).firstName ?? '',
        lastName: obj(row.v_json).lastName ?? '',
        fullName: row.v_text,
      };
  }
}
