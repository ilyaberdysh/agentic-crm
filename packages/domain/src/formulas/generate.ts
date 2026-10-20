// AI formula composer (formulas.md §4.5): generate (empty editor), refine (with a draft), fix (from the Fix button).
// A request is created queued; the worker builds a schema-aware prompt (attributes, options and stages as `$n`
// handles, the function catalog, the grammar rules), asks the model for a formula, checks it with the type checker
// and feeds diagnostics back once for self-correction. The result is stored in the stored form (plaintext with `_`
// placeholders + annotations), or a refusal. Free: no credits. Status changes are invalidated (no polling).
import {
  type CreateFormulaGenerationInput,
  createFormulaGenerationInputSchema,
  type FormulaGenerationRequest,
} from '@agentic-crm/contracts';
import { type Database, jsonb } from '@agentic-crm/db';
import {
  compileFormula,
  type FormulaAnnotation,
  type FormulaSource,
  FUNCTIONS,
  HELP_FUNCTIONS,
  kindLabel,
} from '@agentic-crm/formula';
import { type LlmClient, type LlmResponse, workspaceModelFor } from '../ai/llm.ts';
import { type ServiceContext, systemContext } from '../context.ts';
import { badRequest, DomainError, notFound } from '../errors.ts';
import { JOB_NAMES, type JobQueue } from '../jobs/queue.ts';
import { type AttrDef, type DefInfo, loadDefinition, loadDefinitionsByIds } from '../schema/model.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { loadFormulaSchema } from './context.ts';

type GenerationType = 'generate' | 'refine' | 'fix';

type RequestRow = {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  type: GenerationType;
  status: 'queued' | 'generating' | 'completed' | 'failed';
  prompt: string | null;
  selection_start_from: number | null;
  selection_start_to: number | null;
  input_formula_draft: unknown;
  output_plaintext: string | null;
  output_annotations: unknown;
  refusal_message: string | null;
  refusal_category: string | null;
  created_by: unknown;
  created_at: string;
  updated_at: string;
};

