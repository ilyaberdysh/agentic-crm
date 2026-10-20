// Run-time evaluation of block configs (internal-api §4): variables resolve against the outputs of the executions on
// the path that led to the current one (nearest first, first non-empty data source wins, then the fallback), with
// attribute drilling into records (read through the domain, with the workflow's own read access), sub-fields of
// composite values and list indexes; rich text renders to a string; conditions evaluate on the shared predicate AST
// (X-20); values are coerced to what an input or an attribute expects.
import {
  type AttributeValue,
  type Condition,
  type ConfigExpr,
  conditionToAst,
  type FilterOperator,
  type Predicate,
  type VariableExpr,
  type VariableOperation,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import type { Policies } from '../permissions.ts';
import { recordOps } from '../records/service.ts';
import type { AttrDef } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import type { TypeEnv } from './graph.ts';

/** A failure with a runs.md §5 reason. */
export class StepError extends Error {
  constructor(
    readonly reason:
      | 'execution-error'
      | 'inputs-invalid'
      | 'exceeded-max-executions'
      | 'block-not-available'
      | 'timed-out'
      | 'insufficient-credits',
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

export const inputsInvalid = (message: string) => new StepError('inputs-invalid', message);

export interface ExecRow {
  id: string;
  block_id: string;
  outcome: string | null;
  status: string;
  parent_execution_id: string | null;
  outputs: unknown;
}

export const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

// ---------------------------------------------------------------------------------------------------------------
// Attribute values → run-time forms

async function optionTitles(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.db.selectFrom('select_options').select(['id', 'title']).where('id', 'in', ids).execute();
  return new Map(rows.map((r) => [r.id, r.title]));
}

export async function runtimeValues(tx: Tx, attr: AttrDef, values: AttributeValue[]): Promise<unknown> {
  const ids = values
    .map((v) => {
      const val = v.value as { selectOptionId?: string; pipelineStageId?: string };
      return val?.selectOptionId ?? val?.pipelineStageId ?? null;
    })
    .filter((id): id is string => id !== null);
  const titles = await optionTitles(tx, ids);
  const convert = (raw: unknown): unknown => {
    const v = raw as Record<string, unknown>;
    switch (attr.type) {
      case 'select':
        return { selectOptionId: v.selectOptionId, title: titles.get(String(v.selectOptionId)) ?? null };
      case 'pipeline':
        return { pipelineStageId: v.pipelineStageId, title: titles.get(String(v.pipelineStageId)) ?? null };
      case 'actor-reference':
        return { actorType: v.referencedActorType, actorId: v.referencedActorId };
      case 'domain':
        return v.normalizedDomain ?? null;
      case 'email-address':
        return v.originalEmailAddress ?? null;
      case 'phone-number':
        return v.originalPhoneNumber ?? null;
      case 'entity-reference':
        return { entityDefinitionId: v.entityDefinitionId, entityInstanceId: v.entityInstanceId };
      default:
        return raw;
    }
  };
  const converted = values.map((v) => convert(v.value));
  return attr.isMultiselect ? converted : (converted[0] ?? null);
}

// ---------------------------------------------------------------------------------------------------------------
// Coercion

export function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v))
    return v
      .map(toText)
      .filter((s) => s !== '')
      .join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.title === 'string') return o.title;
    if (typeof o.fullName === 'string') return o.fullName;
    if (typeof o.currencyValue === 'number') return String(o.currencyValue);
    if ('line1' in o || 'locality' in o) {
      return ['line1', 'line2', 'line3', 'line4', 'locality', 'region', 'postcode', 'countryCode']
        .map((k) => o[k])
        .filter((s) => typeof s === 'string' && s !== '')
        .join(', ');
    }
    if (typeof o.name === 'string') return o.name;
    return JSON.stringify(v);
  }
  return String(v);
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && v !== null && typeof (v as { currencyValue?: unknown }).currencyValue === 'number') {
    return (v as { currencyValue: number }).currencyValue;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

export function toTimestamp(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface RecordValue {
  entityDefinitionId: string;
  entityInstanceId: string;
}

export function toRecord(v: unknown): RecordValue | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.entityInstanceId === 'string' && typeof o.entityDefinitionId === 'string') {
    return { entityDefinitionId: o.entityDefinitionId, entityInstanceId: o.entityInstanceId };
  }
  return null;
}

