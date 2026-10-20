// Notification delivery inside the producer's transaction (I1; B-shell/notifications.md §3–6; CROSS-DOMAIN B.27).
// For each event: drop self-notifications and inactive recipients, read the recipient's preferences, then
//   in-app → append an entry to the open inbox row with the same grouping key (within the type's max gap) or open a
//            new row, and emit a `notification` change_log row for the recipient's user only (realtime badge/inbox);
//   email  → record a pending delivery (the worker sends it once slice 7 adds outbound email; until then it is
//            marked skipped).
// Dedupe keys make producers idempotent (one entry per recipient and key, e.g. per comment).
import {
  type Actor,
  NOTIFICATION_PREFERENCE_GROUPS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationPreferenceGroup,
  type NotificationType,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';

export interface NotificationEvent {
  type: NotificationType;
  recipientMemberId: string;
  payload: Record<string, unknown>;
  /** The member (or other actor) the notification is from; defaults to the transaction's actor. */
  actor?: Actor;
  /** At most one entry per (recipient, dedupeKey). */
  dedupeKey?: string;
}

type Preferences = Map<string, Map<string, boolean>>; // member → `${group}:${channel}` → enabled

/** Effective preferences (stored rows over registry defaults) of `memberIds`. */
export async function preferencesOf(tx: Tx, memberIds: string[]): Promise<Preferences> {
  const out: Preferences = new Map();
  for (const id of memberIds) {
    const prefs = new Map<string, boolean>();
    for (const g of NOTIFICATION_PREFERENCE_GROUPS) {
      for (const channel of ['in-app', 'email'] as const) {
        prefs.set(`${g.group}:${channel}`, g.channels.includes(channel) && g.defaults[channel]);
      }
    }
    out.set(id, prefs);
  }
  if (memberIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('notification_preferences')
    .select(['member_id', 'preference_group', 'channel', 'enabled'])
    .where('member_id', 'in', memberIds)
    .execute();
  for (const r of rows) {
    const info = NOTIFICATION_PREFERENCE_GROUPS.find((g) => g.group === r.preference_group);
    if (!info?.channels.includes(r.channel)) continue;
    out.get(r.member_id)?.set(`${r.preference_group}:${r.channel}`, r.enabled);
  }
  return out;
}

export function enabled(
  prefs: Preferences,
  memberId: string,
  group: NotificationPreferenceGroup,
  channel: NotificationChannel,
): boolean {
  return prefs.get(memberId)?.get(`${group}:${channel}`) ?? false;
}

/** The auth user of each member (change_log audience). */
async function usersOf(tx: Tx, memberIds: string[]) {
  if (memberIds.length === 0) return new Map<string, { userId: string; accessLevel: string }>();
  const rows = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'user_id', 'access_level'])
    .where('id', 'in', memberIds)
    .execute();
  return new Map(rows.map((r) => [r.id, { userId: r.user_id, accessLevel: r.access_level }]));
}

/** `<type>:<key value>` of the inbox row an event belongs to; null = a row of its own. */
export function groupKeyOf(type: NotificationType, payload: Record<string, unknown>): string | null {
  const info = NOTIFICATION_TYPES[type];
  if (info.groupBy === null) return null;
  if (info.groupBy === 'constant') return type;
  const value = payload[info.groupBy];
  return typeof value === 'string' && value !== '' ? `${type}:${value}` : null;
}

