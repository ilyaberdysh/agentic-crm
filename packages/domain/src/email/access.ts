// Visibility of synced email and calendar (decision C.4 #13; F README §2.2–2.3, F settings §2.1, BACKLOG acceptance 3).
// Access is decided per mailbox copy and the best copy wins:
//   • the owner of a copy (the mailbox's member) has full access;
//   • anyone else gets the mailbox's default visibility level (full-access / subject-line / metadata-only), raised
//     by grants of the copy's owner that target them or the whole workspace: mailbox grants ("Individuals with full
//     access"), thread grants (email modal "Share"), record grants (Emails tab "Manage access": the owner's emails
//     on that record);
//   • a message involving a workspace protected contact is visible to its owners only (others: none);
//   • copies of removed (archived) mailboxes and deleted copies do not count; a message without a live copy is gone.
// Non-member actors (system, API tokens) see everything. Meetings follow their calendar copies the same way (mailbox
// level and mailbox grants); meetings without calendar copies (manual / API) are visible to everyone, and a member
// taking part in a meeting always sees it in full.
import type { EmailAccess, VisibilityLevel } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import type { Tx } from '../tx.ts';
import { maxAccess } from './model.ts';

export interface CopyInfo {
  mailboxId: string;
  memberId: string;
  direction: 'inbound' | 'outbound';
}

export interface AccessInfo {
  access: EmailAccess;
  isOwn: boolean;
  copies: CopyInfo[];
}

interface GrantRow {
  owner_member_id: string;
  resource_type: 'mailbox' | 'thread' | 'record';
  mailbox_id: string | null;
  thread_id: string | null;
  entity_instance_id: string | null;
  level: VisibilityLevel;
}

async function grantsFor(tx: Tx, viewer: string, owners: string[]): Promise<GrantRow[]> {
  if (owners.length === 0) return [];
  return tx.db
    .selectFrom('email_grants')
    .select(['owner_member_id', 'resource_type', 'mailbox_id', 'thread_id', 'entity_instance_id', 'level'])
    .where('owner_member_id', 'in', owners)
    .where((eb) => eb.or([eb('target_type', '=', 'workspace'), eb('target_member_id', '=', viewer)]))
    .execute();
}

/** Access of the acting member to each message (messages without a live copy are absent). */
export async function messageAccess(tx: Tx, messageIds: string[]): Promise<Map<string, AccessInfo>> {
  const out = new Map<string, AccessInfo>();
  const ids = [...new Set(messageIds)];
  if (ids.length === 0) return out;
  const { rows: copies } = await sql<{
    message_id: string;
    mailbox_id: string;
    member_id: string;
    direction: 'inbound' | 'outbound';
    default_visibility: VisibilityLevel;
    thread_id: string;
    is_protected: boolean;
  }>`
    SELECT c.message_id, c.mailbox_id, c.member_id, c.direction, mb.default_visibility, m.thread_id, m.is_protected
    FROM email_message_copies c
    JOIN mailboxes mb ON mb.id = c.mailbox_id AND mb.archived_at IS NULL
    JOIN email_messages m ON m.id = c.message_id
    WHERE c.message_id = ANY(${ids}::uuid[]) AND c.deleted_at IS NULL
    ORDER BY c.message_id, c.synced_at, c.id`.execute(tx.db);
  if (copies.length === 0) return out;
  const viewer = actingMemberId(tx.ctx);
  const grants = viewer ? await grantsFor(tx, viewer, [...new Set(copies.map((c) => c.member_id))]) : [];
  const recordGrants = grants.filter((g) => g.resource_type === 'record');
  const recordsOf = new Map<string, Set<string>>();
  if (recordGrants.length > 0) {
    const links = await tx.db
      .selectFrom('email_message_records')
      .select(['message_id', 'entity_instance_id'])
      .where('message_id', 'in', ids)
      .execute();
    for (const l of links) {
      const set = recordsOf.get(l.message_id) ?? new Set<string>();
      set.add(l.entity_instance_id);
      recordsOf.set(l.message_id, set);
    }
  }
  const protectedMessages = new Set<string>();
  for (const c of copies) {
    if (c.is_protected) protectedMessages.add(c.message_id);
    let info = out.get(c.message_id);
    if (!info) {
      info = { access: 'none', isOwn: false, copies: [] };
      out.set(c.message_id, info);
    }
    info.copies.push({ mailboxId: c.mailbox_id, memberId: c.member_id, direction: c.direction });
    let level: EmailAccess;
    if (!viewer || c.member_id === viewer) {
      level = 'full-access';
      if (viewer) info.isOwn = true;
    } else {
      level = c.default_visibility;
      for (const g of grants) {
        if (g.owner_member_id !== c.member_id) continue;
        const applies =
          (g.resource_type === 'mailbox' && g.mailbox_id === c.mailbox_id) ||
          (g.resource_type === 'thread' && g.thread_id === c.thread_id) ||
          (g.resource_type === 'record' && recordsOf.get(c.message_id)?.has(g.entity_instance_id as string) === true);
        if (applies) level = maxAccess(level, g.level);
      }
    }
    info.access = maxAccess(info.access, level);
  }
  if (viewer) {
    for (const id of protectedMessages) {
      const info = out.get(id) as AccessInfo;
      if (!info.isOwn) info.access = 'none';
    }
  }
  return out;
}

