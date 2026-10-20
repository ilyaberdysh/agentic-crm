// Step handlers of the first set (BACKLOG 8.04, 8.09; block-catalog §4, §7). Every write goes through the domain
// services — the single write path (I1) — inside the step's transaction, whose actor is the workflow
// (`{type:'workflow', id}`), so writes are attributed to the workflow and governed by its grants (B.12).
import {
  type BlockConfig,
  blockDefinition,
  type ConfigExpr,
  type Predicate,
  type ValueInput,
  WORKFLOW_LIMITS,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import type { LlmClient } from '../ai/llm.ts';
import { AI_WORKFLOW_HANDLERS } from '../ai/workflows/blocks.ts';
import { noteOps } from '../collab/notes.ts';
import { taskOps } from '../collab/tasks.ts';
import { newId } from '../ids.ts';
import type { entryOps } from '../lists/entries.ts';
import { notify } from '../notifications/produce.ts';
import type { Policies } from '../permissions.ts';
import { recordOps } from '../records/service.ts';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import { addIsoDuration } from '../time.ts';
import type { Tx } from '../tx.ts';
import { compileQuery } from '../views/compiler.ts';
import { resolvePredicate } from '../views/resolve.ts';
import { entryOf, switchCases, type TypeEnv } from './graph.ts';
import {
  asArray,
  inputsInvalid,
  isEmpty,
  type RecordValue,
  type Resolver,
  StepError,
  toMemberId,
  toNumber,
  toRecord,
  toText,
  toTimestamp,
  toWriteForm,
} from './runtime.ts';

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
}
export type HttpSender = (request: HttpRequest) => Promise<{ status: number; body: string }>;

export const fetchHttpSender: HttpSender = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body !== null ? { body: request.body } : {}),
    redirect: 'follow',
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  const body = request.method === 'HEAD' ? '' : await response.text();
  return { status: response.status, body: body.slice(0, 1_000_000) };
};

export interface StepDeps {
  policies: Policies;
  entries: ReturnType<typeof entryOps>;
  http: HttpSender;
  /** LLM client of the AI blocks (slice 10); unconfigured → the blocks fail with an execution error. */
  llm?: LlmClient;
}

export interface StepContext {
  tx: Tx;
  deps: StepDeps;
  env: TypeEnv;
  config: BlockConfig;
  resolver: Resolver;
  /** Evaluated inputs (shown as the block's configuration in the run viewer). */
  inputs: Record<string, unknown>;
  workflowId: string;
  workflowTitle: string;
  runId: string;
  executionId: string;
  blockId: string;
  slug: string;
  /** Workflow clock (tests move it). */
  now: Date;
  /** Workflow timezone (Settings tab): frame of reference for relative dates in Find filters. */
  timeZone: string;
}

export type StepResult =
  /** `cost`: credits of a dynamic-cost block (AI blocks: token-based). */
  | { kind: 'outcome'; outcome: string | null; outputs?: Record<string, unknown> | null; cost?: number }
  | { kind: 'delay'; until: string }
  | { kind: 'loop'; items: unknown[]; limit: number | null };

const done = (outputs: Record<string, unknown> | null = null): StepResult => ({
  kind: 'outcome',
  outcome: 'done',
  outputs,
});

/** An input's run-time value; inputs missing from the config take the catalogue default (what the panel shows). */
async function input(c: StepContext, key: string): Promise<unknown> {
  const expr = entryOf(c.config, key);
  const value =
    expr === undefined
      ? (blockDefinition(c.slug)?.inputs.find((i) => i.key === key)?.default ?? null)
      : await c.resolver.expr(expr);
  c.inputs[key] = value;
  return value;
}

async function textInput(c: StepContext, key: string): Promise<string> {
  const value = await c.resolver.text(entryOf(c.config, key));
  c.inputs[key] = value;
  return value;
}

async function required(c: StepContext, key: string, label: string): Promise<unknown> {
  const value = await input(c, key);
  if (isEmpty(value)) throw inputsInvalid(`"${label}" resolved to an empty value`);
  return value;
}

