// Public write forms → domain write forms, per attribute type (data-model-documented §2.3–2.4; attribute-types docs):
// single values may be unwrapped, select/status values are option titles or ids, actor references accept member
// emails, record references accept {target_object, target_record_id} or a unique matching attribute, names accept
// "Last, First", locations accept free text, dates and timestamps accept partial ISO strings.
import type { AttributeDefinition, EntityDefinition, ValueInput } from '@agentic-crm/contracts';
import type { V2Context } from './context';
import { publicErrors, withHints } from './errors';

type R = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is R => typeof v === 'object' && v !== null && !Array.isArray(v);

function invalidValue(attr: AttributeDefinition, why: string): never {
  throw publicErrors.validation(`Invalid value was passed to attribute with slug "${attr.apiSlug}": ${why}.`);
}

/** `{value: x}` → x for the types whose object form wraps a single `value`. */
function unwrap(raw: unknown, key: string): unknown {
  return isObject(raw) && key in raw ? raw[key] : raw;
}

function asString(attr: AttributeDefinition, raw: unknown): string {
  if (typeof raw !== 'string') invalidValue(attr, 'expected a string');
  return raw;
}

function asNumber(attr: AttributeDefinition, raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) invalidValue(attr, 'expected a number');
  return n;
}

/** '2023' → '2023-01-01T00:00:00Z', '2023-01-02T13:00' → '2023-01-02T13:00:00Z' (UTC is assumed without a zone). */
export function normalizeTimestampInput(input: string): string | null {
  const m =
    /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      input.trim(),
    );
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', frac = '', zone = 'Z'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${frac}${zone.toUpperCase()}`;
}

/** '2023' → '2023-01-01'; timestamps are converted to UTC and trimmed by the domain. */
export function normalizeDateInput(input: string): string | null {
  const s = input.trim();
  const partial = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
  if (partial) return `${partial[1]}-${partial[2] ?? '01'}-${partial[3] ?? '01'}`;
  return normalizeTimestampInput(s);
}

/** "Last, First" → names; text without a comma is the first name; further commas belong to the first name. */
export function parseNameString(input: string) {
  const s = input.trim();
  const comma = s.indexOf(',');
  const firstName = comma === -1 ? s : s.slice(comma + 1).trim();
  const lastName = comma === -1 ? '' : s.slice(0, comma).trim();
  return { firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(' ') };
}

