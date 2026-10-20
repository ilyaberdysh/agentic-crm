// Notifications (BACKLOG 5.05–5.06; B-shell/notifications.md; CROSS-DOMAIN B.27): the type registry, every producer
// (comment mention, reply to a thread you are in, task assignment, note mention, list shared with you), no
// self-notifications, recipients' read access, dedupe and grouping (key + max gap), realtime change_log rows with the
// recipient as audience, the inbox procedures (list / filters / paging / read / unread / archive / unread count) and
// preferences per group × channel with the email delivery stub.
import {
  flagsForScope,
  NOTIFICATION_PREFERENCE_GROUPS,
  NOTIFICATION_TYPES,
  notificationTopics,
  notificationTypes,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { type Block, blocksToState } from '@agentic-crm/editor/model';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDomain, type PolicyResolver, type ServiceContext } from '../src/index.ts';
import { addMember, type CollabFixture, changeRows, collabFixture, lastChangeId } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

interface Member {
  memberId: string;
  userId: string;
  ctx: ServiceContext;
}

let f: CollabFixture;
let ada: Member;
let bob: Member;
let cara: Member;

const mention = (text: string, member: Member) => ({
  text: `${text} @${member.memberId.slice(0, 4)}`,
  mentions: [{ kind: 'workspace-member' as const, start: text.length + 1, length: 5, memberId: member.memberId }],
});

async function comment(by: Member, content: { text: string; mentions?: unknown[] }, threadId?: string) {
  return domain.comments.create(by.ctx, {
    id: newId(),
    content: content as never,
    ...(threadId ? { threadId } : { target: { kind: 'record', ...f.record } }),
  });
}

const inbox = (m: Member, extra: Record<string, unknown> = {}) => domain.notifications.list(m.ctx, extra);

beforeAll(async () => {
  f = await collabFixture();
  const { rows } = await sql<{ user_id: string }>`
    SELECT user_id FROM workspace_members WHERE id = ${f.memberId}`.execute(database.kysely);
  ada = { memberId: f.memberId, userId: rows[0]?.user_id as string, ctx: f.ctx };
  bob = await addMember(f, 'Bob');
  cara = await addMember(f, 'Cara');
});

describe('registry', () => {
  it('has the notification types plus list-shared and workflow-run-failed in 11 topics with grouping keys from their payloads', () => {
    expect(notificationTopics).toHaveLength(11);
    expect(notificationTypes).toHaveLength(26);
    const groups = new Set(NOTIFICATION_PREFERENCE_GROUPS.map((g) => g.group));
    for (const type of notificationTypes) {
      const info = NOTIFICATION_TYPES[type];
      expect(info.type).toBe(type);
      expect(notificationTopics).toContain(info.topic);
      expect(groups.has(info.preferenceGroup)).toBe(true);
      expect(info.channels).toContain('app');
      if (info.groupBy !== null && info.groupBy !== 'constant') expect(info.payload).toContain(info.groupBy);
      if (info.groupBy !== null) expect(info.maxGapMs).toBeGreaterThan(0);
    }
    expect(new Set(notificationTypes.map((t) => NOTIFICATION_TYPES[t].topic)).size).toBe(11);
    expect(NOTIFICATION_TYPES['comment-mentioned']).toMatchObject({ groupBy: 'commentId', maxGapMs: 86_400_000 });
    expect(NOTIFICATION_TYPES['workflow-message'].groupBy).toBeNull();
  });
});

