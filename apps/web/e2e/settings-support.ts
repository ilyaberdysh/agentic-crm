//  e2e helpers: members with their own browser context (invite → sign-up → accept), tRPC setup calls and a tiny
// PNG for avatar uploads. Members sign up with the invited email through the auth API (the UI sign-up is by invitation
// only), then accept the invite by its token.
import { type Browser, type BrowserContext, expect, type Page } from '@playwright/test';
import { WEB_ORIGIN, WORKSPACE_SLUG } from './env.ts';
import { trpc, uuid } from './slice3-support.ts';

export const MEMBER_PASSWORD = 'Member-password-1';

export interface MemberSession {
  context: BrowserContext;
  page: Page;
  memberId: string;
  email: string;
}

interface MemberRow {
  id: string;
  emailAddress: string;
}

/** An invited, signed-in member of the e2e workspace in a context of their own (en-US, reference viewport). */
export async function newMember(
  browser: Browser,
  admin: Page,
  who: { email: string; name: string; level?: 'member' | 'admin' },
): Promise<MemberSession> {
  const { invites } = await trpc<{ invites: { id: string }[] }>(admin, 'invites.create', {
    invites: [{ emailAddress: who.email, accessLevel: who.level ?? 'member' }],
  });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 945 },
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  const signUp = await context.request.post(`${WEB_ORIGIN}/api/auth/sign-up/email`, {
    headers: { origin: WEB_ORIGIN },
    data: { email: who.email, password: MEMBER_PASSWORD, name: who.name },
  });
  expect(signUp.ok()).toBeTruthy();
  const page = await context.newPage();
  await trpc(page, 'invites.accept', { inviteId: invites[0]?.id });
  const members = await trpc<MemberRow[]>(admin, 'members.list', {});
  const member = members.find((m) => m.emailAddress === who.email);
  if (!member) throw new Error(`member ${who.email} did not join`);
  await page.goto(`/${WORKSPACE_SLUG}/home`);
  return { context, page, memberId: member.id, email: who.email };
}

/** A 1×1 PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==',
  'base64',
);

export interface TestObject {
  id: string;
  slug: string;
  headcountId: string;
  summaryId: string;
  recordId: string;
}

/** A custom object with a text and a number attribute and one record, for permission and rule tests. */
export async function createTestObject(admin: Page, slug: string, plural: string): Promise<TestObject> {
  const id = uuid();
  await trpc(admin, 'schema.objects.create', {
    id,
    apiSlug: slug,
    singularNoun: plural.replace(/s$/, ''),
    pluralNoun: plural,
  });
  const summaryId = uuid();
  const headcountId = uuid();
  await trpc(admin, 'schema.attributes.create', {
    id: summaryId,
    entityDefinitionId: id,
    title: 'Summary',
    type: 'text',
  });
  await trpc(admin, 'schema.attributes.create', {
    id: headcountId,
    entityDefinitionId: id,
    title: 'Headcount',
    type: 'number',
  });
  await trpc(admin, 'views.create', {
    id: uuid(),
    entityDefinitionId: id,
    type: 'table',
    title: 'All records',
    sortOrder: '0001',
    columns: [summaryId, headcountId].map((attributeDefinitionId) => ({
      id: uuid(),
      path: [{ entityDefinitionId: id, attributeDefinitionId }],
    })),
  });
  const recordId = uuid();
  await trpc(admin, 'records.put', {
    entityDefinitionId: id,
    entityInstanceId: recordId,
    values: { [summaryId]: [{ value: 'Kick-off' }], [headcountId]: [{ value: 20 }] },
  });
  return { id, slug, headcountId, summaryId, recordId };
}
