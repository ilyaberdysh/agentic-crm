import { memberContext, newId } from '@agentic-crm/domain';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Context } from '../src/trpc/trpc';
import {
  adminProcedure,
  authedProcedure,
  createCallerFactory,
  router,
  trpcErrorEnvelope,
  workspaceProcedure,
} from '../src/trpc/trpc';
import {
  addMember,
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  WEB_ORIGIN,
} from './support/harness';

let h: Harness;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
const slug = `acme-${Date.now()}`;
const otherSlug = `globex-${Date.now()}`;
let workspaceId: string;
let adminMemberId: string;

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Alice Admin');
  member = await signUp(h, 'Bob Member');
  outsider = await signUp(h, 'Olga Outsider');
  const created = await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }, { user: member }]);
  workspaceId = created.workspaceId;
  adminMemberId = created.memberIds.get(admin.id) as string;
  await createWorkspaceWithMembers(h, otherSlug, [{ user: outsider, admin: true }]);
});
afterAll(async () => {
  await h?.close();
});

interface TrpcErrorBody {
  error: {
    message: string;
    code: number;
    data: { code: string; httpStatus: number; path: string };
    statusCode: number;
    error: string;
    status_code: number;
    additional_information?: Record<string, unknown>;
  };
}

async function query(path: string, opts: { cookie?: string; slug?: string; input?: unknown } = {}) {
  const url = new URL(`${h.baseUrl}/trpc/${path}`);
  if (opts.input !== undefined) url.searchParams.set('input', JSON.stringify(opts.input));
  return fetch(url, {
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.slug ? { 'x-workspace-slug': opts.slug } : {}),
    },
  });
}

async function mutate(path: string, opts: { cookie: string; slug: string; input: unknown }) {
  return fetch(`${h.baseUrl}/trpc/${path}`, {
    method: 'POST',
    headers: {
      cookie: opts.cookie,
      'x-workspace-slug': opts.slug,
      'content-type': 'application/json',
      origin: WEB_ORIGIN,
    },
    body: JSON.stringify(opts.input),
  });
}

describe('product module administration', () => {
  it('lists and toggles only in the admin workspace', async () => {
    const before = await query('agentic.modules.list', { cookie: admin.cookie, slug });
    expect(before.status).toBe(200);
    expect((await before.json()) as unknown).toMatchObject({
      result: { data: [{ module: { id: 'record-follow-up' }, enabled: true }] },
    });
    expect((await query('agentic.modules.list', { cookie: member.cookie, slug })).status).toBe(403);
    expect(
      (
        await mutate('agentic.modules.update', {
          cookie: member.cookie,
          slug,
          input: { moduleId: 'record-follow-up', enabled: false },
        })
      ).status,
    ).toBe(403);
    const changed = await mutate('agentic.modules.update', {
      cookie: admin.cookie,
      slug,
      input: { moduleId: 'record-follow-up', enabled: false },
    });
    expect(changed.status).toBe(200);
    expect((await changed.json()) as unknown).toMatchObject({
      result: { data: { module: { module: { id: 'record-follow-up' }, enabled: false } } },
    });
    expect((await h.domain.productModules.list(memberContext(workspaceId, adminMemberId)))[0]?.enabled).toBe(false);
    await mutate('agentic.modules.update', {
      cookie: admin.cookie,
      slug,
      input: { moduleId: 'record-follow-up', enabled: true },
    });
  });
});

