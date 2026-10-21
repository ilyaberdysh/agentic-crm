import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type AgentCapabilityGrant, agentCapabilityGrantSchema, uuidSchema } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { z } from 'zod';
import { conflict, forbidden, notFound } from '../../errors.ts';
import { newId } from '../../ids.ts';
import type { Tx } from '../../tx.ts';
import { type ExecuteTaskCreateInput, executeTaskCreateSchema } from '../actions/contracts.ts';
import type { AgentAuthoritySource } from '../policy.ts';
import type { AgentTask, AgentTaskLease, ClaimAgentTasksInput, FinishAgentTaskInput } from '../tasks/contracts.ts';

const runnerName = z.string().trim().min(1).max(100);
const profileSchema = z.strictObject({
  id: uuidSchema,
  provider: z.enum(['codex', 'claude', 'gemini']),
  label: runnerName,
});
export const enrollRunnerSchema = z.strictObject({
  token: z.string().max(200),
  id: uuidSchema,
  name: runnerName,
  authProfiles: z.array(profileSchema).max(8).default([]),
});
export const claimRunnerTasksSchema = z.strictObject({
  leaseDurationMs: z.number().int().min(1000).max(300_000).default(60_000),
  limit: z.number().int().min(1).max(10).default(1),
});
export const runnerLeaseSchema = z.strictObject({ taskId: uuidSchema, generation: z.string().regex(/^[1-9]\d*$/) });
export const runnerFinishSchema = runnerLeaseSchema.extend({
  reason: z.string().trim().min(1).max(1000),
  nextEvent: z.string().trim().min(1).max(1000),
});

type TokenKind = 'enr' | 'run' | 'grant';
type Runner = { id: string; workspaceId: string; memberId: string; name: string };
type Grant = {
  id: string;
  runnerId: string;
  taskId: string;
  actionId: string;
  leaseGeneration: string;
  entityDefinitionId: string;
  entityInstanceId: string;
};

/** A token carries routing IDs, not authority. Every use verifies its digest in the scoped DB transaction. */
export function runnerTokenWorkspace(token: string, kind: TokenKind): string | null {
  const match = new RegExp(`^acrm_${kind}\\.([0-9a-f-]{36})\\.([0-9a-f-]{36})\\.([A-Za-z0-9_-]{43})$`).exec(token);
  if (!match || !uuidSchema.safeParse(match[1]).success || !uuidSchema.safeParse(match[2]).success) return null;
  return match[1]!;
}

function tokenId(token: string): string {
  return token.split('.')[2]!;
}

