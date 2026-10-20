// The modern block catalogue as data (block-catalog §3–5, §7): 16 triggers and the step registry, with config inputs,
// outcomes and outputs, credit cost and retry safety. Served by `workflows.catalog()`; the server validates and
// executes blocks against the same definitions. Blocks outside slice 8's first set are listed (palette parity) but
// marked unavailable with the reason.
import {
  type BlockCost,
  type BlockDefinition,
  type InputSpec,
  type OutcomeSpec,
  type OutputSpec,
  T,
  type WfType,
} from './workflows.ts';

const FREE: BlockCost = { type: 'free' };
const ONE: BlockCost = { type: 'fixed', amount: 1 };
const DYNAMIC: BlockCost = { type: 'dynamic' };

const done = (outputs: OutputSpec[] | null = []): OutcomeSpec[] => [{ slug: 'done', label: 'Next step', outputs }];

const input = (
  key: string,
  label: string,
  control: InputSpec['control'],
  options: Partial<Omit<InputSpec, 'key' | 'label' | 'control'>> = {},
): InputSpec => ({ key, label, control, required: true, variables: 'none', ...options });

const objectInput = (key = 'object', label = 'Object') => input(key, label, 'object');
const listInput = () => input('list', 'List', 'list');
const configured = (of: string) =>
  input('configured_attributes', 'Attributes to set', 'configured-attributes', { required: false, of });
const recordOut = (key: string, label: string, recordOf: string): OutputSpec => ({
  key,
  label,
  type: T.record(),
  recordOf,
});
const actorOut = (label: string): OutputSpec => ({ key: 'actor', label, type: T.actor });
const atOut = (label: string): OutputSpec => ({ key: 'at', label, type: T.timestamp });

const NOT_YET = {
  ai: 'Web agent needs a web-research provider',
  sequences: 'Sequences are deferred',
  activities: 'Activities are flag-gated',
  code: 'Execute code needs a sandbox (slice 8b)',
  sql: 'SQL queries are an Enterprise feature',
  hitl: 'Send request is flag-gated',
  internal: 'Internal test block',
  meetings: 'Meetings arrive with slice 7',
};

interface DefOptions {
  keywords?: string[];
  version?: number;
  inputs?: InputSpec[];
  outcomes?: OutcomeSpec[];
  dynamicOutcomes?: BlockDefinition['dynamicOutcomes'];
  cost?: BlockCost;
  safeToRetry?: boolean;
  unavailable?: string;
  gate?: BlockDefinition['gate'];
}

function def(
  blockType: BlockDefinition['blockType'],
  slug: string,
  title: string,
  description: string,
  category: BlockDefinition['category'],
  o: DefOptions = {},
): BlockDefinition {
  return {
    slug,
    blockType,
    title,
    description,
    category,
    keywords: o.keywords ?? [],
    version: o.version ?? 1,
    inputs: o.inputs ?? [],
    outcomes: o.outcomes ?? done(),
    ...(o.dynamicOutcomes ? { dynamicOutcomes: o.dynamicOutcomes } : {}),
    cost: o.cost ?? FREE,
    safeToRetry: o.safeToRetry ?? false,
    available: o.unavailable === undefined,
    ...(o.unavailable !== undefined ? { unavailableReason: o.unavailable } : {}),
    ...(o.gate ? { gate: o.gate } : {}),
    inPalette: o.gate?.kind !== 'feature-flag' && o.gate?.kind !== 'internal',
  };
}

type DefArgs = [string, string, string, BlockDefinition['category'], DefOptions?];
const trigger = (...a: DefArgs) => def('trigger', ...a);
const step = (...a: DefArgs) => def('step', ...a);

const customFields = input('custom_fields', 'Custom fields', 'custom-fields', { required: false });
const attributeOf = (of: string, required: boolean, label = 'Attribute') =>
  input('attribute', label, 'attribute', { required, of });

const FLAG_ACTIVITIES = { kind: 'feature-flag' as const, label: 'particle-interfaces' };
const FLAG_INTERNAL = { kind: 'internal' as const, label: 'workflow-internal-blocks' };

const limitInput = input('limit', 'Limit', 'number', {
  variables: 'allowed',
  valueType: T.number,
  default: 100,
  hint: 'At most 500',
});

const usersInput = (key: string, label: string, required = true) =>
  input(key, label, 'actors-or-teams', {
    required,
    variables: 'allowed',
    valueType: T.array(T.actor),
    placeholder: 'Select members or teams',
  });

