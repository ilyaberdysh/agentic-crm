// Test schema: deals (D) with a company reference to companies (C) and a multi reference to people (P).
import {
  type CompiledFormula,
  compileEditorText,
  type EvalEnv,
  type EvaluationResult,
  evaluateFormula,
  type FormulaAnnotation,
  type FormulaSchema,
  type HistoryEntry,
  type OutputOverride,
  type RV,
  type SchemaAttribute,
} from '../src/index.ts';

export const D = '00000000-0000-7000-8000-00000000000d';
export const C = '00000000-0000-7000-8000-00000000000c';
export const P = '00000000-0000-7000-8000-00000000000e';

const attrs: SchemaAttribute[] = [
  { id: 'a-name', entityDefinitionId: D, title: 'Name', type: 'text', isMultiselect: false },
  { id: 'a-value', entityDefinitionId: D, title: 'Value', type: 'currency', isMultiselect: false },
  { id: 'a-stage', entityDefinitionId: D, title: 'Stage', type: 'pipeline', isMultiselect: false },
  { id: 'a-tags', entityDefinitionId: D, title: 'Tags', type: 'select', isMultiselect: true },
  { id: 'a-owner', entityDefinitionId: D, title: 'Owner', type: 'actor-reference', isMultiselect: false },
  {
    id: 'a-company',
    entityDefinitionId: D,
    title: 'Company',
    type: 'entity-reference',
    isMultiselect: false,
    targetEntityDefinitionIds: [C],
  },
  {
    id: 'a-people',
    entityDefinitionId: D,
    title: 'People',
    type: 'entity-reference',
    isMultiselect: true,
    targetEntityDefinitionIds: [P],
  },
  { id: 'a-headcount', entityDefinitionId: D, title: 'Headcount', type: 'number', isMultiselect: false },
  { id: 'a-close', entityDefinitionId: D, title: 'Close date', type: 'date', isMultiselect: false },
  { id: 'a-created', entityDefinitionId: D, title: 'Created at', type: 'timestamp', isMultiselect: false },
  { id: 'a-done', entityDefinitionId: D, title: 'Done', type: 'checkbox', isMultiselect: false },
  { id: 'a-old', entityDefinitionId: D, title: 'Old', type: 'number', isMultiselect: false, isArchived: true },
  { id: 'a-touch', entityDefinitionId: D, title: 'Last touch', type: 'interaction', isMultiselect: false },
  { id: 'c-name', entityDefinitionId: C, title: 'Name', type: 'text', isMultiselect: false },
  { id: 'c-employees', entityDefinitionId: C, title: 'Employees', type: 'number', isMultiselect: false },
  { id: 'c-domains', entityDefinitionId: C, title: 'Domains', type: 'domain', isMultiselect: true },
  { id: 'c-hq', entityDefinitionId: C, title: 'HQ', type: 'location', isMultiselect: false },
  { id: 'p-name', entityDefinitionId: P, title: 'Name', type: 'personal-name', isMultiselect: false },
  { id: 'p-age', entityDefinitionId: P, title: 'Age', type: 'number', isMultiselect: false },
  { id: 'p-email', entityDefinitionId: P, title: 'Email', type: 'email-address', isMultiselect: false },
];

export const schema: FormulaSchema = {
  attribute: (ed, ad) => attrs.find((a) => a.entityDefinitionId === ed && a.id === ad) ?? null,
  selectOption: (_attr, id) => (id.startsWith('opt-') ? { title: id.slice(4) } : null),
  pipelineStage: (_attr, id) => (id.startsWith('stage-') ? { title: id.slice(6) } : null),
  actor: (_type, id) => (id.startsWith('m-') ? { name: `Member ${id.slice(2)}`, email: `${id}@x.io` } : null),
};

const hop = (ed: string, ad: string) => ({ entityDefinitionId: ed, attributeDefinitionId: ad });