describe('comment producers', () => {
  it('notifies a mentioned member live (audience = their user), never the author', async () => {
    const since = await lastChangeId(f.workspaceId);
    const c = await comment(ada, mention('Look at this', bob));
    const { items } = await inbox(bob);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'comment-mentioned',
      topic: 'mentions',
      preferenceGroup: 'mentions',
      isRead: false,
      unreadCount: 1,
      actors: [{ type: 'workspace-member', id: ada.memberId }],
      subject: {
        kind: 'comment',
        commentId: c.id,
        threadId: c.id,
        text: c.content.text,
        record: { entityInstanceId: f.company, title: 'Acme', isUnavailable: false },
        isUnavailable: false,
      },
    });
    expect(items[0]?.entries[0]?.payload).toMatchObject({ commentId: c.id, entityInstanceId: f.company });
    expect((await domain.notifications.unreadCount(bob.ctx)).count).toBe(1);
    expect((await inbox(ada)).items).toEqual([]);
    const rows = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'notification');
    expect(rows).toEqual([expect.objectContaining({ resource_id: items[0]?.id, audience: { userIds: [bob.userId] } })]);
    // Self-mentions create nothing; an idempotent replay creates nothing more.
    await comment(ada, mention('Note to self', ada));
    expect((await inbox(ada)).items).toEqual([]);
    await domain.comments.create(ada.ctx, {
      id: c.id,
      content: c.content as never,
      target: { kind: 'record', ...f.record },
    });
    expect((await inbox(bob)).items).toHaveLength(1);
  });

  it('notifies thread participants of replies, grouped per thread; a mention wins over a reply', async () => {
    const root = await comment(ada, { text: 'Thread start' });
    await comment(bob, { text: 'First reply' }, root.id);
    await comment(cara, { text: 'Second reply' }, root.id);
    const adaRows = (await inbox(ada, { topic: 'replies' })).items;
    expect(adaRows).toHaveLength(1);
    expect(adaRows[0]).toMatchObject({
      type: 'comment-replied',
      entryCount: 2,
      unreadCount: 2,
      actorCount: 2,
      actors: [
        { type: 'workspace-member', id: cara.memberId },
        { type: 'workspace-member', id: bob.memberId },
      ],
      subject: { kind: 'comment', threadId: root.id },
    });
    // Bob replied in the thread, so Cara's reply notifies him too.
    expect((await inbox(bob, { topic: 'replies' })).items).toHaveLength(1);
    // Cara mentions Ada in a reply: Ada gets the mention only.
    const before = (await inbox(ada, { topic: 'replies' })).items[0]?.entryCount;
    await comment(cara, mention('Ping', ada), root.id);
    expect((await inbox(ada, { topic: 'replies' })).items[0]?.entryCount).toBe(before);
    expect((await inbox(ada, { topic: 'mentions' })).items[0]).toMatchObject({ type: 'comment-mentioned' });
  });

  it('starts a new row after the max gap', async () => {
    const root = await comment(ada, { text: 'Old thread' });
    await comment(bob, { text: 'Reply 1' }, root.id);
    await sql`UPDATE notification_groups SET latest_entry_at = latest_entry_at - interval '9 hours'
      WHERE recipient_member_id = ${ada.memberId} AND group_key = ${`comment-replied:${root.id}`}`.execute(
      database.kysely,
    );
    await comment(bob, { text: 'Reply 2' }, root.id);
    const rows = (await inbox(ada, { topic: 'replies' })).items.filter(
      (i) => i.subject?.kind === 'comment' && i.subject.threadId === root.id,
    );
    expect(rows.map((r) => r.entryCount)).toEqual([1, 1]);
  });

  it('does not notify members who cannot read the record', async () => {
    const noCompaniesForBob: PolicyResolver = {
      async resolve(_tx, subject, definitions) {
        return new Map(
          definitions.map((d) => [
            d.id,
            flagsForScope(subject.memberId === bob.memberId && d.apiSlug === 'companies' ? 'no-access' : 'full-access'),
          ]),
        );
      },
    };
    const restricted = createDomain({ database, policyResolver: noCompaniesForBob });
    const before = (await inbox(bob)).items.length;
    await restricted.comments.create(ada.ctx, {
      id: newId(),
      content: mention('Secret', bob) as never,
      target: { kind: 'record', ...f.record },
    });
    expect((await inbox(bob)).items).toHaveLength(before);
  });
});

