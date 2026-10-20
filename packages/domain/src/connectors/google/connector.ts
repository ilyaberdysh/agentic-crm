// The Gmail + Google Calendar connector (BACKLOG 7.09; ARCHITECTURE D-21) behind EmailCalendarConnector.
//
// Mail cursor (JSON):
//   initial      {phase:'initial', historyId, pageToken}  messages.list pages (newest first) + messages.get each;
//                the profile's historyId is taken BEFORE the first page, so nothing that arrives meanwhile is lost
//   incremental  {phase:'incremental', historyId, pageToken}  users.history.list from historyId; a 404 (history id
//                too old) restarts the full sync — re-applying messages is idempotent (copies keyed by provider id)
// Calendar cursor (JSON):
//   initial      {phase:'initial', timeMin, timeMax, pageToken, startedAt}  events.list over the window
//   incremental  {phase:'incremental', syncToken, pageToken, fullSyncAt}  events.list?syncToken; 410 → full sync;
//                after `refreshDays` a full sync runs again so the window (and recurring instances) moves forward
// Drafts, spam, trash and chats are not synced; a message moved to trash / spam is a deletion, one restored is an
// upsert. Sending builds RFC 2822 (reply headers + Gmail threadId) and is idempotent per outbox id: the Message-ID is
// derived from it and a retry first looks for a sent message carrying it.
import type {
  CalendarChange,
  ChangePage,
  ConnectorMailbox,
  ConnectorMessage,
  EmailCalendarConnector,
  MailChange,
  OutgoingMessage,
  SentMessage,
} from '../types.ts';
import { ConnectorError } from '../types.ts';
import { CalendarApi, toCalendarChanges } from './calendar.ts';
import type { SecretBox } from './crypto.ts';
import { GmailApi, type GmailMessageRef, isNotFound } from './gmail.ts';
import { GoogleApiError, toConnectorError } from './http.ts';
import { buildMime, type MimeAttachment, parseMessageIds, toConnectorMessage } from './mime.ts';
import type { ResolvedGoogleSettings } from './settings.ts';
import { type CredentialStore, GoogleTokens } from './tokens.ts';

/** Gmail labels whose messages are not part of the synced mail. */
const EXCLUDED_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH', 'CHAT']);
const REMOVING_LABELS = new Set(['SPAM', 'TRASH']);
const excluded = (labels: readonly string[] | undefined) => (labels ?? []).some((l) => EXCLUDED_LABELS.has(l));

type MailCursor =
  | { v: 1; phase: 'initial'; historyId: string | null; pageToken: string | null }
  | { v: 1; phase: 'incremental'; historyId: string; pageToken: string | null };

type CalendarCursor =
  | { v: 1; phase: 'initial'; timeMin: string; timeMax: string; pageToken: string | null; startedAt: string }
  | { v: 1; phase: 'incremental'; syncToken: string; pageToken: string | null; fullSyncAt: string };

/** Cursor that restarts a full sync. */
const RESTART_MAIL: Extract<MailCursor, { phase: 'initial' }> = {
  v: 1,
  phase: 'initial',
  historyId: null,
  pageToken: null,
};

function parseCursor<T extends { v: 1 }>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as T;
    return value && typeof value === 'object' && value.v === 1 ? value : null;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping the order of the results. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

const DAY_MS = 86_400_000;

export interface GoogleConnectorDeps {
  settings: ResolvedGoogleSettings;
  box: SecretBox;
  store: CredentialStore;
}

export class GoogleConnector implements EmailCalendarConnector {
  readonly provider = 'gmail' as const;
  readonly tokens: GoogleTokens;
  readonly gmail: GmailApi;
  readonly calendar: CalendarApi;
  private readonly settings: ResolvedGoogleSettings;

  constructor(deps: GoogleConnectorDeps) {
    this.settings = deps.settings;
    this.tokens = new GoogleTokens(deps.settings, deps.box, deps.store);
    this.gmail = new GmailApi(deps.settings, this.tokens);
    this.calendar = new CalendarApi(deps.settings, this.tokens);
  }

