// The filter sentence table per attribute type (C1 filters-sorts-calcs §3–4, attribute-types §3 "Filter sentences"),
// the sort fields (§7) and the footer calculations (§8): the single source the filter pills, the advanced editor,
// the sort popover and the footer menus are built from, and that the server's compiler is tested against.
// A sentence turns into one predicate leaf (views.ts) with sentenceToLeaf() and back with leafToSentence().
import type { Path } from './common.ts';
import type { AttributeType } from './schema.ts';
import type { Constraint, FilterOperator, PredicateLeaf } from './views.ts';

/** What the value editor of a sentence asks for (filters-sorts-calcs §3 "Value editors"). */
export type FilterValueEditor =
  | 'none' // empty / not empty / checkbox sentences
  | 'text' // "Enter value..."
  | 'number' // "enter number..."
  | 'rating' // star picker (0–5)
  | 'option' // select option (value: option id)
  | 'stage' // status stage (value: stage id)
  | 'lifecycle' // 'ACTIVE' | 'WON' | 'LOST'
  | 'record' // record search (value: record id)
  | 'object' // object / list picker (value: entity definition id)
  | 'member' // member picker with "Current user" (value: member id, or 'current-member' with valueType dynamic)
  | 'actor-type' // actor type dropdown (value: an actor type, e.g. 'workspace-member')
  | 'country' // ISO 3166-1 alpha-2
  | 'date' // exact date ('YYYY-MM-DD')
  | 'relative-date'; // relativeDatePresets / daysAgo(n) / daysFromNow(n) (valueType dynamic) or an exact date

export interface FilterSentence {
  /** Stable sentence id. */
  readonly id: string;
  /** Operator label in the pill and menus. */
  readonly label: string;
  /** Label on multi-value attributes ("contains" / "does not contain" instead of "is" / "is not"). */
  readonly multiLabel?: string;
  readonly mode: 'must' | 'must-not';
  /** Constraint operator; null = presence only (the leaf has no constraint). */
  readonly operator: FilterOperator | null;
  /** Queryable field when it differs from the FilterField's (select less/greater than → option_sort_order). */
  readonly field?: string;
  /** Value fixed by the sentence (checkbox true, rating empty = must-not value gt 0). */
  readonly fixedValue?: unknown;
  readonly editor: FilterValueEditor;
  /** History leaf: status "was" / "was not". Optional extra constraints: `active_from` lt / gt a (relative) date. */
  readonly history?: boolean;
  /** Offered only on attributes with one of these system types. */
  readonly onlySystemTypes?: readonly string[];
  /** Hidden on attributes with one of these system types. */
  readonly hiddenSystemTypes?: readonly string[];
}

export interface FilterField {
  /** Queryable field (constraint.field). */
  readonly field: string;
  /** Sub-field label (City / State / Country, First / Last / Full name, When / With, …); null = the attribute. */
  readonly label: string | null;
  readonly sentences: readonly FilterSentence[];
}

const s = (
  id: string,
  label: string,
  mode: 'must' | 'must-not',
  operator: FilterOperator | null,
  editor: FilterValueEditor,
  extra: Partial<FilterSentence> = {},
): FilterSentence => ({ id, label, mode, operator, editor, ...extra });

// Presence on the attribute itself (`must` / `must-not` with only `active_until empty`).
const EMPTY = s('empty', 'is empty', 'must-not', null, 'none');
const NOT_EMPTY = s('not-empty', 'is not empty', 'must', null, 'none');
// Presence of a sub-field (City is empty, …).
const FIELD_EMPTY = s('empty', 'is empty', 'must', 'empty', 'none');
const FIELD_NOT_EMPTY = s('not-empty', 'is not empty', 'must', 'not-empty', 'none');

