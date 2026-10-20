// Visibility of synced email (decision C.4 #13; F README §2.2–2.3, F settings §2.1; BACKLOG acceptance 3): the mailbox
// level (full / subject-line / metadata-only) for every member, the owner's full access, per-member sharing
// ("Individuals with full access"), thread and record grants, protected contacts and removed mailboxes — on the
// Emails tab (threads) and in the email modal (get / thread).
import type { EmailMessageView, VisibilityLevel } from '@agentic-crm/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EmailFixture,
  emailFixture,
  injectMessage,
  iso,
  type Member,
  memberWithMailbox,
  plainMember,
  recordsByValue,
} from './email-fixtures.ts';
import { domain, expectCode } from './support/harness.ts';

let f: EmailFixture;
let bob: Member;
let cara: { memberId: string; ctx: Member['ctx'] };
let dan: { memberId: string; ctx: Member['ctx'] };
let customer: string;
let person: { entityDefinitionId: string; entityInstanceId: string };
let pricingId: string;
let pricingThread: string;

const view = (ctx: Member['ctx']) => domain.email.get(ctx, { messageId: pricingId });

function shape(m: EmailMessageView) {
  return {
    access: m.access,
    subject: m.subject !== null,
    body: m.bodyText !== null,
    snippet: m.snippet !== null,
    attachments: m.attachments !== null,
    participants: m.participants.length > 0,
  };
}

beforeAll(async () => {
  f = await emailFixture({ recordCreation: 'all' });
  bob = await memberWithMailbox(f, 'Bob');
  cara = await plainMember(f, 'Cara');
  dan = await plainMember(f, 'Dan');
  customer = `ann@acme-${f.tag}.com`;
  await injectMessage(f.ada, {
    providerMessageId: 'pricing',
    subject: 'Pricing',
    bodyText: 'Our price is 10k',
    from: { emailAddress: customer, name: 'Ann' },
    to: [{ emailAddress: f.ada.address }],
    bcc: [{ emailAddress: `audit-${f.tag}@archive.example.org` }],
    attachments: [{ name: 'quote.pdf', contentType: 'application/pdf', size: 1200 }],
    sentAt: iso(-10),
  });
  await injectMessage(f.ada, {
    providerMessageId: 'other',
    subject: 'Other topic',
    bodyText: 'Unrelated',
    from: { emailAddress: customer },
    to: [{ emailAddress: f.ada.address }],
    sentAt: iso(-9),
  });
  const [id] = await recordsByValue(f, 'people', customer);
  person = { entityDefinitionId: f.people, entityInstanceId: id as string };
  const { threads } = await domain.email.threads(f.ctx, { record: person });
  const pricing = threads.find((t) => t.subject === 'Pricing');
  pricingId = pricing?.displayMessageId as string;
  pricingThread = pricing?.threadId as string;
});

describe('mailbox levels (acceptance 3)', () => {
  it('new mailboxes take the workspace default: subject line', async () => {
    expect((await domain.mailboxes.get(f.ctx, f.ada.mailboxId)).defaultVisibility).toBe('subject-line');
  });

  it('the owner always has full access', async () => {
    const own = await view(f.ctx);
    expect(shape(own)).toEqual({
      access: 'full-access',
      subject: true,
      body: true,
      snippet: true,
      attachments: true,
      participants: true,
    });
    expect(own.isOwn).toBe(true);
    expect(own.bodyText).toBe('Our price is 10k');
    expect(own.participants.some((p) => p.role === 'bcc')).toBe(true);
  });

  const expected: Record<VisibilityLevel, ReturnType<typeof shape>> = {
    'full-access': {
      access: 'full-access',
      subject: true,
      body: true,
      snippet: true,
      attachments: true,
      participants: true,
    },
    'subject-line': {
      access: 'subject-line',
      subject: true,
      body: false,
      snippet: false,
      attachments: false,
      participants: true,
    },
    'metadata-only': {
      access: 'metadata-only',
      subject: false,
      body: false,
      snippet: false,
      attachments: false,
      participants: true,
    },
  };

  for (const level of ['subject-line', 'metadata-only', 'full-access'] as const) {
    it(`${level}: other members (with or without a mailbox) see the ${level} shape`, async () => {
      await domain.mailboxes.update(f.ctx, { mailboxId: f.ada.mailboxId, defaultVisibility: level });
      for (const ctx of [bob.ctx, cara.ctx]) {
        const m = await view(ctx);
        expect(shape(m)).toEqual(expected[level]);
        expect(m.isOwn).toBe(false);
        // BCC recipients are the owner's business.
        expect(m.participants.some((p) => p.role === 'bcc')).toBe(false);
        const { threads } = await domain.email.threads(ctx, { record: person });
        const row = threads.find((t) => t.threadId === pricingThread);
        expect(row?.access).toBe(level);
        expect(row?.subject).toBe(level === 'metadata-only' ? null : 'Pricing');
        expect(row?.snippet).toBe(level === 'full-access' ? 'Our price is 10k' : null);
      }
    });
  }

  it('subject-line access: the modal gets the subject and no body (restricted state)', async () => {
    await domain.mailboxes.update(f.ctx, { mailboxId: f.ada.mailboxId, defaultVisibility: 'subject-line' });
    const m = await view(cara.ctx);
    expect(m).toMatchObject({
      access: 'subject-line',
      subject: 'Pricing',
      bodyText: null,
      bodyHtml: null,
      snippet: null,
      attachments: null,
      hasAttachments: null,
    });
    const thread = await domain.email.thread(cara.ctx, { threadId: pricingThread });
    expect(thread).toMatchObject({ access: 'subject-line', subject: 'Pricing' });
    expect(thread.messages[0]?.bodyText).toBeNull();
  });
});