/** "1 Infinite Loop, Cupertino, CA, 95014, US" → location fields (country and postcode are recognised at the end). */
export function parseLocationString(input: string) {
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Record<string, string | null> = {
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
  if (parts.length > 1 && /^[A-Za-z]{2}$/.test(parts.at(-1) as string))
    out.countryCode = (parts.pop() as string).toUpperCase();
  if (parts.length > 1 && /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(parts.at(-1) as string))
    out.postcode = parts.pop() as string;
  if (parts.length === 1) out.locality = parts[0] as string;
  else if (parts.length === 2) [out.locality, out.region] = parts as [string, string];
  else if (parts.length >= 3) {
    out.region = parts.pop() as string;
    out.locality = parts.pop() as string;
    parts.slice(0, 4).forEach((line, i) => {
      out[`line${i + 1}`] = line;
    });
  }
  return out;
}

const LOCATION_FIELDS: [string, string][] = [
  ['line_1', 'line1'],
  ['line_2', 'line2'],
  ['line_3', 'line3'],
  ['line_4', 'line4'],
  ['locality', 'locality'],
  ['region', 'region'],
  ['postcode', 'postcode'],
  ['country_code', 'countryCode'],
  ['latitude', 'latitude'],
  ['longitude', 'longitude'],
];

/** Shortcut matching attributes for record references whose only allowed object is a standard object. */
const SHORTCUT_MATCH: Record<string, string> = {
  companies: 'domains',
  people: 'email_addresses',
  users: 'user_id',
  workspaces: 'workspace_id',
};

async function resolveOptionId(v2: V2Context, attr: AttributeDefinition, key: string): Promise<string> {
  const options = await v2.optionsOf(attr);
  const lower = key.toLowerCase();
  const match =
    options.find((o) => o.id === lower) ??
    options.find((o) => o.title === key && !o.isArchived) ??
    options.find((o) => o.title.toLowerCase() === lower && !o.isArchived) ??
    options.find((o) => o.title === key);
  if (!match) {
    throw publicErrors.valueNotFound(
      attr.type === 'pipeline'
        ? `Cannot find status attribute with status title "${key}".`
        : `Cannot find select attribute with select option title "${key}".`,
    );
  }
  return match.id;
}

async function resolveMember(v2: V2Context, attr: AttributeDefinition, raw: unknown): Promise<string> {
  if (typeof raw === 'string' || (isObject(raw) && typeof raw.workspace_member_email_address === 'string')) {
    const email = (typeof raw === 'string' ? raw : (raw.workspace_member_email_address as string)).trim().toLowerCase();
    const member = (await v2.workspaceMembers()).find((m) => m.emailAddress.toLowerCase() === email);
    if (!member) throw publicErrors.valueNotFound(`Cannot find workspace member with email address "${email}".`);
    return member.id;
  }
  if (isObject(raw) && 'referenced_actor_type' in raw) {
    if (raw.referenced_actor_type !== 'workspace-member') {
      invalidValue(attr, 'only workspace members can be referenced');
    }
    if (typeof raw.referenced_actor_id !== 'string' || !UUID.test(raw.referenced_actor_id)) {
      invalidValue(attr, 'referenced_actor_id must be a UUID');
    }
    return raw.referenced_actor_id.toLowerCase();
  }
  return invalidValue(attr, 'expected an email address or {referenced_actor_type, referenced_actor_id}');
}

async function findByMatching(
  v2: V2Context,
  attr: AttributeDefinition,
  target: EntityDefinition,
  matchingKey: string,
  matchingValue: unknown,
): Promise<string> {
  const matchAttr = (await v2.attributesOf(target.id)).find((a) => a.apiSlug === matchingKey || a.id === matchingKey);
  if (!matchAttr) throw publicErrors.valueNotFound(`Cannot find attribute with slug/ID "${matchingKey}".`);
  if (!matchAttr.isUnique) invalidValue(attr, `the matching attribute "${matchAttr.apiSlug}" is not unique`);
  const items = Array.isArray(matchingValue) ? matchingValue : [matchingValue];
  if (items.length !== 1) invalidValue(attr, 'matching on multiple values is not supported');
  const value = await toInternalValue(v2, matchAttr, items[0]);
  const found = await withHints({}, () =>
    v2.domain.records.findByUniqueValues(v2.ctx, {
      entityDefinitionId: target.id,
      attributeDefinitionId: matchAttr.id,
      values: [{ value }],
    }),
  );
  const id = found.entityInstanceIds[0];
  if (!id || found.entityInstanceIds.length > 1) {
    throw publicErrors.valueNotFound(
      `Cannot find a ${target.singularNoun.toLowerCase()} record with ${matchAttr.apiSlug} "${typeof items[0] === 'string' ? items[0] : JSON.stringify(items[0])}".`,
    );
  }
  return id;
}

async function toRecordReference(v2: V2Context, attr: AttributeDefinition, raw: unknown): Promise<unknown> {
  const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? [];
  const onlyTarget = allowed.length === 1 ? await v2.definitionById(allowed[0] as string) : undefined;
  if (typeof raw === 'string') {
    if (!onlyTarget) invalidValue(attr, 'expected {target_object, target_record_id}');
    if (UUID.test(raw)) return { entityDefinitionId: onlyTarget.id, entityInstanceId: raw.toLowerCase() };
    const shortcut = SHORTCUT_MATCH[onlyTarget.apiSlug];
    if (!shortcut) invalidValue(attr, 'expected {target_object, target_record_id}');
    const id = await findByMatching(v2, attr, onlyTarget, shortcut, raw);
    return { entityDefinitionId: onlyTarget.id, entityInstanceId: id };
  }
  if (!isObject(raw) || typeof raw.target_object !== 'string') {
    return invalidValue(attr, 'expected {target_object, target_record_id}');
  }
  const targetKey = raw.target_object;
  const target = (await v2.allDefinitions()).find((d) => d.apiSlug === targetKey || d.id === targetKey.toLowerCase());
  if (!target) throw publicErrors.valueNotFound(`Object with slug/ID "${targetKey}" not found.`);
  if (typeof raw.target_record_id === 'string') {
    if (!UUID.test(raw.target_record_id)) invalidValue(attr, 'target_record_id must be a UUID');
    return { entityDefinitionId: target.id, entityInstanceId: raw.target_record_id.toLowerCase() };
  }
  const matching = Object.keys(raw).filter((k) => k !== 'target_object');
  if (matching.length !== 1) invalidValue(attr, 'expected target_record_id or exactly one matching attribute');
  const key = matching[0] as string;
  const id = await findByMatching(v2, attr, target, key, raw[key]);
  return { entityDefinitionId: target.id, entityInstanceId: id };
}

/** One public write-form value → the domain write form for `attr`. */
export async function toInternalValue(v2: V2Context, attr: AttributeDefinition, raw: unknown): Promise<unknown> {
  switch (attr.type) {
    case 'text':
      return asString(attr, unwrap(raw, 'value'));
    case 'number':
      return asNumber(attr, unwrap(raw, 'value'));
    case 'rating': {
      const n = asNumber(attr, unwrap(raw, 'value'));
      if (!Number.isInteger(n) || n < 0 || n > 5) invalidValue(attr, 'expected an integer from 0 to 5');
      return n;
    }
    case 'checkbox': {
      const v = unwrap(raw, 'value');
      if (v === true || v === 'true') return true;
      if (v === false || v === 'false') return false;
      return invalidValue(attr, 'expected true or false');
    }
    case 'currency':
      return { currencyValue: asNumber(attr, unwrap(raw, 'currency_value')) };
    case 'date': {
      const d = normalizeDateInput(asString(attr, unwrap(raw, 'value')));
      if (!d) invalidValue(attr, 'expected an ISO 8601 date');
      return d;
    }
    case 'timestamp': {
      const t = normalizeTimestampInput(asString(attr, unwrap(raw, 'value')));
      if (!t) invalidValue(attr, 'expected an ISO 8601 timestamp');
      return t;
    }
    case 'select':
      return { selectOptionId: await resolveOptionId(v2, attr, asString(attr, unwrap(raw, 'option'))) };
    case 'pipeline':
      return { pipelineStageId: await resolveOptionId(v2, attr, asString(attr, unwrap(raw, 'status'))) };
    case 'actor-reference':
      return { referencedActorType: 'workspace-member', referencedActorId: await resolveMember(v2, attr, raw) };
    case 'entity-reference':
      return toRecordReference(v2, attr, raw);
    case 'location': {
      if (typeof raw === 'string') return parseLocationString(raw);
      if (!isObject(raw)) return invalidValue(attr, 'expected a string or a location object');
      const missing = LOCATION_FIELDS.filter(([key]) => !(key in raw)).map(([key]) => key);
      if (missing.length > 0) invalidValue(attr, `all location fields must be given (missing ${missing.join(', ')})`);
      const out: Record<string, string | null> = {};
      for (const [key, internal] of LOCATION_FIELDS) {
        const value = raw[key];
        if (value !== null && typeof value !== 'string') invalidValue(attr, `${key} must be a string or null`);
        out[internal] = value as string | null;
      }
      return out;
    }
    case 'domain':
      return asString(attr, unwrap(raw, 'domain'));
    case 'email-address':
      return asString(attr, unwrap(raw, 'email_address'));
    case 'phone-number': {
      if (typeof raw === 'string') return raw;
      if (!isObject(raw) || typeof raw.original_phone_number !== 'string') {
        return invalidValue(attr, 'expected a string or {original_phone_number, country_code}');
      }
      const cc = raw.country_code;
      if (cc !== undefined && cc !== null && typeof cc !== 'string')
        invalidValue(attr, 'country_code must be a string');
      return { originalPhoneNumber: raw.original_phone_number, countryCode: cc ?? null };
    }
    case 'personal-name': {
      if (typeof raw === 'string') return parseNameString(raw);
      if (!isObject(raw)) return invalidValue(attr, 'expected a string or {first_name, last_name, full_name}');
      const first = raw.first_name ?? '';
      const last = raw.last_name ?? '';
      const full = raw.full_name ?? '';
      if (typeof first !== 'string' || typeof last !== 'string' || typeof full !== 'string') {
        invalidValue(attr, 'first_name, last_name and full_name must be strings');
      }
      return { firstName: first, lastName: last, fullName: full || [first, last].filter(Boolean).join(' ') };
    }
    case 'interaction':
      throw publicErrors.systemEdit(`Attribute with slug "${attr.apiSlug}" is not writable.`);
  }
}

/** `data.values` of a record write → `{<attribute id>: ValueInput[]}` plus the attributes it touches. */
export async function toInternalValues(
  v2: V2Context,
  def: EntityDefinition,
  raw: Record<string, unknown>,
): Promise<{ values: Record<string, ValueInput[]>; attributes: Map<string, AttributeDefinition> }> {
  const attrs = await v2.attributesOf(def.id);
  const values: Record<string, ValueInput[]> = {};
  const attributes = new Map<string, AttributeDefinition>();
  for (const [key, value] of Object.entries(raw)) {
    const attr = attrs.find((a) => !a.isHidden && (a.apiSlug === key || a.id === key.toLowerCase()));
    if (!attr) throw publicErrors.valueNotFound(`Cannot find attribute with slug/ID "${key}".`);
    if (attributes.has(attr.id)) throw publicErrors.validation(`Attribute "${attr.apiSlug}" was given more than once.`);
    const items = value === null ? [] : Array.isArray(value) ? value : [value];
    const inputs: ValueInput[] = [];
    for (const item of items) inputs.push({ value: await toInternalValue(v2, attr, item) });
    values[attr.id] = inputs;
    attributes.set(attr.id, attr);
  }
  return { values, attributes };
}
