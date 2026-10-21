// Email ingestion through the test connector (BACKLOG 7.01–7.02, acceptance 2): record auto-creation in the three
// modes with company auto-creation, record suppression, protected / blocked contacts and the mailbox-only blocklist,
// dedupe across mailboxes ("via N mailboxes"), threading, internal emails, deletions, cursors and idempotent re-sync.
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import {
  emailFixture,
  injectMessage,
  iso,
  memberWithMailbox,
  recordCount,
  recordsByValue,
  valuesOf,
} from './email-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

describe('record creation (acceptance 2)', () => {
  it('mode All: a message from an unknown domain creates a company and a person, linked to each other', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const sender = `jane@northwind-${f.tag}.com`;
    const result = await injectMessage(f.ada, {
      subject: 'Hello',
      bodyText: 'Hi there',
      from: { emailAddress: sender, name: 'Jane Cooper' },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(result.sync?.messages).toBe(1);
    expect(result.sync?.recordsCreated).toBe(2);
    const [person] = await recordsByValue(f, 'people', sender);
    const [company] = await recordsByValue(f, 'companies', `northwind-${f.tag}.com`);
    expect(person).toBeDefined();
    expect(company).toBeDefined();
    const name = await valuesOf(f, 'people', person as string, 'name');
    expect(name[0]?.value).toMatchObject({ firstName: 'Jane', lastName: 'Cooper', fullName: 'Jane Cooper' });
    const companyRef = await valuesOf(f, 'people', person as string, 'company');
    expect(companyRef[0]?.value).toMatchObject({ entityInstanceId: company });
    const companyName = await valuesOf(f, 'companies', company as string, 'name');
    expect(companyName[0]?.value).toBe(`Northwind ${f.tag}`.replace(/ (\w)/, (_, c: string) => ` ${c.toUpperCase()}`));
    // Created by the mail-sync system actor.
    const created = await domain.records.get(f.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: person as string,
    });
    expect(created.record.createdBy).toEqual({ type: 'system', id: null });
    // The record's Emails tab lists the thread.
    const threads = await domain.email.threads(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: person as string },
    });
    expect(threads.total).toBe(1);
    expect(threads.threads[0]?.subject).toBe('Hello');
  });

  it('suppressed domains and addresses create no records (but existing records still link)', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const added = await domain.suppression.add(f.ctx, {
      values: [`newsletter-${f.tag}.com, noreply@vendor-${f.tag}.com`, 'not a domain!', `newsletter-${f.tag}.com`],
    });
    expect(added.added.map((a) => a.value).sort()).toEqual(
      [`newsletter-${f.tag}.com`, `noreply@vendor-${f.tag}.com`].sort(),
    );
    expect(added.invalid).toEqual(['not', 'a', 'domain!']);
    expect(added.duplicates).toEqual([`newsletter-${f.tag}.com`]);
    const people = await recordCount(f, 'people');
    const companies = await recordCount(f, 'companies');
    await injectMessage(f.ada, {
      subject: 'Weekly news',
      from: { emailAddress: `digest@newsletter-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    await injectMessage(f.ada, {
      subject: 'Your invoice',
      from: { emailAddress: `noreply@vendor-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(await recordCount(f, 'people')).toBe(people);
    expect(await recordCount(f, 'companies')).toBe(companies);

    // An existing person at a suppressed domain is still linked.
    const existing = newId();
    await domain.records.create(f.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: existing,
      values: { email_addresses: [{ value: `editor@newsletter-${f.tag}.com` }] },
    });
    await injectMessage(f.ada, {
      subject: 'From the editor',
      from: { emailAddress: `editor@newsletter-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    const threads = await domain.email.threads(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: existing },
    });
    expect(threads.threads.map((t) => t.subject)).toEqual(['From the editor']);
    expect(await recordCount(f, 'companies')).toBe(companies);

    // Removing the suppression lets new contacts create records again.
    const list = await domain.suppression.list(f.ctx);
    for (const entry of [...list.domains, ...list.emailAddresses])
      await domain.suppression.remove(f.ctx, { id: entry.id });
    await injectMessage(f.ada, {
      subject: 'Again',
      from: { emailAddress: `writer@newsletter-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(await recordsByValue(f, 'people', `writer@newsletter-${f.tag}.com`)).toHaveLength(1);
  });

  it('mode Selective creates records only for recipients of members’ emails and for calendar participants', async () => {
    const f = await emailFixture({ recordCreation: 'selective' });
    await injectMessage(f.ada, {
      subject: 'Cold inbound',
      from: { emailAddress: `sales@spam-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(await recordsByValue(f, 'people', `sales@spam-${f.tag}.com`)).toEqual([]);
    expect(await recordsByValue(f, 'companies', `spam-${f.tag}.com`)).toEqual([]);
    await injectMessage(f.ada, {
      subject: 'Proposal',
      from: { emailAddress: f.ada.address },
      to: [{ emailAddress: `cto@prospect-${f.tag}.com`, name: 'Pat Doe' }],
      cc: [{ emailAddress: `cfo@prospect-${f.tag}.com` }],
    });
    expect(await recordsByValue(f, 'people', `cto@prospect-${f.tag}.com`)).toHaveLength(1);
    expect(await recordsByValue(f, 'people', `cfo@prospect-${f.tag}.com`)).toHaveLength(1);
    expect(await recordsByValue(f, 'companies', `prospect-${f.tag}.com`)).toHaveLength(1);
  });

  it('mode None creates nothing; company auto-creation can be switched off', async () => {
    const f = await emailFixture({ recordCreation: 'none' });
    await injectMessage(f.ada, {
      subject: 'Proposal',
      from: { emailAddress: f.ada.address },
      to: [{ emailAddress: `cto@quiet-${f.tag}.com` }],
    });
    expect(await recordsByValue(f, 'people', `cto@quiet-${f.tag}.com`)).toEqual([]);

    const g = await emailFixture({ recordCreation: 'all', autoCreateCompanies: false });
    await injectMessage(g.ada, {
      subject: 'Hi',
      from: { emailAddress: `jo@solo-${g.tag}.com` },
      to: [{ emailAddress: g.ada.address }],
    });
    expect(await recordsByValue(g, 'people', `jo@solo-${g.tag}.com`)).toHaveLength(1);
    expect(await recordsByValue(g, 'companies', `solo-${g.tag}.com`)).toEqual([]);
  });

  it('public email providers create people but no companies; members and internal addresses create nothing', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const bob = await memberWithMailbox(f, 'Bob');
    await injectMessage(f.ada, {
      subject: 'Lunch?',
      from: { emailAddress: bob.address },
      to: [{ emailAddress: f.ada.address }],
      cc: [{ emailAddress: `intern@ourco-${f.tag}.io` }, { emailAddress: `friend.${f.tag}@gmail.com` }],
    });
    expect(await recordsByValue(f, 'people', bob.address)).toEqual([]);
    expect(await recordsByValue(f, 'people', `intern@ourco-${f.tag}.io`)).toEqual([]);
    expect(await recordsByValue(f, 'people', `friend.${f.tag}@gmail.com`)).toHaveLength(1);
    expect(await recordsByValue(f, 'companies', 'gmail.com')).toEqual([]);
    // Switching the internal domain protection off makes colleagues regular contacts.
    await domain.workspaceEmail.settings.update(f.ctx, { unprotectedDomains: [`ourco-${f.tag}.io`] });
    const settings = await domain.workspaceEmail.settings.get(f.ctx);
    expect(settings.internalDomains).toEqual([`ourco-${f.tag}.io`]);
    await injectMessage(f.ada, {
      subject: 'Intro',
      from: { emailAddress: `contractor@ourco-${f.tag}.io` },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(await recordsByValue(f, 'people', `contractor@ourco-${f.tag}.io`)).toHaveLength(1);
  });
});

describe('blocking', () => {
  it('the mailbox-only blocklist and workspace blocked contacts keep messages out', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const added = await domain.mailboxes.blocklist.add(f.ctx, {
      mailboxId: f.ada.mailboxId,
      values: [`private-${f.tag}.com`],
    });
    expect(added.added).toHaveLength(1);
    const first = await injectMessage(f.ada, {
      subject: 'Personal',
      from: { emailAddress: `mom@private-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(first.sync).toMatchObject({ messages: 0, skipped: 1 });
    expect(await recordsByValue(f, 'people', `mom@private-${f.tag}.com`)).toEqual([]);

    await domain.workspaceEmail.protectedContacts.add(f.ctx, {
      values: [`rival-${f.tag}.com`],
      enforcement: 'blocked',
    });
    const second = await injectMessage(f.ada, {
      subject: 'Secret',
      from: { emailAddress: `ceo@rival-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
    });
    expect(second.sync).toMatchObject({ messages: 0, skipped: 1 });
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM email_messages WHERE workspace_id = ${f.workspaceId}`.execute(database.kysely);
    expect(rows[0]?.n).toBe('0');
    // The list endpoints show what was added.
    expect((await domain.mailboxes.blocklist.list(f.ctx, f.ada.mailboxId)).map((e) => e.value)).toEqual([
      `private-${f.tag}.com`,
    ]);
    expect((await domain.workspaceEmail.protectedContacts.list(f.ctx))[0]).toMatchObject({ enforcement: 'blocked' });
  });
});

describe('dedupe, threads, deletion, cursors', () => {
  it('one message synced by two mailboxes is one thread "via 2 mailboxes"', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const bob = await memberWithMailbox(f, 'Bob', 'full-access');
    const customer = `ann@acme-${f.tag}.com`;
    const message = {
      rfcMessageId: `<shared-${f.tag}@acme.com>`,
      subject: 'Kickoff',
      bodyText: 'Agenda attached',
      from: { emailAddress: customer, name: 'Ann Lee' },
      to: [{ emailAddress: f.ada.address }, { emailAddress: bob.address }],
      sentAt: iso(-5),
    };
    await injectMessage(f.ada, { ...message, providerMessageId: 'a-1', providerThreadId: 'ta' });
    await injectMessage(bob, { ...message, providerMessageId: 'b-1', providerThreadId: 'tb' });
    const [person] = await recordsByValue(f, 'people', customer);
    const record = { entityDefinitionId: 'people', entityInstanceId: person as string };
    const { threads } = await domain.email.threads(f.ctx, { record });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ messageCount: 1, mailboxCount: 2 });
    expect(new Set(threads[0]?.viaMemberIds)).toEqual(new Set([f.memberId, bob.memberId]));

    // A reply (In-Reply-To) joins the thread, even in the other mailbox's provider thread.
    await injectMessage(bob, {
      providerMessageId: 'b-2',
      providerThreadId: 'tb',
      subject: 'Re: Kickoff',
      bodyText: 'Thanks!',
      from: { emailAddress: bob.address },
      to: [{ emailAddress: customer }],
      inReplyTo: `<shared-${f.tag}@acme.com>`,
      sentAt: iso(-4),
    });
    await injectMessage(f.ada, {
      providerMessageId: 'a-3',
      providerThreadId: 'unrelated',
      subject: 'RE: Kickoff',
      bodyText: 'See you there',
      from: { emailAddress: customer },
      to: [{ emailAddress: f.ada.address }],
      references: [`<shared-${f.tag}@acme.com>`],
      sentAt: iso(-3),
    });
    const after = await domain.email.threads(f.ctx, { record });
    expect(after.threads).toHaveLength(1);
    expect(after.threads[0]).toMatchObject({ messageCount: 3, subject: 'RE: Kickoff' });
    const thread = await domain.email.thread(f.ctx, { threadId: after.threads[0]?.threadId as string });
    expect(thread.subject).toBe('Kickoff');
    expect(thread.messages.map((m) => m.bodyText)).toEqual(['Agenda attached', 'Thanks!', 'See you there']);

    // Re-syncing is idempotent; the cursor makes a second sync a no-op.
    const again = await domain.mailboxes.sync(f.ctx, { mailboxId: f.ada.mailboxId, wait: true });
    expect(again.result).toMatchObject({ messages: 0, skipped: 0 });
    const mailbox = await domain.mailboxes.get(f.ctx, f.ada.mailboxId);
    expect(mailbox).toMatchObject({ messagesSynced: 2, syncState: 'realtime', status: 'in-sync' });

    // A provider deletion removes Ada's copy; Bob's copy keeps the message.
    await domain.connectors.test.remove(f.ctx, {
      mailboxId: f.ada.mailboxId,
      kind: 'message',
      providerId: 'a-3',
      syncNow: true,
    });
    const afterDelete = await domain.email.thread(f.ctx, { threadId: thread.threadId });
    expect(afterDelete.messages).toHaveLength(2);
  });

  it('only the mailbox owner may inject or sync; unknown providers are refused', async () => {
    const f = await emailFixture();
    const bob = await memberWithMailbox(f, 'Bob');
    await expectCode(
      domain.connectors.test.injectMessage(bob.ctx, {
        mailboxId: f.ada.mailboxId,
        message: { from: { emailAddress: 'x@y.com' } },
      }),
      'NOT_FOUND',
      404,
    );
    await expectCode(
      domain.mailboxes.connect(f.ctx, { provider: 'gmail', emailAddress: 'a@b.com' }),
      'PROVIDER_NOT_SUPPORTED',
      400,
    );
    await expectCode(
      domain.mailboxes.connect(bob.ctx, { provider: 'test', emailAddress: f.ada.address }),
      'MAILBOX_ALREADY_CONNECTED',
      409,
    );
  });
});