const targetInputs: InputSpec[] = [
  input('target_type', 'Target', 'enum', {
    options: [
      { value: 'workspace', label: 'All users' },
      { value: 'specific-users', label: 'Specific users' },
    ],
    default: 'workspace',
  }),
  {
    ...usersInput('targeted_users', 'Users'),
    required: false,
    visibleWhen: { key: 'target_type', values: ['specific-users'] },
  },
];

const DURATION_UNITS = [
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
];

export const TRIGGER_DEFINITIONS: BlockDefinition[] = [
  trigger(
    'on-record-action',
    'Record action',
    'Adds an action that can be triggered on any record in an object',
    'records',
    {
      inputs: [objectInput(), customFields],
      outcomes: done([
        recordOut('entity_instance', 'Record', 'object'),
        actorOut('Triggered by'),
        atOut('Triggered at'),
      ]),
    },
  ),
  trigger('on-record-created', 'Record created', 'Trigger a workflow when a new record is created', 'records', {
    inputs: [objectInput()],
    outcomes: done([recordOut('entity_instance', 'Record', 'object'), actorOut('Created by'), atOut('Created at')]),
  }),
  trigger('on-record-updated', 'Record updated', 'Trigger a workflow when a record is updated', 'records', {
    inputs: [objectInput(), attributeOf('object', false)],
    outcomes: done([recordOut('entity_instance', 'Record', 'object'), actorOut('Updated by'), atOut('Updated at')]),
  }),
  trigger(
    'on-list-entry-action',
    'List entry action',
    'Adds an action that can be triggered on any entry in a list',
    'lists',
    {
      inputs: [listInput(), customFields],
      outcomes: done([
        recordOut('entity_instance', 'List entry', 'list'),
        actorOut('Triggered by'),
        atOut('Triggered at'),
      ]),
    },
  ),
  trigger(
    'on-list-entry-created',
    'Record added to list',
    'Trigger a workflow when a record is added to a list',
    'lists',
    {
      inputs: [listInput()],
      outcomes: done([recordOut('entity_instance', 'List entry', 'list'), actorOut('Created by'), atOut('Created at')]),
    },
  ),
  trigger(
    'on-list-entry-updated',
    'List entry updated',
    'Trigger a workflow when an entry in a list is updated',
    'lists',
    {
      inputs: [listInput(), attributeOf('list', false)],
      outcomes: done([recordOut('entity_instance', 'List entry', 'list'), actorOut('Updated by'), atOut('Updated at')]),
    },
  ),
  trigger(
    'on-attribute-invalidated',
    'Attribute value changed',
    'Trigger a workflow when an attribute value is created or updated',
    'data',
    {
      inputs: [input('object', 'Object or List', 'object-or-list'), attributeOf('object', true)],
      outcomes: done([recordOut('entity_instance', 'Record', 'object'), actorOut('Updated by'), atOut('Updated at')]),
    },
  ),
  trigger('on-task-created', 'Task created', 'Trigger a workflow when a new task is created', 'tasks', {
    outcomes: done([{ key: 'task', label: 'Created task', type: T.task }, actorOut('Created by'), atOut('Created at')]),
  }),
  trigger('on-note-action', 'Note action', 'Adds an action that can be triggered on a note', 'notes', {
    inputs: [objectInput(), customFields],
    outcomes: done([{ key: 'note', label: 'Note', type: T.note }, actorOut('Triggered by'), atOut('Triggered at')]),
  }),
  trigger('on-note-created', 'Note created', 'Trigger a workflow when a new note is created', 'notes', {
    inputs: [{ ...objectInput(), required: false }],
    outcomes: done([{ key: 'note', label: 'Created note', type: T.note }, actorOut('Created by'), atOut('Created at')]),
  }),
  trigger(
    'on-call-recording-created',
    'Call recording created',
    'Trigger a workflow when a call recording has finished processing its transcript and summary',
    'meetings',
    {
      outcomes: done([{ key: 'call_recording', label: 'Call recording', type: T.json }]),
    },
  ),
  trigger('on-inbound-webhook', 'Webhook received', 'Trigger a workflow when a webhook is received', 'utilities', {
    outcomes: done([
      { key: 'request_body', label: 'Request body', type: T.string },
      { key: 'triggered_at', label: 'Triggered at', type: T.timestamp },
    ]),
  }),
  trigger('on-manual-run', 'Manual run', 'Trigger this workflow when it is manually invoked by a user', 'utilities', {
    outcomes: done([actorOut('Triggered by'), atOut('Triggered at')]),
  }),
  trigger('on-recurring-schedule', 'Recurring schedule', 'Trigger a workflow on a recurring schedule', 'utilities', {
    inputs: [
      input('mode', 'Frequency', 'enum', {
        options: [
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'advanced-cron', label: 'Advanced' },
        ],
        default: 'daily',
      }),
      input('days_of_week', 'Days of week', 'days-of-week', {
        visibleWhen: { key: 'mode', values: ['weekly'] },
        hint: 'Select at least one day',
      }),
      input('days_of_month', 'Days of month', 'days-of-month', {
        visibleWhen: { key: 'mode', values: ['monthly'] },
        hint: 'Select at least one day',
      }),
      input('time_of_day', 'Time', 'time-of-day', {
        default: '12:00',
        hint: '24-hour format (00:00 - 23:59)',
        visibleWhen: { key: 'mode', values: ['daily', 'weekly', 'monthly'] },
      }),
      input('cron_expression', 'Cron expression', 'cron', {
        placeholder: '0 10 * * *',
        visibleWhen: { key: 'mode', values: ['advanced-cron'] },
      }),
      input('timezone', 'Timezone', 'timezone', { default: 'UTC' }),
    ],
    outcomes: done([{ key: 'triggered_at', label: 'Triggered at', type: T.timestamp }]),
  }),
  trigger(
    'on-activity-created',
    'Activity created',
    'Trigger a workflow when a new activity is created',
    'activities',
    {
      inputs: [input('activity', 'Activity', 'object')],
      outcomes: done([
        { key: 'activity_record', label: 'Activity', type: T.record() },
        actorOut('Created by'),
        atOut('Created at'),
      ]),
      unavailable: NOT_YET.activities,
      gate: FLAG_ACTIVITIES,
    },
  ),
  trigger('on-activity-updated', 'Activity updated', 'Trigger a workflow when an activity is updated', 'activities', {
    inputs: [input('activity', 'Activity', 'object'), attributeOf('activity', false)],
    outcomes: done([
      { key: 'activity_record', label: 'Activity', type: T.record() },
      actorOut('Updated by'),
      atOut('Updated at'),
    ]),
    unavailable: NOT_YET.activities,
    gate: FLAG_ACTIVITIES,
  }),
];

