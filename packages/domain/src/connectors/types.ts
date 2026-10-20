// The connector boundary (slice7-contracts.md "Connector boundary"): everything provider-specific about email and
// calendar sits behind EmailCalendarConnector. Ingestion, record auto-creation, interaction attributes, the timeline
// and the outbox depend only on this interface. 7a ships the `test` connector (test-connector.ts); 7b adds Gmail +
// Google Calendar (connectors/google/**).
//
// Connector calls happen outside database transactions (they may hit the network); each returned batch is then
// applied in one domain transaction together with the new cursor (I1), so a crash between two batches resumes from
// the last committed cursor and re-applying a batch is idempotent (copies are keyed by provider ids).
import type { DeliveryErrorCode, ProviderType } from '@agentic-crm/contracts';

/** What a connector needs to address one mailbox. */
export interface ConnectorMailbox {
  id: string;
  workspaceId: string;
  memberId: string;
  providerType: ProviderType;
  emailAddress: string;
  aliases: string[];
  connectedAccountId: string;
  /** Provider credentials (7b: OAuth tokens); null for the test connector. */
  credentials: unknown;
}

export interface ConnectorAddress {
  emailAddress: string;
  name: string | null;
}

export interface ConnectorAttachment {
  providerAttachmentId: string;
  name: string;
  contentType: string;
  size: number;
}

export interface ConnectorMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  /** RFC 5322 Message-ID: the dedupe key across mailboxes. */
  rfcMessageId: string;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  /** ISO timestamp. */
  sentAt: string;
  from: ConnectorAddress;
  replyTo: ConnectorAddress[];
  to: ConnectorAddress[];
  cc: ConnectorAddress[];
  bcc: ConnectorAddress[];
  attachments: ConnectorAttachment[];
  labels: string[];
}

export type MailChange = { type: 'upsert'; message: ConnectorMessage } | { type: 'delete'; providerMessageId: string };

export type ConnectorEventTime = { dateTime: string; timeZone: string | null } | { date: string };

export interface ConnectorAttendee extends ConnectorAddress {
  status: 'accepted' | 'tentative' | 'declined' | 'pending';
  isOrganizer: boolean;
}

export interface ConnectorEvent {
  providerEventId: string;
  /** iCalendar UID: the dedupe key across mailboxes (one meeting per UID). */
  icalUid: string;
  title: string;
  description: string;
  start: ConnectorEventTime;
  end: ConnectorEventTime;
  status: 'confirmed' | 'tentative' | 'cancelled';
  conferenceUrl: string | null;
  location: string | null;
  attendees: ConnectorAttendee[];
}

export type CalendarChange = { type: 'upsert'; event: ConnectorEvent } | { type: 'delete'; providerEventId: string };

export interface ChangePage<T> {
  changes: T[];
  /** Cursor to store once the page is applied (pass it to the next call). */
  nextCursor: string;
  /** More changes are available right away. */
  hasMore: boolean;
}

export interface OutgoingMessage {
  /** Our outbox id (idempotency key for providers that support one). */
  outboundId: string;
  from: ConnectorAddress;
  to: ConnectorAddress[];
  cc: ConnectorAddress[];
  bcc: ConnectorAddress[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Reply threading. */
  inReplyTo: string | null;
  references: string[];
  providerThreadId: string | null;
  attachments: { name: string; contentType: string; size: number; downloadUrl: string | null }[];
}

export interface SentMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  rfcMessageId: string;
}

export interface EmailCalendarConnector {
  readonly provider: ProviderType;
  /** Mail changes after `cursor` (null = start the initial sync). */
  listMailChanges(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    options: { limit: number },
  ): Promise<ChangePage<MailChange>>;
  /** One message (re-fetch after a partial change, reply source for the composer). */
  fetchMessage(mailbox: ConnectorMailbox, providerMessageId: string): Promise<ConnectorMessage | null>;
  /** Every message of a provider thread, oldest first. */
  fetchThread(mailbox: ConnectorMailbox, providerThreadId: string): Promise<ConnectorMessage[]>;
  /** Calendar changes after `cursor` (null = start the initial sync). */
  listCalendarChanges(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    options: { limit: number },
  ): Promise<ChangePage<CalendarChange>>;
  /** Hands one message to the provider for delivery. Throws ConnectorError on failure. */
  sendMessage(mailbox: ConnectorMailbox, message: OutgoingMessage): Promise<SentMessage>;
}

/**
 * A provider failure with the outbox failure reason it maps to (F composer §5). `retryable` failures are retried
 * with backoff until the attempt limit; the others fail the email at once.
 */
export class ConnectorError extends Error {
  readonly code: DeliveryErrorCode;
  readonly retryable: boolean;

  constructor(code: DeliveryErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.retryable = retryable;
  }
}

export type ConnectorRegistry = Partial<Record<ProviderType, EmailCalendarConnector>>;
