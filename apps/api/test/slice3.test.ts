// Slice 3 procedures over HTTP (BACKLOG §3): notes / templates, tasks, comments, favorites, files (E5), layouts,
// timeline (E2), record states, preferences, record and note presence rooms, personal invalidations.
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
let adminMemberId: string;
let memberMemberId: string;
let companies: string;
const slug = `s3-${Date.now().toString(36)}`;
const company = randomUUID();
const clients: WsClient[] = [];

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });
const record = () => ({ entityDefinitionId: companies, entityInstanceId: company });

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
  adminMemberId = created.memberIds.get(admin.id) as string;
  memberMemberId = created.memberIds.get(member.id) as string;
  await call(admin, 'records.put', {
    entityDefinitionId: 'companies',
    entityInstanceId: company,
    values: { name: [{ value: 'Acme' }] },
  });
  companies = (
    await call<Out['schema']['objects']['get']>(admin, 'schema.objects.get', { entityDefinitionId: 'companies' })
  ).id;
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('notes and templates', () => {
  it('creates, lists, updates and deletes notes with seq receipts', async () => {
    const id = randomUUID();
    const created = await call<Out['notes']['create']>(admin, 'notes.create', {
      id,
      title: 'Recap',
      parentRecords: [record()],
    });
    expect(created).toMatchObject({ note: { id, title: 'Recap', parentRecords: [record()] }, seq: expect.any(String) });
    const listed = await call<Out['notes']['list']>(member, 'notes.list', { record: record() });
    expect(listed.notes.map((n) => n.id)).toContain(id);
    const updated = await call<Out['notes']['update']>(admin, 'notes.update', { noteId: id, title: 'Recap v2' });
    expect(updated.note.title).toBe('Recap v2');
    const template = await call<Out['noteTemplates']['createFromNote']>(admin, 'noteTemplates.createFromNote', {
      id: randomUUID(),
      noteId: id,
    });
    expect(template.template).toMatchObject({ title: 'Recap v2', headerTitle: 'Recap v2' });
    expect(
      await call<Out['documents']['owner']>(admin, 'documents.owner', { documentId: created.note.documentId }),
    ).toEqual({
      kind: 'note',
      id,
    });
    await call(admin, 'notes.delete', { noteId: id });
    const missing = await trpcError(call(admin, 'notes.get', { noteId: id }));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ message: 'Note not found', additional_information: { code: 'NOT_FOUND' } });
  });

  it('answers 400 envelopes for invalid input', async () => {
    const err = await trpcError(call(admin, 'notes.create', { id: randomUUID(), parentRecords: [] }));
    expect(err.status).toBe(400);
  });
});

describe('tasks', () => {
  it('creates with a date deadline, completes optimistically-friendly, lists buckets in the viewer zone', async () => {
    const id = randomUUID();
    const created = await call<Out['tasks']['create']>(admin, 'tasks.create', {
      id,
      content: { text: 'Follow up', mentions: [] },
      deadline: { kind: 'date', date: '2026-10-16', timeZone: 'Europe/Moscow' },
      assigneeMemberIds: [memberMemberId],
      linkedRecords: [record()],
    });
    expect(created.task).toMatchObject({ deadlineAt: '2026-10-16T20:59:59.999000Z', deadlineHasTime: false });
    const done = await call<Out['tasks']['setCompleted']>(member, 'tasks.setCompleted', {
      taskId: id,
      completed: true,
    });
    expect(done).toMatchObject({
      task: { isCompleted: true, completedBy: { id: memberMemberId } },
      seq: expect.any(String),
    });
    const listed = await call<Out['tasks']['list']>(member, 'tasks.list', {
      timeZone: 'Europe/Moscow',
      filter: { records: { operator: 'is', records: [record()] } },
    });
    expect(listed.groups.map((g) => g.key)).toEqual(['completed']);
    const due = await call<Out['tasks']['countDue']>(member, 'tasks.countDue', { timeZone: 'UTC' });
    expect(due.count).toBe(0);
    const bulk = await call<Out['tasks']['bulkSetCompleted']>(admin, 'tasks.bulkSetCompleted', {
      taskIds: [id],
      completed: false,
    });
    expect(bulk.tasks[0]?.isCompleted).toBe(false);
    expect((await call<Out['tasks']['bulkDelete']>(admin, 'tasks.bulkDelete', { taskIds: [id] })).deletedIds).toEqual([
      id,
    ]);
  });
});

