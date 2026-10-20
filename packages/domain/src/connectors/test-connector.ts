// The `test` connector (slice7-contracts.md): a mailbox feed stored in Postgres (test_connector_items) that sync reads
// with a cursor (the feed seq), plus a sent log (test_connector_sent). Dev tools and tests append messages and
// calendar events through `connectors.test.injectMessage / injectEvent` (domain/email/index.ts); "sending" records
// the message as sent and appends it to the sender mailbox's feed as an outbound message, so the next sync ingests
// it exactly as a provider would report a sent message. Nothing is ever delivered.
//
// Failure simulation for the outbox: a recipient at the reserved domain `fail.test` makes the send fail with the
// reason named by its local part — `rate-limited@` / `unreachable@` (retryable), `rejected@`, `access@` (account
// access error), anything else → `unknown`.
import type { Database } from '@agentic-crm/db';
import { sql } from '@agentic-crm/db';
import { systemContext } from '../context.ts';
import { newId } from '../ids.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import {
  type CalendarChange,
  type ChangePage,
  ConnectorError,
  type ConnectorEvent,
  type ConnectorMailbox,
  type ConnectorMessage,
  type EmailCalendarConnector,
  type MailChange,
  type OutgoingMessage,
  type SentMessage,
} from './types.ts';

export const TEST_FAILURE_DOMAIN = 'fail.test';

type ItemKind = 'message' | 'message-deleted' | 'event' | 'event-deleted';

interface ItemRow {
  seq: string;
  kind: ItemKind;
  payload: unknown;
}

/** Appends one item to a test mailbox's feed (inside the caller's transaction). */
export async function appendTestItem(tx: Tx, mailboxId: string, kind: ItemKind, payload: unknown): Promise<string> {
  const row = await tx.db
    .insertInto('test_connector_items')
    .values({ workspace_id: tx.workspaceId, mailbox_id: mailboxId, kind, payload: JSON.stringify(payload) })
    .returning('seq')
    .executeTakeFirstOrThrow();
  return row.seq;
}

function failureFor(message: OutgoingMessage): ConnectorError | null {
  for (const r of [...message.to, ...message.cc, ...message.bcc]) {
    const [local, domain] = r.emailAddress.toLowerCase().split('@');
    if (domain !== TEST_FAILURE_DOMAIN) continue;
    switch (local) {
      case 'rate-limited':
        return new ConnectorError('provider_rate_limited', 'The provider rate-limited the request', true);
      case 'unreachable':
        return new ConnectorError('provider_unreachable', 'The provider could not be reached', true);
      case 'rejected':
        return new ConnectorError('provider_rejected_request', 'The provider rejected the request');
      case 'access':
        return new ConnectorError('account_access_error', 'The connected email account could not be accessed');
      default:
        return new ConnectorError('unknown', 'The email could not be delivered');
    }
  }
  return null;
}

export class TestConnector implements EmailCalendarConnector {
  readonly provider = 'test' as const;

  constructor(private readonly database: Database) {}

  private run<T>(mailbox: ConnectorMailbox, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return runInWorkspace(this.database, systemContext(mailbox.workspaceId, 'test-connector'), fn);
  }

