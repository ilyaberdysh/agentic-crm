// Read forms per attribute type (attribute-types §3, contracts `valueOutputSchemas`): defensive accessors over the
// `unknown` value of a wire row, the write → read conversion used for optimistic values, and value identity (which
// values are "the same" when a multi-value set is diffed or a single value is re-committed unchanged).
import type { AttributeType, ValueOutput } from '@agentic-crm/contracts';
import type { AttributeDefinition, AttributeValue } from '../types';
import { normalizeDate, normalizeDomain, normalizeEmail, normalizePhone } from './normalize';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export type Location = ValueOutput<'location'>;
export type PersonalName = ValueOutput<'personal-name'>;
export type Currency = ValueOutput<'currency'>;
export type Phone = ValueOutput<'phone-number'>;
export type Email = ValueOutput<'email-address'>;
export type Domain = ValueOutput<'domain'>;
export type Interaction = ValueOutput<'interaction'>;
export type RecordReference = ValueOutput<'entity-reference'>;
export type ActorReference = ValueOutput<'actor-reference'>;

export const LOCATION_KEYS = [
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

export const read = {
  text: (v: unknown): string | null => str(v),
  number: (v: unknown): number | null => num(v),
  checkbox: (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null),
  rating: (v: unknown): number | null => num(v),
  date: (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, 10) : null),
  timestamp: (v: unknown): string | null => str(v),
  currency: (v: unknown): Currency | null => {
    if (!isObj(v)) return null;
    const amount = num(v.currencyValue);
    return amount === null ? null : { currencyValue: amount, currencyCode: str(v.currencyCode) };
  },
  pipeline: (v: unknown): string | null => (isObj(v) ? str(v.pipelineStageId) : null),
  select: (v: unknown): string | null => (isObj(v) ? str(v.selectOptionId) : null),
  reference: (v: unknown): RecordReference | null => {
    if (!isObj(v)) return null;
    const id = str(v.entityInstanceId);
    return id ? { entityInstanceId: id, entityDefinitionId: str(v.entityDefinitionId) ?? '' } : null;
  },
  actor: (v: unknown): ActorReference | null => {
    if (!isObj(v)) return null;
    const id = str(v.referencedActorId);
    const type = str(v.referencedActorType);
    return id && type ? ({ referencedActorId: id, referencedActorType: type } as ActorReference) : null;
  },
  location: (v: unknown): Location | null => {
    if (!isObj(v)) return null;
    const out = {} as Location;
    for (const k of LOCATION_KEYS) (out as Record<string, string | null>)[k] = str(v[k]);
    return out;
  },
  domain: (v: unknown): Domain | null => {
    if (typeof v === 'string') return normalizeDomain(v);
    if (!isObj(v)) return null;
    const d = str(v.normalizedDomain) ?? str(v.domain);
    return d ? { normalizedDomain: d, rootDomain: str(v.rootDomain) ?? d } : null;
  },
  email: (v: unknown): Email | null => {
    if (typeof v === 'string') return normalizeEmail(v);
    if (!isObj(v)) return null;
    const original = str(v.originalEmailAddress) ?? str(v.emailAddress);
    if (!original) return null;
    return isObj(v) && str(v.normalizedEmailAddress)
      ? (v as unknown as Email)
      : (normalizeEmail(original) ?? {
          originalEmailAddress: original,
          normalizedEmailAddress: original.toLowerCase(),
          emailDomain: '',
          emailRootDomain: '',
          emailLocalSpecifier: '',
        });
  },
  phone: (v: unknown): Phone | null => {
    if (typeof v === 'string') {
      const r = normalizePhone(v, null);
      return r.ok ? r : { originalPhoneNumber: v, countryCode: null, normalizedPhoneNumber: v };
    }
    if (!isObj(v)) return null;
    const original = str(v.originalPhoneNumber);
    if (!original) return null;
    const cc = str(v.countryCode);
    const normalized = str(v.normalizedPhoneNumber);
    if (normalized) return { originalPhoneNumber: original, countryCode: cc, normalizedPhoneNumber: normalized };
    const r = normalizePhone(original, cc);
    return r.ok ? r : { originalPhoneNumber: original, countryCode: cc, normalizedPhoneNumber: original };
  },
  interaction: (v: unknown): Interaction | null => {
    if (!isObj(v)) return null;
    const at = str(v.interactedAt);
    if (!at) return null;
    return {
      interactionHeaderId: str(v.interactionHeaderId),
      interactionType: str(v.interactionType) ?? 'email',
      interactedAt: at,
      ownerMembershipId: str(v.ownerMembershipId),
      mailboxId: str(v.mailboxId),
    };
  },
  name: (v: unknown): PersonalName | null => {
    if (!isObj(v)) return null;
    const first = str(v.firstName) ?? '';
    const last = str(v.lastName) ?? '';
    const full = str(v.fullName) ?? [first, last].filter(Boolean).join(' ');
    return { firstName: first, lastName: last, fullName: full };
  },
};

/** Values in display order: rank, then creation. */
export function sortValues(values: readonly AttributeValue[]): AttributeValue[] {
  return [...values].sort((a, b) => {
    const ra = a.sortOrder ?? '';
    const rb = b.sortOrder ?? '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.activeFrom < b.activeFrom ? -1 : a.activeFrom > b.activeFrom ? 1 : 0;
  });
}

