// Slice 4 procedures over HTTP (BACKLOG §4, slice4-contracts.md): lists.*, entries.*, kanban.*, kanban settings via
// views.update, list attributes through schema.*, access levels on the wire, list/entry presence rooms and the
// invalidations an entry add produces.
import { randomUUID } from 'node:crypto';
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
type Presence = Extract<ServerToClient, { type: 'presence' }>;

let h: Harness;
let admin: TestUser;
let member: TestUser;
let workspaceId: string;
let memberMemberId: string;
let companies: string;
const slug = `s4-${Date.now().toString(36)}`;
const acme = randomUUID();
const globex = randomUUID();
const clients: WsClient[] = [];

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });

async function connect(user: TestUser) {
  const client = await WsClient.connect(h, user.cookie);
  clients.push(client);
  return client;
}

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  const created = await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }, { user: member }]);
  workspaceId = created.workspaceId;
  memberMemberId = created.memberIds.get(member.id) as string;
  for (const [id, name] of [
    [acme, 'Acme'],
    [globex, 'Globex'],
  ] as const) {
    await call(admin, 'records.put', {
      entityDefinitionId: 'companies',
      entityInstanceId: id,
      values: { name: [{ value: name }] },
    });
  }
  companies = (
    await call<Out['schema']['objects']['get']>(admin, 'schema.objects.get', { entityDefinitionId: 'companies' })
  ).id;
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('lists and entries over tRPC', () => {
  it('creates a list, adds a status attribute and entries, handles duplicates, removes entries', async () => {
    const listId = randomUUID();
    const created = await call<Out['lists']['create']>(admin, 'lists.create', {
      id: listId,
      name: 'Sales pipeline',
      icon: 'emoji:rocket',
      parentEntityDefinitionIds: ['companies'],
    });
    expect(created).toMatchObject({
      list: { id: listId, name: 'Sales pipeline', apiSlug: 'sales_pipeline', myAccess: 'full-access' },
      view: { title: 'All entries table', type: 'table' },
      seq: expect.any(String),
    });
    const sidebar = await call<Out['lists']['list']>(member, 'lists.list', {});
    expect(sidebar.map((l) => [l.id, l.myAccess])).toEqual([[listId, 'read-write']]);

    const stage = await call<Out['schema']['attributes']['create']>(admin, 'schema.attributes.create', {
      id: randomUUID(),
      entityDefinitionId: listId,
      title: 'Stage',
      type: 'pipeline',
      stages: [{ title: 'Lead' }, { title: 'Won', celebrationEnabled: true }],
    });
    const stages = await call<Out['schema']['statuses']['list']>(admin, 'schema.statuses.list', {
      entityDefinitionId: listId,
      attributeDefinitionId: stage.attribute.id,
    });
    const [lead, won] = stages.map((s) => s.id) as [string, string];
    const ref = (id: string) => ({ entityDefinitionId: 'companies', entityInstanceId: id });

    const entryId = randomUUID();
    const added = await call<Out['entries']['add']>(member, 'entries.add', {
      listId,
      parentRecords: [ref(acme)],
      entryIds: [entryId],
      values: { stage: [{ value: { pipelineStageId: won } }] },
      onDuplicate: 'cancel',
    });
    expect(added).toMatchObject({
      entries: [{ id: entryId }],
      duplicates: [],
      celebrate: true,
      seq: expect.any(String),
    });

    const check = await call<Out['entries']['checkDuplicates']>(member, 'entries.checkDuplicates', {
      listId,
      parentRecords: [ref(acme), ref(globex)],
    });
    expect(check).toMatchObject({ duplicateCount: 1, duplicates: [{ parentRecord: { entityInstanceId: acme } }] });
    const bulk = await call<Out['entries']['add']>(member, 'entries.add', {
      listId,
      parentRecords: [ref(acme), ref(globex)],
      values: { stage: [{ value: { pipelineStageId: lead } }] },
      onDuplicate: 'skip',
    });
    expect(bulk.entries.map((e) => e.parentRecord.entityInstanceId)).toEqual([globex]);

    const memberships = await call<Out['entries']['forRecord']>(member, 'entries.forRecord', {
      recordRef: { entityDefinitionId: companies, entityInstanceId: acme },
    });
    expect(memberships.memberships).toMatchObject([{ listId, entryId, list: { name: 'Sales pipeline' } }]);
    expect(await call<Out['entries']['get']>(member, 'entries.get', { listId, entryId })).toMatchObject({
      id: entryId,
      parentRecord: { entityDefinitionId: companies, entityInstanceId: acme },
    });

    // Entries are ordinary instances of the list: snapshots and values work with the list id.
    const snap = await call<Out['snapshots']['query']>(member, 'snapshots.query', { entityDefinitionId: listId });
    expect(snap.total).toBe(2);
    const removed = await call<Out['entries']['remove']>(member, 'entries.remove', { listId, entryIds: [entryId] });
    expect(removed).toMatchObject({ removedIds: [entryId], seq: expect.any(String) });

    const renamed = await call<Out['lists']['update']>(admin, 'lists.update', { listId, name: 'Pipeline' });
    expect(renamed.list.name).toBe('Pipeline');
    const copy = await call<Out['lists']['duplicate']>(admin, 'lists.duplicate', { listId, includeEntries: true });
    expect(copy.list).toMatchObject({ name: 'Pipeline (2)', entryCount: 1 });
    expect((await call<Out['lists']['delete']>(admin, 'lists.delete', { listId: copy.list.id })).id).toBe(copy.list.id);
    expect((await call<Out['lists']['list']>(admin, 'lists.list', {})).map((l) => l.id)).toEqual([listId]);
  });

  it('enforces list access levels on the wire', async () => {
    const { list } = await call<Out['lists']['create']>(admin, 'lists.create', {
      name: 'Private',
      parentEntityDefinitionIds: ['companies'],
      workspaceAccess: 'no-access',
    });
    expect((await call<Out['lists']['list']>(member, 'lists.list', {})).map((l) => l.id)).not.toContain(list.id);
    const denied = await trpcError(call(member, 'lists.get', { listId: list.id }));
    expect(denied.status).toBe(403);
    expect((await trpcError(call(member, 'snapshots.query', { entityDefinitionId: list.id }))).status).toBe(403);
    const policies = await call<Out['policies']['resolve']>(member, 'policies.resolve', {
      entityDefinitionIds: [list.id],
    });
    expect(policies.policies[list.id]).toMatchObject({ value: { read_entity_instance: false } });
    expect(
      (await trpcError(call(member, 'lists.setAccess', { listId: list.id, workspaceAccess: 'full-access' }))).status,
    ).toBe(403);
    const shared = await call<Out['lists']['setAccess']>(admin, 'lists.setAccess', {
      listId: list.id,
      memberAccess: [{ memberId: memberMemberId, scope: 'read-only' }],
    });
    expect(shared.list.memberAccess).toContainEqual({ memberId: memberMemberId, scope: 'read-only' });
    expect((await call<Out['lists']['get']>(member, 'lists.get', { listId: list.id })).myAccess).toBe('read-only');
    const write = await trpcError(
      call(member, 'entries.add', {
        listId: list.id,
        parentRecords: [{ entityDefinitionId: 'companies', entityInstanceId: acme }],
      }),
    );
    expect(write.status).toBe(403);
    expect((await call<Out['lists']['list']>(admin, 'lists.list', { scope: 'all' })).length).toBeGreaterThan(0);
    expect((await trpcError(call(member, 'lists.list', { scope: 'all' }))).status).toBe(403);
  });
});

