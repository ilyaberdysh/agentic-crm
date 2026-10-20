// Executable authority, deliberately separate from capabilities.ts feature flags and quotas.
import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.ts';

export const executableCapabilityKeys = [
  'crm.task.create',
  'agentic.action.propose',
  'agentic.action.approve',
] as const;
export const executableCapabilitySchema = z.enum(executableCapabilityKeys);
export type ExecutableCapability = z.infer<typeof executableCapabilitySchema>;

export const agenticPolicyVersion = 1 as const;

/** Identity only. Authority is loaded by the server, never carried in a principal or request. */
export const agentPrincipalSchema = z.strictObject({
  type: z.literal('agent'),
  id: uuidSchema,
  grantId: uuidSchema,
});
export type AgentPrincipal = z.infer<typeof agentPrincipalSchema>;

export const agenticPrincipalSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('workspace-member'), id: uuidSchema }),
  agentPrincipalSchema,
]);
export type AgenticPrincipal = z.infer<typeof agenticPrincipalSchema>;

/** The first slice grants one exact, existing record; no wildcard or workspace-wide grants. */
export const agenticRecordScopeSchema = z.strictObject({
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
});
export type AgenticRecordScope = z.infer<typeof agenticRecordScopeSchema>;

/** Server storage shape; this is not an input for granting authority. */
export const agentCapabilityGrantSchema = z.strictObject({
  id: uuidSchema,
  workspaceId: uuidSchema,
  agentId: uuidSchema,
  delegatedByMemberId: uuidSchema,
  capabilities: z.array(executableCapabilitySchema).min(1),
  scope: agenticRecordScopeSchema,
  expiresAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
});
export type AgentCapabilityGrant = z.infer<typeof agentCapabilityGrantSchema>;

export const agenticCapabilityRequestSchema = z.strictObject({
  capability: executableCapabilitySchema,
  scope: agenticRecordScopeSchema,
  policyVersion: z.literal(agenticPolicyVersion),
});
export type AgenticCapabilityRequest = z.infer<typeof agenticCapabilityRequestSchema>;

export const agenticPolicyDecisionSchema = z.strictObject({
  effect: z.enum(['allow', 'approval-required', 'deny']),
  reason: z.enum([
    'allowed',
    'human-approval-required',
    'invalid-request',
    'unknown-principal',
    'agent-approval-forbidden',
    'grant-denied',
    'member-denied',
    'scope-denied',
  ]),
  policyVersion: z.literal(agenticPolicyVersion),
});
export type AgenticPolicyDecision = z.infer<typeof agenticPolicyDecisionSchema>;
