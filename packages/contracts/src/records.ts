// Records (entity instances) and their values (A §4.5, §4.7; internal-api-shapes §4.4).
import { z } from 'zod';
import {
  acceptAfterSchema,
  actorSchema,
  idOrSlugSchema,
  rankSchema,
  resultSchema,
  timestampSchema,
  uuidSchema,
} from './common.ts';
import { attributeValueSchema, valueInputSchema, valuesMapSchema } from './values.ts';

/** Instance header: no values inside (A §4.5). */
export const recordHeaderSchema = z.object({
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  version: z.number().int(),
  createdAt: timestampSchema,
  createdBy: actorSchema,
  archivedAt: timestampSchema.nullable(),
  mergedAt: timestampSchema.nullable(),
  mergedIntoEntityInstanceId: uuidSchema.nullable(),
  accurateAt: timestampSchema,
});
export type RecordHeader = z.infer<typeof recordHeaderSchema>;

/** Header plus current values keyed by attribute definition id. */
export const recordWithValuesSchema = z.object({
  record: recordHeaderSchema,
  values: z.record(z.string(), z.array(attributeValueSchema)),
});
export type RecordWithValues = z.infer<typeof recordWithValuesSchema>;

const recordRef = { entityDefinitionId: idOrSlugSchema, entityInstanceId: uuidSchema };

/**
 * Create a record: PUT with a client UUID (I3). Replaying the same id returns the existing record unchanged
 * (`created: false`); an id used by another definition answers 409 INSTANCE_ID_CONFLICT.
 */
export const createRecordInputSchema = z.object({ ...recordRef, values: valuesMapSchema.default({}) });
export type CreateRecordInput = z.input<typeof createRecordInputSchema>;
export const createRecordOutputSchema = recordWithValuesSchema.extend({ created: z.boolean() });
export type CreateRecordOutput = z.infer<typeof createRecordOutputSchema>;

/**
 * PATCH several attributes. For each listed attribute the given array is the desired set of current values
 * ('replace', default) or values to add ('append', public-API multiselect semantics). Unchanged values keep their rows.
 */
export const updateRecordInputSchema = z.object({
  ...recordRef,
  values: valuesMapSchema,
  multiselectMode: z.enum(['replace', 'append']).default('replace'),
  /** Per-attribute override of multiselectMode, keyed like `values` (the public upsert appends to its matching attribute). */
  multiselectModes: z.record(z.string(), z.enum(['replace', 'append'])).optional(),
});
export type UpdateRecordInput = z.input<typeof updateRecordInputSchema>;

export const getRecordInputSchema = z.object({
  ...recordRef,
  /** Point-in-time read: values active at this instant. */
  activeAt: timestampSchema.optional(),
  acceptAfter: acceptAfterSchema,
});
export type GetRecordInput = z.input<typeof getRecordInputSchema>;

export const batchGetRecordsInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceIds: z.array(uuidSchema).min(1).max(1000),
  acceptAfter: acceptAfterSchema,
});
export type BatchGetRecordsInput = z.input<typeof batchGetRecordsInputSchema>;
export const batchGetRecordsOutputSchema = z.object({
  records: z.record(z.string(), resultSchema(recordHeaderSchema)),
  accurateAt: timestampSchema,
});
export type BatchGetRecordsOutput = z.infer<typeof batchGetRecordsOutputSchema>;

/** Live records with all their current values, in the requested order (missing/deleted ids are skipped). */
export const batchGetRecordsWithValuesInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceIds: z.array(uuidSchema).max(1000),
  acceptAfter: acceptAfterSchema,
});
export type BatchGetRecordsWithValuesInput = z.input<typeof batchGetRecordsWithValuesInputSchema>;
export const batchGetRecordsWithValuesOutputSchema = z.object({
  records: z.array(recordWithValuesSchema),
  accurateAt: timestampSchema,
});
export type BatchGetRecordsWithValuesOutput = z.infer<typeof batchGetRecordsWithValuesOutputSchema>;

/**
 * Live records holding any of `values` (write forms, normalised like writes) in a unique attribute — the lookup behind
 * the public API's upsert by `matching_attribute` and record-reference writes by matching attribute.
 */
export const findByUniqueValuesInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  attributeDefinitionId: idOrSlugSchema,
  values: z.array(valueInputSchema).min(1).max(1000),
});
export type FindByUniqueValuesInput = z.input<typeof findByUniqueValuesInputSchema>;
export const findByUniqueValuesOutputSchema = z.object({ entityInstanceIds: z.array(uuidSchema) });
export type FindByUniqueValuesOutput = z.infer<typeof findByUniqueValuesOutputSchema>;

