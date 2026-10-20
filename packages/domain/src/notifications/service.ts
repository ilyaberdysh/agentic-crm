// The member's inbox and notification preferences (BACKLOG 5.05–5.06; B-shell/notifications.md §1, §3, §5, §6).
// Every procedure acts on the acting member's own notifications. Read / unread / archive emit one `notification`
// change_log row for the member's user (other tabs refresh the badge and list); preference changes emit
// `notification-preferences`.
import {
  type Actor,
  type ArchiveNotificationsInput,
  archiveNotificationsInputSchema,
  type ListNotificationsInput,
  type ListNotificationsOutput,
  listNotificationsInputSchema,
  type MarkNotificationsReadInput,
  type MarkNotificationsUnreadInput,
  markNotificationsReadInputSchema,
  markNotificationsUnreadInputSchema,
  NOTIFICATION_PREFERENCE_GROUPS,
  NOTIFICATION_TYPES,
  type NotificationGroup,
  type NotificationPreferences,
  type NotificationRecordSummary,
  type NotificationSubject,
  type NotificationsChangedOutput,
  type NotificationTopic,
  type NotificationType,
  type NotificationUnreadCount,
  notificationTopics,
  notificationTypes,
  type UpdateNotificationPreferenceInput,
  updateNotificationPreferenceInputSchema,
} from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import { memberAudience, recordLabels, requireMember } from '../collab/common.ts';
import { badRequest } from '../errors.ts';
import type { Policies } from '../permissions.ts';
import { type DefInfo, loadDefinitionsByIds } from '../schema/model.ts';
import { runAsOwner, type Tx } from '../tx.ts';
import { preferencesOf } from './produce.ts';

const ACTIONABLE_TYPES = notificationTypes.filter((t) => NOTIFICATION_TYPES[t].actionable);
const MAX_ENTRIES = 10;
const MAX_ACTORS = 5;

interface GroupRow {
  id: string;
  type: NotificationType;
  topic: NotificationTopic;
  first_entry_at: string;
  latest_entry_at: string;
  archived_at: string | null;
  entry_count: string;
  unread_count: string;
  unresolved_count: string;
}

interface EntryRow {
  id: string;
  group_id: string;
  type: NotificationType;
  actor: Actor;
  payload: Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    if (typeof at !== 'string' || typeof id !== 'string' || Number.isNaN(Date.parse(at))) throw new Error('bad');
    return { at, id };
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Invalid cursor', { field: 'cursor' });
  }
}

