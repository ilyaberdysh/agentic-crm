// Slice 10 services: formula attributes (`formulas.*`), AI autofill attributes (`aiAttributes.*`) and the attribute
// write hook used by schema.createAttribute / updateAttribute (formula_configuration, ai_autofill_configuration).
import type {
  ActionFlag,
  AiRunInput,
  AttributeDefinition,
  CreateAttributeInput,
  CreateFormulaGenerationInput,
  EntityAnnotationsInput,
  PreviewFormulaInput,
  UpdateAttributeInput,
  ValidateFormulaInput,
} from '@agentic-crm/contracts';
import { createAttributeInputSchema, updateAttributeInputSchema } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import type { LlmClient } from '../ai/llm.ts';
import {
  type AiDeps,
  configureAiAutofill,
  estimateRun,
  failRunBatch,
  processRunBatch,
  startRun,
  sweepStaleAiAnnotations,
} from '../ai-attributes/service.ts';
import type { ServiceContext } from '../context.ts';
import { badRequest } from '../errors.ts';
import type { JobQueue } from '../jobs/queue.ts';
import type { Policies } from '../permissions.ts';
import { loadDefinition, resolveAttribute, toAttributeDefinition } from '../schema/model.ts';
import { schemaOps } from '../schema/service.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import {
  createGenerationRequest,
  failGenerationRequest,
  getGenerationRequest,
  processGenerationRequest,
} from './generate.ts';
import { pumpFormulaRecompute, requestDailyRecompute, runRecomputeJob } from './recompute.ts';
import { formulaOps } from './service.ts';

/** schema.attributes.create: plain attributes, formula attributes, AI autofill attributes. */
export async function createAttributeWithExtensions(tx: Tx, input: CreateAttributeInput): Promise<AttributeDefinition> {
  const data = createAttributeInputSchema.parse(input);
  if (data.formulaConfiguration && data.aiAutofillConfiguration) {
    throw badRequest('VALIDATION_ERROR', 'Formula attributes cannot use AI autofill');
  }
  if (data.formulaConfiguration) return formulaOps.createAttribute(tx, input);
  const def = await loadDefinition(tx, data.entityDefinitionId);
  const replay = def.byId.has(data.id);
  const ai = data.aiAutofillConfiguration;
  const created = await schemaOps.createAttribute(tx, {
    ...input,
    ...(ai ? { isRequired: false, isUnique: false } : {}),
  });
  if (!ai || replay) return created;
  const fresh = await loadDefinition(tx, def.id);
  await configureAiAutofill(tx, fresh, resolveAttribute(fresh, created.id), ai);
  return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, def.id), created.id));
}

/** schema.attributes.update: a new formula snapshot and / or AI autofill on, changed or off (null). */
export async function updateAttributeWithExtensions(tx: Tx, input: UpdateAttributeInput): Promise<AttributeDefinition> {
  const data = updateAttributeInputSchema.parse(input);
  if (data.isRequired === true || data.isUnique === true) {
    const current = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    const aiOn =
      data.aiAutofillConfiguration !== undefined ? data.aiAutofillConfiguration !== null : !!current.aiAutofill;
    if (current.formula || aiOn) {
      throw badRequest('VALIDATION_ERROR', 'Formula and AI autofill attributes cannot be required or unique');
    }
  }
  const updated = data.formulaConfiguration
    ? await formulaOps.updateAttribute(tx, input)
    : await schemaOps.updateAttribute(tx, input);
  if (data.aiAutofillConfiguration === undefined) return updated;
  const def = await loadDefinition(tx, data.entityDefinitionId);
  await configureAiAutofill(tx, def, resolveAttribute(def, updated.id), data.aiAutofillConfiguration);
  return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, def.id), updated.id));
}

export interface FormulaWiring {
  database: Database;
  policies: Policies;
  /** null = no job queue in this process (formula batches run inline; AI runs fail with JOBS_UNAVAILABLE). */
  jobs: JobQueue | null;
  /** Used where a queue is mandatory (AI runs, composer requests). */
  requiredJobs: JobQueue;
  llm: LlmClient;
}

