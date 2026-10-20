import {
  configureModelTargetSchema,
  createModelTargetSchema,
  decideActionSchema,
  executeTaskCreateSchema,
  reconcileExecutingActionSchema,
  recordAgentStateSchema,
  updateProductModuleSchema,
} from '@agentic-crm/domain';
import { z } from 'zod';
import { withSeq } from '../mutation';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

/** Product action endpoint; task fields, approval and outcome cannot be supplied by the caller. */
export const agenticRouter = router({
  models: router({
    connections: router({
      list: workspaceProcedure.query(({ ctx }) => ctx.domain.agentic.providerConnections.list(ctx.service)),
      get: workspaceProcedure
        .input(z.uuid())
        .query(({ ctx, input }) => ctx.domain.agentic.providerConnections.get(ctx.service, input)),
      create: workspaceProcedure
        .input(
          z.strictObject({
            id: z.uuid(),
            ownerKind: z.enum(['workspace', 'member']),
            provider: z.enum(['openai', 'anthropic']),
            apiKey: z.string().min(1).max(8192),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { result, seq } = await withSeq(ctx.service, (service) =>
            ctx.domain.agentic.providerConnections.create(service, input),
          );
          return { connection: result, seq };
        }),
      rotate: workspaceProcedure
        .input(
          z.strictObject({
            id: z.uuid(),
            expectedVersion: z.number().int().positive(),
            apiKey: z.string().min(1).max(8192),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { result, seq } = await withSeq(ctx.service, (service) =>
            ctx.domain.agentic.providerConnections.rotate(service, input),
          );
          return { connection: result, seq };
        }),
      disable: workspaceProcedure
        .input(
          z.strictObject({
            id: z.uuid(),
            expectedVersion: z.number().int().positive(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { result, seq } = await withSeq(ctx.service, (service) =>
            ctx.domain.agentic.providerConnections.disable(service, input),
          );
          return { connection: result, seq };
        }),
    }),
    targets: router({
      list: workspaceProcedure.query(({ ctx }) => ctx.domain.agentic.models.targets.list(ctx.service)),
      get: workspaceProcedure
        .input(z.uuid())
        .query(({ ctx, input }) => ctx.domain.agentic.models.targets.get(ctx.service, input)),
      create: workspaceProcedure.input(createModelTargetSchema).mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (service) =>
          ctx.domain.agentic.models.targets.create(service, input),
        );
        return { target: result, seq };
      }),
      configure: workspaceProcedure.input(configureModelTargetSchema).mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (service) =>
          ctx.domain.agentic.models.targets.configure(service, input),
        );
        return { target: result, seq };
      }),
      disable: workspaceProcedure
        .input(
          z.strictObject({
            id: z.uuid(),
            expectedVersion: z.number().int().positive(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { result, seq } = await withSeq(ctx.service, (service) =>
            ctx.domain.agentic.models.targets.disable(service, input),
          );
          return { target: result, seq };
        }),
    }),
    /** Bounded first app consumer: a signed-in member can ask a configured target for text. */
    invoke: workspaceProcedure
      .input(
        z.strictObject({
          targetId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          prompt: z.string().trim().min(1).max(32_000),
          maxTokens: z.number().int().min(1).max(4096).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.domain.agentic.models.invoke(ctx.service, {
          targetId: input.targetId,
          expectedVersion: input.expectedVersion,
          request: {
            purpose: 'member-prompt',
            messages: [{ role: 'user', content: input.prompt }],
            ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
          },
        }),
      ),
    result: workspaceProcedure
      .input(z.uuid())
      .query(({ ctx, input }) => ctx.domain.agentic.models.getRunnerInvocation(ctx.service, input)),
  }),
  modules: router({
    list: adminProcedure.query(({ ctx }) => ctx.domain.productModules.list(ctx.service)),
    update: adminProcedure.input(updateProductModuleSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (service) => ctx.domain.productModules.update(service, input));
      return { module: result, seq };
    }),
  }),
  recordState: workspaceProcedure
    .input(recordAgentStateSchema)
    .query(({ ctx, input }) => ctx.domain.agentic.recordState(ctx.service, input)),
  decide: workspaceProcedure.input(decideActionSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (service) => ctx.domain.agentic.actions.decide(service, input));
    return { ...result, seq };
  }),
  reconcileExecuting: adminProcedure.input(reconcileExecutingActionSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (service) =>
      ctx.domain.agentic.actions.reconcileExecutingAsOperator(service, input),
    );
    return { ...result, seq };
  }),
  executeTaskCreate: workspaceProcedure.input(executeTaskCreateSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (service) =>
      ctx.domain.agentic.taskCreate.execute(service, input),
    );
    return { ...result, seq };
  }),
});
