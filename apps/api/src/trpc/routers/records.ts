// Records and attribute values (A §4.5, §4.7; internal-api-shapes §1.1, §2, §4.4, §5; decisions X-22, A I-7).
// Writes return the canonical state the client reconciles its optimistic overlay with: the record header and its
// current values (records), or every current value of the attribute (values), each with `accurateAt` and `seq`.
import {
  batchGetRecordsInputSchema,
  createRecordInputSchema,
  deleteRecordInputSchema,
  deleteSelectionInputSchema,
  getRecordInputSchema,
  listValuesInputSchema,
  mergeRecordsInputSchema,
  putValueInputSchema,
  reorderValueInputSchema,
  restoreRecordInputSchema,
  retireValueInputSchema,
  updateRecordInputSchema,
  valueHistoryInputSchema,
} from '@agentic-crm/contracts';
import { acceptAfterInput, withSeq } from '../mutation';
import { assertCan } from '../policy';
import { router, workspaceProcedure } from '../trpc';
import { recordSummaryRouter } from './ai';

export const recordsRouter = router({
  /** AI record summary card (slice 10): get / regenerate. */
  summary: recordSummaryRouter,

  /**
   * PUT create with a client UUID (I3). A replay of the same id returns the stored record unchanged with
   * `created: false` (first write wins); an id owned by another object answers 409 INSTANCE_ID_CONFLICT.
   */
  put: workspaceProcedure.input(createRecordInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'create_entity_instance');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.records.create(svc, input));
    return { ...result, seq };
  }),

  /** PATCH several attributes in one write: each listed array is the desired current set (or values to append). */
  patch: workspaceProcedure.input(updateRecordInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_entity_instance');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.records.update(svc, input));
    return { ...result, seq };
  }),

  /** One record with its current values, or the values active at `activeAt` (point-in-time read). */
  get: workspaceProcedure.input(getRecordInputSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_entity_instance');
    return ctx.domain.records.get(ctx.service, input);
  }),

  /** Batched header read: `{records: {<id>: {state:'complete', value} | {state:'error', error:'NOT_FOUND'}}}`. */
  batchGet: workspaceProcedure.input(batchGetRecordsInputSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_entity_instance');
    return ctx.domain.records.batchGet(ctx.service, input);
  }),

  /** Soft delete (X-22): gone for users, kept for audit and restore. Idempotent. */
  delete: workspaceProcedure.input(deleteRecordInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'delete_entity_instance');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.records.delete(svc, input));
    return { record: result, seq };
  }),

  /**
   * Bulk soft delete of a selection over a snapshot (zebra edges, ≤ 500 rows per call, one transaction): exactly the
   * selected rows of the frozen snapshot. Clients split larger selections and report progress per call.
   */
  deleteSelection: workspaceProcedure.input(deleteSelectionInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'delete_entity_instance');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.records.deleteSelection(svc, input));
    return { ...result, seq };
  }),

  /** Undo of a delete: unique values are re-claimed (409 if taken meanwhile). */
  restore: workspaceProcedure.input(restoreRecordInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'delete_entity_instance');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.records.restore(svc, input));
    return { ...result, seq };
  }),

  /**
   * Merge two people or companies into a new record (`mergedEntityInstanceId`, client-minted for idempotency);
   * the target's single values win. Both sources answer NOT_FOUND afterwards (merged).
   */
  merge: workspaceProcedure.input(mergeRecordsInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_entity_instance');
    await assertCan(ctx, input.entityDefinitionId, 'delete_entity_instance');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.records.merge(svc, input));
    return { ...result, seq };
  }),

  /** Every value of one attribute on one record, current and retired, newest first ("View edit history"). */
  history: workspaceProcedure.input(valueHistoryInputSchema.extend(acceptAfterInput)).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_attribute_value');
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.values.history(ctx.service, query);
  }),
});

export const valuesRouter = router({
  /** Batched read of one attribute for up to 1337 records (optionally at `activeAt`), per-id state. */
  list: workspaceProcedure.input(listValuesInputSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_attribute_value');
    return ctx.domain.values.list(ctx.service, input);
  }),

  /**
   * PUT one value with a client UUID: replaces a single value (retire + insert, I6) or adds to a multi-value
   * attribute. Idempotent per `attributeValueId`. Returns every current value of the attribute.
   */
  put: workspaceProcedure.input(putValueInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_value');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.values.put(svc, input));
    return { ...result, seq };
  }),

  /** Clear / remove one value (`active_until = now`). Idempotent. */
  retire: workspaceProcedure.input(retireValueInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_value');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.values.retire(svc, input));
    return { ...result, seq };
  }),

  /** Move one value of a multi-value attribute (rank only). */
  reorder: workspaceProcedure.input(reorderValueInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_value');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.values.reorder(svc, input));
    return { ...result, seq };
  }),
});
