// Create/edit attribute form logic (J attribute-dialogs §2–7), kept free of React so it is unit-tested:
// the form state per picker type, validation, the create input (one PUT: relationship pair, options and stages
// inline), the edit diff (one attribute PATCH + option/stage writes), relationship cardinality ↔ is_multiselect
// flags, "time in status" durations and default-value encoding (static JSON arrays of write forms, A §4.6).
import {
  type AttributeDefinition,
  type CreateAttributeInput,
  type DefaultValue,
  type PipelineStage,
  rankBetween,
  type SelectOption,
  type UpdateAttributeInput,
} from '@agentic-crm/contracts';
import {
  type AiAutofillState,
  aiConfigInput,
  aiStateError,
  initialAiState,
  isAiCapable,
  sameAiState,
} from '../../../ai-attributes';
import { type FormulaDraft, formulaConfigurationInput, sameDraft } from '../../../formulas';
import { constraintsFor, hasAiAutofillCard, type PickerType, pickerEntry, pickerTypeOf } from './typeCatalog';

// ---- relationship cardinality ----------------------------------------------------------------------------------

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export const CARDINALITIES: ReadonlyArray<{
  id: Cardinality;
  label: string;
  description: string;
  example: [string, string];
}> = [
  {
    id: 'one-to-many',
    label: 'One to many',
    description:
      'Connects a single reference of your object to multiple references of another object (e.g. One sales person has many leads)',
    example: ['Sales person', 'Leads'],
  },
  {
    id: 'one-to-one',
    label: 'One to one',
    description:
      'Connects a single reference of your object to a single reference of another object (e.g. One company has one CEO)',
    example: ['Company', 'CEO'],
  },
  {
    id: 'many-to-one',
    label: 'Many to one',
    description:
      'Connects multiple references of your object to a single reference of another object (e.g. Many deals connected to one company)',
    example: ['Deals', 'Company'],
  },
  {
    id: 'many-to-many',
    label: 'Many to many',
    description:
      'Connects multiple references of your object to multiple references of another object (e.g. Many customers to many products)',
    example: ['Customers', 'Products'],
  },
];

/** J attribute-dialogs §6: this side is multi for One-to-many / Many-to-many, the other for Many-to-one / Many-to-many. */
export function cardinalityFlags(c: Cardinality): { thisMulti: boolean; otherMulti: boolean } {
  return {
    thisMulti: c === 'one-to-many' || c === 'many-to-many',
    otherMulti: c === 'many-to-one' || c === 'many-to-many',
  };
}

export function cardinalityOf(thisMulti: boolean, otherMulti: boolean): Cardinality {
  if (thisMulti && otherMulti) return 'many-to-many';
  if (thisMulti) return 'one-to-many';
  if (otherMulti) return 'many-to-one';
  return 'one-to-one';
}

// ---- time in status ------------------------------------------------------------------------------------------

export type DurationUnit = 'days' | 'months' | 'years';
export interface TargetTime {
  amount: string;
  unit: DurationUnit;
}

