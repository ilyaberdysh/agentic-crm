// AI autofill attributes (I-ai-calls/ai-attributes.md §1–6; BACKLOG 10.05, acceptance 5–6).
//   configure  — ai_autofill_configuration on attribute create / update (types summarize / classify / prompt
//                completion; the web agent is deferred), Required / Unique switched off.
//   estimate   — the "Recalculate values" confirmation data: records × credits per value.
//   run        — confirmed run over records, a selection or a whole column (snapshot): annotations → queued, jobs
//                `ai-attribute.run` enqueued in the same transaction.
//   processRunBatch (worker) — per record: queued → running → LLM → value written by the actor
//                {type:'ai-autofill-attribute', id: attribute} + annotation complete / error + credits in the ledger,
//                in one transaction; every step is invalidated, so a value never stays "thinking" (X-24).
//   failRunBatch / sweepStaleAiAnnotations — the last failed attempt and a minute sweep end open annotations.
import {
  type AiAutofillConfigurationInput,
  type AiRunEstimate,
  type AiRunInput,
  type AiRunResult,
  type AiRunTarget,
  aiAutofillConfigurationInputSchema,
  aiRunInputSchema,
  zebraSize,
} from '@agentic-crm/contracts';
import { type Database, jsonb, sql } from '@agentic-crm/db';
import { displayText, type ReferenceInfo, v } from '@agentic-crm/formula';
import { creditOps, creditsExhausted } from '../ai/credits/ledger.ts';
import { type LlmClient, type LlmResponse, workspaceModelFor } from '../ai/llm.ts';
import { type ServiceContext, systemContext } from '../context.ts';
import { badRequest, DomainError, notFound } from '../errors.ts';
import { loadReferenceData } from '../formulas/context.ts';
import { toAnnotation } from '../formulas/service.ts';
import { type RowLookups, rowToRV } from '../formulas/values.ts';
import { newId } from '../ids.ts';
import { JOB_NAMES, type JobQueue } from '../jobs/queue.ts';
import { engineFor, labelAttribute } from '../records/engine.ts';
import {
  type AttrDef,
  aiCreditsPerValue,
  type DefInfo,
  invalidateDefinitions,
  loadDefinition,
  loadDefinitionsByIds,
  resolveAttribute,
} from '../schema/model.ts';
import { insertOptions } from '../schema/service.ts';
import { enterWorkspace, runAsOwner, runInWorkspace, type Tx } from '../tx.ts';
import { viewOps } from '../views/service.ts';
import { buildPrompt, parseNumber, parseOptions, parseText, type RecordLine } from './prompts.ts';

/** Records per `ai-attribute.run` job. */
export const AI_RUN_BATCH = 20;
/** Queued / running annotations older than this become errors (sweep). */
export const AI_STALE_MS = 10 * 60_000;

const ALLOWED_TYPES: Record<string, AttrDef['type'][]> = {
  'prompt-completion': ['text', 'number', 'currency'],
  'summarize-record': ['text'],
  'classify-record': ['select'],
  'research-web': ['text', 'number', 'currency'],
};

export const aiActor = (attributeId: string) => ({ type: 'ai-autofill-attribute' as const, id: attributeId });