function toRequest(r: RequestRow): FormulaGenerationRequest {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entityDefinitionId: r.entity_definition_id,
    type: r.type,
    status: r.status,
    outputPlaintext: r.output_plaintext,
    outputAnnotations: (r.output_annotations ?? null) as unknown[] | null,
    refusalMessage: r.refusal_message,
    refusalCategory: r.refusal_category,
    createdBy: r.created_by as FormulaGenerationRequest['createdBy'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function emitRequest(tx: Tx, r: { id: string; entity_definition_id: string }) {
  tx.emit('formula-generation-request', r.id, { entityDefinitionId: r.entity_definition_id });
}

export async function createGenerationRequest(
  tx: Tx,
  input: CreateFormulaGenerationInput,
  kind: 'generate' | 'fix',
  deps: { jobs: JobQueue; llm: LlmClient },
): Promise<FormulaGenerationRequest> {
  const data = createFormulaGenerationInputSchema.parse(input);
  const def = await loadDefinition(tx, data.entityDefinitionId);
  const existing = await tx.db
    .selectFrom('formula_generation_requests')
    .selectAll()
    .where('id', '=', data.id)
    .executeTakeFirst();
  if (existing) return toRequest(existing as RequestRow); // idempotent PUT
  if (!deps.llm.configured) throw new DomainError(503, 'AI_NOT_CONFIGURED', 'AI is not configured for this workspace');
  const hasDraft = !!data.inputFormulaDraft && data.inputFormulaDraft.plaintext.trim() !== '';
  const type: GenerationType = kind === 'fix' ? 'fix' : hasDraft ? 'refine' : 'generate';
  if (type === 'fix' && !hasDraft) throw badRequest('VALIDATION_ERROR', 'There is no formula to fix');
  if (type !== 'fix' && !data.prompt?.trim()) throw badRequest('VALIDATION_ERROR', 'Describe the formula you want');
  const row = await tx.db
    .insertInto('formula_generation_requests')
    .values({
      id: data.id,
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      type,
      status: 'queued',
      prompt: type === 'fix' ? null : (data.prompt ?? null),
      selection_start_from: type === 'fix' ? null : data.selectionStartFrom,
      selection_start_to: type === 'fix' ? null : data.selectionStartTo,
      input_formula_draft: jsonb(hasDraft ? data.inputFormulaDraft : null),
      output_plaintext: null,
      output_annotations: null,
      refusal_message: null,
      refusal_category: null,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await deps.jobs.send(tx, JOB_NAMES.formulaGenerate, { workspaceId: tx.workspaceId, requestId: row.id });
  emitRequest(tx, row);
  return toRequest(row as RequestRow);
}

export async function getGenerationRequest(tx: Tx, id: string): Promise<FormulaGenerationRequest> {
  const row = await tx.db.selectFrom('formula_generation_requests').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('The formula generation request could not be found', { formula_generation_request_id: id });
  return toRequest(row as RequestRow);
}

// ---------------------------------------------------------------------------------------------------------------
// Prompt

interface Handle {
  handle: string;
  annotation: FormulaAnnotation;
  label: string;
}

function sameAnnotation(a: FormulaAnnotation, b: FormulaAnnotation): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'entity-variable' && b.type === 'entity-variable') {
    return JSON.stringify(a.path) === JSON.stringify(b.path) && (a.field ?? null) === (b.field ?? null);
  }
  if (a.type === 'select-option' && b.type === 'select-option') return a.selectOptionId === b.selectOptionId;
  if (a.type === 'pipeline-stage' && b.type === 'pipeline-stage') return a.pipelineStageId === b.pipelineStageId;
  if (a.type === 'actor-reference' && b.type === 'actor-reference') return a.referencedActorId === b.referencedActorId;
  return false;
}

const FIELD_FOR: Partial<Record<AttrDef['type'], string>> = { currency: 'raw_value' };

/** Attributes of the object (and of objects one record reference away) as `$n` handles, with options / stages. */
async function schemaHandles(tx: Tx, def: DefInfo): Promise<Handle[]> {
  const handles: Handle[] = [];
  const add = (annotation: FormulaAnnotation, label: string) =>
    handles.push({ handle: `$${handles.length + 1}`, annotation, label });
  const visible = (a: AttrDef) => !a.isArchived && !a.isHidden && a.systemAttributeType !== 'list-entries';
  const related = new Map<string, AttrDef>();
  for (const attr of def.attrs.filter(visible)) {
    const hop = { entityDefinitionId: def.id, attributeDefinitionId: attr.id };
    add(
      { type: 'entity-variable', startPosition: 0, length: 1, path: [hop], field: FIELD_FOR[attr.type] ?? null },
      `{${attr.title}} — ${kindLabel(attr.type)}${attr.isMultiselect ? ' (multiple values)' : ''}`,
    );
    if (attr.type === 'entity-reference') {
      const target =
        attr.relatedEntityDefinitionId ?? attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0];
      if (target) related.set(attr.id, attr);
    }
  }
  const options = await tx.db
    .selectFrom('select_options')
    .select(['id', 'attribute_id', 'title', 'kind'])
    .where('entity_definition_id', '=', def.id)
    .where('is_archived', '=', false)
    .orderBy('sort_order')
    .limit(200)
    .execute();
  for (const o of options) {
    const attr = def.byId.get(o.attribute_id);
    if (!attr || !visible(attr)) continue;
    add(
      o.kind === 'stage'
        ? {
            type: 'pipeline-stage',
            startPosition: 0,
            length: 1,
            entityDefinitionId: def.id,
            attributeDefinitionId: attr.id,
            pipelineStageId: o.id,
          }
        : {
            type: 'select-option',
            startPosition: 0,
            length: 1,
            entityDefinitionId: def.id,
            attributeDefinitionId: attr.id,
            selectOptionId: o.id,
          },
      `${o.kind === 'stage' ? 'status' : 'option'} "${o.title}" of {${attr.title}}`,
    );
  }
  const targets = await loadDefinitionsByIds(
    tx,
    [...related.values()].map(
      (a) =>
        (a.relatedEntityDefinitionId ??
          a.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0]) as string,
    ),
  );
  for (const attr of related.values()) {
    const target = targets.get(
      (attr.relatedEntityDefinitionId ??
        attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0]) as string,
    );
    if (!target) continue;
    for (const sub of target.attrs.filter(visible).slice(0, 40)) {
      add(
        {
          type: 'entity-variable',
          startPosition: 0,
          length: 1,
          path: [
            { entityDefinitionId: def.id, attributeDefinitionId: attr.id },
            { entityDefinitionId: target.id, attributeDefinitionId: sub.id },
          ],
          field: FIELD_FOR[sub.type] ?? null,
        },
        `{${attr.title} > ${sub.title}} — ${kindLabel(sub.type)}${attr.isMultiselect || sub.isMultiselect ? ' (list: aggregate or index it)' : ''}`,
      );
    }
  }
  return handles;
}

/** Stored form → model text with `$n` handles (missing handles are added). */
function draftToHandles(draft: FormulaSource, handles: Handle[]): string {
  let out = '';
  let cursor = 0;
  for (const a of [...draft.annotations].sort((x, y) => x.startPosition - y.startPosition)) {
    let h = handles.find((x) => sameAnnotation(x.annotation, a));
    if (!h) {
      h = { handle: `$${handles.length + 1}`, annotation: a, label: '(referenced in the draft)' };
      handles.push(h);
    }
    out += draft.plaintext.slice(cursor, a.startPosition) + h.handle;
    cursor = a.startPosition + 1;
  }
  return out + draft.plaintext.slice(cursor);
}