/** Delivers `events`; answers the inbox rows written to (one per in-app entry). */
export async function notify(tx: Tx, events: NotificationEvent[]): Promise<{ groupIds: string[] }> {
  const actorMember = actingMemberId(tx.ctx);
  const candidates = events.filter((e) => {
    const from = e.actor ?? tx.ctx.actor;
    // No self-notifications: neither the acting member nor the member the event is from.
    if (e.recipientMemberId === actorMember) return false;
    return !(from.type === 'workspace-member' && from.id === e.recipientMemberId);
  });
  if (candidates.length === 0) return { groupIds: [] };
  const recipients = [...new Set(candidates.map((e) => e.recipientMemberId))];
  const [members, prefs] = await Promise.all([usersOf(tx, recipients), preferencesOf(tx, recipients)]);
  const groupIds: string[] = [];
  for (const event of candidates) {
    const member = members.get(event.recipientMemberId);
    if (!member || member.accessLevel === 'suspended') continue;
    const info = NOTIFICATION_TYPES[event.type];
    const inApp =
      info.channels.includes('app') && enabled(prefs, event.recipientMemberId, info.preferenceGroup, 'in-app');
    const email =
      info.channels.includes('email') && enabled(prefs, event.recipientMemberId, info.preferenceGroup, 'email');
    if (!inApp && !email) continue;
    const actor = event.actor ?? tx.ctx.actor;
    if (event.dedupeKey) {
      const seen = await tx.db
        .selectFrom('notification_entries')
        .select('id')
        .where('recipient_member_id', '=', event.recipientMemberId)
        .where('dedupe_key', '=', event.dedupeKey)
        .executeTakeFirst();
      if (seen) continue;
    }
    let entryId: string | null = null;
    if (inApp) {
      const groupKey = groupKeyOf(event.type, event.payload);
      let groupId: string | null = null;
      if (groupKey !== null) {
        const { rows } = await sql<{ id: string }>`
          SELECT id FROM notification_groups
          WHERE recipient_member_id = ${event.recipientMemberId}::uuid AND group_key = ${groupKey}
            AND archived_at IS NULL
            AND latest_entry_at >= ${tx.now}::timestamptz - make_interval(secs => ${info.maxGapMs / 1000})
          ORDER BY latest_entry_at DESC, id DESC
          LIMIT 1
          FOR UPDATE`.execute(tx.db);
        groupId = rows[0]?.id ?? null;
      }
      const isNew = groupId === null;
      if (groupId === null) {
        groupId = newId();
        await tx.db
          .insertInto('notification_groups')
          .values({
            id: groupId,
            workspace_id: tx.workspaceId,
            recipient_member_id: event.recipientMemberId,
            type: event.type,
            topic: info.topic,
            group_key: groupKey,
            first_entry_at: tx.now,
            latest_entry_at: tx.now,
          })
          .execute();
      } else {
        await tx.db
          .updateTable('notification_groups')
          .set({ type: event.type, latest_entry_at: tx.now })
          .where('id', '=', groupId)
          .execute();
      }
      const inserted = await sql<{ id: string }>`
        INSERT INTO notification_entries (id, workspace_id, group_id, recipient_member_id, type, actor, payload,
          dedupe_key, created_at)
        VALUES (${newId()}, ${tx.workspaceId}, ${groupId}, ${event.recipientMemberId}, ${event.type},
          ${jsonb(actor)}::jsonb, ${jsonb(event.payload)}::jsonb, ${event.dedupeKey ?? null}, ${tx.now}::timestamptz)
        ON CONFLICT (recipient_member_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        RETURNING id`.execute(tx.db);
      entryId = inserted.rows[0]?.id ?? null;
      if (entryId === null) {
        // Lost a dedupe race to a concurrent producer: undo the empty row.
        if (isNew) await tx.db.deleteFrom('notification_groups').where('id', '=', groupId).execute();
        continue;
      }
      groupIds.push(groupId);
      tx.emit(
        'notification',
        groupId,
        { groupId, memberId: event.recipientMemberId, topic: info.topic },
        { userIds: [member.userId] },
      );
    }
    if (email) {
      await tx.db
        .insertInto('notification_deliveries')
        .values({
          id: newId(),
          workspace_id: tx.workspaceId,
          recipient_member_id: event.recipientMemberId,
          entry_id: entryId,
          type: event.type,
          channel: 'email',
          actor: jsonb(actor),
          payload: jsonb(event.payload),
        })
        .execute();
    }
  }
  return { groupIds };
}