describe('sharing', () => {
  beforeAll(async () => {
    await domain.mailboxes.update(f.ctx, { mailboxId: f.ada.mailboxId, defaultVisibility: 'metadata-only' });
  });

  it('"Individuals with full access" gives one member everything in the mailbox', async () => {
    const grant = await domain.mailboxes.sharing.add(f.ctx, { mailboxId: f.ada.mailboxId, memberId: dan.memberId });
    expect(grant).toMatchObject({ level: 'full-access', target: { type: 'member', memberId: dan.memberId } });
    expect((await view(dan.ctx)).access).toBe('full-access');
    expect((await view(cara.ctx)).access).toBe('metadata-only');
    expect(await domain.mailboxes.sharing.list(f.ctx, f.ada.mailboxId)).toHaveLength(1);
    // Only the owner manages the mailbox's sharing.
    await expectCode(
      domain.mailboxes.sharing.add(bob.ctx, { mailboxId: f.ada.mailboxId, memberId: cara.memberId }),
      'NOT_FOUND',
      404,
    );
    await domain.mailboxes.sharing.remove(f.ctx, { grantId: grant.id });
    expect((await view(dan.ctx)).access).toBe('metadata-only');
  });

  it('sharing a thread (email modal "Share") raises one thread only', async () => {
    const grant = await domain.email.grants.put(f.ctx, {
      resource: { type: 'thread', threadId: pricingThread },
      target: { type: 'member', memberId: cara.memberId },
    });
    expect((await view(cara.ctx)).access).toBe('full-access');
    const { threads } = await domain.email.threads(cara.ctx, { record: person });
    expect(
      Object.fromEntries(threads.map((t) => [t.threadId === pricingThread ? 'pricing' : 'other', t.access])),
    ).toEqual({
      pricing: 'full-access',
      other: 'metadata-only',
    });
    // Others are unaffected; a member cannot share someone else's thread.
    expect((await view(dan.ctx)).access).toBe('metadata-only');
    await expectCode(
      domain.email.grants.put(bob.ctx, {
        resource: { type: 'thread', threadId: pricingThread },
        target: { type: 'workspace' },
      }),
      'NOT_FOUND',
      404,
    );
    await domain.email.grants.remove(f.ctx, { grantId: grant.id });
    expect((await view(cara.ctx)).access).toBe('metadata-only');
  });

  it('record "Manage access" shares the owner’s emails on that record with the workspace at a level', async () => {
    const grant = await domain.email.grants.put(f.ctx, {
      resource: { type: 'record', record: person },
      target: { type: 'workspace' },
      level: 'subject-line',
    });
    expect((await view(cara.ctx)).access).toBe('subject-line');
    expect((await view(dan.ctx)).access).toBe('subject-line');
    // Upsert: the level is replaced.
    await domain.email.grants.put(f.ctx, {
      resource: { type: 'record', record: person },
      target: { type: 'workspace' },
      level: 'full-access',
    });
    expect((await view(cara.ctx)).access).toBe('full-access');
    expect(await domain.email.grants.list(f.ctx, { resource: { type: 'record', record: person } })).toHaveLength(1);
    await domain.email.grants.remove(f.ctx, { grantId: grant.id });
    expect((await view(cara.ctx)).access).toBe('metadata-only');
  });
});

describe('protected contacts and removed mailboxes', () => {
  it('emails involving a protected contact are visible to their owners only', async () => {
    await domain.workspaceEmail.protectedContacts.add(f.ctx, { values: [`board-${f.tag}.com`] });
    await injectMessage(f.ada, {
      subject: 'Board pack',
      bodyText: 'Confidential',
      from: { emailAddress: `chair@board-${f.tag}.com` },
      to: [{ emailAddress: f.ada.address }],
      cc: [{ emailAddress: customer }],
    });
    const own = await domain.email.threads(f.ctx, { record: person });
    const board = own.threads.find((t) => t.subject === 'Board pack');
    expect(board?.access).toBe('full-access');
    const theirs = await domain.email.threads(cara.ctx, { record: person });
    expect(theirs.threads.some((t) => t.threadId === board?.threadId)).toBe(false);
    expect(theirs.total).toBe(own.total - 1);
    await expectCode(domain.email.get(cara.ctx, { messageId: board?.displayMessageId as string }), 'NOT_FOUND', 404);
    // Protected contacts never become records.
    expect(await recordsByValue(f, 'people', `chair@board-${f.tag}.com`)).toEqual([]);
  });

  it('removing the mailbox removes its emails for everyone', async () => {
    const before = await domain.email.threads(f.ctx, { record: person });
    expect(before.total).toBeGreaterThan(0);
    const removed = await domain.mailboxes.disconnect(f.ctx, f.ada.mailboxId);
    expect(removed).toMatchObject({ status: 'archived', isDefault: false });
    expect((await domain.email.threads(f.ctx, { record: person })).total).toBe(0);
    await expectCode(view(f.ctx), 'NOT_FOUND', 404);
    expect(await domain.mailboxes.list(f.ctx)).toEqual([]);
    expect(await domain.mailboxes.list(f.ctx, { includeArchived: true })).toHaveLength(1);
  });
});