describe('comments', () => {
  it('threads, reactions, resolve, locate and author-only delete', async () => {
    const target = { kind: 'record', ...record() };
    const root = await call<Out['comments']['create']>(admin, 'comments.create', {
      id: randomUUID(),
      target,
      content: { text: 'Hi team', mentions: [], styles: [] },
    });
    const reply = await call<Out['comments']['create']>(member, 'comments.create', {
      id: randomUUID(),
      threadId: root.comment.id,
      content: { text: 'Hello', mentions: [], styles: [] },
    });
    await call(member, 'comments.addReaction', { commentId: root.comment.id, reactionId: randomUUID(), emoji: '🎉' });
    const threads = await call<Out['comments']['listThreads']>(admin, 'comments.listThreads', { target });
    expect(threads.threads[0]).toMatchObject({ replyCount: 1, root: { reactions: [{ emoji: '🎉', count: 1 }] } });
    expect(
      await call<Out['comments']['locate']>(admin, 'comments.locate', { commentId: reply.comment.id }),
    ).toMatchObject({
      threadId: root.comment.id,
      target,
    });
    const forbidden = await trpcError(call(admin, 'comments.delete', { commentId: reply.comment.id }));
    expect(forbidden.status).toBe(403);
    await call(admin, 'comments.resolve', { commentId: root.comment.id, resolved: true });
    const counts = await call<Out['comments']['counts']>(admin, 'comments.counts', {
      entityDefinitionId: 'companies',
      entityInstanceIds: [company],
    });
    expect(counts.counts[company]).toMatchObject({ threads: 1, unresolvedThreads: 0, comments: 2 });
  });
});

describe('favorites', () => {
  it('stars a record and sends the invalidation to that member only', async () => {
    const mine = await connect(admin);
    const theirs = await connect(member);
    await mine.subscribe(workspaceId);
    await theirs.subscribe(workspaceId);
    const fav = await call<Out['favorites']['put']>(admin, 'favorites.put', {
      id: randomUUID(),
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: company,
    });
    expect(fav.favorite.target).toEqual({ state: 'ok', label: 'Acme', secondaryLabel: 'Company' });
    await mine.next((m) => m.type === 'invalidate' && m.resource === 'favorite-list');
    await new Promise((r) => setTimeout(r, 300));
    expect(theirs.invalidations().some((m) => m.resource === 'favorite-list')).toBe(false);
    const folder = await call<Out['favorites']['putDirectory']>(admin, 'favorites.putDirectory', {
      id: randomUUID(),
      title: 'VIP',
    });
    await call(admin, 'favorites.move', {
      favoriteId: fav.favorite.id,
      directoryId: folder.directory.id,
      sortOrder: 'i',
    });
    const listed = await call<Out['favorites']['list']>(admin, 'favorites.list');
    expect(listed.favorites[0]?.directoryId).toBe(folder.directory.id);
    expect(
      (
        await call<Out['favorites']['deleteDirectory']>(admin, 'favorites.deleteDirectory', {
          directoryId: folder.directory.id,
        })
      ).deletedFavoriteIds,
    ).toEqual([fav.favorite.id]);
  });
});

