import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import type { ExecuteTaskCreateResult } from '../src/agentic/actions/contracts.ts';
import { createAgenticPolicy } from '../src/agentic/policy.ts';
import { createRunnerService, runnerAuthoritySource } from '../src/agentic/runners/service.ts';
import { createAgentTaskService } from '../src/agentic/tasks/service.ts';
import { grantResolver } from '../src/permissions/resolver.ts';
import { allowAllResolver } from '../src/permissions.ts';
import { runInWorkspace } from '../src/tx.ts';
import { collabFixture } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

const tasks = createAgentTaskService({ policy: createAgenticPolicy({ resolver: grantResolver(allowAllResolver) }) });

async function fixture() {
  const fx = await collabFixture();
  const calls: unknown[] = [];
  const runners = createRunnerService({
    tasks,
    async executeTaskCreate(tx, input) {
      const principal = await runnerAuthoritySource.principalOf(tx);
      const grant = tx.ctx.agentRuntime ? await runnerAuthoritySource.loadGrant(tx, tx.ctx.agentRuntime.grantId) : null;
      calls.push({ input, runtime: tx.ctx.agentRuntime, principal, grant });
      return { receipt: 'executed' };
    },
  });
  const enrollment = await runInWorkspace(database, fx.ctx, (tx) => runners.createEnrollment(tx));
  const id = newId();
  const profileId = newId();
  const enrolled = await runInWorkspace(database, fx.sys, (tx) =>
    runners.enroll(tx, {
      token: enrollment.token,
      id,
      name: 'Local Codex runner',
      authProfiles: [{ id: profileId, provider: 'codex', label: 'Personal CLI login' }],
    }),
  );
  return { ...fx, runners, calls, enrollment, enrolled, id, profileId };
}