export interface AiDeps {
  database: Database;
  jobs: JobQueue;
  llm: LlmClient;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration

export async function configureAiAutofill(
  tx: Tx,
  def: DefInfo,
  attr: AttrDef,
  input: AiAutofillConfigurationInput | null,
): Promise<void> {
  if (input === null) {
    await tx.db.deleteFrom('ai_attribute_configs').where('attribute_id', '=', attr.id).execute();
  } else {
    const config = aiAutofillConfigurationInputSchema.parse(input);
    if (config.type === 'research-web') {
      throw badRequest('VALIDATION_ERROR', 'The web agent autofill type is not available');
    }
    if (attr.formula) throw badRequest('VALIDATION_ERROR', 'Formula attributes cannot use AI autofill');
    if (!(ALLOWED_TYPES[config.type] ?? []).includes(attr.type)) {
      throw badRequest('VALIDATION_ERROR', `AI autofill "${config.type}" is not available for ${attr.type} attributes`);
    }
    if (config.type === 'prompt-completion' && !config.prompt?.plaintext.trim()) {
      throw badRequest('VALIDATION_ERROR', 'Prompt completion needs a prompt');
    }
    for (const variable of config.prompt?.variables ?? []) {
      if (config.prompt?.plaintext[variable.startPosition] !== '_') {
        throw badRequest('VALIDATION_ERROR', 'Each prompt variable must sit on a "_" placeholder');
      }
      if (variable.path[0]?.entityDefinitionId !== def.id) {
        throw badRequest('VALIDATION_ERROR', 'Prompt variables start at the attribute’s object');
      }
      const defs = await loadDefinitionsByIds(
        tx,
        variable.path.map((h) => h.entityDefinitionId),
      );
      for (const hop of variable.path) {
        if (!defs.get(hop.entityDefinitionId)?.byId.get(hop.attributeDefinitionId)) {
          throw badRequest('VALIDATION_ERROR', 'Unknown attribute in a prompt variable', { path: variable.path });
        }
      }
    }
    await sql`
      INSERT INTO ai_attribute_configs (attribute_id, workspace_id, entity_definition_id, is_enabled, type, prompt,
        is_option_creation_enabled, created_by, created_at, updated_at)
      VALUES (${attr.id}::uuid, ${tx.workspaceId}::uuid, ${def.id}::uuid, ${config.isEnabled}, ${config.type},
        ${jsonb(config.prompt)}::jsonb, ${config.isOptionCreationEnabled}, ${jsonb(tx.ctx.actor)}::jsonb,
        ${tx.now}::timestamptz, ${tx.now}::timestamptz)
      ON CONFLICT (attribute_id) DO UPDATE SET is_enabled = excluded.is_enabled, type = excluded.type,
        prompt = excluded.prompt, is_option_creation_enabled = excluded.is_option_creation_enabled,
        updated_at = excluded.updated_at`.execute(tx.db);
    // With AI autofill on, the Required / Unique constraints do not apply (ai-attributes §3).
    await tx.db
      .updateTable('attribute_definitions')
      .set({ is_required: false, is_unique: false, updated_at: tx.now })
      .where('id', '=', attr.id)
      .execute();
    if (attr.isUnique)
      await tx.db
        .updateTable('attribute_values')
        .set({ unique_key: null })
        .where('attribute_id', '=', attr.id)
        .execute();
  }
  invalidateDefinitions(tx);
  tx.emit('attribute-definition', attr.id, { entityDefinitionId: def.id });
  tx.emit('attribute-definition-list', def.id, { entityDefinitionId: def.id });
}

// ---------------------------------------------------------------------------------------------------------------
// Estimate and run

async function aiAttribute(tx: Tx, input: { entityDefinitionId: string; attributeDefinitionId: string }) {
  const def = await loadDefinition(tx, input.entityDefinitionId);
  const attr = resolveAttribute(def, input.attributeDefinitionId);
  if (!attr.aiAutofill || !attr.aiAutofill.isEnabled) {
    throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" has no AI autofill`);
  }
  if (attr.isArchived) throw badRequest('ATTRIBUTE_ARCHIVED', `Attribute "${attr.apiSlug}" is archived`);
  return { def, attr, config: attr.aiAutofill };
}

async function targetIds(tx: Tx, def: DefInfo, target: AiRunTarget): Promise<string[]> {
  if (target.type === 'records') {
    const ids = [...new Set(target.entityInstanceIds)];
    const rows = await tx.db
      .selectFrom('entity_instances')
      .select('id')
      .where('id', 'in', ids)
      .where('entity_definition_id', '=', def.id)
      .where('archived_at', 'is', null)
      .where('merged_at', 'is', null)
      .execute();
    const live = new Set(rows.map((r) => r.id));
    return ids.filter((id) => live.has(id));
  }
  const probe = await viewOps.chunk(tx, { snapshotId: target.snapshotId, start: 0, size: 1 });
  if (probe.entityDefinitionId !== def.id) {
    throw notFound('The snapshot has expired or does not exist', { snapshot_id: target.snapshotId });
  }
  const edges = target.type === 'column' ? (probe.total > 0 ? [0, probe.total] : []) : target.zebraEdges;
  if (edges.length === 0 || zebraSize(edges) === 0) return [];
  return (await viewOps.resolveSelection(tx, { snapshotId: target.snapshotId, zebraEdges: edges })).ids;
}

/** Workspace pool credits left this month (null = no budget). AI attributes are automation ('workspace') spend. */
async function poolRemaining(tx: Tx): Promise<number | null> {
  const left = (await creditOps.balance(tx, null)).poolRemaining;
  return Number.isFinite(left) ? Math.max(0, left) : null;
}

export async function estimateRun(tx: Tx, input: AiRunInput): Promise<AiRunEstimate> {
  const data = aiRunInputSchema.parse(input);
  const { def, config } = await aiAttribute(tx, data);
  const ids = await targetIds(tx, def, data.target);
  const perValue = aiCreditsPerValue(config.type);
  return {
    recordCount: ids.length,
    creditsPerValue: perValue,
    credits: ids.length * perValue,
    creditsRemaining: await poolRemaining(tx),
  };
}

export async function startRun(tx: Tx, input: AiRunInput, deps: Pick<AiDeps, 'jobs' | 'llm'>): Promise<AiRunResult> {
  if (!deps.llm.configured) throw new DomainError(503, 'AI_NOT_CONFIGURED', 'AI is not configured for this workspace');
  const data = aiRunInputSchema.parse(input);
  const { def, attr, config } = await aiAttribute(tx, data);
  const ids = await targetIds(tx, def, data.target);
  const perValue = aiCreditsPerValue(config.type);
  const credits = ids.length * perValue;
  // Budgets (1 credit = $0.01): the monthly workspace pool must cover the confirmed cost.
  await creditOps.assertAvailable(tx, { memberId: null, spend: 'workspace' });
  const remaining = await poolRemaining(tx);
  if (remaining !== null && credits > remaining) {
    throw creditsExhausted('Not enough credits left', { credits, remaining });
  }
  const runId = newId();
  await tx.db
    .insertInto('ai_attribute_runs')
    .values({
      id: runId,
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      attribute_id: attr.id,
      target: data.target.type,
      record_count: ids.length,
      credits_per_value: perValue,
      credits_estimated: credits,
      status: ids.length === 0 ? 'complete' : 'queued',
      requested_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      completed_at: ids.length === 0 ? tx.now : null,
    })
    .execute();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    await sql`
      INSERT INTO entity_annotations AS e (workspace_id, entity_definition_id, attribute_id, instance_id, ai_status,
        ai_status_changed_at, ai_error, ai_run_id, updated_at)
      SELECT ${tx.workspaceId}::uuid, ${def.id}::uuid, ${attr.id}::uuid, id, 'queued', ${tx.now}::timestamptz, NULL,
        ${runId}::uuid, ${tx.now}::timestamptz
      FROM unnest(${chunk}::uuid[]) AS id
      ON CONFLICT (attribute_id, instance_id) DO UPDATE SET ai_status = 'queued',
        ai_status_changed_at = excluded.ai_status_changed_at, ai_error = NULL, ai_run_id = excluded.ai_run_id,
        updated_at = excluded.updated_at`.execute(tx.db);
  }
  for (let i = 0; i < ids.length; i += AI_RUN_BATCH) {
    await deps.jobs.send(tx, JOB_NAMES.aiAttributeRun, {
      workspaceId: tx.workspaceId,
      runId,
      instanceIds: ids.slice(i, i + AI_RUN_BATCH),
    });
  }
  if (ids.length > 0) {
    tx.emit('entity-annotation', attr.id, {
      entityDefinitionId: def.id,
      attributeDefinitionId: attr.id,
      entityInstanceIds: ids,
    });
  }
  tx.emit('ai-attribute-run', runId, { attributeDefinitionId: attr.id, entityDefinitionId: def.id });
  const rows = await tx.db.selectFrom('entity_annotations').selectAll().where('ai_run_id', '=', runId).execute();
  const annotations = Object.fromEntries(rows.map((r) => [r.instance_id, toAnnotation(attr, r.instance_id, r)]));
  return {
    runId,
    recordCount: ids.length,
    creditsPerValue: perValue,
    credits,
    creditsRemaining: remaining,
    annotations,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Execution (worker)

interface Prepared {
  system: string;
  prompt: string;
  model: string;
  /** Classify: structured output `{options: [title…]}`. */
  outputSchema: Record<string, unknown> | null;
}

async function recordLabels(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await tx.db
    .selectFrom('entity_instances')
    .select(['id', 'entity_definition_id'])
    .where('id', 'in', ids)
    .execute();
  const defs = await loadDefinitionsByIds(tx, [...new Set(rows.map((r) => r.entity_definition_id))]);
  const labelIds = [...defs.values()].map((d) => labelAttribute(d)?.id).filter((x): x is string => !!x);
  if (labelIds.length === 0) return out;
  const values = await tx.db
    .selectFrom('attribute_values')
    .select(['instance_id', 'v_text'])
    .where('instance_id', 'in', ids)
    .where('attribute_id', 'in', labelIds)
    .where('active_until', 'is', null)
    .execute();
  for (const v of values) if (v.v_text) out.set(v.instance_id, v.v_text);
  return out;
}

/** Every attribute value of the record as text lines (what Summarize / Classify see). */
async function recordContext(tx: Tx, def: DefInfo, instanceId: string, exclude: string): Promise<RecordLine[]> {
  const rows = await tx.db
    .selectFrom('attribute_values')
    .selectAll()
    .where('instance_id', '=', instanceId)
    .where('active_until', 'is', null)
    .orderBy('attribute_id')
    .orderBy('sort_order')
    .execute();
  const optionIds = rows.map((r) => r.v_ref).filter((x): x is string => x !== null);
  const titles = new Map<string, string>();
  if (optionIds.length > 0) {
    const opts = await tx.db
      .selectFrom('select_options')
      .select(['id', 'title'])
      .where('id', 'in', optionIds)
      .execute();
    for (const o of opts) titles.set(o.id, o.title);
  }
  const memberRows = optionIds.length
    ? await tx.db
        .selectFrom('workspace_members')
        .select(['id', 'first_name', 'last_name', 'email_address'])
        .where('id', 'in', optionIds)
        .execute()
    : [];
  const members = new Map(
    memberRows.map((m) => [m.id, { name: `${m.first_name} ${m.last_name}`.trim() || null, email: m.email_address }]),
  );
  const labels = await recordLabels(
    tx,
    rows.filter((r) => def.byId.get(r.attribute_id)?.type === 'entity-reference').map((r) => r.v_ref as string),
  );
  const lookups: RowLookups = { optionTitle: (id) => titles.get(id) ?? '', member: (id) => members.get(id) ?? null };
  const lines: RecordLine[] = [];
  for (const attr of def.attrs) {
    if (attr.id === exclude || attr.isHidden || attr.isArchived || attr.systemAttributeType === 'id') continue;
    const texts = rows
      .filter((r) => r.attribute_id === attr.id)
      .map((r) =>
        attr.type === 'entity-reference'
          ? (labels.get(r.v_ref as string) ?? null)
          : displayText(rowToRV(attr.type, r, lookups), v(attr.type)),
      )
      .filter((t): t is string => t !== null && t !== '');
    if (texts.length > 0) lines.push({ title: attr.title, text: texts.join(', ') });
  }
  return lines;
}

/** Prompt with each variable placeholder replaced by the record's value. */
async function renderGuidance(tx: Tx, attr: AttrDef, instanceId: string): Promise<string | null> {
  const prompt = attr.aiAutofill?.prompt;
  if (!prompt) return null;
  if (prompt.variables.length === 0) return prompt.plaintext;
  const defs = await loadDefinitionsByIds(
    tx,
    prompt.variables.flatMap((x) => x.path.map((h) => h.entityDefinitionId)),
  );
  const refs: ReferenceInfo[] = prompt.variables.map((variable, index) => {
    const attrs = variable.path.map((h) => defs.get(h.entityDefinitionId)?.byId.get(h.attributeDefinitionId));
    const last = attrs.at(-1);
    return {
      index,
      tokenId: `var-${index}`,
      annotation: {
        type: 'entity-variable',
        startPosition: variable.startPosition,
        length: 1,
        path: variable.path,
        field: null,
      },
      type: v(last?.type ?? 'text'),
      attribute: last
        ? {
            id: last.id,
            entityDefinitionId: last.entityDefinitionId,
            title: last.title,
            type: last.type,
            isMultiselect: last.isMultiselect,
          }
        : null,
      path: variable.path,
      field: null,
      singular: attrs.every((a) => a && !a.isMultiselect),
      fanout: attrs.slice(0, -1).some((a) => a?.isMultiselect),
      archived: attrs.some((a) => !a || a.isArchived),
      needsHistory: false,
    };
  });
  const data = (await loadReferenceData(tx, refs, defs, [instanceId])).get(instanceId);
  let out = '';
  let cursor = 0;
  const sorted = refs
    .map((r) => ({ r, at: prompt.variables[r.index]?.startPosition ?? 0 }))
    .sort((a, b) => a.at - b.at);
  for (const { r, at } of sorted) {
    out += prompt.plaintext.slice(cursor, at);
    const value = data?.values[r.index] ?? null;
    const kind = r.attribute?.type ?? 'text';
    out += displayText(value, r.singular ? v(kind) : { t: 'array', element: v(kind) }) ?? '(empty)';
    cursor = at + 1;
  }
  return out + prompt.plaintext.slice(cursor);
}

async function optionTitles(tx: Tx, attr: AttrDef) {
  return tx.db
    .selectFrom('select_options')
    .select(['id', 'title'])
    .where('attribute_id', '=', attr.id)
    .where('is_archived', '=', false)
    .orderBy('sort_order')
    .execute();
}

async function prepare(tx: Tx, def: DefInfo, attr: AttrDef, instanceId: string): Promise<Prepared> {
  const config = attr.aiAutofill;
  if (!config) throw new Error('AI autofill is off');
  const sees = config.type !== 'prompt-completion';
  const options = config.type === 'classify-record' ? (await optionTitles(tx, attr)).map((o) => o.title) : [];
  const built = buildPrompt({
    type: config.type,
    objectNoun: def.singularNoun,
    attributeTitle: attr.title,
    attributeType: attr.type,
    guidance: await renderGuidance(tx, attr, instanceId),
    record: sees ? await recordContext(tx, def, instanceId, attr.id) : [],
    options,
    multiple: attr.isMultiselect,
    allowNewOptions: config.isOptionCreationEnabled,
  });
  const fixed = !config.isOptionCreationEnabled && options.length > 0;
  const outputSchema =
    config.type === 'classify-record'
      ? {
          type: 'object',
          properties: {
            options: {
              type: 'array',
              items: fixed ? { type: 'string', enum: options } : { type: 'string' },
              ...(attr.isMultiselect ? {} : { maxItems: 1 }),
            },
          },
          required: ['options'],
          additionalProperties: false,
        }
      : null;
  return { ...built, model: await workspaceModelFor(tx, 'ai-attribute'), outputSchema };
}

/** Parses the reply into write-form values; `charged` = credits are used even without a value (classify). */
async function answerToValues(
  tx: Tx,
  attr: AttrDef,
  reply: Pick<LlmResponse, 'text' | 'json'>,
): Promise<{ values: { value: unknown }[]; charged: boolean }> {
  const config = attr.aiAutofill;
  const text = reply.text;
  if (config?.type === 'classify-record') {
    const structured = (reply.json as { options?: unknown } | null)?.options;
    const wanted = Array.isArray(structured)
      ? structured.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      : parseOptions(text);
    const options = await optionTitles(tx, attr);
    const byTitle = new Map(options.map((o) => [o.title.toLowerCase(), o.id]));
    const ids: string[] = [];
    for (const title of wanted) {
      let id = byTitle.get(title.toLowerCase());
      if (!id && config.isOptionCreationEnabled) {
        // New options are capped by the select-option limit ("New options will not be created").
        id = await insertOptions(tx, attr, [{ title }]).then(
          (created) => created[0],
          () => undefined,
        );
        if (id) byTitle.set(title.toLowerCase(), id);
      }
      if (id && !ids.includes(id)) ids.push(id);
      if (!attr.isMultiselect && ids.length > 0) break;
    }
    return { values: ids.map((id) => ({ value: { selectOptionId: id } })), charged: true };
  }
  if (attr.type === 'number') {
    const n = parseNumber(text);
    return { values: n === null ? [] : [{ value: n }], charged: n !== null };
  }
  if (attr.type === 'currency') {
    const n = parseNumber(text);
    return { values: n === null ? [] : [{ value: { currencyValue: n, currencyCode: null } }], charged: n !== null };
  }
  const t = parseText(text);
  return { values: t === null ? [] : [{ value: t }], charged: t !== null };
}

async function markRunProgress(tx: Tx, runId: string): Promise<void> {
  const open = await tx.db
    .selectFrom('entity_annotations')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('ai_run_id', '=', runId)
    .where('ai_status', 'in', ['queued', 'running'])
    .executeTakeFirst();
  await tx.db
    .updateTable('ai_attribute_runs')
    .set((open?.n ?? 0) === 0 ? { status: 'complete', completed_at: tx.now } : { status: 'running' })
    .where('id', '=', runId)
    .execute();
  tx.emit('ai-attribute-run', runId, {});
}

function annotationEmit(tx: Tx, attr: AttrDef, ids: string[]) {
  tx.emit('entity-annotation', attr.id, {
    entityDefinitionId: attr.entityDefinitionId,
    attributeDefinitionId: attr.id,
    entityInstanceIds: ids,
  });
}

export interface BatchResult {
  processed: number;
  written: number;
  errors: number;
  skipped: number;
}

/** Job handler: one batch of a run. Each record: running → LLM → value + annotation + credits (one transaction). */
export async function processRunBatch(
  deps: AiDeps,
  data: { workspaceId: string; runId: string; instanceIds: string[] },
): Promise<BatchResult> {
  const result: BatchResult = { processed: 0, written: 0, errors: 0, skipped: 0 };
  const run = await runInWorkspace(deps.database, systemContext(data.workspaceId, 'ai-autofill'), (tx) =>
    tx.db.selectFrom('ai_attribute_runs').selectAll().where('id', '=', data.runId).executeTakeFirst(),
  );
  if (!run) return result;
  const requester = run.requested_by as ServiceContext['actor'];
  const ctx: ServiceContext = { workspaceId: data.workspaceId, actor: aiActor(run.attribute_id) };
  for (const instanceId of data.instanceIds) {
    // 1. queued → running (or skip: superseded by a newer run, already done by a previous attempt).
    const started = await runInWorkspace(deps.database, ctx, async (tx) => {
      const ann = await tx.db
        .selectFrom('entity_annotations')
        .select(['ai_status', 'ai_run_id'])
        .where('attribute_id', '=', run.attribute_id)
        .where('instance_id', '=', instanceId)
        .forUpdate()
        .executeTakeFirst();
      if (!ann || ann.ai_run_id !== run.id || (ann.ai_status !== 'queued' && ann.ai_status !== 'running')) return null;
      const def = await loadDefinition(tx, run.entity_definition_id);
      const attr = def.byId.get(run.attribute_id);
      await tx.db
        .updateTable('entity_annotations')
        .set({ ai_status: 'running', ai_status_changed_at: tx.now, updated_at: tx.now })
        .where('attribute_id', '=', run.attribute_id)
        .where('instance_id', '=', instanceId)
        .execute();
      if (attr) annotationEmit(tx, attr, [instanceId]);
      if (!attr?.aiAutofill || attr.isArchived) return { prepared: null as Prepared | null };
      return { prepared: await prepare(tx, def, attr, instanceId) };
    });
    if (!started) {
      result.skipped++;
      continue;
    }
    result.processed++;
    // 2. The model call, outside any transaction.
    let reply: LlmResponse | null = null;
    let failure: string | null = started.prepared ? null : 'attribute-unavailable';
    if (started.prepared) {
      try {
        reply = await deps.llm.complete({
          purpose: 'ai-attribute',
          model: started.prepared.model,
          system: started.prepared.system,
          messages: [{ role: 'user', content: started.prepared.prompt }],
          maxTokens: 2048,
          ...(started.prepared.outputSchema ? { outputSchema: started.prepared.outputSchema } : {}),
        });
        if (reply.refused) failure = 'refused';
      } catch (err) {
        failure = err instanceof DomainError ? err.code : 'llm-error';
      }
    }
    // 3. Value + annotation + credits, together.
    await runInWorkspace(deps.database, ctx, async (tx) => {
      const ann = await tx.db
        .selectFrom('entity_annotations')
        .select(['ai_status', 'ai_run_id'])
        .where('attribute_id', '=', run.attribute_id)
        .where('instance_id', '=', instanceId)
        .forUpdate()
        .executeTakeFirst();
      if (!ann || ann.ai_run_id !== run.id) return; // superseded meanwhile
      const def = await loadDefinition(tx, run.entity_definition_id);
      const attr = def.byId.get(run.attribute_id) as AttrDef;
      let status: 'complete' | 'error' = 'complete';
      let error: string | null = failure;
      let credits = 0;
      let wrote = false;
      if (reply && !failure) {
        try {
          const { values, charged } = await answerToValues(tx, attr, reply);
          const engine = engineFor(tx);
          await engine.lock([instanceId]);
          if (values.length > 0) await engine.setAttribute(def, instanceId, attr, values, 'replace');
          await engine.finalize();
          wrote = values.length > 0;
          if (wrote) result.written++;
          // No value returned → not charged, except Classify (ai-attributes §2, §6).
          credits = charged ? run.credits_per_value : 0;
          if (credits > 0) {
            // 1 credit per value (10 for the web agent) in the workspace pool, with the provider usage.
            await creditOps.charge(tx, {
              source: 'ai-attribute',
              memberId: requester.type === 'workspace-member' ? requester.id : null,
              spend: 'workspace',
              usage: reply.usage,
              credits,
              ref: { type: 'entity-instance', id: instanceId },
            });
          }
        } catch (err) {
          status = 'error';
          error = err instanceof DomainError ? err.code : 'write-failed';
        }
      } else {
        status = 'error';
      }
      if (status === 'error') result.errors++;
      await tx.db
        .updateTable('entity_annotations')
        .set({
          ai_status: status,
          ai_status_changed_at: tx.now,
          ai_error: status === 'error' ? (error ?? 'error') : null,
          ai_credits: sql`ai_credits + ${credits}`,
          updated_at: tx.now,
        })
        .where('attribute_id', '=', attr.id)
        .where('instance_id', '=', instanceId)
        .execute();
      await tx.db
        .updateTable('ai_attribute_runs')
        .set({
          credits_used: sql`credits_used + ${credits}`,
          values_written: sql`values_written + ${wrote ? 1 : 0}`,
          errors: sql`errors + ${status === 'error' ? 1 : 0}`,
        })
        .where('id', '=', run.id)
        .execute();
      annotationEmit(tx, attr, [instanceId]);
      await markRunProgress(tx, run.id);
    });
  }
  return result;
}

/** The last attempt of a batch failed: its open annotations end as errors (never stuck "thinking"). */
export async function failRunBatch(
  database: Database,
  data: { workspaceId: string; runId: string; instanceIds: string[] },
  reason = 'job-failed',
): Promise<number> {
  return runInWorkspace(database, systemContext(data.workspaceId, 'ai-autofill'), async (tx) => {
    const rows = await tx.db
      .updateTable('entity_annotations')
      .set({ ai_status: 'error', ai_error: reason, ai_status_changed_at: tx.now, updated_at: tx.now })
      .where('ai_run_id', '=', data.runId)
      .where('instance_id', 'in', data.instanceIds)
      .where('ai_status', 'in', ['queued', 'running'])
      .returning(['attribute_id', 'entity_definition_id', 'instance_id'])
      .execute();
    if (rows.length > 0) {
      const first = rows[0] as { attribute_id: string; entity_definition_id: string };
      tx.emit('entity-annotation', first.attribute_id, {
        entityDefinitionId: first.entity_definition_id,
        attributeDefinitionId: first.attribute_id,
        entityInstanceIds: rows.map((r) => r.instance_id),
      });
      await tx.db
        .updateTable('ai_attribute_runs')
        .set({ errors: sql`errors + ${rows.length}` })
        .where('id', '=', data.runId)
        .execute();
      await markRunProgress(tx, data.runId);
    }
    return rows.length;
  });
}

/** Minute sweep: queued / running annotations older than `olderThanMs` become errors in every workspace. */
export async function sweepStaleAiAnnotations(database: Database, olderThanMs = AI_STALE_MS): Promise<number> {
  return runAsOwner(database, async (trx) => {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const stale = await trx
      .selectFrom('entity_annotations')
      .select(['workspace_id', 'attribute_id', 'entity_definition_id', 'instance_id', 'ai_run_id'])
      .where('ai_status', 'in', ['queued', 'running'])
      .where('ai_status_changed_at', '<', cutoff)
      .execute();
    const byWorkspace = new Map<string, typeof stale>();
    for (const r of stale) byWorkspace.set(r.workspace_id, [...(byWorkspace.get(r.workspace_id) ?? []), r]);
    for (const [workspaceId, rows] of byWorkspace) {
      const tx = await enterWorkspace(trx, systemContext(workspaceId, 'ai-autofill-sweep'));
      for (const r of rows) {
        await tx.db
          .updateTable('entity_annotations')
          .set({ ai_status: 'error', ai_error: 'timeout', ai_status_changed_at: tx.now, updated_at: tx.now })
          .where('attribute_id', '=', r.attribute_id)
          .where('instance_id', '=', r.instance_id)
          .execute();
        tx.emit('entity-annotation', r.attribute_id, {
          entityDefinitionId: r.entity_definition_id,
          attributeDefinitionId: r.attribute_id,
          entityInstanceIds: [r.instance_id],
        });
      }
      for (const runId of new Set(rows.map((r) => r.ai_run_id).filter((x): x is string => x !== null))) {
        await markRunProgress(tx, runId);
      }
      await tx.flush();
      await sql`SELECT set_config('role', 'none', true)`.execute(trx);
    }
    return stale.length;
  });
}