describe('kanban over tRPC', () => {
  it('stores board settings via views.update, returns columns, moves cards and reports time in stage', async () => {
    const { list } = await call<Out['lists']['create']>(admin, 'lists.create', {
      name: 'Board list',
      parentEntityDefinitionIds: ['companies'],
    });
    const stage = await call<Out['schema']['attributes']['create']>(admin, 'schema.attributes.create', {
      id: randomUUID(),
      entityDefinitionId: list.id,
      title: 'Stage',
      type: 'pipeline',
      stages: [{ title: 'Lead' }, { title: 'Won', celebrationEnabled: true }],
    });
    const [lead, won] = (
      await call<Out['schema']['statuses']['list']>(admin, 'schema.statuses.list', {
        entityDefinitionId: list.id,
        attributeDefinitionId: stage.attribute.id,
      })
    ).map((s) => s.id) as [string, string];
    const { entries } = await call<Out['entries']['add']>(admin, 'entries.add', {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: 'companies', entityInstanceId: acme }],
      values: { stage: [{ value: { pipelineStageId: lead } }] },
    });
    const card = entries[0]?.id as string;
    const groupBy = [{ entityDefinitionId: list.id, attributeDefinitionId: stage.attribute.id }];
    const { view } = await call<Out['views']['create']>(admin, 'views.create', {
      id: randomUUID(),
      entityDefinitionId: list.id,
      type: 'kanban',
      title: 'Board',
      kanbanPivotPath: groupBy,
    });
    const updated = await call<Out['views']['update']>(admin, 'views.update', {
      viewId: view.id,
      kanban: { showLabels: true, calculation: { path: groupBy, aggregation: 'count_not_empty' } },
    });
    expect(updated.view.kanban).toMatchObject({ groupBy, showLabels: true, showNoStage: true });

    const cols = await call<Out['kanban']['columns']>(member, 'kanban.columns', {
      entityDefinitionId: list.id,
      viewId: view.id,
    });
    expect(cols.columns.map((c) => [c.stageId, c.total, c.aggregate?.value])).toEqual([
      [null, 0, 0],
      [lead, 1, 1],
      [won, 0, 0],
    ]);
    const chunk = await call<Out['kanban']['columnChunk']>(member, 'kanban.columnChunk', {
      entityDefinitionId: list.id,
      snapshotId: cols.columns[1]?.snapshotId,
      start: 0,
    });
    expect(chunk.ids).toEqual([card]);
    const moved = await call<Out['kanban']['move']>(member, 'kanban.move', {
      entityDefinitionId: list.id,
      entityInstanceId: card,
      groupBy,
      toStageId: won,
    });
    expect(moved).toMatchObject({ changed: true, celebrate: true, seq: expect.any(String) });
    const time = await call<Out['kanban']['timeInStage']>(member, 'kanban.timeInStage', {
      entityDefinitionId: list.id,
      entityInstanceIds: [card],
      groupBy,
    });
    expect(time.items[card]).toMatchObject({ stageId: won, days: 0, isOverdue: false });
  });
});

