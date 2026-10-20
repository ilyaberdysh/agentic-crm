// The views feature's per-type table, in ONE place: an adapter over the shared sentence table
// (packages/contracts/src/filter-sentences.ts — operators per type, sort fields; C1 filters-sorts-calcs §3, §7) plus
// the UI-only facts (type icons, column sub-fields, formatting kinds, menu labels) and the typed filter values the
// editors work with (dates, members, records, status "was").
//
// New server operators: add the sentence to filter-sentences.ts; pills, the advanced editor and the AST builder /
// parser pick it up. A new value editor kind needs one case in `encodeValue`/`decodeValue` below and one editor in
// components/valueEditors.tsx.

import type { AttributeDefinition } from '@agentic-crm/contracts';
import {
  type AttributeType,
  type Constraint,
  type FilterField,
  type FilterSentence,
  type FilterValueEditor,
  filterFieldsFor,
  leafToSentence,
  type Path,
  type PredicateLeaf,
  sentenceLabel,
  sentenceToLeaf,
  sortFieldsByType,
} from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';
import type { DateValue } from './relativeDates';

// ---- values -----------------------------------------------------------------------------------------------------

/** The editor a condition's value needs (contracts' FilterValueEditor, with status "was" split out). */
export type ValueKind =
  | 'none'
  | 'text'
  | 'number'
  | 'rating'
  | 'option'
  | 'status'
  | 'status-was'
  | 'lifecycle'
  | 'record'
  | 'object'
  | 'actor'
  | 'actor-type'
  | 'country'
  | 'date'
  | 'relative-date';

/** A record-reference value; the definition is optional (record ids are unique). */
export interface RecordValue {
  entityInstanceId: string;
  entityDefinitionId?: string | null;
}
/** An actor value: a member, or the dynamic "Current user" (`current-member`, C1 §4). */
export type ActorValue = { kind: 'member'; id: string } | { kind: 'current-member' };
/** Status "was": the stage, optionally entered before / after a date (history leaf, `active_from` lt / gt). */
export interface StatusWasValue {
  stageId: string;
  date: DateValue | null;
  dateOperator?: 'lt' | 'gt';
}

export const ACTOR_TYPES = [
  { id: 'workspace-member', label: 'Member' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'api-token', label: 'Integration' },
  { id: 'app', label: 'App' },
  { id: 'system', label: 'System' },
] as const;

export const LIFECYCLE_PHASES = [
  { id: 'ACTIVE', label: 'Active' },
  { id: 'WON', label: 'Won' },
  { id: 'LOST', label: 'Lost' },
] as const;

/** Sentence id within its filter field ('contains', 'equals', 'less-than', 'empty', 'was', …). */
export type OperatorId = string;

type AttrLike = Pick<AttributeDefinition, 'type' | 'isMultiselect' | 'systemAttributeType'>;

const KIND: Record<FilterValueEditor, ValueKind> = {
  none: 'none',
  text: 'text',
  number: 'number',
  rating: 'rating',
  option: 'option',
  stage: 'status',
  lifecycle: 'lifecycle',
  record: 'record',
  object: 'object',
  member: 'actor',
  'actor-type': 'actor-type',
  country: 'country',
  date: 'date',
  'relative-date': 'relative-date',
};

// Evidence C1/19 shows the presence sentences as "empty" / "not empty".
const MENU_LABELS: Record<string, string> = { 'is empty': 'empty', 'is not empty': 'not empty' };

// ---- the per-type UI table ---------------------------------------------------------------------------------------

export interface SubField {
  field: string;
  label: string;
}

interface TypeUi {
  icon: IconName;
  /** Column sub-fields: a location column always shows one of them (C1 §3.2). */
  columnFields?: readonly SubField[];
  /** Header / View settings "Formatting ›" (C1 §3.2). */
  formatting?: 'datetime' | 'number' | 'currency';
  /** Filter fields reached only through the drill-down chevron (status "Lifecycle", our extension). */
  secondaryFilterFields?: readonly string[];
}

const LOCATION_FIELDS: readonly SubField[] = [
  { field: 'locality', label: 'City' },
  { field: 'region', label: 'State' },
  { field: 'country_code', label: 'Country' },
];

export const TYPE_UI: Record<AttributeType, TypeUi> = {
  text: { icon: 'attrText' },
  number: { icon: 'attrNumber', formatting: 'number' },
  currency: { icon: 'attrCurrency', formatting: 'currency' },
  checkbox: { icon: 'attrCheckbox' },
  date: { icon: 'attrDate', formatting: 'datetime' },
  timestamp: { icon: 'attrTimestamp', formatting: 'datetime' },
  rating: { icon: 'attrRating' },
  pipeline: { icon: 'attrStatus', secondaryFilterFields: ['lifecycle_phase'] },
  select: { icon: 'attrSelect' },
  'entity-reference': { icon: 'attrRecord' },
  'actor-reference': { icon: 'attrActor' },
  location: { icon: 'attrLocation', columnFields: LOCATION_FIELDS },
  domain: { icon: 'attrDomain' },
  'email-address': { icon: 'attrEmail' },
  'phone-number': { icon: 'attrPhone' },
  interaction: { icon: 'attrInteraction', formatting: 'datetime' },
  'personal-name': { icon: 'attrPersonalName' },
};

