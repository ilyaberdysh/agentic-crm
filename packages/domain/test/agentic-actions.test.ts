import { type AgentCapabilityGrant, type AgentPrincipal } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import type { Action, FinishActionAttemptInput, ProposeTaskActionInput } from '../src/agentic/actions/contracts.ts';
import { createActionService } from '../src/agentic/actions/service.ts';
import { canonicalDigest } from '../src/agentic/evidence/canonical.ts';
import type { CaptureEvidenceInput } from '../src/agentic/evidence/contracts.ts';
import { createNoteEvidenceSource } from '../src/agentic/evidence/note-source.ts';
import { createEvidenceService } from '../src/agentic/evidence/service.ts';
import { type AgentAuthoritySource, createAgenticPolicy } from '../src/agentic/policy.ts';
import { createTaskCapability } from '../src/agentic/task-capability.ts';
import { createAgentTaskService } from '../src/agentic/tasks/service.ts';
import { taskOps } from '../src/collab/tasks.ts';
import type { ServiceContext } from '../src/context.ts';
import { grantResolver } from '../src/permissions/resolver.ts';
import { allowAllResolver, createPolicies } from '../src/permissions.ts';
import { runInWorkspace } from '../src/tx.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

async function fixture() {
  const fx = await collabFixture();
  const agent: AgentPrincipal = { type: 'agent', id: newId(), grantId: newId() };
  const agentCtx: ServiceContext = { workspaceId: fx.workspaceId, actor: { type: 'app', id: agent.id } };
  let grant: AgentCapabilityGrant = {
    id: agent.grantId,
    agentId: agent.id,
    workspaceId: fx.workspaceId,
    delegatedByMemberId: fx.memberId,
    capabilities: ['crm.task.create', 'agentic.action.propose', 'agentic.action.approve'],
    scope: fx.record,
    expiresAt: '2099-01-01T00:00:00Z',
    revokedAt: null,
  };
  const agents: AgentAuthoritySource = {
    principalOf: async (tx) => (tx.ctx.actor.type === 'app' && tx.ctx.actor.id === agent.id ? agent : null),
    loadGrant: async (_tx, id) => (id === grant.id ? grant : null),
  };
  const resolver = grantResolver(allowAllResolver);
  const policy = createAgenticPolicy({ resolver, agents });
  const evidence = createEvidenceService(createNoteEvidenceSource({ policy, resolver, agents }));
  const actions = createActionService({ policy, evidence });
  const queue = createAgentTaskService({ policy });
  const capability = createTaskCapability({ actions, collab: { policies: createPolicies(resolver) }, tasks: queue });
  const note = await domain.notes.create(fx.ctx, {
    id: newId(),
    title: 'Customer request',
    parentRecords: [fx.record],
  });
  const text = 'Please send the contract tomorrow.';
  await domain.documents.replaceContent(fx.ctx, { id: note.documentId, content: { markdown: text } });
  const captureInput: CaptureEvidenceInput = {
    id: newId(),
    scope: fx.record,
    source: { kind: 'crm.note', id: note.id },
    band: 'VERIFIED',
    claim: 'Customer requested the contract.',
    fragment: { start: 0, end: text.length, quote: text },
  };
  const captured = await runInWorkspace(database, agentCtx, (tx) => evidence.capture(tx, captureInput));
  const proposalInput: ProposeTaskActionInput = {
    id: newId(),
    scope: fx.record,
    diff: {
      operation: 'create',
      task: { id: newId(), content: { text: 'Send contract' }, linkedRecords: [fx.record] },
    },
    evidenceIds: [captured.id],
    reviewerMemberId: fx.memberId,
  };
  const propose = (input = proposalInput, ctx = agentCtx) =>
    runInWorkspace(database, ctx, (tx) => actions.propose(tx, input));
  const decide = async (action: Action, id = newId(), ctx = fx.ctx, outcome: 'APPROVE' | 'REJECT' = 'APPROVE') => {
    const state = await runInWorkspace(database, ctx, (tx) =>
      actions.decide(tx, {
        id,
        actionId: action.id,
        proposalDigest: action.digest,
        expectedVersion: action.version,
        outcome,
      }),
    );
    // The caller already held this proposal; state-changing APIs do not return captured-derived content.
    return { ...action, ...state };
  };
  return {
    ...fx,
    agentCtx,
    note,
    text,
    evidence,
    actions,
    queue,
    enqueue: (actionId: string | null, dueAt = '2020-01-01T00:00:00Z') =>
      runInWorkspace(database, fx.sys, (tx) =>
        queue.enqueue(tx, {
          id: newId(),
          scope: fx.record,
          moduleId: 'record-follow-up',
          taskType: 'record.follow_up',
          actionId,
          dueAt,
          reason: 'Follow-up work is waiting for the linked action.',
          nextEvent: 'Evaluate the action outcome.',
        }),
      ),
    restartCapability: () =>
      createTaskCapability({
        actions: createActionService({ policy, evidence }),
        collab: { policies: createPolicies(resolver) },
        tasks: createAgentTaskService({ policy }),
      }),
    execute: (input: Parameters<typeof capability.execute>[1], ctx = agentCtx) =>
      runInWorkspace(database, ctx, (tx) => capability.execute(tx, input)),
    captureInput,
    captured,
    proposalInput,
    propose,
    decide,
    setGrant: (patch: Partial<AgentCapabilityGrant>) => {
      grant = { ...grant, ...patch };
    },
  };
}

