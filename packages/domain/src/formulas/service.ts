// Formula attributes (I-ai-calls/formulas.md): validation and preview for the editor, saving snapshots on attribute
// create / update (FORMULA_* save errors, circularity, chain depth ≤ 3, output type → attribute type), snapshots,
// and per-record annotations (formula + AI autofill state).
import {
  type AttributeDefinition,
  type CreateAttributeInput,
  createAttributeInputSchema,
  type EntityAnnotation,
  type EntityAnnotationsInput,
  entityAnnotationsInputSchema,
  type FormulaConfigurationInput,
  type FormulaSnapshot,
  formulaConfigurationInputSchema,
  type PreviewFormulaInput,
  type PreviewFormulaOutput,
  previewFormulaInputSchema,
  type UpdateAttributeInput,
  updateAttributeInputSchema,
  type ValidateFormulaInput,
  type ValidateFormulaOutput,
  validateFormulaInputSchema,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import {
  type CompiledFormula,
  compileFormula,
  evaluateFormula,
  type FormulaAnnotation,
  type FormulaSource,
  type OutputOverride,
  SAVE_ERROR_MESSAGES,
  type SaveErrorCode,
  saveError,
  summarizeDiagnostics,
  typeLabel,
} from '@agentic-crm/formula';
import { badRequest, notFound } from '../errors.ts';
import { replaceProjectionColumns } from '../projection.ts';
import {
  type AttrDef,
  type DefInfo,
  invalidateDefinitions,
  loadDefinition,
  resolveAttribute,
  toAttributeDefinition,
} from '../schema/model.ts';
import { schemaOps } from '../schema/service.ts';
import type { Tx } from '../tx.ts';
import { type LoadedSchema, loadFormulaSchema, loadReferenceData } from './context.ts';
import { dependencyGraph, downDepth, reaches, requestFullRecompute, upDepth } from './recompute.ts';
import { outputToWriteValue } from './values.ts';

/** Version of the formula language stored on snapshots (Attio's server value, U-F10). */
export const GRAMMAR_VERSION = '0.0.1';
/** "A formula chain can contain at most three formulas" (§3.6). */
export const MAX_FORMULA_CHAIN = 3;

function toSource(input: { plaintext: string; annotations?: unknown[] }): FormulaSource {
  return {
    plaintext: input.plaintext,
    annotations: (input.annotations ?? []).map((a) => ({ length: 1, ...(a as object) })) as FormulaAnnotation[],
  };
}

async function compileFor(
  tx: Tx,
  def: DefInfo,
  source: FormulaSource,
  override: OutputOverride | null,
): Promise<{ compiled: CompiledFormula; loaded: LoadedSchema }> {
  const loaded = await loadFormulaSchema(tx, source.annotations, [def.id]);
  const compiled = compileFormula(source, {
    entityDefinitionId: def.id,
    schema: loaded.schema,
    outputTypeOverride: override,
  });
  return { compiled, loaded };
}

/** Attributes the formula references (every hop of every path). */
function referencedAttributes(source: FormulaSource): string[] {
  return [
    ...new Set(
      source.annotations.flatMap((a) =>
        a.type === 'entity-variable' ? a.path.map((h) => h.attributeDefinitionId) : [],
      ),
    ),
  ];
}

/** Circularity and chain depth of `attributeId` (null = a new attribute) referencing `refs`. */
async function chainError(tx: Tx, attributeId: string | null, refs: string[]): Promise<SaveErrorCode | null> {
  const rows = await tx.db
    .selectFrom('formula_dependencies')
    .select(['formula_attribute_id', 'depends_on_attribute_id'])
    .execute();
  const formulas = await tx.db.selectFrom('formula_attributes').select('attribute_id').execute();
  const graph = dependencyGraph(
    rows,
    formulas.map((f) => f.attribute_id),
  );
  const self = attributeId ?? '00000000-0000-0000-0000-000000000000';
  graph.set(self, new Set(refs));
  if (refs.includes(self) || reaches(graph, self, self)) return 'FORMULA_CIRCULAR_REFERENCE';
  const chain = upDepth(graph, self) + downDepth(graph, self) - 1;
  return chain > MAX_FORMULA_CHAIN ? 'FORMULA_MAX_DEPTH_EXCEEDED' : null;
}

function saveFailure(code: SaveErrorCode, compiled?: CompiledFormula) {
  return badRequest(code, SAVE_ERROR_MESSAGES[code], compiled ? { diagnostics: compiled.diagnostics } : undefined);
}

/** Normalised attribute config when the formula's output type changes the attribute type. */
async function changeOutputType(tx: Tx, def: DefInfo, attr: AttrDef, type: AttrDef['type']): Promise<AttrDef> {
  // "All previously calculated values will be cleared": the formula's own value rows are derived data.
  await sql`DELETE FROM attribute_values WHERE attribute_id = ${attr.id}::uuid`.execute(tx.db);
  const config: Record<string, unknown> = {};
  if (type === 'number')
    config.numberConfiguration = attr.config.numberConfiguration ?? {
      defaultDecimalPlaces: null,
      defaultGroups: 'default',
    };
  if (type === 'currency') config.currencyConfiguration = attr.config.currencyConfiguration ?? {};
  if (type === 'entity-reference') config.entityReferenceConfiguration = { allowedEntityDefinitionIds: null };
  await tx.db
    .updateTable('attribute_definitions')
    .set({ type, config: jsonb(config), is_indexed: false, is_historic: type === 'currency', updated_at: tx.now })
    .where('id', '=', attr.id)
    .execute();
  invalidateDefinitions(tx);
  const fresh = (await loadDefinition(tx, def.id)).byId.get(attr.id) as AttrDef;
  await replaceProjectionColumns(tx, await loadDefinition(tx, def.id), attr, fresh);
  tx.emit('attribute-value-list', attr.id, { entityDefinitionId: def.id, attributeDefinitionId: attr.id });
  tx.emit('snapshot-selection', def.id, { entityDefinitionId: def.id, attributeDefinitionIds: [attr.id] });
  return fresh;
}

/** Stores a new snapshot, points the attribute at it, records dependencies and requests a full recompute. */
async function storeSnapshot(
  tx: Tx,
  def: DefInfo,
  attr: AttrDef,
  config: { snapshotId: string; outputTypeOverride: OutputOverride | null },
  source: FormulaSource,
  compiled: CompiledFormula,
): Promise<void> {
  const existing = await tx.db
    .selectFrom('formula_attribute_snapshots')
    .select(['id', 'attribute_id'])
    .where('id', '=', config.snapshotId)
    .executeTakeFirst();
  if (existing) {
    if (existing.attribute_id !== attr.id)
      throw badRequest('ID_CONFLICT', 'This snapshot id is used by another attribute');
    return; // idempotent replay
  }
  const annotations = source.annotations.map((a) => ({ ...a, length: 1 }));
  await tx.db
    .insertInto('formula_attribute_snapshots')
    .values({
      id: config.snapshotId,
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      attribute_id: attr.id,
      grammar_version: GRAMMAR_VERSION,
      plaintext: source.plaintext,
      annotations: jsonb(annotations),
      output_type_override: config.outputTypeOverride,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
    })
    .execute();
  await sql`
    INSERT INTO formula_attributes (attribute_id, workspace_id, entity_definition_id, active_snapshot_id,
      active_snapshot_created_at, uses_now, updated_at)
    VALUES (${attr.id}::uuid, ${tx.workspaceId}::uuid, ${def.id}::uuid, ${config.snapshotId}::uuid,
      ${tx.now}::timestamptz, ${compiled.usesNow}, ${tx.now}::timestamptz)
    ON CONFLICT (attribute_id) DO UPDATE SET active_snapshot_id = excluded.active_snapshot_id,
      active_snapshot_created_at = excluded.active_snapshot_created_at, uses_now = excluded.uses_now,
      updated_at = excluded.updated_at`.execute(tx.db);
  await tx.db.deleteFrom('formula_dependencies').where('formula_attribute_id', '=', attr.id).execute();
  const deps = compiled.references.flatMap((ref) =>
    ref.path.map((hop, i) => ({
      workspace_id: tx.workspaceId,
      formula_attribute_id: attr.id,
      formula_entity_definition_id: def.id,
      depends_on_attribute_id: hop.attributeDefinitionId,
      hop_index: i,
      path: jsonb(ref.path),
    })),
  );
  if (deps.length > 0) await tx.db.insertInto('formula_dependencies').values(deps).execute();
  // Formula values are written by the formula actor only (public API: is_writable false).
  await tx.db
    .updateTable('attribute_definitions')
    .set({ is_read_only: true, is_required: false, is_unique: false, updated_at: tx.now })
    .where('id', '=', attr.id)
    .execute();
  invalidateDefinitions(tx);
  tx.emit('attribute-definition', attr.id, { entityDefinitionId: def.id });
  tx.emit('attribute-definition-list', def.id, { entityDefinitionId: def.id });
  requestFullRecompute(tx, attr, 'snapshot');
}

async function prepare(tx: Tx, def: DefInfo, attributeId: string | null, config: FormulaConfigurationInput) {
  const parsed = formulaConfigurationInputSchema.parse(config);
  const source = toSource(parsed);
  const { compiled } = await compileFor(tx, def, source, parsed.outputTypeOverride);
  const error = saveError(compiled);
  if (error) throw saveFailure(error, compiled);
  const chain = await chainError(tx, attributeId, referencedAttributes(source));
  if (chain) throw saveFailure(chain);
  return { parsed, source, compiled };
}

export const formulaOps = {
  /** schema.attributes.create with `formulaConfiguration`: the attribute type is the formula's output type. */
  async createAttribute(tx: Tx, input: CreateAttributeInput): Promise<AttributeDefinition> {
    const data = createAttributeInputSchema.parse(input);
    const config = data.formulaConfiguration;
    if (!config) return schemaOps.createAttribute(tx, input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const replay = def.byId.get(data.id);
    if (replay) return toAttributeDefinition(replay);
    if (def.entityType === 'interface')
      throw badRequest('VALIDATION_ERROR', 'Interfaces cannot have formula attributes');
    const { parsed, source, compiled } = await prepare(tx, def, null, config);
    const {
      formulaConfiguration: _f,
      aiAutofillConfiguration: _a,
      relationship: _r,
      options: _o,
      stages: _s,
      ...rest
    } = data;
    const created = await schemaOps.createAttribute(tx, {
      ...rest,
      type: compiled.outputType,
      isMultiselect: false,
      isRequired: false,
      isUnique: false,
      defaultValue: null,
    });
    const fresh = await loadDefinition(tx, def.id);
    await storeSnapshot(tx, fresh, resolveAttribute(fresh, created.id), parsed, source, compiled);
    invalidateDefinitions(tx);
    return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, def.id), created.id));
  },

  /** schema.attributes.update with `formulaConfiguration`: a new snapshot; a new output type clears old values. */
  async updateAttribute(tx: Tx, input: UpdateAttributeInput): Promise<AttributeDefinition> {
    const data = updateAttributeInputSchema.parse(input);
    const config = data.formulaConfiguration;
    if (!config) return schemaOps.updateAttribute(tx, input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    let attr = resolveAttribute(def, data.attributeDefinitionId);
    if (!attr.formula) throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" is not a formula attribute`);
    const { parsed, source, compiled } = await prepare(tx, def, attr.id, config);
    const { formulaConfiguration: _f, aiAutofillConfiguration: _a, isRequired: _r, isUnique: _u, ...rest } = data;
    if (compiled.outputType !== attr.type) attr = await changeOutputType(tx, def, attr, compiled.outputType);
    await schemaOps.updateAttribute(tx, rest);
    const fresh = await loadDefinition(tx, def.id);
    await storeSnapshot(tx, fresh, resolveAttribute(fresh, attr.id), parsed, source, compiled);
    invalidateDefinitions(tx);
    return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, def.id), attr.id));
  },

  async validate(tx: Tx, input: ValidateFormulaInput): Promise<ValidateFormulaOutput> {
    const data = validateFormulaInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const source = toSource(data);
    const { compiled } = await compileFor(tx, def, source, data.outputTypeOverride);
    let error: SaveErrorCode | null = saveError(compiled);
    if (!error) {
      const attributeId = data.attributeDefinitionId ? resolveAttribute(def, data.attributeDefinitionId).id : null;
      error = await chainError(tx, attributeId, referencedAttributes(source));
    }
    return {
      valid: compiled.ok,
      empty: compiled.empty,
      diagnostics: compiled.diagnostics,
      summary: summarizeDiagnostics(compiled.diagnostics),
      resultType: compiled.resultType ? typeLabel(compiled.resultType) : null,
      inferredOutputType: compiled.inferredOutputType,
      outputType: compiled.outputType,
      saveError: error,
      usesNow: compiled.usesNow,
    };
  },

  async preview(tx: Tx, input: PreviewFormulaInput): Promise<PreviewFormulaOutput> {
    const data = previewFormulaInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const source = toSource(data);
    const { compiled, loaded } = await compileFor(tx, def, source, data.outputTypeOverride);
    const accurateAt = tx.now;
    if (!compiled.ok) return { type: 'syntax_error', diagnostics: compiled.diagnostics, accurateAt };
    const instance = await tx.db
      .selectFrom('entity_instances')
      .select('id')
      .where('id', '=', data.entityInstanceId)
      .where('entity_definition_id', '=', def.id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!instance)
      throw notFound('The requested record could not be found', { entity_instance_id: data.entityInstanceId });
    const record = (await loadReferenceData(tx, compiled.references, loaded.defs, [instance.id])).get(instance.id);
    const result = evaluateFormula(compiled, {
      now: Date.parse(tx.now),
      ref: (i) => record?.values[i] ?? null,
      history: (i) => record?.history.get(i) ?? [],
    });
    if (result.type === 'complete') {
      return {
        type: 'complete',
        value: outputToWriteValue(compiled.outputType, result.outputValue) ?? null,
        outputType: compiled.outputType,
        display: result.display,
        accurateAt,
      };
    }
    if (result.type === 'evaluation_error') {
      return { type: 'evaluation_error', code: result.code, message: result.message, accurateAt };
    }
    return { type: 'syntax_error', diagnostics: compiled.diagnostics, accurateAt };
  },

  async snapshots(tx: Tx, entityDefinitionId: string, attributeDefinitionId: string): Promise<FormulaSnapshot[]> {
    const attr = resolveAttribute(await loadDefinition(tx, entityDefinitionId), attributeDefinitionId);
    const rows = await tx.db
      .selectFrom('formula_attribute_snapshots')
      .selectAll()
      .where('attribute_id', '=', attr.id)
      .orderBy('created_at')
      .execute();
    return rows.map(toSnapshot);
  },

  async snapshot(tx: Tx, snapshotId: string): Promise<FormulaSnapshot> {
    const row = await tx.db
      .selectFrom('formula_attribute_snapshots')
      .selectAll()
      .where('id', '=', snapshotId)
      .executeTakeFirst();
    if (!row)
      throw notFound('The requested formula snapshot could not be found', {
        formula_attribute_snapshot_id: snapshotId,
      });
    return toSnapshot(row);
  },

  /** Per-record formula and AI autofill state of one attribute (entity annotations, §5.3). */
  async annotations(tx: Tx, input: EntityAnnotationsInput): Promise<Record<string, EntityAnnotation>> {
    const data = entityAnnotationsInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    const rows = await tx.db
      .selectFrom('entity_annotations')
      .selectAll()
      .where('attribute_id', '=', attr.id)
      .where('instance_id', 'in', data.entityInstanceIds)
      .execute();
    const byId = new Map(rows.map((r) => [r.instance_id, r]));
    const out: Record<string, EntityAnnotation> = {};
    for (const id of data.entityInstanceIds) out[id] = toAnnotation(attr, id, byId.get(id) ?? null);
    return out;
  },
};