describe('files (E5)', () => {
  it('uploads through a presigned PUT, completes, lists and downloads', async () => {
    const bytes = new TextEncoder().encode('quarterly report');
    const session = await call<Out['files']['createUploadSession']>(admin, 'files.createUploadSession', {
      id: randomUUID(),
      ...record(),
      filename: 'report.txt',
      contentType: 'text/plain',
      contentSize: bytes.byteLength,
    });
    const put = await fetch(session.upload.url, { method: 'PUT', headers: session.upload.headers, body: bytes });
    expect(put.ok).toBe(true);
    const done = await call<Out['files']['complete']>(admin, 'files.complete', { sessionId: session.session.id });
    expect(done.entry).toMatchObject({ name: 'report.txt', contentSize: bytes.byteLength });
    const listed = await call<Out['files']['list']>(member, 'files.list', record());
    expect(listed.entries.map((e) => e.name)).toContain('report.txt');
    const { url } = await call<Out['files']['downloadUrl']>(member, 'files.downloadUrl', { entryId: done.entry.id });
    expect(await (await fetch(url)).text()).toBe('quarterly report');
    const clash = await trpcError(
      call(admin, 'files.createFolder', { id: randomUUID(), ...record(), name: 'REPORT.txt' }),
    );
    expect(clash.status).toBe(409);
  });
});

describe('record page', () => {
  it('serves the layout and saves it with optimistic concurrency', async () => {
    const layout = await call<Out['layouts']['get']>(admin, 'layouts.get', { entityDefinitionId: 'companies' });
    const elements = layout.elements.map(({ isLocked: _l, isSystemElement: _s, createdAt: _c, ...rest }) => rest);
    const saved = await call<Out['layouts']['save']>(admin, 'layouts.save', {
      customLayoutId: layout.id,
      elements,
      expectedVersion: layout.version,
    });
    expect(saved.layout.version).toBe(layout.version + 1);
    const stale = await trpcError(
      call(admin, 'layouts.save', { customLayoutId: layout.id, elements, expectedVersion: layout.version }),
    );
    expect(stale.status).toBe(409);
  });

  it('lists the timeline and reports record states', async () => {
    const timeline = await call<Out['timeline']['list']>(member, 'timeline.list', {
      ...record(),
      filters: ['updates'],
    });
    expect(timeline.events.length).toBeGreaterThan(0);
    const state = await call<Out['recordPage']['state']>(member, 'recordPage.state', record());
    expect(state.state).toBe('live');
    const counts = await call<Out['recordPage']['relatedCounts']>(member, 'recordPage.relatedCounts', {
      entityDefinitionId: 'companies',
      entityInstanceIds: [company],
    });
    expect(counts.counts[company]?.comments).toBe(2);
  });

  it('stores the member calendar preferences', async () => {
    const updated = await call<Out['preferences']['update']>(member, 'preferences.update', {
      timeZone: 'Europe/Moscow',
      locale: 'ru-RU',
    });
    expect(updated.preferences).toMatchObject({
      timeZone: 'Europe/Moscow',
      weekStartDay: null,
      effectiveWeekStartDay: 1,
    });
    expect(await call<Out['preferences']['get']>(member, 'preferences.get')).toMatchObject({ locale: 'ru-RU' });
    expect((await call<Out['preferences']['get']>(admin, 'preferences.get')).locale).toBeNull();
  });
});

describe('presence rooms', () => {
  it('lets members into live readable records and notes only', async () => {
    const a = await connect(admin);
    const m = await connect(member);
    const room = `record:${workspaceId}:${companies}:${company}`;
    a.send({ type: 'join-room', room });
    m.send({ type: 'join-room', room });
    const both = await a.next<Presence>((x) => x.type === 'presence' && x.room === room && x.members.length === 2);
    expect(both.members.map((x) => x.userId).sort()).toEqual([admin.id, member.id].sort());
    m.send({ type: 'join-room', room: `record:${workspaceId}:${companies}:${randomUUID()}` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    m.send({ type: 'join-room', room: `record:${workspaceId}:${company}` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    const note = await call<Out['notes']['create']>(admin, 'notes.create', {
      id: randomUUID(),
      parentRecords: [record()],
    });
    const noteRoom = `note:${workspaceId}:${note.note.id}`;
    m.send({ type: 'join-room', room: noteRoom });
    await m.next((x) => x.type === 'presence' && x.room === noteRoom);
    m.send({ type: 'join-room', room: `note:${workspaceId}:${randomUUID()}` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    expect(adminMemberId).toBeTruthy();
  });
});
