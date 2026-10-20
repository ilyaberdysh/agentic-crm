// Transactional enqueue (ARCHITECTURE D-10, I1): a job sent inside a domain transaction exists only if the
// transaction commits. Uses a real pg-boss producer on the suite database.
import { sql } from '@agentic-crm/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createJobProducer } from '../src/jobs/queue.ts';
import { runInWorkspace } from '../src/tx.ts';
import { databaseUrl } from './support/env.ts';
import { createWorkspace, database } from './support/harness.ts';

const producer = createJobProducer({ connectionString: databaseUrl() });

afterAll(async () => {
  await producer.stop();
});

async function count(key: string): Promise<number> {
  const { rows } = await database.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM pgboss.job WHERE singleton_key = $1',
    [key],
  );
  return rows[0]?.n ?? 0;
}

describe('job queue', () => {
  it('enqueues with the transaction: committed jobs exist, rolled-back ones do not', async () => {
    const ws = await createWorkspace();
    const committed = `commit-${Date.now()}`;
    const id = await runInWorkspace(database, ws.ctx, (tx) =>
      producer.queue.send(
        tx,
        'export.run',
        { workspaceId: ws.workspaceId, exportId: committed },
        { singletonKey: committed },
      ),
    );
    expect(id).toEqual(expect.any(String));
    expect(await count(committed)).toBe(1);

    const rolledBack = `rollback-${Date.now()}`;
    await expect(
      runInWorkspace(database, ws.ctx, async (tx) => {
        await producer.queue.send(
          tx,
          'import.run',
          { workspaceId: ws.workspaceId, jobId: rolledBack },
          { singletonKey: rolledBack },
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await count(rolledBack)).toBe(0);

    // The transaction is back on its RLS-scoped role after the owner-role insert.
    const role = await runInWorkspace(database, ws.ctx, async (tx) => {
      await producer.queue.send(tx, 'export.run', { workspaceId: ws.workspaceId, exportId: 'role-check' });
      const { rows } = await sql<{ u: string }>`SELECT current_user AS u`.execute(tx.db);
      return rows[0]?.u;
    });
    expect(role).toBe('agentic_crm_app');
  });
});