describe('paired agent runners', () => {
  it('uses a single-use enrollment secret, stores only token hashes, and revokes bearer access', async () => {
    const fx = await fixture();
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) =>
        fx.runners.enroll(tx, { token: fx.enrollment.token, id: newId(), name: 'Replay' }),
      ),
      'FORBIDDEN',
    );
    const rows = await database.pool.query(
      `SELECT e.secret_hash, r.bearer_hash, p.provider, p.label FROM agentic_runner_enrollments e
       JOIN agentic_runners r ON r.workspace_id = e.workspace_id AND r.member_id = e.member_id
       JOIN agentic_runner_auth_profiles p ON p.workspace_id = r.workspace_id AND p.runner_id = r.id
       WHERE e.id = $1 AND r.id = $2`,
      [fx.enrollment.id, fx.id],
    );
    expect(rows.rows[0]).toMatchObject({ provider: 'codex', label: 'Personal CLI login' });
    expect(rows.rows[0].secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].bearer_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.rows[0])).not.toContain(fx.enrollment.token);
    expect(JSON.stringify(rows.rows[0])).not.toContain(fx.enrolled.bearerToken);
    expect(
      await runInWorkspace(database, fx.sys, (tx) => fx.runners.authenticate(tx, fx.enrolled.bearerToken)),
    ).toMatchObject({ id: fx.id, workspaceId: fx.workspaceId, memberId: fx.memberId });
    await runInWorkspace(database, fx.ctx, (tx) => fx.runners.revoke(tx, fx.id));
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => fx.runners.authenticate(tx, fx.enrolled.bearerToken)),
      'FORBIDDEN',
    );
  });

  it('binds the MCP grant to the claimed task, action and lease generation', async () => {
    const fx = await fixture();
    const actionId = newId();
    await runInWorkspace(database, fx.sys, async (tx) => {
      await sql`INSERT INTO agentic_action_proposals
        (id, workspace_id, entity_definition_id, entity_instance_id, proposal, digest, created_by)
        VALUES (${actionId}::uuid, ${fx.workspaceId}::uuid, ${fx.record.entityDefinitionId}::uuid,
          ${fx.record.entityInstanceId}::uuid, '{}'::jsonb, ${'0'.repeat(64)},
          ${JSON.stringify(fx.sys.actor)}::jsonb)`.execute(tx.db);
      await sql`INSERT INTO agentic_actions (id, workspace_id, status)
        VALUES (${actionId}::uuid, ${fx.workspaceId}::uuid, 'APPROVED')`.execute(tx.db);
      await tasks.enqueue(tx, {
        id: newId(),
        scope: fx.record,
        moduleId: 'record-follow-up',
        taskType: 'record.follow_up',
        actionId,
        dueAt: '2020-01-01T00:00:00Z',
        reason: 'Approved action is due.',
        nextEvent: 'Runner will dispatch the exact approved task.',
      });
    });
    const claimed = await runInWorkspace(database, fx.sys, (tx) =>
      fx.runners.claim(tx, fx.enrolled.bearerToken, { leaseDurationMs: 60_000, limit: 1 }),
    );
    expect(claimed).toHaveLength(1);
    const { task, grantToken, execution } = claimed[0]!;
    expect(grantToken).toMatch(/^acrm_grant\./);
    expect(execution).toMatchObject({ actionId, proposalDigest: '0'.repeat(64), expectedVersion: 1 });
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) =>
        fx.runners.finish(tx, fx.enrolled.bearerToken, 'complete', {
          taskId: task.id,
          generation: task.leaseGeneration,
          reason: 'Runner claims the write succeeded.',
          nextEvent: 'This must be rejected without an action receipt.',
        }),
      ),
      'ID_CONFLICT',
    );
    const input = execution!;
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) =>
        fx.runners.executeTool(tx, fx.enrolled.bearerToken, grantToken!, { ...input, actionId: newId() }),
      ),
      'FORBIDDEN',
    );
    expect(
      await runInWorkspace(database, fx.sys, (tx) =>
        fx.runners.executeTool(tx, fx.enrolled.bearerToken, grantToken!, input),
      ),
    ).toEqual({ receipt: 'executed' });
    expect(fx.calls).toHaveLength(1);
    expect(fx.calls[0]).toMatchObject({
      runtime: { runnerId: fx.id },
      principal: { type: 'agent', id: fx.id },
      grant: {
        workspaceId: fx.workspaceId,
        agentId: fx.id,
        capabilities: ['crm.task.create', 'agentic.action.propose'],
        scope: fx.record,
      },
    });

    await runInWorkspace(database, fx.sys, (tx) =>
      fx.runners.finish(tx, fx.enrolled.bearerToken, 'release', {
        taskId: task.id,
        generation: task.leaseGeneration,
        reason: 'Runner stopped before dispatch.',
        nextEvent: 'Another runner can claim this task.',
      }),
    );
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => fx.runners.executeTool(tx, fx.enrolled.bearerToken, grantToken!, input)),
      'FORBIDDEN',
    );
    expect(fx.calls).toHaveLength(1);
  });

  it('does not authorize a token under another workspace context', async () => {
    const fx = await fixture();
    const another = await collabFixture();
    await expectCode(
      runInWorkspace(database, another.sys, (tx) => fx.runners.authenticate(tx, fx.enrolled.bearerToken)),
      'FORBIDDEN',
    );
  });

  it('executes an approved action through the composed domain runner grant and settles its queue', async () => {
    const fx = await collabFixture();
    const note = await domain.notes.create(fx.ctx, {
      id: newId(),
      title: 'Customer follow-up',
      parentRecords: [fx.record],
    });
    const text = 'Please send a follow-up tomorrow.';
    await domain.documents.replaceContent(fx.ctx, { id: note.documentId, content: { markdown: text } });
    const evidence = await domain.agentic.evidence.capture(fx.ctx, {
      id: newId(),
      scope: fx.record,
      source: { kind: 'crm.note', id: note.id },
      band: 'VERIFIED',
      claim: 'The customer asked for a follow-up.',
      fragment: { start: 0, end: text.length, quote: text },
    });
    const action = await domain.agentic.actions.propose(fx.ctx, {
      id: newId(),
      scope: fx.record,
      diff: {
        operation: 'create',
        task: {
          id: newId(),
          content: { text: 'Send follow-up' },
          linkedRecords: [fx.record],
        },
      },
      evidenceIds: [evidence.id],
      reviewerMemberId: fx.memberId,
    });
    await domain.agentic.actions.decide(fx.ctx, {
      id: newId(),
      actionId: action.id,
      proposalDigest: action.digest,
      expectedVersion: action.version,
      outcome: 'APPROVE',
    });
    const queued = await domain.agentic.tasks.enqueue(fx.sys, {
      id: newId(),
      scope: fx.record,
      moduleId: 'record-follow-up',
      taskType: 'record.follow_up',
      actionId: action.id,
      dueAt: '2020-01-01T00:00:00Z',
      reason: 'Approved follow-up is due.',
      nextEvent: 'A paired runner may dispatch it.',
    });
    const enrollment = await domain.agentic.runners.createEnrollment(fx.ctx);
    const runner = await domain.agentic.runners.enroll(fx.sys, {
      token: enrollment.token,
      id: newId(),
      name: 'Runtime integration runner',
    });
    const [claimed] = await domain.agentic.runners.claim(fx.sys, runner.bearerToken, {
      leaseDurationMs: 60_000,
      limit: 1,
    });
    expect(claimed?.execution).toMatchObject({ actionId: action.id, proposalDigest: action.digest });
    const result = (await domain.agentic.runners.executeTool(
      fx.sys,
      runner.bearerToken,
      claimed!.grantToken!,
      claimed!.execution!,
    )) as ExecuteTaskCreateResult;
    expect(result.action.status).toBe('SUCCEEDED');
    expect(result.receipt?.id).toBe(claimed!.execution!.receiptId);
    expect(await domain.agentic.tasks.get(fx.ctx, queued.id)).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      await domain.agentic.runners.executeTool(fx.sys, runner.bearerToken, claimed!.grantToken!, claimed!.execution!),
    ).toEqual(result);
    const receipts = await database.pool.query(
      'SELECT id FROM agentic_action_receipts WHERE workspace_id = $1 AND action_id = $2',
      [fx.workspaceId, action.id],
    );
    expect(receipts.rows).toHaveLength(1);
  });
});
