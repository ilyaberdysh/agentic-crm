// CSV import (BACKLOG 4.07; specs C2 import.md; procedure names: decisions/slice4-contracts.md). Thin adapters over
// domain.imports (I5). Job-level procedures take `jobId`; `importId` (the mapping) is returned for routing
// `…/import/{importId}/job/{jobId}`. Mutations answer `{…state, seq}` (mutation.ts).
import {
  createImportInputSchema,
  createImportOptionsInputSchema,
  importAssertionsInputSchema,
  importHistoryInputSchema,
  importJobRefSchema,
  reviewValuesInputSchema,
  setImportMappingInputSchema,
  setImportOverrideInputSchema,
  uploadRowsInputSchema,
} from '@agentic-crm/contracts';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

const jobQuery = importJobRefSchema.extend(acceptAfterInput);

export const importsRouter = router({
  /** Step 1 → Next: `{entityDefinitionId, fileName, columns (header row), rowCount, importId?, jobId?, timeZone?}`. */
  create: workspaceProcedure.input(createImportInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.create(svc, input));
    return { ...result, seq };
  }),

  /** Raw rows in chunks (idempotent per row index); `final` completes the upload (job → draft). */
  uploadRows: workspaceProcedure.input(uploadRowsInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.uploadRows(svc, input));
    return { ...result, seq };
  }),

  /** The CSV columns and the attribute picker tree (objects: one group; lists: parent record + list attributes). */
  mappableProperties: workspaceProcedure
    .input(jobQuery)
    .query(({ ctx, input }) => ctx.domain.imports.mappableProperties(ctx.service, { jobId: input.jobId })),

  /** Map columns: `{jobId, listStrategy?, columns: [{columnIndex, target: ignore | attribute | create-attribute}]}`. */
  setMapping: workspaceProcedure.input(setImportMappingInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.setMapping(svc, input));
    return { ...result, seq };
  }),

  /** Review values of one column: distinct raw values with row counts, parse status, resolved values, overrides. */
  reviewValues: workspaceProcedure.input(reviewValuesInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _a, ...rest } = input;
    return ctx.domain.imports.reviewValues(ctx.service, rest);
  }),

  /** Per mapped column: distinct values and how many need review (the orange dots). */
  reviewSummary: workspaceProcedure
    .input(jobQuery)
    .query(({ ctx, input }) => ctx.domain.imports.reviewSummary(ctx.service, { jobId: input.jobId })),

  /** Fix (`{type:'values'}`), skip (`{type:'skip'}`) or revert (`null`) one distinct raw value. */
  setOverride: workspaceProcedure.input(setImportOverrideInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.setOverride(svc, input));
    return { value: result, seq };
  }),

  /** "Create missing select options / statuses" of a column. */
  createOptions: workspaceProcedure.input(createImportOptionsInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.createOptions(svc, input));
    return { ...result, seq };
  }),

  /** Preview import: generates the plan when needed; strategies per object, counts, invalid rows. */
  preview: workspaceProcedure.input(importJobRefSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.preview(svc, input));
    return { ...result, seq };
  }),

  /** Rows of one strategy (preview / overview table) with resolved values; filter by status or planned outcome. */
  assertions: workspaceProcedure.input(importAssertionsInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _a, ...rest } = input;
    return ctx.domain.imports.assertions(ctx.service, rest);
  }),

  /** Start import: confirms and queues the worker job (idempotent). */
  run: workspaceProcedure.input(importJobRefSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.run(svc, input));
    return { ...result, seq };
  }),

  /** Mapping, job (status, progress), columns, properties, validation and strategies with counts. */
  status: workspaceProcedure
    .input(jobQuery)
    .query(({ ctx, input }) => ctx.domain.imports.status(ctx.service, { jobId: input.jobId })),

  /** Cancel import (running): remaining rows are not imported. */
  cancel: workspaceProcedure.input(importJobRefSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.cancel(svc, input));
    return { ...result, seq };
  }),

  /** Delete draft ("Imports that have been run cannot be deleted."). */
  delete: workspaceProcedure.input(importJobRefSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.imports.delete(svc, input));
    return { ...result, seq };
  }),

  /** Import history (workspace, or one object / list), newest first; `onlyMine`; cursor `before`. */
  history: workspaceProcedure.input(importHistoryInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _a, ...rest } = input;
    return ctx.domain.imports.history(ctx.service, rest);
  }),
});
