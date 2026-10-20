import { z } from 'zod';

const moduleIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/);
const declarationIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9._-]*$/);

/** A deliberate compatibility marker avoids implying that semver ranges are enforced yet. */
export const productModuleCoreCompatibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('marker'), marker: z.string().min(1) }).strict(),
]);

/** Static declaration for the core surfaces a focused product module contributes or requires. */
export const productModuleSchema = z
  .object({
    id: moduleIdSchema,
    compatibleCore: productModuleCoreCompatibilitySchema,
    recordSurfaceIds: z.array(declarationIdSchema),
    uiSurfaceIds: z.array(declarationIdSchema),
    agentTaskTypes: z.array(declarationIdSchema),
    executableCapabilityIds: z.array(declarationIdSchema),
    connectorRequirements: z.array(declarationIdSchema),
    migrationIds: z.array(declarationIdSchema),
  })
  .strict();

export type ProductModule = z.infer<typeof productModuleSchema>;

/** First built-in module declaration; the task is wired to the existing task-create capability. */
export const recordFollowUpProductModule = productModuleSchema.parse({
  id: 'record-follow-up',
  compatibleCore: { kind: 'marker', marker: 'agentic-core-v1' },
  recordSurfaceIds: ['record.agent'],
  uiSurfaceIds: ['record.agent.tab'],
  agentTaskTypes: ['record.follow_up'],
  executableCapabilityIds: ['crm.task.create'],
  connectorRequirements: [],
  migrationIds: [],
});
