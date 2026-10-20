import { describe, expect, it } from 'vitest';
import { createAgenticPolicy } from '../src/agentic/policy.ts';
import { createAgentTaskService } from '../src/agentic/tasks/service.ts';
import { createDomain } from '../src/index.ts';
import { grantResolver } from '../src/permissions/resolver.ts';
import { allowAllResolver } from '../src/permissions.ts';
import { runInWorkspace } from '../src/tx.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

async function fixture() {
  const fx = await collabFixture();
  const quote = 'Please send the contract tomorrow.';
  const note = await domain.notes.create(fx.ctx, { id: newId(), title: 'Request', parentRecords: [fx.record] });
  await domain.documents.replaceContent(fx.ctx, { id: note.documentId, content: { markdown: quote } });
  const evidence = await domain.agentic.evidence.capture(fx.ctx, {
    id: newId(),
    scope: fx.record,
    source: { kind: 'crm.note', id: note.id },
    band: 'VERIFIED',
    claim: 'Send contract',
    fragment: { start: 0, end: quote.length, quote },
  });
  const propose = () =>
    domain.agentic.actions.propose(fx.ctx, {
      id: newId(),
      scope: fx.record,
      diff: {
        operation: 'create',
        task: { id: newId(), content: { text: 'Send contract' }, linkedRecords: [fx.record] },
      },
      evidenceIds: [evidence.id],
      reviewerMemberId: fx.memberId,
    });
  const action = await propose();
  const queue = createAgentTaskService({ policy: createAgenticPolicy({ resolver: grantResolver(allowAllResolver) }) });
  const task = await runInWorkspace(database, fx.sys, (tx) =>
    queue.enqueue(tx, {
      id: newId(),
      scope: fx.record,
      actionId: action.id,
      moduleId: 'record-follow-up',
      taskType: 'record.follow_up',
      dueAt: '2099-01-01T00:00:00Z',
      reason: 'Waiting for review.',
      nextEvent: 'Recheck the persisted decision.',
    }),
  );
  return { ...fx, quote, note, evidence, action, task, propose };
}

describe('record-scoped persisted agent activity', () => {
  it('reads exact proposal, evidence, persisted timestamps and real queue state across restart', async () => {
    const fx = await fixture();
    const second = await fx.propose();
    const restarted = createDomain({ database });
    const state = await restarted.agentic.recordState(fx.ctx, { scope: fx.record });
    expect(state.scope).toEqual(fx.record);
    expect(state.unavailableActionCount).toBe(0);
    expect(state.actions.map((entry) => entry.action)).toEqual([second, fx.action]);
    expect(state.actions[0]).toMatchObject({ evidence: [fx.evidence], receipt: null });
    const stamps = await database.pool.query('SELECT created_at::text FROM agentic_action_proposals WHERE id = $1', [
      second.id,
    ]);
    expect(Date.parse(state.actions[0]!.proposedAt)).toBe(Date.parse(stamps.rows[0].created_at));
    expect(state.tasks).toEqual([fx.task]);
    expect(await restarted.agentic.tasks.get(fx.ctx, fx.task.id)).toEqual(fx.task);
    expect(await restarted.agentic.tasks.listRecord(fx.ctx, { scope: fx.record })).toEqual([fx.task]);
    expect((await restarted.agentic.recordState(fx.ctx, { scope: fx.record, limit: 1 })).actions).toHaveLength(1);
    expect(
      await restarted.agentic.recordState(fx.ctx, {
        scope: { entityDefinitionId: fx.people, entityInstanceId: fx.person },
      }),
    ).toMatchObject({ actions: [], tasks: [] });
    const before = await database.pool.query('SELECT count(*) FROM change_log WHERE workspace_id = $1', [
      fx.workspaceId,
    ]);
    await restarted.agentic.recordState(fx.ctx, { scope: fx.record });
    const after = await database.pool.query('SELECT count(*) FROM change_log WHERE workspace_id = $1', [
      fx.workspaceId,
    ]);
    expect(after.rows).toEqual(before.rows);
  });

  it('projects a real terminal receipt with its database timestamp and exact task effect', async () => {
    const fx = await fixture();
    const approved = await domain.agentic.actions.decide(fx.ctx, {
      id: newId(),
      actionId: fx.action.id,
      proposalDigest: fx.action.digest,
      expectedVersion: fx.action.version,
      outcome: 'APPROVE',
    });
    const execution = await domain.agentic.taskCreate.execute(fx.ctx, {
      id: newId(),
      receiptId: newId(),
      actionId: fx.action.id,
      proposalDigest: fx.action.digest,
      expectedVersion: approved.version,
    });
    const state = await domain.agentic.recordState(fx.ctx, { scope: fx.record });
    const row = state.actions[0]!;
    expect(row.action).toEqual({ ...fx.action, ...execution.action });
    expect(row.receipt).toMatchObject(execution.receipt!);
    const stamps = await database.pool.query('SELECT created_at::text FROM agentic_action_receipts WHERE id = $1', [
      execution.receipt!.id,
    ]);
    expect(Date.parse(row.receipt!.createdAt)).toBe(Date.parse(stamps.rows[0].created_at));
    expect(await domain.tasks.get(fx.ctx, fx.action.proposal.diff.task.id)).toMatchObject({
      content: { text: 'Send contract' },
    });
  });

  it.each(['edited', 'deleted', 'different audience'] as const)(
    'withholds source-derived snapshots when the source is %s while retaining queue explanations',
    async (change) => {
      const fx = await fixture();
      let reader = fx.ctx;
      if (change === 'edited') {
        await domain.documents.replaceContent(fx.ctx, {
          id: fx.note.documentId,
          content: { markdown: 'Request revoked.' },
        });
      } else if (change === 'deleted') {
        await domain.notes.delete(fx.ctx, fx.note.id);
      } else {
        reader = (await addMember(fx)).ctx;
      }
      const state = await domain.agentic.recordState(reader, { scope: fx.record });
      expect(state.actions).toEqual([]);
      expect(state.unavailableActionCount).toBe(1);
      expect(state.tasks).toEqual([fx.task]);
      expect(JSON.stringify(state)).not.toContain(fx.quote);
      expect(JSON.stringify(state)).not.toContain('Send contract');
    },
  );

  it('enforces live record policy and tenant isolation before returning any activity', async () => {
    const fx = await fixture();
    const other = await collabFixture();
    await expectCode(domain.agentic.recordState(other.ctx, { scope: fx.record }), 'FORBIDDEN');
    await expectCode(domain.agentic.tasks.get(other.ctx, fx.task.id), 'NOT_FOUND');
    await domain.permissions.put(fx.ctx, {
      resourceKind: 'object',
      resourceId: fx.companies,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    await expectCode(domain.agentic.recordState(fx.ctx, { scope: fx.record }), 'FORBIDDEN');
  });
});
