// AI autofill attributes (BACKLOG 10.05; I-ai-calls/ai-attributes.md). Configured through schema.attributes.create
// / update with `aiAutofillConfiguration` ({type, prompt, isOptionCreationEnabled}; null turns it off). Runs: the
// "Recalculate values" dialog shows `estimate` (records × credits), Confirm calls `run` (per value, a cell
// selection or a whole column of a view snapshot). Values move queued → running → complete | error; each step is an
// `entity-annotation` invalidation, so cells leave "AI is thinking..." without a reload (X-24).
import { aiRunInputSchema, entityAnnotationsInputSchema } from '@agentic-crm/contracts';
import { acceptAfterInput, acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const aiAttributesRouter = router({
  /** Whether an LLM provider is configured (the UI shows "not configured" otherwise). */
  status: workspaceProcedure
    .input(acceptAfterOnly)
    .query(({ ctx }) => ({ configured: ctx.domain.aiAttributes.configured() })),

  /** Confirmation data: `{recordCount, creditsPerValue, credits, creditsRemaining}`. */
  estimate: workspaceProcedure
    .input(aiRunInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.aiAttributes.estimate(ctx.service, input)),

  /** Confirmed run: `{runId, recordCount, credits, annotations}` (402 CREDITS_EXHAUSTED, 503 AI_NOT_CONFIGURED). */
  run: workspaceProcedure.input(aiRunInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.aiAttributes.run(svc, input));
    return { ...result, seq };
  }),

  /** "Recalculate with AI" (same as run). */
  recalculate: workspaceProcedure.input(aiRunInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.aiAttributes.recalculate(svc, input));
    return { ...result, seq };
  }),

  annotations: workspaceProcedure
    .input(entityAnnotationsInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.aiAttributes.annotations(ctx.service, input)),
});