/** 7 days → `P0Y0M7DT0H0M0S` (the observed request form); empty amount → null ("Unlimited"). */
export function encodeTargetTime(t: TargetTime): string | null {
  const n = Number.parseInt(t.amount, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const y = t.unit === 'years' ? n : 0;
  const m = t.unit === 'months' ? n : 0;
  const d = t.unit === 'days' ? n : 0;
  return `P${y}Y${m}M${d}DT0H0M0S`;
}

export function decodeTargetTime(iso: string | null | undefined): TargetTime {
  if (!iso) return { amount: '', unit: 'days' };
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?/.exec(iso);
  if (!m) return { amount: '', unit: 'days' };
  const [y, mo, w, d] = [m[1], m[2], m[3], m[4]].map((v) => Number(v ?? 0)) as [number, number, number, number];
  if (d || w) return { amount: String(d + w * 7), unit: 'days' };
  if (mo) return { amount: String(mo), unit: 'months' };
  if (y) return { amount: String(y), unit: 'years' };
  return { amount: '', unit: 'days' };
}

// ---- default values ------------------------------------------------------------------------------------------

export function encodeStatic(values: unknown[]): DefaultValue | null {
  return values.length > 0 ? { type: 'static', identifier: JSON.stringify(values) } : null;
}

export function decodeStatic(dv: DefaultValue | null | undefined): unknown[] {
  if (!dv || dv.type !== 'static') return [];
  try {
    const parsed = JSON.parse(dv.identifier) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Relative presets of the date/timestamp default menu (dynamic ISO-8601 durations). */
export const RELATIVE_DATE_PRESETS: ReadonlyArray<{ duration: string; label: string }> = [
  { duration: '-P1D', label: '1 day before' },
  { duration: 'PT0S', label: 'Same day' },
  { duration: 'P1D', label: '1 day after' },
  { duration: 'P7D', label: '1 week after' },
  { duration: 'P14D', label: '2 weeks after' },
  { duration: 'P1M', label: '1 month after' },
  { duration: 'P3M', label: '3 months after' },
];

/** Option / stage ids a static default refers to. */
function referencedIds(dv: DefaultValue | null, key: 'selectOptionId' | 'pipelineStageId'): string[] {
  return decodeStatic(dv)
    .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined))
    .filter((v): v is string => typeof v === 'string');
}

// ---- options and stages --------------------------------------------------------------------------------------

export interface OptionDraft {
  id: string;
  title: string;
  color: string;
  /** Created in this dialog (no server row yet). */
  isNew: boolean;
}

export interface StageDraft extends OptionDraft {
  celebrationEnabled: boolean;
  targetTime: TargetTime;
}

/** New options get the first colour not used yet, rotating once all are taken (observed: green, blue, …). */
const OPTION_COLOR_ROTATION = [
  'pastel_green',
  'pastel_blue',
  'pastel_orange',
  'pastel_teal',
  'pastel_red',
  'pastel_purple',
  'pastel_yellow',
  'pastel_magenta',
  'pastel_violet',
  'pastel_light-green',
  'pastel_brown',
  'pastel_grey',
] as const;
const STAGE_COLOR_ROTATION = [
  'block_red',
  'block_teal',
  'block_orange',
  'block_green',
  'block_blue',
  'block_purple',
  'block_yellow',
  'block_magenta',
  'block_violet',
  'block_light-green',
  'block_brown',
  'block_grey',
  'block_light-grey',
] as const;

export function nextColor(kind: 'option' | 'stage', used: readonly string[]): string {
  const rotation: readonly string[] = kind === 'option' ? OPTION_COLOR_ROTATION : STAGE_COLOR_ROTATION;
  return rotation.find((c) => !used.includes(c)) ?? (rotation[used.length % rotation.length] as string);
}

/** Per-row errors: "Stage name is required" / "This name is already in use" (J attribute-dialogs §5). */
export function optionErrors(drafts: readonly OptionDraft[], kind: 'option' | 'stage'): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  for (const d of drafts) {
    const key = d.title.trim().toLowerCase();
    if (!key) errors[d.id] = kind === 'stage' ? 'Stage name is required' : 'Option name is required';
    else if (seen.has(key)) errors[d.id] = 'This name is already in use';
    seen.add(key);
  }
  return errors;
}

/**
 * Ranks for a reordered list: items on the longest run that is already in rank order keep their rank (so a drag
 * writes only the moved item, X-01); the others — moved or new — get ranks between their neighbours.
 */
export function rerank(items: ReadonlyArray<{ id: string; rank: string | null }>): Map<string, string> {
  const n = items.length;
  // Longest strictly increasing subsequence over existing ranks (O(n²); option lists are small).
  const len = new Array<number>(n).fill(0);
  const prev = new Array<number>(n).fill(-1);
  let best = -1;
  for (let i = 0; i < n; i++) {
    const ri = items[i]?.rank;
    if (ri == null) continue;
    len[i] = 1;
    for (let j = 0; j < i; j++) {
      const rj = items[j]?.rank;
      if (rj != null && rj < ri && (len[j] ?? 0) + 1 > (len[i] ?? 0)) {
        len[i] = (len[j] ?? 0) + 1;
        prev[i] = j;
      }
    }
    if (best === -1 || (len[i] ?? 0) > (len[best] ?? 0)) best = i;
  }
  const kept = new Set<number>();
  for (let i = best; i !== -1; i = prev[i] ?? -1) kept.add(i);

  const out = new Map<string, string>();
  let last: string | null = null;
  for (let i = 0; i < n; i++) {
    const item = items[i] as { id: string; rank: string | null };
    if (kept.has(i)) {
      last = item.rank;
      continue;
    }
    let next: string | null = null;
    for (let j = i + 1; j < n; j++) {
      if (kept.has(j)) {
        next = items[j]?.rank ?? null;
        break;
      }
    }
    const rank = rankBetween(last, next);
    out.set(item.id, rank);
    last = rank;
  }
  return out;
}

