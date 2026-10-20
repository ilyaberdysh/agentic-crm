// Workflows (slice 8, modern only; G-workflows README, block-catalog, internal-api, runs; CROSS-DOMAIN B.6/B.7/B.11/
// B.12/B.14/B.20/B.21/B.28, X-20). Shared by the server (packages/domain/src/workflows) and the canvas editor.
//
// Model: workflow → versions (one editable draft + immutable published versions) → blocks (triggers and steps, each a
// catalogue slug + version + typed config tree) + paths (edges from a source block's outcome to a target block).
// Runs execute against the immutable version that was live when triggered: run → frames (root, retry attempts, loop
// iterations) → block executions with evaluated inputs, outputs, cost and failure reason.
//
// Config values are typed expression trees (internal-api §4) with camelCase keys. Variables reference upstream block
// outputs through matchers (several = "Add data source", first non-empty wins) with an optional static fallback.
// Conditions (Filter, If, Switch) are the workflow serialisation of the shared predicate AST (X-20): groups and
// binary predicates map onto `{and}` / `{or}` / leaves `{subject, mode, constraints}` with the shared filter operators;
// Find* filters are the view predicate AST itself (path leaves; constraint values may be variables).
import { z } from 'zod';
import { recordRefInputSchema } from './collab.ts';
import { actorSchema, timestampSchema, uuidSchema } from './common.ts';
import type { AttributeType } from './schema.ts';
import { type FilterOperator, filterOperators, type Predicate, predicateSchema } from './views.ts';

// ---------------------------------------------------------------------------------------------------------------
// Value types (variable picker type checking, B.7) and runtime value forms.
//
// Runtime forms (JSON): string/number/boolean; timestamp = ISO string; date = 'YYYY-MM-DD'; duration = {value, unit};
// currency = {currencyValue, currencyCode}; select = {selectOptionId, title}; status = {pipelineStageId, title};
// personal-name = {firstName, lastName, fullName}; location = the attribute's location object; record =
// {entityDefinitionId, entityInstanceId} (records and list entries); actor = {actorType, actorId}; team = {teamId};
// task = {taskId}; note = {noteId}; meeting = {meetingId}; arrays and objects as JSON.

export type WfType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'timestamp' }
  | { kind: 'date' }
  | { kind: 'duration' }
  | { kind: 'currency' }
  | { kind: 'select' }
  | { kind: 'status' }
  | { kind: 'personal-name' }
  | { kind: 'location' }
  | { kind: 'interaction' }
  /** A record of an object, or an entry of a list (lists are entity definitions); null = any. */
  | { kind: 'record'; entityDefinitionId: string | null }
  | { kind: 'actor' }
  | { kind: 'team' }
  | { kind: 'task' }
  | { kind: 'note' }
  | { kind: 'meeting' }
  | { kind: 'array'; of: WfType }
  | { kind: 'object'; fields: Record<string, WfType> }
  | { kind: 'json' };

export const wfTypeSchema: z.ZodType<WfType> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.enum([
        'string',
        'number',
        'boolean',
        'timestamp',
        'date',
        'duration',
        'currency',
        'select',
        'status',
        'personal-name',
        'location',
        'interaction',
        'actor',
        'team',
        'task',
        'note',
        'meeting',
        'json',
      ]),
    }),
    z.object({ kind: z.literal('record'), entityDefinitionId: uuidSchema.nullable() }),
    z.object({ kind: z.literal('array'), of: wfTypeSchema }),
    z.object({ kind: z.literal('object'), fields: z.record(z.string(), wfTypeSchema) }),
  ]),
) as z.ZodType<WfType>;

export const T = {
  string: { kind: 'string' } as WfType,
  number: { kind: 'number' } as WfType,
  boolean: { kind: 'boolean' } as WfType,
  timestamp: { kind: 'timestamp' } as WfType,
  date: { kind: 'date' } as WfType,
  duration: { kind: 'duration' } as WfType,
  actor: { kind: 'actor' } as WfType,
  team: { kind: 'team' } as WfType,
  task: { kind: 'task' } as WfType,
  note: { kind: 'note' } as WfType,
  meeting: { kind: 'meeting' } as WfType,
  json: { kind: 'json' } as WfType,
  record: (entityDefinitionId: string | null = null): WfType => ({ kind: 'record', entityDefinitionId }),
  array: (of: WfType): WfType => ({ kind: 'array', of }),
};

