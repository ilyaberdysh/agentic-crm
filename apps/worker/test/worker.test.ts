// The worker end to end against its own database: jobs enqueued by domain transactions (D-10) are picked up by
// pg-boss, imports and exports complete, health reports the queues, and a graceful stop mid-import hands the rest
// to the next worker without importing a row twice.
import { randomUUID } from 'node:crypto';
import { config } from '@agentic-crm/config';
import { fakeCallsLlm, memberContext, S3Storage, type ServiceContext } from '@agentic-crm/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';
import { startWorker, type Worker } from '../src/worker.ts';
import { databaseUrl, TEST_DATABASE } from './env.ts';

const storage = new S3Storage({ ...config.s3, bucket: TEST_DATABASE.replace(/_/g, '-') });
const logs: Record<string, unknown>[] = [];
const log = createLogger('info', 'worker-test', (line) => {
  logs.push(JSON.parse(line) as Record<string, unknown>);
});

let worker: Worker;
let db: pg.Pool;
let ctx: ServiceContext;
let workspaceId: string;

const start = () =>
  startWorker({
    databaseUrl: databaseUrl(),
    storage,
    log,
    pollingIntervalSeconds: 0.5,
    healthIntervalMs: 0,
    llm: fakeCallsLlm(),
  });

async function until<T>(probe: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function importRows(objectId: string, rows: string[][]) {
  const created = await worker.domain.imports.create(ctx, {
    entityDefinitionId: objectId,
    fileName: 'rows.csv',
    columns: ['Name', 'Code'],
    rowCount: rows.length,
  });
  for (let i = 0; i < rows.length; i += 500) {
    await worker.domain.imports.uploadRows(ctx, {
      jobId: created.jobId,
      startRow: i,
      rows: rows.slice(i, i + 500),
      final: i + 500 >= rows.length,
    });
  }
  return created.jobId;
}

let objectId: string;

beforeAll(async () => {
  worker = await start();
  db = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  const userId = randomUUID();
  await db.query(`INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Wendy Worker', $2, true)`, [
    userId,
    `wendy-${userId.slice(0, 8)}@example.com`,
  ]);
  const ws = await worker.domain.workspaces.create(
    { userId, emailAddress: `wendy-${userId.slice(0, 8)}@example.com`, firstName: 'Wendy', lastName: 'Worker' },
    { name: 'Worker test', slug: `wk-${userId.slice(0, 8)}` },
  );
  workspaceId = ws.id;
  ctx = memberContext(ws.id, ws.membership.id);
  const object = await worker.domain.schema.createObject(ctx, {
    id: randomUUID(),
    apiSlug: 'projects',
    singularNoun: 'Project',
    pluralNoun: 'Projects',
  });
  objectId = object.id;
  await worker.domain.schema.createAttribute(ctx, {
    id: randomUUID(),
    entityDefinitionId: objectId,
    title: 'Name',
    type: 'text',
  });
  await worker.domain.schema.createAttribute(ctx, {
    id: randomUUID(),
    entityDefinitionId: objectId,
    title: 'Code',
    type: 'text',
    isUnique: true,
  });
});

afterAll(async () => {
  await worker?.stop();
  await db?.end();
});

describe('worker', () => {
  it('processes an imported call recording (calls.process): summaries, completed', async () => {
    const meetingId = randomUUID();
    await worker.domain.meetings.create(ctx, {
      id: meetingId,
      title: 'Worker call',
      start: { datetime: new Date(Date.now() - 3_600_000).toISOString() },
      end: { datetime: new Date(Date.now() - 1_800_000).toISOString() },
      participants: [{ emailAddress: 'jane@northwind.example.com', name: 'Jane' }],
    });
    const recording = await worker.domain.meetings.recordings.create(ctx, {
      id: randomUUID(),
      meetingId,
      transcript: [{ speech: 'Hello there', startTime: 0, endTime: 2, speaker: { name: 'Jane' } }],
    });
    expect(recording.status).toBe('processing');
    const done = await until(
      () => worker.domain.calls.get(ctx, recording.id),
      (c) => c.status === 'completed',
    );
    expect(done).toMatchObject({ summaryStatus: 'completed', conciseSummaryStatus: 'completed' });
    expect(done.summary).toContain('Worker call');
  });

  it('runs an import queued by imports.run', async () => {
    const jobId = await importRows(objectId, [
      ['Alpha', 'A-1'],
      ['Beta', 'B-1'],
    ]);
    await worker.domain.imports.run(ctx, { jobId });
    const status = await until(
      () => worker.domain.imports.status(ctx, { jobId }),
      (s) => s.job.status === 'completed',
    );
    expect(status.strategies[0]?.statuses).toMatchObject({ created: 2 });
    expect(logs.some((l) => l.msg === 'import finished' && l.jobId === jobId)).toBe(true);
  });

  it('runs an export queued by exports.create and reports queue health', async () => {
    const views = await worker.domain.views.list(ctx, { entityDefinitionId: objectId });
    const view =
      views[0] ??
      (await worker.domain.views.create(ctx, {
        id: randomUUID(),
        entityDefinitionId: objectId,
        title: 'All projects',
      }));
    const { exportId } = await worker.domain.exports.create(ctx, { viewId: view.id, locale: 'en-US' });
    const done = await until(
      () => worker.domain.exports.status(ctx, { exportId }),
      (s) => s.status === 'complete' || s.status === 'failed',
    );
    expect(done).toMatchObject({ status: 'complete', rowCount: 2 });
    const health = await worker.health();
    expect(health.queues.map((q) => q.name).sort()).toEqual([
      'ai-attribute.run',
      'ai-attribute.sweep',
      'calls.generate',
      'calls.process',
      'email.outbox',
      'email.sync',
      'export.run',
      'formula.daily',
      'formula.generate',
      'formula.recompute',
      'import.run',
      'interactions.connection-strength',
      'interactions.refresh-due',
      'jobs.dead-letter',
      'workflow.run',
      'workflow.tick',
    ]);
    expect(health.queues.every((q) => q.active === 0)).toBe(true);
  });

  it('syncs a test mailbox, recomputes connection strength and delivers the outbox through jobs (slice 7)', async () => {
    const mailbox = await worker.domain.mailboxes.connect(ctx, {
      id: randomUUID(),
      provider: 'test',
      emailAddress: 'wendy@ourco-worker.io',
    });
    await worker.domain.workspaceEmail.settings.update(ctx, { recordCreation: 'all' });
    // Inject without syncing: the inject transaction queues email.sync.
    await worker.domain.connectors.test.injectMessage(ctx, {
      mailboxId: mailbox.id,
      message: {
        subject: 'Hello from a job',
        from: { emailAddress: 'kim@client-worker.io', name: 'Kim Client' },
        to: [{ emailAddress: 'wendy@ourco-worker.io' }],
      },
    });
    const synced = await until(
      () => worker.domain.mailboxes.get(ctx, mailbox.id),
      (m) => m.messagesSynced === 1,
    );
    expect(synced.status).toBe('in-sync');
    const people = await worker.domain.records.findByUniqueValues(ctx, {
      entityDefinitionId: 'people',
      attributeDefinitionId: 'email_addresses',
      values: [{ value: 'kim@client-worker.io' }],
    });
    const personId = people.entityInstanceIds[0] as string;
    // Connection strength arrives through its own job: the strongest connection is the mailbox owner.
    const attributes = await worker.domain.schema.listAttributes(ctx, { entityDefinitionId: 'people' });
    const strongest = attributes.find((a) => a.apiSlug === 'strongest_connection_user')?.id as string;
    const value = await until(
      async () =>
        (await worker.domain.records.get(ctx, { entityDefinitionId: 'people', entityInstanceId: personId })).values[
          strongest
        ]?.[0]?.value,
      (v) => v !== undefined,
    );
    expect(value).toEqual({ referencedActorType: 'workspace-member', referencedActorId: ctx.actor.id });
    // A sent draft is delivered by the outbox job (test connector records it).
    const draftId = randomUUID();
    await worker.domain.email.drafts.create(ctx, {
      id: draftId,
      subject: { text: 'Reply', variables: [] },
      to: [{ emailAddress: 'kim@client-worker.io' }],
    });
    const { outbox } = await worker.domain.email.drafts.send(ctx, { draftId });
    const delivered = await until(
      async () => ({
        sent: await worker.domain.connectors.test.sent(ctx, mailbox.id),
        pending: await worker.domain.email.outbox.list(ctx),
      }),
      ({ sent, pending }) => sent.length === 1 && pending.length === 0,
    );
    expect(delivered.sent).toHaveLength(1);
    expect(delivered.pending).toEqual([]);
    expect(outbox).toHaveLength(1);
  });

  it('hands an import over on graceful stop and finishes it exactly once', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`Row ${i}`, `R-${i}`]);
    const jobId = await importRows(objectId, rows);
    await worker.stop();
    worker = await startWorker({
      databaseUrl: databaseUrl(),
      storage,
      log,
      pollingIntervalSeconds: 0.5,
      healthIntervalMs: 0,
      importBatchSize: 1,
    });
    await worker.domain.imports.run(ctx, { jobId });
    await until(
      () => worker.domain.imports.status(ctx, { jobId }),
      (s) => s.job.progress.done > 0 || s.job.status === 'completed',
    );
    await worker.stop();
    worker = await start();
    const status = await until(
      () => worker.domain.imports.status(ctx, { jobId }),
      (s) => s.job.status === 'completed',
      60_000,
    );
    expect(status.job.progress).toEqual({ done: 300, total: 300 });
    expect(status.strategies[0]?.statuses).toMatchObject({ created: 300, failed: 0 });
    const { rows: count } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM entity_instances WHERE entity_definition_id = $1 AND archived_at IS NULL`,
      [objectId],
    );
    expect(count[0]?.n).toBe(302);
    // The first worker stopped between batches and queued a continuation instead of spending a retry.
    expect(logs.some((l) => l.msg === 'import interrupted; continuation queued' && l.jobId === jobId)).toBe(true);
  });
});