function defOf(c: StepContext, key: string, kind: 'object' | 'list'): DefInfo {
  const expr = entryOf(c.config, key);
  const ref =
    expr?.type === 'agentic-crm-object'
      ? expr.entityDefinitionId
      : expr?.type === 'agentic-crm-list'
        ? expr.listId
        : null;
  const def = c.env.def(ref);
  if (!def)
    throw inputsInvalid(`This step references ${kind === 'list' ? 'a list' : 'an object'} which does not exist`);
  c.inputs[key] = def.id;
  return def;
}

function recordOf(value: unknown, def: DefInfo | null, label: string): RecordValue {
  const record = toRecord(value);
  if (!record) throw inputsInvalid(`"${label}" is not a record`);
  if (def && record.entityDefinitionId !== def.id) {
    throw inputsInvalid(
      def.entityType === 'collection-entry'
        ? 'Please provide a List Entry, not a Record'
        : `"${label}" is a record of another object`,
    );
  }
  return record;
}

/** configured_attributes → values map (+ per-attribute append mode when overwrite_multi_value is off). */
async function configuredValues(
  c: StepContext,
  def: DefInfo,
): Promise<{ values: Record<string, ValueInput[]>; modes: Record<string, 'replace' | 'append'> }> {
  const expr = entryOf(c.config, 'configured_attributes');
  const values: Record<string, ValueInput[]> = {};
  const modes: Record<string, 'replace' | 'append'> = {};
  const shown: Record<string, unknown> = {};
  if (expr?.type !== 'object') return { values, modes };
  for (const [key, entry] of Object.entries(expr.entries)) {
    const attr: AttrDef | undefined = def.byId.get(key) ?? def.bySlug.get(key);
    if (!attr) throw inputsInvalid('This step sets an attribute that no longer exists');
    const valueExpr: ConfigExpr | undefined =
      entry.type === 'object' && 'value' in entry.entries ? entry.entries.value : entry;
    const overwrite =
      entry.type === 'object' && entry.entries.overwrite_multi_value?.type === 'boolean'
        ? entry.entries.overwrite_multi_value.value
        : true;
    const raw = await c.resolver.expr(valueExpr);
    shown[attr.id] = raw;
    if (isEmpty(raw)) {
      values[attr.id] = [];
      continue;
    }
    const items = attr.isMultiselect ? asArray(raw) : [Array.isArray(raw) ? raw[0] : raw];
    const out: ValueInput[] = [];
    for (const item of items) {
      if (isEmpty(item)) continue;
      out.push({ value: valueExpr?.type === 'value' ? item : await toWriteForm(c.tx, attr, item) });
    }
    values[attr.id] = out;
    if (attr.isMultiselect && !overwrite) modes[attr.id] = 'append';
  }
  c.inputs.configured_attributes = shown;
  return { values, modes };
}

const recordOut = (def: DefInfo, id: string) => ({ entityDefinitionId: def.id, entityInstanceId: id });

async function findIds(c: StepContext, def: DefInfo, limitKey: string): Promise<{ count: number; ids: string[] }> {
  await c.deps.policies.assertCan(c.tx, def.id, 'read_entity_instance');
  const limit = Math.round(toNumber(await input(c, limitKey)) ?? WORKFLOW_LIMITS.findDefaultLimit);
  if (limit < 1 || limit > WORKFLOW_LIMITS.findMaxLimit) {
    throw inputsInvalid(`The limit must be between 1 and ${WORKFLOW_LIMITS.findMaxLimit}`);
  }
  const filterExpr = entryOf(c.config, 'filter');
  const predicate =
    filterExpr?.type === 'filter' ? ((await c.resolver.filter(filterExpr.predicate)) as Predicate | null) : null;
  c.inputs.filter = predicate;
  if (!def.projectionTable) return { count: 0, ids: [] };
  const resolved = await resolvePredicate(c.tx, def, predicate, {
    now: c.now.toISOString(),
    timeZone: c.timeZone,
    memberId: null,
  });
  const query = await compileQuery(c.tx, def, resolved, []);
  const { rows } = await sql<{ id: string; total: string }>`
    SELECT q.id, count(*) OVER () AS total FROM (${sql.raw(query)}) q LIMIT ${limit}`.execute(c.tx.db);
  return { count: Number(rows[0]?.total ?? 0), ids: rows.map((r) => r.id) };
}

