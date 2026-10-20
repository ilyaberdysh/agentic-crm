// CSV import services (BACKLOG 4.07; import.md I1–I9). Each method runs in one workspace transaction (I1, I2);
// record writes happen only in the worker's execution batches, through the record write path (see run.ts).
import {
  type CreateImportInput,
  type CreateImportOptionsInput,
  type CreateImportOptionsOutput,
  type CreateImportOutput,
  createImportInputSchema,
  createImportOptionsInputSchema,
  type ImportAssertion,
  type ImportAssertionStatus,
  type ImportAssertionsInput,
  type ImportAssertionsOutput,
  type ImportColumn,
  type ImportFailureReason,
  type ImportHistoryInput,
  type ImportHistoryOutput,
  type ImportPlannedOutcome,
  type ImportPlanOutput,
  type ImportReviewValue,
  type ImportStatus,
  type ImportStrategy,
  importAssertionsInputSchema,
  importHistoryInputSchema,
  type MappablePropertiesOutput,
  type Path,
  type ReviewSummaryOutput,
  type ReviewValuesInput,
  type ReviewValuesOutput,
  reviewValuesInputSchema,
  type SetImportMappingInput,
  type SetImportOverrideInput,
  setImportMappingInputSchema,
  setImportOverrideInputSchema,
  type UploadRowsInput,
  type UploadRowsOutput,
  uploadRowsInputSchema,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { JobQueue } from '../jobs/queue.ts';
import { type DefInfo, loadDefinition } from '../schema/model.ts';
import { insertOptions, schemaOps } from '../schema/service.ts';
import { isValidTimeZone } from '../time.ts';
import type { Tx } from '../tx.ts';
import { parseValue } from '../values/codecs.ts';
import {
  autoMap,
  type CompiledMapping,
  type CompiledProperty,
  CREATABLE_TYPES,
  compileMapping,
  isListDefinition,
  mappableGroups,
  resolveTargetAttr,
} from './mapping.ts';
import {
  assertEditable,
  assertUploaded,
  emptyStatusCounts,
  type JobRow,
  loadProperties,
  type MappingRow,
  type PropertyRow,
  requireJob,
  requireMapping,
  stateConflict,
  toJob,
  toMapping,
  toProperty,
  touchJob,
} from './model.ts';
import {
  type DateFormat,
  detectDateFormat,
  detectDecimalSeparator,
  isUuid,
  parseDate,
  parseTimestamp,
  resolutionTypeOf,
} from './parse.ts';
import { distinctValues, hashValue, nodeRowValues, type ResolvedCell, Resolver } from './resolve.ts';
import { failureMessage, type PlannedAssertion, planRows } from './run.ts';

export const IMPORT_RECORD_ENTITY_TYPES = new Set([
  'person-record',
  'company-record',
  'standard-object',
  'custom-record',
  'collection-entry',
]);

export interface ImportDeps {
  jobs: JobQueue;
}

const actor = (tx: Tx) => jsonb(tx.ctx.actor);

// ---------------------------------------------------------------------------------------------------------------
// Loading and status

interface Loaded {
  job: JobRow;
  mapping: MappingRow;
  root: DefInfo;
  rows: PropertyRow[];
  compiled: CompiledMapping;
}

export async function loadImport(tx: Tx, jobId: string, options: { lock?: boolean } = {}): Promise<Loaded> {
  const job = await requireJob(tx, jobId, options);
  const mapping = await requireMapping(tx, job.import_mapping_id);
  const root = await loadDefinition(tx, job.entity_definition_id);
  const rows = await loadProperties(tx, mapping.id);
  const compiled = await compileMapping(tx, root, rows, mapping.list_strategy);
  return { job, mapping, root, rows, compiled };
}

/** A mapping, override or option change invalidates the plan: its assertions are dropped until the next preview. */
async function markPlanStale(tx: Tx, job: JobRow): Promise<void> {
  if (job.plan_status !== 'ready') return;
  await tx.db.deleteFrom('import_job_assertions').where('import_job_id', '=', job.id).execute();
  await tx.db
    .updateTable('import_jobs')
    .set({ plan_status: 'stale', progress_total: 0, progress_done: 0, updated_at: tx.now })
    .where('id', '=', job.id)
    .execute();
}

async function loadColumns(tx: Tx, jobId: string, rows: PropertyRow[]): Promise<ImportColumn[]> {
  const cols = await tx.db
    .selectFrom('import_job_columns')
    .selectAll()
    .where('import_job_id', '=', jobId)
    .orderBy('column_index')
    .execute();
  const byColumn = new Map(rows.map((r) => [r.column_index, r.id]));
  return cols.map((c) => ({
    columnIndex: c.column_index,
    header: c.visible_name,
    exampleValues: (c.example_values as string[]) ?? [],
    propertyId: byColumn.get(c.column_index) ?? null,
  }));
}

type Counts = Map<
  number,
  { planned: Record<ImportPlannedOutcome, number>; statuses: Record<ImportAssertionStatus, number> }
>;

async function assertionCounts(tx: Tx, jobId: string): Promise<Counts> {
  const rows = await tx.db
    .selectFrom('import_job_assertions')
    .select(['strategy_index', 'planned_outcome', 'status'])
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('import_job_id', '=', jobId)
    .groupBy(['strategy_index', 'planned_outcome', 'status'])
    .execute();
  const out: Counts = new Map();
  for (const r of rows) {
    let entry = out.get(r.strategy_index);
    if (!entry) {
      entry = { planned: { create: 0, update: 0, skip: 0, fail: 0 }, statuses: emptyStatusCounts() };
      out.set(r.strategy_index, entry);
    }
    entry.planned[r.planned_outcome] += Number(r.n);
    entry.statuses[r.status] += Number(r.n);
  }
  return out;
}

interface StoredStrategy {
  index: number;
  entityDefinitionId: string;
  path: Path | null;
  depth: number;
  mode: ImportStrategy['mode'];
  matchingAttributeDefinitionId: string | null;
  isListEntries: boolean;
  mappingPropertyIds: string[];
  attributeDefinitionIds: string[];
}

export function strategiesOf(compiled: CompiledMapping): StoredStrategy[] {
  return compiled.nodes.map((n) => ({
    index: n.index,
    entityDefinitionId: n.def.id,
    path: n.path,
    depth: n.depth,
    mode: n.mode,
    matchingAttributeDefinitionId: n.matchAttr?.id ?? null,
    isListEntries: n.isListEntries,
    mappingPropertyIds: n.properties.map((p) => p.row.id),
    attributeDefinitionIds: [...new Set(n.properties.map((p) => p.attr.id))],
  }));
}

function withCounts(strategies: StoredStrategy[], counts: Counts): ImportStrategy[] {
  return strategies.map((s) => ({
    ...s,
    planned: counts.get(s.index)?.planned ?? { create: 0, update: 0, skip: 0, fail: 0 },
    statuses: counts.get(s.index)?.statuses ?? emptyStatusCounts(),
  }));
}

export async function buildStatus(tx: Tx, loaded: Loaded): Promise<ImportStatus> {
  const { job, mapping, rows, compiled } = loaded;
  // A ready plan's stored strategies describe its assertions; otherwise the current mapping's (no counts yet).
  const ready = job.plan_status === 'ready' && job.plan !== null;
  const strategies = ready
    ? withCounts(
        (job.plan as unknown as { strategies: StoredStrategy[] }).strategies ?? [],
        await assertionCounts(tx, job.id),
      )
    : withCounts(strategiesOf(compiled), new Map());
  const propByRow = new Map(compiled.properties.map((p) => [p.row.id, p]));
  return {
    mapping: toMapping(mapping),
    job: toJob(job),
    columns: await loadColumns(tx, job.id, rows),
    properties: rows.map((r) => {
      const p = propByRow.get(r.id);
      return toProperty(r, p?.attr.type ?? 'text', p?.node.index ?? null);
    }),
    validation: compiled.validation,
    strategies,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Upload

async function insertProperty(
  tx: Tx,
  mapping: MappingRow,
  root: DefInfo,
  spec: {
    id?: string;
    columnIndex: number;
    path: Path;
    field: PropertyRow['field'];
    dateFormat?: DateFormat | null;
    timestampFormat?: DateFormat | null;
    decimalSeparator?: 'point' | 'comma' | null;
  },
): Promise<void> {
  const attr = await resolveTargetAttr(tx, root, spec.path);
  if (!attr) throw badRequest('VALIDATION_ERROR', 'The mapped attribute could not be found', { path: spec.path });
  const field = attr.type === 'personal-name' ? (spec.field ?? 'full-name') : null;
  await tx.db
    .insertInto('import_mapping_properties')
    .values({
      id: spec.id ?? newId(),
      workspace_id: tx.workspaceId,
      import_mapping_id: mapping.id,
      column_index: spec.columnIndex,
      path: jsonb(spec.path),
      field,
      resolution_type: resolutionTypeOf(attr.type, {
        isId: attr.systemAttributeType === 'id',
        field,
        systemAttributeType: attr.systemAttributeType,
      }),
      date_format: spec.dateFormat ?? null,
      timestamp_format: spec.timestampFormat ?? null,
      decimal_separator: spec.decimalSeparator ?? null,
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
}

/** Fills date / timestamp formats and decimal separators nobody chose yet from the column's values. */
async function detectFormats(tx: Tx, job: JobRow, compiled: CompiledMapping): Promise<void> {
  if (job.status !== 'draft') return;
  for (const prop of compiled.properties) {
    const type = prop.attr.type;
    const row = prop.row;
    const needs =
      (type === 'date' && row.date_format === null) ||
      (type === 'timestamp' && row.timestamp_format === null) ||
      ((type === 'number' || type === 'currency') && row.decimal_separator === null);
    if (!needs) continue;
    const { rows } = await sql<{ v: string }>`
      SELECT DISTINCT cells[${row.column_index + 1}] AS v FROM import_job_rows
      WHERE import_job_id = ${job.id}::uuid AND coalesce(cells[${row.column_index + 1}], '') <> '' LIMIT 500`.execute(
      tx.db,
    );
    const samples = rows.map((r) => r.v);
    if (samples.length === 0) continue;
    const patch =
      type === 'date'
        ? { date_format: detectDateFormat(samples, parseDate) }
        : type === 'timestamp'
          ? { timestamp_format: detectDateFormat(samples, (s, f) => parseTimestamp(s, f, job.time_zone)) }
          : { decimal_separator: detectDecimalSeparator(samples) };
    await tx.db.updateTable('import_mapping_properties').set(patch).where('id', '=', row.id).execute();
  }
}

async function completeUpload(tx: Tx, job: JobRow, uploaded: number): Promise<void> {
  await tx.db
    .updateTable('import_jobs')
    .set({ status: 'draft', row_count: uploaded, uploaded_row_count: uploaded, updated_at: tx.now })
    .where('id', '=', job.id)
    .execute();
  // Data preview samples: up to 10 distinct non-empty values per column from the first rows.
  const first = await tx.db
    .selectFrom('import_job_rows')
    .select('cells')
    .where('import_job_id', '=', job.id)
    .orderBy('row_index')
    .limit(200)
    .execute();
  for (let col = 0; col < job.column_count; col++) {
    const samples: string[] = [];
    for (const r of first) {
      const v = r.cells[col] ?? '';
      if (v.trim() !== '' && !samples.includes(v)) samples.push(v);
      if (samples.length >= 10) break;
    }
    await tx.db
      .updateTable('import_job_columns')
      .set({ example_values: jsonb(samples) })
      .where('import_job_id', '=', job.id)
      .where('column_index', '=', col)
      .execute();
  }
  const loaded = await loadImport(tx, job.id);
  await detectFormats(tx, loaded.job, loaded.compiled);
}

// ---------------------------------------------------------------------------------------------------------------
// Override validation

async function validateOverrideValues(tx: Tx, prop: CompiledProperty, values: unknown[]): Promise<unknown[]> {
  if (prop.isId) {
    for (const v of values) {
      if (typeof v !== 'string' || !isUuid(v)) throw badRequest('VALIDATION_ERROR', 'Invalid ID', { value: v });
    }
    return values.map((v) => String(v).toLowerCase());
  }
  if (prop.attr.type === 'personal-name') {
    for (const v of values) if (typeof v !== 'string') throw badRequest('VALIDATION_ERROR', 'A name part is text');
    return values.slice(0, 1);
  }
  if (!prop.attr.isMultiselect && values.length > 1) {
    throw badRequest('VALIDATION_ERROR', `Attribute "${prop.attr.title}" accepts a single value`);
  }
  for (const v of values) parseValue(prop.attr, v); // throws VALUE_VALIDATION_FAILED
  if (prop.attr.type === 'select' || prop.attr.type === 'pipeline') {
    const ids = values.map(
      (v) =>
        (v as { selectOptionId?: string; pipelineStageId?: string }).selectOptionId ??
        (v as { pipelineStageId?: string }).pipelineStageId,
    );
    const live = await tx.db
      .selectFrom('select_options')
      .select('id')
      .where('attribute_id', '=', prop.attr.id)
      .where('is_archived', '=', false)
      .where('id', 'in', ids.length ? (ids as string[]) : ['00000000-0000-0000-0000-000000000000'])
      .execute();
    if (live.length !== new Set(ids).size)
      throw badRequest('VALUE_VALIDATION_FAILED', 'Unknown option', { reason: 'unknown-option' });
  }
  return values;
}

function reviewValueOf(resolver: Resolver, prop: CompiledProperty, raw: string, rowCount: number): ImportReviewValue {
  const res: ResolvedCell = resolver.resolve(prop, raw);
  const status: ImportReviewValue['status'] = res.overridden
    ? 'overridden'
    : res.empty
      ? 'empty'
      : res.errors.length > 0
        ? 'invalid'
        : res.missing.length > 0
          ? 'missing-options'
          : 'mapped';
  return {
    hashedValue: hashValue(raw),
    rawValue: raw,
    rowCount,
    status,
    needsReview: status === 'invalid' || status === 'missing-options',
    values: res.values,
    errors: res.errors,
    missingOptions: res.missing,
    override: res.override,
  };
}

function requireProperty(compiled: CompiledMapping, rows: PropertyRow[], propertyId: string): CompiledProperty {
  const prop = compiled.properties.find((p) => p.row.id === propertyId);
  if (!prop) {
    if (rows.some((r) => r.id === propertyId)) {
      throw badRequest('VALIDATION_ERROR', 'This column is mapped to an attribute that cannot be imported');
    }
    throw notFound('The requested column mapping could not be found', { property_id: propertyId });
  }
  return prop;
}

// ---------------------------------------------------------------------------------------------------------------
// Plan storage

async function storePlan(tx: Tx, loaded: Loaded): Promise<void> {
  const { job, compiled } = loaded;
  if (compiled.validation.blocking.length > 0) {
    throw badRequest('VALIDATION_ERROR', compiled.validation.blocking[0]?.message ?? 'The mapping is not valid', {
      reason: 'invalid-mapping',
      issues: compiled.validation.blocking,
    });
  }
  await tx.db.deleteFrom('import_job_assertions').where('import_job_id', '=', job.id).execute();
  const resolver = await Resolver.load(tx, compiled, job);
  let total = 0;
  await planRows(tx, compiled, resolver, job.id, async (page: PlannedAssertion[]) => {
    total += page.length;
    for (let i = 0; i < page.length; i += 5000) {
      const chunk = page.slice(i, i + 5000);
      await sql`
        INSERT INTO import_job_assertions
          (workspace_id, import_job_id, strategy_index, row_index, planned_outcome, matched_entity_instance_ids,
           failure_reason)
        SELECT ${tx.workspaceId}::uuid, ${job.id}::uuid, a.s, a.r, a.o,
               ARRAY(SELECT jsonb_array_elements_text(a.m))::uuid[], a.f
        FROM jsonb_to_recordset(${JSON.stringify(
          chunk.map((a) => ({ s: a.strategyIndex, r: a.rowIndex, o: a.outcome, m: a.matchedIds, f: a.failureReason })),
        )}::jsonb) AS a(s int, r int, o text, m jsonb, f text)`.execute(tx.db);
    }
  });
  await tx.db
    .updateTable('import_jobs')
    .set({
      plan_status: 'ready',
      plan: jsonb({ strategies: strategiesOf(compiled) }),
      planned_at: tx.now,
      progress_total: total,
      progress_done: 0,
      updated_at: tx.now,
    })
    .where('id', '=', job.id)
    .execute();
}

async function planOutput(tx: Tx, jobId: string): Promise<ImportPlanOutput> {
  const job = await requireJob(tx, jobId);
  const strategies = withCounts(
    (job.plan as unknown as { strategies: StoredStrategy[] } | null)?.strategies ?? [],
    await assertionCounts(tx, job.id),
  );
  const totals = { create: 0, update: 0, skip: 0, fail: 0 };
  for (const s of strategies) for (const k of Object.keys(totals) as ImportPlannedOutcome[]) totals[k] += s.planned[k];
  const invalid = await tx.db
    .selectFrom('import_job_assertions')
    .selectAll()
    .where('import_job_id', '=', job.id)
    .where('planned_outcome', '=', 'fail')
    .orderBy('row_index')
    .orderBy('strategy_index')
    .limit(100)
    .execute();
  const loaded = await loadImport(tx, job.id);
  const invalidRows = await withValues(tx, loaded, invalid);
  return { jobId: job.id, plannedAt: job.planned_at ?? tx.now, strategies, totals, invalidRows };
}

type AssertionRow = Awaited<ReturnType<typeof selectAssertions>>[number];
function selectAssertions(tx: Tx, jobId: string) {
  return tx.db.selectFrom('import_job_assertions').selectAll().where('import_job_id', '=', jobId).limit(0).execute();
}

async function withValues(tx: Tx, loaded: Loaded, rows: AssertionRow[]): Promise<ImportAssertion[]> {
  if (rows.length === 0) return [];
  const cells = await tx.db
    .selectFrom('import_job_rows')
    .select(['row_index', 'cells'])
    .where('import_job_id', '=', loaded.job.id)
    .where('row_index', 'in', [...new Set(rows.map((r) => r.row_index))])
    .execute();
  const byRow = new Map(cells.map((c) => [c.row_index, c.cells]));
  const resolver = await Resolver.load(tx, loaded.compiled, loaded.job);
  return rows.map((r) => {
    const node = loaded.compiled.nodes[r.strategy_index];
    const rv = node ? nodeRowValues(resolver, node, byRow.get(r.row_index) ?? []) : null;
    return {
      strategyIndex: r.strategy_index,
      rowIndex: r.row_index,
      plannedOutcome: r.planned_outcome,
      status: r.status,
      matchedEntityInstanceIds: r.matched_entity_instance_ids,
      entityInstanceIds: r.entity_instance_ids,
      failureReason: (r.failure_reason as ImportFailureReason | null) ?? null,
      failureMessage: failureMessage(r.failure_reason),
      values: rv?.display ?? {},
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Services

export const importOps = {
  async create(tx: Tx, deps: ImportDeps, input: CreateImportInput): Promise<CreateImportOutput> {
    void deps;
    const data = createImportInputSchema.parse(input);
    if (data.jobId) {
      const existing = await tx.db
        .selectFrom('import_jobs')
        .select('id')
        .where('id', '=', data.jobId)
        .executeTakeFirst();
      if (existing) {
        const status = await buildStatus(tx, await loadImport(tx, existing.id));
        return { ...status, importId: status.mapping.id, jobId: status.job.id };
      }
    }
    const root = await loadDefinition(tx, data.entityDefinitionId);
    if (!IMPORT_RECORD_ENTITY_TYPES.has(root.entityType) || root.isArchived) {
      throw badRequest('VALIDATION_ERROR', `Records cannot be imported into "${root.apiSlug}"`);
    }
    const timeZone = data.timeZone ?? 'UTC';
    if (!isValidTimeZone(timeZone)) throw badRequest('VALIDATION_ERROR', `Unknown time zone "${timeZone}"`);
    const importId = data.importId ?? newId();
    const jobId = data.jobId ?? newId();
    await tx.db
      .insertInto('import_mappings')
      .values({
        id: importId,
        workspace_id: tx.workspaceId,
        entity_definition_id: root.id,
        title: data.fileName,
        created_by: actor(tx),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .execute();
    await tx.db
      .insertInto('import_jobs')
      .values({
        id: jobId,
        workspace_id: tx.workspaceId,
        import_mapping_id: importId,
        entity_definition_id: root.id,
        source_file_name: data.fileName,
        column_count: data.columns.length,
        row_count: data.rowCount,
        time_zone: timeZone,
        created_by: actor(tx),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .execute();
    await tx.db
      .insertInto('import_job_columns')
      .values(
        data.columns.map((header, column_index) => ({
          workspace_id: tx.workspaceId,
          import_job_id: jobId,
          column_index,
          visible_name: header,
        })),
      )
      .execute();
    const mapping = await requireMapping(tx, importId);
    for (const m of autoMap(data.columns, await mappableGroups(tx, root))) {
      await insertProperty(tx, mapping, root, { columnIndex: m.columnIndex, path: m.path, field: m.field });
    }
    const job = await requireJob(tx, jobId);
    touchJob(tx, job);
    const status = await buildStatus(tx, await loadImport(tx, jobId));
    return { ...status, importId, jobId };
  },

  async uploadRows(tx: Tx, input: UploadRowsInput): Promise<UploadRowsOutput> {
    const data = uploadRowsInputSchema.parse(input);
    const job = await requireJob(tx, data.jobId, { lock: true });
    if (job.status !== 'uploading') {
      // A replayed chunk after the upload completed is a no-op.
      return { jobId: job.id, uploadedRowCount: job.uploaded_row_count, rowCount: job.row_count, status: job.status };
    }
    if (data.startRow + data.rows.length > job.row_count) {
      throw badRequest('VALIDATION_ERROR', `Please upload a file with at most ${job.row_count} rows`, {
        reason: 'too-many-rows',
      });
    }
    if (data.rows.length > 0) {
      const rows = data.rows.map((cells, i) => {
        const padded = cells.slice(0, job.column_count);
        while (padded.length < job.column_count) padded.push('');
        return { r: data.startRow + i, c: padded };
      });
      await sql`
        INSERT INTO import_job_rows (workspace_id, import_job_id, row_index, cells)
        SELECT ${tx.workspaceId}::uuid, ${job.id}::uuid, x.r,
               ARRAY(SELECT e.v FROM jsonb_array_elements_text(x.c) WITH ORDINALITY AS e(v, n) ORDER BY e.n)
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(r int, c jsonb)
        ON CONFLICT (import_job_id, row_index) DO UPDATE SET cells = EXCLUDED.cells`.execute(tx.db);
    }
    const counted = await tx.db
      .selectFrom('import_job_rows')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('import_job_id', '=', job.id)
      .executeTakeFirstOrThrow();
    const uploaded = Number(counted.n);
    if (data.final || uploaded >= job.row_count) {
      if (uploaded === 0) {
        await tx.db
          .updateTable('import_jobs')
          .set({
            status: 'upload-failed',
            ingestion_failure_reason: 'This file does not contain any rows',
            updated_at: tx.now,
          })
          .where('id', '=', job.id)
          .execute();
      } else await completeUpload(tx, job, uploaded);
    } else {
      await tx.db
        .updateTable('import_jobs')
        .set({ uploaded_row_count: uploaded, updated_at: tx.now })
        .where('id', '=', job.id)
        .execute();
    }
    touchJob(tx, job);
    const after = await requireJob(tx, job.id);
    return {
      jobId: job.id,
      uploadedRowCount: after.uploaded_row_count,
      rowCount: after.row_count,
      status: after.status,
    };
  },

  async status(tx: Tx, jobId: string): Promise<ImportStatus> {
    return buildStatus(tx, await loadImport(tx, jobId));
  },

  async mappableProperties(tx: Tx, jobId: string): Promise<MappablePropertiesOutput> {
    const loaded = await loadImport(tx, jobId);
    return {
      entityDefinitionId: loaded.root.id,
      isList: isListDefinition(loaded.root),
      columns: await loadColumns(tx, jobId, loaded.rows),
      groups: await mappableGroups(tx, loaded.root),
      creatableTypes: [...CREATABLE_TYPES],
    };
  },

  async setMapping(
    tx: Tx,
    deps: { assertCanCreateAttribute: (defId: string) => Promise<void> },
    input: SetImportMappingInput,
  ): Promise<ImportStatus> {
    const data = setImportMappingInputSchema.parse(input);
    const loaded = await loadImport(tx, data.jobId, { lock: true });
    const { job, mapping, root } = loaded;
    assertEditable(job);
    if (data.listStrategy && data.listStrategy !== mapping.list_strategy) {
      await tx.db
        .updateTable('import_mappings')
        .set({ list_strategy: data.listStrategy, updated_at: tx.now })
        .where('id', '=', mapping.id)
        .execute();
    }
    const byColumn = new Map(loaded.rows.map((r) => [r.column_index, r]));
    for (const { columnIndex, target } of data.columns) {
      if (columnIndex >= job.column_count) {
        throw badRequest('VALIDATION_ERROR', `Column ${columnIndex} does not exist`, { column_index: columnIndex });
      }
      const existing = byColumn.get(columnIndex);
      if (target.type === 'ignore') {
        if (existing) await tx.db.deleteFrom('import_mapping_properties').where('id', '=', existing.id).execute();
        continue;
      }
      let path: Path;
      if (target.type === 'create-attribute') {
        await deps.assertCanCreateAttribute(root.id);
        const created = await schemaOps.createAttribute(tx, {
          id: target.attribute.id,
          entityDefinitionId: root.id,
          title: target.attribute.title,
          type: target.attribute.type,
          isMultiselect: target.attribute.isMultiselect,
          ...(target.attribute.numberConfiguration
            ? { numberConfiguration: target.attribute.numberConfiguration }
            : {}),
          ...(target.attribute.currencyConfiguration
            ? { currencyConfiguration: target.attribute.currencyConfiguration }
            : {}),
          ...(target.attribute.options ? { options: target.attribute.options } : {}),
          ...(target.attribute.stages ? { stages: target.attribute.stages } : {}),
        });
        path = [{ entityDefinitionId: root.id, attributeDefinitionId: created.id }];
      } else path = target.path;
      const field = target.type === 'attribute' ? (target.field ?? null) : null;
      const formats = {
        ...(target.dateFormat ? { date_format: target.dateFormat } : {}),
        ...(target.timestampFormat ? { timestamp_format: target.timestampFormat } : {}),
        ...(target.decimalSeparator ? { decimal_separator: target.decimalSeparator } : {}),
      };
      const samePath =
        existing && JSON.stringify(existing.path) === JSON.stringify(path) && (existing.field ?? null) === field;
      if (samePath && existing) {
        if (Object.keys(formats).length > 0) {
          await tx.db
            .updateTable('import_mapping_properties')
            .set({ ...formats, updated_at: tx.now })
            .where('id', '=', existing.id)
            .execute();
        }
        continue;
      }
      if (existing) await tx.db.deleteFrom('import_mapping_properties').where('id', '=', existing.id).execute();
      await insertProperty(tx, mapping, await loadDefinition(tx, root.id), {
        columnIndex,
        path,
        field,
        dateFormat: target.dateFormat ?? null,
        timestampFormat: target.timestampFormat ?? null,
        decimalSeparator: target.decimalSeparator ?? null,
      });
    }
    const after = await loadImport(tx, job.id);
    await detectFormats(tx, after.job, after.compiled);
    await markPlanStale(tx, job);
    touchJob(tx, job);
    return buildStatus(tx, await loadImport(tx, job.id));
  },

  async reviewValues(tx: Tx, input: ReviewValuesInput): Promise<ReviewValuesOutput> {
    const data = reviewValuesInputSchema.parse(input);
    const loaded = await loadImport(tx, data.jobId);
    assertUploaded(loaded.job);
    const prop = requireProperty(loaded.compiled, loaded.rows, data.propertyId);
    const resolver = await Resolver.load(tx, loaded.compiled, loaded.job);
    const all = (await distinctValues(tx, loaded.job.id, prop.row.column_index)).map((d) =>
      reviewValueOf(resolver, prop, d.raw, d.count),
    );
    const missing = new Map<string, string>();
    for (const v of all)
      for (const m of v.missingOptions) if (!missing.has(m.toLowerCase())) missing.set(m.toLowerCase(), m);
    const needsReview = all.filter((v) => v.needsReview);
    const group =
      data.group === 'needs-review'
        ? needsReview
        : data.group === 'automatically-mapped'
          ? all.filter((v) => !v.needsReview)
          : all;
    const dir = data.sort.direction === 'asc' ? 1 : -1;
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    group.sort((a, b) =>
      data.sort.field === 'row-count'
        ? (a.rowCount - b.rowCount) * dir || collator.compare(a.rawValue, b.rawValue)
        : collator.compare(a.rawValue, b.rawValue) * dir,
    );
    const types = new Map(loaded.compiled.properties.map((p) => [p.row.id, p]));
    return {
      property: toProperty(prop.row, prop.attr.type, types.get(prop.row.id)?.node.index ?? null),
      total: all.length,
      needsReviewCount: needsReview.length,
      automaticallyMappedCount: all.length - needsReview.length,
      missingOptions: [...missing.values()].sort((a, b) => collator.compare(a, b)),
      matching: group.length,
      values: group.slice(data.offset, data.offset + data.limit),
    };
  },

  async reviewSummary(tx: Tx, jobId: string): Promise<ReviewSummaryOutput> {
    const loaded = await loadImport(tx, jobId);
    assertUploaded(loaded.job);
    const resolver = await Resolver.load(tx, loaded.compiled, loaded.job);
    const out: ReviewSummaryOutput['properties'] = [];
    for (const prop of loaded.compiled.properties) {
      const values = (await distinctValues(tx, jobId, prop.row.column_index)).map((d) =>
        reviewValueOf(resolver, prop, d.raw, d.count),
      );
      const missing = new Set(values.flatMap((v) => v.missingOptions.map((m) => m.toLowerCase())));
      out.push({
        propertyId: prop.row.id,
        distinctCount: values.length,
        needsReviewCount: values.filter((v) => v.needsReview).length,
        missingOptionCount: missing.size,
      });
    }
    return { properties: out };
  },

  async setOverride(tx: Tx, input: SetImportOverrideInput): Promise<ImportReviewValue> {
    const data = setImportOverrideInputSchema.parse(input);
    const loaded = await loadImport(tx, data.jobId, { lock: true });
    assertEditable(loaded.job);
    const prop = requireProperty(loaded.compiled, loaded.rows, data.propertyId);
    const hash = hashValue(data.rawValue);
    if (data.override === null) {
      await tx.db
        .deleteFrom('import_overrides')
        .where('import_mapping_property_id', '=', prop.row.id)
        .where('hashed_value', '=', hash)
        .execute();
    } else {
      const values =
        data.override.type === 'skip' ? null : await validateOverrideValues(tx, prop, data.override.values);
      await sql`
        INSERT INTO import_overrides
          (workspace_id, import_mapping_property_id, hashed_value, raw_value, override_values, created_by, created_at,
           updated_at)
        VALUES (${tx.workspaceId}::uuid, ${prop.row.id}::uuid, ${hash}, ${data.rawValue}, ${jsonb(values)}::jsonb,
                ${jsonb(tx.ctx.actor)}::jsonb, ${tx.now}::timestamptz, ${tx.now}::timestamptz)
        ON CONFLICT (import_mapping_property_id, hashed_value)
        DO UPDATE SET override_values = EXCLUDED.override_values, updated_at = EXCLUDED.updated_at`.execute(tx.db);
    }
    await markPlanStale(tx, loaded.job);
    touchJob(tx, loaded.job);
    const count = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM import_job_rows
      WHERE import_job_id = ${loaded.job.id}::uuid AND coalesce(cells[${prop.row.column_index + 1}], '') = ${data.rawValue}`.execute(
      tx.db,
    );
    const resolver = await Resolver.load(tx, loaded.compiled, loaded.job);
    return reviewValueOf(resolver, prop, data.rawValue, Number(count.rows[0]?.n ?? 0));
  },

  async createOptions(
    tx: Tx,
    deps: { assertCanUpdateAttribute: (defId: string) => Promise<void> },
    input: CreateImportOptionsInput,
  ): Promise<CreateImportOptionsOutput> {
    const data = createImportOptionsInputSchema.parse(input);
    const loaded = await loadImport(tx, data.jobId, { lock: true });
    assertEditable(loaded.job);
    assertUploaded(loaded.job);
    const prop = requireProperty(loaded.compiled, loaded.rows, data.propertyId);
    if (prop.attr.type !== 'select' && prop.attr.type !== 'pipeline') {
      throw badRequest('VALIDATION_ERROR', `Attribute "${prop.attr.title}" has no options`);
    }
    await deps.assertCanUpdateAttribute(prop.attr.entityDefinitionId);
    const resolver = await Resolver.load(tx, loaded.compiled, loaded.job);
    const missing = new Map<string, string>();
    for (const d of await distinctValues(tx, loaded.job.id, prop.row.column_index)) {
      for (const m of resolver.resolve(prop, d.raw).missing)
        if (!missing.has(m.toLowerCase())) missing.set(m.toLowerCase(), m);
    }
    const wanted = data.values ? data.values.map((v) => v.trim().toLowerCase()) : [...missing.keys()];
    const titles = wanted.map((k) => missing.get(k)).filter((t): t is string => t !== undefined);
    if (titles.length === 0) return { created: [] };
    const ids = await insertOptions(
      tx,
      prop.attr,
      titles.map((title) => ({ title })),
    );
    await markPlanStale(tx, loaded.job);
    touchJob(tx, loaded.job);
    return { created: ids.map((id, i) => ({ id, title: titles[i] as string })) };
  },

  /** Generates the plan when there is none (or it is stale) and returns it (Preview import). */
  async preview(tx: Tx, jobId: string): Promise<ImportPlanOutput> {
    const loaded = await loadImport(tx, jobId, { lock: true });
    assertUploaded(loaded.job);
    if (loaded.job.plan_status !== 'ready') {
      if (loaded.job.status !== 'draft') throw stateConflict('The plan of a started import cannot change');
      await storePlan(tx, loaded);
      touchJob(tx, loaded.job);
    }
    return planOutput(tx, jobId);
  },

  async assertions(tx: Tx, input: ImportAssertionsInput): Promise<ImportAssertionsOutput> {
    const data = importAssertionsInputSchema.parse(input);
    const loaded = await loadImport(tx, data.jobId);
    const base = tx.db
      .selectFrom('import_job_assertions')
      .where('import_job_id', '=', loaded.job.id)
      .where('strategy_index', '=', data.strategyIndex)
      .$if(data.statuses !== undefined && data.statuses.length > 0, (q) =>
        q.where('status', 'in', data.statuses as ImportAssertionStatus[]),
      )
      .$if(data.plannedOutcomes !== undefined && data.plannedOutcomes.length > 0, (q) =>
        q.where('planned_outcome', 'in', data.plannedOutcomes as ImportPlannedOutcome[]),
      );
    const total = await base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const rows = await base.selectAll().orderBy('row_index').offset(data.offset).limit(data.limit).execute();
    return { total: Number(total.n), rows: await withValues(tx, loaded, rows) };
  },

  /** Start import: confirms and queues the worker job in the same transaction (D-10). Idempotent. */
  async run(tx: Tx, deps: ImportDeps, jobId: string): Promise<ImportStatus> {
    const loaded = await loadImport(tx, jobId, { lock: true });
    const { job } = loaded;
    if (job.status === 'draft') {
      if (loaded.compiled.validation.blocking.length > 0) {
        throw badRequest('VALIDATION_ERROR', loaded.compiled.validation.blocking[0]?.message ?? 'Invalid mapping', {
          reason: 'invalid-mapping',
          issues: loaded.compiled.validation.blocking,
        });
      }
      await tx.db
        .updateTable('import_jobs')
        .set({ status: 'confirmed', confirmed_by: actor(tx), confirmed_at: tx.now, updated_at: tx.now })
        .where('id', '=', job.id)
        .execute();
      await deps.jobs.send(tx, 'import.run', { workspaceId: tx.workspaceId, jobId: job.id }, { singletonKey: job.id });
      touchJob(tx, job);
    } else if (job.status === 'uploading' || job.status === 'upload-failed') {
      assertUploaded(job);
    }
    return buildStatus(tx, await loadImport(tx, jobId));
  },

  /** Cancel import: remaining rows are not imported (takes effect after the batch in flight). */
  async cancel(tx: Tx, jobId: string): Promise<ImportStatus> {
    const job = await requireJob(tx, jobId, { lock: true });
    if (job.status === 'canceled') return buildStatus(tx, await loadImport(tx, jobId));
    if (!['confirmed', 'preparing', 'executing'].includes(job.status)) {
      throw stateConflict(
        job.status === 'completed' || job.status === 'failed'
          ? 'This import has already finished'
          : 'Only running imports can be canceled; delete the draft instead',
        { job_id: job.id, status: job.status },
      );
    }
    await tx.db
      .updateTable('import_job_assertions')
      .set({ status: 'canceled' })
      .where('import_job_id', '=', job.id)
      .where('status', '=', 'planned')
      .execute();
    await tx.db
      .updateTable('import_jobs')
      .set({ status: 'canceled', canceled_by: actor(tx), canceled_at: tx.now, updated_at: tx.now })
      .where('id', '=', job.id)
      .execute();
    touchJob(tx, job);
    return buildStatus(tx, await loadImport(tx, jobId));
  },

  /** Delete draft ("Imports that have been run cannot be deleted."). */
  async delete(tx: Tx, jobId: string): Promise<{ jobId: string }> {
    const job = await requireJob(tx, jobId, { lock: true });
    if (!['uploading', 'upload-failed', 'draft'].includes(job.status)) {
      throw stateConflict('Imports that have been run cannot be deleted.', { job_id: job.id, status: job.status });
    }
    await tx.db.deleteFrom('import_job_assertions').where('import_job_id', '=', job.id).execute();
    await tx.db.deleteFrom('import_job_rows').where('import_job_id', '=', job.id).execute();
    await tx.db
      .updateTable('import_jobs')
      .set({ deleted_at: tx.now, updated_at: tx.now })
      .where('id', '=', job.id)
      .execute();
    touchJob(tx, job);
    return { jobId: job.id };
  },

  async history(tx: Tx, input: ImportHistoryInput): Promise<ImportHistoryOutput> {
    const data = importHistoryInputSchema.parse(input);
    const defId = data.entityDefinitionId ? (await loadDefinition(tx, data.entityDefinitionId)).id : null;
    const memberId = actingMemberId(tx.ctx);
    const jobs = await tx.db
      .selectFrom('import_jobs as j')
      .innerJoin('import_mappings as m', 'm.id', 'j.import_mapping_id')
      .selectAll('j')
      .select('m.title')
      .where('j.deleted_at', 'is', null)
      .$if(defId !== null, (q) => q.where('j.entity_definition_id', '=', defId as string))
      .$if(data.onlyMine, (q) => q.where(sql<boolean>`j.created_by->>'id' = ${memberId ?? ''}`))
      .$if(data.before !== undefined, (q) => q.where('j.created_at', '<', data.before as string))
      .orderBy('j.created_at', 'desc')
      .limit(data.limit + 1)
      .execute();
    const page = jobs.slice(0, data.limit);
    const counts = new Map<string, Record<ImportAssertionStatus, number>>();
    if (page.length > 0) {
      const rows = await tx.db
        .selectFrom('import_job_assertions')
        .select(['import_job_id', 'status'])
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where(
          'import_job_id',
          'in',
          page.map((j) => j.id),
        )
        .groupBy(['import_job_id', 'status'])
        .execute();
      for (const r of rows) {
        const c = counts.get(r.import_job_id) ?? emptyStatusCounts();
        c[r.status] += Number(r.n);
        counts.set(r.import_job_id, c);
      }
    }
    return {
      jobs: page.map((j) => ({ ...toJob(j), title: j.title, counts: counts.get(j.id) ?? emptyStatusCounts() })),
      nextBefore: jobs.length > data.limit ? (page.at(-1)?.created_at ?? null) : null,
    };
  },
};

export { storePlan };