const textSentences = (empty = EMPTY, notEmpty = NOT_EMPTY): FilterSentence[] => [
  s('contains', 'contains', 'must', 'contains', 'text'),
  s('not-contains', 'does not contain', 'must-not', 'contains', 'text'),
  s('starts-with', 'starts with', 'must', 'starts-with', 'text'),
  s('ends-with', 'ends with', 'must', 'ends-with', 'text'),
  s('equals', 'is', 'must', 'eq', 'text'),
  s('not-equals', 'is not', 'must-not', 'eq', 'text'),
  empty,
  notEmpty,
];
const numberSentences = (editor: FilterValueEditor = 'number'): FilterSentence[] => [
  s('equals', 'is', 'must', 'eq', editor),
  s('not-equals', 'is not', 'must-not', 'eq', editor),
  s('less-than', 'less than', 'must', 'lt', editor),
  s('greater-than', 'greater than', 'must', 'gt', editor),
];
const dateSentences: FilterSentence[] = [
  s('equals', 'is', 'must', 'eq', 'date'),
  s('not-equals', 'is not', 'must-not', 'eq', 'date'),
  s('less-than', 'before', 'must', 'lt', 'relative-date'),
  s('greater-than', 'after', 'must', 'gt', 'relative-date'),
  EMPTY,
  NOT_EMPTY,
];
const identity = (editor: FilterValueEditor, empty = FIELD_EMPTY, notEmpty = FIELD_NOT_EMPTY): FilterSentence[] => [
  s('equals', 'is', 'must', 'eq', editor),
  s('not-equals', 'is not', 'must-not', 'eq', editor),
  empty,
  notEmpty,
];
const reference = (editor: FilterValueEditor, hidden?: readonly string[]): FilterSentence[] => [
  s('contains', 'is', 'must', 'eq', editor, { multiLabel: 'contains' }),
  s('not-contains', 'is not', 'must-not', 'eq', editor, { multiLabel: 'does not contain' }),
  hidden ? { ...EMPTY, hiddenSystemTypes: hidden } : EMPTY,
  hidden ? { ...NOT_EMPTY, hiddenSystemTypes: hidden } : NOT_EMPTY,
];

const ORDERED_SELECTS = ['employee-range', 'estimated-arr-usd', 'strongest-connection-strength'] as const;
const LIST_REFERENCES = ['entry-parent-record', 'list-entries'] as const;