/** Members of a mix of actors and teams (teams expand to their members), in order, without duplicates. */
async function membersOf(tx: Tx, values: unknown[]): Promise<string[]> {
  const out: string[] = [];
  for (const v of values) {
    const teamId = v && typeof v === 'object' ? (v as { teamId?: unknown }).teamId : undefined;
    if (typeof teamId === 'string') {
      const rows = await tx.db
        .selectFrom('workspace_team_memberships as t')
        .innerJoin('workspace_members as m', 'm.id', 't.member_id')
        .select('t.member_id')
        .where('t.team_id', '=', teamId)
        .where('m.removed_at', 'is', null)
        .orderBy('m.first_name')
        .orderBy('m.id')
        .execute();
      for (const r of rows) if (!out.includes(r.member_id)) out.push(r.member_id);
      continue;
    }
    const id = toMemberId(v);
    if (id && !out.includes(id)) out.push(id);
  }
  if (out.length === 0) return out;
  const live = await tx.db
    .selectFrom('workspace_members')
    .select('id')
    .where('id', 'in', out)
    .where('removed_at', 'is', null)
    .where('access_level', '!=', 'suspended')
    .execute();
  const ok = new Set(live.map((r) => r.id));
  return out.filter((id) => ok.has(id));
}

const DURATION_ISO: Record<string, (n: number) => string> = {
  seconds: (n) => `PT${n}S`,
  minutes: (n) => `PT${n}M`,
  hours: (n) => `PT${n}H`,
  days: (n) => `P${n}D`,
  weeks: (n) => `P${n * 7}D`,
  months: (n) => `P${n}M`,
  years: (n) => `P${n}Y`,
};

function addDuration(fromIso: string, value: number, unit: string): string {
  const make = DURATION_ISO[unit];
  if (!make) throw inputsInvalid(`Unknown unit "${unit}"`);
  if (!Number.isFinite(value)) throw inputsInvalid('Invalid duration');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (!Number.isInteger(abs) && (unit === 'months' || unit === 'years')) {
    throw inputsInvalid('Months and years must be whole numbers');
  }
  return addIsoDuration(fromIso, `${sign}${make(abs)}`);
}

async function durationInput(c: StepContext, key: string): Promise<{ value: number; unit: string }> {
  const raw = (await input(c, key)) as { value?: unknown; unit?: string } | null;
  const value = toNumber(raw?.value);
  if (value === null) throw inputsInvalid('The duration resolved to an empty value');
  return { value, unit: raw?.unit ?? 'seconds' };
}

// Arithmetic of the Formula block: numbers, + - * /, parentheses and unary minus.
export function evaluateFormula(text: string): number {
  const tokens = text.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[()+\-*/]|\S/gi) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const fail = (): never => {
    throw inputsInvalid('Invalid formula');
  };
  const primary = (): number => {
    const t = tokens[i++];
    if (t === undefined) return fail();
    if (t === '(') {
      const v = sum();
      if (tokens[i++] !== ')') fail();
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    const n = Number(t);
    if (!Number.isFinite(n)) fail();
    return n;
  };
  const product = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++];
      const r = primary();
      if (op === '/' && r === 0) throw inputsInvalid('Invalid formula: division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++];
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  if (tokens.length === 0) fail();
  const result = sum();
  if (i !== tokens.length || !Number.isFinite(result)) fail();
  return Math.round(result * 1e12) / 1e12;
}

function parseJsonSchemaProps(text: string | null): { root: string | null; props: Record<string, string> } {
  try {
    const schema = JSON.parse(text ?? '') as { type?: string; properties?: Record<string, { type?: string }> };
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) props[k] = v?.type ?? 'any';
    return { root: schema.type ?? null, props };
  } catch {
    throw inputsInvalid('Invalid JSON schema');
  }
}

