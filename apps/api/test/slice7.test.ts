// Slice 7 procedures over HTTP (BACKLOG §7, 7a): mailbox connect + settings (admin-only workspace settings), a test
// connector message creating records (acceptance 2), the Emails tab and the email modal for the owner and for a
// member with subject-line access (acceptance 3), meetings on the record timeline, and a draft through review, send
// and the outbox.
import { randomUUID } from 'node:crypto';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  trpcError,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let member: TestUser;
let mailboxId: string;
let personId: string;
let workspaceId: string;
const slug = `s7-${Date.now().toString(36)}`;
const CUSTOMER = 'jane@northwind-s7.io';

const call = <T>(user: TestUser, path: string, input?: unknown) => trpcCall<T>(h, path, input, { user, slug });

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  ({ workspaceId } = await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }, { user: member }]));
  const connected = await call<Out['mailboxes']['connect']>(admin, 'mailboxes.connect', {
    id: randomUUID(),
    provider: 'test',
    emailAddress: 'ada@ourco-s7.io',
  });
  mailboxId = connected.mailbox.id;
});

afterAll(async () => {
  await h?.close();
});

describe('settings', () => {
  it('workspace email settings are admin-only to change; mailboxes start at the workspace default', async () => {
    const error = await trpcError(call(member, 'workspaceEmail.settings.update', { recordCreation: 'all' }));
    expect(error.status).toBe(403);
    const updated = await call<Out['workspaceEmail']['settings']['update']>(admin, 'workspaceEmail.settings.update', {
      recordCreation: 'all',
    });
    expect(updated.settings).toMatchObject({ recordCreation: 'all', defaultVisibility: 'subject-line' });
    const mailboxes = await call<Out['mailboxes']['list']>(admin, 'mailboxes.list');
    expect(mailboxes).toEqual([
      expect.objectContaining({
        id: mailboxId,
        defaultVisibility: 'subject-line',
        isDefault: true,
        providerType: 'test',
      }),
    ]);
    const added = await call<Out['suppression']['add']>(admin, 'suppression.add', { values: ['newsletter-s7.io'] });
    expect(added.added).toHaveLength(1);
  });
});

describe('synced email', () => {
  it('a test connector message creates a person and a company (acceptance 2)', async () => {
    const injected = await call<Out['connectors']['test']['injectMessage']>(admin, 'connectors.test.injectMessage', {
      mailboxId,
      syncNow: true,
      message: {
        subject: 'Pricing',
        bodyText: 'The price is 10k',
        from: { emailAddress: CUSTOMER, name: 'Jane Cooper' },
        to: [{ emailAddress: 'ada@ourco-s7.io' }],
      },
    });
    expect(injected.sync).toMatchObject({ messages: 1, recordsCreated: 2 });
    const people = await h.domain.records.findByUniqueValues(
      { workspaceId, actor: { type: 'system', id: null } },
      { entityDefinitionId: 'people', attributeDefinitionId: 'email_addresses', values: [{ value: CUSTOMER }] },
    );
    personId = people.entityInstanceIds[0] as string;
    expect(personId).toBeDefined();
  });

  it('the owner sees everything; a member with subject-line access sees the subject only (acceptance 3)', async () => {
    const record = { entityDefinitionId: 'people', entityInstanceId: personId };
    const own = await call<Out['email']['threads']>(admin, 'email.threads', { record });
    expect(own.threads[0]).toMatchObject({ subject: 'Pricing', snippet: 'The price is 10k', access: 'full-access' });
    const theirs = await call<Out['email']['threads']>(member, 'email.threads', { record });
    expect(theirs.threads[0]).toMatchObject({ subject: 'Pricing', snippet: null, access: 'subject-line' });
    const modal = await call<Out['email']['get']>(member, 'email.get', {
      messageId: theirs.threads[0]?.displayMessageId,
    });
    expect(modal).toMatchObject({ access: 'subject-line', subject: 'Pricing', bodyText: null, bodyHtml: null });
  });
});

describe('meetings', () => {
  it('a meeting with the person shows on the record timeline', async () => {
    const meetingId = randomUUID();
    const created = await call<Out['meetings']['create']>(admin, 'meetings.create', {
      id: meetingId,
      title: 'Discovery call',
      start: { datetime: new Date(Date.now() - 3_600_000).toISOString() },
      end: { datetime: new Date(Date.now() - 1_800_000).toISOString() },
      participants: [{ emailAddress: CUSTOMER, status: 'accepted' }],
    });
    expect(created.meeting.participants[0]?.personId).toBe(personId);
    const timeline = await call<Out['timeline']['list']>(admin, 'timeline.list', {
      entityDefinitionId: 'people',
      entityInstanceId: personId,
      filters: ['calendar'],
    });
    expect(timeline.events).toEqual([
      { kind: 'single', event: expect.objectContaining({ eventType: 'meeting', meetingId }) },
    ]);
  });
});

describe('composer', () => {
  it('draft → review → send → outbox', async () => {
    const draftId = randomUUID();
    await call(admin, 'email.drafts.create', { id: draftId });
    await call(admin, 'email.drafts.update', { draftId, to: [{ emailAddress: CUSTOMER }] });
    await call(admin, 'email.drafts.update', { draftId, subject: { text: 'Follow-up', variables: [] } });
    const review = await call<Out['email']['drafts']['review']>(admin, 'email.drafts.review', { draftId });
    expect(review).toMatchObject({ canSend: true, issues: [] });
    const sent = await call<Out['email']['drafts']['send']>(admin, 'email.drafts.send', { draftId });
    expect(sent.outbox).toEqual([expect.objectContaining({ source: 'single-send', deliveryState: 'scheduled' })]);
    const outbox = await call<Out['email']['outbox']['list']>(admin, 'email.outbox.list');
    expect(outbox.map((o) => o.subject)).toEqual(['Follow-up']);
    // Drafts and the outbox are private.
    expect(await call<Out['email']['outbox']['list']>(member, 'email.outbox.list')).toEqual([]);
  });
});
