import { agenticRecordScopeSchema, timestampSchema, uuidSchema } from '@agentic-crm/contracts';
import { z } from 'zod';

const explanation = z.string().trim().min(1).max(1000);
const holder = z.string().trim().min(1).max(200);
const generation = z.string().regex(/^[1-9]\d*$/);
export const agentTaskStatusSchema = z.enum([
  'QUEUED',
  'LEASED',
  'SUCCEEDED',
  'FAILED_TERMINAL',
  'BLOCKED',
  'CANCELLED',
]);

export const enqueueAgentTaskSchema = z.strictObject({
  id: uuidSchema,
  scope: agenticRecordScopeSchema,
  moduleId: z.literal('record-follow-up'),
  taskType: z.literal('record.follow_up'),
  actionId: uuidSchema.nullable().default(null),
  dueAt: timestampSchema,
  reason: explanation,
  nextEvent: explanation,
});
export type EnqueueAgentTaskInput = z.input<typeof enqueueAgentTaskSchema>;

export const claimAgentTasksSchema = z.strictObject({
  holder,
  leaseDurationMs: z.number().int().min(1).max(300_000),
  limit: z.number().int().min(1).max(100).default(1),
  approvedActionsOnly: z.boolean().default(false),
});
export type ClaimAgentTasksInput = z.input<typeof claimAgentTasksSchema>;

export const agentTaskLeaseSchema = z.strictObject({ taskId: uuidSchema, holder, generation });
export type AgentTaskLease = z.infer<typeof agentTaskLeaseSchema>;
export const heartbeatAgentTaskSchema = agentTaskLeaseSchema.extend({
  leaseDurationMs: z.number().int().min(1).max(300_000),
});
export type HeartbeatAgentTaskInput = z.input<typeof heartbeatAgentTaskSchema>;
export const finishAgentTaskSchema = agentTaskLeaseSchema.extend({ reason: explanation, nextEvent: explanation });
export type FinishAgentTaskInput = z.input<typeof finishAgentTaskSchema>;
export const recheckAgentTaskSchema = finishAgentTaskSchema.extend({ dueAt: timestampSchema });
export type RecheckAgentTaskInput = z.input<typeof recheckAgentTaskSchema>;
export const recoverAgentTasksSchema = z.strictObject({ limit: z.number().int().min(1).max(100).default(100) });
export const resumeAgentTaskSchema = z.strictObject({ taskId: uuidSchema });
export type ResumeAgentTaskInput = z.input<typeof resumeAgentTaskSchema>;
export const listAgentTasksSchema = z.strictObject({
  scope: agenticRecordScopeSchema,
  limit: z.number().int().min(1).max(100).default(50),
});

export interface AgentTask {
  id: string;
  workspaceId: string;
  scope: z.infer<typeof agenticRecordScopeSchema>;
  moduleId: 'record-follow-up';
  taskType: 'record.follow_up';
  actionId: string | null;
  status: z.infer<typeof agentTaskStatusSchema>;
  dueAt: string;
  reason: string;
  nextEvent: string;
  leaseHolder: string | null;
  /** Decimal bigint string: never round a fencing token through a JavaScript number. */
  leaseGeneration: string;
  leaseExpiresAt: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