/** Access of the acting member to each meeting (deleted meetings are absent). */
export async function meetingAccess(tx: Tx, meetingIds: string[]): Promise<Map<string, AccessInfo>> {
  const out = new Map<string, AccessInfo>();
  const ids = [...new Set(meetingIds)];
  if (ids.length === 0) return out;
  const meetings = await tx.db
    .selectFrom('meetings')
    .select('id')
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute();
  for (const m of meetings) out.set(m.id, { access: 'full-access', isOwn: false, copies: [] });
  const { rows: copies } = await sql<{
    meeting_id: string;
    mailbox_id: string;
    member_id: string;
    default_visibility: VisibilityLevel;
  }>`
    SELECT e.meeting_id, e.mailbox_id, e.member_id, mb.default_visibility
    FROM calendar_events e JOIN mailboxes mb ON mb.id = e.mailbox_id AND mb.archived_at IS NULL
    WHERE e.meeting_id = ANY(${ids}::uuid[]) AND e.deleted_at IS NULL
    ORDER BY e.meeting_id, e.synced_at, e.id`.execute(tx.db);
  const viewer = actingMemberId(tx.ctx);
  const grants = viewer ? await grantsFor(tx, viewer, [...new Set(copies.map((c) => c.member_id))]) : [];
  const withCopies = new Set<string>();
  for (const c of copies) {
    const info = out.get(c.meeting_id);
    if (!info) continue;
    if (!withCopies.has(c.meeting_id)) {
      withCopies.add(c.meeting_id);
      info.access = 'none';
    }
    info.copies.push({ mailboxId: c.mailbox_id, memberId: c.member_id, direction: 'inbound' });
    let level: EmailAccess;
    if (!viewer || c.member_id === viewer) {
      level = 'full-access';
      if (viewer) info.isOwn = true;
    } else {
      level = c.default_visibility;
      for (const g of grants) {
        if (g.owner_member_id === c.member_id && g.resource_type === 'mailbox' && g.mailbox_id === c.mailbox_id) {
          level = maxAccess(level, g.level);
        }
      }
    }
    info.access = maxAccess(info.access, level);
  }
  if (viewer) {
    const attending = await tx.db
      .selectFrom('meeting_participants')
      .select('meeting_id')
      .where('meeting_id', 'in', ids)
      .where('member_id', '=', viewer)
      .execute();
    for (const a of attending) {
      const info = out.get(a.meeting_id);
      if (info) {
        info.access = 'full-access';
        info.isOwn = true;
      }
    }
  }
  return out;
}