  private async boundary<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw toConnectorError(err);
    }
  }

  // ---- mail ------------------------------------------------------------------------------------------------------

  private mailQuery(): string {
    const parts = ['-in:drafts', '-in:chats'];
    if (this.settings.mailSyncDays) {
      const after = Math.floor((this.settings.now().getTime() - this.settings.mailSyncDays * DAY_MS) / 1000);
      parts.push(`after:${after}`);
    }
    return parts.join(' ');
  }

  private async fetchMessages(mailbox: ConnectorMailbox, ids: readonly string[]) {
    return mapLimit(ids, this.settings.fetchConcurrency, async (id) => {
      const fetched = await this.gmail.getMessage(mailbox, id);
      return { id, fetched };
    });
  }

  listMailChanges(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    options: { limit: number },
  ): Promise<ChangePage<MailChange>> {
    return this.boundary(async () => {
      const parsed = parseCursor<MailCursor>(cursor);
      if (parsed?.phase === 'incremental') return this.incrementalMail(mailbox, parsed, options.limit);
      return this.initialMail(mailbox, parsed ?? { ...RESTART_MAIL }, options.limit);
    });
  }

  private async initialMail(
    mailbox: ConnectorMailbox,
    cursor: Extract<MailCursor, { phase: 'initial' }>,
    limit: number,
  ): Promise<ChangePage<MailChange>> {
    const historyId = cursor.historyId ?? (await this.gmail.profile(mailbox)).historyId;
    let page: Awaited<ReturnType<GmailApi['listMessages']>>;
    try {
      page = await this.gmail.listMessages(mailbox, {
        maxResults: Math.max(1, Math.min(500, limit)),
        q: this.mailQuery(),
        ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
      });
    } catch (err) {
      // A page token Gmail no longer accepts: start the full sync over (re-applied messages are no-ops).
      if (cursor.pageToken && err instanceof GoogleApiError && (err.status === 400 || err.status === 404)) {
        return { changes: [], nextCursor: JSON.stringify(RESTART_MAIL), hasMore: true };
      }
      throw err;
    }
    const fetched = await this.fetchMessages(
      mailbox,
      (page.messages ?? []).map((m) => m.id),
    );
    const changes: MailChange[] = [];
    for (const { fetched: f } of fetched) {
      if (f && !excluded(f.message.labelIds))
        changes.push({ type: 'upsert', message: toConnectorMessage(f.message, f.bodies) });
    }
    const next: MailCursor = page.nextPageToken
      ? { v: 1, phase: 'initial', historyId, pageToken: page.nextPageToken }
      : { v: 1, phase: 'incremental', historyId, pageToken: null };
    // The last full page hands over to history at once (catches what arrived during the full sync).
    return { changes, nextCursor: JSON.stringify(next), hasMore: true };
  }

  private async incrementalMail(
    mailbox: ConnectorMailbox,
    cursor: Extract<MailCursor, { phase: 'incremental' }>,
    limit: number,
  ): Promise<ChangePage<MailChange>> {
    let page: Awaited<ReturnType<GmailApi['listHistory']>>;
    try {
      page = await this.gmail.listHistory(mailbox, {
        startHistoryId: cursor.historyId,
        maxResults: Math.max(1, Math.min(500, limit)),
        ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
      });
    } catch (err) {
      // The history id is too old (Gmail keeps about a week): start over with a full sync.
      if (isNotFound(err)) return { changes: [], nextCursor: JSON.stringify(RESTART_MAIL), hasMore: true };
      throw err;
    }
    const actions = new Map<string, 'upsert' | 'delete' | 'skip'>();
    const set = (m: GmailMessageRef, action: 'upsert' | 'delete' | 'skip') => {
      actions.delete(m.id);
      actions.set(m.id, action);
    };
    for (const record of page.history ?? []) {
      for (const { message } of record.messagesAdded ?? [])
        set(message, excluded(message.labelIds) ? 'skip' : 'upsert');
      for (const { message } of record.messagesDeleted ?? []) set(message, 'delete');
      for (const { message, labelIds } of record.labelsAdded ?? []) {
        if ((labelIds ?? []).some((l) => REMOVING_LABELS.has(l))) set(message, 'delete');
      }
      for (const { message, labelIds } of record.labelsRemoved ?? []) {
        if ((labelIds ?? []).some((l) => REMOVING_LABELS.has(l)) && !excluded(message.labelIds)) set(message, 'upsert');
      }
    }
    const upserts = [...actions].filter(([, a]) => a === 'upsert').map(([id]) => id);
    const fetched = new Map((await this.fetchMessages(mailbox, upserts)).map(({ id, fetched: f }) => [id, f] as const));
    const changes: MailChange[] = [];
    for (const [id, action] of actions) {
      if (action === 'skip') continue;
      const f = action === 'upsert' ? fetched.get(id) : null;
      if (f && !excluded(f.message.labelIds)) {
        changes.push({ type: 'upsert', message: toConnectorMessage(f.message, f.bodies) });
      } else changes.push({ type: 'delete', providerMessageId: id });
    }
    const next: MailCursor = page.nextPageToken
      ? { v: 1, phase: 'incremental', historyId: cursor.historyId, pageToken: page.nextPageToken }
      : { v: 1, phase: 'incremental', historyId: page.historyId ?? cursor.historyId, pageToken: null };
    return { changes, nextCursor: JSON.stringify(next), hasMore: !!page.nextPageToken };
  }

  fetchMessage(mailbox: ConnectorMailbox, providerMessageId: string): Promise<ConnectorMessage | null> {
    return this.boundary(async () => {
      const f = await this.gmail.getMessage(mailbox, providerMessageId);
      return f ? toConnectorMessage(f.message, f.bodies) : null;
    });
  }

  fetchThread(mailbox: ConnectorMailbox, providerThreadId: string): Promise<ConnectorMessage[]> {
    return this.boundary(async () => {
      const messages = (await this.gmail.getThread(mailbox, providerThreadId)) ?? [];
      return messages
        .filter((m) => !excluded(m.message.labelIds))
        .map((m) => toConnectorMessage(m.message, m.bodies))
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    });
  }

  // ---- calendar --------------------------------------------------------------------------------------------------

  private freshCalendarCursor(): Extract<CalendarCursor, { phase: 'initial' }> {
    const now = this.settings.now().getTime();
    const { pastDays, futureDays } = this.settings.calendarWindow;
    return {
      v: 1,
      phase: 'initial',
      timeMin: new Date(now - pastDays * DAY_MS).toISOString(),
      timeMax: new Date(now + futureDays * DAY_MS).toISOString(),
      pageToken: null,
      startedAt: new Date(now).toISOString(),
    };
  }

  listCalendarChanges(
    mailbox: ConnectorMailbox,
    cursor: string | null,
    options: { limit: number },
  ): Promise<ChangePage<CalendarChange>> {
    return this.boundary(async () => {
      const maxResults = Math.max(1, Math.min(2500, options.limit));
      let parsed = parseCursor<CalendarCursor>(cursor);
      const refreshAfter = this.settings.calendarWindow.refreshDays * DAY_MS;
      if (
        parsed?.phase === 'incremental' &&
        !parsed.pageToken &&
        this.settings.now().getTime() - Date.parse(parsed.fullSyncAt) > refreshAfter
      ) {
        parsed = null; // Move the window forward with a new full sync.
      }
      if (!parsed || parsed.phase === 'initial') {
        const c = parsed ?? this.freshCalendarCursor();
        const page = await this.calendar.list(mailbox, {
          timeMin: c.timeMin,
          timeMax: c.timeMax,
          maxResults,
          ...(c.pageToken ? { pageToken: c.pageToken } : {}),
        });
        const changes = toCalendarChanges(page.items ?? [], { initial: true });
        if (page.nextPageToken) {
          return { changes, nextCursor: JSON.stringify({ ...c, pageToken: page.nextPageToken }), hasMore: true };
        }
        const next: CalendarCursor = page.nextSyncToken
          ? { v: 1, phase: 'incremental', syncToken: page.nextSyncToken, pageToken: null, fullSyncAt: c.startedAt }
          : { ...c, pageToken: null };
        return { changes, nextCursor: JSON.stringify(next), hasMore: false };
      }
      let page: Awaited<ReturnType<CalendarApi['list']>>;
      try {
        page = await this.calendar.list(mailbox, {
          syncToken: parsed.syncToken,
          maxResults,
          ...(parsed.pageToken ? { pageToken: parsed.pageToken } : {}),
        });
      } catch (err) {
        // The sync token expired (410 Gone): full sync again.
        if (err instanceof GoogleApiError && err.status === 410) {
          return { changes: [], nextCursor: JSON.stringify(this.freshCalendarCursor()), hasMore: true };
        }
        throw err;
      }
      const changes = toCalendarChanges(page.items ?? [], { initial: false });
      const next: CalendarCursor = page.nextPageToken
        ? { ...parsed, pageToken: page.nextPageToken }
        : { ...parsed, syncToken: page.nextSyncToken ?? parsed.syncToken, pageToken: null };
      return { changes, nextCursor: JSON.stringify(next), hasMore: !!page.nextPageToken };
    });
  }

  // ---- send ------------------------------------------------------------------------------------------------------

  private async downloadAttachments(message: OutgoingMessage): Promise<MimeAttachment[]> {
    const out: MimeAttachment[] = [];
    for (const a of message.attachments) {
      if (!a.downloadUrl) {
        throw new ConnectorError('email_preparation_failed', `The attachment ${a.name} is not available`);
      }
      let response: Response;
      try {
        response = await this.settings.download(a.downloadUrl, {
          signal: AbortSignal.timeout(this.settings.timeoutMs),
        });
      } catch (err) {
        throw new ConnectorError(
          'email_preparation_failed',
          `The attachment ${a.name} could not be read: ${String(err)}`,
          true,
        );
      }
      if (!response.ok) {
        throw new ConnectorError(
          'email_preparation_failed',
          `The attachment ${a.name} could not be read (${response.status})`,
          response.status >= 500,
        );
      }
      out.push({ name: a.name, contentType: a.contentType, data: Buffer.from(await response.arrayBuffer()) });
    }
    return out;
  }

  sendMessage(mailbox: ConnectorMailbox, message: OutgoingMessage): Promise<SentMessage> {
    return this.boundary(async () => {
      const domain = mailbox.emailAddress.split('@')[1] || 'mail.agentic-crm.local';
      const messageId = `<${message.outboundId}@${domain}>`;
      // A delivery retried after a crash (or a timeout after Gmail accepted it) must not send twice.
      const existing = await this.gmail.findByRfcMessageId(mailbox, messageId);
      if (existing) {
        return { providerMessageId: existing.id, providerThreadId: existing.threadId ?? null, rfcMessageId: messageId };
      }
      const creds = await this.tokens.credentials(mailbox);
      const from = { emailAddress: message.from.emailAddress, name: message.from.name ?? creds.name ?? null };
      const raw = buildMime(
        { ...message, from },
        { messageId, date: this.settings.now(), attachments: await this.downloadAttachments(message) },
      );
      let sent: GmailMessageRef;
      try {
        sent = await this.gmail.send(mailbox, raw, message.providerThreadId);
      } catch (err) {
        // The thread is gone from this mailbox: send it as a new conversation (the reply headers still thread it).
        if (!message.providerThreadId || !isNotFound(err)) throw err;
        sent = await this.gmail.send(mailbox, raw, null);
      }
      const stored = await this.gmail.messageIdHeader(mailbox, sent.id).catch(() => null);
      return {
        providerMessageId: sent.id,
        providerThreadId: sent.threadId ?? message.providerThreadId,
        rfcMessageId: parseMessageIds(stored)[0] ?? messageId,
      };
    });
  }
}
