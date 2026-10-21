// Gmail REST calls used by the connector (7.09): profile (history id), messages.list / get, threads.get,
// history.list, messages.send (JSON `raw`, or a multipart media upload above the JSON size limit), the attachment
// endpoint (large bodies Gmail returns by reference) and settings.sendAs (the mailbox's verified aliases).
import type { ConnectorMailbox } from '../types.ts';
import { GoogleApiError, googleRequest } from './http.ts';
import { deferredBodyParts, type GmailMessage } from './mime.ts';
import type { ResolvedGoogleSettings } from './settings.ts';
import type { GoogleTokens } from './tokens.ts';

export interface GmailMessageRef {
  id: string;
  threadId?: string;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id: string;
  messages?: GmailMessageRef[];
  messagesAdded?: { message: GmailMessageRef }[];
  messagesDeleted?: { message: GmailMessageRef }[];
  labelsAdded?: { message: GmailMessageRef; labelIds?: string[] }[];
  labelsRemoved?: { message: GmailMessageRef; labelIds?: string[] }[];
}

export interface GmailHistoryPage {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailListPage {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** Above this the message goes through the media-upload endpoint (Gmail accepts up to 35 MB there). */
export const JSON_SEND_LIMIT_BYTES = 4 * 1024 * 1024;

export const isNotFound = (err: unknown) => err instanceof GoogleApiError && err.status === 404;

export class GmailApi {
  constructor(
    private readonly settings: ResolvedGoogleSettings,
    private readonly tokens: GoogleTokens,
  ) {}

  private url(path: string): string {
    return `${this.settings.endpoints.gmail}/users/me${path}`;
  }

  private get<T>(
    mailbox: ConnectorMailbox,
    path: string,
    query?: Record<string, string | number | string[] | undefined>,
  ) {
    return this.tokens.call(mailbox, (token) => googleRequest<T>(this.settings, { url: this.url(path), token, query }));
  }

  profile(mailbox: ConnectorMailbox) {
    return this.get<{ emailAddress: string; historyId: string }>(mailbox, '/profile');
  }

  listMessages(mailbox: ConnectorMailbox, query: { pageToken?: string; maxResults: number; q?: string }) {
    return this.get<GmailListPage>(mailbox, '/messages', {
      maxResults: query.maxResults,
      pageToken: query.pageToken,
      q: query.q,
      includeSpamTrash: 'false',
    });
  }

  /** Large bodies Gmail returned by reference, fetched so the message parses completely. */
  private async resolveBodies(mailbox: ConnectorMailbox, message: GmailMessage): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    for (const attachmentId of deferredBodyParts(message)) {
      const part = await this.get<{ data?: string }>(
        mailbox,
        `/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachmentId)}`,
      );
      if (part?.data) resolved.set(attachmentId, part.data);
    }
    return resolved;
  }

  /** One message (format=full) with its referenced body parts; null when Gmail no longer has it. */
  async getMessage(
    mailbox: ConnectorMailbox,
    id: string,
  ): Promise<{ message: GmailMessage; bodies: Map<string, string> } | null> {
    try {
      const message = await this.get<GmailMessage>(mailbox, `/messages/${encodeURIComponent(id)}`, { format: 'full' });
      return { message, bodies: await this.resolveBodies(mailbox, message) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getThread(
    mailbox: ConnectorMailbox,
    id: string,
  ): Promise<{ message: GmailMessage; bodies: Map<string, string> }[] | null> {
    try {
      const thread = await this.get<{ messages?: GmailMessage[] }>(mailbox, `/threads/${encodeURIComponent(id)}`, {
        format: 'full',
      });
      const out: { message: GmailMessage; bodies: Map<string, string> }[] = [];
      for (const message of thread.messages ?? []) {
        out.push({ message, bodies: await this.resolveBodies(mailbox, message) });
      }
      return out;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** History after `startHistoryId`; Gmail answers 404 when that id is too old (then a full resync is needed). */
  listHistory(mailbox: ConnectorMailbox, query: { startHistoryId: string; pageToken?: string; maxResults: number }) {
    return this.get<GmailHistoryPage>(mailbox, '/history', {
      startHistoryId: query.startHistoryId,
      pageToken: query.pageToken,
      maxResults: query.maxResults,
      historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
    });
  }

  /** A message in the mailbox carrying this RFC Message-ID (a send that already went through). */
  async findByRfcMessageId(mailbox: ConnectorMailbox, rfcMessageId: string): Promise<GmailMessageRef | null> {
    const page = await this.get<GmailListPage>(mailbox, '/messages', {
      q: `rfc822msgid:${rfcMessageId.replace(/^<|>$/g, '')}`,
      maxResults: 1,
      includeSpamTrash: 'true',
    });
    return page.messages?.[0] ?? null;
  }

  async messageIdHeader(mailbox: ConnectorMailbox, id: string): Promise<string | null> {
    const message = await this.get<GmailMessage>(mailbox, `/messages/${encodeURIComponent(id)}`, {
      format: 'metadata',
      metadataHeaders: ['Message-ID'],
    });
    const h = message.payload?.headers?.find((x) => x.name.toLowerCase() === 'message-id');
    return h?.value.trim() ?? null;
  }

  /** users.messages.send with the RFC 2822 text (in the given thread when set). */
  send(mailbox: ConnectorMailbox, raw: string, threadId: string | null): Promise<GmailMessageRef> {
    const bytes = Buffer.byteLength(raw);
    return this.tokens.call(mailbox, (token) => {
      if (bytes <= JSON_SEND_LIMIT_BYTES) {
        return googleRequest<GmailMessageRef>(this.settings, {
          method: 'POST',
          url: this.url('/messages/send'),
          token,
          json: { raw: Buffer.from(raw).toString('base64url'), ...(threadId ? { threadId } : {}) },
          retry: false,
        });
      }
      const boundary = `crm_re_upload_${Date.now().toString(36)}`;
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(threadId ? { threadId } : {}),
        `--${boundary}`,
        'Content-Type: message/rfc822',
        '',
        raw,
        `--${boundary}--`,
        '',
      ].join('\r\n');
      return googleRequest<GmailMessageRef>(this.settings, {
        method: 'POST',
        url: `${this.settings.endpoints.gmailUpload}/users/me/messages/send`,
        query: { uploadType: 'multipart' },
        token,
        body: { contentType: `multipart/related; boundary=${boundary}`, data: body },
        retry: false,
      });
    });
  }

  /** Verified send-as addresses other than the primary one (aliases). */
  aliases(mailbox: ConnectorMailbox): Promise<string[]> {
    return this.tokens.call(mailbox, (token) => sendAsAliases(this.settings, token));
  }
}

/** Verified send-as addresses other than the primary one, with a bare access token (OAuth callback). */
export async function sendAsAliases(settings: ResolvedGoogleSettings, token: string): Promise<string[]> {
  const result = await googleRequest<{
    sendAs?: { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[];
  }>(settings, { url: `${settings.endpoints.gmail}/users/me/settings/sendAs`, token });
  return (result?.sendAs ?? [])
    .filter((s) => !s.isPrimary && (s.verificationStatus === undefined || s.verificationStatus === 'accepted'))
    .map((s) => s.sendAsEmail);
}