export function toMemberId(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.actorId === 'string' && (o.actorType === undefined || o.actorType === 'workspace-member')) {
    return o.actorId;
  }
  if (typeof o.referencedActorId === 'string') return o.referencedActorId;
  return null;
}

export const asArray = (v: unknown): unknown[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** A run-time value → the write form of an attribute (values.ts valueInputSchemas). */
export async function toWriteForm(tx: Tx, attr: AttrDef, v: unknown): Promise<unknown> {
  const fail = () => inputsInvalid(`Invalid value for "${attr.title}"`);
  switch (attr.type) {
    case 'text':
    case 'domain':
    case 'email-address':
    case 'phone-number':
      return toText(v);
    case 'number':
    case 'rating': {
      const n = toNumber(v);
      if (n === null) throw fail();
      return attr.type === 'rating' ? Math.round(n) : n;
    }
    case 'checkbox':
      if (typeof v === 'boolean') return v;
      if (v === 'true' || v === 'false') return v === 'true';
      throw fail();
    case 'currency': {
      if (v && typeof v === 'object' && 'currencyValue' in v) {
        const c = v as { currencyValue: number; currencyCode?: string | null };
        return { currencyValue: c.currencyValue, currencyCode: c.currencyCode ?? null };
      }
      const n = toNumber(v);
      if (n === null) throw fail();
      return { currencyValue: n };
    }
    case 'date': {
      const t = toTimestamp(v);
      if (!t) throw fail();
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : t.slice(0, 10);
    }
    case 'timestamp': {
      const t = toTimestamp(v);
      if (!t) throw fail();
      return t;
    }
    case 'select':
    case 'pipeline': {
      const key = attr.type === 'select' ? 'selectOptionId' : 'pipelineStageId';
      const o = v as Record<string, unknown> | null;
      if (o && typeof o === 'object' && typeof (o.selectOptionId ?? o.pipelineStageId) === 'string') {
        return { [key]: (o.selectOptionId ?? o.pipelineStageId) as string };
      }
      const title = toText(v).trim().toLowerCase();
      const rows = await tx.db
        .selectFrom('select_options')
        .select(['id', 'title'])
        .where('attribute_id', '=', attr.id)
        .where('is_archived', '=', false)
        .execute();
      const match = rows.find((r) => r.title.trim().toLowerCase() === title);
      if (!match) throw inputsInvalid(`"${toText(v)}" is not an option of "${attr.title}"`);
      return { [key]: match.id };
    }
    case 'entity-reference': {
      const r = toRecord(v);
      if (!r) throw fail();
      return r;
    }
    case 'actor-reference': {
      const id = toMemberId(v);
      if (!id) throw fail();
      return { referencedActorType: 'workspace-member', referencedActorId: id };
    }
    case 'personal-name': {
      if (v && typeof v === 'object') return v;
      const full = toText(v).trim();
      const [first, ...rest] = full.split(/\s+/);
      return { firstName: first ?? '', lastName: rest.join(' '), fullName: full };
    }
    case 'location':
      if (v && typeof v === 'object') return v;
      return { line1: toText(v) };
    default:
      return v;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Resolver

export class Resolver {
  private readonly recordCache = new Map<string, Promise<Record<string, AttributeValue[]>>>();

  constructor(
    private readonly tx: Tx,
    private readonly env: TypeEnv,
    private readonly policies: Policies,
    private readonly executions: Map<string, ExecRow>,
    /** The upstream execution of the block being evaluated (its parent). */
    private readonly fromExecutionId: string | null,
  ) {}

  /** The nearest completed upstream execution of (block, outcome). */
  private sourceOf(blockId: string, outcome: string): ExecRow | undefined {
    let id = this.fromExecutionId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const e = this.executions.get(id);
      if (!e) return undefined;
      if (e.block_id === blockId && e.outcome === outcome && e.status === 'completed') return e;
      id = e.parent_execution_id;
    }
    return undefined;
  }

  private async recordValues(r: RecordValue): Promise<Record<string, AttributeValue[]>> {
    const key = r.entityInstanceId;
    let p = this.recordCache.get(key);
    if (!p) {
      p = (async () => {
        await this.policies.assertCan(this.tx, r.entityDefinitionId, 'read_entity_instance');
        const rec = await recordOps.get(this.tx, {
          entityDefinitionId: r.entityDefinitionId,
          entityInstanceId: r.entityInstanceId,
        });
        return rec.values;
      })();
      this.recordCache.set(key, p);
    }
    return p;
  }

  private async property(value: unknown, name: string): Promise<unknown> {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (typeof o.actorId === 'string') {
      if (name === 'type') return o.actorType ?? 'workspace-member';
      const member = await this.tx.db
        .selectFrom('workspace_members')
        .select(['first_name', 'last_name', 'email_address'])
        .where('id', '=', o.actorId)
        .executeTakeFirst();
      if (name === 'name') return member ? `${member.first_name} ${member.last_name}`.trim() : null;
      if (name === 'emailAddress') return member?.email_address ?? null;
      if (name === 'teams') {
        const teams = await this.tx.db
          .selectFrom('workspace_team_memberships')
          .select('team_id')
          .where('member_id', '=', o.actorId)
          .execute();
        return teams.map((t) => ({ teamId: t.team_id }));
      }
      return null;
    }
    if (typeof o.taskId === 'string') {
      const task = await this.tx.db.selectFrom('tasks').selectAll().where('id', '=', o.taskId).executeTakeFirst();
      if (!task) return null;
      if (name === 'content') return task.content;
      if (name === 'deadlineAt') return task.deadline_at;
      if (name === 'isCompleted') return task.completed_at !== null;
      if (name === 'createdAt') return task.created_at;
      if (name === 'assignees') {
        const rows = await this.tx.db
          .selectFrom('task_assignees')
          .select('member_id')
          .where('task_id', '=', o.taskId)
          .orderBy('position')
          .execute();
        return rows.map((r) => ({ actorType: 'workspace-member', actorId: r.member_id }));
      }
      if (name === 'linkedRecords') {
        const rows = await this.tx.db
          .selectFrom('task_records')
          .select(['entity_definition_id', 'entity_instance_id'])
          .where('task_id', '=', o.taskId)
          .orderBy('position')
          .execute();
        return rows.map((r) => ({
          entityDefinitionId: r.entity_definition_id,
          entityInstanceId: r.entity_instance_id,
        }));
      }
      return null;
    }
    if (typeof o.noteId === 'string') {
      const note = await this.tx.db.selectFrom('notes').selectAll().where('id', '=', o.noteId).executeTakeFirst();
      if (!note) return null;
      if (name === 'title') return note.title;
      if (name === 'createdAt') return note.created_at;
      if (name === 'parentRecord') {
        const parent = await this.tx.db
          .selectFrom('note_records')
          .select(['entity_definition_id', 'entity_instance_id'])
          .where('note_id', '=', o.noteId)
          .orderBy('position')
          .executeTakeFirst();
        return parent
          ? { entityDefinitionId: parent.entity_definition_id, entityInstanceId: parent.entity_instance_id }
          : null;
      }
      if (name === 'content') {
        const { rows } = await sql<{ markdown: string | null }>`
          SELECT markdown FROM documents WHERE id = ${note.document_id}::uuid`.execute(this.tx.db);
        return rows[0]?.markdown ?? '';
      }
      return null;
    }
    if (typeof o.teamId === 'string' && name === 'name') {
      const team = await this.tx.db
        .selectFrom('workspace_teams')
        .select('name')
        .where('id', '=', o.teamId)
        .executeTakeFirst();
      return team?.name ?? null;
    }
    if (name === 'id') return o.selectOptionId ?? o.pipelineStageId ?? null;
    if (name === 'owner' && typeof o.ownerMembershipId === 'string') {
      return { actorType: 'workspace-member', actorId: o.ownerMembershipId };
    }
    return o[name] ?? null;
  }

  private async apply(value: unknown, op: VariableOperation): Promise<unknown> {
    if (Array.isArray(value) && op.type !== 'index') {
      const out: unknown[] = [];
      for (const item of value) {
        const v = await this.apply(item, op);
        if (Array.isArray(v)) out.push(...v);
        else if (!isEmpty(v)) out.push(v);
      }
      return out;
    }
    switch (op.type) {
      case 'field':
        return value && typeof value === 'object' ? ((value as Record<string, unknown>)[op.name] ?? null) : null;
      case 'index': {
        if (!Array.isArray(value)) return null;
        return value[op.index < 0 ? value.length + op.index : op.index] ?? null;
      }
      case 'property':
        return this.property(value, op.name);
      case 'attribute': {
        const record = toRecord(value);
        if (!record) return null;
        const attr = this.env.def(op.entityDefinitionId)?.byId.get(op.attributeDefinitionId);
        if (!attr) throw inputsInvalid('This step uses a deleted variable');
        const values = await this.recordValues(record);
        return runtimeValues(this.tx, attr, values[attr.id] ?? []);
      }
    }
  }

  /** The value of a variable (first non-empty data source, else the fallback); null when empty. */
  async variable(v: VariableExpr): Promise<unknown> {
    for (const m of v.matchers) {
      const source = this.sourceOf(m.blockId, m.outcome);
      if (!source) continue;
      const [first, ...rest] = m.operations;
      if (!first || first.type !== 'field') continue;
      let value: unknown = ((source.outputs ?? {}) as Record<string, unknown>)[first.name] ?? null;
      for (const op of rest) {
        if (isEmpty(value)) break;
        value = await this.apply(value, op);
      }
      if (!isEmpty(value)) return value;
    }
    return v.fallback ? this.expr(v.fallback) : null;
  }

  /** Any config expression → its run-time value. */
  async expr(e: ConfigExpr | null | undefined): Promise<unknown> {
    if (!e) return null;
    switch (e.type) {
      case 'null':
        return null;
      case 'string':
      case 'number':
      case 'boolean':
      case 'timestamp':
      case 'date':
        return e.value;
      case 'value':
      case 'json':
        return e.value ?? null;
      case 'duration':
        return { value: toNumber(await this.expr(e.value)), unit: e.unit };
      case 'agentic-crm-object':
        return this.env.def(e.entityDefinitionId)?.id ?? e.entityDefinitionId;
      case 'agentic-crm-list':
        return this.env.def(e.listId)?.id ?? e.listId;
      case 'agentic-crm-attribute':
        return { entityDefinitionId: e.entityDefinitionId, attributeDefinitionId: e.attributeDefinitionId };
      case 'entity-reference':
        return { entityDefinitionId: e.entityDefinitionId, entityInstanceId: e.entityInstanceId };
      case 'actor':
        return { actorType: 'workspace-member', actorId: e.actorId };
      case 'team':
        return { teamId: e.teamId };
      case 'variable':
        return this.variable(e);
      case 'rich-text':
        return this.text(e);
      case 'object': {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(e.entries)) out[k] = await this.expr(v);
        return out;
      }
      case 'array': {
        const out: unknown[] = [];
        for (const item of e.items) {
          const v = await this.expr(item);
          if (item.type === 'variable' && Array.isArray(v)) out.push(...v);
          else out.push(v);
        }
        return out;
      }
      case 'binary-predicate':
      case 'predicate-group':
        return this.condition(e);
      case 'filter':
        return this.filter(e.predicate);
    }
  }

  /** Rich text / string / variable → text (variables rendered with their text form; empty → ''). */
  async text(e: ConfigExpr | null | undefined, render: (v: unknown) => string = toText): Promise<string> {
    if (!e) return '';
    if (e.type !== 'rich-text') return render(await this.expr(e));
    const lines: string[] = [];
    for (const block of e.blocks) {
      const vars = [...block.variables].sort((a, b) => a.start - b.start);
      let out = '';
      let cursor = 0;
      for (const v of vars) {
        out += block.plaintext.slice(cursor, v.start);
        out += render(await this.variable(v.variable));
        cursor = v.start + 1;
      }
      out += block.plaintext.slice(cursor);
      lines.push(out);
    }
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------------------------------------------
  // Conditions (shared AST)

  async condition(node: ConfigExpr): Promise<boolean> {
    return this.evaluate(conditionToAst(node));
  }

  private async evaluate(c: Condition): Promise<boolean> {
    if ('and' in c) {
      for (const p of c.and) if (!(await this.evaluate(p))) return false;
      return true;
    }
    if ('or' in c) {
      for (const p of c.or) if (await this.evaluate(p)) return true;
      return false;
    }
    const subject = await this.expr(c.subject);
    const isList = Array.isArray(subject);
    const values = asArray(subject).filter((v) => !isEmpty(v));
    let matched = true;
    for (const constraint of c.constraints) {
      const right = constraint.value ? await this.expr(constraint.value) : null;
      matched &&= matches(values, isList, constraint.operator, right);
    }
    return c.mode === 'must' ? matched : !matched;
  }

  /** A Find* filter with its variable constraint values replaced by static values. */
  async filter(p: Predicate | null): Promise<Predicate | null> {
    if (!p) return null;
    if ('and' in p) return { and: (await Promise.all(p.and.map((c) => this.filter(c)))) as Predicate[] };
    if ('or' in p) return { or: (await Promise.all(p.or.map((c) => this.filter(c)))) as Predicate[] };
    const constraints = [];
    for (const c of p.constraints) {
      const value = c.value as { type?: string } | undefined;
      if (value && typeof value === 'object' && value.type === 'variable') {
        const resolved = await this.variable(value as VariableExpr);
        constraints.push({ ...c, value: filterValue(resolved) });
      } else constraints.push(c);
    }
    return { ...p, constraints };
  }
}

/** A run-time value as a filter constraint value (ids for references, primitives otherwise). */
function filterValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(filterValue);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return o.entityInstanceId ?? o.actorId ?? o.selectOptionId ?? o.pipelineStageId ?? o.currencyValue ?? toText(v);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison semantics of the condition leaves

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function identity(v: unknown): string | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const id = o.entityInstanceId ?? o.actorId ?? o.teamId ?? o.taskId ?? o.noteId;
    if (typeof id === 'string') return id;
  }
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T|$)/;

