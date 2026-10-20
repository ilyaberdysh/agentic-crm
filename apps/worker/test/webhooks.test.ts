// The worker's webhook loop (BACKLOG 6.07, B.28): a record created by a member reaches the subscribed webhook as a
// signed POST without anyone calling the fan-out by hand; a failing target is retried later, not immediately.
import { createHmac, randomUUID } from 'node:crypto';
import { config } from '@agentic-crm/config';
import { memberContext, S3Storage, type ServiceContext } from '@agentic-crm/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';
import { startWorker, type Worker } from '../src/worker.ts';
import { databaseUrl, TEST_DATABASE } from './env.ts';

const storage = new S3Storage({ ...config.s3, bucket: TEST_DATABASE.replace(/_/g, '-') });
const log = createLogger('error', 'worker-webhooks-test', () => {});
const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
let status = 200;

let worker: Worker;
let db: pg.Pool;
let ctx: ServiceContext;

async function until<T>(probe: () => Promise<T> | T, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  worker = await startWorker({
    databaseUrl: databaseUrl(),
    storage,
    log,
    pollingIntervalSeconds: 0.5,
    healthIntervalMs: 0,
    webhookIntervalMs: 100,
    webhookSender: async (request) => {
      sent.push(request);
      return { status };
    },
  });
  db = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  const userId = randomUUID();
  const email = `hook-${userId.slice(0, 8)}@example.com`;
  await db.query(`INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Hank Hook', $2, true)`, [
    userId,
    email,
  ]);
  const ws = await worker.domain.workspaces.create(
    { userId, emailAddress: email, firstName: 'Hank', lastName: 'Hook' },
    { name: 'Webhooks', slug: `wh-${userId.slice(0, 8)}` },
  );
  ctx = memberContext(ws.id, ws.membership.id);
});

afterAll(async () => {
  await worker?.stop();
  await db?.end();
});

describe('webhook loop', () => {
  it('delivers a signed record.created after a member create, and retries a failing target later', async () => {
    const hook = await worker.domain.webhooks.create(ctx, {
      targetUrl: 'https://hooks.example.com/worker',
      subscriptions: [{ eventType: 'record.created', filter: null }],
    });
    const recordId = randomUUID();
    await worker.domain.records.create(ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: recordId,
      values: {},
    });
    const mine = () => sent.filter((s) => JSON.parse(s.body).webhook_id === hook.id);
    const [request] = await until(mine, (r) => r.length > 0);
    expect(JSON.parse(request?.body as string).events[0]).toMatchObject({
      event_type: 'record.created',
      id: { record_id: recordId },
    });
    expect(request?.headers['attio-signature']).toBe(
      createHmac('sha256', hook.secret)
        .update(request?.body as string)
        .digest('hex'),
    );

    status = 503;
    await worker.domain.records.create(ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: randomUUID(),
      values: {},
    });
    await until(mine, (r) => r.length === 2);
    await new Promise((r) => setTimeout(r, 500));
    expect(mine()).toHaveLength(2); // the retry waits for its back-off
    const deliveries = await worker.domain.webhooks.deliveries(ctx, { webhookId: hook.id });
    expect(deliveries.map((d) => [d.status, d.attempts])).toEqual([
      ['pending', 1],
      ['succeeded', 1],
    ]);
  });
});
