import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { createAgenticPolicy } from '../src/agentic/policy.ts';
import type { AgentTask, EnqueueAgentTaskInput } from '../src/agentic/tasks/contracts.ts';
import { createAgentTaskService } from '../src/agentic/tasks/service.ts';
import { grantResolver } from '../src/permissions/resolver.ts';
import { allowAllResolver } from '../src/permissions.ts';
import { runInWorkspace } from '../src/tx.ts';
import { collabFixture } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

const service = () =>
  createAgentTaskService({ policy: createAgenticPolicy({ resolver: grantResolver(allowAllResolver) }) });
const queue = service();
const lease = (task: AgentTask) => ({
  taskId: task.id,
  holder: task.leaseHolder!,
  generation: task.leaseGeneration,
});
const explanation = { reason: 'Follow-up evaluation finished.', nextEvent: 'No further work is scheduled.' };

async function fixture() {
  const fx = await collabFixture();
  const input: EnqueueAgentTaskInput = {
    id: newId(),
    scope: fx.record,
    moduleId: 'record-follow-up',
    taskType: 'record.follow_up',
    dueAt: '2020-01-01T00:00:00Z',
    reason: 'A record needs follow-up evaluation.',
    nextEvent: 'A worker will evaluate the record when due.',
  };
  const enqueue = (value = input) => runInWorkspace(database, fx.sys, (tx) => queue.enqueue(tx, value));
  const claim = (holder = 'worker-a', limit = 1) =>
    runInWorkspace(database, fx.sys, (tx) => queue.claimDue(tx, { holder, limit, leaseDurationMs: 60_000 }));
  const get = (id = input.id) => runInWorkspace(database, fx.ctx, (tx) => queue.get(tx, id));
  const expire = async (id = input.id) => {
    await database.pool.query(
      "UPDATE agentic_tasks SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE workspace_id = $1 AND id = $2",
      [fx.workspaceId, id],
    );
  };
  // Storage-only action fixtures: queue recovery must never inspect a proposal, authorize, or mutate the action.
  const linkedAction = async (status: 'PROPOSED' | 'EXECUTING' | 'OUTCOME_UNKNOWN' = 'EXECUTING') => {
    const id = newId();
    await runInWorkspace(database, fx.sys, async (tx) => {
      await sql`INSERT INTO agentic_action_proposals
        (id, workspace_id, entity_definition_id, entity_instance_id, proposal, digest, created_by)
        VALUES (${id}::uuid, ${fx.workspaceId}::uuid, ${fx.record.entityDefinitionId}::uuid,
          ${fx.record.entityInstanceId}::uuid, '{}'::jsonb, ${'0'.repeat(64)}, ${JSON.stringify(fx.sys.actor)}::jsonb)`.execute(
        tx.db,
      );
      await sql`INSERT INTO agentic_actions (id, workspace_id, status)
        VALUES (${id}::uuid, ${fx.workspaceId}::uuid, ${status})`.execute(tx.db);
    });
    return id;
  };
  return { ...fx, input, enqueue, claim, get, expire, linkedAction };
}