/** Icon of an attribute in pickers, headers and pills (system attributes have their own). */
export function attributeIcon(attr: AttrLike): IconName {
  switch (attr.systemAttributeType) {
    case 'id':
      return 'attrNumber';
    case 'next-due-task':
      return 'tasks';
    case 'created-at':
      return 'attrTimestamp';
    case 'created-by':
      return 'attrActor';
  }
  if (attr.type === 'select' && attr.isMultiselect) return 'attrMultiSelect';
  return TYPE_UI[attr.type].icon;
}

export function formattingKind(attr: AttrLike): TypeUi['formatting'] {
  return TYPE_UI[attr.type].formatting;
}

export function columnFields(attr: AttrLike): readonly SubField[] {
  return TYPE_UI[attr.type].columnFields ?? [];
}

// ---- filters ------------------------------------------------------------------------------------------------------

export function filterFields(attr: AttrLike): FilterField[] {
  return filterFieldsFor(attr).filter((f) => f.sentences.length > 0);
}

/** Fields the picker offers as a sub-menu (secondary fields only through the chevron). */
export function primaryFilterFields(attr: AttrLike): FilterField[] {
  const secondary = TYPE_UI[attr.type].secondaryFilterFields ?? [];
  return filterFields(attr).filter((f) => !secondary.includes(f.field));
}

/** The filter field of a condition (null / unknown → the first field). */
export function filterField(attr: AttrLike, field: string | null | undefined): FilterField {
  const fields = filterFields(attr);
  return fields.find((f) => f.field === field) ?? (fields[0] as FilterField);
}

function sentenceOf(attr: AttrLike, field: string | null | undefined, id: OperatorId | null): FilterSentence | null {
  if (!id) return null;
  return filterField(attr, field).sentences.find((s) => s.id === id) ?? null;
}

export interface OperatorOption {
  id: OperatorId;
  label: string;
}

export function operatorLabel(attr: AttrLike, field: string | null | undefined, id: OperatorId): string {
  const sentence = sentenceOf(attr, field, id);
  if (!sentence) return id;
  const label = sentenceLabel(sentence, attr);
  return MENU_LABELS[label] ?? label;
}

/** Operators ("Select condition" menu) for an attribute's field, in table order. */
export function operatorsFor(attr: AttrLike, field: string | null | undefined): OperatorOption[] {
  return filterField(attr, field).sentences.map((s) => ({ id: s.id, label: operatorLabel(attr, field, s.id) }));
}

export function valueKindFor(attr: AttrLike, field: string | null | undefined, id: OperatorId | null): ValueKind {
  const sentence = sentenceOf(attr, field, id);
  if (!sentence) return 'none';
  if ('fixedValue' in sentence) return 'none';
  if (sentence.history) return 'status-was';
  return KIND[sentence.editor];
}

/** Typed editor value → constraint value (+ extra constraints); null when incomplete. */
function encodeValue(
  kind: ValueKind,
  value: unknown,
): { value: unknown; valueType: 'static' | 'dynamic'; extra?: Constraint[] } | null {
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  switch (kind) {
    case 'none':
      return { value: undefined, valueType: 'static' };
    case 'text':
    case 'option':
    case 'status':
    case 'lifecycle':
    case 'object':
    case 'actor-type': {
      const v = str(value);
      return v === null ? null : { value: v, valueType: 'static' };
    }
    case 'number':
    case 'rating':
      return typeof value === 'number' && Number.isFinite(value) ? { value, valueType: 'static' } : null;
    case 'country': {
      const v = str(value);
      return v && /^[A-Za-z]{2}$/.test(v) ? { value: v.toUpperCase(), valueType: 'static' } : null;
    }
    case 'record': {
      const v = value as RecordValue | null | undefined;
      return v?.entityInstanceId ? { value: v.entityInstanceId, valueType: 'static' } : null;
    }
    case 'actor': {
      const v = value as ActorValue | null | undefined;
      if (!v) return null;
      if (v.kind === 'current-member') return { value: 'current-member', valueType: 'dynamic' };
      return v.id ? { value: v.id, valueType: 'static' } : null;
    }
    case 'date':
    case 'relative-date': {
      const v = value as DateValue | null | undefined;
      if (!v) return null;
      if (v.kind === 'relative') return v.duration ? { value: v.duration, valueType: 'dynamic' } : null;
      return /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? { value: v.date, valueType: 'static' } : null;
    }
    case 'status-was': {
      const v = value as StatusWasValue | null | undefined;
      if (!v?.stageId) return null;
      const date = v.date ? encodeValue('relative-date', v.date) : null;
      return {
        value: v.stageId,
        valueType: 'static',
        extra: date
          ? [{ field: 'active_from', operator: v.dateOperator ?? 'lt', value: date.value, valueType: date.valueType }]
          : [],
      };
    }
  }
}