const findOutputs = (key: string, label: string, of: string): OutcomeSpec[] =>
  done([
    { key: 'match_count', label: 'Match count', type: T.number },
    { key, label, type: T.array(T.record()), recordOf: of },
  ]);

export const STEP_DEFINITIONS: BlockDefinition[] = [
  // Agents and AI (slice 10)
  step(
    'run-custom-ai-agent',
    'Custom agent',
    'Run a custom AI agent and then use its response later in the workflow',
    'agents',
    {
      version: 2,
      keywords: ['ai', 'llm', 'openai', 'anthropic', 'google', 'model', 'message', 'assistant', 'ask agentic'],
      inputs: [
        input('run_as', 'Run as', 'actors', { required: false, variables: 'allowed', valueType: T.actor }),
        input('instructions', 'Prompt', 'rich-text', { variables: 'allowed', valueType: T.string }),
        input('system_instructions', 'System prompt', 'rich-text', {
          required: false,
          variables: 'allowed',
          valueType: T.string,
        }),
        input('output_mode', 'Output mode', 'enum', {
          required: false,
          options: [
            { value: 'plaintext', label: 'Plaintext' },
            { value: 'structured', label: 'Structured' },
          ],
          default: 'plaintext',
        }),
        input('structured_output_schema', 'Output schema', 'json-schema', {
          required: false,
          visibleWhen: { key: 'output_mode', values: ['structured'] },
        }),
        input('model', 'Model', 'model', { required: false }),
        input('tools', 'Tool access', 'tools', { required: false }),
      ],
      outcomes: done([{ key: 'response', label: 'Response', type: T.string }]),
      /** Structured output: one output per schema property (plus Response). */
      dynamicOutcomes: 'custom-agent',
      cost: DYNAMIC,
    },
  ),
  step('research-entity', 'Web agent', 'Run an AI research agent with web access', 'agents', {
    inputs: [
      input('input', 'Record', 'record', { required: false, variables: 'allowed', valueType: T.record() }),
      input('questions', 'Questions', 'questions'),
    ],
    outcomes: done([]),
    cost: DYNAMIC,
    unavailable: NOT_YET.ai,
  }),
  step(
    'classify-entity',
    'Classify record',
    'Use AI to summarize the attributes of a record or record in a list into a set of tags',
    'ai',
    {
      version: 3,
      inputs: [
        input('input', 'Record', 'record', { variables: 'allowed', valueType: T.record() }),
        input('tags', 'Tags', 'tags'),
        input('allow_multiple_tags', 'Allow multiple tags', 'boolean', { required: false }),
      ],
      outcomes: done([{ key: 'classification', label: 'Classification', type: T.string }]),
      cost: DYNAMIC,
      safeToRetry: true,
    },
  ),
  step('classify-text', 'Classify text', 'Use AI to classify input text into a set of tags', 'ai', {
    version: 3,
    inputs: [
      input('input', 'Input', 'rich-text', { variables: 'allowed', valueType: T.string }),
      input('tags', 'Tags', 'tags'),
      input('allow_multiple_tags', 'Allow multiple tags', 'boolean', { required: false }),
    ],
    outcomes: done([{ key: 'classification', label: 'Classification', type: T.string }]),
    cost: DYNAMIC,
    safeToRetry: true,
  }),
  step('summarize-entity', 'Summarize record', 'Summarize the attributes of a record or a record in a list', 'ai', {
    version: 2,
    inputs: [
      input('entity_instance', 'Record', 'record', { variables: 'allowed', valueType: T.record() }),
      input('instructions', 'Instructions', 'rich-text', { variables: 'allowed', valueType: T.string }),
    ],
    outcomes: done([{ key: 'summary', label: 'Summary', type: T.string }]),
    cost: DYNAMIC,
    safeToRetry: true,
  }),

  // Records
  step('create-record', 'Create record', 'Create a new record', 'records', {
    version: 2,
    inputs: [objectInput(), configured('object')],
    outcomes: done([recordOut('record', 'Record', 'object')]),
    cost: ONE,
  }),
  step('assert-record', 'Create or update record', 'Create or update a record', 'records', {
    version: 2,
    inputs: [
      objectInput(),
      input('matching_attribute', 'Matching attribute', 'unique-attribute', { of: 'object' }),
      configured('object'),
    ],
    outcomes: done([recordOut('record', 'Record', 'object')]),
    cost: ONE,
  }),
  step('update-record', 'Update record', 'Update an existing record', 'records', {
    version: 2,
    inputs: [
      objectInput(),
      input('record', 'Record', 'record', { variables: 'allowed', valueType: T.record(), of: 'object' }),
      configured('object'),
    ],
    outcomes: done([recordOut('record', 'Record', 'object')]),
    cost: ONE,
  }),
  step('find-records', 'Find records', 'Find records matching a set of filters', 'records', {
    inputs: [
      objectInput('entity', 'Object'),
      limitInput,
      input('filter', 'Filter', 'filter', { required: false, of: 'entity' }),
    ],
    outcomes: findOutputs('records', 'Records', 'entity'),
    safeToRetry: true,
  }),

  // Lists
  step('create-list-entry', 'Add record to list', 'Adds a record to a list creating a new list entry', 'lists', {
    version: 2,
    inputs: [
      listInput(),
      input('record', 'Record', 'record', { variables: 'allowed', valueType: T.record() }),
      configured('list'),
    ],
    outcomes: done([recordOut('list_entry', 'List entry', 'list')]),
    cost: ONE,
  }),
  step('update-list-entry', 'Update list entry', 'Update one or more attributes on a list entry', 'lists', {
    version: 2,
    inputs: [
      listInput(),
      input('entry', 'List entry', 'entry', { variables: 'allowed', valueType: T.record(), of: 'list' }),
      configured('list'),
    ],
    outcomes: done([recordOut('list_entry', 'List entry', 'list')]),
    cost: ONE,
  }),
  step('delete-list-entry', 'Delete list entry', 'Deletes a list entry from a list', 'lists', {
    inputs: [
      listInput(),
      input('entry', 'List entry', 'entry', { variables: 'allowed', valueType: T.record(), of: 'list' }),
    ],
    outcomes: done(null),
    cost: ONE,
  }),
  step('find-list-entries', 'Find list entries', 'Find entries in a list that match a filter condition', 'lists', {
    inputs: [listInput(), limitInput, input('filter', 'Filter', 'filter', { required: false, of: 'list' })],
    outcomes: findOutputs('entries', 'List entries', 'list'),
    safeToRetry: true,
  }),

  // Sequences (deferred)
  step('enroll-in-sequence', 'Enroll in sequence', 'Enroll a person record in a specific sequence', 'sequences', {
    inputs: [
      input('sequence', 'Sequence', 'enum'),
      input('recipient', 'Recipient', 'record', { variables: 'allowed', valueType: T.record() }),
      input('sender', 'Sender', 'actors', { variables: 'allowed', valueType: T.actor }),
    ],
    outcomes: done(null),
    cost: ONE,
    unavailable: NOT_YET.sequences,
  }),
  step('exit-from-sequence', 'Exit from sequence', 'Exit a person record from a specific sequence', 'sequences', {
    inputs: [
      input('sequence', 'Sequence', 'enum'),
      input('recipient', 'Recipient', 'record', { variables: 'allowed', valueType: T.record() }),
    ],
    outcomes: done(null),
    cost: ONE,
    unavailable: NOT_YET.sequences,
  }),

  // Tasks
  step('complete-task', 'Complete task', 'Complete a task', 'tasks', {
    inputs: [input('task', 'Task', 'task', { variables: 'only', valueType: T.task })],
    outcomes: done(null),
    cost: ONE,
  }),
  step('create-task', 'Create task', 'Create a new task', 'tasks', {
    version: 2,
    inputs: [
      input('content', 'Task content', 'rich-text', { variables: 'allowed', valueType: T.string }),
      input('due_at', 'Due', 'timestamp', { required: false, variables: 'allowed', valueType: T.timestamp }),
      input('references', 'Linked records', 'records', {
        required: false,
        variables: 'allowed',
        valueType: T.array(T.record()),
      }),
      input('assignees', 'Assignees', 'actors', { required: false, variables: 'allowed', valueType: T.array(T.actor) }),
    ],
    outcomes: done([{ key: 'created_task', label: 'Created task', type: T.task }]),
    cost: ONE,
  }),
  step('find-tasks', 'Find tasks', 'Find tasks matching a set of filters', 'tasks', {
    inputs: [limitInput, input('filter', 'Filter', 'task-filter', { required: false })],
    outcomes: done([
      { key: 'match_count', label: 'Match count', type: T.number },
      { key: 'tasks', label: 'Tasks', type: T.array(T.task) },
    ]),
    safeToRetry: true,
  }),
  step('update-task', 'Update task', 'Update an existing task', 'tasks', {
    inputs: [
      input('task', 'Task', 'task', { variables: 'only', valueType: T.task }),
      input('updated_fields', 'Fields to set', 'enum-multi', {
        options: [
          { value: 'content', label: 'Task content' },
          { value: 'due_at', label: 'Due' },
          { value: 'references', label: 'Linked records' },
          { value: 'assignees', label: 'Assignees' },
        ],
      }),
      input('content', 'Task content', 'rich-text', {
        required: false,
        variables: 'allowed',
        valueType: T.string,
        visibleWhen: { key: 'updated_fields', values: ['content'] },
      }),
      input('due_at', 'Due', 'timestamp', {
        required: false,
        variables: 'allowed',
        valueType: T.timestamp,
        visibleWhen: { key: 'updated_fields', values: ['due_at'] },
      }),
      input('references', 'Linked records', 'records', {
        required: false,
        variables: 'allowed',
        valueType: T.array(T.record()),
        visibleWhen: { key: 'updated_fields', values: ['references'] },
      }),
      input('assignees', 'Assignees', 'actors', {
        required: false,
        variables: 'allowed',
        valueType: T.array(T.actor),
        visibleWhen: { key: 'updated_fields', values: ['assignees'] },
      }),
    ],
    outcomes: done([{ key: 'updated_task', label: 'Task', type: T.task }]),
    cost: ONE,
  }),

  // Notes and meetings
  step('create-note', 'Create note', 'Create a new note', 'notes', {
    inputs: [
      input('title', 'Title', 'rich-text', { variables: 'allowed', valueType: T.string }),
      input('content', 'Content', 'rich-text', { required: false, variables: 'allowed', valueType: T.string }),
      input('record', 'Parent record', 'record', { variables: 'allowed', valueType: T.record() }),
    ],
    outcomes: done([{ key: 'created_note', label: 'Created note', type: T.note }]),
    cost: ONE,
  }),
  step('link-record-to-meeting', 'Link record to meeting', 'Link a record to a meeting', 'meetings', {
    inputs: [
      input('meeting', 'Meeting', 'meeting', { variables: 'only', valueType: T.meeting }),
      input('record', 'Record', 'record', { variables: 'allowed', valueType: T.record() }),
    ],
    outcomes: done([{ key: 'meeting', label: 'Meeting', type: T.meeting }]),
    cost: ONE,
    unavailable: NOT_YET.meetings,
  }),

  // Activities (flag-gated)
  step('create-activity', 'Create activity', 'Create a new activity', 'activities', {
    inputs: [input('activity', 'Activity', 'object'), configured('activity')],
    outcomes: done([{ key: 'activity_record', label: 'Activity', type: T.record() }]),
    cost: ONE,
    unavailable: NOT_YET.activities,
    gate: FLAG_ACTIVITIES,
  }),
  step('assert-activity', 'Create or update activity', 'Create or update an activity', 'activities', {
    inputs: [input('activity', 'Activity', 'object'), configured('activity')],
    outcomes: done([{ key: 'activity_record', label: 'Activity', type: T.record() }]),
    cost: ONE,
    unavailable: NOT_YET.activities,
    gate: FLAG_ACTIVITIES,
  }),
  step('update-activity', 'Update activity', 'Update an existing activity', 'activities', {
    inputs: [input('activity', 'Activity', 'object'), configured('activity')],
    outcomes: done([{ key: 'activity_record', label: 'Activity', type: T.record() }]),
    cost: ONE,
    unavailable: NOT_YET.activities,
    gate: FLAG_ACTIVITIES,
  }),
  step('find-activities', 'Find activities', 'Find activities matching a set of filters', 'activities', {
    inputs: [input('activity', 'Activity', 'object'), limitInput],
    outcomes: done([{ key: 'match_count', label: 'Match count', type: T.number }]),
    safeToRetry: true,
    unavailable: NOT_YET.activities,
    gate: FLAG_ACTIVITIES,
  }),

  // Calculations
  step(
    'execute-code',
    'Execute code',
    'Run custom JavaScript code to manipulate data within your workflow',
    'calculations',
    {
      inputs: [input('code', 'Code', 'code'), input('inputs', 'Inputs', 'code-inputs', { required: false })],
      outcomes: done([{ key: 'return', label: 'Output', type: T.json }]),
      cost: DYNAMIC,
      unavailable: NOT_YET.code,
    },
  ),
  step('query-particle-sql', 'SQL query', 'Query your records and lists with SQL', 'calculations', {
    inputs: [input('query', 'Query', 'code')],
    outcomes: done([
      { key: 'row_count', label: 'Row count', type: T.number },
      { key: 'total_row_count', label: 'Total row count', type: T.number },
    ]),
    cost: { type: 'fixed', amount: 10 },
    safeToRetry: true,
    unavailable: NOT_YET.sql,
    gate: { kind: 'enterprise', label: 'Enterprise' },
  }),
  step(
    'formula',
    'Formula',
    'Run calculations against number and currency attributes to produce a result',
    'calculations',
    {
      version: 2,
      inputs: [input('formula', 'Formula', 'rich-text', { variables: 'allowed', valueType: T.string })],
      outcomes: done([{ key: 'result', label: 'Result', type: T.number }]),
      safeToRetry: true,
    },
  ),
  step('adjust-timestamp', 'Adjust time', 'Apply an offset to a timestamp value', 'calculations', {
    version: 2,
    inputs: [
      input('timestamp', 'Timestamp', 'timestamp', { variables: 'allowed', valueType: T.timestamp }),
      input('offset', 'Offset', 'duration', {
        variables: 'allowed',
        valueType: T.number,
        options: DURATION_UNITS,
        default: { value: 1, unit: 'days' },
      }),
    ],
    outcomes: done([{ key: 'adjusted_timestamp', label: 'Adjusted timestamp', type: T.timestamp }]),
    safeToRetry: true,
  }),
  step(
    'aggregate-values',
    'Aggregate values',
    'Aggregate a list of numerical values using a specified aggregation method',
    'calculations',
    {
      version: 2,
      inputs: [
        input('values', 'Values', 'array', { variables: 'only', valueType: T.array(T.number) }),
        input('aggregation_type', 'Aggregation type', 'enum', {
          options: [
            { value: 'sum', label: 'Sum' },
            { value: 'mean', label: 'Average' },
            { value: 'min', label: 'Minimum' },
            { value: 'max', label: 'Maximum' },
          ],
          default: 'sum',
        }),
      ],
      outcomes: done([{ key: 'total', label: 'Total', type: T.number }]),
      safeToRetry: true,
    },
  ),
  step(
    'generate-random-number',
    'Random number',
    'Generate a random number for use later on in the workflow',
    'calculations',
    {
      version: 2,
      inputs: [
        input('min', 'Min', 'number', { variables: 'allowed', valueType: T.number }),
        input('max', 'Max', 'number', { variables: 'allowed', valueType: T.number }),
      ],
      outcomes: done([{ key: 'random_number', label: 'Random number', type: T.number }]),
      safeToRetry: true,
    },
  ),

  // Conditions
  step('guard', 'Filter', 'Filter allows the workflow to continue if a condition has been met', 'conditions', {
    inputs: [input('predicate', 'Conditions', 'predicate')],
    outcomes: done(null),
    safeToRetry: true,
  }),
  step('branch', 'If', 'If allows you to split a workflow into two paths based on a condition', 'conditions', {
    inputs: [input('predicate', 'Conditions', 'predicate')],
    outcomes: [
      { slug: 'true', label: 'True', outputs: null },
      { slug: 'false', label: 'False', outputs: null },
    ],
    safeToRetry: true,
  }),
  step('switch', 'Switch', 'Switch allows you to divide a workflow into several paths', 'conditions', {
    inputs: [input('cases', 'Cases', 'cases')],
    outcomes: [{ slug: 'default', label: 'Default', outputs: null }],
    dynamicOutcomes: 'switch-cases',
    safeToRetry: true,
  }),

  // Delays
  step('delay', 'Delay', 'Pause a workflow execution for a specified amount of time', 'delays', {
    inputs: [
      input('duration', 'Duration', 'duration', {
        variables: 'allowed',
        valueType: T.number,
        options: DURATION_UNITS,
        default: { value: 60, unit: 'seconds' },
      }),
    ],
    outcomes: done(null),
    safeToRetry: true,
  }),
  step('delay-until', 'Delay until', 'Pause a workflow execution until a specified date and time', 'delays', {
    inputs: [input('timestamp', 'Delay until', 'timestamp', { variables: 'allowed', valueType: T.timestamp })],
    outcomes: done(null),
    safeToRetry: true,
  }),

  // Workspace
  step(
    'round-robin',
    'Round robin',
    'Selects a member from a provided list of members or teams, useful for balanced assignment',
    'workspace',
    {
      version: 2,
      inputs: [usersInput('users', 'Rota')],
      outcomes: done([{ key: 'selected_user', label: 'Selected member', type: T.actor }]),
    },
  ),
  step(
    'send-workspace-celebration',
    'Celebration',
    'Celebrate success with your team by sprinkling confetti across your workspace',
    'workspace',
    {
      inputs: [
        input('type', 'Type', 'enum', {
          options: [
            { value: 'ceiling-drop', label: 'Ceiling Drop' },
            { value: 'fireworks', label: 'Fireworks' },
            { value: 'cannons', label: 'Cannons' },
          ],
          default: 'ceiling-drop',
        }),
        ...targetInputs,
      ],
      outcomes: done(null),
    },
  ),
  step(
    'send-workspace-toast',
    'Broadcast message',
    'Broadcast a message to all members of your workspace',
    'workspace',
    {
      inputs: [
        input('variant', 'Style', 'enum', {
          options: [
            { value: 'neutral', label: 'Neutral' },
            { value: 'success', label: 'Success' },
            { value: 'warning', label: 'Warning' },
            { value: 'error', label: 'Error' },
          ],
          default: 'neutral',
        }),
        ...targetInputs,
        input('title', 'Title', 'rich-text', { variables: 'allowed', valueType: T.string }),
        input('description', 'Description', 'rich-text', {
          required: false,
          variables: 'allowed',
          valueType: T.string,
        }),
        input('duration_seconds', 'Duration (seconds)', 'number', {
          required: false,
          variables: 'allowed',
          valueType: T.number,
          default: 5,
        }),
      ],
      outcomes: done(null),
    },
  ),

  // Utilities
  step('for-each', 'Loop', 'Run other blocks for each item in an iterable', 'utilities', {
    inputs: [
      input('iterable', 'Iterable', 'array', { variables: 'only', valueType: T.array(T.json) }),
      input('limit', 'Limit', 'number', { required: false, variables: 'allowed', valueType: T.number }),
    ],
    outcomes: [
      { slug: 'done', label: 'Complete', outputs: null },
      {
        slug: 'next',
        label: 'Next step',
        outputs: [
          { key: 'item', label: 'Current item', type: T.json },
          { key: 'position', label: 'Position', type: T.number },
          { key: 'count', label: 'Count', type: T.number },
          { key: 'limit', label: 'Limit', type: T.number },
          { key: 'total_count', label: 'Total count', type: T.number },
        ],
      },
    ],
    dynamicOutcomes: 'loop',
    safeToRetry: true,
  }),
  step('parse-json', 'Parse JSON', 'Parse a JSON string and extract structured fields', 'utilities', {
    inputs: [
      input('input', 'Input', 'json', { variables: 'allowed', valueType: T.json }),
      input('schema', 'Schema', 'json-schema'),
    ],
    outcomes: done([]),
    dynamicOutcomes: 'parse-json',
    safeToRetry: true,
  }),
  step('send-http-request', 'Send HTTP request', 'Send an HTTP request to an external URL', 'utilities', {
    inputs: [
      input('method', 'Method', 'enum', {
        options: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ value: m, label: m })),
        default: 'GET',
      }),
      input('url', 'URL', 'rich-text', { variables: 'allowed', valueType: T.string }),
      input('headers', 'Headers', 'headers', { required: false }),
      input('content_type', 'Content type', 'enum', {
        required: false,
        options: [
          { value: 'application/json', label: 'application/json' },
          { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' },
        ],
        default: 'application/json',
        visibleWhen: { key: 'method', values: ['POST', 'PUT', 'DELETE', 'PATCH'] },
      }),
      input('body', 'Body', 'json', {
        required: false,
        variables: 'allowed',
        valueType: T.json,
        hint: 'HTTP body of the request. If Content-Type is set, it will be validated.',
        visibleWhen: { key: 'method', values: ['POST', 'PUT', 'DELETE', 'PATCH'] },
      }),
    ],
    outcomes: done([
      { key: 'response_status', label: 'Status code', type: T.number },
      { key: 'response_body', label: 'Response body', type: T.string },
      { key: 'response_ok', label: 'Success', type: T.boolean },
    ]),
    cost: ONE,
  }),

  // Notifications
  step(
    'send-notification',
    'Send notification',
    'Sends a notification to workspace members or teams',
    'notifications',
    {
      inputs: [
        usersInput('users', 'Recipients'),
        input('title', 'Title', 'rich-text', { variables: 'allowed', valueType: T.string }),
        input('description', 'Description', 'rich-text', {
          required: false,
          variables: 'allowed',
          valueType: T.string,
        }),
      ],
      outcomes: done(null),
    },
  ),
  step(
    'send-request',
    'Send request',
    'Waits for a user to select from a list of actions before resuming workflow execution',
    'notifications',
    {
      inputs: [usersInput('users', 'Recipients'), input('title', 'Title', 'rich-text', { variables: 'allowed' })],
      outcomes: [],
      unavailable: NOT_YET.hitl,
      gate: { kind: 'feature-flag', label: 'workflow-human-in-the-loop-block' },
    },
  ),

  // Internal (flag-gated)
  step(
    'internal-everything-bagel',
    'Everything bagel',
    'Internal block that outputs every type of attribute',
    'internal',
    {
      outcomes: done([]),
      cost: ONE,
      safeToRetry: true,
      unavailable: NOT_YET.internal,
      gate: FLAG_INTERNAL,
    },
  ),
  step('internal-noop', 'Internal NOOP', 'Internal NOOP', 'internal', {
    outcomes: done(null),
    safeToRetry: true,
    unavailable: NOT_YET.internal,
    gate: FLAG_INTERNAL,
  }),
  step('repeat', 'Simple loop', 'Run a sequence of steps multiple times in a loop', 'internal', {
    inputs: [input('count', 'Count', 'number')],
    outcomes: [
      { slug: 'done', label: 'Complete', outputs: null },
      { slug: 'next', label: 'Next step', outputs: [] },
    ],
    safeToRetry: true,
    unavailable: NOT_YET.internal,
    gate: FLAG_INTERNAL,
  }),
];

export const BLOCK_DEFINITIONS: BlockDefinition[] = [...TRIGGER_DEFINITIONS, ...STEP_DEFINITIONS];
const BY_SLUG = new Map(BLOCK_DEFINITIONS.map((d) => [d.slug, d]));

/** The definition of a slug (undefined for unknown slugs, e.g. app blocks). */
export function blockDefinition(slug: string): BlockDefinition | undefined {
  return BY_SLUG.get(slug);
}

/** Trigger slugs a manual call can start (Trigger workflow button, record / entry / note entry points). */
export const MANUAL_TRIGGER_SLUGS = ['on-manual-run', 'on-record-action', 'on-list-entry-action', 'on-note-action'];

/** The output type a record output gets for a given definition. */
export function recordTypeOf(entityDefinitionId: string | null): WfType {
  return T.record(entityDefinitionId);
}
