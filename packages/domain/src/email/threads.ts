// Reading synced email (F README §2.2–2.3; BACKLOG 7.03 server, acceptance 3): the record Emails tab (threads of a
// record with the viewer's access applied, "via N mailboxes"), one message and one thread for the email modal.
// Restricted shapes: metadata (participants, time) at every level; subject from subject-line up ("Private subject
// line" below); snippet, bodies and attachments with full access only; nothing for protected messages.
import {
  type EmailMessageView,
  type EmailParticipant,
  type EmailThreadSummary,
  type EmailThreadView,
  getEmailInputSchema,
  getThreadInputSchema,
  type ListRecordThreadsInput,
  type ListRecordThreadsOutput,
  listRecordThreadsInputSchema,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { resolveRecordRefs } from '../collab/common.ts';
import { badRequest, notFound } from '../errors.ts';
import type { Policies } from '../permissions.ts';
import type { Tx } from '../tx.ts';
import { type AccessInfo, messageAccess } from './access.ts';
import { rank } from './model.ts';

interface MessageRow {
  id: string;
  thread_id: string;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string | null;
  sent_at: string;
  has_attachments: boolean;
  attachments: unknown;
}

async function participantsOf(tx: Tx, messageIds: string[]): Promise<Map<string, EmailParticipant[]>> {
  const out = new Map<string, EmailParticipant[]>();
  if (messageIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('email_participants')
    .selectAll()
    .where('message_id', 'in', messageIds)
    .orderBy('message_id')
    .orderBy(sql`array_position(array['from','reply-to','to','cc','bcc']::text[], role)`)
    .orderBy('position')
    .execute();
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    list.push({
      role: r.role,
      emailAddress: r.original_email_address,
      name: r.name,
      memberId: r.member_id,
      personId: r.person_id,
      companyId: r.company_id,
    });
    out.set(r.message_id, list);
  }
  return out;
}

function toView(row: MessageRow, info: AccessInfo, participants: EmailParticipant[]): EmailMessageView {
  const full = info.access === 'full-access';
  const subject = rank(info.access) >= rank('subject-line');
  // BCC recipients are shown to the owners of the copies only.
  const shown = info.isOwn || !info.copies.length ? participants : participants.filter((p) => p.role !== 'bcc');
  return {
    id: row.id,
    threadId: row.thread_id,
    access: info.access,
    isOwn: info.isOwn,
    sentAt: row.sent_at,
    participants: info.access === 'none' ? [] : shown,
    subject: subject ? row.subject : null,
    snippet: full ? row.snippet : null,
    bodyText: full ? row.body_text : null,
    bodyHtml: full ? row.body_html : null,
    hasAttachments: full ? row.has_attachments : null,
    attachments: full ? ((row.attachments as EmailMessageView['attachments']) ?? []) : null,
    copies: info.copies,
  };
}

async function loadMessages(tx: Tx, ids: string[]): Promise<Map<string, MessageRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.db
    .selectFrom('email_messages')
    .select([
      'id',
      'thread_id',
      'subject',
      'snippet',
      'body_text',
      'body_html',
      'sent_at',
      'has_attachments',
      'attachments',
    ])
    .where('id', 'in', ids)
    .execute();
  return new Map(rows.map((r) => [r.id, r as MessageRow]));
}

/** Message views for ids the viewer may see (access ≠ none), in the given order. */
export async function messageViews(tx: Tx, ids: string[]): Promise<EmailMessageView[]> {
  const access = await messageAccess(tx, ids);
  const visible = ids.filter((id) => (access.get(id)?.access ?? 'none') !== 'none');
  const rows = await loadMessages(tx, visible);
  const participants = await participantsOf(tx, visible);
  return visible
    .filter((id) => rows.has(id))
    .map((id) => toView(rows.get(id) as MessageRow, access.get(id) as AccessInfo, participants.get(id) ?? []));
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { o: unknown };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // fall through
  }
  throw badRequest('VALIDATION_ERROR', 'Invalid cursor', { field: 'cursor' });
}

/** Most recent messages of a record considered by the Emails tab. */
const RECORD_MESSAGE_LIMIT = 5000;