/** Token ids used in test formulas: `_{d-name}` etc. */
export const TOKENS = new Map<string, FormulaAnnotation>([
  ['d-name', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-name')], field: null }],
  ['d-value', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-value')], field: 'raw_value' }],
  ['d-stage', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-stage')], field: null }],
  ['d-tags', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-tags')], field: null }],
  ['d-owner', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-owner')], field: null }],
  ['d-company', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-company')], field: null }],
  ['d-people', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-people')], field: null }],
  ['d-headcount', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-headcount')], field: null }],
  ['d-close', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-close')], field: null }],
  ['d-created', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-created')], field: null }],
  ['d-done', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-done')], field: null }],
  ['d-old', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-old')], field: null }],
  ['d-touch', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-touch')], field: null }],
  [
    'd-touchat',
    { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-touch')], field: 'interacted_at' },
  ],
  [
    'c-name',
    {
      type: 'entity-variable',
      startPosition: 0,
      length: 1,
      path: [hop(D, 'a-company'), hop(C, 'c-name')],
      field: null,
    },
  ],
  [
    'c-employees',
    {
      type: 'entity-variable',
      startPosition: 0,
      length: 1,
      path: [hop(D, 'a-company'), hop(C, 'c-employees')],
      field: null,
    },
  ],
  [
    'c-domains',
    {
      type: 'entity-variable',
      startPosition: 0,
      length: 1,
      path: [hop(D, 'a-company'), hop(C, 'c-domains')],
      field: null,
    },
  ],
  [
    'c-hq',
    { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-company'), hop(C, 'c-hq')], field: null },
  ],
  [
    'p-age',
    {
      type: 'entity-variable',
      startPosition: 0,
      length: 1,
      path: [hop(D, 'a-people'), hop(P, 'p-age')],
      field: null,
    },
  ],
  [
    'p-first',
    {
      type: 'entity-variable',
      startPosition: 0,
      length: 1,
      path: [hop(D, 'a-people'), hop(P, 'p-name')],
      field: 'first_name',
    },
  ],
  [
    'p-email',
    {
      type: 'entity-variable',
      startPosition: 0,
      length: 1,
      path: [hop(D, 'a-people'), hop(P, 'p-email')],
      field: null,
    },
  ],
  ['bad-field', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-name')], field: 'nope' }],
  ['missing-attr', { type: 'entity-variable', startPosition: 0, length: 1, path: [hop(D, 'a-nope')], field: null }],
  [
    'stage-won',
    {
      type: 'pipeline-stage',
      startPosition: 0,
      length: 1,
      entityDefinitionId: D,
      attributeDefinitionId: 'a-stage',
      pipelineStageId: 'stage-Won',
    },
  ],
  [
    'stage-lead',
    {
      type: 'pipeline-stage',
      startPosition: 0,
      length: 1,
      entityDefinitionId: D,
      attributeDefinitionId: 'a-stage',
      pipelineStageId: 'stage-Lead',
    },
  ],
  [
    'stage-lost',
    {
      type: 'pipeline-stage',
      startPosition: 0,
      length: 1,
      entityDefinitionId: D,
      attributeDefinitionId: 'a-stage',
      pipelineStageId: 'stage-Lost',
    },
  ],
  [
    'opt-vip',
    {
      type: 'select-option',
      startPosition: 0,
      length: 1,
      entityDefinitionId: D,
      attributeDefinitionId: 'a-tags',
      selectOptionId: 'opt-VIP',
    },
  ],
  [
    'm-ann',
    {
      type: 'actor-reference',
      startPosition: 0,
      length: 1,
      referencedActorType: 'workspace-member',
      referencedActorId: 'm-ann',
    },
  ],
]);

/** Values of the record the formulas run on (by token id), raw attribute values (no sub-field). */
export const RECORD: Record<string, RV> = {
  'd-name': 'Acme renewal',
  'd-value': 1500,
  'd-stage': { id: 'stage-Won', title: 'Won' },
  'd-tags': [
    { id: 'opt-VIP', title: 'VIP' },
    { id: 'opt-EU', title: 'EU' },
  ],
  'd-owner': { type: 'workspace-member', id: 'm-ann', name: 'Member ann', email: 'm-ann@x.io' },
  'd-company': { entityDefinitionId: C, entityInstanceId: 'c-1' },
  'd-people': [
    { entityDefinitionId: P, entityInstanceId: 'p-1' },
    { entityDefinitionId: P, entityInstanceId: 'p-2' },
  ],
  'd-headcount': 20,
  'd-close': '2024-06-30',
  'd-created': Date.UTC(2024, 0, 15, 9, 30),
  'd-done': false,
  'd-old': 1,
  'd-touch': { interactedAt: Date.UTC(2024, 4, 1), interactedWith: null, interactionType: 'email' },
  'd-touchat': { interactedAt: Date.UTC(2024, 4, 1), interactedWith: null, interactionType: 'email' },
  'c-name': 'Acme Inc',
  'c-employees': 250,
  'c-domains': ['acme.com', 'acme.io'],
  'c-hq': {
    line1: '1 Main St',
    line2: null,
    line3: null,
    line4: null,
    locality: 'London',
    region: null,
    postcode: 'N1',
    countryCode: 'GB',
  },
  'p-age': [30, 40],
  'p-first': [
    { fullName: 'Ann Lee', firstName: 'Ann', lastName: 'Lee' },
    { fullName: 'Bob Ray', firstName: 'Bob', lastName: 'Ray' },
  ],
  'p-email': [
    { email: 'ann@acme.com', domain: 'acme.com' },
    { email: 'bob@acme.io', domain: 'acme.io' },
  ],
};

export const NOW = Date.UTC(2024, 6, 1, 12, 0, 0);

export function compile(text: string, override: OutputOverride | null = null): CompiledFormula {
  return compileEditorText(text, TOKENS, { entityDefinitionId: D, schema, outputTypeOverride: override });
}

export function envFor(
  compiled: CompiledFormula,
  values: Record<string, RV> = RECORD,
  history: Record<string, HistoryEntry[]> = {},
): EvalEnv {
  return {
    now: NOW,
    ref: (i) => values[compiled.references[i]?.tokenId ?? ''] ?? null,
    history: (i) => history[compiled.references[i]?.tokenId ?? ''] ?? [],
    random: () => 0.42,
  };
}

/** Compiles and evaluates; returns the preview text, `ERR:<code>` or `DIAG:<codes>`. */
export function run(
  text: string,
  values: Record<string, RV> = RECORD,
  history: Record<string, HistoryEntry[]> = {},
): string | null {
  const compiled = compile(text);
  if (!compiled.ok) return `DIAG:${compiled.diagnostics.map((d) => d.code).join(',')}`;
  const result: EvaluationResult = evaluateFormula(compiled, envFor(compiled, values, history));
  if (result.type === 'evaluation_error') return `ERR:${result.code}`;
  if (result.type === 'syntax_error') return 'SYNTAX';
  return result.display;
}