export function createFormulaServices(wiring: FormulaWiring) {
  const { database, policies } = wiring;
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  const guarded =
    <I extends { entityDefinitionId: string }, T>(flag: ActionFlag, fn: (tx: Tx, input: I) => Promise<T>) =>
    (ctx: ServiceContext, input: I) =>
      run(ctx, async (tx) => {
        await policies.assertCan(tx, input.entityDefinitionId, flag);
        return fn(tx, input);
      });
  const aiDeps: AiDeps = { database, jobs: wiring.requiredJobs, llm: wiring.llm };

  return {
    formulas: {
      /** Diagnostics (with fixes), checked type, Auto / stored output type, save error (formulas §3). */
      validate: guarded(
        'read_attribute_definition',
        (tx, input: ValidateFormulaInput & { entityDefinitionId: string }) => formulaOps.validate(tx, input),
      ),
      /** Evaluates an unsaved formula against one record (§4.6). */
      preview: guarded('read_entity_instance', (tx, input: PreviewFormulaInput & { entityDefinitionId: string }) =>
        formulaOps.preview(tx, input),
      ),
      /** AI composer: generate (empty editor) or refine (with a draft); queued, completed by the worker (§4.5). */
      generate: guarded(
        'read_attribute_definition',
        (tx, input: CreateFormulaGenerationInput & { entityDefinitionId: string }) =>
          createGenerationRequest(tx, input, 'generate', { jobs: wiring.requiredJobs, llm: wiring.llm }),
      ),
      /** The Fix button: repairs the current draft. */
      fix: guarded(
        'read_attribute_definition',
        (tx, input: CreateFormulaGenerationInput & { entityDefinitionId: string }) =>
          createGenerationRequest(tx, input, 'fix', { jobs: wiring.requiredJobs, llm: wiring.llm }),
      ),
      generationRequest: (ctx: ServiceContext, id: string) => run(ctx, (tx) => getGenerationRequest(tx, id)),
      snapshots: guarded(
        'read_attribute_definition',
        (tx, input: { entityDefinitionId: string; attributeDefinitionId: string }) =>
          formulaOps.snapshots(tx, input.entityDefinitionId, input.attributeDefinitionId),
      ),
      snapshot: (ctx: ServiceContext, snapshotId: string) => run(ctx, (tx) => formulaOps.snapshot(tx, snapshotId)),
      /** Per-record formula / AI autofill state (entity annotations). */
      annotations: guarded(
        'read_attribute_value',
        (tx, input: EntityAnnotationsInput & { entityDefinitionId: string }) => formulaOps.annotations(tx, input),
      ),
      /** Worker loop: committed value changes → dependent formulas recomputed (inline or as batch jobs). */
      pump: (options?: { inlineLimit?: number }) => pumpFormulaRecompute({ database, jobs: wiring.jobs }, options),
      /** Worker job `formula.recompute`. */
      recompute: (data: { workspaceId: string; attributeId: string; instanceIds: string[] }) =>
        runRecomputeJob(database, data),
      /** Worker cron `formula.daily`: formulas using now() / today(). */
      daily: () => requestDailyRecompute(database),
      /** Worker job `formula.generate`. */
      processGeneration: (data: { workspaceId: string; requestId: string }) =>
        processGenerationRequest({ database, llm: wiring.llm }, data),
      failGeneration: (data: { workspaceId: string; requestId: string }) => failGenerationRequest(database, data),
    },
    aiAttributes: {
      /** Data of the "Recalculate values" confirmation (records × credits per value). */
      estimate: guarded('read_attribute_value', (tx, input: AiRunInput & { entityDefinitionId: string }) =>
        estimateRun(tx, input),
      ),
      /** Confirmed run over records, a selection or a column: values queued ("AI is thinking..."). */
      run: guarded('update_attribute_value', (tx, input: AiRunInput & { entityDefinitionId: string }) =>
        startRun(tx, input, aiDeps),
      ),
      /** Same as run, with AI recalculation enabled. */
      recalculate: guarded('update_attribute_value', (tx, input: AiRunInput & { entityDefinitionId: string }) =>
        startRun(tx, input, aiDeps),
      ),
      annotations: guarded(
        'read_attribute_value',
        (tx, input: EntityAnnotationsInput & { entityDefinitionId: string }) => formulaOps.annotations(tx, input),
      ),
      /** Worker job `ai-attribute.run`. */
      processBatch: (data: { workspaceId: string; runId: string; instanceIds: string[] }) =>
        processRunBatch(aiDeps, data),
      /** Worker: the batch's last attempt failed. */
      failBatch: (data: { workspaceId: string; runId: string; instanceIds: string[] }, reason?: string) =>
        failRunBatch(database, data, reason),
      /** Worker cron `ai-attribute.sweep`. */
      sweep: (olderThanMs?: number) => sweepStaleAiAnnotations(database, olderThanMs),
      /** Whether an LLM provider is configured ("not configured" state otherwise). */
      configured: () => wiring.llm.configured,
    },
  };
}