/** Sub-fields of composite values (variable `property` operations; picker level 3+). */
export const WF_PROPERTIES: Partial<Record<WfType['kind'], Record<string, { label: string; type: WfType }>>> = {
  actor: {
    name: { label: 'Name', type: T.string },
    emailAddress: { label: 'Email address', type: T.string },
    type: { label: 'Type', type: T.string },
    teams: { label: 'Teams', type: T.array(T.team) },
  },
  select: { title: { label: 'Title', type: T.string }, id: { label: 'ID', type: T.string } },
  status: { title: { label: 'Title', type: T.string }, id: { label: 'ID', type: T.string } },
  currency: {
    currencyValue: { label: 'Value', type: T.number },
    currencyCode: { label: 'Currency code', type: T.string },
  },
  'personal-name': {
    fullName: { label: 'Full name', type: T.string },
    firstName: { label: 'First name', type: T.string },
    lastName: { label: 'Last name', type: T.string },
  },
  location: {
    line1: { label: 'Address line 1', type: T.string },
    line2: { label: 'Address line 2', type: T.string },
    line3: { label: 'Address line 3', type: T.string },
    line4: { label: 'Address line 4', type: T.string },
    locality: { label: 'City', type: T.string },
    region: { label: 'State', type: T.string },
    postcode: { label: 'Postcode', type: T.string },
    countryCode: { label: 'Country code', type: T.string },
    latitude: { label: 'Latitude', type: T.string },
    longitude: { label: 'Longitude', type: T.string },
  },
  interaction: {
    interactedAt: { label: 'Interacted at', type: T.timestamp },
    interactionType: { label: 'Type', type: T.string },
    owner: { label: 'Owner', type: T.actor },
  },
  task: {
    content: { label: 'Content', type: T.string },
    deadlineAt: { label: 'Due', type: T.timestamp },
    isCompleted: { label: 'Completed', type: T.boolean },
    assignees: { label: 'Assignees', type: T.array(T.actor) },
    linkedRecords: { label: 'Linked records', type: T.array(T.record()) },
    createdAt: { label: 'Created at', type: T.timestamp },
  },
  note: {
    title: { label: 'Title', type: T.string },
    content: { label: 'Content', type: T.string },
    parentRecord: { label: 'Parent record', type: T.record() },
    createdAt: { label: 'Created at', type: T.timestamp },
  },
  team: { name: { label: 'Name', type: T.string } },
};

/** The value type of an attribute's values (one value; multi-value attributes hold an array of it). */
export function attributeValueType(
  type: AttributeType,
  options: { allowedEntityDefinitionIds?: string[] | null } = {},
): WfType {
  switch (type) {
    case 'text':
    case 'domain':
    case 'email-address':
    case 'phone-number':
      return T.string;
    case 'number':
    case 'rating':
      return T.number;
    case 'checkbox':
      return T.boolean;
    case 'currency':
      return { kind: 'currency' };
    case 'date':
      return T.date;
    case 'timestamp':
      return T.timestamp;
    case 'select':
      return { kind: 'select' };
    case 'pipeline':
      return { kind: 'status' };
    case 'entity-reference': {
      const allowed = options.allowedEntityDefinitionIds ?? null;
      return T.record(allowed && allowed.length === 1 ? (allowed[0] as string) : null);
    }
    case 'actor-reference':
      return T.actor;
    case 'location':
      return { kind: 'location' };
    case 'personal-name':
      return { kind: 'personal-name' };
    case 'interaction':
      return { kind: 'interaction' };
  }
}

export type Assignability = 'ok' | 'coerce' | 'incompatible';

const TO_STRING = new Set<WfType['kind']>([
  'string',
  'number',
  'boolean',
  'timestamp',
  'date',
  'select',
  'status',
  'personal-name',
  'location',
  'currency',
]);

/**
 * Whether a value of type `from` may feed an input expecting `to`: 'ok', 'coerce' (converted at run time, e.g. a
 * number into a text input, a select into its title, a currency into its amount, one value into a list) or
 * 'incompatible' (the picker greys the item out; the editor reports a type error).
 */
