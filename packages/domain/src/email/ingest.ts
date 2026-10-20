// Email ingestion (BACKLOG 7.01–7.02): applies a page of connector mail changes in the caller's transaction.
//   • Blocked messages (workspace blocked contacts, the mailbox-only blocklist) are skipped; an already stored copy is
//     removed.
//   • One logical message per RFC Message-ID (dedupe across mailboxes: "via N mailboxes"); one copy per mailbox.
//   • Threads: the mailbox's provider thread, else the thread of a message it replies to / references, else new.
//   • Participants are matched to members / people / companies and records are auto-created (email/records.ts):
//     mode all → every external participant; selective → recipients of messages sent by members; none → nothing.
//   • email_message_records indexes the records a message is about (the Emails tab, interactions, strength).
// The caller refreshes interaction attributes for the affected records and finalises the value engine.
import { sql } from '@agentic-crm/db';
import type { ConnectorMessage, MailChange } from '../connectors/types.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { type Address, matchesList, toAddress } from './model.ts';
import { RecordResolver } from './records.ts';

export interface IngestMailbox {
  id: string;
  memberId: string;
  emailAddress: string;
  aliases: string[];
}

export interface RecordKey {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** What a batch touched: records (interaction refresh, timeline, Emails tab) and threads. */
export class IngestEffects {
  readonly records = new Map<string, RecordKey>();
  readonly threads = new Set<string>();
  readonly meetings = new Set<string>();
  messages = 0;
  events = 0;
  skipped = 0;
  deleted = 0;

