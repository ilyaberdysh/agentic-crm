// Operator table keyed by attribute type: which fields of a type are queryable/sortable, which projection column
// holds each field, how its values compare and which operators apply (C1 filters-sorts-calcs §3, attribute-types §3
// "Queryable"). The UI's sentence table (contracts filter-sentences.ts) only produces leaves this table accepts —
// the compiler tests check every sentence of every type.
import type { AttributeType, FilterOperator } from '@agentic-crm/contracts';

export type FieldKind =
  | 'text' // projection holds norm_key(text); literals go through norm_key()
  | 'email' // normalised (lower-case) addresses and domains; literals lower-cased
  | 'domain' // normalised domains; `eq` literals are normalised like stored domains
  | 'phone' // E.164; literals stripped to digits (and a leading '+')
  | 'country' // ISO alpha-2, upper case
  | 'number'
  | 'rating' // number where 0 counts as empty
  | 'boolean' // checkbox: no value = false
  | 'date'
  | 'timestamp'
  | 'uuid' // option / stage / record / member ids
  | 'option-order' // the referenced option's / stage's rank (select_options.sort_order)
  | 'lifecycle' // the referenced stage's lifecycle phase (ACTIVE | WON | LOST)
  | 'ref-def' // the entity definition of the referenced record
  | 'actor-type'; // the referenced actor's type

export interface FieldSpec {
  /** Canonical field name. */
  name: string;
  /** Projection column suffix holding the field's raw value (see projection.ts). */
  suffix: string;
  kind: FieldKind;
  operators: ReadonlySet<FilterOperator>;
  sortable: boolean;
  /** Accepts the dynamic value 'current-member'. */
  member?: boolean;
}

const ops = (...list: FilterOperator[]) => new Set<FilterOperator>(list);
const TEXT = ops('eq', 'contains', 'starts-with', 'ends-with', 'in', 'all', 'empty', 'not-empty');
const ORDERED = ops('eq', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'not-empty');
const IDENTITY = ops('eq', 'in', 'all', 'empty', 'not-empty');
const ORDER_ONLY = ops('gt', 'gte', 'lt', 'lte', 'empty', 'not-empty');
const CHOICE = ops('eq', 'in');