/** Model text with `$n` handles → stored form (handles inside strings stay text). */
export function handlesToSource(text: string, handles: Handle[]): FormulaSource | { unknownHandle: string } {
  let plaintext = '';
  const annotations: FormulaAnnotation[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      plaintext += ch;
      if (ch === '\\' && i + 1 < text.length) plaintext += text[++i];
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      plaintext += ch;
      continue;
    }
    const m = ch === '$' ? /^\$(\d+)/.exec(text.slice(i)) : null;
    if (m) {
      const h = handles.find((x) => x.handle === m[0]);
      if (!h) return { unknownHandle: m[0] };
      annotations.push({ ...h.annotation, startPosition: plaintext.length, length: 1 });
      plaintext += '_';
      i += m[0].length - 1;
      continue;
    }
    plaintext += ch;
  }
  return { plaintext, annotations };
}

const SYSTEM = [
  'You write formulas for a CRM formula attribute. The formula is ONE expression in this language:',
  '- Literals: numbers (1, 2.5), "double-quoted text" (backslash escapes), true, false, null. Line comments: // …',
  '- Operators: + (numbers, or joins text) - * / ; comparisons == != < <= > >= ; and, or, ! ; a ?? b (fallback when a is empty). No % or ^ (use mod(), power()).',
  '- Function calls name(arg, …); list literals [a, b]; index x[0] (zero-based); fields x.key on locations, emails, names, users.',
  '- Record attributes are referenced ONLY through the $n handles listed by the user; never write attribute names.',
  '- Multi-value attributes and paths through multi-value relationships are lists: aggregate them (count, sum, avg, min, max, unique, contains) or index them.',
  '- The result must be a single value (not a list) of type text, number, checkbox, currency, date, timestamp, rating, record, user, location or phone number.',
  'Reply with JSON only: {"formula": "<formula>"} or, when the request cannot be expressed, {"formula": null, "refusal": {"category": "unsupported_function" | "unclear_request" | "other", "message": "<short reason>"}}.',
].join('\n');

function catalog(): string {
  return HELP_FUNCTIONS.concat(
    ['text', 'number', 'currency', 'checkbox', 'rating', 'phoneNumber'].map((n) => FUNCTIONS[n as 'text']),
  )
    .map(
      (f) =>
        `${f.name}(${f.help?.parameters.join(', ') ?? f.params.map((p) => p.name).join(', ')})${f.help ? ` — ${f.help.description}` : ''}`,
    )
    .join('\n');
}

function userPrompt(
  row: RequestRow,
  def: DefInfo,
  handles: Handle[],
  draftText: string | null,
  errors: string[],
): string {
  const parts = [
    `Object: ${def.singularNoun}`,
    `Handles:\n${handles.map((h) => `${h.handle} = ${h.label}`).join('\n')}`,
    `Functions:\n${catalog()}`,
  ];
  if (draftText !== null) parts.push(`Current formula:\n${draftText}`);
  if (row.type === 'fix') parts.push('Task: fix the current formula so that it has no errors, keeping its intent.');
  else if (row.type === 'refine') parts.push(`Task: change the current formula as requested: ${row.prompt ?? ''}`);
  else parts.push(`Task: write a formula that does this: ${row.prompt ?? ''}`);
  if (errors.length > 0) parts.push(`Your previous formula had these errors, correct them:\n${errors.join('\n')}`);
  return parts.join('\n\n');
}

/** Structured output of the composer: a formula, or a refusal. */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    formula: { type: ['string', 'null'] },
    refusal: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['unsupported_function', 'unclear_request', 'other'] },
            message: { type: 'string' },
          },
          required: ['category', 'message'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['formula', 'refusal'],
  additionalProperties: false,
};

function parseReply(text: string): { formula: string | null; refusal: { category: string; message: string } | null } {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as {
        formula?: unknown;
        refusal?: { category?: unknown; message?: unknown } | null;
      };
      const formula = typeof parsed.formula === 'string' && parsed.formula.trim() !== '' ? parsed.formula : null;
      const refusal = parsed.refusal
        ? { category: String(parsed.refusal.category ?? 'other'), message: String(parsed.refusal.message ?? '') }
        : null;
      return {
        formula,
        refusal: formula ? null : (refusal ?? { category: 'other', message: 'No formula was produced' }),
      };
    } catch {
      // not JSON: treat the whole reply as the formula
    }
  }
  const t = text
    .trim()
    .replace(/^```\w*\n?|```$/g, '')
    .trim();
  return t
    ? { formula: t, refusal: null }
    : { formula: null, refusal: { category: 'other', message: 'No formula was produced' } };
}

