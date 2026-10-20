// Formula attributes (BACKLOG 10.06; I-ai-calls/formulas.md). Formula attributes are created and edited through
// schema.attributes.create / update with `formulaConfiguration` ({snapshotId, plaintext, annotations,
// outputTypeOverride}); this router serves the editor: validate (diagnostics with fixes, Auto output type, save
// errors), preview against a record, the AI composer (generate / refine / fix → request invalidated as it
// progresses), snapshots and per-record annotations. Stored formulas are plaintext with one `_` per reference.
import {
  attributeRefInputSchema,
  createFormulaGenerationInputSchema,
  entityAnnotationsInputSchema,
  previewFormulaInputSchema,
  uuidSchema,
  validateFormulaInputSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const formulasRouter = router({
  /** Type check: `{valid, empty, diagnostics (plaintext offsets, 1-based lines), summary, resultType,
   * inferredOutputType, outputType, saveError, usesNow}`. */
  validate: workspaceProcedure
    .input(validateFormulaInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.formulas.validate(ctx.service, input)),

  /** `{type:'complete', value, outputType, display} | {type:'syntax_error', diagnostics} |
   * {type:'evaluation_error', code}`. */
  preview: workspaceProcedure
    .input(previewFormulaInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.formulas.preview(ctx.service, input)),

  /** AI composer: `generate` when the draft is empty, `refine` otherwise (client request id; idempotent). */
  generate: workspaceProcedure.input(createFormulaGenerationInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.formulas.generate(svc, input));
    return { request: result, seq };
  }),

  /** The "Fix" button: repairs `inputFormulaDraft`. */
  fix: workspaceProcedure.input(createFormulaGenerationInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.formulas.fix(svc, input));
    return { request: result, seq };
  }),

  /** One composer request (refetched on `formula-generation-request` invalidations; no polling). */
  generationRequest: workspaceProcedure
    .input(z.object({ id: uuidSchema, ...acceptAfterInput }))
    .query(({ ctx, input }) => ctx.domain.formulas.generationRequest(ctx.service, input.id)),

  snapshots: router({
    list: workspaceProcedure
      .input(attributeRefInputSchema.extend(acceptAfterInput))
      .query(({ ctx, input }) => ctx.domain.formulas.snapshots(ctx.service, input)),
    get: workspaceProcedure
      .input(z.object({ snapshotId: uuidSchema, ...acceptAfterInput }))
      .query(({ ctx, input }) => ctx.domain.formulas.snapshot(ctx.service, input.snapshotId)),
  }),

  /** Per-record formula state ("Calculating...", errors) and AI autofill state of one attribute. */
  annotations: workspaceProcedure
    .input(entityAnnotationsInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.formulas.annotations(ctx.service, input)),
});
