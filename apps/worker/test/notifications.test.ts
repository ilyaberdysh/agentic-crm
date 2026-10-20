// The notification email channel stub (BACKLOG 5.06): a mention with the email channel on records a pending email
// delivery; the worker's notifications.email handler marks it skipped (outbound email arrives with slice 7). Calls
// the handler directly, so it does not compete with worker.test.ts for queued jobs.
import { randomUUID } from 'node:crypto';
import { createDb } from '@agentic-crm/db';
import { createDomain, memberContext, newId } from '@agentic-crm/domain';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';
import { drainNotificationEmails } from '../src/worker.ts';
import { databaseUrl } from './env.ts';

const database = createDb({ connectionString: databaseUrl(), max: 2 });
const domain = createDomain({ database });
const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 });
const logs: Record<string, unknown>[] = [];
const log = createLogger('info', 'worker-test', (line) => {
  logs.push(JSON.parse(line) as Record<string, unknown>);
});

afterAll(async () => {
  await database.destroy();
  await pool.end();
});

async function user(name: string) {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`;
  await pool.query('INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)', [id, name, email]);
  return { userId: id, emailAddress: email, firstName: name, lastName: 'Test' };
}

describe('notifications.email', () => {
  it('marks pending notification emails skipped', async () => {
    const ada = await user('Ada');
    const bob = await user('Bob');
    const ws = await domain.workspaces.create(ada, { name: 'Mail', slug: `mail-${randomUUID().slice(0, 8)}` });
    const adaCtx = memberContext(ws.id, ws.membership.id);
    await domain.invites.create(adaCtx, { invites: [{ emailAddress: bob.emailAddress }] });
    const joined = await domain.invites.accept(bob, { workspaceId: ws.id });
    const company = newId();
    await domain.records.create(adaCtx, {
      entityDefinitionId: 'companies',
      entityInstanceId: company,
      values: { name: [{ value: 'Acme' }] },
    });
    await domain.comments.create(adaCtx, {
      id: newId(),
      target: { kind: 'record', entityDefinitionId: 'companies', entityInstanceId: company },
      content: {
        text: 'Hi @Bob',
        mentions: [{ kind: 'workspace-member', start: 3, length: 4, memberId: joined.membership.id }],
      },
    });
    const before = await pool.query('SELECT status FROM notification_deliveries WHERE recipient_member_id = $1', [
      joined.membership.id,
    ]);
    expect(before.rows).toEqual([{ status: 'pending' }]);

    expect((await drainNotificationEmails(domain, log)).skipped).toBeGreaterThanOrEqual(1);
    const after = await pool.query('SELECT status FROM notification_deliveries WHERE recipient_member_id = $1', [
      joined.membership.id,
    ]);
    expect(after.rows).toEqual([{ status: 'skipped' }]);
    expect(logs.some((l) => String(l.msg ?? l.message).includes('slice 7'))).toBe(true);
    expect((await drainNotificationEmails(domain, log)).skipped).toBe(0);
  });
});
