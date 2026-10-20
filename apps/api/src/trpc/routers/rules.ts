// Requirement rules (BACKLOG 6.06; J objects-lists §3.2, J permissions §7): the Rules tab of an object. Reading needs
// read access to the object, changes need Full access (domain). Member writes that violate a rule fail everywhere
// with 422 PARTICLE_GATE_VIOLATION (additional_information.violated_validation_rules) and are parked by the client.
import {
  createRuleInputSchema,
  deleteRuleInputSchema,
  listRulesInputSchema,
  reorderRulesInputSchema,
  updateRuleInputSchema,
} from '@agentic-crm/contracts';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const rulesRouter = router({
  list: workspaceProcedure
    .input(listRulesInputSchema)
    .query(({ ctx, input }) => ctx.domain.rules.list(ctx.service, { entityDefinitionId: input.entityDefinitionId })),

  /** "Add rule" (client id; idempotent). The ninth rule answers 409 OVER_USAGE_LIMIT with the limit message. */
  create: workspaceProcedure.input(createRuleInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.rules.create(svc, input));
    return { rule: result, seq };
  }),

  update: workspaceProcedure.input(updateRuleInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.rules.update(svc, input));
    return { rule: result, seq };
  }),

  /** "Delete rule? — This removes the rule from this object." */
  delete: workspaceProcedure.input(deleteRuleInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.rules.delete(svc, input.ruleId));
    return { ...result, seq };
  }),

  reorder: workspaceProcedure.input(reorderRulesInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.rules.reorder(svc, input));
    return { rules: result, seq };
  }),
});