describe('agent execution reconciliation', () => {
  it('permits only admins and accepts only an action identity', async () => {
    const actionId = newId();
    expect(
      (
        await mutate('agentic.reconcileExecuting', {
          cookie: member.cookie,
          slug,
          input: { actionId },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mutate('agentic.reconcileExecuting', {
          cookie: admin.cookie,
          slug,
          input: { actionId, outcome: 'SUCCEEDED' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate('agentic.reconcileExecuting', {
          cookie: admin.cookie,
          slug,
          input: { actionId },
        })
      ).status,
    ).toBe(404);
  });
});

describe('me', () => {
  it('requires a session: 401 with the Attio envelope', async () => {
    const response = await query('me');
    expect(response.status).toBe(401);
    const body = (await response.json()) as TrpcErrorBody;
    expect(body.error).toMatchObject({
      message: 'The requesting user did not present an authentication token',
      statusCode: 401,
      error: 'Unauthorized',
      status_code: 401,
      data: { code: 'UNAUTHORIZED', httpStatus: 401, path: 'me' },
    });
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('returns the user and session', async () => {
    const response = await query('me', { cookie: member.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { data: { user: Record<string, unknown>; session: Record<string, unknown> } };
    };
    expect(body.result.data.user).toMatchObject({ id: member.id, email: member.email, name: 'Bob Member' });
    expect(typeof body.result.data.session.id).toBe('string');
  });
});

describe('workspaces', () => {
  it('list returns only the caller’s workspaces with their access level', async () => {
    const response = await query('workspaces.list', { cookie: admin.cookie });
    const body = (await response.json()) as {
      result: { data: { slug: string; membership: { accessLevel: string } }[] };
    };
    expect(body.result.data).toEqual([
      expect.objectContaining({ slug, membership: expect.objectContaining({ accessLevel: 'admin' }) }),
    ]);
  });

  it('current resolves the workspace from the x-workspace-slug header', async () => {
    const response = await query('workspaces.current', { cookie: member.cookie, slug });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { data: { slug: string; membership: { accessLevel: string } } } };
    expect(body.result.data).toMatchObject({ slug, membership: { accessLevel: 'member' } });
  });

  it('current resolves the workspace from the input', async () => {
    const response = await query('workspaces.current', { cookie: member.cookie, input: { workspaceSlug: slug } });
    expect(response.status).toBe(200);
  });

  it('refuses non-members (403), unknown workspaces (404) and a missing workspace (400)', async () => {
    const forbidden = await query('workspaces.current', { cookie: outsider.cookie, slug });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as TrpcErrorBody).error).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You are not a member of this workspace',
    });
    const missing = await query('workspaces.current', { cookie: outsider.cookie, slug: 'no-such-workspace' });
    expect(missing.status).toBe(404);
    const noSlug = await query('workspaces.current', { cookie: outsider.cookie });
    expect(noSlug.status).toBe(400);
  });

  it('refuses a suspended member', async () => {
    const suspended = await signUp(h, 'Sam Suspended');
    const memberId = await addMember(h, workspaceId, { memberId: adminMemberId }, suspended);
    await h.domain.members.updateAccessLevel(memberContext(workspaceId, adminMemberId), {
      memberId,
      accessLevel: 'suspended',
    });
    expect((await query('workspaces.current', { cookie: suspended.cookie, slug })).status).toBe(403);
    const list = (await (await query('workspaces.list', { cookie: suspended.cookie })).json()) as {
      result: { data: unknown[] };
    };
    expect(list.result.data).toEqual([]);
  });
});

describe('middleware (caller)', () => {
  const testRouter = router({
    whoami: authedProcedure.query(({ ctx }) => ctx.user.id),
    workspace: workspaceProcedure.query(({ ctx }) => ctx.workspace.slug),
    adminOnly: adminProcedure.query(({ ctx }) => `admin of ${ctx.workspace.slug}`),
    conflict: authedProcedure.mutation(() => {
      // A domain service error (duck-typed): code + additional information.
      throw Object.assign(new Error('This slug is already in use'), {
        code: 'CONFLICT',
        additionalInformation: { conflicting_field: 'api_slug' },
      });
    }),
    uniqueViolation: authedProcedure.mutation(async () => {
      await h.db.query('INSERT INTO workspaces (id, slug, name) VALUES (uuidv7(), $1, $2)', [slug, 'Duplicate']);
    }),
    crash: authedProcedure.query(() => {
      throw new Error('secret internals: password=hunter2');
    }),
  });
  const createCaller = createCallerFactory(testRouter);

  async function contextFor(user: TestUser | null, workspaceSlug: string | null = null): Promise<Context> {
    const session = user ? await h.auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) }) : null;
    return {
      requestId: 'test',
      log: h.app.log,
      user: session?.user ?? null,
      session: session?.session ?? null,
      workspaces: h.workspaces,
      domain: h.domain,
      policies: new Map(),
      workspaceSlug,
      acceptAfter: null,
    };
  }

  async function errorOf(promise: Promise<unknown>): Promise<TRPCError> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof TRPCError) return err;
      throw err;
    }
    throw new Error('expected an error');
  }

  it('auth required', async () => {
    const err = await errorOf(createCaller(await contextFor(null)).whoami());
    expect(err.code).toBe('UNAUTHORIZED');
    expect(await createCaller(await contextFor(member)).whoami()).toBe(member.id);
  });

  it('workspace member required', async () => {
    expect(await createCaller(await contextFor(member, slug)).workspace()).toBe(slug);
    expect((await errorOf(createCaller(await contextFor(outsider, slug)).workspace())).code).toBe('FORBIDDEN');
  });

  it('admin required', async () => {
    expect(await createCaller(await contextFor(admin, slug)).adminOnly()).toBe(`admin of ${slug}`);
    const err = await errorOf(createCaller(await contextFor(member, slug)).adminOnly());
    expect(err.code).toBe('FORBIDDEN');
    expect(trpcErrorEnvelope(err)).toMatchObject({ statusCode: 403, message: 'Only workspace admins can do this' });
  });

  it('maps a domain conflict to the 409 envelope with additional_information', async () => {
    const err = await errorOf(createCaller(await contextFor(member)).conflict());
    expect(err.code).toBe('CONFLICT');
    expect(trpcErrorEnvelope(err)).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'This slug is already in use',
      status_code: 409,
      additional_information: { conflicting_field: 'api_slug' },
    });
  });

  it('maps a Postgres unique violation to 409', async () => {
    const err = await errorOf(createCaller(await contextFor(member)).uniqueViolation());
    expect(trpcErrorEnvelope(err)).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      additional_information: { constraint: 'workspaces_slug' },
    });
  });

  it('hides internals of unexpected errors', async () => {
    const err = await errorOf(createCaller(await contextFor(member)).crash());
    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
    expect(trpcErrorEnvelope(err)).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      status_code: 500,
    });
  });
});

describe('csrf', () => {
  it('refuses cookie-authenticated tRPC writes from a foreign origin', async () => {
    const response = await fetch(`${h.baseUrl}/trpc/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: member.cookie },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ statusCode: 403, message: 'Origin not allowed' });
  });

  it('lets the web origin through (queries may be POSTed: method override)', async () => {
    const response = await fetch(`${h.baseUrl}/trpc/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, cookie: member.cookie },
    });
    expect(response.status).toBe(200);
  });

  it('keeps mutations POST-only', async () => {
    const url = new URL(`${h.baseUrl}/trpc/workspaces.create`);
    url.searchParams.set('input', JSON.stringify({ name: 'Nope', slug: `nope-${Date.now()}` }));
    const response = await fetch(url, { headers: { cookie: member.cookie } });
    expect(response.status).toBe(405);
  });
});
