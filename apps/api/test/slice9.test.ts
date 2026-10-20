// Slice 9 procedures over HTTP (BACKLOG §9): dashboards.* / reports.* / reporting.* through tRPC with the Attio
// error envelope, dashboard grants through permissions.* (resourceKind 'dashboard'), and acceptance 3 end to end:
// a stage change made by one member reaches another member's data channel as a `report-stale` invalidation whose seq
// is newer than the freshness token of the cell's dataset (the "New data" pill), and a refetch clears it.
import { randomUUID } from 'node:crypto';
import { memberContext } from '@agentic-crm/domain';
import type { ServerToClient } from '@agentic-crm/realtime';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  type TrpcOptions,
  trpcCall,
  trpcError,
  WsClient,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;
type Invalidate = Extract<ServerToClient, { type: 'invalidate' }>;

let h: Harness;
let alice: TestUser;
let bob: TestUser;
let workspaceId: string;
let aliceMemberId: string;
let deals: string;
let stageAttr: string;
let stages: { id: string; title: string }[];
let dealId: string;
const slug = `s9-${Date.now().toString(36)}`;
const clients: WsClient[] = [];

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });

beforeAll(async () => {
  h = await startHarness();
  alice = await signUp(h, 'Alice Analyst');
  bob = await signUp(h, 'Bob Viewer');
  const created = await createWorkspaceWithMembers(h, slug, [{ user: alice, admin: true }, { user: bob }]);
  workspaceId = created.workspaceId;
  aliceMemberId = created.memberIds.get(alice.id) as string;
  const ctx = memberContext(workspaceId, aliceMemberId);
  const object = await h.domain.schema.createObject(ctx, {
    id: randomUUID(),
    apiSlug: 'deals_s9',
    singularNoun: 'Deal',
    pluralNoun: 'Deals',
  });
  deals = object.id;
  const stage = await h.domain.schema.createAttribute(ctx, {
    id: randomUUID(),
    entityDefinitionId: deals,
    title: 'Stage',
    type: 'pipeline',
    stages: [{ title: 'Lead' }, { title: 'Won' }],
  });
  stageAttr = stage.id;
  stages = (await h.domain.schema.listStages(ctx, { entityDefinitionId: deals, attributeDefinitionId: stageAttr })).map(
    (s) => ({ id: s.id, title: s.title }),
  );
  dealId = randomUUID();
  await h.domain.records.create(ctx, {
    entityDefinitionId: deals,
    entityInstanceId: dealId,
    values: { [stageAttr]: [{ value: { pipelineStageId: stages[0]?.id } }] },
  });
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('dashboards and reports over tRPC', () => {
  it('creates a dashboard and a report, lists, renames and lays out', async () => {
    const dashboardId = randomUUID();
    const created = await call<Out['dashboards']['create']>(alice, 'dashboards.create', { id: dashboardId });
    expect(created).toMatchObject({ dashboard: { id: dashboardId, title: 'New Dashboard' }, cells: [] });
    expect(created.seq).toEqual(expect.any(String));
    const report = await call<Out['reports']['create']>(alice, 'reports.create', {
      id: randomUUID(),
      cellId: randomUUID(),
      dashboardId,
      entityDefinitionId: deals,
      reportType: 'insights',
      settings: {
        primaryGrouping: { attributePath: [{ entityDefinitionId: deals, attributeDefinitionId: stageAttr }] },
      },
    });
    expect(report.report).toMatchObject({ reportType: 'insights', visualisationType: 'bar' });
    expect(report.cell.width).toBe(12);
    const list = await call<Out['dashboards']['list']>(alice, 'dashboards.list', {});
    expect(list.find((d) => d.id === dashboardId)?.reportCount).toBe(1);
    await call(alice, 'dashboards.update', { dashboardId, title: 'Pipeline' });
    const detail = await call<Out['dashboards']['get']>(alice, 'dashboards.get', { dashboardId });
    expect(detail.dashboard.title).toBe('Pipeline');
    const layout = await call<Out['dashboards']['setLayout']>(alice, 'dashboards.setLayout', {
      dashboardId,
      cells: [{ cellId: report.cell.id, sortOrder: report.cell.sortOrder, width: 6 }],
    });
    expect(layout.cells[0]?.width).toBe(6);
    const err = await trpcError(call(alice, 'dashboards.setLayout', { dashboardId, cells: [] }));
    expect(err.status).toBe(400);
    expect(err.body.additional_information).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('shares through permissions.* with resourceKind dashboard (read only → 403 on writes)', async () => {
    const dashboardId = randomUUID();
    await call(alice, 'dashboards.create', { id: dashboardId });
    await call(alice, 'permissions.put', {
      resourceKind: 'dashboard',
      resourceId: dashboardId,
      target: { type: 'workspace' },
      level: 'read-only',
    });
    const resolved = await call<Out['permissions']['resolve']>(bob, 'permissions.resolve', {
      resourceKind: 'dashboard',
      resourceIds: [dashboardId],
    });
    expect(resolved.resolved[dashboardId]).toMatchObject({
      state: 'complete',
      value: { level: 'read-only', flags: { read_reporting_dashboard: true, update_reporting_dashboard: false } },
    });
    const err = await trpcError(call(bob, 'dashboards.update', { dashboardId, title: 'Mine' }));
    expect(err.status).toBe(403);
    const notFound = await trpcError(call(bob, 'dashboards.get', { dashboardId: randomUUID() }));
    expect(notFound.status).toBe(404);

    // Presence on the dashboard (header avatars) needs read access.
    const ws = await WsClient.connect(h, bob.cookie);
    clients.push(ws);
    const room = `reporting-dashboard:${workspaceId}:${dashboardId}`;
    ws.send({ type: 'join-room', room });
    expect(await ws.next((m) => m.type === 'presence' && m.room === room)).toMatchObject({ type: 'presence' });
    await call(alice, 'permissions.put', {
      resourceKind: 'dashboard',
      resourceId: dashboardId,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    const again = await WsClient.connect(h, bob.cookie);
    clients.push(again);
    again.send({ type: 'join-room', room });
    expect(await again.nextNew((m) => m.type === 'error')).toMatchObject({ code: 'forbidden' });
    again.send({ type: 'join-room', room: `reporting-dashboard:${workspaceId}:${randomUUID()}` });
    expect(await again.nextNew((m) => m.type === 'error')).toMatchObject({ code: 'forbidden' });
  });
});

describe('reporting.dataset and the New data pill (acceptance 3)', () => {
  it('delivers report-stale to another member after a stage change and the refetch is fresh', async () => {
    const dashboardId = randomUUID();
    await call(alice, 'dashboards.create', { id: dashboardId });
    const { report } = await call<Out['reports']['create']>(alice, 'reports.create', {
      id: randomUUID(),
      cellId: randomUUID(),
      dashboardId,
      entityDefinitionId: deals,
      reportType: 'insights',
      settings: {
        primaryGrouping: { attributePath: [{ entityDefinitionId: deals, attributeDefinitionId: stageAttr }] },
      },
    });
    // Bob's tab shows the cell.
    const first = await call<Out['reporting']['reportDataset']>(bob, 'reporting.reportDataset', {
      reportId: report.id,
      timeZone: 'Europe/Moscow',
    });
    // Show zeros is on by default, so empty stages stay on the axis with a zero row (S9: includeEmptyGroups).
    const nonEmpty = (rows: { count: number }[]) => rows.filter((r) => r.count > 0);
    expect(nonEmpty(first.rows)).toEqual([{ group: stages[0]?.id, segment: null, value: 1, count: 1 }]);
    expect(first.meta.groups.primary?.[0]?.label).toBe('Lead');
    const ws = await WsClient.connect(h, bob.cookie);
    clients.push(ws);
    await ws.subscribe(workspaceId);

    // Alice moves the deal in another tab.
    const write = await call<Out['values']['put']>(alice, 'values.put', {
      entityDefinitionId: deals,
      entityInstanceId: dealId,
      attributeDefinitionId: stageAttr,
      attributeValueId: randomUUID(),
      value: { pipelineStageId: stages[1]?.id },
    });
    const stale = await ws.next<Invalidate>((m) => m.type === 'invalidate' && m.resource === 'report-stale', 5_000);
    expect(stale).toMatchObject({
      resourceId: deals,
      scope: { entityDefinitionId: deals, attributeDefinitionIds: [stageAttr] },
    });
    // The client's rule: stale when seq > freshness.seq and the definition/attributes intersect the dependencies.
    expect(BigInt(stale.seq) > BigInt(first.freshness.seq)).toBe(true);
    expect(first.freshness.entityDefinitionIds).toContain(stale.scope.entityDefinitionId);
    expect(first.freshness.attributeDefinitionIds).toEqual(
      expect.arrayContaining(stale.scope.attributeDefinitionIds as string[]),
    );
    expect(BigInt(stale.seq) <= BigInt(write.seq as string)).toBe(true);

    // "New data" → refetch with acceptAfter: the new numbers and a token at least as new as the invalidation.
    const refreshed = await call<Out['reporting']['reportDataset']>(
      bob,
      'reporting.reportDataset',
      { reportId: report.id, timeZone: 'Europe/Moscow' },
      { acceptAfter: stale.seq },
    );
    expect(nonEmpty(refreshed.rows)).toEqual([{ group: stages[1]?.id, segment: null, value: 1, count: 1 }]);
    expect(BigInt(refreshed.freshness.seq) >= BigInt(stale.seq)).toBe(true);
  });

  it('runs raw dataset queries and answers validation errors with the envelope', async () => {
    const funnel = await call<Out['reporting']['dataset']>(alice, 'reporting.dataset', {
      type: 'funnel',
      entityDefinitionId: deals,
      statusAttributePath: [{ entityDefinitionId: deals, attributeDefinitionId: stageAttr }],
      stageIds: stages.map((s) => s.id),
      includeAllRecords: true,
      timeZone: 'UTC',
    });
    expect(funnel.type).toBe('funnel');
    expect(funnel.rows.map((r) => ('stage' in r ? r.count : null))).toEqual([1, 1, 1]);
    const err = await trpcError(
      call(alice, 'reporting.dataset', { type: 'pivot', entityDefinitionId: deals, timeZone: 'Nowhere/City' }),
    );
    expect(err.status).toBe(400);
  });
});