export const filterFieldsByType: Record<AttributeType, readonly FilterField[]> = {
  text: [{ field: 'value', label: null, sentences: textSentences() }],
  number: [{ field: 'value', label: null, sentences: [...numberSentences(), EMPTY, NOT_EMPTY] }],
  currency: [{ field: 'raw_value', label: null, sentences: [...numberSentences(), EMPTY, NOT_EMPTY] }],
  checkbox: [
    {
      field: 'value',
      label: null,
      sentences: [
        s('true', 'is true', 'must', 'eq', 'none', { fixedValue: true }),
        s('false', 'is false', 'must-not', 'eq', 'none', { fixedValue: true }),
      ],
    },
  ],
  date: [{ field: 'value', label: null, sentences: dateSentences }],
  timestamp: [{ field: 'value', label: null, sentences: dateSentences }],
  rating: [
    {
      field: 'value',
      label: null,
      sentences: [
        ...numberSentences('rating'),
        // A rating of 0 is empty (must-not value > 0 / must value >= 1).
        s('empty', 'is empty', 'must-not', 'gt', 'none', { fixedValue: 0 }),
        s('not-empty', 'is not empty', 'must', 'gte', 'none', { fixedValue: 1 }),
      ],
    },
  ],
  pipeline: [
    {
      field: 'pipeline_stage_id',
      label: null,
      sentences: [
        s('contains', 'is', 'must', 'eq', 'stage'),
        s('not-contains', 'is not', 'must-not', 'eq', 'stage'),
        s('was', 'was', 'must', 'eq', 'stage', { history: true }),
        s('was-not', 'was not', 'must-not', 'eq', 'stage', { history: true }),
        EMPTY,
        NOT_EMPTY,
      ],
    },
    {
      field: 'lifecycle_phase',
      label: 'Lifecycle',
      sentences: [
        s('equals', 'is', 'must', 'eq', 'lifecycle'),
        s('not-equals', 'is not', 'must-not', 'eq', 'lifecycle'),
      ],
    },
  ],
  select: [
    {
      field: 'select_option_id',
      label: null,
      sentences: [
        s('contains', 'is', 'must', 'eq', 'option', { multiLabel: 'contains' }),
        s('not-contains', 'is not', 'must-not', 'eq', 'option', { multiLabel: 'does not contain' }),
        s('less-than', 'less than', 'must', 'lt', 'option', {
          field: 'option_sort_order',
          onlySystemTypes: ORDERED_SELECTS,
        }),
        s('greater-than', 'greater than', 'must', 'gt', 'option', {
          field: 'option_sort_order',
          onlySystemTypes: ORDERED_SELECTS,
        }),
        EMPTY,
        NOT_EMPTY,
      ],
    },
  ],
  'entity-reference': [
    {
      field: 'target_entity_instance_id',
      label: null,
      sentences: [
        ...reference('record', LIST_REFERENCES),
        s('is-type', 'is', 'must', 'eq', 'object', {
          field: 'target_entity_definition_id',
          onlySystemTypes: LIST_REFERENCES,
        }),
        s('is-not-type', 'is not', 'must-not', 'eq', 'object', {
          field: 'target_entity_definition_id',
          onlySystemTypes: LIST_REFERENCES,
        }),
      ],
    },
  ],
  'actor-reference': [
    { field: 'referenced_actor_id', label: null, sentences: reference('member') },
    {
      field: 'referenced_actor_type',
      label: 'Type',
      sentences: [
        s('is-type', 'is', 'must', 'eq', 'actor-type'),
        s('is-not-type', 'is not', 'must-not', 'eq', 'actor-type'),
      ],
    },
  ],
  location: [
    { field: 'locality', label: 'City', sentences: textSentences(FIELD_EMPTY, FIELD_NOT_EMPTY) },
    {
      field: 'region',
      label: 'State',
      sentences: textSentences(FIELD_EMPTY, FIELD_NOT_EMPTY).filter(
        (x) => x.id !== 'starts-with' && x.id !== 'ends-with',
      ),
    },
    { field: 'country_code', label: 'Country', sentences: identity('country') },
  ],
  domain: [{ field: 'normalized_domain', label: null, sentences: textSentences() }],
  'email-address': [
    { field: 'normalized_email_address', label: 'Email', sentences: textSentences() },
    {
      field: 'email_domain',
      label: 'Domain',
      sentences: textSentences().filter((x) => ['contains', 'not-contains', 'equals', 'not-equals'].includes(x.id)),
    },
  ],
  'phone-number': [
    { field: 'normalized_phone_number', label: 'Number', sentences: textSentences() },
    { field: 'country_code', label: 'Country', sentences: identity('country') },
  ],
  interaction: [
    {
      field: 'interacted_at',
      label: 'When',
      sentences: [
        s('less-than', 'before', 'must', 'lt', 'relative-date'),
        s('greater-than', 'after', 'must', 'gt', 'relative-date'),
        FIELD_EMPTY,
        FIELD_NOT_EMPTY,
      ],
    },
    { field: 'owner_membership_id', label: 'With', sentences: identity('member') },
  ],
  'personal-name': [
    { field: 'full_name', label: 'Full name', sentences: textSentences() },
    { field: 'first_name', label: 'First name', sentences: textSentences(FIELD_EMPTY, FIELD_NOT_EMPTY) },
    { field: 'last_name', label: 'Last name', sentences: textSentences(FIELD_EMPTY, FIELD_NOT_EMPTY) },
  ],
};

/** The attribute properties that decide which sentences are offered. */
export interface FilterableAttribute {
  type: AttributeType;
  isMultiselect?: boolean;
  systemAttributeType?: string | null;
}

/** The fields and sentences offered for one attribute (system-type restrictions applied). */
export function filterFieldsFor(attribute: FilterableAttribute): FilterField[] {
  const sys = attribute.systemAttributeType ?? null;
  return filterFieldsByType[attribute.type].map((f) => ({
    ...f,
    sentences: f.sentences.filter(
      (x) =>
        (!x.onlySystemTypes || (sys !== null && x.onlySystemTypes.includes(sys))) &&
        !(x.hiddenSystemTypes && sys !== null && x.hiddenSystemTypes.includes(sys)),
    ),
  }));
}

/** The label shown for a sentence on this attribute. */
export function sentenceLabel(sentence: FilterSentence, attribute: FilterableAttribute): string {
  return attribute.isMultiselect && sentence.multiLabel ? sentence.multiLabel : sentence.label;
}

const PRESENCE = new Set<FilterOperator>(['empty', 'not-empty']);

