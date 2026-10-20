// Import rows ↔ API shapes, loaders and state guards (import.md I7).
import {
  type Actor,
  type ImportAssertionStatus,
  type ImportJob,
  type ImportMapping,
  type ImportMappingProperty,
  importAssertionStatusSchema,
  importJobStatusLabels,
  type Path,
} from '@agentic-crm/contracts';
import type {
  ImportJobsTable,
  ImportMappingPropertiesTable,
  ImportMappingsTable,
  Json,
  Selectable,
} from '@agentic-crm/db';
import { toActor, toActorOrNull } from '../collab/common.ts';
import { DomainError, notFound } from '../errors.ts';
import type { Tx } from '../tx.ts';

export type JobRow = Selectable<ImportJobsTable>;
export type MappingRow = Selectable<ImportMappingsTable>;
export type PropertyRow = Selectable<ImportMappingPropertiesTable>;

export const importNotFound = (jobId: string) => notFound('The requested import could not be found', { job_id: jobId });

export const stateConflict = (message: string, details: Record<string, unknown> = {}) =>
  new DomainError(409, 'IMPORT_STATE_CONFLICT', message, details);

/** Statuses in which the mapping, overrides and options may still change. */
export const EDITABLE_STATUSES = new Set(['uploading', 'draft']);
/** Statuses of a job the worker still has to work on. */
export const RUNNABLE_STATUSES = new Set(['confirmed', 'preparing', 'executing']);

export async function requireJob(tx: Tx, jobId: string, options: { lock?: boolean } = {}): Promise<JobRow> {
  const row = await tx.db
    .selectFrom('import_jobs')
    .selectAll()
    .where('id', '=', jobId)
    .where('deleted_at', 'is', null)
    .$if(options.lock === true, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!row) throw importNotFound(jobId);
  return row;
}

export async function requireMapping(tx: Tx, mappingId: string): Promise<MappingRow> {
  const row = await tx.db.selectFrom('import_mappings').selectAll().where('id', '=', mappingId).executeTakeFirst();
  if (!row) throw notFound('The requested import could not be found', { import_id: mappingId });
  return row;
}

export async function loadProperties(tx: Tx, mappingId: string): Promise<PropertyRow[]> {
  return tx.db
    .selectFrom('import_mapping_properties')
    .selectAll()
    .where('import_mapping_id', '=', mappingId)
    .orderBy('column_index')
    .execute();
}

export function assertEditable(job: JobRow): void {
  if (!EDITABLE_STATUSES.has(job.status)) {
    throw stateConflict('This import has already been started and can no longer be changed', {
      job_id: job.id,
      status: job.status,
    });
  }
}

export function assertUploaded(job: JobRow): void {
  if (job.status === 'uploading') {
    throw stateConflict("We're still uploading your CSV file. You'll be able to progress in a few moments.", {
      job_id: job.id,
      status: job.status,
    });
  }
  if (job.status === 'upload-failed') {
    throw stateConflict(`Ingestion failed: ${job.ingestion_failure_reason ?? 'unknown'}`, { job_id: job.id });
  }
}

export function toMapping(row: MappingRow): ImportMapping {
  return {
    id: row.id,
    entityDefinitionId: row.entity_definition_id,
    title: row.title,
    sourceType: 'csv',
    listStrategy: row.list_strategy,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
  };
}

export function toJob(row: JobRow): ImportJob {
  return {
    id: row.id,
    importId: row.import_mapping_id,
    entityDefinitionId: row.entity_definition_id,
    sourceFileName: row.source_file_name,
    columnCount: row.column_count,
    rowCount: row.row_count,
    uploadedRowCount: row.uploaded_row_count,
    status: row.status,
    statusLabel: importJobStatusLabels[row.status],
    ingestionFailureReason: row.ingestion_failure_reason,
    timeZone: row.time_zone,
    planStatus: row.plan_status,
    plannedAt: row.planned_at,
    progress: { done: row.progress_done, total: row.progress_total },
    failureReason: row.failure_reason,
    confirmedBy: toActorOrNull(row.confirmed_by),
    confirmedAt: row.confirmed_at,
    canceledBy: toActorOrNull(row.canceled_by),
    canceledAt: row.canceled_at,
    startedExecutionAt: row.started_execution_at,
    completedAt: row.completed_at,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
  };
}

export function toProperty(
  row: PropertyRow,
  attributeType: ImportMappingProperty['attributeType'],
  strategyIndex: number | null,
): ImportMappingProperty {
  return {
    id: row.id,
    columnIndex: row.column_index,
    path: row.path as Path,
    field: row.field,
    resolutionType: row.resolution_type,
    attributeType,
    strategyIndex,
    dateFormat: row.date_format,
    timestampFormat: row.timestamp_format,
    decimalSeparator: row.decimal_separator,
  };
}

export function emptyStatusCounts(): Record<ImportAssertionStatus, number> {
  return Object.fromEntries(importAssertionStatusSchema.options.map((s) => [s, 0])) as Record<
    ImportAssertionStatus,
    number
  >;
}

/** Invalidates the import (wizard pages poll nothing: they refetch on this) and the history lists. */
export function touchJob(tx: Tx, job: { id: string; import_mapping_id: string; entity_definition_id: string }): void {
  tx.emit('import-job', job.id, { importId: job.import_mapping_id, entityDefinitionId: job.entity_definition_id });
  tx.emit('import-job-list', job.entity_definition_id, { entityDefinitionId: job.entity_definition_id });
}

export function actorJsonOf(actor: Actor): Json {
  return JSON.stringify(actor);
}