export function isAssignable(from: WfType, to: WfType): Assignability {
  if (to.kind === 'json' || from.kind === 'json') return 'ok';
  if (to.kind === 'array') {
    if (from.kind === 'array') return isAssignable(from.of, to.of) === 'incompatible' ? 'incompatible' : 'ok';
    return isAssignable(from, to.of) === 'incompatible' ? 'incompatible' : 'coerce';
  }
  if (from.kind === 'array') return 'incompatible';
  if (to.kind === 'record') {
    if (from.kind !== 'record') return 'incompatible';
    if (to.entityDefinitionId === null || from.entityDefinitionId === to.entityDefinitionId) return 'ok';
    return from.entityDefinitionId === null ? 'coerce' : 'incompatible';
  }
  if (from.kind === to.kind) return 'ok';
  switch (to.kind) {
    case 'string':
      return TO_STRING.has(from.kind) ? 'coerce' : 'incompatible';
    case 'number':
      return from.kind === 'currency' ? 'coerce' : 'incompatible';
    case 'timestamp':
      return from.kind === 'date' ? 'coerce' : 'incompatible';
    case 'date':
      return from.kind === 'timestamp' ? 'coerce' : 'incompatible';
    case 'select':
    case 'status':
      return from.kind === 'string' || from.kind === 'select' || from.kind === 'status' ? 'coerce' : 'incompatible';
    case 'currency':
      return from.kind === 'number' ? 'coerce' : 'incompatible';
    case 'personal-name':
      return from.kind === 'string' ? 'coerce' : 'incompatible';
    case 'location':
      return from.kind === 'string' ? 'coerce' : 'incompatible';
    case 'object':
      return 'incompatible';
    default:
      return 'incompatible';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Config expression grammar (internal-api §4)

export const durationUnits = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const;
export const durationUnitSchema = z.enum(durationUnits);
export type DurationUnit = z.infer<typeof durationUnitSchema>;

export type VariableOperation =
  /** First step into a block's outcome data: the output key (`entity_instance`, `result`, …). */
  | { type: 'field'; name: string }
  /** Drill into a record attribute (the record's definition and the attribute). */
  | { type: 'attribute'; entityDefinitionId: string; attributeDefinitionId: string }
  /** Sub-field of a composite value (actor name, select title, currency amount, …; WF_PROPERTIES). */
  | { type: 'property'; name: string }
  /** One element of a list (0-based; -1 = last). */
  | { type: 'index'; index: number };

export interface VariableMatcher {
  id: string;
  blockId: string;
  outcome: string;
  operations: VariableOperation[];
}

export interface VariableExpr {
  type: 'variable';
  /** Data sources in order; the first that resolves to a non-empty value wins. */
  matchers: VariableMatcher[];
  /** Static value used when every source is empty ("Fallback"). */
  fallback?: ConfigExpr | null;
}

/** Text with inline variables (B.11): each variable occupies one placeholder character at `start` of `plaintext`. */
export interface RichTextExpr {
  type: 'rich-text';
  blocks: { plaintext: string; variables: { start: number; variable: VariableExpr }[] }[];
}

export const conditionOperators = [
  'is',
  'is-not',
  'greater-than',
  'greater-than-or-equal-to',
  'less-than',
  'less-than-or-equal-to',
  'is-empty',
  'is-not-empty',
  'contains',
  'does-not-contain',
  'starts-with',
  'ends-with',
  'is-after',
  'is-on-or-after',
  'is-before',
  'is-on-or-before',
] as const;
export const conditionOperatorSchema = z.enum(conditionOperators);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export type ConfigExpr =
  | { type: 'object'; entries: Record<string, ConfigExpr> }
  | { type: 'array'; items: ConfigExpr[] }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'timestamp'; value: string }
  | { type: 'date'; value: string }
  | { type: 'duration'; value: ConfigExpr; unit: DurationUnit }
  | { type: 'agentic-crm-object'; entityDefinitionId: string }
  | { type: 'agentic-crm-list'; listId: string }
  | { type: 'agentic-crm-attribute'; entityDefinitionId: string; attributeDefinitionId: string }
  /** A static record or list entry (record pickers). */
  | { type: 'entity-reference'; entityDefinitionId: string; entityInstanceId: string }
  | { type: 'actor'; actorId: string }
  | { type: 'team'; teamId: string }
  /** A static attribute value in the attribute's write form (values.ts valueInputSchemas). */
  | { type: 'value'; value: unknown }
  /** A static JSON value (Parse JSON input, HTTP body). */
  | { type: 'json'; value: unknown }
  | VariableExpr
  | RichTextExpr
  | { type: 'binary-predicate'; left: ConfigExpr; operator: ConditionOperator; right?: ConfigExpr | null }
  | { type: 'predicate-group'; logic: 'and' | 'or'; predicates: ConfigExpr[] }
  /** Find* filters: the view predicate AST; a constraint `value` may be a variable expression. */
  | { type: 'filter'; predicate: Predicate | null };

const variableOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field'), name: z.string().min(1).max(200) }),
  z.object({ type: z.literal('attribute'), entityDefinitionId: uuidSchema, attributeDefinitionId: uuidSchema }),
  z.object({ type: z.literal('property'), name: z.string().min(1).max(100) }),
  z.object({ type: z.literal('index'), index: z.number().int().min(-1).max(10_000) }),
]);

export const variableMatcherSchema = z.object({
  id: z.string().min(1).max(100),
  blockId: uuidSchema,
  outcome: z.string().min(1).max(200),
  operations: z.array(variableOperationSchema).max(10),
});

export const configExprSchema: z.ZodType<ConfigExpr> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('object'), entries: z.record(z.string().max(200), configExprSchema) }),
    z.object({ type: z.literal('array'), items: z.array(configExprSchema).max(1000) }),
    z.object({ type: z.literal('string'), value: z.string().max(100_000) }),
    z.object({ type: z.literal('number'), value: z.number().finite() }),
    z.object({ type: z.literal('boolean'), value: z.boolean() }),
    z.object({ type: z.literal('null') }),
    z.object({ type: z.literal('timestamp'), value: timestampSchema }),
    z.object({ type: z.literal('date'), value: z.iso.date() }),
    z.object({ type: z.literal('duration'), value: configExprSchema, unit: durationUnitSchema }),
    z.object({ type: z.literal('agentic-crm-object'), entityDefinitionId: z.string().min(1).max(128) }),
    z.object({ type: z.literal('agentic-crm-list'), listId: z.string().min(1).max(128) }),
    z.object({
      type: z.literal('agentic-crm-attribute'),
      entityDefinitionId: z.string().min(1).max(128),
      attributeDefinitionId: z.string().min(1).max(128),
    }),
    z.object({ type: z.literal('entity-reference'), entityDefinitionId: uuidSchema, entityInstanceId: uuidSchema }),
    z.object({ type: z.literal('actor'), actorId: uuidSchema }),
    z.object({ type: z.literal('team'), teamId: uuidSchema }),
    z.object({ type: z.literal('value'), value: z.unknown() }),
    z.object({ type: z.literal('json'), value: z.unknown() }),
    z.object({
      type: z.literal('variable'),
      matchers: z.array(variableMatcherSchema).min(1).max(10),
      fallback: configExprSchema.nullish(),
    }),
    z.object({
      type: z.literal('rich-text'),
      blocks: z
        .array(
          z.object({
            plaintext: z.string().max(100_000),
            variables: z
              .array(
                z.object({
                  start: z.number().int().min(0),
                  variable: z.object({
                    type: z.literal('variable'),
                    matchers: z.array(variableMatcherSchema).min(1).max(10),
                    fallback: configExprSchema.nullish(),
                  }),
                }),
              )
              .max(500),
          }),
        )
        .max(1000),
    }),
    z.object({
      type: z.literal('binary-predicate'),
      left: configExprSchema,
      operator: conditionOperatorSchema,
      right: configExprSchema.nullish(),
    }),
    z.object({
      type: z.literal('predicate-group'),
      logic: z.enum(['and', 'or']),
      predicates: z.array(configExprSchema).max(100),
    }),
    z.object({ type: z.literal('filter'), predicate: predicateSchema.nullable() }),
  ]),
) as z.ZodType<ConfigExpr>;