const f = (
  name: string,
  suffix: string,
  kind: FieldKind,
  operators: ReadonlySet<FilterOperator>,
  sortable = true,
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({ name, suffix, kind, operators, sortable, ...extra });

interface TypeFields {
  /** Field used when a constraint/sort names no field or 'value'. */
  primary: string;
  /** Field used by sorts without a field (e.g. stage order for statuses). */
  sortDefault?: string;
  fields: Record<string, FieldSpec>;
}

const table = (primary: string, list: FieldSpec[], sortDefault?: string): TypeFields => ({
  primary,
  ...(sortDefault ? { sortDefault } : {}),
  fields: Object.fromEntries(list.map((x) => [x.name, x])),
});

export const TYPE_FIELDS: Record<AttributeType, TypeFields> = {
  text: table('value', [f('value', '', 'text', TEXT)]),
  number: table('value', [f('value', '', 'number', ORDERED)]),
  currency: table('raw_value', [f('raw_value', '', 'number', ORDERED)]),
  rating: table('value', [f('value', '', 'rating', ORDERED)]),
  checkbox: table('value', [f('value', '', 'boolean', ops('eq', 'empty', 'not-empty'))]),
  date: table('value', [f('value', '', 'date', ORDERED)]),
  timestamp: table('value', [f('value', '', 'timestamp', ORDERED)]),
  pipeline: table(
    'pipeline_stage_id',
    [
      f('pipeline_stage_id', '', 'uuid', IDENTITY, false),
      f('stage_sort_order', '', 'option-order', ORDER_ONLY),
      f('lifecycle_phase', '', 'lifecycle', CHOICE, false),
      f('active_from', '_from', 'timestamp', ORDERED),
    ],
    'stage_sort_order',
  ),
  select: table(
    'select_option_id',
    [f('select_option_id', '', 'uuid', IDENTITY, false), f('option_sort_order', '', 'option-order', ORDER_ONLY)],
    'option_sort_order',
  ),
  'entity-reference': table('target_entity_instance_id', [
    f('target_entity_instance_id', '', 'uuid', IDENTITY, false),
    f('target_entity_definition_id', '', 'ref-def', CHOICE, false),
  ]),
  'actor-reference': table('referenced_actor_id', [
    f('referenced_actor_id', '', 'uuid', IDENTITY, true, { member: true }),
    f('referenced_actor_type', '_type', 'actor-type', ops('eq', 'in', 'empty', 'not-empty'), false),
  ]),
  location: table('locality', [
    f('locality', '', 'text', TEXT),
    f('region', '_region', 'text', TEXT),
    f('country_code', '_cc', 'country', IDENTITY),
  ]),
  domain: table('normalized_domain', [f('normalized_domain', '', 'domain', TEXT)]),
  'email-address': table('normalized_email_address', [
    f('normalized_email_address', '', 'email', TEXT),
    f('email_domain', '_domain', 'domain', TEXT),
  ]),
  'phone-number': table('normalized_phone_number', [
    f('normalized_phone_number', '', 'phone', TEXT),
    f('country_code', '_cc', 'country', IDENTITY),
  ]),
  interaction: table('interacted_at', [
    f('interacted_at', '', 'timestamp', ORDERED),
    f('owner_membership_id', '_owner', 'uuid', IDENTITY, true, { member: true }),
  ]),
  'personal-name': table('full_name', [
    f('full_name', '', 'text', TEXT),
    f('first_name', '_first', 'text', TEXT),
    f('last_name', '_last', 'text', TEXT),
  ]),
};

/** Aliases accepted for fields (Attio's 'value', public-API sub-field names). */
const ALIASES: Record<string, string> = {
  domain: 'normalized_domain',
  email_address: 'normalized_email_address',
  phone_number: 'normalized_phone_number',
  target_record_id: 'target_entity_instance_id',
  status: 'pipeline_stage_id',
  option: 'select_option_id',
  currency_value: 'raw_value',
};

/** Resolves a field name for a type; undefined when the type has no such field. */
export function resolveField(
  type: AttributeType,
  field: string | undefined | null,
  purpose: 'filter' | 'sort',
): FieldSpec | undefined {
  const t = TYPE_FIELDS[type];
  let name = field ?? undefined;
  if (name === undefined || name === 'value') name = purpose === 'sort' ? (t.sortDefault ?? t.primary) : t.primary;
  name = ALIASES[name] ?? name;
  if (purpose === 'sort' && name === t.primary && t.sortDefault && !t.fields[name]?.sortable) name = t.sortDefault;
  return t.fields[name];
}

// ---------------------------------------------------------------------------------------------------------------
// History leaves (status "was" / "was not"): constraints evaluated on attribute_values rows, current and retired.

/** Types whose values are references (v_ref), indexed for history by av_attr_hist. */
export const HISTORY_TYPES: ReadonlySet<AttributeType> = new Set([
  'pipeline',
  'select',
  'entity-reference',
  'actor-reference',
]);

export type HistoryField =
  | { column: 'v_ref'; kind: 'uuid'; member: boolean }
  | { column: 'lifecycle'; kind: 'lifecycle' }
  | { column: 'active_from' | 'active_until'; kind: 'timestamp' }
  | { column: 'v_text'; kind: 'actor-type' };

export const HISTORY_OPERATORS: Record<HistoryField['kind'], ReadonlySet<FilterOperator>> = {
  uuid: ops('eq', 'in'),
  lifecycle: CHOICE,
  timestamp: ops('eq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not-empty'),
  'actor-type': CHOICE,
};

export function resolveHistoryField(type: AttributeType, field: string | undefined | null): HistoryField | undefined {
  const name = field === undefined || field === null || field === 'value' ? TYPE_FIELDS[type].primary : field;
  const canonical = ALIASES[name] ?? name;
  if (canonical === 'active_from' || canonical === 'active_until') return { column: canonical, kind: 'timestamp' };
  if (canonical === TYPE_FIELDS[type].primary) {
    return { column: 'v_ref', kind: 'uuid', member: type === 'actor-reference' };
  }
  if (type === 'pipeline' && canonical === 'lifecycle_phase') return { column: 'lifecycle', kind: 'lifecycle' };
  if (type === 'actor-reference' && canonical === 'referenced_actor_type')
    return { column: 'v_text', kind: 'actor-type' };
  return undefined;
}
