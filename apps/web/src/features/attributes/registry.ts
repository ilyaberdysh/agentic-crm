// Attribute registry —  contract C1. One entry per
// internal attribute type: read View (densities cell / field / chip), Editor, editor kind, clipboard text, single-cell
// paste, default column width and alignment. TABLE, ADMIN and later the record page consume it.
import type { FC } from 'react';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { cacheLookup } from './data/queries';
import { DateEditor, TimestampEditor } from './editors/date';
import {
  CheckboxEditor,
  CurrencyEditor,
  LocationEditor,
  NumberEditor,
  PersonalNameEditor,
  RatingEditor,
  ReadonlyEditor,
  TextEditor,
} from './editors/inline';
import { DomainEditor, EmailEditor, PhoneEditor } from './editors/lists';
import { ActorReferenceEditor, RecordReferenceEditor, SelectEditor, StatusEditor } from './editors/pickers';
import {
  currencyCodeOf,
  currencyOptions,
  type FormatValueOptions,
  formatCurrency,
  formatNumber,
  formatOne,
  formatPercent,
  formatValue as formatValueWith,
  numberOptions,
  todayIso,
} from './format/formatValue';
import { getFormatSettings } from './format/locale';
import type {
  AttributeDefinition,
  AttributeType,
  AttributeUi,
  AttributeValue,
  EditorKind,
  EditorProps,
  Member,
  PipelineStage,
  SelectOption,
  ViewProps,
} from './types';
import { copyTextOf, pasteValueOf } from './values/clipboard';
import { read } from './values/shapes';
import {
  ActorReferenceView,
  CheckboxView,
  CurrencyView,
  DateView,
  DomainView,
  EmailView,
  InteractionView,
  LocationView,
  NumberView,
  PersonalNameView,
  PhoneView,
  RatingView,
  RecordReferenceView,
  SelectView,
  StatusView,
  TextView,
  TimestampView,
} from './views/views';

export { MemberPicker, RecordPicker } from './editors/pickers';
export { NewRecordDialog } from './NewRecordDialog';
export type { AttributeType, AttributeUi } from './types';
export { ValueHistoryPopover } from './ValueHistoryPopover';
export { overlayValues, useAttributeWrite } from './write/useAttributeWrite';

function pasteContext(attribute: AttributeDefinition) {
  const ws = attribute.workspaceId;
  const optionsKey = keys.options(ws, attribute.entityDefinitionId, attribute.id);
  const settings = getFormatSettings();
  return {
    settings,
    today: todayIso(new Date(), settings),
    options: queryClient.getQueryData<SelectOption[]>(optionsKey),
    stages: queryClient.getQueryData<PipelineStage[]>([...optionsKey, 'stages']),
    members: queryClient.getQueryData<Member[]>(keys.members(ws)),
  };
}

function entry(
  type: AttributeType,
  View: FC<ViewProps>,
  Editor: FC<EditorProps>,
  editorKind: EditorKind,
  defaultWidth = 180,
  align: 'start' | 'end' = 'start',
): AttributeUi {
  return {
    type,
    View,
    Editor,
    editorKind,
    defaultWidth,
    align,
    copyText: (values, attribute, options) =>
      copyTextOf(attribute, values, cacheLookup(attribute.workspaceId), options?.field),
    pasteValue:
      editorKind === 'readonly'
        ? undefined
        : (text, attribute) => pasteValueOf(attribute, text, pasteContext(attribute)),
  };
}