const topicsOf = (data: { topic?: NotificationTopic; topics?: NotificationTopic[] }): NotificationTopic[] | null => {
  const topics = [...(data.topic ? [data.topic] : []), ...(data.topics ?? [])];
  return topics.length > 0 ? [...new Set(topics)] : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Subjects of rows, resolved from their newest entry's payload, for the acting member (the recipient). */
async function subjects(
  tx: Tx,
  policies: Policies,
  latest: Map<string, EntryRow>,
): Promise<Map<string, NotificationSubject | null>> {
  const out = new Map<string, NotificationSubject | null>();
  const entries = [...latest.entries()];
  const commentIds = new Set<string>();
  const noteIds = new Set<string>();
  const taskIds = new Set<string>();
  const listIds = new Set<string>();
  for (const [, e] of entries) {
    const p = e.payload;
    if (e.type === 'comment-mentioned' || e.type === 'comment-replied') {
      const id = str(p.commentId);
      if (id) commentIds.add(id);
    } else if (e.type === 'note-mentioned') {
      const id = str(p.noteId);
      if (id) noteIds.add(id);
    } else if (e.type === 'task-assigned') {
      const id = str(p.taskId);
      if (id) taskIds.add(id);
    } else if (e.type === 'list-shared') {
      const id = str(p.listId);
      if (id) listIds.add(id);
    }
  }
  const [comments, notes, tasks, lists] = await Promise.all([
    commentIds.size
      ? tx.db
          .selectFrom('comments')
          .select([
            'id',
            'thread_id',
            'content',
            'target_kind',
            'entity_definition_id',
            'entity_instance_id',
            'deleted_at',
          ])
          .where('id', 'in', [...commentIds])
          .execute()
      : [],
    noteIds.size
      ? tx.db
          .selectFrom('notes')
          .select(['id', 'title', 'deleted_at'])
          .where('id', 'in', [...noteIds])
          .execute()
      : [],
    taskIds.size
      ? tx.db
          .selectFrom('tasks')
          .select(['id', 'content', 'completed_at', 'deadline_at', 'deleted_at'])
          .where('id', 'in', [...taskIds])
          .execute()
      : [],
    listIds.size
      ? tx.db
          .selectFrom('collections')
          .select(['id', 'name', 'icon', 'deleted_at'])
          .where('id', 'in', [...listIds])
          .execute()
      : [],
  ]);
  // Entry comments are shown on the entry's parent record.
  const entryIds = comments.filter((c) => c.target_kind === 'list-entry').map((c) => c.entity_instance_id);
  const entryParents = new Map<string, { entityDefinitionId: string; entityInstanceId: string }>();
  if (entryIds.length > 0) {
    const { rows } = await sql<{ instance_id: string; v_ref: string; v_ref_def: string }>`
      SELECT v.instance_id, v.v_ref, v.v_ref_def FROM attribute_values v
      JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
      WHERE v.instance_id = ANY(${entryIds}::uuid[]) AND v.active_until IS NULL AND v.v_ref IS NOT NULL`.execute(tx.db);
    for (const r of rows)
      entryParents.set(r.instance_id, { entityDefinitionId: r.v_ref_def, entityInstanceId: r.v_ref });
  }
  const linkCounts = new Map<string, number>();
  if (taskIds.size > 0) {
    const rows = await tx.db
      .selectFrom('task_records')
      .select(['task_id', sql<string>`count(*)`.as('n')])
      .where('task_id', 'in', [...taskIds])
      .groupBy('task_id')
      .execute();
    for (const r of rows) linkCounts.set(r.task_id, Number(r.n));
  }

  // Record summaries: labels, liveness and read access of the recipient.
  const refs: { entityDefinitionId: string; entityInstanceId: string }[] = [];
  for (const c of comments) {
    refs.push(
      c.target_kind === 'list-entry'
        ? (entryParents.get(c.entity_instance_id) ?? {
            entityDefinitionId: c.entity_definition_id,
            entityInstanceId: c.entity_instance_id,
          })
        : { entityDefinitionId: c.entity_definition_id, entityInstanceId: c.entity_instance_id },
    );
  }
  for (const [, e] of entries) {
    if (e.type !== 'note-mentioned') continue;
    const def = str(e.payload.entityDefinitionId);
    const inst = str(e.payload.entityInstanceId);
    if (def && inst) refs.push({ entityDefinitionId: def, entityInstanceId: inst });
  }
  const labels = await recordLabels(tx, refs);
  const live = new Set<string>();
  if (refs.length > 0) {
    const rows = await tx.db
      .selectFrom('entity_instances')
      .select('id')
      .where(
        'id',
        'in',
        refs.map((r) => r.entityInstanceId),
      )
      .where('archived_at', 'is', null)
      .where('merged_at', 'is', null)
      .execute();
    for (const r of rows) live.add(r.id);
  }
  const defIds = [
    ...new Set([...refs.map((r) => r.entityDefinitionId), ...comments.map((c) => c.entity_definition_id)]),
  ];
  const defs: DefInfo[] = [...(await loadDefinitionsByIds(tx, defIds)).values()];
  const readable = new Set((await policies.allowed(tx, defs, 'read_entity_instance')).map((d) => d.id));
  const summary = (ref: { entityDefinitionId: string; entityInstanceId: string }): NotificationRecordSummary => ({
    entityDefinitionId: ref.entityDefinitionId,
    entityInstanceId: ref.entityInstanceId,
    title: labels.get(ref.entityInstanceId) ?? null,
    isUnavailable: !live.has(ref.entityInstanceId) || !readable.has(ref.entityDefinitionId),
  });

  const commentById = new Map(comments.map((c) => [c.id, c]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const listById = new Map(lists.map((l) => [l.id, l]));
  const listReadable = new Set(
    (
      await policies.allowed(tx, [...(await loadDefinitionsByIds(tx, [...listIds])).values()], 'read_entity_instance')
    ).map((d) => d.id),
  );
  for (const [groupId, e] of entries) {
    const p = e.payload;
    let subject: NotificationSubject | null = null;
    if (e.type === 'comment-mentioned' || e.type === 'comment-replied') {
      const id = str(p.commentId);
      const c = id ? commentById.get(id) : undefined;
      if (id) {
        const isEntry = c?.target_kind === 'list-entry';
        const ref = c
          ? isEntry
            ? (entryParents.get(c.entity_instance_id) ?? null)
            : { entityDefinitionId: c.entity_definition_id, entityInstanceId: c.entity_instance_id }
          : null;
        const record = ref ? summary(ref) : null;
        const targetReadable = c ? readable.has(c.entity_definition_id) : false;
        subject = {
          kind: 'comment',
          commentId: id,
          threadId: c?.thread_id ?? str(p.threadId) ?? id,
          text: c && !c.deleted_at && targetReadable ? c.content.slice(0, 280) : null,
          record,
          listId: isEntry && c ? c.entity_definition_id : null,
          entryId: isEntry && c ? c.entity_instance_id : null,
          isUnavailable: !c || c.deleted_at !== null || !targetReadable,
        };
      }
    } else if (e.type === 'note-mentioned') {
      const id = str(p.noteId);
      const n = id ? noteById.get(id) : undefined;
      const def = str(p.entityDefinitionId);
      const inst = str(p.entityInstanceId);
      const record = def && inst ? summary({ entityDefinitionId: def, entityInstanceId: inst }) : null;
      if (id) {
        subject = {
          kind: 'note',
          noteId: id,
          title: n && !n.deleted_at ? n.title : null,
          record,
          isUnavailable: !n || n.deleted_at !== null || (record?.isUnavailable ?? true),
        };
      }
    } else if (e.type === 'task-assigned') {
      const id = str(p.taskId);
      const t = id ? taskById.get(id) : undefined;
      if (id) {
        subject = {
          kind: 'task',
          taskId: id,
          title: t && !t.deleted_at ? t.content : null,
          isCompleted: t?.completed_at != null,
          deadlineAt: t?.deadline_at ?? null,
          linkedRecordCount: linkCounts.get(id) ?? 0,
          isUnavailable: !t || t.deleted_at !== null,
        };
      }
    } else if (e.type === 'list-shared') {
      const id = str(p.listId);
      const l = id ? listById.get(id) : undefined;
      if (id) {
        const available = !!l && !l.deleted_at && listReadable.has(id);
        subject = {
          kind: 'list',
          listId: id,
          name: available ? (l?.name ?? null) : null,
          icon: available ? (l?.icon ?? null) : null,
          isUnavailable: !available,
        };
      }
    }
    out.set(groupId, subject);
  }
  return out;
}

async function hydrate(tx: Tx, policies: Policies, rows: GroupRow[]): Promise<NotificationGroup[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { rows: entries } = await sql<EntryRow>`
    SELECT e.id, e.group_id, e.type, e.actor, e.payload, e.created_at, e.acknowledged_at, e.resolved_at FROM (
      SELECT e.*, row_number() OVER (PARTITION BY e.group_id ORDER BY e.created_at DESC, e.id DESC) AS n
      FROM notification_entries e WHERE e.group_id = ANY(${ids}::uuid[])
    ) e WHERE e.n <= ${MAX_ENTRIES}
    ORDER BY e.group_id, e.created_at DESC, e.id DESC`.execute(tx.db);
  const { rows: actorRows } = await sql<{ group_id: string; actor: Actor; at: string }>`
    SELECT e.group_id, e.actor, max(e.created_at) AS at FROM notification_entries e
    WHERE e.group_id = ANY(${ids}::uuid[])
    GROUP BY e.group_id, e.actor
    ORDER BY e.group_id, at DESC`.execute(tx.db);
  const byGroup = new Map<string, EntryRow[]>();
  for (const e of entries) byGroup.set(e.group_id, [...(byGroup.get(e.group_id) ?? []), e]);
  const actorsByGroup = new Map<string, Actor[]>();
  for (const a of actorRows) actorsByGroup.set(a.group_id, [...(actorsByGroup.get(a.group_id) ?? []), a.actor]);
  const latest = new Map<string, EntryRow>();
  for (const [groupId, list] of byGroup) if (list[0]) latest.set(groupId, list[0]);
  const resolved = await subjects(tx, policies, latest);
  return rows.map((r) => {
    const info = NOTIFICATION_TYPES[r.type];
    const actors = actorsByGroup.get(r.id) ?? [];
    return {
      id: r.id,
      type: r.type,
      topic: r.topic,
      preferenceGroup: info.preferenceGroup,
      isRead: Number(r.unread_count) === 0,
      isArchived: r.archived_at !== null,
      isResolved: !info.actionable || Number(r.unresolved_count) === 0,
      actionable: info.actionable,
      firstAt: r.first_entry_at,
      latestAt: r.latest_entry_at,
      entryCount: Number(r.entry_count),
      unreadCount: Number(r.unread_count),
      actors: actors.slice(0, MAX_ACTORS).map((a) => ({ type: a.type, id: a.id ?? null })),
      actorCount: actors.length,
      entries: (byGroup.get(r.id) ?? []).map((e) => ({
        id: e.id,
        type: e.type,
        actor: { type: e.actor.type, id: e.actor.id ?? null },
        payload: e.payload,
        createdAt: e.created_at,
        readAt: e.acknowledged_at,
        resolvedAt: e.resolved_at,
      })),
      subject: resolved.get(r.id) ?? null,
    };
  });
}

/** Group rows of the member with counts, filtered (no ordering / paging). */
function groupQuery(tx: Tx, memberId: string) {
  return sql<GroupRow>`
    SELECT g.id, g.type, g.topic, g.first_entry_at, g.latest_entry_at, g.archived_at,
      (SELECT count(*) FROM notification_entries e WHERE e.group_id = g.id) AS entry_count,
      (SELECT count(*) FROM notification_entries e WHERE e.group_id = g.id AND e.acknowledged_at IS NULL) AS unread_count,
      (SELECT count(*) FROM notification_entries e WHERE e.group_id = g.id AND e.resolved_at IS NULL) AS unresolved_count
    FROM notification_groups g
    WHERE g.recipient_member_id = ${memberId}::uuid AND g.workspace_id = ${tx.workspaceId}::uuid`;
}

async function emitInbox(tx: Tx, memberId: string, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  tx.emit('notification', null, { memberId, groupIds: [...new Set(groupIds)] }, await memberAudience(tx, memberId));
}

/** Group ids of the member named by `ids` (unknown ids are ignored) or every row (`all`, optionally of topics). */
async function targetGroups(
  tx: Tx,
  memberId: string,
  data: { ids?: string[]; all?: true; topics?: NotificationTopic[] },
  archived: boolean | null,
): Promise<string[]> {
  let q = tx.db.selectFrom('notification_groups').select('id').where('recipient_member_id', '=', memberId);
  if (data.ids) q = q.where('id', 'in', data.ids);
  if (data.topics?.length) q = q.where('topic', 'in', data.topics);
  if (archived !== null) q = q.where('archived_at', archived ? 'is not' : 'is', null);
  return (await q.execute()).map((r) => r.id);
}

export function notificationOps(policies: Policies) {
  const ops = {
    /** The inbox: rows newest first, 25 per page (notifications §3: list, filters, Show read, Action needed). */
    async list(tx: Tx, input: ListNotificationsInput): Promise<ListNotificationsOutput> {
      const data = listNotificationsInputSchema.parse(input);
      const memberId = requireMember(tx);
      const topics = topicsOf(data);
      const cursor = data.cursor ? decodeCursor(data.cursor) : null;
      const { rows } = await sql<GroupRow>`
        SELECT * FROM (${groupQuery(tx, memberId)}) g
        WHERE ${data.state === 'archived' ? sql`g.archived_at IS NOT NULL` : sql`g.archived_at IS NULL`}
          ${data.state === 'unread' ? sql`AND g.unread_count > 0` : sql``}
          ${topics ? sql`AND g.topic = ANY(${topics}::text[])` : sql``}
          ${data.actionNeeded ? sql`AND g.type = ANY(${ACTIONABLE_TYPES}::text[]) AND g.unresolved_count > 0` : sql``}
          ${cursor ? sql`AND (g.latest_entry_at, g.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql``}
        ORDER BY g.latest_entry_at DESC, g.id DESC
        LIMIT ${data.limit + 1}`.execute(tx.db);
      const page = rows.slice(0, data.limit);
      const last = page.at(-1);
      return {
        items: await hydrate(tx, policies, page),
        nextCursor: rows.length > data.limit && last ? encodeCursor(last.latest_entry_at, last.id) : null,
      };
    },

    /** Unread rows (badge), per topic, and rows needing an action. */
    async unreadCount(tx: Tx): Promise<NotificationUnreadCount> {
      const memberId = requireMember(tx);
      const { rows } = await sql<{ topic: NotificationTopic; unread: string; action: string }>`
        SELECT g.topic,
          count(*) FILTER (WHERE g.unread_count > 0) AS unread,
          count(*) FILTER (WHERE g.type = ANY(${ACTIONABLE_TYPES}::text[]) AND g.unresolved_count > 0) AS action
        FROM (${groupQuery(tx, memberId)}) g
        WHERE g.archived_at IS NULL
        GROUP BY g.topic`.execute(tx.db);
      const byTopic = Object.fromEntries(notificationTopics.map((t) => [t, 0])) as Record<NotificationTopic, number>;
      let count = 0;
      let actionNeeded = 0;
      for (const r of rows) {
        byTopic[r.topic] = Number(r.unread);
        count += Number(r.unread);
        actionNeeded += Number(r.action);
      }
      return { count, byTopic, actionNeeded, accurateAt: tx.now };
    },

    /** Opening a row, or "Mark all as read". */
    async markRead(tx: Tx, input: MarkNotificationsReadInput): Promise<NotificationsChangedOutput> {
      const data = markNotificationsReadInputSchema.parse(input);
      const memberId = requireMember(tx);
      const groups = await targetGroups(tx, memberId, data, data.all ? false : null);
      if (groups.length === 0) return { updated: 0 };
      const changed = await tx.db
        .updateTable('notification_entries')
        .set({ acknowledged_at: tx.now })
        .where('recipient_member_id', '=', memberId)
        .where('group_id', 'in', groups)
        .where('acknowledged_at', 'is', null)
        .returning('group_id')
        .execute();
      const updated = [...new Set(changed.map((c) => c.group_id))];
      await emitInbox(tx, memberId, updated);
      return { updated: updated.length };
    },

    /** "Mark as unread": the newest entry of each row becomes unread again. */
    async markUnread(tx: Tx, input: MarkNotificationsUnreadInput): Promise<NotificationsChangedOutput> {
      const data = markNotificationsUnreadInputSchema.parse(input);
      const memberId = requireMember(tx);
      const { rows } = await sql<{ group_id: string }>`
        UPDATE notification_entries e SET acknowledged_at = NULL
        WHERE e.id IN (
          SELECT DISTINCT ON (x.group_id) x.id FROM notification_entries x
          WHERE x.recipient_member_id = ${memberId}::uuid AND x.group_id = ANY(${data.ids}::uuid[])
          ORDER BY x.group_id, x.created_at DESC, x.id DESC)
          AND e.acknowledged_at IS NOT NULL
        RETURNING e.group_id`.execute(tx.db);
      const updated = rows.map((r) => r.group_id);
      await emitInbox(tx, memberId, updated);
      return { updated: updated.length };
    },

    /** Archive rows (or bring them back with `archived: false`). Archived rows leave the badge. */
    async archive(tx: Tx, input: ArchiveNotificationsInput): Promise<NotificationsChangedOutput> {
      const data = archiveNotificationsInputSchema.parse(input);
      const memberId = requireMember(tx);
      const groups = await targetGroups(tx, memberId, data, !data.archived);
      if (groups.length === 0) return { updated: 0 };
      const changed = await tx.db
        .updateTable('notification_groups')
        .set({ archived_at: data.archived ? tx.now : null })
        .where('id', 'in', groups)
        .returning('id')
        .execute();
      const updated = changed.map((c) => c.id);
      await emitInbox(tx, memberId, updated);
      return { updated: updated.length };
    },

    /** Settings → Notifications (notifications §5): every preference group with its channels. */
    async getPreferences(tx: Tx): Promise<NotificationPreferences> {
      const memberId = requireMember(tx);
      const prefs = (await preferencesOf(tx, [memberId])).get(memberId) ?? new Map<string, boolean>();
      return {
        groups: NOTIFICATION_PREFERENCE_GROUPS.map((g) => ({
          group: g.group,
          title: g.title,
          description: g.description,
          visible: g.visible,
          channels: (['in-app', 'email'] as const).map((channel) => ({
            channel,
            available: g.channels.includes(channel),
            enabled: prefs.get(`${g.group}:${channel}`) ?? false,
          })),
        })),
      };
    },

    /** One toggle (changes save immediately per toggle). */
    async updatePreference(tx: Tx, input: UpdateNotificationPreferenceInput): Promise<NotificationPreferences> {
      const data = updateNotificationPreferenceInputSchema.parse(input);
      const memberId = requireMember(tx);
      const info = NOTIFICATION_PREFERENCE_GROUPS.find((g) => g.group === data.group);
      if (!info?.channels.includes(data.channel)) {
        throw badRequest('VALIDATION_ERROR', `"${data.group}" notifications cannot be delivered by ${data.channel}`, {
          field: 'channel',
        });
      }
      await tx.db
        .insertInto('notification_preferences')
        .values({
          member_id: memberId,
          workspace_id: tx.workspaceId,
          preference_group: data.group,
          channel: data.channel,
          enabled: data.enabled,
          updated_at: tx.now,
        })
        .onConflict((oc) =>
          oc
            .columns(['member_id', 'preference_group', 'channel'])
            .doUpdateSet({ enabled: data.enabled, updated_at: tx.now }),
        )
        .execute();
      tx.emit('notification-preferences', memberId, { memberId }, await memberAudience(tx, memberId));
      return ops.getPreferences(tx);
    },
  };
  return ops;
}

/**
 * Email channel stub (until slice 7 adds outbound email): marks pending email deliveries of every workspace as
 * skipped. Cross-tenant by nature (worker job), so it runs as the owner role.
 */
export async function drainEmailDeliveries(
  database: Database,
  options: { limit?: number } = {},
): Promise<{ skipped: number; types: Record<string, number> }> {
  const limit = options.limit ?? 500;
  return runAsOwner(database, async (trx) => {
    const { rows } = await sql<{ type: string }>`
      UPDATE notification_deliveries d SET status = 'skipped', processed_at = now(),
        detail = 'Outbound email is not available yet (slice 7)'
      WHERE d.id IN (
        SELECT id FROM notification_deliveries WHERE status = 'pending' ORDER BY created_at, id LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING d.type`.execute(trx);
    const types: Record<string, number> = {};
    for (const r of rows) types[r.type] = (types[r.type] ?? 0) + 1;
    return { skipped: rows.length, types };
  });
}
