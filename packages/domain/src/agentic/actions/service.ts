import {
  type AgenticRecordScope,
  agenticPolicyVersion,
  type CreateTaskInput,
  type Task,
  uuidSchema,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { resolveDeadline } from '../../collab/tasks.ts';
import { conflict, DomainError, forbidden, notFound } from '../../errors.ts';
import { newId } from '../../ids.ts';
import type { Tx } from '../../tx.ts';
import { canonicalDigest, canonicalJson } from '../evidence/canonical.ts';
import type { EvidenceService } from '../evidence/service.ts';
import type { AgenticPolicy } from '../policy.ts';
import {
  type Action,
  type ActionAttempt,
  type ActionReceipt,
  type ActionState,
  type ActionStatus,
  actionOutcomeSchema,
  actionProposalSchema,
  type DecideActionInput,
  decideActionSchema,
  type ExecuteTaskCreateInput,
  type ExecuteTaskCreateResult,
  executeTaskCreateSchema,
  type FinishActionAttemptInput,
  finishActionAttemptSchema,
  type ProposeTaskActionInput,
  proposeTaskActionSchema,
  type ReconcileExecutingActionInput,
  type RecordActionActivity,
  type RecordAgentState,
  type RecordAgentStateInput,
  reconcileExecutingActionSchema,
  recordAgentStateSchema,
  type StartActionAttemptInput,
  startActionAttemptSchema,
} from './contracts.ts';

const stale = () => conflict('ID_CONFLICT', 'Action version, digest, or state changed');
const sameScope = (a: AgenticRecordScope, b: AgenticRecordScope) =>
  a.entityDefinitionId === b.entityDefinitionId && a.entityInstanceId === b.entityInstanceId;
type AttemptRow = ActionAttempt & { executor: unknown };
const stateOf = (action: Action): ActionState => ({ id: action.id, status: action.status, version: action.version });

/** Durable intent and exact execution records. Execution is supplied only by the trusted domain task broker. */
export function createActionService(options: {
  policy: AgenticPolicy;
  evidence: EvidenceService;
  /** Queue projection hook; runs in the same transaction after the authoritative action transition. */
  onStateChanged?: (tx: Tx, action: Action) => Promise<void>;
}) {
  async function load(tx: Tx, id: string, lock = false): Promise<Action> {
    uuidSchema.parse(id);
    const { rows } = await sql<Action>`SELECT p.id, p.digest, p.proposal, a.status, a.version
      FROM agentic_action_proposals p JOIN agentic_actions a ON a.workspace_id = p.workspace_id AND a.id = p.id
      WHERE p.workspace_id = ${tx.workspaceId}::uuid AND p.id = ${id}::uuid ${lock ? sql`FOR UPDATE OF a` : sql``}`.execute(
      tx.db,
    );
    if (!rows[0]) throw notFound('Action not found');
    const action = { ...rows[0], proposal: actionProposalSchema.parse(rows[0].proposal) };
    if (canonicalDigest(action.proposal) !== action.digest) throw stale();
    return action;
  }

  function notify(tx: Tx, action: Action) {
    const scope = action.proposal.subject.scope;
    tx.emit('record-timeline', scope.entityDefinitionId, {
      entityDefinitionId: scope.entityDefinitionId,
      entityInstanceIds: [scope.entityInstanceId],
    });
  }

  async function history(tx: Tx, action: Action, fromStatus: ActionStatus | null, fromVersion: number) {
    await sql`INSERT INTO agentic_action_history
      (id, workspace_id, action_id, from_status, to_status, from_version, to_version, actor)
      VALUES (${newId()}::uuid, ${tx.workspaceId}::uuid, ${action.id}::uuid, ${fromStatus}, ${action.status},
        ${fromVersion}, ${action.version}, ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(tx.db);
    notify(tx, action);
  }

  async function transition(tx: Tx, action: Action, to: ActionStatus): Promise<Action> {
    const updated =
      await sql`UPDATE agentic_actions SET status = ${to}, version = version + 1, updated_at = ${tx.now}::timestamptz
      WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${action.id}::uuid
      AND status = ${action.status} AND version = ${action.version} RETURNING id`.execute(tx.db);
    if (updated.rows.length !== 1) throw stale();
    const next = { ...action, status: to, version: action.version + 1 };
    await history(tx, next, action.status, action.version);
    await options.onStateChanged?.(tx, next);
    return next;
  }

  async function assertPolicy(
    tx: Tx,
    scope: AgenticRecordScope,
    capability: 'agentic.action.propose' | 'agentic.action.approve',
  ) {
    await options.policy.assertCan(tx, { capability, scope, policyVersion: agenticPolicyVersion });
  }

  async function currentRecord(tx: Tx, scope: AgenticRecordScope): Promise<string | null> {
    const { rows } = await sql<{ version: string }>`SELECT version::text FROM entity_instances
      WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${scope.entityInstanceId}::uuid
      AND entity_definition_id = ${scope.entityDefinitionId}::uuid AND archived_at IS NULL AND merged_at IS NULL FOR SHARE`.execute(
      tx.db,
    );
    return rows[0]?.version ?? null;
  }

  async function taskExists(tx: Tx, taskId: string) {
    const result =
      await sql`SELECT id FROM tasks WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${taskId}::uuid`.execute(
        tx.db,
      );
    return result.rows.length > 0;
  }

  async function evidenceCurrent(tx: Tx, action: Action): Promise<boolean> {
    for (const ref of action.proposal.evidence) {
      const inspected = await options.evidence.inspect(tx, ref.id);
      if (
        inspected.state !== 'current' ||
        inspected.evidence.digest !== ref.digest ||
        !sameScope(inspected.evidence.snapshot.scope, action.proposal.subject.scope) ||
        inspected.evidence.snapshot.band === 'REJECTED'
      )
        return false;
    }
    return true;
  }

  async function stillCurrent(tx: Tx, action: Action): Promise<boolean> {
    return (
      action.proposal.policy.policyVersion === agenticPolicyVersion &&
      (await currentRecord(tx, action.proposal.subject.scope)) === action.proposal.subject.recordVersion &&
      !(await taskExists(tx, action.proposal.diff.task.id)) &&
      (await evidenceCurrent(tx, action))
    );
  }

  async function taskPolicy(tx: Tx, action: Action) {
    const policy = await options.policy.decide(tx, {
      capability: 'crm.task.create',
      scope: action.proposal.subject.scope,
      policyVersion: agenticPolicyVersion,
    });
    if (policy.effect === 'deny') throw forbidden('Task capability denied', { ...policy });
    return policy;
  }

  function checkCas(action: Action, input: { proposalDigest: string; expectedVersion: number }, status: ActionStatus) {
    if (action.digest !== input.proposalDigest || action.version !== input.expectedVersion || action.status !== status)
      throw stale();
  }

  async function attempt(tx: Tx, id: string): Promise<AttemptRow | undefined> {
    const { rows } =
      await sql<AttemptRow>`SELECT id, action_id AS "actionId", decision_id AS "decisionId", status, version, executor
      FROM agentic_action_attempts WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid`.execute(tx.db);
    return rows[0];
  }

  /** A success receipt proves that the approved task exists with the approved data; a declaration alone is insufficient. */
  async function verifyTaskResult(tx: Tx, action: Action, taskId: string) {
    const expected = action.proposal.diff.task;
    if (taskId !== expected.id) throw stale();
    const { rows } = await sql<{
      content: string;
      mentions: unknown;
      deadline_at: string | null;
      deadline_has_time: boolean;
      completed_at: string | null;
    }>`SELECT content, mentions, deadline_at, deadline_has_time, completed_at FROM tasks
      WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${taskId}::uuid AND deleted_at IS NULL`.execute(tx.db);
    const task = rows[0];
    const deadline = resolveDeadline(expected.deadline);
    const links =
      await sql<AgenticRecordScope>`SELECT entity_definition_id AS "entityDefinitionId", entity_instance_id AS "entityInstanceId"
      FROM task_records WHERE workspace_id = ${tx.workspaceId}::uuid AND task_id = ${taskId}::uuid ORDER BY position`.execute(
        tx.db,
      );
    const assignees = await sql<{ id: string }>`SELECT member_id AS id FROM task_assignees
      WHERE workspace_id = ${tx.workspaceId}::uuid AND task_id = ${taskId}::uuid ORDER BY member_id`.execute(tx.db);
    if (
      !task ||
      task.content !== expected.content.text ||
      canonicalJson(task.mentions ?? []) !== canonicalJson(expected.content.mentions) ||
      task.completed_at !== null ||
      task.deadline_has_time !== (deadline?.hasTime ?? false) ||
      (task.deadline_at === null ? null : Date.parse(task.deadline_at)) !==
        (deadline?.at == null ? null : Date.parse(deadline.at)) ||
      canonicalJson(links.rows) !== canonicalJson(expected.linkedRecords) ||
      canonicalJson(assignees.rows.map((r) => r.id)) !== canonicalJson([...expected.assigneeMemberIds].sort())
    )
      throw conflict('ID_CONFLICT', 'Task result does not match the approved create diff');
  }

  return {
    /** Trusted local executor: attempt, task effect, history and receipt commit or roll back together. */
    async executeTaskCreate(
      tx: Tx,
      input: ExecuteTaskCreateInput,
      createTask: (input: CreateTaskInput) => Promise<Task>,
    ): Promise<ExecuteTaskCreateResult> {
      const parsed = executeTaskCreateSchema.parse(input);
      const action = await load(tx, parsed.actionId, true);
      // A pre-existing dispatch from the W6 split executor has an uncertain effect and must never be redispatched.
      const old = await attempt(tx, parsed.id);
      if (old?.status === 'EXECUTING') {
        await taskPolicy(tx, action);
        throw conflict('ID_CONFLICT', 'An existing execution attempt requires reconciliation');
      }
      const started = await this.startAttempt(tx, {
        id: parsed.id,
        actionId: parsed.actionId,
        proposalDigest: parsed.proposalDigest,
        expectedVersion: parsed.expectedVersion,
      });
      if (!started.attempt) return { capability: 'crm.task.create', action: started.action, receipt: null };
      if (!old) await createTask(action.proposal.diff.task);
      const finished = await this.finishAttempt(tx, {
        id: parsed.receiptId,
        actionId: parsed.actionId,
        proposalDigest: parsed.proposalDigest,
        expectedVersion: started.action.version,
        attemptId: started.attempt.id,
        expectedAttemptVersion: started.attempt.version,
        outcome: { outcome: 'SUCCEEDED', result: { taskId: action.proposal.diff.task.id } },
      });
      return { capability: 'crm.task.create', ...finished };
    },

    async get(tx: Tx, id: string): Promise<Action> {
      const action = await load(tx, id);
      await assertPolicy(tx, action.proposal.subject.scope, 'agentic.action.propose');
      // A proposal contains derived task text, so captured-source access applies to it too.
      if (!(await evidenceCurrent(tx, action))) throw forbidden('Action evidence is unavailable');
      return action;
    },

    async listRecord(
      tx: Tx,
      input: RecordAgentStateInput,
    ): Promise<Pick<RecordAgentState, 'actions' | 'unavailableActionCount'>> {
      const parsed = recordAgentStateSchema.parse(input);
      await assertPolicy(tx, parsed.scope, 'agentic.action.propose');
      // Select only identifiers and timestamps before get() checks the captured source's live access.
      const { rows } = await sql<{ id: string; proposedAt: string; updatedAt: string }>`
        SELECT p.id, p.created_at AS "proposedAt", a.updated_at AS "updatedAt"
        FROM agentic_action_proposals p JOIN agentic_actions a ON a.workspace_id = p.workspace_id AND a.id = p.id
        WHERE p.workspace_id = ${tx.workspaceId}::uuid
          AND p.entity_definition_id = ${parsed.scope.entityDefinitionId}::uuid
          AND p.entity_instance_id = ${parsed.scope.entityInstanceId}::uuid
        ORDER BY p.created_at DESC, p.id DESC LIMIT ${parsed.limit} FOR SHARE OF a`.execute(tx.db);
      const activity: RecordActionActivity[] = [];
      let unavailableActionCount = 0;
      for (const row of rows) {
        let action: Action;
        const evidence: RecordActionActivity['evidence'] = [];
        try {
          action = await this.get(tx, row.id);
          for (const ref of action.proposal.evidence) evidence.push(await options.evidence.read(tx, ref.id));
        } catch (error) {
          // Withhold derived content when source access/freshness changes; never substitute stored snapshots.
          if (
            error instanceof DomainError &&
            (error.code === 'FORBIDDEN' ||
              (error.code === 'ID_CONFLICT' && error.message === 'Evidence source is stale or unavailable'))
          ) {
            unavailableActionCount++;
            continue;
          }
          throw error;
        }
        const receipts = await sql<{
          id: string;
          actionId: string;
          attemptId: string;
          proposalDigest: string;
          outcome: string;
          result: unknown;
          createdAt: string;
        }>`SELECT id, action_id AS "actionId", attempt_id AS "attemptId", proposal_digest AS "proposalDigest",
          outcome, result, created_at AS "createdAt" FROM agentic_action_receipts
          WHERE workspace_id = ${tx.workspaceId}::uuid AND action_id = ${action.id}::uuid`.execute(tx.db);
        const receipt = receipts.rows[0];
        activity.push({
          action,
          evidence,
          proposedAt: row.proposedAt,
          updatedAt: row.updatedAt,
          receipt: receipt
            ? {
                id: receipt.id,
                actionId: receipt.actionId,
                attemptId: receipt.attemptId,
                proposalDigest: receipt.proposalDigest,
                outcome: actionOutcomeSchema.parse({ outcome: receipt.outcome, result: receipt.result }),
                createdAt: receipt.createdAt,
              }
            : null,
        });
      }
      return { actions: activity, unavailableActionCount };
    },

    async propose(tx: Tx, input: ProposeTaskActionInput): Promise<Action> {
      const parsed = proposeTaskActionSchema.parse(input);
      await assertPolicy(tx, parsed.scope, 'agentic.action.propose');
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tx.workspaceId}:action:${parsed.id}`}, 0))`.execute(
        tx.db,
      );
      const existing =
        await sql`SELECT id FROM agentic_actions WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${parsed.id}::uuid`.execute(
          tx.db,
        );
      const task = parsed.diff.task;
      task.assigneeMemberIds = [...new Set(task.assigneeMemberIds)];
      // Restrict the existing task contract to one exact record; implicit links from mentions must not broaden it.
      if (
        task.linkedRecords.length !== 1 ||
        !sameScope(task.linkedRecords[0]!, parsed.scope) ||
        task.isCompleted ||
        task.content.mentions.some((mention) => mention.kind === 'record' && !sameScope(mention, parsed.scope))
      )
        throw forbidden('Task diff must create one incomplete task for the exact approved record');
      const replayKey = (a: Action) => ({
        scope: a.proposal.subject.scope,
        diff: a.proposal.diff,
        evidenceIds: a.proposal.evidence.map((e) => e.id),
        reviewerMemberId: a.proposal.reviewerMemberId,
      });
      if (existing.rows.length) {
        const old = await this.get(tx, parsed.id);
        if (
          canonicalJson(replayKey(old)) !==
          canonicalJson({
            scope: parsed.scope,
            diff: parsed.diff,
            evidenceIds: [...parsed.evidenceIds].sort(),
            reviewerMemberId: parsed.reviewerMemberId,
          })
        )
          throw stale();
        return old;
      }
      // A create intent never authorizes replacing an existing task, irrespective of its author or approval.
      if (await taskExists(tx, task.id)) throw forbidden('A task create proposal cannot overwrite an existing task');
      const reviewer = await tx.db
        .selectFrom('workspace_members')
        .select('id')
        .where('workspace_id', '=', tx.workspaceId)
        .where('id', '=', parsed.reviewerMemberId)
        .where('removed_at', 'is', null)
        .where('access_level', 'in', ['admin', 'member'])
        .executeTakeFirst();
      if (!reviewer) throw forbidden('Reviewer is not an active workspace member');
      const recordVersion = await currentRecord(tx, parsed.scope);
      if (recordVersion === null) throw forbidden('Record scope denied');
      const evidence = [];
      for (const id of [...parsed.evidenceIds].sort()) {
        const row = await options.evidence.read(tx, id);
        if (!sameScope(row.snapshot.scope, parsed.scope) || row.snapshot.band === 'REJECTED')
          throw forbidden('Evidence does not support this record proposal');
        evidence.push({ id, digest: row.digest });
      }
      const policy = await options.policy.decide(tx, {
        capability: 'crm.task.create',
        scope: parsed.scope,
        policyVersion: agenticPolicyVersion,
      });
      if (policy.effect === 'deny') throw forbidden('Task capability denied', { ...policy });
      const proposal = actionProposalSchema.parse({
        contractVersion: 1,
        proposalVersion: 1,
        workspaceId: tx.workspaceId,
        capability: 'crm.task.create',
        subject: { scope: parsed.scope, recordVersion },
        diff: parsed.diff,
        evidence,
        policy,
        reviewerMemberId: parsed.reviewerMemberId,
        proposedBy: tx.ctx.actor,
      });
      const digest = canonicalDigest(proposal);
      await sql`INSERT INTO agentic_action_proposals
        (id, workspace_id, entity_definition_id, entity_instance_id, proposal, digest, created_by)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${parsed.scope.entityDefinitionId}::uuid,
          ${parsed.scope.entityInstanceId}::uuid, ${JSON.stringify(proposal)}::jsonb, ${digest}, ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(
        tx.db,
      );
      await sql`INSERT INTO agentic_actions (id, workspace_id, status) VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, 'PROPOSED')`.execute(
        tx.db,
      );
      const action: Action = { id: parsed.id, proposal, digest, status: 'PROPOSED', version: 1 };
      await history(tx, action, null, 0);
      return action;
    },

    async decide(tx: Tx, input: DecideActionInput): Promise<ActionState> {
      const parsed = decideActionSchema.parse(input);
      // A decision is always human in this packet, even if an agent grant is misconfigured or policy changes.
      if (tx.ctx.actor.type !== 'workspace-member') throw forbidden('Only a human member may decide an action');
      const action = await load(tx, parsed.actionId, true);
      await assertPolicy(tx, action.proposal.subject.scope, 'agentic.action.approve');
      if (tx.ctx.actor.id !== action.proposal.reviewerMemberId)
        throw forbidden('Action is assigned to another reviewer');
      const previous = await sql<{
        id: string;
        outcome: string;
        proposal_digest: string;
        member_id: string;
      }>`SELECT id, outcome, proposal_digest, member_id
        FROM agentic_action_decisions WHERE workspace_id = ${tx.workspaceId}::uuid AND action_id = ${action.id}::uuid`.execute(
        tx.db,
      );
      if (previous.rows[0]) {
        const old = previous.rows[0];
        if (
          old.id !== parsed.id ||
          old.outcome !== parsed.outcome ||
          old.proposal_digest !== parsed.proposalDigest ||
          old.member_id !== tx.ctx.actor.id
        )
          throw stale();
        if (!(await evidenceCurrent(tx, action))) throw forbidden('Action evidence is unavailable');
        return stateOf(action);
      }
      checkCas(action, parsed, 'PROPOSED');
      await taskPolicy(tx, action);
      if (!(await stillCurrent(tx, action))) return stateOf(await transition(tx, action, 'STALE'));
      await sql`INSERT INTO agentic_action_decisions (id, workspace_id, action_id, proposal_digest, outcome, member_id)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${action.id}::uuid, ${action.digest}, ${parsed.outcome}, ${tx.ctx.actor.id}::uuid)`.execute(
        tx.db,
      );
      return stateOf(await transition(tx, action, parsed.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED'));
    },

    async startAttempt(
      tx: Tx,
      input: StartActionAttemptInput,
    ): Promise<{ action: ActionState; attempt: ActionAttempt | null }> {
      const parsed = startActionAttemptSchema.parse(input);
      const action = await load(tx, parsed.actionId, true);
      await taskPolicy(tx, action);
      if (action.digest !== parsed.proposalDigest) throw stale();
      const old = await attempt(tx, parsed.id);
      if (old) {
        if (old.actionId !== action.id || canonicalJson(old.executor) !== canonicalJson(tx.ctx.actor)) throw stale();
        if (!(await evidenceCurrent(tx, action))) throw forbidden('Action evidence is unavailable');
        return {
          action: stateOf(action),
          attempt: {
            id: old.id,
            actionId: old.actionId,
            decisionId: old.decisionId,
            status: old.status,
            version: old.version,
          },
        };
      }
      checkCas(action, parsed, 'APPROVED');
      if (!(await stillCurrent(tx, action)))
        return { action: stateOf(await transition(tx, action, 'STALE')), attempt: null };
      const decision = await sql<{ id: string }>`SELECT id FROM agentic_action_decisions
        WHERE workspace_id = ${tx.workspaceId}::uuid AND action_id = ${action.id}::uuid
        AND proposal_digest = ${action.digest} AND outcome = 'APPROVE'`.execute(tx.db);
      // There is deliberately no auto-write route: even VERIFIED primary evidence still requires the W1 human decision.
      if (!decision.rows[0]) throw forbidden('An exact human approval is required before dispatch');
      await sql`INSERT INTO agentic_action_attempts (id, workspace_id, action_id, decision_id, status, executor)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${action.id}::uuid, ${decision.rows[0].id}::uuid,
          'EXECUTING', ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(tx.db);
      const next = await transition(tx, action, 'EXECUTING');
      return {
        action: stateOf(next),
        attempt: {
          id: parsed.id,
          actionId: action.id,
          decisionId: decision.rows[0].id,
          status: 'EXECUTING',
          version: 1,
        },
      };
    },

    /**
     * Crash recovery for the legacy split executor. The trusted runtime may only record the conservative outcome;
     * it cannot claim success or failure, and the immutable receipt prevents redispatch on replay.
     */
    async reconcileExecuting(
      tx: Tx,
      input: ReconcileExecutingActionInput,
    ): Promise<{ action: ActionState; receipt: ActionReceipt }> {
      if (tx.ctx.actor.type !== 'system') throw forbidden('Only the trusted runtime may reconcile execution');
      const parsed = reconcileExecutingActionSchema.parse(input);
      const action = await load(tx, parsed.actionId, true);
      const receipts = await sql<{
        id: string;
        attemptId: string;
        outcome: string;
        result: unknown;
      }>`SELECT id, attempt_id AS "attemptId", outcome, result FROM agentic_action_receipts
        WHERE workspace_id = ${tx.workspaceId}::uuid AND action_id = ${action.id}::uuid`.execute(tx.db);
      const existing = receipts.rows[0];
      if (existing) {
        if (action.status !== 'OUTCOME_UNKNOWN' || existing.outcome !== 'OUTCOME_UNKNOWN') throw stale();
        return {
          action: stateOf(action),
          receipt: {
            id: existing.id,
            actionId: action.id,
            attemptId: existing.attemptId,
            proposalDigest: action.digest,
            outcome: actionOutcomeSchema.parse({ outcome: existing.outcome, result: existing.result }),
          },
        };
      }
      if (action.status !== 'EXECUTING') throw stale();
      const attempts = await sql<ActionAttempt>`SELECT id, action_id AS "actionId", decision_id AS "decisionId",
        status, version FROM agentic_action_attempts WHERE workspace_id = ${tx.workspaceId}::uuid
          AND action_id = ${action.id}::uuid FOR UPDATE`.execute(tx.db);
      const current = attempts.rows[0];
      if (!current || current.status !== 'EXECUTING') throw stale();
      const outcome = actionOutcomeSchema.parse({
        outcome: 'OUTCOME_UNKNOWN',
        result: { reason: 'dispatch-uncertain' },
      });
      const updated = await sql`UPDATE agentic_action_attempts
        SET status = 'OUTCOME_UNKNOWN', version = version + 1, updated_at = ${tx.now}::timestamptz
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${current.id}::uuid
          AND status = 'EXECUTING' AND version = ${current.version} RETURNING id`.execute(tx.db);
      if (updated.rows.length !== 1) throw stale();
      const receipt: ActionReceipt = {
        id: newId(),
        actionId: action.id,
        attemptId: current.id,
        proposalDigest: action.digest,
        outcome,
      };
      await sql`INSERT INTO agentic_action_receipts
        (id, workspace_id, action_id, attempt_id, proposal_digest, outcome, result, created_by)
        VALUES (${receipt.id}::uuid, ${tx.workspaceId}::uuid, ${action.id}::uuid, ${current.id}::uuid,
          ${action.digest}, 'OUTCOME_UNKNOWN', ${JSON.stringify(outcome.result)}::jsonb,
          ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(tx.db);
      return { action: stateOf(await transition(tx, action, 'OUTCOME_UNKNOWN')), receipt };
    },

    /** Trusted executor API, not an approval or tool endpoint. No retries are permitted after an unknown outcome. */
    async finishAttempt(
      tx: Tx,
      input: FinishActionAttemptInput,
    ): Promise<{ action: ActionState; receipt: ActionReceipt }> {
      const parsed = finishActionAttemptSchema.parse(input);
      const action = await load(tx, parsed.actionId, true);
      const current = await attempt(tx, parsed.attemptId);
      if (!current || current.actionId !== action.id || canonicalJson(current.executor) !== canonicalJson(tx.ctx.actor))
        throw forbidden('Execution attempt does not belong to this executor');
      if (action.digest !== parsed.proposalDigest) throw stale();
      const previous = await sql<{
        id: string;
        outcome: string;
        result: unknown;
      }>`SELECT id, outcome, result FROM agentic_action_receipts
        WHERE workspace_id = ${tx.workspaceId}::uuid AND action_id = ${action.id}::uuid AND attempt_id = ${current.id}::uuid`.execute(
        tx.db,
      );
      const receipt: ActionReceipt = {
        id: parsed.id,
        actionId: action.id,
        attemptId: current.id,
        proposalDigest: action.digest,
        outcome: parsed.outcome,
      };
      if (previous.rows[0]) {
        const old = previous.rows[0];
        if (
          old.id !== parsed.id ||
          old.outcome !== parsed.outcome.outcome ||
          canonicalJson(old.result) !== canonicalJson(parsed.outcome.result)
        )
          throw stale();
        return { action: stateOf(action), receipt };
      }
      checkCas(action, parsed, 'EXECUTING');
      if (current.status !== 'EXECUTING' || current.version !== parsed.expectedAttemptVersion) throw stale();
      if (parsed.outcome.outcome === 'SUCCEEDED') await verifyTaskResult(tx, action, parsed.outcome.result.taskId);
      const changed =
        await sql`UPDATE agentic_action_attempts SET status = ${parsed.outcome.outcome}, version = version + 1, updated_at = ${tx.now}::timestamptz
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${current.id}::uuid AND status = 'EXECUTING'
        AND version = ${parsed.expectedAttemptVersion} RETURNING id`.execute(tx.db);
      if (changed.rows.length !== 1) throw stale();
      await sql`INSERT INTO agentic_action_receipts
        (id, workspace_id, action_id, attempt_id, proposal_digest, outcome, result, created_by)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${action.id}::uuid, ${current.id}::uuid, ${action.digest},
          ${parsed.outcome.outcome}, ${JSON.stringify(parsed.outcome.result)}::jsonb, ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(
        tx.db,
      );
      return { action: stateOf(await transition(tx, action, parsed.outcome.outcome)), receipt };
    },
  };
}
export type ActionService = ReturnType<typeof createActionService>;