/** Default column widths per: 180 default, 200 timestamp, 100 checkbox, 140 rating. */
const registry: Record<AttributeType, AttributeUi> = {
  text: entry('text', TextView, TextEditor, 'inline'),
  number: entry('number', NumberView, NumberEditor, 'inline', 180, 'end'),
  checkbox: entry('checkbox', CheckboxView, CheckboxEditor, 'inline', 100),
  currency: entry('currency', CurrencyView, CurrencyEditor, 'inline', 180, 'end'),
  date: entry('date', DateView, DateEditor, 'popover'),
  timestamp: entry('timestamp', TimestampView, TimestampEditor, 'popover', 200),
  rating: entry('rating', RatingView, RatingEditor, 'inline', 140),
  pipeline: entry('pipeline', StatusView, StatusEditor, 'popover'),
  select: entry('select', SelectView, SelectEditor, 'popover'),
  'entity-reference': entry('entity-reference', RecordReferenceView, RecordReferenceEditor, 'popover'),
  'actor-reference': entry('actor-reference', ActorReferenceView, ActorReferenceEditor, 'popover'),
  location: entry('location', LocationView, LocationEditor, 'inline'),
  domain: entry('domain', DomainView, DomainEditor, 'popover'),
  'email-address': entry('email-address', EmailView, EmailEditor, 'popover'),
  'phone-number': entry('phone-number', PhoneView, PhoneEditor, 'popover'),
  interaction: entry('interaction', InteractionView, ReadonlyEditor, 'readonly'),
  'personal-name': entry('personal-name', PersonalNameView, PersonalNameEditor, 'inline'),
};

export function getAttributeUi(type: AttributeType): AttributeUi {
  return registry[type];
}

/** Record column width (the first, sticky column). */
export const RECORD_COLUMN_WIDTH = 250;

/** Whether values of the attribute can be edited in place (read-only system and computed attributes cannot). */
export function isAttributeEditable(attribute: AttributeDefinition): boolean {
  return !attribute.isReadOnly && !attribute.isArchived && registry[attribute.type].editorKind !== 'readonly';
}

/** Default width of an attribute column (timestamp system attributes such as Created at included). */
export function defaultColumnWidth(attribute: Pick<AttributeDefinition, 'type'>): number {
  return registry[attribute.type].defaultWidth;
}

export interface FormatScalarOptions extends FormatValueOptions {
  /** Format a bare number as a number / currency amount / percentage (0-100), e.g. footer aggregates. */
  style?: 'number' | 'currency' | 'percent';
  /** Currency of a bare amount (default: the stored code, then the attribute's default currency). */
  currencyCode?: string | null;
}

type FormatTarget = Pick<AttributeDefinition, 'type' | 'config'> & Partial<AttributeDefinition>;

function isRowList(v: unknown): v is readonly AttributeValue[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && 'attributeDefinitionId' in x);
}

/**
 * Plain text of an attribute value (B.25 + X-11: one locale for cells, fields and footers; the rule is documented in
 * format/locale.ts). Takes either the value rows of a cell (current values joined with ", ") or one bare read value
 * (`formatValue(attribute, 250000, {style: 'currency'})`, a footer aggregate, an ISO date from `valueText`). Option,
 * stage, member and record titles come from the query cache unless `options.lookup` is set.
 */
export function formatValue(
  attribute: FormatTarget,
  valuesOrValue: readonly AttributeValue[] | unknown,
  options: FormatScalarOptions = {},
): string {
  const full = attribute as AttributeDefinition;
  const lookup = options.lookup ?? (attribute.workspaceId ? cacheLookup(attribute.workspaceId) : undefined);
  if (isRowList(valuesOrValue)) return formatValueWith(full, valuesOrValue, { ...options, lookup });
  const value = valuesOrValue;
  if (value === null || value === undefined) return '';
  const settings = options.settings ?? getFormatSettings();
  if (options.style === 'percent' && typeof value === 'number') return formatPercent(value, settings);
  if (options.style === 'number' && typeof value === 'number')
    return formatNumber(value, numberOptions(full, options.format), settings);
  if (options.style === 'currency' || (attribute.type === 'currency' && typeof value === 'number')) {
    const amount = typeof value === 'number' ? value : read.currency(value)?.currencyValue;
    if (amount === undefined) return '';
    const stored = typeof value === 'number' ? null : read.currency(value)?.currencyCode;
    return formatCurrency(
      amount,
      options.currencyCode ?? currencyCodeOf(full, stored),
      currencyOptions(full, options.format),
      settings,
    );
  }
  return formatOne(full, value, { ...options, lookup });
}