/** Soft delete (decision X-22): gone for users, kept for audit and restore. Idempotent. */
export const deleteRecordInputSchema = z.object(recordRef);
export type DeleteRecordInput = z.input<typeof deleteRecordInputSchema>;
export const restoreRecordInputSchema = z.object(recordRef);
export type RestoreRecordInput = z.input<typeof restoreRecordInputSchema>;

/** Most rows one bulk-delete call removes (one transaction); clients split larger selections and show progress. */
export const DELETE_SELECTION_MAX_ROWS = 500;

/**
 * Bulk soft delete of a selection over a snapshot.
 * {zebra_edges}`): the zebra edges resolve against the frozen snapshot, so exactly the selected rows go, in one
 * transaction (≤ DELETE_SELECTION_MAX_ROWS rows). Rows already deleted are skipped.
 */
export const deleteSelectionInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  snapshotId: uuidSchema,
  zebraEdges: z.array(z.number().int().min(0)).max(2 * DELETE_SELECTION_MAX_ROWS),
});
export type DeleteSelectionInput = z.input<typeof deleteSelectionInputSchema>;
export const deleteSelectionOutputSchema = z.object({
  /** Records deleted by this call, in snapshot order. */
  deletedIds: z.array(uuidSchema),
  /** Selected rows that were already gone. */
  skipped: z.number().int(),
});
export type DeleteSelectionOutput = z.infer<typeof deleteSelectionOutputSchema>;

/**
 * Merge two people or two companies into a new record (D §3.10). `target` holds priority: its single values win,
 * multi values are united (target first). Both sources end up merged into `mergedEntityInstanceId`.
 */
export const mergeRecordsInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  baseEntityInstanceId: uuidSchema,
  targetEntityInstanceId: uuidSchema,
  mergedEntityInstanceId: uuidSchema.optional(),
});
export type MergeRecordsInput = z.input<typeof mergeRecordsInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Values of one attribute

const valueRef = { ...recordRef, attributeDefinitionId: idOrSlugSchema };

export const attributeValuesOutputSchema = z.object({
  values: z.array(attributeValueSchema),
  accurateAt: timestampSchema,
});
export type AttributeValuesOutput = z.infer<typeof attributeValuesOutputSchema>;

/** Batch read of one attribute's values for many records, optionally at a point in time. */
export const listValuesInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  attributeDefinitionId: idOrSlugSchema,
  entityInstanceIds: z.array(uuidSchema).min(1).max(1337),
  activeAt: timestampSchema.optional(),
  acceptAfter: acceptAfterSchema,
});
export type ListValuesInput = z.input<typeof listValuesInputSchema>;
export const listValuesOutputSchema = z.object({
  values: z.record(z.string(), resultSchema(z.object({ values: z.array(attributeValueSchema) }))),
  accurateAt: timestampSchema,
});
export type ListValuesOutput = z.infer<typeof listValuesOutputSchema>;

/**
 * PUT one value with a client UUID: on a single-value attribute it replaces the current value (retire + insert, I6);
 * on a multi-value attribute it adds one (409 DUPLICATE_VALUE_IN_MULTISELECT if already present). Idempotent per id.
 * Returns all current values of the attribute.
 */
export const putValueInputSchema = z.object({
  ...valueRef,
  attributeValueId: uuidSchema,
  value: z.unknown(),
  sortOrder: rankSchema.optional(),
});
export type PutValueInput = z.input<typeof putValueInputSchema>;

/** Retire (clear/remove) one value: active_until = now. Idempotent. */
export const retireValueInputSchema = z.object({ ...valueRef, attributeValueId: uuidSchema });
export type RetireValueInput = z.input<typeof retireValueInputSchema>;

/** Move one value of a multi-value attribute (rank only; the value itself is unchanged). */
export const reorderValueInputSchema = z.object({ ...valueRef, attributeValueId: uuidSchema, sortOrder: rankSchema });
export type ReorderValueInput = z.input<typeof reorderValueInputSchema>;

/** All values of one attribute on one record, current and historic, newest first. */
export const valueHistoryInputSchema = z.object({
  ...valueRef,
  /** Only values that became active strictly before this instant (paging cursor). */
  before: timestampSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type ValueHistoryInput = z.input<typeof valueHistoryInputSchema>;