function dateFrom(value: unknown, valueType: 'static' | 'dynamic'): DateValue {
  const s = String(value);
  if (valueType === 'dynamic') return { kind: 'relative', duration: s };
  return { kind: 'exact', date: s.slice(0, 10) };
}

function decodeValue(kind: ValueKind, value: unknown, valueType: 'static' | 'dynamic', extra: Constraint[]): unknown {
  switch (kind) {
    case 'none':
      return undefined;
    case 'number':
    case 'rating':
      return typeof value === 'number' ? value : Number(value);
    case 'country':
      return String(value).toUpperCase();
    case 'record':
      return { entityInstanceId: String(value) } satisfies RecordValue;
    case 'actor':
      return valueType === 'dynamic' && value === 'current-member'
        ? ({ kind: 'current-member' } satisfies ActorValue)
        : ({ kind: 'member', id: String(value) } satisfies ActorValue);
    case 'date':
    case 'relative-date':
      return dateFrom(value, valueType);
    case 'status-was': {
      const date = extra.find((c) => c.field === 'active_from' && (c.operator === 'lt' || c.operator === 'gt'));
      return {
        stageId: String(value),
        date: date ? dateFrom(date.value, date.valueType ?? 'static') : null,
        ...(date ? { dateOperator: date.operator as 'lt' | 'gt' } : {}),
      } satisfies StatusWasValue;
    }
    default:
      return String(value);
  }
}

/** The predicate leaf of a condition, or null while it is incomplete. */
export function buildLeaf(
  attr: AttrLike,
  path: Path,
  field: string | null | undefined,
  operator: OperatorId,
  value: unknown,
): PredicateLeaf | null {
  const ff = filterField(attr, field);
  const sentence = ff.sentences.find((s) => s.id === operator);
  if (!sentence) return null;
  const kind = valueKindFor(attr, ff.field, operator);
  const encoded = encodeValue(kind, value);
  if (!encoded) return null;
  return sentenceToLeaf({
    path,
    field: ff,
    sentence,
    ...(kind === 'none' ? {} : { value: encoded.value, valueType: encoded.valueType }),
    ...(encoded.extra?.length ? { extra: encoded.extra } : {}),
  });
}

export function isValueComplete(
  attr: AttrLike,
  field: string | null | undefined,
  operator: OperatorId,
  value: unknown,
) {
  return buildLeaf(attr, [], field, operator, value) !== null;
}

/**
 * Parses a leaf back into (field, operator, value); null when no sentence encodes it ("This condition cannot be
 * displayed").
 */
export function matchLeaf(
  attr: AttrLike,
  leaf: PredicateLeaf,
): { field: string; operator: OperatorId; value: unknown } | null {
  const hit = leafToSentence(attr, leaf);
  if (!hit) return null;
  const kind = hit.sentence.history ? 'status-was' : 'fixedValue' in hit.sentence ? 'none' : KIND[hit.sentence.editor];
  return {
    field: hit.field.field,
    operator: hit.sentence.id,
    value: decodeValue(kind, hit.value, hit.valueType, hit.extra),
  };
}

// ---- sorts --------------------------------------------------------------------------------------------------------

export function sortFields(attr: AttrLike): readonly SubField[] {
  return sortFieldsByType[attr.type].map((f) => ({ field: f.field, label: f.label ?? '' }));
}

/** Whether an attribute sorts directly (record references sort through a drilled-in attribute). */
export function isSortable(attr: AttrLike): boolean {
  return sortFieldsByType[attr.type].length > 0;
}

/** The sort field for a column (its sub-field when it has one, else the type's first sort field). */
export function defaultSortField(attr: AttrLike, columnField?: string | null): string | undefined {
  const fields = sortFieldsByType[attr.type];
  if (columnField && fields.some((f) => f.field === columnField)) return columnField;
  return fields[0]?.field;
}

/** Label of a sort / column / filter sub-field ("Stage order", "City"); '' when the field is the attribute itself. */
export function subFieldLabel(attr: AttrLike, field: string | null | undefined, purpose: 'sort' | 'column' | 'filter') {
  if (!field) return '';
  const lists: (readonly { field: string; label: string | null }[])[] =
    purpose === 'sort'
      ? [sortFieldsByType[attr.type]]
      : purpose === 'column'
        ? [columnFields(attr)]
        : [filterFields(attr)];
  for (const list of lists) {
    const hit = list.find((f) => f.field === field);
    if (hit) return hit.label ?? '';
  }
  return filterFields(attr).find((f) => f.field === field)?.label ?? '';
}

/** First operator of a field (the advanced editor's "Add filter" pre-selects it, §2). */
export function firstOperatorOf(attr: AttrLike, field: string | null | undefined): OperatorId | null {
  return filterField(attr, field).sentences[0]?.id ?? null;
}