/** Worker: runs one generation request to completion (completed with output, or failed with a refusal). */
export async function processGenerationRequest(
  deps: { database: Database; llm: LlmClient },
  data: { workspaceId: string; requestId: string },
): Promise<{ status: string }> {
  const ctx: ServiceContext = systemContext(data.workspaceId, 'formula-generation');
  const started = await runInWorkspace(deps.database, ctx, async (tx) => {
    const row = (await tx.db
      .selectFrom('formula_generation_requests')
      .selectAll()
      .where('id', '=', data.requestId)
      .forUpdate()
      .executeTakeFirst()) as RequestRow | undefined;
    if (!row || (row.status !== 'queued' && row.status !== 'generating')) return null;
    await tx.db
      .updateTable('formula_generation_requests')
      .set({ status: 'generating', updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    emitRequest(tx, row);
    const def = await loadDefinition(tx, row.entity_definition_id);
    const handles = await schemaHandles(tx, def);
    const draft = row.input_formula_draft as FormulaSource | null;
    const draftText = draft
      ? draftToHandles({ plaintext: draft.plaintext, annotations: draft.annotations ?? [] }, handles)
      : null;
    let errors: string[] = [];
    if (row.type === 'fix' && draft) {
      const loaded = await loadFormulaSchema(tx, draft.annotations ?? [], [def.id]);
      errors = compileFormula(draft, { entityDefinitionId: def.id, schema: loaded.schema }).diagnostics.map(
        (d) => `line ${d.line}: ${d.message}`,
      );
    }
    return { row, def, handles, draftText, errors, model: await workspaceModelFor(tx, 'formula') };
  });
  if (!started) return { status: 'skipped' };
  const { row, def, handles, draftText, model } = started;
  let errors = started.errors;
  let outcome: { source: FormulaSource } | { refusal: { category: string; message: string } } = {
    refusal: { category: 'other', message: 'No formula was produced' },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: LlmResponse;
    try {
      reply = await deps.llm.complete({
        purpose: 'formula',
        model,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: userPrompt(row, def, handles, draftText, attempt === 0 && row.type !== 'fix' ? [] : errors),
          },
        ],
        maxTokens: 4096,
        outputSchema: REPLY_SCHEMA,
      });
    } catch (err) {
      outcome = { refusal: { category: 'error', message: err instanceof Error ? err.message : 'The model failed' } };
      break;
    }
    if (reply.refused) {
      outcome = { refusal: { category: 'other', message: 'The model declined this request' } };
      break;
    }
    const parsed = parseReply(reply.json === null ? reply.text : JSON.stringify(reply.json));
    if (!parsed.formula) {
      outcome = { refusal: parsed.refusal ?? { category: 'other', message: 'No formula was produced' } };
      break;
    }
    const source = handlesToSource(parsed.formula, handles);
    if ('unknownHandle' in source) {
      errors = [`${source.unknownHandle} is not one of the handles`];
      outcome = {
        refusal: { category: 'invalid_formula', message: 'The generated formula references unknown attributes' },
      };
      continue;
    }
    const diagnostics = await runInWorkspace(deps.database, ctx, async (tx) => {
      const loaded = await loadFormulaSchema(tx, source.annotations, [def.id]);
      return compileFormula(source, { entityDefinitionId: def.id, schema: loaded.schema }).diagnostics;
    });
    if (diagnostics.length === 0) {
      outcome = { source };
      break;
    }
    errors = diagnostics.map((d) => `line ${d.line}, column ${d.column}: ${d.message}`);
    outcome = { refusal: { category: 'invalid_formula', message: `The generated formula has errors: ${errors[0]}` } };
  }
  return runInWorkspace(deps.database, ctx, async (tx) => {
    const done =
      'source' in outcome
        ? {
            status: 'completed' as const,
            output_plaintext: outcome.source.plaintext,
            output_annotations: jsonb(outcome.source.annotations),
          }
        : {
            status: 'failed' as const,
            refusal_message: outcome.refusal.message,
            refusal_category: outcome.refusal.category,
          };
    await tx.db
      .updateTable('formula_generation_requests')
      .set({ ...done, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    emitRequest(tx, row);
    return { status: done.status };
  });
}

/** The job failed for good: the request ends failed (the composer leaves "Thinking"). */
export async function failGenerationRequest(database: Database, data: { workspaceId: string; requestId: string }) {
  await runInWorkspace(database, systemContext(data.workspaceId, 'formula-generation'), async (tx) => {
    const row = await tx.db
      .updateTable('formula_generation_requests')
      .set({ status: 'failed', refusal_category: 'error', refusal_message: 'Generation failed', updated_at: tx.now })
      .where('id', '=', data.requestId)
      .where('status', 'in', ['queued', 'generating'])
      .returning(['id', 'entity_definition_id'])
      .executeTakeFirst();
    if (row) emitRequest(tx, row);
  });
}
