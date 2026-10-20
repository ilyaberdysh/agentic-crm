import {
  actorSchema,
  agenticPolicyDecisionSchema,
  agenticRecordScopeSchema,
  createTaskInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import type { Evidence } from '../evidence/contracts.ts';
import { digestSchema } from '../evidence/contracts.ts';
import type { AgentTask } from '../tasks/contracts.ts';

export const actionStatusSchema = z.enum([
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'STALE',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED_TERMINAL',
  'OUTCOME_UNKNOWN',
]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export const taskCreateDiffSchema = z.strictObject({
  operation: z.literal('create'),
  task: createTaskInputSchema.strict(),
});
export const proposeTaskActionSchema = z.strictObject({
  id: uuidSchema,
  scope: agenticRecordScopeSchema,
  diff: taskCreateDiffSchema,
  evidenceIds: z
    .array(uuidSchema)
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  reviewerMemberId: uuidSchema,
});
export type ProposeTaskActionInput = z.input<typeof proposeTaskActionSchema>;

export const actionProposalSchema = z.strictObject({
  contractVersion: z.literal(1),
  proposalVersion: z.literal(1),
  workspaceId: uuidSchema,
  capability: z.literal('crm.task.create'),
  subject: z.strictObject({ scope: agenticRecordScopeSchema, recordVersion: z.string().regex(/^\d+$/) }),
  diff: taskCreateDiffSchema,
  evidence: z
    .array(z.strictObject({ id: uuidSchema, digest: digestSchema }))
    .min(1)
    .max(20),
  policy: agenticPolicyDecisionSchema,
  reviewerMemberId: uuidSchema,
  proposedBy: actorSchema,
});
export type ActionProposal = z.infer<typeof actionProposalSchema>;
export interface Action {
  id: string;
  digest: string;
  proposal: ActionProposal;
  status: ActionStatus;
  version: number;
}
/** Safe result for state-changing APIs; proposal contents are read only through get() after live evidence access. */
export type ActionState = Pick<Action, 'id' | 'status' | 'version'>;

/** Bounded activity for one exact record; source-derived content requires live evidence access. */
export const recordAgentStateSchema = z.strictObject({
  scope: agenticRecordScopeSchema,
  limit: z.number().int().min(1).max(100).default(50),
});
export type RecordAgentStateInput = z.input<typeof recordAgentStateSchema>;
export interface RecordActionActivity {
  action: Action;
  evidence: Evidence[];
  proposedAt: string;
  updatedAt: string;
  receipt: (ActionReceipt & { createdAt: string }) | null;
}
export interface RecordAgentState {
  scope: z.infer<typeof agenticRecordScopeSchema>;
  actions: RecordActionActivity[];
  unavailableActionCount: number;
  tasks: AgentTask[];
}

const casFields = { actionId: uuidSchema, proposalDigest: digestSchema, expectedVersion: z.number().int().positive() };
export const decideActionSchema = z.strictObject({
  ...casFields,
  id: uuidSchema,
  outcome: z.enum(['APPROVE', 'REJECT']),
});
export type DecideActionInput = z.input<typeof decideActionSchema>;
export const startActionAttemptSchema = z.strictObject({ ...casFields, id: uuidSchema });
export type StartActionAttemptInput = z.input<typeof startActionAttemptSchema>;
export const reconcileExecutingActionSchema = z.strictObject({ actionId: uuidSchema });
export type ReconcileExecutingActionInput = z.input<typeof reconcileExecutingActionSchema>;

/** Execute only the immutable approved diff; transports cannot supply replacement task fields or outcomes. */
export const executeTaskCreateSchema = startActionAttemptSchema.extend({ receiptId: uuidSchema }).strict();
export type ExecuteTaskCreateInput = z.input<typeof executeTaskCreateSchema>;

export const actionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('SUCCEEDED'), result: z.strictObject({ taskId: uuidSchema }) }),
  z.strictObject({
    outcome: z.literal('FAILED_TERMINAL'),
    result: z.strictObject({ code: z.string().min(1).max(100), retryable: z.literal(false) }),
  }),
  z.strictObject({
    outcome: z.literal('OUTCOME_UNKNOWN'),
    result: z.strictObject({ reason: z.enum(['executor-disconnected', 'dispatch-uncertain']) }),
  }),
]);
export const finishActionAttemptSchema = z.strictObject({
  ...casFields,
  id: uuidSchema,
  attemptId: uuidSchema,
  expectedAttemptVersion: z.number().int().positive(),
  outcome: actionOutcomeSchema,
});
export type FinishActionAttemptInput = z.input<typeof finishActionAttemptSchema>;
export interface ActionAttempt {
  id: string;
  actionId: string;
  decisionId: string;
  status: 'EXECUTING' | 'SUCCEEDED' | 'FAILED_TERMINAL' | 'OUTCOME_UNKNOWN';
  version: number;
}
export interface ActionReceipt {
  id: string;
  actionId: string;
  attemptId: string;
  proposalDigest: string;
  outcome: z.infer<typeof actionOutcomeSchema>;
}

export const executeTaskCreateResultSchema = z.strictObject({
  capability: z.literal('crm.task.create'),
  action: z.strictObject({ id: uuidSchema, status: actionStatusSchema, version: z.number().int().positive() }),
  receipt: z
    .strictObject({
      id: uuidSchema,
      actionId: uuidSchema,
      attemptId: uuidSchema,
      proposalDigest: digestSchema,
      outcome: actionOutcomeSchema,
    })
    .nullable(),
});
export type ExecuteTaskCreateResult = z.infer<typeof executeTaskCreateResultSchema>;
