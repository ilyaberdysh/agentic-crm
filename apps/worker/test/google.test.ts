// Slice 7b through the worker: a Gmail mailbox connected via OAuth (FakeGoogle, never the network) is synced by the
// email.sync job the connect transaction queued — threads and meetings appear on the records it creates; the poll
// queues the next sync; a reply sent from the composer goes out through Gmail by the outbox job.
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '@agentic-crm/config';
import { FakeGoogle, memberContext, S3Storage, type ServiceContext } from '@agentic-crm/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';
import { startWorker, type Worker } from '../src/worker.ts';
import { databaseUrl, TEST_DATABASE } from './env.ts';

const storage = new S3Storage({ ...config.s3, bucket: TEST_DATABASE.replace(/_/g, '-') });
const fake = new FakeGoogle();
const tag = randomUUID().slice(0, 8);
const MAILBOX = `wendy@ourco-g${tag}.io`;
const CUSTOMER = `kim@client-g${tag}.io`;

let worker: Worker;
let db: pg.Pool;
let ctx: ServiceContext;
let workspaceId: string;
let slug: string;
let memberId: string;

async function until<T>(probe: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  worker = await startWorker({
    databaseUrl: databaseUrl(),
    storage,
    log: createLogger('error', 'worker-google-test'),
    pollingIntervalSeconds: 0.5,
    healthIntervalMs: 0,
    google: { ...fake.settings, encryptionKey: randomBytes(32) },
  });
  db = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  const userId = randomUUID();
  const email = `wendy-${userId.slice(0, 8)}@example.com`;
  await db.query(`INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Wendy Worker', $2, true)`, [
    userId,
    email,
  ]);
  slug = `wg-${userId.slice(0, 8)}`;
  const ws = await worker.domain.workspaces.create(
    { userId, emailAddress: email, firstName: 'Wendy', lastName: 'Worker' },
    { name: 'Worker Google test', slug },
  );
  workspaceId = ws.id;
  memberId = ws.membership.id;
  ctx = memberContext(ws.id, ws.membership.id);
  await worker.domain.workspaceEmail.settings.update(ctx, { recordCreation: 'all' });
});

afterAll(async () => {
  await worker?.stop();
  await db?.end();
});

describe('Gmail through the worker (7.09)', () => {
  it('connect → email.sync job → threads and meetings on records; poll; reply through the outbox job', async () => {
    fake.addAccount(MAILBOX, { name: 'Wendy Worker' });
    const inbound = fake.addMessage(MAILBOX, {
      from: `Kim Client <${CUSTOMER}>`,
      to: MAILBOX,
      subject: 'Renewal',
      text: 'Shall we renew?',
      date: new Date(Date.now() - 3_600_000),
    });
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    fake.putEvent(MAILBOX, {
      id: 'renewal-call',
      summary: 'Renewal call',
      start: { dateTime: start },
      end: { dateTime: new Date(Date.parse(start) + 1_800_000).toISOString() },
      attendees: [
        { email: MAILBOX, self: true, organizer: true, responseStatus: 'accepted' },
        { email: CUSTOMER, displayName: 'Kim Client', responseStatus: 'accepted' },
      ],
      hangoutLink: 'https://meet.google.com/xyz-renewal',
    });

    const google = worker.domain.integrations.google;
    if (!google) throw new Error('google not configured');
    const begun = google.begin({ workspaceId, memberId, slug });
    const back = new URL(fake.consent(begun.url, MAILBOX));
    const verified = google.verify({ state: back.searchParams.get('state'), cookie: begun.cookie });
    if (!verified.ok) throw new Error(verified.reason);
    const { mailbox } = await google.complete(ctx, {
      code: back.searchParams.get('code') as string,
      state: verified.state,
      verifier: verified.verifier,
    });

    // The connect transaction queued email.sync; the worker runs it.
    const synced = await until(
      () => worker.domain.mailboxes.get(ctx, mailbox.id),
      (m) => m.messagesSynced === 1 && m.eventsSynced === 1 && m.status === 'in-sync',
    );
    expect(synced.providerType).toBe('gmail');
    const { entityInstanceIds } = await worker.domain.records.findByUniqueValues(ctx, {
      entityDefinitionId: 'people',
      attributeDefinitionId: 'email_addresses',
      values: [{ value: CUSTOMER }],
    });
    const kim = entityInstanceIds[0] as string;
    expect(kim).toBeDefined();
    const record = { entityDefinitionId: 'people', entityInstanceId: kim };
    const threads = await worker.domain.email.threads(ctx, { record });
    expect(threads.threads.map((t) => t.subject)).toEqual(['Renewal']);
    const meetings = await worker.domain.meetings.list(ctx, { record });
    expect(meetings.meetings).toEqual([
      expect.objectContaining({ title: 'Renewal call', conferenceUrl: 'https://meet.google.com/xyz-renewal' }),
    ]);

    // The poll (cron) queues the next sync, which picks up new mail through history.
    fake.addMessage(MAILBOX, {
      from: CUSTOMER,
      to: MAILBOX,
      subject: 'Renewal',
      text: 'Any news?',
      inReplyTo: inbound.messageId,
    });
    expect((await worker.domain.email.queuePolledSyncs()).queued).toBeGreaterThanOrEqual(1);
    await until(
      () => worker.domain.mailboxes.get(ctx, mailbox.id),
      (m) => m.messagesSynced === 2,
    );

    // A reply from the composer is delivered through Gmail by the outbox job, in the same Gmail thread.
    const parent = await db.query<{ message_id: string }>(
      'SELECT message_id FROM email_message_copies WHERE mailbox_id = $1 AND provider_message_id = $2',
      [mailbox.id, inbound.id],
    );
    const draftId = randomUUID();
    await worker.domain.email.drafts.create(ctx, {
      id: draftId,
      senderMailboxId: mailbox.id,
      parentMessageId: parent.rows[0]?.message_id as string,
      subject: { text: 'Re: Renewal', variables: [] },
      body: [
        { type: 'unstyled', indent: 0, text: 'Yes, let us renew.', styles: [], mentions: [], variables: [] },
      ] as never,
      to: [{ emailAddress: CUSTOMER }],
    });
    await worker.domain.email.drafts.send(ctx, { draftId });
    await until(
      async () => fake.sent.length,
      (n) => n === 1,
    );
    expect(fake.sent[0]?.threadId).toBe(inbound.threadId);
    expect(fake.sent[0]?.raw).toContain(`In-Reply-To: ${inbound.messageId}`);
    // After delivery the sender mailbox is synced again: the sent copy joins the thread.
    const after = await until(
      () => worker.domain.email.threads(ctx, { record }),
      (t) => t.threads[0]?.messageCount === 3,
    );
    expect(after.threads).toHaveLength(1);
  });
});