type SnapshotRow = {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  attribute_id: string;
  grammar_version: string;
  plaintext: string;
  annotations: unknown;
  output_type_override: string | null;
  created_by: unknown;
  created_at: string;
};

function toSnapshot(r: SnapshotRow): FormulaSnapshot {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entityDefinitionId: r.entity_definition_id,
    attributeDefinitionId: r.attribute_id,
    grammarVersion: r.grammar_version,
    plaintext: r.plaintext,
    annotations: (r.annotations ?? []) as unknown[],
    outputTypeOverride: r.output_type_override,
    createdBy: r.created_by as FormulaSnapshot['createdBy'],
    createdAt: r.created_at,
  };
}

export type AnnotationRow = {
  formula_status: 'pending' | 'complete' | 'error' | null;
  formula_status_changed_at: string | null;
  formula_error: string | null;
  formula_error_message: string | null;
  ai_status: 'queued' | 'running' | 'complete' | 'error' | null;
  ai_status_changed_at: string | null;
  ai_error: string | null;
  ai_basis_reasoning: string | null;
};

export function toAnnotation(attr: AttrDef, instanceId: string, row: AnnotationRow | null): EntityAnnotation {
  let formula: EntityAnnotation['formula'] = null;
  if (attr.formula) {
    const status = row?.formula_status ?? null;
    const changedAt = row?.formula_status_changed_at ?? null;
    const stale = changedAt === null || attr.formula.activeSnapshotCreatedAt > changedAt;
    formula = {
      lastExecutionStatus: status,
      lastExecutionStatusChangedAt: changedAt,
      lastExecutionError: row?.formula_error ?? null,
      lastExecutionErrorPublicMessage: row?.formula_error_message ?? null,
      state:
        status === null || status === 'pending' || stale ? 'calculating' : status === 'error' ? 'errored' : 'value',
    };
  }
  let aiAutofill: EntityAnnotation['aiAutofill'] = null;
  if (attr.aiAutofill || row?.ai_status) {
    const status = row?.ai_status ?? null;
    aiAutofill = {
      status,
      statusChangedAt: row?.ai_status_changed_at ?? null,
      error: row?.ai_error ?? null,
      basisReasoning: row?.ai_basis_reasoning ?? null,
      thinking: status === 'queued' || status === 'running',
    };
  }
  return { entityInstanceId: instanceId, formula, aiAutofill };
}
