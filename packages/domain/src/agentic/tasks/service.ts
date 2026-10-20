import { type AgenticRecordScope, agenticPolicyVersion, uuidSchema } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { conflict, forbidden, notFound } from '../../errors.ts';
import { newId } from '../../ids.ts';
import { productModuleRegistry } from '../../modules/registry.ts';
import type { Tx } from '../../tx.ts';
import {
  actionProposalSchema,
  type ExecuteTaskCreateResult,
  executeTaskCreateResultSchema,
} from '../actions/contracts.ts';
import { canonicalDigest } from '../evidence/canonical.ts';
import type { AgenticPolicy } from '../policy.ts';
import {
  type AgentTask,
  type AgentTaskLease,
  agentTaskLeaseSchema,
  type ClaimAgentTasksInput,
  claimAgentTasksSchema,
  type EnqueueAgentTaskInput,
  enqueueAgentTaskSchema,
  type FinishAgentTaskInput,
  finishAgentTaskSchema,
  listAgentTasksSchema,
  type RecheckAgentTaskInput,
  recheckAgentTaskSchema,
  recoverAgentTasksSchema,
} from './contracts.ts';

const columns = sql`id, workspace_id AS "workspaceId",
  jsonb_build_object('entityDefinitionId', entity_definition_id, 'entityInstanceId', entity_instance_id) AS scope,
  module_id AS "moduleId", task_type AS "taskType", action_id AS "actionId", status, due_at AS "dueAt", reason,
  next_event AS "nextEvent", lease_holder AS "leaseHolder", lease_generation::text AS "leaseGeneration",
  lease_expires_at AS "leaseExpiresAt", attempt_count AS "attemptCount", created_at AS "createdAt",
  updated_at AS "updatedAt", finished_at AS "finishedAt"`;
const stale = () =>
  conflict('ID_CONFLICT', 'Task lease expired, was released, or belongs to another worker generation');

/**
 * Trusted runtime dispatch only: record.follow_up may inspect/propose, but a lease grants no CRM mutation authority.
 * Never hold this transaction across model/provider I/O. Effects still require their own policy/action protocol;
 * workers must check their fencing token in the same short transaction as a local dispatch.
 * Reasons are runtime-authored operational explanations, never captured evidence or instructions from a model.
 */