function mint(kind: TokenKind, workspaceId: string, id: string): string {
  return `acrm_${kind}.${workspaceId}.${id}.${randomBytes(32).toString('base64url')}`;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sameHash(actual: string, expected: string): boolean {
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function memberAdmin(tx: Tx) {
  if (tx.ctx.actor.type !== 'workspace-member' || !tx.ctx.actor.id) throw forbidden('Workspace admin required');
  return tx.ctx.actor.id;
}

function trustedRunner(tx: Tx) {
  if (tx.ctx.actor.type !== 'system') throw forbidden('Runner operations require a trusted transport');
}

export interface RunnerTaskRuntime {
  claimDue(tx: Tx, input: ClaimAgentTasksInput): Promise<AgentTask[]>;
  assertLease(tx: Tx, input: AgentTaskLease): Promise<unknown>;
  heartbeat(tx: Tx, input: AgentTaskLease & { leaseDurationMs: number }): Promise<AgentTask>;
  complete(tx: Tx, input: FinishAgentTaskInput): Promise<AgentTask>;
  failTerminal(tx: Tx, input: FinishAgentTaskInput): Promise<AgentTask>;
  release(tx: Tx, input: FinishAgentTaskInput): Promise<AgentTask>;
  recoverExpired(tx: Tx, input: { limit?: number }): Promise<AgentTask[]>;
  resumeBlocked(tx: Tx, input: { taskId: string }): Promise<AgentTask>;
}

/** All methods receive the caller's existing workspace transaction; no provider or CLI I/O is done here. */
export function createRunnerService<Result>(options: {
  tasks: RunnerTaskRuntime;
  executeTaskCreate(tx: Tx, input: ExecuteTaskCreateInput): Promise<Result>;
}) {
  async function authenticate(tx: Tx, token: string): Promise<Runner> {
    trustedRunner(tx);
    if (runnerTokenWorkspace(token, 'run') !== tx.workspaceId) throw forbidden('Invalid runner token');
    const id = tokenId(token);
    const { rows } = await sql<Runner & { bearerHash: string }>`SELECT r.id, r.workspace_id AS "workspaceId",
      r.member_id AS "memberId", r.name, r.bearer_hash AS "bearerHash"
      FROM agentic_runners r JOIN workspace_members m ON m.workspace_id = r.workspace_id AND m.id = r.member_id
      WHERE r.workspace_id = ${tx.workspaceId}::uuid AND r.id = ${id}::uuid AND r.revoked_at IS NULL
        AND m.removed_at IS NULL AND m.access_level IN ('admin', 'member') FOR SHARE OF r, m`.execute(tx.db);
    const row = rows[0];
    if (!row || !sameHash(row.bearerHash, hash(token))) throw forbidden('Invalid runner token');
    tx.ctx.actor = { type: 'system', id: row.id };
    return { id: row.id, workspaceId: row.workspaceId, memberId: row.memberId, name: row.name };
  }

  async function validateGrant(tx: Tx, runner: Runner, token: string, actionId: string): Promise<Grant> {
    if (runnerTokenWorkspace(token, 'grant') !== tx.workspaceId) throw forbidden('Invalid task grant');
    const id = tokenId(token);
    const { rows } = await sql<Grant & { secretHash: string }>`SELECT g.id, g.runner_id AS "runnerId",
      g.task_id AS "taskId", g.action_id AS "actionId", g.lease_generation::text AS "leaseGeneration",
      g.entity_definition_id AS "entityDefinitionId", g.entity_instance_id AS "entityInstanceId",
      g.secret_hash AS "secretHash" FROM agentic_runner_grants g
      WHERE g.workspace_id = ${tx.workspaceId}::uuid AND g.id = ${id}::uuid AND g.runner_id = ${runner.id}::uuid
        AND g.action_id = ${actionId}::uuid AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()
      `.execute(tx.db);
    const grant = rows[0];
    if (!grant || !sameHash(grant.secretHash, hash(token))) throw forbidden('Invalid task grant');
    const { rows: linked } = await sql<{ status: string; terminalReceipt: boolean }>`SELECT t.status,
      EXISTS (SELECT 1 FROM agentic_action_receipts r WHERE r.workspace_id = t.workspace_id
        AND r.action_id = t.action_id AND r.outcome = 'SUCCEEDED') AS "terminalReceipt"
      FROM agentic_tasks t WHERE t.workspace_id = ${tx.workspaceId}::uuid AND t.id = ${grant.taskId}::uuid
        AND t.action_id = ${actionId}::uuid AND t.entity_definition_id = ${grant.entityDefinitionId}::uuid
        AND t.entity_instance_id = ${grant.entityInstanceId}::uuid`.execute(tx.db);
    const task = linked[0];
    if (!task) throw forbidden('Task grant no longer matches its action');
    if (task.status === 'LEASED') {
      await options.tasks.assertLease(tx, {
        taskId: grant.taskId,
        holder: `runner:${runner.id}`,
        generation: grant.leaseGeneration,
      });
    } else if (task.status !== 'SUCCEEDED' || !task.terminalReceipt) {
      throw forbidden('Task grant is no longer executable');
    }
    return grant;
  }

  return {
    async createEnrollment(tx: Tx) {
      const memberId = memberAdmin(tx);
      const member = await sql<{ id: string }>`SELECT id FROM workspace_members
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${memberId}::uuid AND access_level = 'admin'
        AND removed_at IS NULL FOR SHARE`.execute(tx.db);
      if (!member.rows[0]) throw forbidden('Workspace admin required');
      const id = newId();
      const token = mint('enr', tx.workspaceId, id);
      const { rows } = await sql<{ expiresAt: string }>`INSERT INTO agentic_runner_enrollments
        (id, workspace_id, member_id, secret_hash, expires_at)
        VALUES (${id}::uuid, ${tx.workspaceId}::uuid, ${memberId}::uuid, ${hash(token)},
          clock_timestamp() + interval '10 minutes') RETURNING expires_at AS "expiresAt"`.execute(tx.db);
      return { id, token, expiresAt: rows[0]!.expiresAt };
    },

    async enroll(tx: Tx, input: z.input<typeof enrollRunnerSchema>) {
      trustedRunner(tx);
      const parsed = enrollRunnerSchema.parse(input);
      if (runnerTokenWorkspace(parsed.token, 'enr') !== tx.workspaceId) throw forbidden('Invalid enrollment token');
      if (new Set(parsed.authProfiles.map((profile) => profile.id)).size !== parsed.authProfiles.length)
        throw conflict('ID_CONFLICT', 'Duplicate auth profile id');
      const id = tokenId(parsed.token);
      const { rows } = await sql<{ memberId: string; secretHash: string }>`SELECT member_id AS "memberId",
        secret_hash AS "secretHash" FROM agentic_runner_enrollments
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid AND used_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`.execute(tx.db);
      const enrollment = rows[0];
      if (!enrollment || !sameHash(enrollment.secretHash, hash(parsed.token)))
        throw forbidden('Invalid enrollment token');
      const member = await sql<{
        id: string;
      }>`SELECT id FROM workspace_members WHERE workspace_id = ${tx.workspaceId}::uuid
        AND id = ${enrollment.memberId}::uuid AND removed_at IS NULL AND access_level = 'admin' FOR SHARE`.execute(
        tx.db,
      );
      if (!member.rows[0]) throw forbidden('Enrollment owner is no longer an admin');
      const bearerToken = mint('run', tx.workspaceId, parsed.id);
      await sql`INSERT INTO agentic_runners (id, workspace_id, member_id, name, bearer_hash)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${enrollment.memberId}::uuid,
          ${parsed.name}, ${hash(bearerToken)})`.execute(tx.db);
      for (const profile of parsed.authProfiles) {
        await sql`INSERT INTO agentic_runner_auth_profiles (id, workspace_id, runner_id, provider, label)
          VALUES (${profile.id}::uuid, ${tx.workspaceId}::uuid, ${parsed.id}::uuid,
            ${profile.provider}, ${profile.label})`.execute(tx.db);
      }
      await sql`UPDATE agentic_runner_enrollments SET used_at = clock_timestamp()
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid`.execute(tx.db);
      return { id: parsed.id, workspaceId: tx.workspaceId, bearerToken };
    },

    authenticate,

    async list(tx: Tx) {
      const memberId = memberAdmin(tx);
      const admin = await sql`SELECT id FROM workspace_members WHERE workspace_id = ${tx.workspaceId}::uuid
        AND id = ${memberId}::uuid AND access_level = 'admin' AND removed_at IS NULL`.execute(tx.db);
      if (!admin.rows[0]) throw forbidden('Workspace admin required');
      const { rows } = await sql`SELECT r.id, r.member_id AS "memberId", r.name, r.created_at AS "createdAt",
        r.last_seen_at AS "lastSeenAt", r.revoked_at AS "revokedAt",
        COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'provider', p.provider, 'label', p.label))
          FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS "authProfiles"
        FROM agentic_runners r LEFT JOIN agentic_runner_auth_profiles p
          ON p.workspace_id = r.workspace_id AND p.runner_id = r.id
        WHERE r.workspace_id = ${tx.workspaceId}::uuid GROUP BY r.id ORDER BY r.created_at DESC`.execute(tx.db);
      return rows;
    },

    async revoke(tx: Tx, runnerId: string) {
      const memberId = memberAdmin(tx);
      uuidSchema.parse(runnerId);
      const admin = await sql`SELECT id FROM workspace_members WHERE workspace_id = ${tx.workspaceId}::uuid
        AND id = ${memberId}::uuid AND access_level = 'admin' AND removed_at IS NULL`.execute(tx.db);
      if (!admin.rows[0]) throw forbidden('Workspace admin required');
      const { rows } = await sql<{
        id: string;
      }>`UPDATE agentic_runners SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${runnerId}::uuid RETURNING id`.execute(tx.db);
      if (!rows[0]) throw notFound('Runner not found');
      await sql`UPDATE agentic_runner_grants SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE workspace_id = ${tx.workspaceId}::uuid AND runner_id = ${runnerId}::uuid`.execute(tx.db);
      return { id: runnerId, revoked: true };
    },

    async claim(tx: Tx, bearerToken: string, input: z.input<typeof claimRunnerTasksSchema>) {
      const runner = await authenticate(tx, bearerToken);
      const parsed = claimRunnerTasksSchema.parse(input);
      const tasks = await options.tasks.claimDue(tx, {
        ...parsed,
        holder: `runner:${runner.id}`,
        approvedActionsOnly: true,
      });
      const claimed = [];
      for (const task of tasks) {
        let grantToken: string | null = null;
        let execution: ExecuteTaskCreateInput | null = null;
        if (task.actionId) {
          const { rows: actions } = await sql<{ status: string; version: number; digest: string }>`
            SELECT a.status, a.version, p.digest FROM agentic_actions a
            JOIN agentic_action_proposals p ON p.workspace_id = a.workspace_id AND p.id = a.id
            WHERE a.workspace_id = ${tx.workspaceId}::uuid AND a.id = ${task.actionId}::uuid
              AND p.entity_definition_id = ${task.scope.entityDefinitionId}::uuid
              AND p.entity_instance_id = ${task.scope.entityInstanceId}::uuid FOR SHARE OF a`.execute(tx.db);
          const action = actions[0];
          if (!action || action.status !== 'APPROVED')
            throw conflict('ID_CONFLICT', 'Linked action is not approved for runner dispatch');
          execution = {
            id: newId(),
            receiptId: newId(),
            actionId: task.actionId,
            proposalDigest: action.digest,
            expectedVersion: action.version,
          };
          const grantId = newId();
          grantToken = mint('grant', tx.workspaceId, grantId);
          await sql`INSERT INTO agentic_runner_grants
            (id, workspace_id, runner_id, task_id, action_id, lease_generation, entity_definition_id,
              entity_instance_id, secret_hash, expires_at)
            VALUES (${grantId}::uuid, ${tx.workspaceId}::uuid, ${runner.id}::uuid, ${task.id}::uuid,
              ${task.actionId}::uuid, ${task.leaseGeneration}::bigint, ${task.scope.entityDefinitionId}::uuid,
              ${task.scope.entityInstanceId}::uuid, ${hash(grantToken)},
              LEAST(${task.leaseExpiresAt}::timestamptz, clock_timestamp() + interval '5 minutes'))`.execute(tx.db);
        }
        claimed.push({ task, grantToken, execution });
      }
      await sql`UPDATE agentic_runners SET last_seen_at = clock_timestamp()
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${runner.id}::uuid`.execute(tx.db);
      return claimed;
    },

    async heartbeat(tx: Tx, bearerToken: string, input: z.input<typeof runnerLeaseSchema>) {
      const runner = await authenticate(tx, bearerToken);
      const parsed = runnerLeaseSchema.parse(input);
      const task = await options.tasks.heartbeat(tx, {
        taskId: parsed.taskId,
        holder: `runner:${runner.id}`,
        generation: parsed.generation,
        leaseDurationMs: 60_000,
      });
      await sql`UPDATE agentic_runner_grants SET expires_at = LEAST(${task.leaseExpiresAt}::timestamptz,
        clock_timestamp() + interval '5 minutes')
        WHERE workspace_id = ${tx.workspaceId}::uuid AND runner_id = ${runner.id}::uuid
        AND task_id = ${task.id}::uuid AND lease_generation = ${parsed.generation}::bigint
        AND revoked_at IS NULL`.execute(tx.db);
      return task;
    },

    async finish(
      tx: Tx,
      bearerToken: string,
      kind: 'complete' | 'failTerminal' | 'release',
      input: z.input<typeof runnerFinishSchema>,
    ) {
      const runner = await authenticate(tx, bearerToken);
      const parsed = runnerFinishSchema.parse(input);
      const task = await options.tasks[kind](tx, { ...parsed, holder: `runner:${runner.id}` });
      await sql`UPDATE agentic_runner_grants SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE workspace_id = ${tx.workspaceId}::uuid AND runner_id = ${runner.id}::uuid
        AND task_id = ${task.id}::uuid AND lease_generation = ${parsed.generation}::bigint`.execute(tx.db);
      return task;
    },

    async recoverExpired(tx: Tx, bearerToken: string, input: { limit?: number } = {}) {
      await authenticate(tx, bearerToken);
      return options.tasks.recoverExpired(tx, input);
    },

    async resumeBlocked(tx: Tx, bearerToken: string, input: { taskId: string }) {
      await authenticate(tx, bearerToken);
      return options.tasks.resumeBlocked(tx, input);
    },

    async executeTool(tx: Tx, bearerToken: string, grantToken: string, input: ExecuteTaskCreateInput) {
      const runner = await authenticate(tx, bearerToken);
      const parsed = executeTaskCreateSchema.parse(input);
      const grant = await validateGrant(tx, runner, grantToken, parsed.actionId);
      const previous = tx.ctx.agentRuntime;
      tx.ctx.agentRuntime = { runnerId: runner.id, grantId: grant.id };
      try {
        return await options.executeTaskCreate(tx, parsed);
      } finally {
        tx.ctx.agentRuntime = previous;
      }
    },
  };
}

/** The policy reads current grant, runner, delegated member and task lease on every decision. */
export const runnerAuthoritySource: AgentAuthoritySource = {
  async principalOf(tx) {
    const runtime = tx.ctx.agentRuntime;
    if (!runtime || tx.ctx.actor.type !== 'system') return null;
    return { type: 'agent', id: runtime.runnerId, grantId: runtime.grantId };
  },
  async loadGrant(tx, grantId): Promise<AgentCapabilityGrant | null> {
    const runtime = tx.ctx.agentRuntime;
    if (!runtime || runtime.grantId !== grantId) return null;
    const { rows } = await sql<{
      id: string;
      workspaceId: string;
      runnerId: string;
      memberId: string;
      entityDefinitionId: string;
      entityInstanceId: string;
      expiresAt: string;
      revokedAt: string | null;
    }>`SELECT g.id, g.workspace_id AS "workspaceId", g.runner_id AS "runnerId", r.member_id AS "memberId",
      g.entity_definition_id AS "entityDefinitionId", g.entity_instance_id AS "entityInstanceId",
      g.expires_at AS "expiresAt", g.revoked_at AS "revokedAt"
      FROM agentic_runner_grants g JOIN agentic_runners r ON r.workspace_id = g.workspace_id AND r.id = g.runner_id
      JOIN workspace_members m ON m.workspace_id = r.workspace_id AND m.id = r.member_id
      JOIN agentic_tasks t ON t.workspace_id = g.workspace_id AND t.id = g.task_id
      JOIN agentic_actions a ON a.workspace_id = g.workspace_id AND a.id = g.action_id
      LEFT JOIN agentic_action_receipts ar ON ar.workspace_id = g.workspace_id AND ar.action_id = g.action_id
      WHERE g.workspace_id = ${tx.workspaceId}::uuid AND g.id = ${grantId}::uuid
        AND g.runner_id = ${runtime.runnerId}::uuid AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()
        AND r.revoked_at IS NULL AND m.removed_at IS NULL AND m.access_level IN ('admin', 'member')
        AND ((t.status = 'LEASED' AND t.lease_holder = ${`runner:${runtime.runnerId}`}
          AND t.lease_generation = g.lease_generation AND t.lease_expires_at > clock_timestamp())
          OR (t.status = 'SUCCEEDED' AND a.status = 'SUCCEEDED' AND ar.outcome = 'SUCCEEDED'))
        AND t.action_id = g.action_id FOR SHARE OF g, r, m`.execute(tx.db);
    const row = rows[0];
    if (!row) return null;
    return agentCapabilityGrantSchema.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      agentId: row.runnerId,
      delegatedByMemberId: row.memberId,
      // The approved capability rechecks its captured note evidence immediately before dispatch. The internal
      // source reader uses agentic.action.propose for that read; approval is intentionally never delegated.
      capabilities: ['crm.task.create', 'agentic.action.propose'],
      scope: { entityDefinitionId: row.entityDefinitionId, entityInstanceId: row.entityInstanceId },
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    });
  },
};

export type RunnerService = ReturnType<typeof createRunnerService>;