describe('list presence and invalidations', () => {
  it('lets readers into list and entry rooms only, and invalidates the list on adds', async () => {
    const { list } = await call<Out['lists']['create']>(admin, 'lists.create', {
      name: 'Rooms',
      parentEntityDefinitionIds: ['companies'],
    });
    const { list: hidden } = await call<Out['lists']['create']>(admin, 'lists.create', {
      name: 'Hidden',
      parentEntityDefinitionIds: ['companies'],
      workspaceAccess: 'no-access',
    });
    const { entries } = await call<Out['entries']['add']>(admin, 'entries.add', {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: 'companies', entityInstanceId: globex }],
    });
    const a = await connect(admin);
    const m = await connect(member);
    const room = `collection:${workspaceId}:${list.id}`;
    a.send({ type: 'join-room', room });
    m.send({ type: 'join-room', room });
    const both = await a.next<Presence>((x) => x.type === 'presence' && x.room === room && x.members.length === 2);
    expect(both.members.map((x) => x.userId).sort()).toEqual([admin.id, member.id].sort());
    m.send({ type: 'join-room', room: `collection:${workspaceId}:${hidden.id}` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    const entryRoom = `record:${workspaceId}:${list.id}:${entries[0]?.id}`;
    m.send({ type: 'join-room', room: entryRoom });
    await m.next((x) => x.type === 'presence' && x.room === entryRoom);

    await m.subscribe(workspaceId);
    const added = await call<Out['entries']['add']>(admin, 'entries.add', {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: 'companies', entityInstanceId: acme }],
    });
    const invalidation = await m.nextNew(
      (x) => x.type === 'invalidate' && x.resource === 'snapshot-selection' && x.resourceId === list.id,
      5_000,
    );
    expect(invalidation).toMatchObject({ type: 'invalidate' });
    await m.next(
      (x) => x.type === 'invalidate' && x.resource === 'record-timeline' && x.resourceId === companies,
      5_000,
    );
    expect(added.seq).toBeTruthy();
  });
});