describe('durable record-scoped task actions', () => {
  it('settles only active queue work for the exact successful action, including replay after restart', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const [blocked, leased, terminalFailure, terminalSuccess] = await Promise.all(
      Array.from({ length: 4 }, () => fx.enqueue(approved.id)),
    );
    const claimed = await runInWorkspace(database, fx.sys, (tx) =>
      fx.queue.claimDue(tx, { holder: 'follow-up-worker', leaseDurationMs: 60_000, limit: 4 }),
    );
    const token = (id: string) => {
      const task = claimed.find((task) => task.id === id)!;
      return { taskId: task.id, holder: task.leaseHolder!, generation: task.leaseGeneration };
    };
    await database.pool.query(
      "UPDATE agentic_tasks SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
      [blocked!.id],
    );
    await runInWorkspace(database, fx.sys, (tx) => fx.queue.recoverExpired(tx));
    const terminalExplanation = { reason: 'Worker finished its evaluation.', nextEvent: 'No evaluation remains.' };
    await runInWorkspace(database, fx.sys, async (tx) => {
      await fx.queue.failTerminal(tx, { ...token(terminalFailure!.id), ...terminalExplanation });
      await fx.queue.complete(tx, { ...token(terminalSuccess!.id), ...terminalExplanation });
    });
    const queued = await fx.enqueue(approved.id, '2099-01-01T00:00:00Z');
    const planning = await fx.enqueue(null);
    const otherAction = await fx.propose({
      ...fx.proposalInput,
      id: newId(),
      diff: { ...fx.proposalInput.diff, task: { ...fx.proposalInput.diff.task, id: newId() } },
    });
    const unrelated = await fx.enqueue(otherAction.id);
    const preserved = await runInWorkspace(database, fx.ctx, (tx) => fx.queue.listRecord(tx, { scope: fx.record }));
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    const [result, concurrent] = await Promise.all([fx.execute(input), fx.execute(input)]);
    expect(result).toEqual(concurrent);
    for (const id of [queued.id, leased!.id, blocked!.id]) {
      const settled = await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, id));
      expect(settled).toMatchObject({
        status: 'SUCCEEDED',
        leaseHolder: null,
        leaseExpiresAt: null,
        reason: 'The linked approved crm.task.create action succeeded; its CRM task was created.',
        nextEvent: 'No further queue work is scheduled for this action; the CRM task awaits its normal workflow.',
      });
      expect(settled.finishedAt).not.toBeNull();
      const history = await database.pool.query(
        'SELECT snapshot FROM agentic_task_history WHERE task_id = $1 ORDER BY created_at, id',
        [id],
      );
      expect(history.rows.filter((row) => row.snapshot.status === 'SUCCEEDED')).toHaveLength(1);
      expect(history.rows.at(-1).snapshot).toEqual(settled);
    }
    for (const task of [planning, unrelated, terminalFailure!, terminalSuccess!]) {
      expect(await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, task.id))).toEqual(
        preserved.find((row) => row.id === task.id),
      );
    }
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => fx.queue.complete(tx, { ...token(leased!.id), ...terminalExplanation })),
      'ID_CONFLICT',
    );
    // A delivery that originally succeeded before this queue row existed repairs it through the same owner path.
    const late = await fx.enqueue(approved.id);
    const restarted = fx.restartCapability();
    expect(await runInWorkspace(database, fx.agentCtx, (tx) => restarted.execute(tx, input))).toEqual(result);
    expect((await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, late.id))).status).toBe('SUCCEEDED');
    const before = await database.pool.query('SELECT count(*) FROM agentic_task_history WHERE workspace_id = $1', [
      fx.workspaceId,
    ]);
    await fx.execute(input);
    const after = await database.pool.query('SELECT count(*) FROM agentic_task_history WHERE workspace_id = $1', [
      fx.workspaceId,
    ]);
    expect(after.rows).toEqual(before.rows);
    expect((await domain.tasks.get(fx.ctx, approved.proposal.diff.task.id)).completedAt).toBeNull();
  });

  it('requires persisted current success owned by the executor instead of trusting a queue settlement claim', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const waiting = await fx.enqueue(approved.id);
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    const forged = {
      capability: 'crm.task.create' as const,
      action: { id: approved.id, status: 'SUCCEEDED' as const, version: 4 },
      receipt: {
        id: input.receiptId,
        actionId: approved.id,
        attemptId: input.id,
        proposalDigest: approved.digest,
        outcome: { outcome: 'SUCCEEDED' as const, result: { taskId: approved.proposal.diff.task.id } },
      },
    };
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) => fx.queue.settleSucceededTaskCreate(tx, forged)),
      'ID_CONFLICT',
    );
    expect(await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, waiting.id))).toEqual(waiting);
    const result = await fx.execute(input);
    const late = await fx.enqueue(approved.id);
    for (const claim of [
      { ...forged, action: { ...forged.action, version: 999 } },
      { ...forged, action: { ...forged.action, status: 'APPROVED' as const } },
      { ...forged, receipt: { ...forged.receipt, proposalDigest: '0'.repeat(64) } },
      { ...forged, receipt: { ...forged.receipt, actionId: newId() } },
      {
        ...forged,
        receipt: { ...forged.receipt, outcome: { ...forged.receipt.outcome, result: { taskId: newId() } } },
      },
    ])
      await expectCode(
        runInWorkspace(database, fx.agentCtx, (tx) => fx.queue.settleSucceededTaskCreate(tx, claim)),
        'ID_CONFLICT',
      );
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) => fx.queue.settleSucceededTaskCreate(tx, result)),
      'ID_CONFLICT',
    );
    const other = await collabFixture();
    await expectCode(
      runInWorkspace(database, { ...fx.agentCtx, workspaceId: other.workspaceId }, (tx) =>
        fx.queue.settleSucceededTaskCreate(tx, result),
      ),
      'ID_CONFLICT',
    );
    expect(await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, late.id))).toEqual(late);
    await fx.execute(input);
    expect((await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, late.id))).status).toBe('SUCCEEDED');
  });

  it('commits the linked queue settlement, action receipt and CRM task as one transaction', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const waiting = await fx.enqueue(approved.id);
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    const capability = fx.restartCapability();
    await expect(
      runInWorkspace(database, fx.agentCtx, async (tx) => {
        await capability.execute(tx, input);
        expect((await fx.queue.get(tx, waiting.id)).status).toBe('SUCCEEDED');
        throw new Error('abort-task-capability-transaction');
      }),
    ).rejects.toThrow('abort-task-capability-transaction');
    expect(await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, waiting.id))).toEqual(waiting);
    await expectCode(domain.tasks.get(fx.ctx, approved.proposal.diff.task.id), 'NOT_FOUND');
    const state = await database.pool.query(
      `SELECT a.status,
        (SELECT count(*)::int FROM agentic_action_receipts WHERE action_id = a.id) AS receipts,
        (SELECT count(*)::int FROM agentic_action_attempts WHERE action_id = a.id) AS attempts,
        (SELECT count(*)::int FROM agentic_task_history WHERE task_id = $2) AS queue_history
        FROM agentic_actions a WHERE a.id = $1`,
      [approved.id, waiting.id],
    );
    expect(state.rows).toEqual([{ status: 'APPROVED', receipts: 0, attempts: 0, queue_history: 1 }]);
    await fx.execute(input);
    expect((await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, waiting.id))).status).toBe('SUCCEEDED');
  });

  it('leaves linked queue work unchanged when the approved action becomes stale before execution', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const waiting = await fx.enqueue(approved.id);
    await domain.documents.replaceContent(fx.ctx, {
      id: fx.note.documentId,
      content: { markdown: 'The customer withdrew the request.' },
    });
    expect(
      await fx.execute({
        id: newId(),
        receiptId: newId(),
        actionId: approved.id,
        proposalDigest: approved.digest,
        expectedVersion: approved.version,
      }),
    ).toMatchObject({ action: { status: 'STALE' }, receipt: null });
    expect(await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, waiting.id))).toEqual(waiting);
    await expectCode(domain.tasks.get(fx.ctx, approved.proposal.diff.task.id), 'NOT_FOUND');
  });

  it('executes the approved task through one atomic capability and deduplicates concurrent delivery and restart', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    const results = await Promise.all([fx.execute(input), fx.execute(input)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      capability: 'crm.task.create',
      action: { status: 'SUCCEEDED', version: 4 },
      receipt: {
        id: input.receiptId,
        attemptId: input.id,
        proposalDigest: approved.digest,
        outcome: { outcome: 'SUCCEEDED', result: { taskId: approved.proposal.diff.task.id } },
      },
    });
    const task = await domain.tasks.get(fx.ctx, approved.proposal.diff.task.id);
    expect(task).toMatchObject({
      content: { text: 'Send contract' },
      linkedRecords: [fx.record],
      createdBy: fx.agentCtx.actor,
    });
    const restarted = fx.restartCapability();
    expect((await runInWorkspace(database, fx.agentCtx, (tx) => restarted.execute(tx, input))).receipt).toEqual(
      results[0]!.receipt,
    );
    await expectCode(fx.execute({ ...input, receiptId: newId() }), 'ID_CONFLICT');
    await expectCode(fx.execute({ ...input, id: newId(), expectedVersion: 4 }), 'ID_CONFLICT');
    const rows = await database.pool.query(
      `SELECT to_status FROM agentic_action_history WHERE action_id = $1 ORDER BY to_version`,
      [approved.id],
    );
    expect(rows.rows.map((r) => r.to_status)).toEqual(['PROPOSED', 'APPROVED', 'EXECUTING', 'SUCCEEDED']);
  });

  it('rolls back the task, attempt, history and notifications when receipt insertion fails', async () => {
    const first = await fixture();
    const approved1 = await first.decide(await first.propose());
    const receiptId = newId();
    await first.execute({
      id: newId(),
      receiptId,
      actionId: approved1.id,
      proposalDigest: approved1.digest,
      expectedVersion: approved1.version,
    });
    const fx = await fixture();
    fx.proposalInput.diff.task.assigneeMemberIds = [fx.memberId];
    const approved = await fx.decide(await fx.propose());
    const waiting = await fx.enqueue(approved.id);
    const input = {
      id: newId(),
      receiptId,
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    await expectCode(fx.execute(input), 'ID_CONFLICT');
    expect(await runInWorkspace(database, fx.ctx, (tx) => fx.queue.get(tx, waiting.id))).toEqual(waiting);
    await expectCode(domain.tasks.get(fx.ctx, approved.proposal.diff.task.id), 'NOT_FOUND');
    const status = await database.pool.query('SELECT status FROM agentic_actions WHERE id = $1', [approved.id]);
    expect(status.rows[0].status).toBe('APPROVED');
    const attempts = await database.pool.query('SELECT id FROM agentic_action_attempts WHERE action_id = $1', [
      approved.id,
    ]);
    expect(attempts.rows).toEqual([]);
    const history = await database.pool.query(
      'SELECT to_status FROM agentic_action_history WHERE action_id = $1 ORDER BY to_version',
      [approved.id],
    );
    expect(history.rows.map((r) => r.to_status)).toEqual(['PROPOSED', 'APPROVED']);
    const effects = await database.pool.query(
      `SELECT
      (SELECT count(*)::int FROM notification_entries WHERE workspace_id = $1 AND payload->>'taskId' = $2) AS notifications,
      (SELECT count(*)::int FROM change_log WHERE workspace_id = $1 AND resource_id = $2::uuid) AS invalidations`,
      [fx.workspaceId, approved.proposal.diff.task.id],
    );
    expect(effects.rows[0]).toEqual({ notifications: 0, invalidations: 0 });
    expect((await fx.execute({ ...input, receiptId: newId() })).action.status).toBe('SUCCEEDED');
  });

  it('refuses to claim an identical human task created between dispatch checks and the domain insert', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) =>
        fx.actions.executeTaskCreate(tx, input, async (task) => {
          // Reproduce the task-id race at the executor boundary after startAttempt's freshness check.
          await domain.tasks.create(fx.ctx, task);
          return taskOps.create(tx, { policies: createPolicies(grantResolver(allowAllResolver)) }, task, {
            requireNew: true,
          });
        }),
      ),
      'ID_CONFLICT',
    );
    expect(await domain.tasks.get(fx.ctx, approved.proposal.diff.task.id)).toMatchObject({ createdBy: fx.ctx.actor });
    const rows = await database.pool.query('SELECT status FROM agentic_actions WHERE id = $1', [approved.id]);
    expect(rows.rows[0].status).toBe('APPROVED');
    expect((await fx.execute(input)).action.status).toBe('STALE');
  });

  it('rechecks revoked grants and stale evidence, rejects payload injection and refuses split dispatch recovery', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    await expect(fx.execute({ ...input, task: { content: 'Injected' } } as never)).rejects.toMatchObject({
      name: 'ZodError',
    });
    fx.setGrant({ revokedAt: '2026-01-01T00:00:00Z' });
    await expectCode(fx.execute(input), 'FORBIDDEN');
    fx.setGrant({ revokedAt: null });
    await runInWorkspace(database, fx.agentCtx, (tx) =>
      fx.actions.startAttempt(tx, {
        id: input.id,
        actionId: input.actionId,
        proposalDigest: input.proposalDigest,
        expectedVersion: input.expectedVersion,
      }),
    );
    await expectCode(fx.execute(input), 'ID_CONFLICT');
    await expectCode(domain.tasks.get(fx.ctx, approved.proposal.diff.task.id), 'NOT_FOUND');
    const second = await fixture();
    const approved2 = await second.decide(await second.propose());
    await domain.documents.replaceContent(second.ctx, {
      id: second.note.documentId,
      content: { markdown: 'Changed request' },
    });
    expect(
      await second.execute({
        ...input,
        id: newId(),
        actionId: approved2.id,
        proposalDigest: approved2.digest,
        expectedVersion: approved2.version,
      }),
    ).toMatchObject({ action: { status: 'STALE' }, receipt: null });
  });

  it('captures exact primary evidence and binds immutable proposal contents with a canonical digest', async () => {
    const fx = await fixture();
    expect(fx.captured.snapshot).toMatchObject({
      band: 'VERIFIED',
      scope: fx.record,
      source: { kind: 'crm.note', id: fx.note.id, primary: true, audienceMemberIds: [fx.memberId] },
    });
    const action = await fx.propose();
    expect(action.status).toBe('PROPOSED');
    expect(action.digest).toBe(canonicalDigest(action.proposal));
    expect(await fx.propose()).toEqual(action);
    for (const patch of [
      { capability: 'unknown' },
      { subject: { ...action.proposal.subject, recordVersion: '999' } },
      { diff: { ...action.proposal.diff, task: { ...action.proposal.diff.task, content: { text: 'Different' } } } },
      { evidence: [] },
      { policy: { ...action.proposal.policy, policyVersion: 2 } },
      { proposalVersion: 2 },
    ])
      expect(canonicalDigest({ ...action.proposal, ...patch })).not.toBe(action.digest);
    expect(canonicalDigest({ a: 1, b: { c: 2 } })).toBe(canonicalDigest({ b: { c: 2 }, a: 1 }));
    await expect(
      database.pool.query('UPDATE agentic_action_proposals SET digest = $1 WHERE id = $2', ['0'.repeat(64), action.id]),
    ).rejects.toMatchObject({ code: '23514' });
    const tasks = await database.kysely
      .selectFrom('tasks')
      .select('id')
      .where('workspace_id', '=', fx.workspaceId)
      .execute();
    expect(tasks).toEqual([]);
  });

  it('enforces tenant isolation in service reads, raw RLS, evidence and aggregate foreign keys', async () => {
    const fx = await fixture();
    const other = await collabFixture();
    const action = await fx.propose();
    await expectCode(
      runInWorkspace(database, other.ctx, (tx) => fx.evidence.read(tx, fx.captured.id)),
      'NOT_FOUND',
    );
    await expectCode(
      runInWorkspace(database, other.ctx, (tx) => fx.actions.get(tx, action.id)),
      'NOT_FOUND',
    );
    await expectCode(
      runInWorkspace(database, other.ctx, (tx) =>
        fx.actions.propose(tx, {
          ...fx.proposalInput,
          scope: other.record,
          evidenceIds: [fx.captured.id],
          reviewerMemberId: other.memberId,
          diff: {
            operation: 'create',
            task: { id: newId(), content: { text: 'Cross tenant' }, linkedRecords: [other.record] },
          },
        }),
      ),
      'NOT_FOUND',
    );
    const rows = await runInWorkspace(
      database,
      other.ctx,
      async (tx) => (await sql`SELECT id FROM agentic_actions WHERE id = ${action.id}::uuid`.execute(tx.db)).rows,
    );
    expect(rows).toEqual([]);
    await expect(
      runInWorkspace(database, other.ctx, (tx) =>
        sql`INSERT INTO agentic_action_decisions
      (id, workspace_id, action_id, proposal_digest, outcome, member_id) VALUES
      (${newId()}::uuid, ${other.workspaceId}::uuid, ${action.id}::uuid, ${action.digest}, 'APPROVE', ${other.memberId}::uuid)`.execute(
          tx.db,
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('denies agent self-approval, unassigned reviewers, altered digests, and dispatch without a human decision', async () => {
    const fx = await fixture();
    const action = await fx.propose();
    await expectCode(fx.decide(action, newId(), fx.agentCtx), 'FORBIDDEN');
    const second = await addMember(fx);
    await expectCode(fx.decide(action, newId(), second.ctx), 'FORBIDDEN');
    await expectCode(fx.decide({ ...action, digest: '0'.repeat(64) }), 'ID_CONFLICT');
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) =>
        fx.actions.startAttempt(tx, {
          id: newId(),
          actionId: action.id,
          proposalDigest: action.digest,
          expectedVersion: action.version,
        }),
      ),
      'ID_CONFLICT',
    );
  });

  it('uses CAS, makes concurrent duplicate decisions idempotent, and rejects conflicting decisions', async () => {
    const fx = await fixture();
    const action = await fx.propose();
    const decisionId = newId();
    const results = await Promise.all([fx.decide(action, decisionId), fx.decide(action, decisionId)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: 'APPROVED', version: 2 });
    await expectCode(fx.decide(action), 'ID_CONFLICT');
    await expectCode(fx.decide(action, decisionId, fx.ctx, 'REJECT'), 'ID_CONFLICT');
    const history = await database.pool.query(
      'SELECT to_status FROM agentic_action_history WHERE action_id = $1 ORDER BY to_version',
      [action.id],
    );
    expect(history.rows.map((r) => r.to_status)).toEqual(['PROPOSED', 'APPROVED']);
  });

  it('persists stale state when record or primary source changes before approval or dispatch', async () => {
    for (const mutation of ['source', 'record', 'after-approval'] as const) {
      const fx = await fixture();
      let action = await fx.propose();
      if (mutation === 'after-approval') action = await fx.decide(action);
      if (mutation === 'record') {
        await domain.records.update(fx.ctx, { ...fx.record, values: { name: [{ value: 'Renamed by a person' }] } });
      } else {
        await domain.documents.replaceContent(fx.ctx, {
          id: fx.note.documentId,
          content: { markdown: 'Do not send the contract.' },
        });
      }
      const next =
        mutation === 'after-approval'
          ? (
              await runInWorkspace(database, fx.agentCtx, (tx) =>
                fx.actions.startAttempt(tx, {
                  id: newId(),
                  actionId: action.id,
                  proposalDigest: action.digest,
                  expectedVersion: action.version,
                }),
              )
            ).action
          : await fx.decide(action);
      expect(next.status, mutation).toBe('STALE');
      const stored = await database.pool.query('SELECT status FROM agentic_actions WHERE id = $1', [action.id]);
      expect(stored.rows[0].status).toBe('STALE');
    }
  });

  it('intersects captured source audience with current access and denies grant revocation', async () => {
    const fx = await fixture();
    const action = await fx.propose();
    const laterMember = await addMember(fx);
    await expectCode(
      runInWorkspace(database, laterMember.ctx, (tx) => fx.evidence.read(tx, fx.captured.id)),
      'FORBIDDEN',
    );
    await expectCode(
      runInWorkspace(database, laterMember.ctx, (tx) => fx.actions.get(tx, action.id)),
      'FORBIDDEN',
    );
    fx.setGrant({ revokedAt: '2026-01-01T00:00:00Z' });
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) => fx.evidence.read(tx, fx.captured.id)),
      'FORBIDDEN',
    );
    await domain.permissions.put(fx.ctx, {
      resourceKind: 'object',
      resourceId: fx.companies,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) => fx.evidence.read(tx, fx.captured.id)),
      'FORBIDDEN',
    );
  });

  it('rejects invented quotations and non-primary VERIFIED evidence; rejected claims need new source content', async () => {
    const fx = await fixture();
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) =>
        fx.evidence.capture(tx, {
          ...fx.captureInput,
          id: newId(),
          fragment: { ...fx.captureInput.fragment, quote: 'Invented instruction' },
        }),
      ),
      'VALIDATION_ERROR',
    );
    await runInWorkspace(database, fx.sys, async (tx) => {
      await tx.db
        .updateTable('documents')
        .set({ updated_by: JSON.stringify(fx.sys.actor) })
        .where('workspace_id', '=', fx.workspaceId)
        .where('id', '=', fx.note.documentId)
        .execute();
    });
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) =>
        fx.evidence.capture(tx, {
          ...fx.captureInput,
          id: newId(),
          band: 'VERIFIED',
        }),
      ),
      'FORBIDDEN',
    );
    const rejected = await runInWorkspace(database, fx.ctx, (tx) =>
      fx.evidence.capture(tx, {
        ...fx.captureInput,
        id: newId(),
        band: 'REJECTED',
      }),
    );
    expect(rejected.snapshot.band).toBe('REJECTED');
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) =>
        fx.evidence.capture(tx, {
          ...fx.captureInput,
          id: newId(),
          band: 'PROBABLE',
        }),
      ),
      'ID_CONFLICT',
    );
  });

  it('protects existing human tasks at proposal and dispatch, and rejects field-overwrite diff shapes', async () => {
    const fx = await fixture();
    const action = await fx.propose();
    const approved = await fx.decide(action);
    const task = fx.proposalInput.diff.task;
    await domain.tasks.create(fx.ctx, { ...task, content: { text: 'Human authored task' } });
    await expectCode(fx.propose({ ...fx.proposalInput, id: newId() }), 'FORBIDDEN');
    const started = await runInWorkspace(database, fx.agentCtx, (tx) =>
      fx.actions.startAttempt(tx, {
        id: newId(),
        actionId: action.id,
        proposalDigest: action.digest,
        expectedVersion: approved.version,
      }),
    );
    expect(started).toMatchObject({ action: { status: 'STALE' }, attempt: null });
    expect(started.action).not.toHaveProperty('proposal');
    const saved = await database.kysely
      .selectFrom('tasks')
      .select('content')
      .where('workspace_id', '=', fx.workspaceId)
      .where('id', '=', task.id)
      .executeTakeFirst();
    expect(saved?.content).toBe('Human authored task');
    await expect(
      fx.propose({
        ...fx.proposalInput,
        id: newId(),
        diff: { operation: 'update', field: 'name', value: 'Overwrite' },
      } as never),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('survives service restart, deduplicates attempts and terminal receipts, and never retries an unknown outcome', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const input = {
      id: newId(),
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: approved.version,
    };
    const [a, b] = await Promise.all([
      runInWorkspace(database, fx.agentCtx, (tx) => fx.actions.startAttempt(tx, input)),
      runInWorkspace(database, fx.agentCtx, (tx) => fx.actions.startAttempt(tx, input)),
    ]);
    expect(a).toEqual(b);
    expect(a.action).toMatchObject({ status: 'EXECUTING', version: 3 });
    const restarted = createActionService({
      policy: createAgenticPolicy({ resolver: grantResolver(allowAllResolver) }),
      evidence: fx.evidence,
    });
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) =>
        restarted.startAttempt(tx, { ...input, id: newId(), expectedVersion: 3 }),
      ),
      'ID_CONFLICT',
    );
    const finish: FinishActionAttemptInput = {
      id: newId(),
      attemptId: input.id,
      actionId: approved.id,
      proposalDigest: approved.digest,
      expectedVersion: 3,
      expectedAttemptVersion: 1,
      outcome: { outcome: 'OUTCOME_UNKNOWN', result: { reason: 'executor-disconnected' } },
    };
    const result = await runInWorkspace(database, fx.agentCtx, (tx) => restarted.finishAttempt(tx, finish));
    expect(result.action.status).toBe('OUTCOME_UNKNOWN');
    expect(result.action).not.toHaveProperty('proposal');
    fx.setGrant({ revokedAt: '2026-01-01T00:00:00Z' });
    const replay = await runInWorkspace(database, fx.agentCtx, (tx) => restarted.finishAttempt(tx, finish));
    expect(replay).toEqual(result);
    expect(replay.action).not.toHaveProperty('proposal');
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) => restarted.finishAttempt(tx, { ...finish, id: newId() })),
      'ID_CONFLICT',
    );
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) =>
        restarted.startAttempt(tx, { ...input, id: newId(), expectedVersion: 4 }),
      ),
      'ID_CONFLICT',
    );
    await expect(
      database.pool.query('DELETE FROM agentic_action_receipts WHERE action_id = $1', [approved.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('requires a real exact task result for success and records terminal failure without a task write', async () => {
    const fx = await fixture();
    const approved = await fx.decide(await fx.propose());
    const started = await runInWorkspace(database, fx.agentCtx, (tx) =>
      fx.actions.startAttempt(tx, {
        id: newId(),
        actionId: approved.id,
        proposalDigest: approved.digest,
        expectedVersion: approved.version,
      }),
    );
    const finish: FinishActionAttemptInput = {
      id: newId(),
      actionId: approved.id,
      attemptId: started.attempt!.id,
      proposalDigest: approved.digest,
      expectedVersion: 3,
      expectedAttemptVersion: 1,
      outcome: { outcome: 'SUCCEEDED', result: { taskId: approved.proposal.diff.task.id } },
    };
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) => fx.actions.finishAttempt(tx, finish)),
      'ID_CONFLICT',
    );
    // The existing task domain service, outside the W6 service, supplies the actual CRM effect.
    await domain.tasks.create(fx.ctx, approved.proposal.diff.task);
    const success = await runInWorkspace(database, fx.agentCtx, (tx) => fx.actions.finishAttempt(tx, finish));
    expect(success.action.status).toBe('SUCCEEDED');
    const fx2 = await fixture();
    const approved2 = await fx2.decide(await fx2.propose());
    const started2 = await runInWorkspace(database, fx2.agentCtx, (tx) =>
      fx2.actions.startAttempt(tx, {
        id: newId(),
        actionId: approved2.id,
        proposalDigest: approved2.digest,
        expectedVersion: approved2.version,
      }),
    );
    const failed = await runInWorkspace(database, fx2.agentCtx, (tx) =>
      fx2.actions.finishAttempt(tx, {
        id: newId(),
        actionId: approved2.id,
        attemptId: started2.attempt!.id,
        proposalDigest: approved2.digest,
        expectedVersion: 3,
        expectedAttemptVersion: 1,
        outcome: { outcome: 'FAILED_TERMINAL', result: { code: 'VALIDATION_FAILED', retryable: false } },
      }),
    );
    expect(failed.action.status).toBe('FAILED_TERMINAL');
  });
});