describe('explainable leased record-follow-up queue', () => {
  it('enqueues idempotently under concurrency, preserves state on replay, and rejects changed identity', async () => {
    const fx = await fixture();
    const [a, b] = await Promise.all([fx.enqueue(), fx.enqueue()]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      status: 'QUEUED',
      reason: fx.input.reason,
      nextEvent: fx.input.nextEvent,
      leaseGeneration: '0',
      attemptCount: 0,
      leaseHolder: null,
      leaseExpiresAt: null,
      finishedAt: null,
    });
    const [claimed] = await fx.claim();
    expect(await fx.enqueue()).toEqual(claimed);
    await expectCode(fx.enqueue({ ...fx.input, reason: 'Different request with the same id.' }), 'ID_CONFLICT');
    const count = await database.pool.query('SELECT count(*) FROM agentic_task_history WHERE task_id = $1', [a.id]);
    expect(count.rows[0].count).toBe('2');
  });

  it('claims due work once across concurrent workers and leaves future work waiting', async () => {
    const fx = await fixture();
    const inputs = Array.from({ length: 4 }, () => ({ ...fx.input, id: newId() }));
    await Promise.all(inputs.map(fx.enqueue));
    const future = await fx.enqueue({ ...fx.input, id: newId(), dueAt: '2099-01-01T00:00:00Z' });
    const claimed = (await Promise.all(inputs.map((_, i) => fx.claim(`worker-${i}`)))).flat();
    expect(new Set(claimed.map((task) => task.id)).size).toBe(4);
    expect(claimed.map((task) => task.id).sort()).toEqual(inputs.map((input) => input.id).sort());
    expect(claimed.every((task) => task.attemptCount === 1 && task.leaseGeneration === '1')).toBe(true);
    expect(await fx.claim()).toEqual([]);
    expect((await fx.get(future.id)).status).toBe('QUEUED');
  });

  it('skips an uncommitted claim instead of waiting behind its row lock', async () => {
    const fx = await fixture();
    await fx.enqueue();
    await fx.enqueue({ ...fx.input, id: newId() });
    let selected!: (task: AgentTask) => void;
    let unlock!: () => void;
    const selection = new Promise<AgentTask>((resolve) => {
      selected = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const first = runInWorkspace(database, fx.sys, async (tx) => {
      const [task] = await queue.claimDue(tx, { holder: 'holding-worker', leaseDurationMs: 60_000 });
      selected(task!);
      await gate;
      return task!;
    });
    const locked = await selection;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const second = await Promise.race([
        fx.claim('other-worker'),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Claim waited for a locked task')), 2000);
        }),
      ]);
      expect(second).toHaveLength(1);
      expect(second[0]!.id).not.toBe(locked.id);
    } finally {
      clearTimeout(timer);
      unlock();
      await first;
    }
  });

  it('rolls back an interrupted claim with its attempt count, history, and invalidation', async () => {
    const fx = await fixture();
    const initial = await fx.enqueue();
    const before = await database.pool.query('SELECT count(*) FROM change_log WHERE workspace_id = $1', [
      fx.workspaceId,
    ]);
    await expect(
      runInWorkspace(database, fx.sys, async (tx) => {
        const [claimed] = await queue.claimDue(tx, { holder: 'crashed-before-commit', leaseDurationMs: 60_000 });
        expect(claimed!.status).toBe('LEASED');
        throw new Error('crash-before-commit');
      }),
    ).rejects.toThrow('crash-before-commit');
    expect(await fx.get()).toEqual(initial);
    const history = await database.pool.query('SELECT count(*) FROM agentic_task_history WHERE task_id = $1', [
      initial.id,
    ]);
    expect(history.rows[0].count).toBe('1');
    const after = await database.pool.query('SELECT count(*) FROM change_log WHERE workspace_id = $1', [
      fx.workspaceId,
    ]);
    expect(after.rows).toEqual(before.rows);
    expect((await fx.claim())[0]).toMatchObject({ id: initial.id, attemptCount: 1, leaseGeneration: '1' });
  });

  it('rejects a lease that expires while waiting for an unchanged row lock', async () => {
    const fx = await fixture();
    await fx.enqueue();
    const [claimed] = await runInWorkspace(database, fx.sys, (tx) =>
      queue.claimDue(tx, {
        holder: 'short-lease',
        leaseDurationMs: 200,
      }),
    );
    let locked!: () => void;
    let unlock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locker = runInWorkspace(database, fx.sys, async (tx) => {
      await sql`SELECT id FROM agentic_tasks WHERE workspace_id = ${fx.workspaceId}::uuid AND id = ${claimed!.id}::uuid FOR UPDATE`.execute(
        tx.db,
      );
      locked();
      await gate;
    });
    await lockAcquired;
    const settling = expectCode(
      runInWorkspace(database, fx.sys, (tx) =>
        queue.complete(tx, {
          ...lease(claimed!),
          ...explanation,
        }),
      ),
      'ID_CONFLICT',
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      unlock();
      await locker;
    }
    await settling;
    expect((await fx.get()).status).toBe('LEASED');
  });

  it('fences every worker transition by holder, generation, current state, and database lease time', async () => {
    const fx = await fixture();
    await fx.enqueue();
    const [first] = await fx.claim();
    const token = lease(first!);
    const finish = { ...token, ...explanation };
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => queue.complete(tx, { ...finish, holder: 'wrong-worker' })),
      'ID_CONFLICT',
    );
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => queue.complete(tx, { ...finish, generation: '999' })),
      'ID_CONFLICT',
    );
    await fx.expire();
    for (const operation of [
      (tx: Parameters<typeof queue.complete>[0]) => queue.complete(tx, finish),
      (tx: Parameters<typeof queue.complete>[0]) => queue.failTerminal(tx, finish),
      (tx: Parameters<typeof queue.complete>[0]) => queue.release(tx, finish),
      (tx: Parameters<typeof queue.complete>[0]) => queue.scheduleRecheck(tx, { ...finish, dueAt: fx.input.dueAt }),
      (tx: Parameters<typeof queue.complete>[0]) => queue.assertLease(tx, token),
    ])
      await expectCode(runInWorkspace<unknown>(database, fx.sys, operation), 'ID_CONFLICT');
    await runInWorkspace(database, fx.sys, (tx) => queue.recoverExpired(tx));
    const [second] = await fx.claim();
    expect(BigInt(second!.leaseGeneration)).toBeGreaterThan(BigInt(first!.leaseGeneration));
    expect(second!.attemptCount).toBe(2);
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => queue.complete(tx, finish)),
      'ID_CONFLICT',
    );
    await runInWorkspace(database, fx.sys, (tx) => queue.assertLease(tx, lease(second!)));
    const completed = await runInWorkspace(database, fx.sys, (tx) =>
      queue.complete(tx, { ...lease(second!), ...explanation }),
    );
    expect(completed).toMatchObject({ status: 'SUCCEEDED', ...explanation, leaseHolder: null, leaseExpiresAt: null });
    expect(completed.finishedAt).not.toBeNull();
    await expectCode(
      runInWorkspace(database, fx.sys, (tx) => queue.release(tx, { ...lease(second!), ...explanation })),
      'ID_CONFLICT',
    );
  });

  it('recovers effect-free work after restart while preserving monotonic bigint fencing tokens', async () => {
    const fx = await fixture();
    await fx.enqueue();
    await database.pool.query('UPDATE agentic_tasks SET lease_generation = $1 WHERE workspace_id = $2 AND id = $3', [
      '9007199254740992',
      fx.workspaceId,
      fx.input.id,
    ]);
    const [first] = await fx.claim();
    expect(first!.leaseGeneration).toBe('9007199254740993');
    await fx.expire();
    const restarted = service();
    const [recovered] = await runInWorkspace(database, fx.sys, (tx) => restarted.recoverExpired(tx));
    expect(recovered).toMatchObject({
      status: 'QUEUED',
      leaseGeneration: '9007199254740994',
      attemptCount: 1,
      reason: 'Worker lease expired before completing effect-free follow-up planning.',
      nextEvent: 'Another worker may claim the follow-up planning task.',
    });
    expect(await runInWorkspace(database, fx.sys, (tx) => restarted.recoverExpired(tx))).toEqual([]);
    const [next] = await runInWorkspace(database, fx.sys, (tx) =>
      restarted.claimDue(tx, { holder: 'after-restart', leaseDurationMs: 60_000 }),
    );
    expect(next).toMatchObject({ id: first!.id, leaseGeneration: '9007199254740995', attemptCount: 2 });
  });

  it('blocks expired linked-action work without retrying or changing the action business outcome', async () => {
    const fx = await fixture();
    for (const status of ['PROPOSED', 'EXECUTING', 'OUTCOME_UNKNOWN'] as const) {
      const actionId = await fx.linkedAction(status);
      const task = await fx.enqueue({ ...fx.input, id: newId(), actionId });
      await fx.claim();
      await fx.expire(task.id);
      const [blocked] = await runInWorkspace(database, fx.sys, (tx) => queue.recoverExpired(tx));
      expect(blocked).toMatchObject({ id: task.id, actionId, status: 'BLOCKED', attemptCount: 1 });
      expect(blocked!.reason).toContain('reconciliation');
      expect(blocked!.nextEvent).toContain('automatic retry is blocked');
      expect(await fx.claim()).toEqual([]);
      const action = await database.pool.query(
        'SELECT status, version FROM agentic_actions WHERE workspace_id = $1 AND id = $2',
        [fx.workspaceId, actionId],
      );
      expect(action.rows).toEqual([{ status, version: 1 }]);
    }
  });

  it('persists the caller recheck explanation and due time across restart, release, and terminal failure', async () => {
    const fx = await fixture();
    await fx.enqueue();
    const [first] = await fx.claim();
    const recheck = {
      ...lease(first!),
      dueAt: '2099-01-01T12:30:00Z',
      reason: 'Waiting for the assigned reviewer to respond.',
      nextEvent: 'Recheck the decision after the review window closes.',
    };
    const scheduled = await runInWorkspace(database, fx.sys, (tx) => queue.scheduleRecheck(tx, recheck));
    expect(scheduled).toMatchObject({ status: 'QUEUED', reason: recheck.reason, nextEvent: recheck.nextEvent });
    expect(Date.parse(scheduled.dueAt)).toBe(Date.parse(recheck.dueAt));
    expect(await fx.claim()).toEqual([]);
    expect(await runInWorkspace(database, fx.ctx, (tx) => service().get(tx, first!.id))).toEqual(scheduled);
    const listed = await runInWorkspace(database, fx.ctx, (tx) => queue.listRecord(tx, { scope: fx.record }));
    expect(listed).toEqual([scheduled]);
    const secondTask = await fx.enqueue({ ...fx.input, id: newId() });
    const [second] = await fx.claim();
    const released = await runInWorkspace(database, fx.sys, (tx) =>
      queue.release(tx, {
        ...lease(second!),
        reason: 'Worker is shutting down.',
        nextEvent: 'Another worker may claim it.',
      }),
    );
    expect(released).toMatchObject({ id: secondTask.id, status: 'QUEUED', attemptCount: 1, leaseHolder: null });
    const [reclaimed] = await fx.claim();
    const failed = await runInWorkspace(database, fx.sys, (tx) =>
      queue.failTerminal(tx, { ...lease(reclaimed!), ...explanation }),
    );
    expect(failed.status).toBe('FAILED_TERMINAL');
    expect(failed.finishedAt).not.toBeNull();
    expect(await fx.claim()).toEqual([]);
    const history = await database.pool.query(
      'SELECT snapshot FROM agentic_task_history WHERE workspace_id = $1 AND task_id = $2 ORDER BY created_at, id',
      [fx.workspaceId, first!.id],
    );
    expect(history.rows.map((row) => row.snapshot.status)).toEqual(['QUEUED', 'LEASED', 'QUEUED']);
    expect(history.rows[2].snapshot.reason).toBe(recheck.reason);
    await expect(
      database.pool.query('DELETE FROM agentic_task_history WHERE task_id = $1', [first!.id]),
    ).rejects.toMatchObject({ code: '23514' });
    const changes = await database.pool.query(
      'SELECT scope FROM change_log WHERE workspace_id = $1 AND resource = $2',
      [fx.workspaceId, 'record-timeline'],
    );
    expect(changes.rows.some((row) => row.scope.entityInstanceIds.includes(fx.record.entityInstanceId))).toBe(true);
  });

  it('isolates tenants in reads, claims, mutations, RLS, record scope, and linked-action references', async () => {
    const fx = await fixture();
    const other = await fixture();
    const task = await fx.enqueue();
    expect(await other.claim()).toEqual([]);
    await expectCode(
      runInWorkspace(database, other.ctx, (tx) => queue.get(tx, task.id)),
      'NOT_FOUND',
    );
    expect(await runInWorkspace(database, other.sys, (tx) => queue.listRecord(tx, { scope: fx.record }))).toEqual([]);
    const raw = await runInWorkspace(database, other.sys, (tx) =>
      sql<{ id: string }>`SELECT id FROM agentic_tasks`.execute(tx.db),
    );
    expect(raw.rows.some((row) => row.id === task.id)).toBe(false);
    await expectCode(other.enqueue({ ...other.input, scope: fx.record }), 'NOT_FOUND');
    const actionId = await fx.linkedAction();
    await expectCode(other.enqueue({ ...other.input, actionId }), 'NOT_FOUND');
    const otherTask = await other.enqueue();
    await expect(
      runInWorkspace(database, other.sys, (tx) =>
        sql`UPDATE agentic_tasks SET action_id = ${actionId}::uuid
      WHERE workspace_id = ${other.workspaceId}::uuid AND id = ${otherTask.id}::uuid`.execute(tx.db),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const [claimed] = await fx.claim();
    await expectCode(
      runInWorkspace(database, other.sys, (tx) => queue.complete(tx, { ...lease(claimed!), ...explanation })),
      'ID_CONFLICT',
    );
  });

  it('denies untrusted scheduling and unauthorized record reads, and rejects unknown task types and invalid explanations', async () => {
    const fx = await fixture();
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) => queue.enqueue(tx, fx.input)),
      'FORBIDDEN',
    );
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) => queue.claimDue(tx, { holder: 'human', leaseDurationMs: 1000 })),
      'FORBIDDEN',
    );
    await expect(fx.enqueue({ ...fx.input, moduleId: 'unknown' } as never)).rejects.toMatchObject({ name: 'ZodError' });
    await expect(fx.enqueue({ ...fx.input, taskType: 'unknown' } as never)).rejects.toMatchObject({ name: 'ZodError' });
    await expect(fx.enqueue({ ...fx.input, reason: '   ' })).rejects.toMatchObject({ name: 'ZodError' });
    await fx.enqueue();
    await domain.permissions.put(fx.ctx, {
      resourceKind: 'object',
      resourceId: fx.companies,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    await expectCode(fx.get(), 'FORBIDDEN');
    await expectCode(
      runInWorkspace(database, fx.ctx, (tx) => queue.listRecord(tx, { scope: fx.record })),
      'FORBIDDEN',
    );
  });
});