describe('task, note and list producers', () => {
  it('notifies new assignees on create and edit, not the actor', async () => {
    const taskId = newId();
    await domain.tasks.create(ada.ctx, {
      id: taskId,
      content: { text: 'Send the proposal' },
      assigneeMemberIds: [ada.memberId, bob.memberId],
      linkedRecords: [f.record],
    });
    const bobRows = (await inbox(bob, { topic: 'task-assignments' })).items;
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0]).toMatchObject({
      type: 'task-assigned',
      subject: { kind: 'task', taskId, title: 'Send the proposal', isCompleted: false, linkedRecordCount: 1 },
    });
    expect((await inbox(ada, { topic: 'task-assignments' })).items).toEqual([]);
    await domain.tasks.update(ada.ctx, { taskId, assigneeMemberIds: [bob.memberId, cara.memberId] });
    expect((await inbox(cara, { topic: 'task-assignments' })).items).toHaveLength(1);
    expect((await inbox(bob, { topic: 'task-assignments' })).items[0]?.entryCount).toBe(1);
    // Unassigned and assigned again within 8 h: same row, two entries.
    await domain.tasks.update(ada.ctx, { taskId, assigneeMemberIds: [cara.memberId] });
    await domain.tasks.update(ada.ctx, { taskId, assigneeMemberIds: [cara.memberId, bob.memberId] });
    expect((await inbox(bob, { topic: 'task-assignments' })).items[0]).toMatchObject({ entryCount: 2, unreadCount: 2 });
  });

  it('notifies members newly mentioned in a note body (server writes and collab saves), once per note', async () => {
    const note = await domain.notes.create(ada.ctx, { id: newId(), title: 'Call recap', parentRecords: [f.record] });
    const body = (members: Member[]): Block[] => [
      {
        type: 'unstyled',
        indent: 0,
        text: `Thanks ${members.map(() => '@x').join(' ')}`,
        styles: [],
        mentions: members.map((m, i) => ({ type: 'member' as const, start: 7 + i * 3, length: 2, id: m.memberId })),
      },
    ];
    await domain.documents.replaceContent(ada.ctx, { id: note.documentId, content: { blocks: body([bob]) } });
    const rows = (await inbox(bob, { topic: 'mentions' })).items.filter((i) => i.type === 'note-mentioned');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subject: { kind: 'note', noteId: note.id, title: 'Call recap', record: { entityInstanceId: f.company } },
    });
    // The collab server saves the same body plus Cara: only Cara is new.
    await domain.documents.storeState(ada.ctx, { id: note.documentId, state: blocksToState(body([bob, cara])) });
    expect((await inbox(cara, { topic: 'mentions' })).items.filter((i) => i.type === 'note-mentioned')).toHaveLength(1);
    // Removing and re-adding Bob does not notify him twice for the same note.
    await domain.documents.replaceContent(ada.ctx, { id: note.documentId, content: { blocks: body([cara]) } });
    await domain.documents.replaceContent(ada.ctx, { id: note.documentId, content: { blocks: body([cara, bob]) } });
    const again = (await inbox(bob, { topic: 'mentions' })).items.filter((i) => i.type === 'note-mentioned');
    expect(again).toHaveLength(1);
    expect(again[0]?.entryCount).toBe(1);
  });

  it('notifies members a list is shared with (create grants and later grants)', async () => {
    const { list } = await domain.lists.create(ada.ctx, {
      name: 'Partners',
      parentEntityDefinitionIds: ['companies'],
      workspaceAccess: 'no-access',
      memberAccess: [{ memberId: bob.memberId, scope: 'read-only' }],
    });
    expect((await inbox(bob, { topic: 'shared-with-you' })).items[0]).toMatchObject({
      type: 'list-shared',
      subject: { kind: 'list', listId: list.id, name: 'Partners', isUnavailable: false },
    });
    await domain.lists.setAccess(ada.ctx, {
      listId: list.id,
      memberAccess: [{ memberId: cara.memberId, scope: 'no-access' }],
    });
    expect((await inbox(cara, { topic: 'shared-with-you' })).items).toEqual([]);
    await domain.lists.setAccess(ada.ctx, {
      listId: list.id,
      memberAccess: [{ memberId: cara.memberId, scope: 'read-write' }],
    });
    expect((await inbox(cara, { topic: 'shared-with-you' })).items).toHaveLength(1);
    // Raising an existing grant is not a new share.
    await domain.lists.setAccess(ada.ctx, {
      listId: list.id,
      memberAccess: [{ memberId: bob.memberId, scope: 'full-access' }],
    });
    expect((await inbox(bob, { topic: 'shared-with-you' })).items[0]?.entryCount).toBe(1);
  });

  it('skips suspended recipients', async () => {
    const dan = await addMember(f, 'Dan');
    await domain.members.updateAccessLevel(ada.ctx, { memberId: dan.memberId, accessLevel: 'suspended' });
    await comment(ada, mention('Hello', dan));
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM notification_entries WHERE recipient_member_id = ${dan.memberId}`.execute(
      database.kysely,
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('inbox procedures', () => {
  it('lists by state and topic with cursor paging; marks read, unread; archives', async () => {
    const eve = await addMember(f, 'Eve');
    for (let i = 0; i < 3; i++) await comment(ada, mention(`Item ${i}`, eve));
    const first = await inbox(eve, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await inbox(eve, { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    await expectCode(domain.notifications.list(eve.ctx, { cursor: 'nonsense' }), 'VALIDATION_ERROR', 400);

    const since = await lastChangeId(f.workspaceId);
    expect(await domain.notifications.markRead(eve.ctx, { ids: [ids[0] as string] })).toEqual({ updated: 1 });
    expect((await inbox(eve, { state: 'unread' })).items.map((i) => i.id)).toEqual(ids.slice(1));
    const counts = await domain.notifications.unreadCount(eve.ctx);
    expect(counts).toMatchObject({ count: 2, actionNeeded: 0 });
    expect(counts.byTopic.mentions).toBe(2);
    expect(counts.byTopic.replies).toBe(0);
    const changes = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'notification');
    expect(changes).toEqual([expect.objectContaining({ resource_id: null, audience: { userIds: [eve.userId] } })]);

    expect(await domain.notifications.markUnread(eve.ctx, { ids: [ids[0] as string] })).toEqual({ updated: 1 });
    expect((await domain.notifications.unreadCount(eve.ctx)).count).toBe(3);
    expect(await domain.notifications.markRead(eve.ctx, { all: true })).toEqual({ updated: 3 });
    expect((await domain.notifications.unreadCount(eve.ctx)).count).toBe(0);
    expect((await inbox(eve, { state: 'unread' })).items).toEqual([]);

    expect(await domain.notifications.archive(eve.ctx, { ids: [ids[1] as string] })).toEqual({ updated: 1 });
    expect((await inbox(eve)).items.map((i) => i.id)).not.toContain(ids[1]);
    expect((await inbox(eve, { state: 'archived' })).items).toEqual([
      expect.objectContaining({ id: ids[1], isArchived: true }),
    ]);
    await domain.notifications.archive(eve.ctx, { ids: [ids[1] as string], archived: false });
    expect((await inbox(eve)).items).toHaveLength(3);
    // Another member cannot touch Eve's rows.
    expect(await domain.notifications.markUnread(bob.ctx, { ids })).toEqual({ updated: 0 });
    expect(await domain.notifications.archive(bob.ctx, { ids })).toEqual({ updated: 0 });
    await expect(domain.notifications.markRead(eve.ctx, {} as never)).rejects.toThrow('Pass either ids or all');
  });

  it('only members have an inbox', async () => {
    await expectCode(domain.notifications.list(f.sys, {}), 'FORBIDDEN', 403);
  });
});

describe('preferences', () => {
  it('reads defaults, toggles per group and channel, and drives delivery', async () => {
    const finn = await addMember(f, 'Finn');
    const prefs = await domain.notifications.preferences.get(finn.ctx);
    const mentions = prefs.groups.find((g) => g.group === 'mentions');
    expect(mentions).toMatchObject({
      title: 'Mentions',
      visible: true,
      channels: [
        { channel: 'in-app', available: true, enabled: true },
        { channel: 'email', available: true, enabled: true },
      ],
    });
    expect(prefs.groups.filter((g) => g.visible).map((g) => g.title)).toEqual([
      'Mentions',
      'Replies',
      'Email Grants',
      'Task Assignments',
      'Shared Resources',
      'Sequence delegated sender invites',
      'Permission requests',
      'Enable daily digest',
    ]);
    await expectCode(
      domain.notifications.preferences.update(finn.ctx, { group: 'daily-digest', channel: 'in-app', enabled: true }),
      'VALIDATION_ERROR',
      400,
    );

    // Email on (default), in-app off: no inbox row, one pending email delivery.
    const since = await lastChangeId(f.workspaceId);
    const updated = await domain.notifications.preferences.update(finn.ctx, {
      group: 'mentions',
      channel: 'in-app',
      enabled: false,
    });
    expect(updated.groups.find((g) => g.group === 'mentions')?.channels[0]).toMatchObject({ enabled: false });
    expect((await changeRows(f.workspaceId, since)).map((r) => r.resource)).toEqual(['notification-preferences']);
    await comment(ada, mention('Quiet', finn));
    expect((await inbox(finn)).items).toEqual([]);
    const pending = await sql<{ status: string; type: string; entry_id: string | null }>`
      SELECT status, type, entry_id FROM notification_deliveries WHERE recipient_member_id = ${finn.memberId}`.execute(
      database.kysely,
    );
    expect(pending.rows).toEqual([{ status: 'pending', type: 'comment-mentioned', entry_id: null }]);

    // Replies have no email channel in the registry: no delivery even with email on.
    await domain.notifications.preferences.update(finn.ctx, { group: 'mentions', channel: 'in-app', enabled: true });
    await domain.notifications.preferences.update(finn.ctx, { group: 'mentions', channel: 'email', enabled: false });
    await comment(ada, mention('Loud', finn));
    expect((await inbox(finn)).items).toHaveLength(1);

    const drained = await domain.notifications.drainEmailDeliveries();
    expect(drained.skipped).toBeGreaterThanOrEqual(1);
    const after = await sql<{ status: string; detail: string | null }>`
      SELECT status, detail FROM notification_deliveries WHERE recipient_member_id = ${finn.memberId}`.execute(
      database.kysely,
    );
    expect(after.rows).toEqual([{ status: 'skipped', detail: expect.stringContaining('slice 7') }]);
  });
});
