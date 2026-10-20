// Slice 5 procedures over HTTP (BACKLOG §5): search.records (ranking, list memberships, requestSeq echo for the
// client's stale-response guard), notifications (a comment mention reaches the other member live on their user
// channel and only there; badge; opening marks read; preferences) and home.summary.
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
  type TrpcOptions,
  trpcCall,
  trpcError,
  WsClient,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let member: TestUser;
let workspaceId: string;
let memberMemberId: string;
let companies: string;
const slug = `s5-${Date.now().toString(36)}`;
const acme = randomUUID();
const clients: WsClient[] = [];

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });

async function connect(user: TestUser) {
  const client = await WsClient.connect(h, user.cookie);
  clients.push(client);
  await client.subscribe(workspaceId);
  return client;
}

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  const created = await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }, { user: member }]);
  workspaceId = created.workspaceId;
  memberMemberId = created.memberIds.get(member.id) as string;
  await call(admin, 'records.put', {
    entityDefinitionId: 'companies',
    entityInstanceId: acme,
    values: { name: [{ value: 'Acme' }], domains: [{ value: 'acme.com' }] },
  });
  companies = (
    await call<Out['schema']['objects']['get']>(admin, 'schema.objects.get', { entityDefinitionId: 'companies' })
  ).id;
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('search.records', () => {
  it('ranks hits with list memberships and echoes requestSeq for the stale-response guard', async () => {
    const list = await call<Out['lists']['create']>(admin, 'lists.create', {
      name: 'Pipeline',
      parentEntityDefinitionIds: ['companies'],
    });
    await call(admin, 'entries.add', {
      listId: list.list.id,
      parentRecords: [{ entityDefinitionId: companies, entityInstanceId: acme }],
    });
    // Keystrokes fire in order; responses may arrive in any order and carry their own seq.
    const [older, newer] = await Promise.all([
      call<Out['search']['records']>(member, 'search.records', { query: 'ac', requestSeq: 1 }),
      call<Out['search']['records']>(member, 'search.records', { query: 'acme', requestSeq: 2 }),
    ]);
    expect(older.requestSeq).toBe(1);
    expect(newer.requestSeq).toBe(2);
    expect(newer.hits[0]).toMatchObject({
      entityInstanceId: acme,
      title: 'Acme',
      subtitle: 'acme.com',
      matchedField: 'name',
      highlights: [{ start: 0, length: 4 }],
      score: 1000,
      lists: [{ listId: list.list.id, name: 'Pipeline', entryIds: [expect.any(String)] }],
    });
    expect(newer.groups).toEqual([{ entityDefinitionId: companies, entityInstanceIds: [acme] }]);
    const bad = await trpcError(call(member, 'search.records', { query: 'x', requestSeq: -1 }));
    expect(bad.status).toBe(400);
  });
});

describe('notifications', () => {
  it('delivers a comment mention live to the mentioned member only; opening it marks it read', async () => {
    const adminWs = await connect(admin);
    const memberWs = await connect(member);
    const commentId = randomUUID();
    const text = 'Can you check @Max';
    await call(admin, 'comments.create', {
      id: commentId,
      target: { kind: 'record', entityDefinitionId: companies, entityInstanceId: acme },
      content: {
        text,
        mentions: [{ kind: 'workspace-member', start: 14, length: 4, memberId: memberMemberId }],
      },
    });
    const live = await memberWs.next((m) => m.type === 'invalidate' && m.resource === 'notification');
    expect(live).toMatchObject({ workspaceId, scope: { memberId: memberMemberId, topic: 'mentions' } });
    const badge = await call<Out['notifications']['unreadCount']>(member, 'notifications.unreadCount', {
      acceptAfter: (live as { seq: string }).seq,
    });
    expect(badge).toMatchObject({ count: 1, byTopic: { mentions: 1 } });
    const inbox = await call<Out['notifications']['list']>(member, 'notifications.list', { state: 'unread' });
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      type: 'comment-mentioned',
      isRead: false,
      subject: { kind: 'comment', commentId, text, record: { entityInstanceId: acme, title: 'Acme' } },
    });
    // The author's channel never carries the member's notification.
    await adminWs.nextNew((m) => m.type === 'invalidate' && m.resource === 'comment-thread').catch(() => undefined);
    expect(adminWs.invalidations().some((m) => m.resource === 'notification')).toBe(false);
    expect((await call<Out['notifications']['unreadCount']>(admin, 'notifications.unreadCount')).count).toBe(0);

    const opened = await call<Out['notifications']['markRead']>(member, 'notifications.markRead', {
      ids: [inbox.items[0]?.id],
    });
    expect(opened).toMatchObject({ updated: 1, seq: expect.any(String) });
    await memberWs.next((m) => m.type === 'invalidate' && m.resource === 'notification' && m.seq === opened.seq);
    expect((await call<Out['notifications']['unreadCount']>(member, 'notifications.unreadCount')).count).toBe(0);
    const unread = await call<Out['notifications']['markUnread']>(member, 'notifications.markUnread', {
      ids: [inbox.items[0]?.id],
    });
    expect(unread.updated).toBe(1);
    const archived = await call<Out['notifications']['archive']>(member, 'notifications.archive', { all: true });
    expect(archived.updated).toBe(1);
    expect((await call<Out['notifications']['unreadCount']>(member, 'notifications.unreadCount')).count).toBe(0);
    const bad = await trpcError(call(member, 'notifications.markRead', {}));
    expect(bad.status).toBe(400);
  });

  it('reads and updates preferences per group and channel', async () => {
    const prefs = await call<Out['notifications']['preferences']['get']>(member, 'notifications.preferences.get');
    expect(prefs.groups.find((g) => g.group === 'tasks')).toMatchObject({ title: 'Task Assignments' });
    const updated = await call<Out['notifications']['preferences']['update']>(
      member,
      'notifications.preferences.update',
      { group: 'tasks', channel: 'email', enabled: false },
    );
    expect(updated.seq).toEqual(expect.any(String));
    expect(updated.groups.find((g) => g.group === 'tasks')?.channels).toEqual([
      { channel: 'in-app', available: true, enabled: true },
      { channel: 'email', available: true, enabled: false },
    ]);
    const bad = await trpcError(
      call(member, 'notifications.preferences.update', { group: 'daily-digest', channel: 'in-app', enabled: true }),
    );
    expect(bad.status).toBe(400);
  });
});

describe('home.summary', () => {
  it('greets the member and lists their tasks', async () => {
    const taskId = randomUUID();
    await call(admin, 'tasks.create', {
      id: taskId,
      content: { text: 'Prepare the demo' },
      assigneeMemberIds: [memberMemberId],
      deadline: { kind: 'date', date: '2026-10-14', timeZone: 'Europe/Berlin' },
    });
    const summary = await call<Out['home']['summary']>(member, 'home.summary', {
      timeZone: 'Europe/Berlin',
      now: '2026-10-14T05:00:00.000Z',
    });
    expect(summary.greeting).toEqual({ partOfDay: 'morning', firstName: 'Max', text: 'Good morning, Max.' });
    expect(summary.tasks).toMatchObject({ total: 1, today: 1, items: [{ bucket: 'today', task: { id: taskId } }] });
    expect(summary.recentRecords.map((r) => r.entityInstanceId)).toContain(acme);
    // The assignment reached the member's inbox.
    const inbox = await call<Out['notifications']['list']>(member, 'notifications.list', {
      topic: 'task-assignments',
    });
    expect(inbox.items[0]).toMatchObject({ type: 'task-assigned', subject: { kind: 'task', taskId } });
  });
});