export function createAgentTaskService(options: { policy: AgenticPolicy }) {
  function runtime(tx: Tx) {
    if (tx.ctx.actor.type !== 'system') throw forbidden('Agent task scheduling requires a trusted runtime context');
  }

  async function readable(tx: Tx, scope: AgenticRecordScope) {
    if (tx.ctx.actor.type === 'system') return;
    await options.policy.assertCan(tx, {
      capability: 'agentic.action.propose',
      policyVersion: agenticPolicyVersion,
      scope,
    });
  }

  async function load(tx: Tx, id: string): Promise<AgentTask> {
    uuidSchema.parse(id);
    const { rows } = await sql<AgentTask>`SELECT ${columns} FROM agentic_tasks
      WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid`.execute(tx.db);
    if (!rows[0]) throw notFound('Agent task not found');
    return rows[0];
  }

  async function record(tx: Tx, task: AgentTask) {
    await sql`INSERT INTO agentic_task_history (id, workspace_id, task_id, snapshot, actor)
      VALUES (${newId()}::uuid, ${tx.workspaceId}::uuid, ${task.id}::uuid,
        ${JSON.stringify(task)}::jsonb, ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(tx.db);
    tx.emit('record-timeline', task.scope.entityDefinitionId, {
      entityDefinitionId: task.scope.entityDefinitionId,
      entityInstanceIds: [task.scope.entityInstanceId],
    });
  }

  /** Check time after acquiring the row lock: a lock wait must not preserve a lease that expired during the wait. */
  async function assertLease(tx: Tx, input: AgentTaskLease): Promise<void> {
    runtime(tx);
    const parsed = agentTaskLeaseSchema.parse(input);
    const locked = await sql`SELECT id FROM agentic_tasks WHERE workspace_id = ${tx.workspaceId}::uuid
      AND id = ${parsed.taskId}::uuid AND status = 'LEASED' AND lease_holder = ${parsed.holder}
      AND lease_generation = ${parsed.generation}::bigint FOR UPDATE`.execute(tx.db);
    if (!locked.rows[0]) throw stale();
    const { rows } = await sql<{ live: boolean }>`SELECT lease_expires_at > clock_timestamp() AS live
      FROM agentic_tasks WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${parsed.taskId}::uuid`.execute(tx.db);
    if (!rows[0]?.live) throw stale();
  }

  async function settle(
    tx: Tx,
    input: FinishAgentTaskInput,
    status: 'QUEUED' | 'SUCCEEDED' | 'FAILED_TERMINAL',
    dueAt?: string,
  ): Promise<AgentTask> {
    runtime(tx);
    const parsed = finishAgentTaskSchema.parse(input);
    await assertLease(tx, { taskId: parsed.taskId, holder: parsed.holder, generation: parsed.generation });
    const { rows } = await sql<AgentTask>`UPDATE agentic_tasks SET status = ${status}, reason = ${parsed.reason},
      next_event = ${parsed.nextEvent}, due_at = ${dueAt ? sql`${dueAt}::timestamptz` : sql`due_at`},
      lease_holder = NULL, lease_expires_at = NULL, updated_at = clock_timestamp(),
      finished_at = ${status === 'QUEUED' ? sql`NULL` : sql`clock_timestamp()`}
      WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${parsed.taskId}::uuid AND status = 'LEASED'
      AND lease_holder = ${parsed.holder} AND lease_generation = ${parsed.generation}::bigint
      AND lease_expires_at > clock_timestamp() RETURNING ${columns}`.execute(tx.db);
    if (!rows[0]) throw stale();
    await record(tx, rows[0]);
    return rows[0];
  }

  return {
    async get(tx: Tx, id: string): Promise<AgentTask> {
      const task = await load(tx, id);
      await readable(tx, task.scope);
      return task;
    },

    async listRecord(tx: Tx, input: { scope: AgenticRecordScope; limit?: number }): Promise<AgentTask[]> {
      const parsed = listAgentTasksSchema.parse(input);
      await readable(tx, parsed.scope);
      const { rows } = await sql<AgentTask>`SELECT ${columns} FROM agentic_tasks
        WHERE workspace_id = ${tx.workspaceId}::uuid AND entity_definition_id = ${parsed.scope.entityDefinitionId}::uuid
        AND entity_instance_id = ${parsed.scope.entityInstanceId}::uuid ORDER BY created_at DESC, id DESC
        LIMIT ${parsed.limit}`.execute(tx.db);
      return rows;
    },

    async enqueue(tx: Tx, input: EnqueueAgentTaskInput): Promise<AgentTask> {
      runtime(tx);
      const parsed = enqueueAgentTaskSchema.parse(input);
      const module = productModuleRegistry.get(parsed.moduleId);
      if (!module?.agentTaskTypes.includes(parsed.taskType)) throw forbidden('Undeclared agent task type');
      const digest = canonicalDigest(parsed);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tx.workspaceId}:agent-task:${parsed.id}`}, 0))`.execute(
        tx.db,
      );
      const existing = await sql<{ digest: string }>`SELECT enqueue_digest AS digest FROM agentic_tasks
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${parsed.id}::uuid`.execute(tx.db);
      if (existing.rows[0]) {
        if (existing.rows[0].digest !== digest) throw conflict('ID_CONFLICT', 'Agent task enqueue input changed');
        return load(tx, parsed.id);
      }
      const scope = parsed.scope;
      const target = await sql`SELECT i.id FROM entity_instances i JOIN entity_definitions d
        ON d.workspace_id = i.workspace_id AND d.id = i.entity_definition_id
        WHERE i.workspace_id = ${tx.workspaceId}::uuid AND i.id = ${scope.entityInstanceId}::uuid
        AND i.entity_definition_id = ${scope.entityDefinitionId}::uuid AND i.archived_at IS NULL AND i.merged_at IS NULL
        AND NOT d.is_archived AND d.entity_type IN ('person-record', 'company-record', 'standard-object', 'custom-record')`.execute(
        tx.db,
      );
      if (!target.rows[0]) throw notFound('Agent task record not found');
      if (parsed.actionId !== null) {
        const action = await sql`SELECT id FROM agentic_action_proposals WHERE workspace_id = ${tx.workspaceId}::uuid
          AND id = ${parsed.actionId}::uuid AND entity_definition_id = ${scope.entityDefinitionId}::uuid
          AND entity_instance_id = ${scope.entityInstanceId}::uuid`.execute(tx.db);
        if (!action.rows[0]) throw notFound('Agent task action not found in this record');
      }
      await sql`INSERT INTO agentic_tasks (id, workspace_id, entity_definition_id, entity_instance_id, module_id,
        task_type, action_id, enqueue_digest, status, due_at, reason, next_event)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${scope.entityDefinitionId}::uuid,
          ${scope.entityInstanceId}::uuid, ${parsed.moduleId}, ${parsed.taskType}, ${parsed.actionId}::uuid,
          ${digest}, 'QUEUED', ${parsed.dueAt}::timestamptz, ${parsed.reason}, ${parsed.nextEvent})`.execute(tx.db);
      const task = await load(tx, parsed.id);
      await record(tx, task);
      return task;
    },

    async claimDue(tx: Tx, input: ClaimAgentTasksInput): Promise<AgentTask[]> {
      runtime(tx);
      const parsed = claimAgentTasksSchema.parse(input);
      const selected = await sql<{ id: string }>`SELECT id FROM agentic_tasks
        WHERE workspace_id = ${tx.workspaceId}::uuid AND status = 'QUEUED' AND due_at <= clock_timestamp()
        ORDER BY due_at, id LIMIT ${parsed.limit} FOR UPDATE SKIP LOCKED`.execute(tx.db);
      const tasks: AgentTask[] = [];
      for (const { id } of selected.rows) {
        const { rows } =
          await sql<AgentTask>`UPDATE agentic_tasks SET status = 'LEASED', lease_holder = ${parsed.holder},
          lease_generation = lease_generation + 1, attempt_count = attempt_count + 1,
          lease_expires_at = clock_timestamp() + ${parsed.leaseDurationMs} * interval '1 millisecond',
          updated_at = clock_timestamp(), reason = 'Due work claimed by a worker.',
          next_event = 'Worker will complete, fail, release, or schedule a recheck before the lease expires.'
          WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid AND status = 'QUEUED'
          RETURNING ${columns}`.execute(tx.db);
        const task = rows[0]!;
        await record(tx, task);
        tasks.push(task);
      }
      return tasks;
    },

    /** Lock and validate immediately before a local dispatch, in that dispatch's transaction. No effect is authorized. */
    assertLease,

    /**
     * Action-owner settlement only: the bounded task capability calls this in its effect transaction, including
     * replay. A verified successful create supersedes pending dispatch/reconciliation, without borrowing a worker
     * lease or accepting caller-selected queue ids, states, or explanations. Existing terminal history is retained.
     */
    async settleSucceededTaskCreate(tx: Tx, result: ExecuteTaskCreateResult): Promise<AgentTask[]> {
      const parsed = executeTaskCreateResultSchema.parse(result);
      const receipt = parsed.receipt;
      if (parsed.action.status !== 'SUCCEEDED' || receipt?.outcome.outcome !== 'SUCCEEDED')
        throw conflict('ID_CONFLICT', 'Queue settlement requires a successful task-create action');
      const { rows } = await sql<{ proposal: unknown; digest: string }>`SELECT p.proposal, p.digest
        FROM agentic_actions a JOIN agentic_action_proposals p
          ON p.workspace_id = a.workspace_id AND p.id = a.id
        JOIN agentic_action_attempts t ON t.workspace_id = a.workspace_id AND t.action_id = a.id
        JOIN agentic_action_receipts r ON r.workspace_id = a.workspace_id AND r.action_id = a.id
          AND r.attempt_id = t.id
        WHERE a.workspace_id = ${tx.workspaceId}::uuid AND a.id = ${parsed.action.id}::uuid
          AND a.status = 'SUCCEEDED' AND a.version = ${parsed.action.version}
          AND t.id = ${receipt.attemptId}::uuid AND t.status = 'SUCCEEDED'
          AND t.executor = ${JSON.stringify(tx.ctx.actor)}::jsonb
          AND r.id = ${receipt.id}::uuid AND r.action_id = ${receipt.actionId}::uuid
          AND r.proposal_digest = ${receipt.proposalDigest} AND r.proposal_digest = p.digest
          AND r.outcome = 'SUCCEEDED' AND r.result = ${JSON.stringify(receipt.outcome.result)}::jsonb
        FOR UPDATE OF a`.execute(tx.db);
      const current = rows[0];
      if (!current) throw conflict('ID_CONFLICT', 'Successful task-create action is no longer current');
      const proposal = actionProposalSchema.parse(current.proposal);
      if (
        canonicalDigest(proposal) !== current.digest ||
        proposal.workspaceId !== tx.workspaceId ||
        proposal.diff.task.id !== receipt.outcome.result.taskId
      )
        throw conflict('ID_CONFLICT', 'Successful task-create receipt does not match its proposal');
      const scope = proposal.subject.scope;
      const settled = await sql<AgentTask>`UPDATE agentic_tasks
        SET status = 'SUCCEEDED', lease_holder = NULL, lease_expires_at = NULL,
          updated_at = clock_timestamp(), finished_at = clock_timestamp(),
          reason = 'The linked approved crm.task.create action succeeded; its CRM task was created.',
          next_event = 'No further queue work is scheduled for this action; the CRM task awaits its normal workflow.'
        WHERE workspace_id = ${tx.workspaceId}::uuid AND action_id = ${parsed.action.id}::uuid
          AND entity_definition_id = ${scope.entityDefinitionId}::uuid
          AND entity_instance_id = ${scope.entityInstanceId}::uuid
          AND module_id = 'record-follow-up' AND task_type = 'record.follow_up'
          AND status IN ('QUEUED', 'LEASED', 'BLOCKED') RETURNING ${columns}`.execute(tx.db);
      for (const task of settled.rows) await record(tx, task);
      return settled.rows;
    },

    complete: (tx: Tx, input: FinishAgentTaskInput) => settle(tx, input, 'SUCCEEDED'),
    failTerminal: (tx: Tx, input: FinishAgentTaskInput) => settle(tx, input, 'FAILED_TERMINAL'),
    release: (tx: Tx, input: FinishAgentTaskInput) => settle(tx, input, 'QUEUED'),

    scheduleRecheck(tx: Tx, input: RecheckAgentTaskInput) {
      const parsed = recheckAgentTaskSchema.parse(input);
      const { dueAt, ...finish } = parsed;
      return settle(tx, finish, 'QUEUED', dueAt);
    },

    async recoverExpired(tx: Tx, input: { limit?: number } = {}): Promise<AgentTask[]> {
      runtime(tx);
      const parsed = recoverAgentTasksSchema.parse(input);
      const expired = await sql<AgentTask>`SELECT ${columns} FROM agentic_tasks
        WHERE workspace_id = ${tx.workspaceId}::uuid AND status = 'LEASED' AND lease_expires_at <= clock_timestamp()
        ORDER BY lease_expires_at, id LIMIT ${parsed.limit} FOR UPDATE SKIP LOCKED`.execute(tx.db);
      const recovered: AgentTask[] = [];
      for (const task of expired.rows) {
        // A linked action may have crossed its dispatch boundary. Even a known terminal outcome needs its owner
        // to decide what the task should do next. Conservatively block every linked action; never infer a retry.
        const blocked = task.actionId !== null;
        const { rows } = await sql<AgentTask>`UPDATE agentic_tasks
          SET status = ${blocked ? 'BLOCKED' : 'QUEUED'}, lease_generation = lease_generation + 1,
          lease_holder = NULL, lease_expires_at = NULL, due_at = clock_timestamp(), updated_at = clock_timestamp(),
          reason = ${blocked ? 'Worker lease expired with a linked action; its effect may require reconciliation.' : 'Worker lease expired before completing effect-free follow-up planning.'},
          next_event = ${blocked ? 'Operator must inspect the linked action outcome; automatic retry is blocked.' : 'Another worker may claim the follow-up planning task.'}
          WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${task.id}::uuid AND status = 'LEASED'
          AND lease_generation = ${task.leaseGeneration}::bigint RETURNING ${columns}`.execute(tx.db);
        if (!rows[0]) throw stale();
        await record(tx, rows[0]);
        recovered.push(rows[0]);
      }
      return recovered;
    },
  };
}

export type AgentTaskService = ReturnType<typeof createAgentTaskService>;
