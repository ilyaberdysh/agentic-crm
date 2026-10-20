import { decideActionSchema, executeTaskCreateSchema, recordAgentStateSchema } from '@agentic-crm/domain';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

/** Product action endpoint; task fields, approval and outcome cannot be supplied by the caller. */
export const agenticRouter = router({
  recordState: workspaceProcedure
    .input(recordAgentStateSchema)
    .query(({ ctx, input }) => ctx.domain.agentic.recordState(ctx.service, input)),
  decide: workspaceProcedure.input(decideActionSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (service) => ctx.domain.agentic.actions.decide(service, input));
    return { ...result, seq };
  }),
  executeTaskCreate: workspaceProcedure.input(executeTaskCreateSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (service) =>
      ctx.domain.agentic.taskCreate.execute(service, input),
    );
    return { ...result, seq };
  }),
});