/** The root config of a block: an object of its inputs. */
export const blockConfigSchema = z.object({
  type: z.literal('object'),
  entries: z.record(z.string().max(200), configExprSchema),
});
export type BlockConfig = { type: 'object'; entries: Record<string, ConfigExpr> };

/** Config tree helpers (both sides). */
export const cfg = {
  object: (entries: Record<string, ConfigExpr> = {}): { type: 'object'; entries: Record<string, ConfigExpr> } => ({
    type: 'object',
    entries,
  }),
  string: (value: string): ConfigExpr => ({ type: 'string', value }),
  number: (value: number): ConfigExpr => ({ type: 'number', value }),
  boolean: (value: boolean): ConfigExpr => ({ type: 'boolean', value }),
  object_: (entityDefinitionId: string): ConfigExpr => ({ type: 'agentic-crm-object', entityDefinitionId }),
  list: (listId: string): ConfigExpr => ({ type: 'agentic-crm-list', listId }),
  value: (value: unknown): ConfigExpr => ({ type: 'value', value }),
  variable: (
    blockId: string,
    outcome: string,
    operations: VariableOperation[],
    fallback?: ConfigExpr,
  ): VariableExpr => ({
    type: 'variable',
    matchers: [{ id: `${blockId}:${outcome}`, blockId, outcome, operations }],
    ...(fallback ? { fallback } : {}),
  }),
  text: (...parts: (string | VariableExpr)[]): RichTextExpr => {
    let plaintext = '';
    const variables: { start: number; variable: VariableExpr }[] = [];
    for (const p of parts) {
      if (typeof p === 'string') plaintext += p;
      else {
        variables.push({ start: plaintext.length, variable: p });
        plaintext += '_';
      }
    }
    return { type: 'rich-text', blocks: [{ plaintext, variables }] };
  },
  condition: (left: ConfigExpr, operator: ConditionOperator, right?: ConfigExpr): ConfigExpr => ({
    type: 'binary-predicate',
    left,
    operator,
    ...(right ? { right } : {}),
  }),
};

// ---------------------------------------------------------------------------------------------------------------
// Conditions: workflow serialisation ↔ the shared predicate AST (X-20)

/** A leaf of the shared AST over a runtime subject (instead of an attribute path). */
export interface ConditionLeaf {
  subject: ConfigExpr;
  mode: 'must' | 'must-not';
  constraints: { field: 'value'; operator: FilterOperator; value?: ConfigExpr | null }[];
}
export type Condition = { and: Condition[] } | { or: Condition[] } | ConditionLeaf;

/** Operator → (mode, shared filter operator). */
export const CONDITION_OPERATOR_AST: Record<ConditionOperator, { mode: 'must' | 'must-not'; op: FilterOperator }> = {
  is: { mode: 'must', op: 'eq' },
  'is-not': { mode: 'must-not', op: 'eq' },
  'greater-than': { mode: 'must', op: 'gt' },
  'greater-than-or-equal-to': { mode: 'must', op: 'gte' },
  'less-than': { mode: 'must', op: 'lt' },
  'less-than-or-equal-to': { mode: 'must', op: 'lte' },
  'is-empty': { mode: 'must', op: 'empty' },
  'is-not-empty': { mode: 'must', op: 'not-empty' },
  contains: { mode: 'must', op: 'contains' },
  'does-not-contain': { mode: 'must-not', op: 'contains' },
  'starts-with': { mode: 'must', op: 'starts-with' },
  'ends-with': { mode: 'must', op: 'ends-with' },
  'is-after': { mode: 'must', op: 'gt' },
  'is-on-or-after': { mode: 'must', op: 'gte' },
  'is-before': { mode: 'must', op: 'lt' },
  'is-on-or-before': { mode: 'must', op: 'lte' },
};

/** Operators without a right-hand value. */
export const UNARY_CONDITION_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['is-empty', 'is-not-empty']);

/** Binary predicates and groups → the shared AST (throws on a node that is not a condition). */
export function conditionToAst(node: ConfigExpr): Condition {
  if (node.type === 'predicate-group') {
    const parts = node.predicates.map(conditionToAst);
    return node.logic === 'and' ? { and: parts } : { or: parts };
  }
  if (node.type === 'binary-predicate') {
    const { mode, op } = CONDITION_OPERATOR_AST[node.operator];
    return {
      subject: node.left,
      mode,
      constraints: [{ field: 'value', operator: op, value: node.right ?? null }],
    };
  }
  throw new Error(`Not a condition: ${node.type}`);
}