function compare(a: unknown, b: unknown): number | null {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null && typeof a !== 'string' && typeof b !== 'string') return na - nb;
  if (typeof a === 'string' && typeof b === 'string' && DATE_RE.test(a) && DATE_RE.test(b)) {
    if (a.length === 10 || b.length === 10)
      return a.slice(0, 10) < b.slice(0, 10) ? -1 : a.slice(0, 10) > b.slice(0, 10) ? 1 : 0;
    return Date.parse(a) - Date.parse(b);
  }
  if (na !== null && nb !== null) return na - nb;
  const sa = norm(toText(a));
  const sb = norm(toText(b));
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function equal(a: unknown, b: unknown): boolean {
  const ia = identity(a);
  const ib = identity(b) ?? (typeof b === 'string' ? b : null);
  if (ia !== null) return ia === ib || (ib === null && norm(toText(a)) === norm(toText(b)));
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  const c = compare(a, b);
  return c === 0;
}

function matches(values: unknown[], isList: boolean, op: FilterOperator, right: unknown): boolean {
  switch (op) {
    case 'empty':
      return values.length === 0;
    case 'not-empty':
      return values.length > 0;
    case 'eq':
      return values.some((v) => equal(v, right));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return values.some((v) => {
        const c = compare(v, right);
        if (c === null) return false;
        return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
      });
    case 'contains':
      if (isList) return values.some((v) => equal(v, right));
      return values.some((v) => norm(toText(v)).includes(norm(toText(right))));
    case 'starts-with':
      return values.some((v) => norm(toText(v)).startsWith(norm(toText(right))));
    case 'ends-with':
      return values.some((v) => norm(toText(v)).endsWith(norm(toText(right))));
    case 'in':
      return values.some((v) => asArray(right).some((r) => equal(v, r)));
    case 'all':
      return asArray(right).every((r) => values.some((v) => equal(v, r)));
  }
}