function coerceJson(value: unknown, type: string): unknown {
  if (value === undefined || value === null) return null;
  switch (type) {
    case 'string':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'number':
    case 'integer':
      return toNumber(value);
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true';
    default:
      return value;
  }
}

async function broadcast(c: StepContext, kind: 'toast' | 'celebration', payload: Record<string, unknown>) {
  const target = toText(await input(c, 'target_type')) || 'workspace';
  const recipients =
    target === 'specific-users' ? await membersOf(c.tx, asArray(await input(c, 'targeted_users'))) : null;
  const id = newId();
  await c.tx.db
    .insertInto('workflow_broadcasts')
    .values({
      id,
      workspace_id: c.tx.workspaceId,
      workflow_id: c.workflowId,
      run_id: c.runId,
      kind,
      payload: JSON.stringify(payload),
      recipient_member_ids: recipients,
    })
    .execute();
  let audience: { userIds: string[] } | null = null;
  if (recipients) {
    const users = recipients.length
      ? await c.tx.db.selectFrom('workspace_members').select('user_id').where('id', 'in', recipients).execute()
      : [];
    audience = { userIds: users.map((u) => u.user_id) };
  }
  c.tx.emit('workflow-broadcast', id, { kind, workflowId: c.workflowId }, audience);
}

type Handler = (c: StepContext) => Promise<StepResult>;