export interface ListDiff<T> {
  create: Array<T & { sortOrder: string }>;
  update: Array<{ id: string; title?: string; color?: string; sortOrder?: string; extra?: Partial<T> }>;
  archive: string[];
}

function diffList<T extends OptionDraft>(
  original: ReadonlyArray<{ id: string; title: string; color: string; sortOrder: string }>,
  drafts: readonly T[],
  extraChanges: (draft: T, orig: { id: string }) => Partial<T> | undefined,
): ListDiff<T> {
  const byId = new Map(original.map((o) => [o.id, o]));
  const draftIds = new Set(drafts.map((d) => d.id));
  const ranks = rerank(drafts.map((d) => ({ id: d.id, rank: byId.get(d.id)?.sortOrder ?? null })));
  const diff: ListDiff<T> = { create: [], update: [], archive: [] };
  for (const o of original) if (!draftIds.has(o.id)) diff.archive.push(o.id);
  for (const d of drafts) {
    const orig = byId.get(d.id);
    const rank = ranks.get(d.id);
    if (!orig) {
      diff.create.push({ ...d, title: d.title.trim(), sortOrder: rank ?? rankBetween(null, null) });
      continue;
    }
    const change: ListDiff<T>['update'][number] = { id: d.id };
    if (d.title.trim() !== orig.title) change.title = d.title.trim();
    if (d.color !== orig.color) change.color = d.color;
    if (rank) change.sortOrder = rank;
    const extra = extraChanges(d, orig);
    if (extra && Object.keys(extra).length > 0) change.extra = extra;
    if (Object.keys(change).length > 1) diff.update.push(change);
  }
  return diff;
}

export function diffOptions(original: readonly SelectOption[], drafts: readonly OptionDraft[]): ListDiff<OptionDraft> {
  return diffList(original, drafts, () => undefined);
}

export function diffStages(original: readonly PipelineStage[], drafts: readonly StageDraft[]): ListDiff<StageDraft> {
  const byId = new Map(original.map((s) => [s.id, s]));
  return diffList(original, drafts, (d) => {
    const orig = byId.get(d.id);
    if (!orig) return undefined;
    const extra: Partial<StageDraft> = {};
    if (d.celebrationEnabled !== orig.celebrationEnabled) extra.celebrationEnabled = d.celebrationEnabled;
    if (encodeTargetTime(d.targetTime) !== (orig.targetTimeInStatus ?? null)) extra.targetTime = d.targetTime;
    return extra;
  });
}

export function optionDraftsOf(options: readonly SelectOption[]): OptionDraft[] {
  return options.filter((o) => !o.isArchived).map((o) => ({ id: o.id, title: o.title, color: o.color, isNew: false }));
}

export function stageDraftsOf(stages: readonly PipelineStage[]): StageDraft[] {
  return stages
    .filter((s) => !s.isArchived)
    .map((s) => ({
      id: s.id,
      title: s.title,
      color: s.color,
      isNew: false,
      celebrationEnabled: s.celebrationEnabled,
      targetTime: decodeTargetTime(s.targetTimeInStatus),
    }));
}

// ---- form state ----------------------------------------------------------------------------------------------

export type CurrencyDisplay = 'code' | 'name' | 'narrowSymbol' | 'symbol';

export interface AttributeFormState {
  pickerType: PickerType;
  title: string;
  description: string;
  isRequired: boolean;
  isUnique: boolean;
  isMultiselect: boolean;
  /** '' = automatic (null); otherwise 0–4. */
  decimalPlaces: string;
  numberGroups: 'default' | 'no-groups';
  currencyCode: string;
  currencyDisplay: CurrencyDisplay;
  currencyDecimals: 'two-decimals' | 'no-decimals';
  currencyGroups: 'default' | 'no-groups';
  allowedObjectIds: string[];
  options: OptionDraft[];
  stages: StageDraft[];
  defaultValue: DefaultValue | null;
  relationship: {
    targetObjectId: string | null;
    cardinality: Cardinality;
    /** Name of the attribute on this object (left card). */
    thisTitle: string;
    /** Name of the reverse attribute on the other object (right card). */
    otherTitle: string;
  };
  /** Formula: the saved editor draft (null until "Create formula" was saved). */
  formula: FormulaDraft | null;
  /** AI autofill card (AI-capable types). */
  aiAutofill: AiAutofillState;
}

