import { describe, expect, it } from 'vitest';
import { createAgenticPolicy } from '../src/agentic/policy.ts';
import { createAgentTaskService } from '../src/agentic/tasks/service.ts';
import { grantResolver } from '../src/permissions/resolver.ts';
import { allowAllResolver } from '../src/permissions.ts';
import { runInWorkspace } from '../src/tx.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { createWorkspace, database, domain, expectCode, newId } from './support/harness.ts';

const queue = createAgentTaskService({ policy: createAgenticPolicy({ resolver: grantResolver(allowAllResolver) }) });

describe('workspace product modules', () => {
  it('starts enabled, allows only an admin to toggle, and isolates workspaces', async () => {
    const first = await createWorkspace();
    const second = await createWorkspace();
    const member = await addMember(first);
    expect(await domain.productModules.list(first.ctx)).toMatchObject([
      { module: { id: 'record-follow-up' }, enabled: true },
    ]);
    await expectCode(domain.productModules.list(member.ctx), 'FORBIDDEN', 403);
    await expectCode(
      domain.productModules.update(member.ctx, { moduleId: 'record-follow-up', enabled: false }),
      'FORBIDDEN',
      403,
    );
    await expectCode(
      domain.productModules.update(first.sys, { moduleId: 'record-follow-up', enabled: false }),
      'FORBIDDEN',
      403,
    );
    expect(
      await domain.productModules.update(first.ctx, { moduleId: 'record-follow-up', enabled: false }),
    ).toMatchObject({ enabled: false });
    expect((await domain.productModules.list(first.ctx))[0]?.enabled).toBe(false);
    expect((await domain.productModules.list(second.ctx))[0]?.enabled).toBe(true);
    const stored = await database.kysely
      .selectFrom('workspace_product_modules')
      .select(['workspace_id', 'enabled'])
      .where('module_id', '=', 'record-follow-up')
      .where('workspace_id', 'in', [first.workspaceId, second.workspaceId])
      .execute();
    expect(stored).toHaveLength(2);
    expect(stored.find((row) => row.workspace_id === first.workspaceId)?.enabled).toBe(false);
    await domain.productModules.update(first.ctx, { moduleId: 'record-follow-up', enabled: true });
    expect((await domain.productModules.list(first.ctx))[0]?.enabled).toBe(true);
  });

  it('keeps queued history but prevents enqueue, claim, and dispatch after disable', async () => {
    const fx = await collabFixture();
    const input = {
      id: newId(),
      scope: fx.record,
      moduleId: 'record-follow-up' as const,
      taskType: 'record.follow_up' as const,
      dueAt: '2020-01-01T00:00:00Z',
      reason: 'Follow-up due.',
      nextEvent: 'Worker will inspect the record.',
    };
    const queued = await runInWorkspace(database, fx.sys, (tx) => queue.enqueue(tx, input));
    const [leased] = await runInWorkspace(database, fx.sys, (tx) =>
      queue.claimDue(tx, { holder: 'worker', leaseDurationMs: 60_000 }),
    );
    expect(leased?.id).toBe(queued.id);
    await domain.productModules.update(fx.ctx, { moduleId: 'record-follow-up', enabled: false });
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => queue.enqueue(tx, { ...input, id: newId() })),
      'FORBIDDEN',
      403,
    );
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) =>
        queue.assertLease(tx, {
          taskId: leased!.id,
          holder: 'worker',
          generation: leased!.leaseGeneration,
        }),
      ),
      'FORBIDDEN',
      403,
    );
    await expectCode(
      domain.agentic.taskCreate.execute(fx.sys, {
        id: newId(),
        actionId: newId(),
        proposalDigest: '0'.repeat(64),
        expectedVersion: 1,
        receiptId: newId(),
      }),
      'FORBIDDEN',
      403,
    );
    expect(
      await runInWorkspace(database, fx.sys, (tx) =>
        queue.claimDue(tx, { holder: 'worker-2', leaseDurationMs: 60_000 }),
      ),
    ).toEqual([]);
    expect((await domain.agentic.tasks.get(fx.ctx, queued.id)).status).toBe('LEASED');
    const history = await database.pool.query(
      'SELECT count(*) FROM agentic_task_history WHERE workspace_id = $1 AND task_id = $2',
      [fx.workspaceId, queued.id],
    );
    expect(Number(history.rows[0].count)).toBe(2);
  });
});
