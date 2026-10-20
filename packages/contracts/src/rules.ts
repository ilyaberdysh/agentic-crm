// Requirement rules ("particle gates", BACKLOG 6.06; J permissions §7, J objects-lists §3.2, A §4.13). A rule is a
// condition (an ordinary filter predicate over the object's attributes; null = every record) plus requirements on
// attributes ("Then <attribute> is required / must be empty / must be greater than …") and the actors it applies to
// (all members; member/team/workflow triggers are Enterprise and deferred). Member writes that leave a matching record
// violating a requirement roll back with 422 PARTICLE_GATE_VIOLATION; the client parks the write until it is fixed.
import { z } from 'zod';
import { acceptAfterSchema, idOrSlugSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';
import { type Predicate, predicateSchema } from './views.ts';

/** Requirement operators (UI: is required, must be empty, must be, must be (or) greater / less than; dates: before…). */
export const requirementOperators = ['required', 'empty', 'eq', 'gt', 'gte', 'lt', 'lte'] as const;
export const requirementOperatorSchema = z.enum(requirementOperators);
export type RequirementOperator = z.infer<typeof requirementOperatorSchema>;

export const requirementSchema = z.object({
  /** particle_gate_validation_rule_id. */
  id: uuidSchema,
  attributeDefinitionId: uuidSchema,
  operator: requirementOperatorSchema,
  /** Comparison value for eq / gt / gte / lt / lte (number, date, option or stage id, record id, member id, text). */
  value: z.unknown().optional(),
});
export type Requirement = z.infer<typeof requirementSchema>;

export const ruleActorSchema = z.object({ type: z.literal('all-workspace-members') });

export const ruleSchema = z.object({
  /** particle_gate_id. */
  id: uuidSchema,
  entityDefinitionId: uuidSchema,
  name: z.string(),
  sortOrder: z.string(),
  condition: (predicateSchema as z.ZodType<Predicate>).nullable(),
  requirements: z.array(requirementSchema),
  appliesTo: z.array(ruleActorSchema),
  createdBy: z.unknown(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

/** "Limit of {quota} rules reached" (Pro: 8 per object; capability particle_gates_per_object_hard overrides). */
export const DEFAULT_RULES_PER_OBJECT = 8;

const requirementsInput = z
  .array(requirementSchema.extend({ id: uuidSchema.optional() }))
  .min(1, 'Incomplete requirement')
  .max(20);

export const listRulesInputSchema = z.object({ entityDefinitionId: idOrSlugSchema, acceptAfter: acceptAfterSchema });
export type ListRulesInput = z.input<typeof listRulesInputSchema>;

export const createRuleInputSchema = z.object({
  /** Client id (PUT-style, idempotent). */
  id: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  name: z.string().trim().min(1, 'Add name').max(200),
  condition: (predicateSchema as z.ZodType<Predicate>).nullable().default(null),
  requirements: requirementsInput,
  sortOrder: rankSchema.optional(),
});
export type CreateRuleInput = z.input<typeof createRuleInputSchema>;

export const updateRuleInputSchema = z.object({
  ruleId: uuidSchema,
  name: z.string().trim().min(1, 'Add name').max(200).optional(),
  condition: (predicateSchema as z.ZodType<Predicate>).nullable().optional(),
  requirements: requirementsInput.optional(),
  sortOrder: rankSchema.optional(),
});
export type UpdateRuleInput = z.input<typeof updateRuleInputSchema>;

export const deleteRuleInputSchema = z.object({ ruleId: uuidSchema });
export const reorderRulesInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  /** Every live rule of the object in the new order. */
  ruleIds: z.array(uuidSchema).min(1).max(100),
});
export type ReorderRulesInput = z.input<typeof reorderRulesInputSchema>;

/** One failed requirement in a PARTICLE_GATE_VIOLATION error (additional_information.violated_validation_rules). */
export interface RuleViolation {
  particle_gate_id: string;
  rule_name: string;
  particle_gate_validation_rule_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  attribute_definition_id: string;
  operator: RequirementOperator;
  value: unknown;
  /** "Must have a value", "Must be empty", "Must be greater than 10", "Must be on or after 2026-01-01", … */
  message: string;
}