/** Operators the condition builder offers per subject type (README §3.2; block library). */
export function conditionOperatorsFor(type: WfType): ConditionOperator[] {
  const empty: ConditionOperator[] = ['is-empty', 'is-not-empty'];
  switch (type.kind) {
    case 'number':
    case 'currency':
      return [
        'is',
        'is-not',
        'greater-than',
        'greater-than-or-equal-to',
        'less-than',
        'less-than-or-equal-to',
        ...empty,
      ];
    case 'timestamp':
    case 'date':
      return ['is', 'is-not', 'is-after', 'is-on-or-after', 'is-before', 'is-on-or-before', ...empty];
    case 'string':
    case 'personal-name':
    case 'location':
      return ['is', 'is-not', 'contains', 'does-not-contain', 'starts-with', 'ends-with', ...empty];
    case 'array':
      return ['contains', 'does-not-contain', ...empty];
    default:
      return ['is', 'is-not', ...empty];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogue (block-catalog §1–5)

export const blockCategories = [
  'agents',
  'ai',
  'records',
  'lists',
  'sequences',
  'data',
  'tasks',
  'notes',
  'meetings',
  'activities',
  'calculations',
  'conditions',
  'delays',
  'workspace',
  'utilities',
  'notifications',
  'misc',
  'internal',
] as const;
export const blockCategorySchema = z.enum(blockCategories);
export type BlockCategory = z.infer<typeof blockCategorySchema>;
export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  agents: 'Agents',
  ai: 'AI',
  records: 'Records',
  lists: 'Lists',
  sequences: 'Sequences',
  data: 'Data',
  tasks: 'Tasks',
  notes: 'Notes',
  meetings: 'Meetings',
  activities: 'Activities',
  calculations: 'Calculations',
  conditions: 'Conditions',
  delays: 'Delays',
  workspace: 'Workspace',
  utilities: 'Utilities',
  notifications: 'Notifications',
  misc: 'Misc',
  internal: 'Internal',
};

export const blockTypes = ['trigger', 'step'] as const;
export type BlockType = (typeof blockTypes)[number];

/**
 * Input controls of the configuration panel (block-catalog §7). `valueType` is what a variable must provide;
 * structural inputs (object/list pickers, enums) take no variables.
 */
export const inputControls = [
  'object',
  'list',
  'object-or-list',
  'attribute',
  'unique-attribute',
  'configured-attributes',
  'custom-fields',
  'record',
  'entry',
  'records',
  'actors',
  'actors-or-teams',
  'task',
  'meeting',
  'text',
  'rich-text',
  'number',
  'boolean',
  'timestamp',
  'duration',
  'enum',
  'enum-multi',
  'days-of-week',
  'days-of-month',
  'time-of-day',
  'timezone',
  'cron',
  'predicate',
  'cases',
  'filter',
  'task-filter',
  'array',
  'json',
  'json-schema',
  'headers',
  'code',
  'code-inputs',
  'questions',
  'tags',
  'messages',
  'tools',
  'model',
] as const;
export type InputControl = (typeof inputControls)[number];

export interface InputSpec {
  key: string;
  label: string;
  control: InputControl;
  required: boolean;
  /** none = static only; allowed = static or variable ({x} button); only = variable only ("No value selected"). */
  variables: 'none' | 'allowed' | 'only';
  /** Expected type of a variable (and of the static value). */
  valueType?: WfType;
  /** Enum options. */
  options?: { value: string; label: string }[];
  default?: unknown;
  placeholder?: string;
  hint?: string;
  /** Shown only when another input has one of these values. */
  visibleWhen?: { key: string; values: string[] };
  /** For attribute pickers: the input naming the object or list. */
  of?: string;
}

export interface OutputSpec {
  key: string;
  label: string;
  type: WfType;
  /** The record type comes from this input (object / list) of the block's config. */
  recordOf?: string;
}

export interface OutcomeSpec {
  slug: string;
  label: string;
  /** null = an outcome without outputs ("no data" in the picker). */
  outputs: OutputSpec[] | null;
}

export type BlockCost = { type: 'free' } | { type: 'fixed'; amount: number } | { type: 'dynamic' };

export interface BlockDefinition {
  slug: string;
  blockType: BlockType;
  title: string;
  description: string;
  category: BlockCategory;
  keywords: string[];
  version: number;
  inputs: InputSpec[];
  /** Static outcomes; blocks whose outcomes come from config (Switch) list `dynamicOutcomes`. */
  outcomes: OutcomeSpec[];
  dynamicOutcomes?: 'switch-cases' | 'parse-json' | 'loop' | 'custom-agent';
  cost: BlockCost;
  safeToRetry: boolean;
  /** Implemented in this build (8.08 / 8.09 first set); others are listed but cannot be added. */
  available: boolean;
  /** Why an unavailable block cannot be used yet. */
  unavailableReason?: string;
  /** Plan or flag gate ("Enterprise" badge, flag-gated). */
  gate?: { kind: 'enterprise' | 'feature-flag' | 'internal'; label: string };
  /** Shown in the trigger picker / palette (hidden: flag-gated and internal blocks). */
  inPalette: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Workflows, versions, blocks, paths

export const workflowStatuses = ['draft', 'live', 'paused'] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

export const workflowSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  title: z.string().nullable(),
  /** title ?? ai_title ?? "Untitled Workflow". */
  displayTitle: z.string(),
  description: z.string().nullable(),
  aiTitle: z.string().nullable(),
  aiDescription: z.string().nullable(),
  status: z.enum(workflowStatuses),
  isTransient: z.boolean(),
  isArchived: z.boolean(),
  draftVersionId: uuidSchema,
  activeVersionId: uuidSchema.nullable(),
  /** The newest immutable version (what Discard returns to). */
  latestPublishedVersionId: uuidSchema.nullable(),
  firstSetLiveAt: timestampSchema.nullable(),
  lastPublishedAt: timestampSchema.nullable(),
  lastStatusChangeAt: timestampSchema.nullable(),
  lastRunFailedAt: timestampSchema.nullable(),
  timezone: z.string().nullable(),
  maxCreditsPerRun: z.number().int(),
  dismissedCycleWarning: z.boolean(),
  runCount: z.number().int(),
  isFavorite: z.boolean(),
  /** Slugs of the draft's triggers (index grouping, Trigger workflow button). */
  triggerSlugs: z.array(z.string()),
  /** Draft differs from the latest published version ("This workflow has unpublished changes"). */
  hasUnpublishedChanges: z.boolean(),
  /** The caller's effective access level and flags (B.12). */
  access: z.object({
    level: z.enum(['full-access', 'read-write', 'read-only', 'no-access']),
    flags: z.record(z.string(), z.boolean()),
  }),
  /** Settings tab: failure notifications for the caller. */
  failureNotifications: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Workflow = z.infer<typeof workflowSchema>;

export const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Position = z.infer<typeof positionSchema>;

export const blockIssueSchema = z.object({
  /** Input path inside the config (e.g. ['configured_attributes', '<attr id>']); [] = the block itself. */
  path: z.array(z.string()),
  code: z.enum([
    'required',
    'invalid',
    'type-mismatch',
    'deleted-variable',
    'inaccessible-variable',
    'not-connected',
    'no-next-step',
    'invalid-connection',
    'not-available',
    'unknown-block',
  ]),
  message: z.string(),
});
export type BlockIssue = z.infer<typeof blockIssueSchema>;

export const resolvedOutcomeSchema = z.object({
  slug: z.string(),
  label: z.string(),
  outputs: z.array(z.object({ key: z.string(), label: z.string(), type: wfTypeSchema })).nullable(),
});
export type ResolvedOutcome = z.infer<typeof resolvedOutcomeSchema>;

export const workflowBlockSchema = z.object({
  id: uuidSchema,
  versionId: uuidSchema,
  blockType: z.enum(blockTypes),
  slug: z.string(),
  blockVersion: z.number().int(),
  title: z.string(),
  category: blockCategorySchema,
  description: z.string().nullable(),
  position: positionSchema,
  config: blockConfigSchema,
  /** Outcomes with their outputs' types for this config (handles, picker). */
  outcomes: z.array(resolvedOutcomeSchema),
  cost: z.unknown(),
  issues: z.array(blockIssueSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type WorkflowBlock = z.infer<typeof workflowBlockSchema>;

export const workflowPathSchema = z.object({
  id: uuidSchema,
  versionId: uuidSchema,
  sourceBlockId: uuidSchema,
  outcome: z.string(),
  targetBlockId: uuidSchema,
  createdAt: timestampSchema,
});
export type WorkflowPath = z.infer<typeof workflowPathSchema>;

export const versionStatuses = ['draft', 'live', 'paused', 'superseded'] as const;
export const workflowVersionSummarySchema = z.object({
  id: uuidSchema,
  type: z.enum(['draft', 'immutable']),
  /** live = the active version; paused = the latest published version of a paused workflow. */
  status: z.enum(versionStatuses),
  baseVersionId: uuidSchema.nullable(),
  /** "Current draft, restored from {publishedAt}". */
  restoredFrom: z.object({ versionId: uuidSchema, publishedAt: timestampSchema.nullable() }).nullable(),
  publishedAt: timestampSchema.nullable(),
  publishedBy: actorSchema.nullable(),
  createdAt: timestampSchema,
});
export type WorkflowVersionSummary = z.infer<typeof workflowVersionSummarySchema>;

export const workflowVersionSchema = workflowVersionSummarySchema.extend({
  blocks: z.array(workflowBlockSchema),
  paths: z.array(workflowPathSchema),
  /** "Checklist": blocks with errors; publishing needs none (plus at least one trigger and one step). */
  checklist: z.object({
    errorCount: z.number().int(),
    blocksWithErrors: z.array(uuidSchema),
    messages: z.array(z.string()),
  }),
});
export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Procedure inputs

const wf = { workflowId: uuidSchema };

export const listWorkflowsInputSchema = z.object({
  /** Workspace settings → Workflows: every workflow, whatever the admin's own access (admins only). */
  admin: z.boolean().optional(),
  includeArchived: z.boolean().default(false),
  createdByMemberIds: z.array(uuidSchema).max(100).optional(),
  /** Live workflows a record / entry / note can run ("Select workflow" dialog, README §3.8). */
  actionFor: z
    .object({
      kind: z.enum(['record', 'list-entry', 'note']),
      /** The object or list (notes: the parent record's object; omitted = any). */
      entityDefinitionId: z.string().min(1).max(128).optional(),
    })
    .optional(),
});
export type ListWorkflowsInput = z.input<typeof listWorkflowsInputSchema>;

export const getWorkflowInputSchema = z.object({ ...wf, versionId: uuidSchema.optional() });
export type GetWorkflowInput = z.input<typeof getWorkflowInputSchema>;

export const createWorkflowInputSchema = z.object({
  /** Client-minted (I3); a replay answers the stored workflow. */
  id: uuidSchema,
  draftVersionId: uuidSchema.optional(),
  title: z.string().max(500).nullish(),
});
export type CreateWorkflowInput = z.input<typeof createWorkflowInputSchema>;

export const updateWorkflowInputSchema = z.object({
  ...wf,
  title: z.string().max(500).nullish(),
  description: z.string().max(5000).nullish(),
  isArchived: z.boolean().optional(),
  timezone: z.string().max(64).nullish(),
  maxCreditsPerRun: z.number().int().min(1).max(100_000).optional(),
  dismissedCycleWarning: z.boolean().optional(),
});
export type UpdateWorkflowInput = z.input<typeof updateWorkflowInputSchema>;

export const workflowIdInputSchema = z.object(wf);
export type WorkflowIdInput = z.input<typeof workflowIdInputSchema>;

export const publishWorkflowInputSchema = z.object({
  ...wf,
  /** Client-minted id of the new immutable version. */
  versionId: uuidSchema.optional(),
});
export type PublishWorkflowInput = z.input<typeof publishWorkflowInputSchema>;

export const discardDraftInputSchema = z.object({ ...wf, draftVersionId: uuidSchema.optional() });
export type DiscardDraftInput = z.input<typeof discardDraftInputSchema>;

export const restoreVersionInputSchema = z.object({
  ...wf,
  versionId: uuidSchema,
  draftVersionId: uuidSchema.optional(),
});
export type RestoreVersionInput = z.input<typeof restoreVersionInputSchema>;

export const duplicateWorkflowInputSchema = z.object({ ...wf, targetWorkflowId: uuidSchema.optional() });
export type DuplicateWorkflowInput = z.input<typeof duplicateWorkflowInputSchema>;

export const updateWorkflowSettingsInputSchema = z.object({
  ...wf,
  timezone: z.string().max(64).nullish(),
  /** "Get notified when this workflow fails" for the caller. */
  failureNotifications: z.boolean().optional(),
});
export type UpdateWorkflowSettingsInput = z.input<typeof updateWorkflowSettingsInputSchema>;

export const putBlockInputSchema = z.object({
  ...wf,
  /** Client-minted block id; an existing id is updated (a different slug replaces the block in place). */
  blockId: uuidSchema,
  slug: z.string().min(1).max(100),
  blockVersion: z.number().int().min(1).optional(),
  description: z.string().max(5000).nullish(),
  position: positionSchema.optional(),
  /** Whole config object (omitted on create = empty). */
  config: blockConfigSchema.optional(),
});
export type PutBlockInput = z.input<typeof putBlockInputSchema>;

export const deleteBlockInputSchema = z.object({ ...wf, blockId: uuidSchema });
export type DeleteBlockInput = z.input<typeof deleteBlockInputSchema>;

export const connectBlocksInputSchema = z.object({
  ...wf,
  pathId: uuidSchema.optional(),
  sourceBlockId: uuidSchema,
  outcome: z.string().min(1).max(200),
  targetBlockId: uuidSchema,
});
export type ConnectBlocksInput = z.input<typeof connectBlocksInputSchema>;

export const disconnectBlocksInputSchema = z.object({ ...wf, pathId: uuidSchema });
export type DisconnectBlocksInput = z.input<typeof disconnectBlocksInputSchema>;

export const organizeBlocksInputSchema = z.object({
  ...wf,
  /** Explicit positions (multi-drag, Undo); omitted = automatic left-to-right layout (270 px columns). */
  positions: z
    .array(z.object({ blockId: uuidSchema, position: positionSchema }))
    .max(1000)
    .optional(),
});
export type OrganizeBlocksInput = z.input<typeof organizeBlocksInputSchema>;

export const variablesInputSchema = z.object({ ...wf, blockId: uuidSchema, versionId: uuidSchema.optional() });
export type VariablesInput = z.input<typeof variablesInputSchema>;

export const listRunsInputSchema = z.object({
  ...wf,
  statuses: z.array(z.enum(['queued', 'executing', 'completed', 'failed', 'canceled'])).optional(),
  /** `nextCursor` of the previous page. */
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type ListRunsInput = z.input<typeof listRunsInputSchema>;

export const runIdInputSchema = z.object({ runId: uuidSchema });
export type RunIdInput = z.input<typeof runIdInputSchema>;

export const retryRunInputSchema = z.object({ runId: uuidSchema, fromBlockExecutionId: uuidSchema });
export type RetryRunInput = z.input<typeof retryRunInputSchema>;

export const rerunInputSchema = z.object({
  runId: uuidSchema,
  /** "Retry with live workflow": a new run on the live version with the same trigger output. */
  live: z.boolean().optional(),
});
export type RerunInput = z.input<typeof rerunInputSchema>;

export const manualTriggerInputSchema = z.object({
  ...wf,
  /** Record action: one run per record. */
  recordRefs: z.array(recordRefInputSchema).max(1000).optional(),
  /** List entry action: one run per entry (`entityDefinitionId` = the list). */
  entryRefs: z.array(recordRefInputSchema).max(1000).optional(),
  /** Note action: one run per note. */
  noteIds: z.array(uuidSchema).max(1000).optional(),
});
export type ManualTriggerInput = z.input<typeof manualTriggerInputSchema>;

export const usageInputSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  workflowId: uuidSchema.optional(),
});
export type UsageInput = z.input<typeof usageInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Runs (runs.md §2)

export const runStatuses = ['queued', 'executing', 'completed', 'failed', 'canceled'] as const;
export type RunStatus = (typeof runStatuses)[number];
export const executionStatuses = ['queued', 'executing', 'delayed', 'completed', 'failed', 'canceled'] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

/** Failure reasons (runs.md §5) with the block failure banner copy. */
export const failureReasons = [
  'execution-error',
  'inputs-invalid',
  'timed-out',
  'stuck-timed-out',
  'exceeded-max-executions',
  'cascade-depth-exceeded',
  'force-canceled',
  'insufficient-credits',
  'not-supported-on-plan',
  'not-enabled-for-workspace',
  'requires-active-subscription',
  'value-too-large',
  'required-app-not-installed',
  'block-not-available',
] as const;
export type FailureReason = (typeof failureReasons)[number];
export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  'execution-error': 'This block failed to execute',
  'inputs-invalid': 'The inputs of this block are invalid',
  'timed-out': 'This block took too long to execute',
  'stuck-timed-out': 'This block got stuck and timed out',
  'exceeded-max-executions': 'Workflow runs are limited to 1000 block executions',
  'cascade-depth-exceeded': 'This run was stopped because workflows triggered each other too many times',
  'force-canceled': 'This run was force canceled',
  'insufficient-credits': 'Your workspace does not have enough credits',
  'not-supported-on-plan': 'This block is not supported on your current plan',
  'not-enabled-for-workspace': 'This block is not enabled for your workspace',
  'requires-active-subscription': 'This block requires an active subscription',
  'value-too-large': 'A value produced by this block is too large',
  'required-app-not-installed': 'The app required by this block is no longer installed',
  'block-not-available': 'This block is not available yet',
};

/** Engine limits (decisions in slice8-9-contracts.md). */
export const WORKFLOW_LIMITS = {
  maxBlocks: 1000,
  maxExecutionsPerRun: 1000,
  maxCascadeDepth: 5,
  findDefaultLimit: 100,
  findMaxLimit: 500,
  httpTimeoutMs: 120_000,
  maxLoopIterations: 1000,
  monthlyCreditAllowance: 10_000,
} as const;

export const workflowRunSchema = z.object({
  id: uuidSchema,
  workflowId: uuidSchema,
  versionId: uuidSchema,
  sequenceNumber: z.number().int(),
  status: z.enum(runStatuses),
  triggerBlockId: uuidSchema,
  triggerSlug: z.string(),
  cascadeDepth: z.number().int(),
  createdBy: actorSchema.nullable(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  failedAt: timestampSchema.nullable(),
  canceledAt: timestampSchema.nullable(),
  canceledBy: actorSchema.nullable(),
  failureReason: z.enum(failureReasons).nullable(),
  errorMessage: z.string().nullable(),
  creditsUsed: z.number(),
  executionCount: z.number().int(),
  attemptCount: z.number().int(),
  retriedFrom: z.object({ runId: uuidSchema, sequenceNumber: z.number().int() }).nullable(),
  retriedTo: z.array(z.object({ runId: uuidSchema, sequenceNumber: z.number().int(), createdAt: timestampSchema })),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const runFrameSchema = z.object({
  id: uuidSchema,
  parentFrameId: uuidSchema.nullable(),
  type: z.enum(['root', 'retry', 'loop-iteration']),
  /** Attempt number of root/retry frames ("Attempt #N"); loop iterations carry their attempt's number. */
  attempt: z.number().int(),
  status: z.enum(['executing', 'completed', 'failed', 'canceled']),
  loopExecutionId: uuidSchema.nullable(),
  iteration: z.number().int().nullable(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type RunFrame = z.infer<typeof runFrameSchema>;

export const blockExecutionSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  frameId: uuidSchema,
  blockId: uuidSchema,
  slug: z.string(),
  parentExecutionId: uuidSchema.nullable(),
  status: z.enum(executionStatuses),
  outcome: z.string().nullable(),
  /** Evaluated config (the resolved inputs). */
  inputs: z.unknown().nullable(),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  outputTypes: z.record(z.string(), wfTypeSchema).nullable(),
  cost: z.object({ amount: z.number(), isFinal: z.boolean() }).nullable(),
  failureReason: z.enum(failureReasons).nullable(),
  errorMessage: z.string().nullable(),
  resumeAt: timestampSchema.nullable(),
  attempt: z.number().int(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  failedAt: timestampSchema.nullable(),
});
export type BlockExecution = z.infer<typeof blockExecutionSchema>;

export const runDetailSchema = z.object({
  run: workflowRunSchema,
  frames: z.array(runFrameSchema),
  executions: z.array(blockExecutionSchema),
  /** Paths taken (source execution → target execution), for green edges. */
  takenPaths: z.array(z.object({ sourceBlockId: uuidSchema, outcome: z.string(), targetBlockId: uuidSchema })),
});
export type RunDetail = z.infer<typeof runDetailSchema>;

export const runStatsSchema = z.object({
  last7DaysRuns: z.number().int(),
  last7DaysCompleted: z.number().int(),
  last7DaysFailed: z.number().int(),
  last7DaysExecuting: z.number().int(),
  last7DaysCredits: z.number(),
  latestRunAt: timestampSchema.nullable(),
});
export type RunStats = z.infer<typeof runStatsSchema>;