/** Only current values (the server only returns current ones; optimistic lists may hold none retired either). */
export function currentValues(values: readonly AttributeValue[] | undefined): AttributeValue[] {
  return sortValues((values ?? []).filter((v) => v.activeUntil === null));
}

/**
 * Write form → read form, for optimistic rendering before the server answers. Unknown or invalid input is returned as
 * is (the write will fail and roll back).
 */
export function toReadForm(type: AttributeType, value: unknown, attribute?: AttributeDefinition): unknown {
  switch (type) {
    case 'date':
      return typeof value === 'string' ? (normalizeDate(value) ?? value) : value;
    case 'currency': {
      const c = read.currency(value);
      return c ? { currencyValue: c.currencyValue, currencyCode: c.currencyCode ?? null } : value;
    }
    case 'entity-reference': {
      const r = read.reference(value);
      if (!r) return value;
      const allowed = attribute?.config.entityReferenceConfiguration?.allowedEntityDefinitionIds;
      return {
        entityInstanceId: r.entityInstanceId,
        entityDefinitionId: r.entityDefinitionId || (allowed?.length === 1 ? allowed[0] : ''),
      };
    }
    case 'location': {
      const l = read.location(value);
      return l ?? value;
    }
    case 'domain':
      return read.domain(value) ?? value;
    case 'email-address':
      return read.email(value) ?? value;
    case 'phone-number':
      return read.phone(value) ?? value;
    case 'personal-name':
      return read.name(value) ?? value;
    default:
      return value;
  }
}

/** Read form → a write form the server accepts (re-adding a value: undo, duplicate, paste of a copied row). */
export function toWriteForm(type: AttributeType, value: unknown): unknown {
  switch (type) {
    case 'domain':
      return read.domain(value)?.normalizedDomain ?? value;
    case 'email-address':
      return read.email(value)?.originalEmailAddress ?? value;
    case 'phone-number': {
      const p = read.phone(value);
      return p ? { originalPhoneNumber: p.originalPhoneNumber, countryCode: p.countryCode } : value;
    }
    case 'entity-reference': {
      const r = read.reference(value);
      return r
        ? {
            entityInstanceId: r.entityInstanceId,
            ...(r.entityDefinitionId ? { entityDefinitionId: r.entityDefinitionId } : {}),
          }
        : value;
    }
    case 'interaction':
      return value;
    default:
      return value;
  }
}

/** Identity of a read value: equal keys = the same value (multi-value diffing, no-op detection). */
export function valueIdentity(type: AttributeType, value: unknown): string {
  switch (type) {
    case 'text':
      return `t:${read.text(value) ?? ''}`;
    case 'number':
    case 'rating':
      return `n:${read.number(value) ?? ''}`;
    case 'checkbox':
      return `b:${read.checkbox(value)}`;
    case 'currency': {
      const c = read.currency(value);
      return `c:${c?.currencyCode ?? ''}:${c?.currencyValue ?? ''}`;
    }
    case 'date':
      return `d:${read.date(value) ?? ''}`;
    case 'timestamp': {
      const t = read.timestamp(value);
      const ms = t ? Date.parse(t) : Number.NaN;
      return `ts:${Number.isNaN(ms) ? (t ?? '') : ms}`;
    }
    case 'pipeline':
      return `p:${read.pipeline(value) ?? ''}`;
    case 'select':
      return `s:${read.select(value) ?? ''}`;
    case 'entity-reference':
      return `r:${read.reference(value)?.entityInstanceId ?? ''}`;
    case 'actor-reference': {
      const a = read.actor(value);
      return `a:${a?.referencedActorType ?? ''}:${a?.referencedActorId ?? ''}`;
    }
    case 'location': {
      const l = read.location(value);
      return `l:${l ? LOCATION_KEYS.map((k) => l[k] ?? '').join('|') : ''}`;
    }
    case 'domain':
      return `dm:${read.domain(value)?.normalizedDomain ?? ''}`;
    case 'email-address':
      return `e:${read.email(value)?.normalizedEmailAddress ?? ''}`;
    case 'phone-number':
      return `ph:${read.phone(value)?.normalizedPhoneNumber ?? ''}`;
    case 'interaction': {
      const i = read.interaction(value);
      return `i:${i?.interactionType ?? ''}:${i?.interactedAt ?? ''}`;
    }
    case 'personal-name': {
      const n = read.name(value);
      return `pn:${n?.firstName ?? ''}|${n?.lastName ?? ''}`;
    }
  }
}

/** A read value that carries nothing (empty string, empty name / location). */
export function isBlankValue(type: AttributeType, value: unknown): boolean {
  switch (type) {
    case 'text':
      return (read.text(value) ?? '').length === 0;
    case 'personal-name': {
      const n = read.name(value);
      return !n || (!n.firstName.trim() && !n.lastName.trim() && !n.fullName.trim());
    }
    case 'location': {
      const l = read.location(value);
      return !l || LOCATION_KEYS.every((k) => !l[k]);
    }
    default:
      return value === null || value === undefined;
  }
}
