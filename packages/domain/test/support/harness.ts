// Shared test harness: one pool per test file on agentic_crm_test_domain, a domain instance, and helpers that create
// users (auth table rows, as apps/api would) and fresh workspaces so tests never share tenant data.
import { config } from '@agentic-crm/config';
import { createDb } from '@agentic-crm/db';
import { afterAll } from 'vitest';
import { createDomain, memberContext, newId, S3Storage, type ServiceContext, systemContext } from '../../src/index.ts';
import { databaseUrl, TEST_DATABASE } from './env.ts';

export const database = createDb({ connectionString: databaseUrl(), max: 6, applicationName: 'domain-tests' });
/** Record files go to a bucket of their own per suite (SeaweedFS at config.s3). */
export const storage = new S3Storage({ ...config.s3, bucket: TEST_DATABASE.replace(/_/g, '-') });
export const domain = createDomain({ database, storage });

afterAll(async () => {
  await database.destroy();
});

let seq = 0;
const unique = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function createUser(firstName = 'Ada', lastName = 'Lovelace') {
  const id = newId();
  const emailAddress = `${firstName.toLowerCase()}.${unique()}@example.com`;
  await database.kysely
    .insertInto('users')
    .values({ id, name: `${firstName} ${lastName}`, email: emailAddress, email_verified: true, image: null })
    .execute();
  return { userId: id, emailAddress, firstName, lastName };
}

export interface TestWorkspace {
  workspaceId: string;
  slug: string;
  memberId: string;
  user: Awaited<ReturnType<typeof createUser>>;
  /** Context of the admin member who created the workspace. */
  ctx: ServiceContext;
  /** System actor context in the same workspace. */
  sys: ServiceContext;
}

export async function createWorkspace(name = 'Test workspace'): Promise<TestWorkspace> {
  const user = await createUser();
  const slug = `ws-${unique()}`;
  const ws = await domain.workspaces.create(user, { name, slug });
  return {
    workspaceId: ws.id,
    slug,
    memberId: ws.membership.id,
    user,
    ctx: memberContext(ws.id, ws.membership.id),
    sys: systemContext(ws.id, 'test'),
  };
}

/** Expects a promise to reject with a DomainError carrying `code` (and optionally a status). */
export async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code !== code || (status !== undefined && e.statusCode !== status)) {
      throw new Error(`Expected ${code}${status ? ` (${status})` : ''}, got ${e.code} (${e.statusCode}): ${e.message}`);
    }
    return err as { code: string; statusCode: number; details: Record<string, unknown> };
  }
  throw new Error(`Expected ${code}, but the promise resolved`);
}

export const path = (entityDefinitionId: string, attributeDefinitionId: string) => [
  { entityDefinitionId, attributeDefinitionId },
];
export { newId };