export function initialFormState(pickerType: PickerType = 'text', defaultTargetObjectId: string | null = null) {
  return {
    pickerType,
    title: '',
    description: '',
    isRequired: false,
    isUnique: false,
    isMultiselect: false,
    decimalPlaces: '',
    numberGroups: 'default',
    currencyCode: 'USD',
    // The create form defaults Display to "Code" (observed `s12-dlg-currency`).
    currencyDisplay: 'code',
    currencyDecimals: 'two-decimals',
    currencyGroups: 'default',
    allowedObjectIds: [],
    options: [],
    stages: [],
    defaultValue: null,
    relationship: { targetObjectId: defaultTargetObjectId, cardinality: 'one-to-one', thisTitle: '', otherTitle: '' },
    formula: null,
    aiAutofill: initialAiState(isAiCapable(pickerType) ? pickerType : null),
  } satisfies AttributeFormState as AttributeFormState;
}

/** Switching the type in an open dialog keeps name and description and resets type-specific parts. */
export function withPickerType(state: AttributeFormState, pickerType: PickerType): AttributeFormState {
  const base = initialFormState(pickerType, state.relationship.targetObjectId);
  return { ...base, title: state.title, description: state.description };
}

/** Edit dialog: the state of an existing attribute (its options/stages loaded separately). */
export function formStateOf(
  attr: AttributeDefinition,
  extras: {
    options?: readonly SelectOption[];
    stages?: readonly PipelineStage[];
    reverse?: AttributeDefinition | null;
    formula?: FormulaDraft | null;
  },
): AttributeFormState {
  const pickerType = pickerTypeOf(attr) ?? 'text';
  const s = initialFormState(pickerType, attr.relationship?.relatedEntityDefinitionId ?? null);
  const n = attr.config.numberConfiguration;
  const c = attr.config.currencyConfiguration;
  return {
    ...s,
    title: attr.title,
    description: attr.description,
    isRequired: attr.isRequired,
    isUnique: attr.isUnique,
    isMultiselect: attr.isMultiselect,
    decimalPlaces: n?.defaultDecimalPlaces == null ? '' : String(n.defaultDecimalPlaces),
    numberGroups: n?.defaultGroups ?? 'default',
    currencyCode: c?.defaultCurrencyCode ?? 'USD',
    currencyDisplay: c?.defaultDisplayType ?? 'symbol',
    currencyDecimals: c?.defaultDecimalPlaces ?? 'two-decimals',
    currencyGroups: c?.defaultGroups ?? 'default',
    allowedObjectIds: attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? [],
    options: extras.options ? optionDraftsOf(extras.options) : [],
    stages: extras.stages ? stageDraftsOf(extras.stages) : [],
    defaultValue: attr.defaultValue,
    relationship: {
      targetObjectId: attr.relationship?.relatedEntityDefinitionId ?? null,
      cardinality: cardinalityOf(attr.isMultiselect, extras.reverse?.isMultiselect ?? false),
      thisTitle: attr.title,
      otherTitle: extras.reverse?.title ?? '',
    },
    formula: extras.formula ?? null,
    aiAutofill: attr.aiAutofillConfiguration
      ? {
          enabled: attr.aiAutofillConfiguration.isEnabled,
          type: attr.aiAutofillConfiguration.type,
          prompt: attr.aiAutofillConfiguration.prompt,
          allowNewOptions: attr.aiAutofillConfiguration.isOptionCreationEnabled,
        }
      : s.aiAutofill,
  };
}

// ---- validation ----------------------------------------------------------------------------------------------

export interface FormErrors {
  title?: true;
  decimalPlaces?: string;
  thisTitle?: true;
  otherTitle?: true;
  targetObject?: true;
  options?: Record<string, string>;
  stages?: Record<string, string>;
  aiAutofill?: string;
}

export function validateForm(state: AttributeFormState): FormErrors {
  const errors: FormErrors = {};
  if (state.pickerType === 'relationship') {
    if (!state.relationship.thisTitle.trim()) errors.thisTitle = true;
    if (!state.relationship.otherTitle.trim()) errors.otherTitle = true;
    if (!state.relationship.targetObjectId) errors.targetObject = true;
    return errors;
  }
  if (!state.title.trim()) errors.title = true;
  if (state.pickerType === 'number' && state.decimalPlaces.trim() !== '') {
    const v = Number(state.decimalPlaces);
    if (!Number.isInteger(v) || v < 0 || v > 4) errors.decimalPlaces = 'Enter a value between 0 and 4';
  }
  if (state.pickerType === 'select' || state.pickerType === 'multi-select') {
    const o = optionErrors(state.options, 'option');
    if (Object.keys(o).length) errors.options = o;
  }
  if (state.pickerType === 'status') {
    const o = optionErrors(state.stages, 'stage');
    if (Object.keys(o).length) errors.stages = o;
  }
  const ai = aiActive(state) ? aiStateError(state.aiAutofill) : null;
  if (ai) errors.aiAutofill = ai;
  return errors;
}