  addRecord(entityDefinitionId: string, entityInstanceId: string): void {
    this.records.set(entityInstanceId, { entityDefinitionId, entityInstanceId });
  }
}

type Role = 'from' | 'reply-to' | 'to' | 'cc' | 'bcc';

interface Participant {
  role: Role;
  position: number;
  address: Address;
}

const SUBJECT_PREFIX = /^\s*((re|fw|fwd|aw|wg|sv|antw)\s*(\[\d+\])?\s*:\s*)+/i;

/** Thread subject: the subject without reply / forward prefixes. */
export function threadSubject(subject: string): string {
  return subject.replace(SUBJECT_PREFIX, '').trim();
}

function participantsOf(message: ConnectorMessage): Participant[] {
  const out: Participant[] = [];
  const add = (role: Role, list: { emailAddress: string; name: string | null }[]) => {
    list.forEach((p, position) => {
      const address = toAddress(p.emailAddress, p.name);
      if (address) out.push({ role, position, address });
    });
  };
  add('from', [message.from]);
  add('reply-to', message.replyTo ?? []);
  add('to', message.to ?? []);
  add('cc', message.cc ?? []);
  add('bcc', message.bcc ?? []);
  return out;
}

async function mailboxBlocklist(tx: Tx, mailboxId: string) {
  const key = `mailbox-blocklist:${mailboxId}`;
  const cached = tx.memo.get(key) as { domains: Set<string>; emails: Set<string> } | undefined;
  if (cached) return cached;
  const rows = await tx.db
    .selectFrom('mailbox_blocklist')
    .select(['kind', 'value'])
    .where('mailbox_id', '=', mailboxId)
    .execute();
  const list = { domains: new Set<string>(), emails: new Set<string>() };
  for (const r of rows) (r.kind === 'domain' ? list.domains : list.emails).add(r.value);
  tx.memo.set(key, list);
  return list;
}

/** Addresses of the mailbox itself (primary + aliases), normalised. */
function ownAddresses(mailbox: IngestMailbox): Set<string> {
  return new Set(
    [mailbox.emailAddress, ...mailbox.aliases].map((a) => toAddress(a)?.email).filter((a): a is string => !!a),
  );
}

async function removeCopy(tx: Tx, mailboxId: string, providerMessageId: string, effects: IngestEffects) {
  const copy = await tx.db
    .updateTable('email_message_copies')
    .set({ deleted_at: tx.now })
    .where('mailbox_id', '=', mailboxId)
    .where('provider_message_id', '=', providerMessageId)
    .where('deleted_at', 'is', null)
    .returning('message_id')
    .executeTakeFirst();
  if (!copy) return false;
  const records = await tx.db
    .selectFrom('email_message_records')
    .select(['entity_definition_id', 'entity_instance_id', 'thread_id'])
    .where('message_id', '=', copy.message_id)
    .execute();
  for (const r of records) {
    effects.addRecord(r.entity_definition_id, r.entity_instance_id);
    effects.threads.add(r.thread_id);
  }
  effects.deleted++;
  return true;
}

async function findThread(tx: Tx, mailbox: IngestMailbox, message: ConnectorMessage): Promise<string | null> {
  if (message.providerThreadId) {
    const sibling = await tx.db
      .selectFrom('email_message_copies as c')
      .innerJoin('email_messages as m', 'm.id', 'c.message_id')
      .select('m.thread_id')
      .where('c.mailbox_id', '=', mailbox.id)
      .where('c.provider_thread_id', '=', message.providerThreadId)
      .executeTakeFirst();
    if (sibling) return sibling.thread_id;
  }
  const refs = [...new Set([message.inReplyTo, ...(message.references ?? [])].filter((r): r is string => !!r))];
  if (refs.length > 0) {
    const parent = await tx.db
      .selectFrom('email_messages')
      .select('thread_id')
      .where('rfc_message_id', 'in', refs)
      .orderBy('sent_at', 'desc')
      .executeTakeFirst();
    if (parent) return parent.thread_id;
  }
  return null;
}

/** Applies one upserted message from `mailbox`. */
async function ingestMessage(
  tx: Tx,
  resolver: RecordResolver,
  mailbox: IngestMailbox,
  message: ConnectorMessage,
  effects: IngestEffects,
): Promise<void> {
  const participants = participantsOf(message);
  const own = ownAddresses(mailbox);
  const blocklist = await mailboxBlocklist(tx, mailbox.id);
  const blocked = participants.some(
    (p) => !own.has(p.address.email) && (resolver.isBlocked(p.address) || matchesList(blocklist, p.address)),
  );
  if (blocked) {
    await removeCopy(tx, mailbox.id, message.providerMessageId, effects);
    effects.skipped++;
    return;
  }
  const fromAddress = participants.find((p) => p.role === 'from')?.address ?? null;
  const direction = fromAddress && own.has(fromAddress.email) ? 'outbound' : 'inbound';
  const sentAt = new Date(message.sentAt).toISOString();

  const existingCopy = await tx.db
    .selectFrom('email_message_copies')
    .select(['id', 'message_id', 'deleted_at'])
    .where('mailbox_id', '=', mailbox.id)
    .where('provider_message_id', '=', message.providerMessageId)
    .executeTakeFirst();

  let messageId: string;
  let threadId: string;
  const existing = await tx.db
    .selectFrom('email_messages')
    .select(['id', 'thread_id'])
    .where('rfc_message_id', '=', message.rfcMessageId)
    .executeTakeFirst();
  if (existing) {
    messageId = existing.id;
    threadId = existing.thread_id;
  } else {
    messageId = newId();
    threadId = (await findThread(tx, mailbox, message)) ?? newId();
    await tx.db
      .insertInto('email_threads')
      .values({
        id: threadId,
        workspace_id: tx.workspaceId,
        subject: threadSubject(message.subject),
        first_message_at: sentAt,
        last_message_at: sentAt,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          first_message_at: sql`least(email_threads.first_message_at, excluded.first_message_at)`,
          last_message_at: sql`greatest(email_threads.last_message_at, excluded.last_message_at)`,
        }),
      )
      .execute();

    // Record creation (F settings §4.2): all → every external participant; selective → recipients of messages that
    // members send; none → nothing.
    const mode = resolver.settings.recordCreation;
    const sentByMember = fromAddress !== null && resolver.memberOf(fromAddress) !== null;
    const matches = [];
    for (const p of participants) {
      const createPerson =
        mode === 'all' ||
        (mode === 'selective' && sentByMember && (p.role === 'to' || p.role === 'cc' || p.role === 'bcc'));
      matches.push({ p, match: await resolver.match(p.address, { createPerson }) });
    }
    const isInternal = matches.every((m) => m.match.internal);
    const isProtected = matches.some((m) => m.match.protectedContact);
    const attachments = (message.attachments ?? []).map((a) => ({
      id: a.providerAttachmentId,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
    }));
    await tx.db
      .insertInto('email_messages')
      .values({
        id: messageId,
        workspace_id: tx.workspaceId,
        thread_id: threadId,
        rfc_message_id: message.rfcMessageId,
        in_reply_to: message.inReplyTo ?? null,
        references_ids: message.references ?? [],
        subject: message.subject ?? '',
        snippet: (message.snippet || message.bodyText || '').slice(0, 300),
        body_text: message.bodyText ?? '',
        body_html: message.bodyHtml ?? null,
        sent_at: sentAt,
        has_attachments: attachments.length > 0,
        attachments: JSON.stringify(attachments),
        is_internal: isInternal,
        is_protected: isProtected,
      })
      .execute();
    await tx.db
      .insertInto('email_participants')
      .values(
        matches.map(({ p, match }) => ({
          message_id: messageId,
          workspace_id: tx.workspaceId,
          role: p.role,
          position: p.position,
          email_address: p.address.email,
          original_email_address: p.address.original,
          domain: p.address.domain,
          name: p.address.name,
          member_id: match.memberId,
          person_id: match.personId,
          company_id: match.companyId,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
    const linked = new Map<string, string>();
    for (const { match } of matches) {
      if (match.personId) linked.set(match.personId, resolver.peopleId);
      if (match.companyId) linked.set(match.companyId, resolver.companiesId);
    }
    if (linked.size > 0) {
      await tx.db
        .insertInto('email_message_records')
        .values(
          [...linked].map(([entityInstanceId, entityDefinitionId]) => ({
            message_id: messageId,
            workspace_id: tx.workspaceId,
            thread_id: threadId,
            entity_definition_id: entityDefinitionId,
            entity_instance_id: entityInstanceId,
            sent_at: sentAt,
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }

  if (existingCopy) {
    await tx.db
      .updateTable('email_message_copies')
      .set({ labels: message.labels ?? [], deleted_at: null, synced_at: tx.now })
      .where('id', '=', existingCopy.id)
      .execute();
    if (existingCopy.deleted_at === null) return; // already synced: labels only
  } else {
    await tx.db
      .insertInto('email_message_copies')
      .values({
        id: newId(),
        workspace_id: tx.workspaceId,
        message_id: messageId,
        mailbox_id: mailbox.id,
        member_id: mailbox.memberId,
        provider_message_id: message.providerMessageId,
        provider_thread_id: message.providerThreadId ?? null,
        direction,
        labels: message.labels ?? [],
      })
      .execute();
  }
  await sql`
    UPDATE email_threads SET first_message_at = least(first_message_at, ${sentAt}::timestamptz),
      last_message_at = greatest(last_message_at, ${sentAt}::timestamptz)
    WHERE id = ${threadId}`.execute(tx.db);
  const records = await tx.db
    .selectFrom('email_message_records')
    .select(['entity_definition_id', 'entity_instance_id'])
    .where('message_id', '=', messageId)
    .execute();
  for (const r of records) effects.addRecord(r.entity_definition_id, r.entity_instance_id);
  effects.threads.add(threadId);
  effects.messages++;
}

/** Applies a page of mail changes of one mailbox. */
export async function ingestMailChanges(
  tx: Tx,
  mailbox: IngestMailbox,
  changes: MailChange[],
  effects: IngestEffects,
): Promise<RecordResolver> {
  const resolver = await RecordResolver.create(tx);
  for (const change of changes) {
    if (change.type === 'delete') {
      await removeCopy(tx, mailbox.id, change.providerMessageId, effects);
      continue;
    }
    await ingestMessage(tx, resolver, mailbox, change.message, effects);
  }
  return resolver;
}