/** One sentence + value → one predicate leaf. `extra` adds constraints (status "was" dates on `active_from`). */
export function sentenceToLeaf(args: {
  path: Path;
  field: FilterField;
  sentence: FilterSentence;
  value?: unknown;
  valueType?: 'static' | 'dynamic';
  extra?: Constraint[];
}): PredicateLeaf {
  const { sentence } = args;
  const constraints: Constraint[] = [];
  if (sentence.operator) {
    const constraint: Constraint = { field: sentence.field ?? args.field.field, operator: sentence.operator };
    if (!PRESENCE.has(sentence.operator)) {
      constraint.value = 'fixedValue' in sentence ? sentence.fixedValue : args.value;
      constraint.valueType = 'fixedValue' in sentence ? 'static' : (args.valueType ?? 'static');
    }
    constraints.push(constraint);
  }
  constraints.push(...(args.extra ?? []));
  return { path: args.path, mode: sentence.mode, constraints, ...(sentence.history ? { history: true } : {}) };
}

/** Field used when a constraint names `value` or nothing. */
export const primaryFilterField: Record<AttributeType, string> = Object.fromEntries(
  Object.entries(filterFieldsByType).map(([type, fields]) => [type, fields[0]?.field ?? 'value']),
) as Record<AttributeType, string>;

const HISTORY_EXTRA = new Set(['active_from', 'active_until']);

/**
 * A leaf → the sentence that produces it (pills and the advanced editor render saved filters with this). null when
 * the leaf is not a sentence ("This condition cannot be displayed").
 */