/** AI autofill applies: an AI-capable type with the card switched on. */
export function aiActive(state: AttributeFormState): boolean {
  return hasAiAutofillCard(state.pickerType) && state.aiAutofill.enabled;
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Formula needs a formula before it can be created (submit disabled; J attribute-dialogs §2). */
export function canSubmit(state: AttributeFormState): boolean {
  return state.pickerType !== 'formula' || state.formula !== null;
}

// ---- inputs --------------------------------------------------------------------------------------------------

/** Drops a default that points at options/stages removed in the editor (the PATCH then sends null). */
export function prunedDefault(state: AttributeFormState): DefaultValue | null {
  const dv = state.defaultValue;
  if (!dv) return null;
  if (state.pickerType === 'select' || state.pickerType === 'multi-select') {
    const live = new Set(state.options.map((o) => o.id));
    const kept = referencedIds(dv, 'selectOptionId').filter((id) => live.has(id));
    return encodeStatic(kept.map((selectOptionId) => ({ selectOptionId })));
  }
  if (state.pickerType === 'status') {
    const live = new Set(state.stages.map((o) => o.id));
    const kept = referencedIds(dv, 'pipelineStageId').filter((id) => live.has(id));
    return encodeStatic(kept.map((pipelineStageId) => ({ pipelineStageId })));
  }
  return dv;
}

function numberConfiguration(state: AttributeFormState) {
  const raw = state.decimalPlaces.trim();
  return { defaultDecimalPlaces: raw === '' ? null : Number(raw), defaultGroups: state.numberGroups };
}

function currencyConfiguration(state: AttributeFormState) {
  return {
    defaultCurrencyCode: state.currencyCode as 'USD',
    defaultDisplayType: state.currencyDisplay,
    defaultDecimalPlaces: state.currencyDecimals,
    defaultGroups: state.currencyGroups,
  };
}

export interface CreateIds {
  id: string;
  entityDefinitionId: string;
  /** Client-minted id of the reverse attribute of a relationship. */
  reverseId: string;
  /** Client-minted id of the formula snapshot (a new one per save). */
  snapshotId?: string;
}

/** The single create call (J attribute-dialogs §7, adapted: options, stages and default go in the same PUT). */
export function toCreateInput(state: AttributeFormState, ids: CreateIds): CreateAttributeInput {
  const entry = pickerEntry(state.pickerType);
  const allowed = constraintsFor(state.pickerType);
  if (state.pickerType === 'relationship') {
    const flags = cardinalityFlags(state.relationship.cardinality);
    return {
      id: ids.id,
      entityDefinitionId: ids.entityDefinitionId,
      type: 'entity-reference',
      title: state.relationship.thisTitle.trim(),
      description: '',
      isMultiselect: flags.thisMulti,
      relationship: {
        id: ids.reverseId,
        entityDefinitionId: state.relationship.targetObjectId as string,
        title: state.relationship.otherTitle.trim(),
        isMultiselect: flags.otherMulti,
      },
    };
  }
  if (state.pickerType === 'formula' && state.formula) {
    // The attribute's type is the formula's output type (formulas.md §5.1); its display settings follow that type.
    const formula: CreateAttributeInput = {
      id: ids.id,
      entityDefinitionId: ids.entityDefinitionId,
      type: state.formula.outputType,
      title: state.title.trim(),
      description: state.description.trim(),
      formulaConfiguration: formulaConfigurationInput(state.formula, ids.snapshotId ?? ids.id),
    };
    if (state.formula.outputType === 'number') formula.numberConfiguration = numberConfiguration(state);
    if (state.formula.outputType === 'currency') formula.currencyConfiguration = currencyConfiguration(state);
    return formula;
  }
  const ai = aiActive(state);
  const input: CreateAttributeInput = {
    id: ids.id,
    entityDefinitionId: ids.entityDefinitionId,
    type: entry.type,
    title: state.title.trim(),
    description: state.description.trim(),
    isRequired: !ai && allowed.required && state.isRequired,
    isUnique: !ai && allowed.unique && state.isUnique,
    isMultiselect: state.pickerType === 'multi-select' || (allowed.multiple && state.isMultiselect),
  };
  const aiConfig = ai ? aiConfigInput(state.aiAutofill) : null;
  if (aiConfig) input.aiAutofillConfiguration = aiConfig;
  if (state.pickerType === 'number') input.numberConfiguration = numberConfiguration(state);
  if (state.pickerType === 'currency') input.currencyConfiguration = currencyConfiguration(state);
  if (state.pickerType === 'record') {
    input.entityReferenceConfiguration = {
      allowedEntityDefinitionIds: state.allowedObjectIds.length > 0 ? state.allowedObjectIds : null,
    };
  }
  if (state.pickerType === 'select' || state.pickerType === 'multi-select') {
    let last: string | null = null;
    input.options = state.options.map((o) => {
      last = rankBetween(last, null);
      return { id: o.id, title: o.title.trim(), color: o.color as never, sortOrder: last };
    });
  }
  if (state.pickerType === 'status') {
    let last: string | null = null;
    input.stages = state.stages.map((s) => {
      last = rankBetween(last, null);
      return {
        id: s.id,
        title: s.title.trim(),
        color: s.color as never,
        sortOrder: last,
        lifecyclePhase: 'ACTIVE',
        celebrationEnabled: s.celebrationEnabled,
        targetTimeInStatus: encodeTargetTime(s.targetTime),
      };
    });
  }
  const dv = prunedDefault(state);
  if (dv) input.defaultValue = dv;
  return input;
}

/**
 * The edit PATCH: only changed scalar fields (null when nothing changed). `original` is the form state the dialog
 * opened with (formula draft and AI autofill are compared against it).
 */
export function toUpdateInput(
  attr: AttributeDefinition,
  state: AttributeFormState,
  original?: Pick<AttributeFormState, 'formula' | 'aiAutofill'>,
  snapshotId?: string,
): UpdateAttributeInput | null {
  const patch: UpdateAttributeInput = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id };
  const ai = aiActive(state);
  const allowed = ai || state.pickerType === 'formula' ? constraintsFor('formula') : constraintsFor(state.pickerType);
  if (
    state.pickerType === 'formula' &&
    state.formula &&
    snapshotId &&
    !sameDraft(state.formula, original?.formula ?? null)
  )
    patch.formulaConfiguration = formulaConfigurationInput(state.formula, snapshotId);
  if (hasAiAutofillCard(state.pickerType) && original && !sameAiState(state.aiAutofill, original.aiAutofill)) {
    patch.aiAutofillConfiguration = aiConfigInput(state.aiAutofill);
  }
  const title = state.pickerType === 'relationship' ? state.relationship.thisTitle.trim() : state.title.trim();
  if (title !== attr.title) patch.title = title;
  if (state.pickerType !== 'relationship' && state.description.trim() !== attr.description)
    patch.description = state.description.trim();
  if (allowed.required && state.isRequired !== attr.isRequired) patch.isRequired = state.isRequired;
  if (allowed.unique && state.isUnique !== attr.isUnique) patch.isUnique = state.isUnique;
  const numeric = state.pickerType === 'formula' ? (state.formula?.outputType ?? null) : state.pickerType;
  if (numeric === 'number') {
    const next = numberConfiguration(state);
    const cur = attr.config.numberConfiguration;
    if (
      next.defaultDecimalPlaces !== (cur?.defaultDecimalPlaces ?? null) ||
      next.defaultGroups !== (cur?.defaultGroups ?? 'default')
    )
      patch.numberConfiguration = next;
  }
  if (numeric === 'currency') {
    const next = currencyConfiguration(state);
    const cur = attr.config.currencyConfiguration;
    if (
      !cur ||
      next.defaultCurrencyCode !== cur.defaultCurrencyCode ||
      next.defaultDisplayType !== cur.defaultDisplayType ||
      next.defaultDecimalPlaces !== cur.defaultDecimalPlaces ||
      next.defaultGroups !== cur.defaultGroups
    )
      patch.currencyConfiguration = next;
  }
  if (state.pickerType === 'record') {
    const next = state.allowedObjectIds.length > 0 ? state.allowedObjectIds : null;
    const cur = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
    if (JSON.stringify(next) !== JSON.stringify(cur))
      patch.entityReferenceConfiguration = { allowedEntityDefinitionIds: next };
  }
  const dv = state.pickerType === 'formula' ? null : prunedDefault(state);
  if (JSON.stringify(dv) !== JSON.stringify(attr.defaultValue ?? null)) patch.defaultValue = dv;
  return Object.keys(patch).length > 2 ? patch : null;
}