export const threadOps = {
  /** Record Emails tab: threads of the record the viewer can see, newest first. */
  async listForRecord(
    tx: Tx,
    deps: { policies: Policies },
    input: ListRecordThreadsInput,
  ): Promise<ListRecordThreadsOutput> {
    const data = listRecordThreadsInputSchema.parse(input);
    const [record] = await resolveRecordRefs(tx, deps, [data.record]);
    const ref = record as { entityInstanceId: string };
    const links = await tx.db
      .selectFrom('email_message_records')
      .select(['message_id', 'thread_id', 'sent_at'])
      .where('entity_instance_id', '=', ref.entityInstanceId)
      .$if(data.sentAfter !== undefined, (q) => q.where('sent_at', '>=', data.sentAfter as string))
      .$if(data.sentBefore !== undefined, (q) => q.where('sent_at', '<', data.sentBefore as string))
      .orderBy('sent_at', 'desc')
      .orderBy('message_id', 'desc')
      .limit(RECORD_MESSAGE_LIMIT)
      .execute();
    const access = await messageAccess(
      tx,
      links.map((l) => l.message_id),
    );
    const rows = await loadMessages(
      tx,
      links.filter((l) => (access.get(l.message_id)?.access ?? 'none') !== 'none').map((l) => l.message_id),
    );
    // Threads in order of their newest visible message.
    const threads = new Map<string, { messageIds: string[] }>();
    for (const l of links) {
      const info = access.get(l.message_id);
      if (!info || info.access === 'none') continue;
      if (data.hasAttachments !== undefined) {
        const row = rows.get(l.message_id);
        const has = info.access === 'full-access' && row?.has_attachments === true;
        if (has !== data.hasAttachments) continue;
      }
      const entry = threads.get(l.thread_id) ?? { messageIds: [] };
      entry.messageIds.push(l.message_id);
      threads.set(l.thread_id, entry);
    }
    const all = [...threads.entries()];
    const offset = decodeCursor(data.cursor);
    const page = all.slice(offset, offset + data.limit);
    const display = page.map(([, t]) => t.messageIds[0] as string);
    const participants = await participantsOf(tx, display);
    const summaries: EmailThreadSummary[] = page.map(([threadId, t]) => {
      const id = t.messageIds[0] as string;
      const info = access.get(id) as AccessInfo;
      const view = toView(rows.get(id) as MessageRow, info, participants.get(id) ?? []);
      const copies = t.messageIds.flatMap((m) => access.get(m)?.copies ?? []);
      const mailboxes = new Set(copies.map((c) => c.mailboxId));
      return {
        threadId,
        displayMessageId: id,
        access: info.access,
        subject: view.subject,
        snippet: view.snippet,
        lastMessageAt: view.sentAt,
        messageCount: t.messageIds.length,
        participants: view.participants,
        hasAttachments: view.hasAttachments,
        mailboxCount: mailboxes.size,
        viaMemberIds: [...new Set(copies.map((c) => c.memberId))],
      };
    });
    return {
      threads: summaries,
      total: all.length,
      nextCursor: offset + data.limit < all.length ? encodeCursor(offset + data.limit) : null,
    };
  },

  /** One message (email modal); 404 when it does not exist or the viewer may not see it. */
  async get(tx: Tx, input: { messageId: string }): Promise<EmailMessageView> {
    const { messageId } = getEmailInputSchema.parse(input);
    const [view] = await messageViews(tx, [messageId]);
    if (!view) throw notFound('Email not found', { message_id: messageId });
    return view;
  },

  /** Every message of a thread the viewer can see, oldest first. */
  async thread(tx: Tx, input: { threadId: string }): Promise<EmailThreadView> {
    const { threadId } = getThreadInputSchema.parse(input);
    const ids = await tx.db
      .selectFrom('email_messages')
      .select('id')
      .where('thread_id', '=', threadId)
      .orderBy('sent_at')
      .orderBy('id')
      .execute();
    const messages = await messageViews(
      tx,
      ids.map((r) => r.id),
    );
    if (messages.length === 0) throw notFound('Email thread not found', { thread_id: threadId });
    const best = messages.reduce((a, b) => (rank(b.access) > rank(a.access) ? b : a));
    const subjectSource = messages.find((m) => m.subject !== null);
    const thread = await tx.db
      .selectFrom('email_threads')
      .select('subject')
      .where('id', '=', threadId)
      .executeTakeFirst();
    return {
      threadId,
      access: best.access,
      subject: subjectSource ? (thread?.subject ?? subjectSource.subject) : null,
      messages,
    };
  },
};