export const STEP_HANDLERS: Record<string, Handler> = {
  async 'create-record'(c) {
    const def = defOf(c, 'object', 'object');
    await c.deps.policies.assertCan(c.tx, def.id, 'create_entity_instance');
    const { values } = await configuredValues(c, def);
    const id = newId();
    await recordOps.create(c.tx, { entityDefinitionId: def.id, entityInstanceId: id, values });
    return done({ record: recordOut(def, id) });
  },

  async 'update-record'(c) {
    const def = defOf(c, 'object', 'object');
    const record = recordOf(await required(c, 'record', 'Record'), def, 'Record');
    await c.deps.policies.assertCan(c.tx, def.id, 'update_entity_instance');
    const { values, modes } = await configuredValues(c, def);
    await recordOps.update(c.tx, {
      entityDefinitionId: def.id,
      entityInstanceId: record.entityInstanceId,
      values,
      multiselectModes: modes,
    });
    return done({ record: recordOut(def, record.entityInstanceId) });
  },

  async 'assert-record'(c) {
    const def = defOf(c, 'object', 'object');
    const matching = entryOf(c.config, 'matching_attribute');
    const attrId =
      matching?.type === 'agentic-crm-attribute'
        ? matching.attributeDefinitionId
        : toText(await c.resolver.expr(matching));
    const attr = def.byId.get(attrId) ?? def.bySlug.get(attrId);
    if (!attr) throw inputsInvalid('The matching attribute no longer exists');
    c.inputs.matching_attribute = attr.id;
    const { values, modes } = await configuredValues(c, def);
    const match = values[attr.id]?.[0];
    if (!match) throw inputsInvalid(`Set a value for the matching attribute "${attr.title}"`);
    await c.deps.policies.assertCan(c.tx, def.id, 'read_entity_instance');
    const found = await recordOps.findByUniqueValues(c.tx, {
      entityDefinitionId: def.id,
      attributeDefinitionId: attr.id,
      values: [match],
    });
    const existing = found.entityInstanceIds[0];
    if (existing) {
      await c.deps.policies.assertCan(c.tx, def.id, 'update_entity_instance');
      await recordOps.update(c.tx, {
        entityDefinitionId: def.id,
        entityInstanceId: existing,
        values,
        multiselectModes: modes,
      });
      return done({ record: recordOut(def, existing) });
    }
    await c.deps.policies.assertCan(c.tx, def.id, 'create_entity_instance');
    const id = newId();
    await recordOps.create(c.tx, { entityDefinitionId: def.id, entityInstanceId: id, values });
    return done({ record: recordOut(def, id) });
  },

  async 'find-records'(c) {
    const def = defOf(c, 'entity', 'object');
    const { count, ids } = await findIds(c, def, 'limit');
    return done({ match_count: count, records: ids.map((id) => recordOut(def, id)) });
  },

  async 'create-list-entry'(c) {
    const list = defOf(c, 'list', 'list');
    const record = recordOf(await required(c, 'record', 'Record'), null, 'Record');
    const { values } = await configuredValues(c, list);
    const id = newId();
    await c.deps.entries.add(c.tx, {
      listId: list.id,
      parentRecords: [record],
      entryIds: [id],
      values,
      onDuplicate: 'keep',
    });
    return done({ list_entry: recordOut(list, id) });
  },

  async 'update-list-entry'(c) {
    const list = defOf(c, 'list', 'list');
    const entry = recordOf(await required(c, 'entry', 'List entry'), list, 'List entry');
    await c.deps.policies.assertCan(c.tx, list.id, 'update_entity_instance');
    const { values, modes } = await configuredValues(c, list);
    await recordOps.update(c.tx, {
      entityDefinitionId: list.id,
      entityInstanceId: entry.entityInstanceId,
      values,
      multiselectModes: modes,
    });
    return done({ list_entry: recordOut(list, entry.entityInstanceId) });
  },

  async 'delete-list-entry'(c) {
    const list = defOf(c, 'list', 'list');
    const entry = recordOf(await required(c, 'entry', 'List entry'), list, 'List entry');
    await c.deps.entries.remove(c.tx, { listId: list.id, entryIds: [entry.entityInstanceId] });
    return { kind: 'outcome', outcome: 'done', outputs: null };
  },

  async 'find-list-entries'(c) {
    const list = defOf(c, 'list', 'list');
    const { count, ids } = await findIds(c, list, 'limit');
    return done({ match_count: count, entries: ids.map((id) => recordOut(list, id)) });
  },

  async 'complete-task'(c) {
    const task = (await required(c, 'task', 'Task')) as { taskId?: string };
    if (typeof task?.taskId !== 'string') throw inputsInvalid('"Task" is not a task');
    await taskOps.setCompleted(c.tx, { policies: c.deps.policies }, { taskId: task.taskId, completed: true });
    return { kind: 'outcome', outcome: 'done', outputs: null };
  },

  async 'create-task'(c) {
    const content = (await textInput(c, 'content')).trim();
    if (!content) throw inputsInvalid('"Task content" resolved to an empty value');
    const due = toTimestamp(await input(c, 'due_at'));
    const references = asArray(await input(c, 'references'))
      .map(toRecord)
      .filter((r): r is RecordValue => r !== null);
    const assignees = await membersOf(c.tx, asArray(await input(c, 'assignees')));
    const id = newId();
    await taskOps.create(
      c.tx,
      { policies: c.deps.policies },
      {
        id,
        content: { text: content.slice(0, 2000), mentions: [] },
        deadline: due ? { kind: 'datetime', at: due } : null,
        assigneeMemberIds: assignees,
        linkedRecords: references,
      },
    );
    return done({ created_task: { taskId: id } });
  },

  async 'update-task'(c) {
    const task = (await required(c, 'task', 'Task')) as { taskId?: string };
    if (typeof task?.taskId !== 'string') throw inputsInvalid('"Task" is not a task');
    const fields = asArray(await input(c, 'updated_fields')).map((f) => toText(f));
    const patch: Parameters<typeof taskOps.update>[2] = { taskId: task.taskId };
    if (fields.includes('content')) {
      const text = (await textInput(c, 'content')).trim();
      if (!text) throw inputsInvalid('"Task content" resolved to an empty value');
      patch.content = { text: text.slice(0, 2000), mentions: [] };
    }
    if (fields.includes('due_at')) {
      const due = toTimestamp(await input(c, 'due_at'));
      patch.deadline = due ? { kind: 'datetime', at: due } : null;
    }
    if (fields.includes('references')) {
      patch.linkedRecords = asArray(await input(c, 'references'))
        .map(toRecord)
        .filter((r): r is RecordValue => r !== null);
    }
    if (fields.includes('assignees'))
      patch.assigneeMemberIds = await membersOf(c.tx, asArray(await input(c, 'assignees')));
    await taskOps.update(c.tx, { policies: c.deps.policies }, patch);
    return done({ updated_task: { taskId: task.taskId } });
  },

  async 'find-tasks'(c) {
    const limit = Math.round(toNumber(await input(c, 'limit')) ?? WORKFLOW_LIMITS.findDefaultLimit);
    if (limit < 1 || limit > WORKFLOW_LIMITS.findMaxLimit) {
      throw inputsInvalid(`The limit must be between 1 and ${WORKFLOW_LIMITS.findMaxLimit}`);
    }
    const filter = ((await input(c, 'filter')) ?? {}) as Record<string, unknown>;
    const assignees = await membersOf(c.tx, asArray(filter.assignees));
    const records = asArray(filter.linked_records)
      .map(toRecord)
      .filter((r): r is RecordValue => r !== null);
    let q = c.tx.db.selectFrom('tasks as t').select(['t.id']).where('t.deleted_at', 'is', null);
    if (typeof filter.is_completed === 'boolean') {
      q = filter.is_completed ? q.where('t.completed_at', 'is not', null) : q.where('t.completed_at', 'is', null);
    }
    const before = toTimestamp(filter.deadline_before);
    const after = toTimestamp(filter.deadline_after);
    if (before) q = q.where('t.deadline_at', '<', before);
    if (after) q = q.where('t.deadline_at', '>', after);
    if (assignees.length > 0) {
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('task_assignees as a')
            .select('a.task_id')
            .whereRef('a.task_id', '=', 't.id')
            .where('a.member_id', 'in', assignees),
        ),
      );
    }
    if (records.length > 0) {
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('task_records as r')
            .select('r.task_id')
            .whereRef('r.task_id', '=', 't.id')
            .where(
              'r.entity_instance_id',
              'in',
              records.map((r) => r.entityInstanceId),
            ),
        ),
      );
    }
    const rows = await q.orderBy('t.created_at', 'desc').orderBy('t.id').execute();
    return done({ match_count: rows.length, tasks: rows.slice(0, limit).map((r) => ({ taskId: r.id })) });
  },

  async 'create-note'(c) {
    const title = (await textInput(c, 'title')).trim();
    const content = await textInput(c, 'content');
    const record = recordOf(await required(c, 'record', 'Parent record'), null, 'Parent record');
    const id = newId();
    await noteOps.create(
      c.tx,
      { policies: c.deps.policies },
      { id, title: title.slice(0, 1000), parentRecords: [record] },
      content.trim() ? { markdown: content } : {},
    );
    return done({ created_note: { noteId: id } });
  },

  async formula(c) {
    const text = await c.resolver.text(entryOf(c.config, 'formula'), (v) => {
      const n = toNumber(v);
      if (n === null) throw inputsInvalid('Invalid formula: a variable resolved to an empty value');
      return `(${n})`;
    });
    c.inputs.formula = text;
    return done({ result: evaluateFormula(text) });
  },

  async 'adjust-timestamp'(c) {
    const ts = toTimestamp(await required(c, 'timestamp', 'Timestamp'));
    if (!ts) throw inputsInvalid('"Timestamp" is not a date');
    const { value, unit } = await durationInput(c, 'offset');
    return done({ adjusted_timestamp: addDuration(ts, value, unit) });
  },

  async 'aggregate-values'(c) {
    const values = asArray(await input(c, 'values'))
      .map(toNumber)
      .filter((n): n is number => n !== null);
    const kind = toText(await input(c, 'aggregation_type')) || 'sum';
    let total: number | null;
    if (values.length === 0) total = kind === 'sum' ? 0 : null;
    else if (kind === 'mean') total = values.reduce((a, b) => a + b, 0) / values.length;
    else if (kind === 'min') total = Math.min(...values);
    else if (kind === 'max') total = Math.max(...values);
    else total = values.reduce((a, b) => a + b, 0);
    return done({ total });
  },

  async 'generate-random-number'(c) {
    const min = toNumber(await required(c, 'min', 'Min'));
    const max = toNumber(await required(c, 'max', 'Max'));
    if (min === null || max === null || min > max) throw inputsInvalid('Min must be less than or equal to Max');
    const value =
      Number.isInteger(min) && Number.isInteger(max)
        ? min + Math.floor(Math.random() * (max - min + 1))
        : min + Math.random() * (max - min);
    return done({ random_number: value });
  },

  async guard(c) {
    const ok = await c.resolver.condition(entryOf(c.config, 'predicate') as ConfigExpr);
    c.inputs.predicate = ok;
    // Filter stops this path when the condition is false.
    return { kind: 'outcome', outcome: ok ? 'done' : null, outputs: null };
  },

  async branch(c) {
    const ok = await c.resolver.condition(entryOf(c.config, 'predicate') as ConfigExpr);
    c.inputs.predicate = ok;
    return { kind: 'outcome', outcome: ok ? 'true' : 'false', outputs: null };
  },

  async switch(c) {
    const results: Record<string, boolean> = {};
    for (const kase of switchCases(c.config)) {
      const ok = kase.predicate ? await c.resolver.condition(kase.predicate) : false;
      results[kase.id] = ok;
      if (ok) {
        c.inputs.cases = results;
        return { kind: 'outcome', outcome: kase.id, outputs: null };
      }
    }
    c.inputs.cases = results;
    return { kind: 'outcome', outcome: 'default', outputs: null };
  },

  async delay(c) {
    const { value, unit } = await durationInput(c, 'duration');
    if (value < 0) throw inputsInvalid('The duration cannot be negative');
    return { kind: 'delay', until: addDuration(c.now.toISOString(), value, unit) };
  },

  async 'delay-until'(c) {
    const ts = toTimestamp(await required(c, 'timestamp', 'Delay until'));
    if (!ts) throw inputsInvalid('"Delay until" is not a date');
    return { kind: 'delay', until: ts };
  },

  async 'round-robin'(c) {
    const members = await membersOf(c.tx, asArray(await required(c, 'users', 'Rota')));
    if (members.length === 0) throw inputsInvalid('The rota has no active members');
    const state = await c.tx.db
      .selectFrom('workflow_round_robin_state')
      .select('last_member_id')
      .where('workflow_id', '=', c.workflowId)
      .where('block_id', '=', c.blockId)
      .forUpdate()
      .executeTakeFirst();
    const last = state?.last_member_id ? members.indexOf(state.last_member_id) : -1;
    const selected = members[(last + 1) % members.length] as string;
    await c.tx.db
      .insertInto('workflow_round_robin_state')
      .values({
        workspace_id: c.tx.workspaceId,
        workflow_id: c.workflowId,
        block_id: c.blockId,
        last_member_id: selected,
      })
      .onConflict((oc) =>
        oc.columns(['workflow_id', 'block_id']).doUpdateSet({ last_member_id: selected, updated_at: c.tx.now }),
      )
      .execute();
    return done({ selected_user: { actorType: 'workspace-member', actorId: selected } });
  },

  async 'send-workspace-celebration'(c) {
    const type = toText(await input(c, 'type')) || 'ceiling-drop';
    await broadcast(c, 'celebration', { type });
    return { kind: 'outcome', outcome: 'done', outputs: null };
  },

  async 'send-workspace-toast'(c) {
    const title = (await textInput(c, 'title')).trim();
    if (!title) throw inputsInvalid('"Title" resolved to an empty value');
    const description = (await textInput(c, 'description')).trim();
    const variant = toText(await input(c, 'variant')) || 'neutral';
    const duration = toNumber(await input(c, 'duration_seconds')) ?? 5;
    await broadcast(c, 'toast', { variant, title, description: description || null, durationSeconds: duration });
    return { kind: 'outcome', outcome: 'done', outputs: null };
  },

  async 'for-each'(c) {
    const items = asArray(await input(c, 'iterable'));
    const limit = toNumber(await input(c, 'limit'));
    return { kind: 'loop', items, limit: limit === null ? null : Math.max(0, Math.floor(limit)) };
  },

  async 'parse-json'(c) {
    const raw = await required(c, 'input', 'Input');
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw inputsInvalid('The input is not valid JSON');
      }
    }
    const schemaExpr = entryOf(c.config, 'schema');
    const schemaText = schemaExpr?.type === 'string' ? schemaExpr.value : null;
    const { root, props } = parseJsonSchemaProps(schemaText);
    if (root === 'object' || Object.keys(props).length > 0) {
      const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
      const outputs: Record<string, unknown> = {};
      for (const [key, type] of Object.entries(props)) outputs[key] = coerceJson(obj[key], type);
      return done(outputs);
    }
    return done({ value: parsed });
  },

  async 'send-http-request'(c) {
    const method = toText(await input(c, 'method')) || 'GET';
    const url = (await textInput(c, 'url')).trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw inputsInvalid('The URL is invalid');
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:')
      throw inputsInvalid('The URL must use http or https');
    const headers: Record<string, string> = {};
    const headerExpr = entryOf(c.config, 'headers');
    if (headerExpr?.type === 'array') {
      for (const item of headerExpr.items) {
        if (item.type !== 'object') continue;
        const name = (await c.resolver.text(item.entries.name)).trim();
        if (name) headers[name] = await c.resolver.text(item.entries.value);
      }
    }
    c.inputs.headers = Object.keys(headers);
    let body: string | null = null;
    if (!['GET', 'HEAD'].includes(method)) {
      const contentType = toText(await input(c, 'content_type')) || 'application/json';
      const value = await input(c, 'body');
      if (!isEmpty(value)) {
        if (contentType === 'application/x-www-form-urlencoded') {
          const obj = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
          body = new URLSearchParams(Object.entries(obj).map(([k, v]): [string, string] => [k, toText(v)])).toString();
        } else body = typeof value === 'string' ? value : JSON.stringify(value);
        headers['content-type'] ??= contentType;
      }
    }
    let response: { status: number; body: string };
    try {
      response = await c.deps.http({ method, url, headers, body, timeoutMs: WORKFLOW_LIMITS.httpTimeoutMs });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') throw new StepError('timed-out', 'Step took too long to execute');
      throw new StepError('execution-error', `Request failed: ${(err as Error).message}`);
    }
    return done({
      response_status: response.status,
      response_body: response.body,
      response_ok: response.status >= 200 && response.status < 300,
    });
  },

  async 'send-notification'(c) {
    const recipients = await membersOf(c.tx, asArray(await required(c, 'users', 'Recipients')));
    const title = (await textInput(c, 'title')).trim();
    if (!title) throw inputsInvalid('"Title" resolved to an empty value');
    const description = (await textInput(c, 'description')).trim();
    await notify(
      c.tx,
      recipients.map((memberId) => ({
        type: 'workflow-message' as const,
        recipientMemberId: memberId,
        payload: {
          workflowBlockNotificationRootId: c.executionId,
          workflowId: c.workflowId,
          workflowTitle: c.workflowTitle,
          title,
          description: description || null,
        },
        actor: { type: 'workflow', id: c.workflowId },
        dedupeKey: `workflow-message:${c.executionId}`,
      })),
    );
    return { kind: 'outcome', outcome: 'done', outputs: null };
  },

  // Slice 10: Custom agent, Classify record, Classify text, Summarize record.
  ...AI_WORKFLOW_HANDLERS,
};

/** The run-time type key of each output, for the run viewer (from the block's resolved outcome). */
export function outputTypesOf(
  outcome: { outputs: { key: string; type: unknown }[] | null } | undefined,
): Record<string, unknown> | null {
  if (!outcome?.outputs) return null;
  return Object.fromEntries(outcome.outputs.map((o) => [o.key, o.type]));
}
