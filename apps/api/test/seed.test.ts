// The demo seed (`pnpm seed`): accounts that can sign in, the research-seed data set, idempotent re-runs.
import { randomUUID } from 'node:crypto';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSeedUsers, seedDemo, seedId } from '../src/seed/demo';
import type { AppRouter } from '../src/trpc/router';
import { authPost, cookieHeader, type Harness, startHarness, type TestUser, trpcCall } from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

describe('seed', () => {
  it('parses SEED_USERS with defaults', () => {
    expect(parseSeedUsers(undefined).map((u) => u.email)).toEqual(['admin@example.com', 'team@example.com']);
    expect(parseSeedUsers(' A@Example.com:Ann Lee , b@example.com ')).toEqual([
      { email: 'a@example.com', name: 'Ann Lee' },
      { email: 'b@example.com', name: 'b' },
    ]);
    expect(seedId('w', 'k')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seedId('w', 'k')).toBe(seedId('w', 'k'));
  });

  it('creates accounts, the workspace and the demo data once; re-runs change nothing', async () => {
    const tag = randomUUID().slice(0, 8);
    const users = [
      { email: `owner-${tag}@example.com`, name: 'Owner Person' },
      { email: `mate-${tag}@example.com`, name: 'Team Mate' },
    ];
    const slug = `demo-${tag}`;
    const first = await seedDemo({ domain: h.domain, auth: h.auth }, { users, workspaceSlug: slug });
    expect(first.workspace).toMatchObject({ slug, created: true });
    expect(first.agenticDemo.agentTabSlug).toBe('agent');
    expect(first.users.every((u) => typeof u.password === 'string' && u.password.length >= 16)).toBe(true);
    // 8 companies + 16 people + 12 projects + 5 deals
    expect(first.counts).toMatchObject({ companies: 8, people: 16, projects: 12, deals: 5, created: 41 });

    const again = await seedDemo({ domain: h.domain, auth: h.auth }, { users, workspaceSlug: slug });
    expect(again.workspace).toMatchObject({ id: first.workspace.id, created: false });
    expect(again.users.map((u) => u.password)).toEqual([null, null]);
    expect(again.counts.created).toBe(0);

    // The generated password signs in; the teammate is an admin of the workspace.
    const signIn = await authPost(h, '/sign-in/email', { email: users[1]?.email, password: first.users[1]?.password });
    expect(signIn.status).toBe(200);
    const mate: TestUser = {
      id: first.users[1]?.userId as string,
      email: users[1]?.email as string,
      name: 'Team Mate',
      cookie: cookieHeader(signIn),
    };
    const as = <T>(path: string, input?: unknown) => trpcCall<T>(h, path, input, { user: mate, slug });
    const current = await as<Out['workspaces']['current']>('workspaces.current');
    expect(current.membership.accessLevel).toBe('admin');
    const agentState = await as<Out['agentic']['recordState']>('agentic.recordState', {
      scope: {
        entityDefinitionId: first.agenticDemo.entityDefinitionId,
        entityInstanceId: first.agenticDemo.entityInstanceId,
      },
    });
    expect(agentState.unavailableActionCount).toBe(0);
    expect(agentState.actions).toHaveLength(1);
    expect(agentState.actions[0]).toMatchObject({
      action: {
        status: 'PROPOSED',
        proposal: { diff: { task: { content: { text: 'Send the rollout timeline by Friday' } } } },
      },
      evidence: [
        { snapshot: { band: 'VERIFIED', fragment: { quote: 'Could you send over the rollout timeline by Friday?' } } },
      ],
      receipt: null,
    });
    expect(agentState.tasks).toMatchObject([
      {
        status: 'QUEUED',
        actionId: agentState.actions[0]?.action.id,
        reason: 'The proposed follow-up task is paused for the assigned reviewer.',
      },
    ]);

    // The seeded reviewer can approve the exact persisted diff; the shared broker writes the CRM task,
    // immutable receipt and linked queue outcome, all without model credentials.
    const ownerSignIn = await authPost(h, '/sign-in/email', {
      email: users[0]?.email,
      password: first.users[0]?.password,
    });
    expect(ownerSignIn.status).toBe(200);
    const ownerUser: TestUser = {
      id: first.users[0]?.userId as string,
      email: users[0]?.email as string,
      name: 'Owner Person',
      cookie: cookieHeader(ownerSignIn),
    };
    const ownerCall = <T>(path: string, input?: unknown) => trpcCall<T>(h, path, input, { user: ownerUser, slug });
    const proposal = agentState.actions[0]?.action;
    const decided = await ownerCall<Out['agentic']['decide']>('agentic.decide', {
      id: randomUUID(),
      actionId: proposal?.id,
      proposalDigest: proposal?.digest,
      expectedVersion: proposal?.version,
      outcome: 'APPROVE',
    });
    expect(decided.status).toBe('APPROVED');
    const executed = await ownerCall<Out['agentic']['executeTaskCreate']>('agentic.executeTaskCreate', {
      id: randomUUID(),
      receiptId: randomUUID(),
      actionId: proposal?.id,
      proposalDigest: proposal?.digest,
      expectedVersion: decided.version,
    });
    expect(executed).toMatchObject({ action: { status: 'SUCCEEDED' }, receipt: { outcome: { outcome: 'SUCCEEDED' } } });
    const completed = await as<Out['agentic']['recordState']>('agentic.recordState', {
      scope: agentState.scope,
    });
    expect(completed.actions[0]).toMatchObject({
      action: { status: 'SUCCEEDED' },
      receipt: { id: executed.receipt?.id },
    });
    expect(completed.tasks[0]).toMatchObject({ status: 'SUCCEEDED', actionId: proposal?.id });

    const total = async (entityDefinitionId: string) =>
      (await as<Out['snapshots']['query']>('snapshots.query', { entityDefinitionId })).total;
    expect(await total('companies')).toBe(8);
    expect(await total('people')).toBe(16);
    expect(await total('projects')).toBe(12);
    expect(await total('deals')).toBe(5);

    const projectAttrs = await as<Out['schema']['attributes']['list']>('schema.attributes.list', {
      entityDefinitionId: 'projects',
    });
    const custom = projectAttrs.filter((a) => !a.isSystem);
    expect(new Set(custom.map((a) => a.type)).size).toBeGreaterThanOrEqual(15);
    const views = await as<Out['views']['list']>('views.list', { entityDefinitionId: 'projects' });
    expect(views.map((v) => [v.title, v.type])).toEqual([
      ['All Projects', 'table'],
      ['Projects by phase', 'kanban'],
    ]);
    // The view's sort (start date, newest first) runs on the projection.
    const byView = await as<Out['snapshots']['query']>('snapshots.query', {
      entityDefinitionId: 'projects',
      viewId: views[0]?.id,
    });
    expect(byView.total).toBe(12);
    const project = await as<Out['records']['get']>('records.get', {
      entityDefinitionId: 'projects',
      entityInstanceId: byView.ids[0],
    });
    const code = custom.find((a) => a.apiSlug === 'code')?.id as string;
    expect(project.values[code]?.[0]?.value).toBe('SEED-009'); // latest start date: 2026-11-01
    const dealViews = await as<Out['views']['list']>('views.list', { entityDefinitionId: 'deals' });
    expect(dealViews.map((v) => v.title)).toEqual(['Pipeline', 'All Deals']);
  }, 30_000);
});