  private async page(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    kinds: ItemKind[],
    limit: number,
  ): Promise<{ rows: ItemRow[]; nextCursor: string; hasMore: boolean }> {
    const after = cursor && /^\d+$/.test(cursor) ? cursor : '0';
    const rows = await this.run(mailbox, async (tx) => {
      const { rows } = await sql<ItemRow>`
        SELECT seq::text AS seq, kind, payload FROM test_connector_items
        WHERE mailbox_id = ${mailbox.id} AND seq > ${after}::bigint AND kind = ANY(${kinds}::text[])
        ORDER BY seq LIMIT ${limit + 1}`.execute(tx.db);
      return rows;
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return { rows: page, nextCursor: page.at(-1)?.seq ?? after, hasMore };
  }

  async listMailChanges(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    options: { limit: number },
  ): Promise<ChangePage<MailChange>> {
    const { rows, nextCursor, hasMore } = await this.page(
      mailbox,
      cursor,
      ['message', 'message-deleted'],
      options.limit,
    );
    const changes: MailChange[] = rows.map((r) =>
      r.kind === 'message'
        ? { type: 'upsert', message: r.payload as ConnectorMessage }
        : { type: 'delete', providerMessageId: (r.payload as { providerMessageId: string }).providerMessageId },
    );
    return { changes, nextCursor, hasMore };
  }

  async fetchMessage(mailbox: ConnectorMailbox, providerMessageId: string): Promise<ConnectorMessage | null> {
    return this.run(mailbox, async (tx) => {
      const { rows } = await sql<{ payload: ConnectorMessage }>`
        SELECT payload FROM test_connector_items
        WHERE mailbox_id = ${mailbox.id} AND kind = 'message' AND payload->>'providerMessageId' = ${providerMessageId}
        ORDER BY seq DESC LIMIT 1`.execute(tx.db);
      return rows[0]?.payload ?? null;
    });
  }

  async fetchThread(mailbox: ConnectorMailbox, providerThreadId: string): Promise<ConnectorMessage[]> {
    return this.run(mailbox, async (tx) => {
      const { rows } = await sql<{ payload: ConnectorMessage }>`
        SELECT DISTINCT ON (payload->>'providerMessageId') payload FROM test_connector_items
        WHERE mailbox_id = ${mailbox.id} AND kind = 'message' AND payload->>'providerThreadId' = ${providerThreadId}
        ORDER BY payload->>'providerMessageId', seq DESC`.execute(tx.db);
      return rows.map((r) => r.payload).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    });
  }

  async listCalendarChanges(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    options: { limit: number },
  ): Promise<ChangePage<CalendarChange>> {
    const { rows, nextCursor, hasMore } = await this.page(mailbox, cursor, ['event', 'event-deleted'], options.limit);
    const changes: CalendarChange[] = rows.map((r) =>
      r.kind === 'event'
        ? { type: 'upsert', event: r.payload as ConnectorEvent }
        : { type: 'delete', providerEventId: (r.payload as { providerEventId: string }).providerEventId },
    );
    return { changes, nextCursor, hasMore };
  }

  async sendMessage(mailbox: ConnectorMailbox, message: OutgoingMessage): Promise<SentMessage> {
    const failure = failureFor(message);
    if (failure) throw failure;
    const providerMessageId = `sent-${message.outboundId}`;
    const providerThreadId = message.providerThreadId ?? `thread-${message.outboundId}`;
    const rfcMessageId = `<${message.outboundId}@test.agentic-crm.local>`;
    const sent: ConnectorMessage = {
      providerMessageId,
      providerThreadId,
      rfcMessageId,
      inReplyTo: message.inReplyTo,
      references: message.references,
      subject: message.subject,
      snippet: message.bodyText.slice(0, 200),
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      sentAt: new Date().toISOString(),
      from: message.from,
      replyTo: [],
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      attachments: message.attachments.map((a, i) => ({
        providerAttachmentId: `${message.outboundId}-${i}`,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
      })),
      labels: ['SENT'],
    };
    await this.run(mailbox, async (tx) => {
      // Idempotent per outbox id: a retried delivery after a crash does not record a second copy.
      const existing = await tx.db
        .selectFrom('test_connector_sent')
        .select('id')
        .where('mailbox_id', '=', mailbox.id)
        .where(sql<boolean>`payload->>'outboundId' = ${message.outboundId}`)
        .executeTakeFirst();
      if (existing) return;
      await tx.db
        .insertInto('test_connector_sent')
        .values({
          id: newId(),
          workspace_id: mailbox.workspaceId,
          mailbox_id: mailbox.id,
          payload: JSON.stringify({ ...message, providerMessageId, rfcMessageId }),
        })
        .execute();
      await appendTestItem(tx, mailbox.id, 'message', sent);
    });
    return { providerMessageId, providerThreadId, rfcMessageId };
  }
}

/** Seed fixtures for a test mailbox (dev): a short thread with a customer, a newsletter and two meetings. */
export function testFixtures(
  mailboxAddress: string,
  now = new Date(),
): { messages: ConnectorMessage[]; events: ConnectorEvent[] } {
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  const me = { emailAddress: mailboxAddress, name: null };
  const jane = { emailAddress: 'jane.cooper@northwind.example.com', name: 'Jane Cooper' };
  const wade = { emailAddress: 'wade.warren@northwind.example.com', name: 'Wade Warren' };
  const message = (n: number, m: Partial<ConnectorMessage>): ConnectorMessage => ({
    providerMessageId: `fixture-${n}`,
    providerThreadId: 'fixture-thread-1',
    rfcMessageId: `<fixture-${n}@northwind.example.com>`,
    inReplyTo: null,
    references: [],
    subject: '',
    snippet: '',
    bodyText: '',
    bodyHtml: null,
    sentAt: at(-48),
    from: jane,
    replyTo: [],
    to: [me],
    cc: [],
    bcc: [],
    attachments: [],
    labels: ['INBOX'],
    ...m,
  });
  return {
    messages: [
      message(1, {
        subject: 'Pilot for Northwind',
        bodyText: 'Hi! We would like to start a pilot next month. Could you send the proposal?',
        snippet: 'Hi! We would like to start a pilot next month.',
        sentAt: at(-72),
        cc: [wade],
      }),
      message(2, {
        subject: 'Re: Pilot for Northwind',
        bodyText: 'Sure, the proposal is attached.',
        snippet: 'Sure, the proposal is attached.',
        sentAt: at(-70),
        from: me,
        to: [jane],
        cc: [wade],
        inReplyTo: '<fixture-1@northwind.example.com>',
        references: ['<fixture-1@northwind.example.com>'],
        rfcMessageId: '<fixture-2@test.agentic-crm.local>',
        attachments: [
          { providerAttachmentId: 'fixture-2-a', name: 'proposal.pdf', contentType: 'application/pdf', size: 48213 },
        ],
        labels: ['SENT'],
      }),
      message(3, {
        providerThreadId: 'fixture-thread-2',
        rfcMessageId: '<fixture-3@news.example.org>',
        subject: 'Weekly digest',
        bodyText: 'Top stories of the week.',
        snippet: 'Top stories of the week.',
        sentAt: at(-24),
        from: { emailAddress: 'digest@news.example.org', name: 'Example News' },
      }),
    ],
    events: [
      {
        providerEventId: 'fixture-event-1',
        icalUid: 'fixture-event-1@northwind.example.com',
        title: 'Discovery call — Northwind',
        description: 'Scope the pilot.',
        start: { dateTime: at(-26), timeZone: 'UTC' },
        end: { dateTime: at(-25), timeZone: 'UTC' },
        status: 'confirmed',
        conferenceUrl: null,
        location: null,
        attendees: [
          { ...me, status: 'accepted', isOrganizer: true },
          { ...jane, status: 'accepted', isOrganizer: false },
        ],
      },
      {
        providerEventId: 'fixture-event-2',
        icalUid: 'fixture-event-2@northwind.example.com',
        title: 'Pilot kickoff',
        description: '',
        start: { dateTime: at(50), timeZone: 'UTC' },
        end: { dateTime: at(51), timeZone: 'UTC' },
        status: 'confirmed',
        conferenceUrl: 'https://meet.example.com/abc',
        location: null,
        attendees: [
          { ...me, status: 'accepted', isOrganizer: true },
          { ...jane, status: 'pending', isOrganizer: false },
          { ...wade, status: 'tentative', isOrganizer: false },
        ],
      },
    ],
  };
}