export function leafToSentence(
  attribute: FilterableAttribute,
  leaf: PredicateLeaf,
): {
  field: FilterField;
  sentence: FilterSentence;
  value?: unknown;
  valueType: 'static' | 'dynamic';
  extra: Constraint[];
} | null {
  const constraints = leaf.constraints.filter((c) => !(c.field === 'active_until' && c.operator === 'empty'));
  const history = leaf.history === true;
  const main = history ? constraints.filter((c) => !HISTORY_EXTRA.has(c.field)) : constraints;
  const extra = history ? constraints.filter((c) => HISTORY_EXTRA.has(c.field)) : [];
  if (main.length > 1) return null;
  const c = main[0];
  const fieldName = (name: string) => (name === 'value' ? primaryFilterField[attribute.type] : name);
  for (const field of filterFieldsFor(attribute)) {
    for (const sentence of field.sentences) {
      if (sentence.mode !== leaf.mode || (sentence.history === true) !== history) continue;
      if (sentence.operator === null) {
        if (!c) return { field, sentence, valueType: 'static', extra };
        continue;
      }
      if (!c || c.operator !== sentence.operator) continue;
      if (fieldName(c.field) !== (sentence.field ?? field.field)) continue;
      if ('fixedValue' in sentence) {
        if (String(c.value) !== String(sentence.fixedValue)) continue;
        return { field, sentence, valueType: 'static', extra };
      }
      return { field, sentence, value: c.value, valueType: c.valueType ?? 'static', extra };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Relative dates (§4): stored as ISO-8601 durations with valueType 'dynamic', resolved by the server at query time.

export const relativeDatePresets = [
  { id: 'today', label: 'Today', timestampLabel: 'Now', value: 'P0D' },
  { id: 'tomorrow', label: 'Tomorrow', timestampLabel: 'This time tomorrow', value: 'P1D' },
  { id: 'yesterday', label: 'Yesterday', timestampLabel: 'This time yesterday', value: '-P1D' },
  { id: 'one-week-ago', label: 'One week ago', timestampLabel: 'One week ago', value: '-P7D' },
  { id: 'one-week-from-now', label: 'One week from now', timestampLabel: 'One week from now', value: 'P7D' },
  { id: 'one-month-ago', label: 'One month ago', timestampLabel: 'One month ago', value: '-P1M' },
  { id: 'one-month-from-now', label: 'One month from now', timestampLabel: 'One month from now', value: 'P1M' },
] as const;
export type RelativeDatePresetId = (typeof relativeDatePresets)[number]['id'];

/** "Number of days ago..." → '-P{n}D'. */
export const daysAgo = (n: number): string => `-P${Math.max(0, Math.trunc(n))}D`;
/** "Number of days from now..." → 'P{n}D'. */
export const daysFromNow = (n: number): string => `P${Math.max(0, Math.trunc(n))}D`;

const DURATION = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * A stored relative value → preset or "{n} days ago/from now" (stored as '-P0Y0M30DT0H0M0S'). null for other
 * durations.
 */
export function parseRelativeDate(
  value: string,
): { preset: RelativeDatePresetId } | { daysAgo: number } | { daysFromNow: number } | null {
  const m = DURATION.exec(value);
  if (!m || value === 'P' || value === '-P') return null;
  const [, neg, y, mo, w, d, h, mi, sec] = m;
  if (Number(h ?? 0) || Number(mi ?? 0) || Number(sec ?? 0) || Number(y ?? 0)) return null;
  const months = Number(mo ?? 0);
  const days = Number(w ?? 0) * 7 + Number(d ?? 0);
  const sign = neg ? -1 : 1;
  if (months !== 0) {
    if (days !== 0 || months !== 1) return null;
    return { preset: sign < 0 ? 'one-month-ago' : 'one-month-from-now' };
  }
  if (days === 0) return { preset: 'today' };
  if (days === 1) return { preset: sign < 0 ? 'yesterday' : 'tomorrow' };
  if (days === 7) return { preset: sign < 0 ? 'one-week-ago' : 'one-week-from-now' };
  return sign < 0 ? { daysAgo: days } : { daysFromNow: days };
}

// ---------------------------------------------------------------------------------------------------------------
// Sort fields (§7): relationships have none — the sort picker drills into the target object (path sort).

export interface SortField {
  readonly field: string;
  readonly label: string | null;
}

const one = (field: string): SortField[] => [{ field, label: null }];

export const sortFieldsByType: Record<AttributeType, readonly SortField[]> = {
  text: one('value'),
  number: one('value'),
  checkbox: one('value'),
  currency: one('raw_value'),
  date: one('value'),
  timestamp: one('value'),
  rating: one('value'),
  pipeline: [
    { field: 'stage_sort_order', label: 'Stage order' },
    { field: 'active_from', label: 'Active from' },
  ],
  select: one('option_sort_order'),
  'entity-reference': [],
  'actor-reference': one('referenced_actor_id'),
  location: [
    { field: 'locality', label: 'City' },
    { field: 'region', label: 'State' },
    { field: 'country_code', label: 'Country' },
  ],
  domain: one('normalized_domain'),
  'email-address': one('normalized_email_address'),
  'phone-number': one('normalized_phone_number'),
  interaction: [
    { field: 'interacted_at', label: 'When' },
    { field: 'owner_membership_id', label: 'With' },
  ],
  'personal-name': [
    { field: 'first_name', label: 'First name' },
    { field: 'last_name', label: 'Last name' },
    { field: 'full_name', label: 'Full name' },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Footer calculations (§8): the "Aggregations" menu per type; values are the stored column aggregation types.

export type ColumnAggregation =
  | 'count_empty'
  | 'count_not_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'mean'
  | 'max'
  | 'min';

export interface ColumnAggregationOption {
  readonly value: ColumnAggregation;
  /** Menu label. */
  readonly label: string;
  /** Grey suffix after the value in the footer ("12 filled", "€734,000.00 sum"). */
  readonly suffix: string;
}

const NUMERIC_TYPES: ReadonlySet<AttributeType> = new Set(['number', 'currency', 'rating']);

export function columnAggregationsFor(type: AttributeType): ColumnAggregationOption[] {
  const base: ColumnAggregationOption[] =
    type === 'checkbox'
      ? [
          { value: 'count_empty', label: 'Count not checked', suffix: 'not checked' },
          { value: 'count_not_empty', label: 'Count checked', suffix: 'checked' },
          { value: 'percent_empty', label: 'Percent not checked', suffix: 'not checked' },
          { value: 'percent_not_empty', label: 'Percent checked', suffix: 'checked' },
        ]
      : [
          { value: 'count_empty', label: 'Count empty', suffix: 'empty' },
          { value: 'count_not_empty', label: 'Count filled', suffix: 'filled' },
          { value: 'percent_empty', label: 'Percent empty', suffix: 'empty' },
          { value: 'percent_not_empty', label: 'Percent filled', suffix: 'filled' },
        ];
  if (!NUMERIC_TYPES.has(type)) return base;
  return [
    ...base,
    { value: 'sum', label: 'Sum', suffix: 'sum' },
    { value: 'mean', label: 'Average', suffix: 'avg' },
    { value: 'min', label: 'Min', suffix: 'min' },
    { value: 'max', label: 'Max', suffix: 'max' },
  ];
}
