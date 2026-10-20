// FakeGoogle: an in-memory double of the Google endpoints the connector calls (7.09 tests; never the network).
// Pass `fake.fetch` as GoogleSettings.fetch (and `download`); requests to anything else throw.
//   OAuth     consent (`fake.consent(authUrl, email)` stands in for the browser), token (authorization_code with PKCE
//             S256 + redirect_uri checks, refresh_token), OpenID userinfo
//   Gmail     profile, messages.list (q: after:, -in:drafts, -in:chats, rfc822msgid:), messages.get (full / metadata),
//             attachments.get, threads.get, history.list (404 below the oldest kept history id), messages.send (JSON raw
//             and multipart media upload; the RFC 2822 text is parsed into a Gmail payload like Gmail does),
//             settings.sendAs
//   Calendar  events.list on the primary calendar (time window, page tokens, syncToken with 410 once expired)
// Messages are stored as RFC 2822 text and served as Gmail `format=full` payloads (base64url part bodies, attachment
// ids). Fault injection: `failNext` (any status/body for matching requests), revoked refresh tokens (invalid_grant),
// expired access tokens (401), expired history (404), expired sync tokens (410), missing scopes (403).
import { createHash } from 'node:crypto';
import type { GCalEvent } from './calendar.ts';
import type { GmailHistoryRecord, GmailMessageRef } from './gmail.ts';
import type { GmailHeader, GmailMessage, GmailPart } from './mime.ts';
import {
  CALENDAR_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  GOOGLE_ENDPOINTS,
  GOOGLE_SCOPES,
} from './settings.ts';

export interface FakeGoogleOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  /** Clock for token expiry. */
  now?: () => Date;
}

interface StoredMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  raw: string;
  internalDate: number;
}

interface Account {
  sub: string;
  email: string;
  name: string;
  aliases: string[];
  messages: Map<string, StoredMessage>;
  history: { id: number; record: GmailHistoryRecord }[];
  historyId: number;
  /** history.list with a start id below this answers 404. */
  minHistoryId: number;
  events: Map<string, { event: GCalEvent; seq: number }>;
  calendarSeq: number;
  /** Sync tokens issued below this seq answer 410. */
  minSyncSeq: number;
  attachments: Map<string, Buffer>;
}

interface Grant {
  email: string;
  scopes: string[];
}

interface PendingCode extends Grant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  used: boolean;
}

interface InjectedFailure {
  method?: string;
  path: RegExp;
  status: number;
  body: unknown;
  headers: Record<string, string>;
  times: number;
}

export interface FakeRequest {
  method: string;
  url: string;
  path: string;
  body: string;
}

const CRLF = '\r\n';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const googleError = (code: number, message: string, reason: string, status: string, extra: object = {}) =>
  json(code, { error: { code, message, errors: [{ message, domain: 'global', reason }], status, ...extra } });

// ---- a small RFC 2822 / MIME reader (what Gmail does with a raw message) -------------------------------------------

function splitHeaders(raw: string): { headers: GmailHeader[]; body: string } {
  const normalized = raw.replace(/\r?\n/g, CRLF);
  const end = normalized.indexOf(`${CRLF}${CRLF}`);
  const head = end < 0 ? normalized : normalized.slice(0, end);
  const body = end < 0 ? '' : normalized.slice(end + 4);
  const headers: GmailHeader[] = [];
  for (const line of head.split(CRLF)) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      const last = headers[headers.length - 1] as GmailHeader;
      last.value += ` ${line.trim()}`;
    } else {
      const colon = line.indexOf(':');
      if (colon > 0) headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
    }
  }
  return { headers, body };
}

const headerOf = (headers: GmailHeader[], name: string) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

function params(value: string | null): { type: string; params: Record<string, string> } {
  if (!value) return { type: '', params: {} };
  const [type, ...rest] = value.split(';');
  const out: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) {
      out[p.slice(0, eq).trim().toLowerCase()] = p
        .slice(eq + 1)
        .trim()
        .replace(/^"|"$/g, '');
    }
  }
  return { type: (type ?? '').trim().toLowerCase(), params: out };
}

function decodeTransfer(body: string, encoding: string | null): Buffer {
  const enc = (encoding ?? '7bit').toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') {
    const bytes: number[] = [];
    const text = body.replace(/=\r\n/g, '');
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '=' && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
        bytes.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(text.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes);
  }
  return Buffer.from(body, 'utf8');
}

function filenameOf(headers: GmailHeader[]): string {
  const disposition = params(headerOf(headers, 'Content-Disposition'));
  const star = disposition.params['filename*'];
  if (star) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(star);
    if (m) return decodeURIComponent(m[2] ?? '');
  }
  return disposition.params.filename ?? params(headerOf(headers, 'Content-Type')).params.name ?? '';
}

// ---- the fake ------------------------------------------------------------------------------------------------------

export class FakeGoogle {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly requests: FakeRequest[] = [];
  /** Everything sent through messages.send: the account, the parsed raw text and the requested thread. */
  readonly sent: { email: string; raw: string; threadId: string | null; id: string }[] = [];
  /** Files served to the `download` transport (outgoing attachments in object storage). */
  readonly files = new Map<string, Buffer>();
  /** When set, sent messages get a Message-ID of Gmail's own (like Gmail does for some senders). */
  rewriteMessageIds = false;

  private readonly now: () => Date;
  private readonly accounts = new Map<string, Account>();
  private readonly codes = new Map<string, PendingCode>();
  private readonly refreshTokens = new Map<string, Grant & { revoked: boolean }>();
  private readonly accessTokens = new Map<string, Grant & { expiresAt: number }>();
  private readonly failures: InjectedFailure[] = [];
  private seq = 0;

  constructor(options: FakeGoogleOptions = {}) {
    this.clientId = options.clientId ?? 'fake-client-id.apps.googleusercontent.com';
    this.clientSecret = options.clientSecret ?? 'fake-client-secret';
    this.redirectUri = options.redirectUri ?? 'http://localhost:4100/api/integrations/google/callback';
    this.now = options.now ?? (() => new Date());
  }

  /** Settings fragment to spread into GoogleSettings. */
  get settings() {
    return {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
      fetch: this.fetch,
      download: this.fetch,
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    };
  }

  private next(prefix: string): string {
    this.seq++;
    return `${prefix}${(0x18f0000000 + this.seq).toString(16)}`;
  }

  // ---- accounts ----------------------------------------------------------------------------------------------------

  addAccount(email: string, options: { name?: string; aliases?: string[]; historyId?: number } = {}): Account {
    const key = email.toLowerCase();
    const existing = this.accounts.get(key);
    if (existing) return existing;
    const account: Account = {
      sub: createHash('sha256')
        .update(key)
        .digest('hex')
        .slice(0, 21)
        .replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10)),
      email,
      name: options.name ?? email.split('@')[0] ?? email,
      aliases: options.aliases ?? [],
      messages: new Map(),
      history: [],
      historyId: options.historyId ?? 1000,
      minHistoryId: 0,
      events: new Map(),
      calendarSeq: 1,
      minSyncSeq: 0,
      attachments: new Map(),
    };
    this.accounts.set(key, account);
    return account;
  }

  account(email: string): Account {
    const a = this.accounts.get(email.toLowerCase());
    if (!a) throw new Error(`FakeGoogle: no account ${email}`);
    return a;
  }

  // ---- OAuth -------------------------------------------------------------------------------------------------------

  /**
   * The browser's trip through Google's consent page: validates the authorization URL and returns the redirect back
   * to the app (`redirect_uri?code=…&state=…`). `scopes` overrides what the user granted (unchecked boxes).
   */
  consent(authorizationUrl: string, email: string, options: { scopes?: string[]; deny?: boolean } = {}): string {
    const url = new URL(authorizationUrl);
    if (`${url.origin}${url.pathname}` !== GOOGLE_ENDPOINTS.authorize) throw new Error('FakeGoogle: not an auth URL');
    const p = url.searchParams;
    if (p.get('client_id') !== this.clientId) throw new Error('FakeGoogle: unknown client_id');
    if (p.get('response_type') !== 'code') throw new Error('FakeGoogle: response_type must be code');
    if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge'))
      throw new Error('FakeGoogle: PKCE S256 required');
    const back = new URL(p.get('redirect_uri') ?? '');
    const state = p.get('state');
    if (state) back.searchParams.set('state', state);
    if (options.deny) {
      back.searchParams.set('error', 'access_denied');
      return back.toString();
    }
    this.addAccount(email);
    const requested = (p.get('scope') ?? '').split(' ');
    const code = `4/${this.next('code')}`;
    this.codes.set(code, {
      email,
      scopes: options.scopes ?? requested,
      clientId: this.clientId,
      redirectUri: p.get('redirect_uri') ?? '',
      challenge: p.get('code_challenge') ?? '',
      used: false,
    });
    back.searchParams.set('code', code);
    back.searchParams.set('scope', (options.scopes ?? requested).join(' '));
    return back.toString();
  }

  private issueAccess(grant: Grant): { access_token: string; expires_in: number } {
    const token = `ya29.${this.next('at')}`;
    this.accessTokens.set(token, { ...grant, expiresAt: this.now().getTime() + 3600_000 });
    return { access_token: token, expires_in: 3599 };
  }

  /** Every refresh token of the account stops working (user revoked access / password change). */
  revoke(email: string): void {
    for (const t of this.refreshTokens.values()) if (t.email.toLowerCase() === email.toLowerCase()) t.revoked = true;
    for (const [k, t] of this.accessTokens)
      if (t.email.toLowerCase() === email.toLowerCase()) this.accessTokens.delete(k);
  }

  /** Every current access token of the account answers 401 (expired early). */
  expireAccessTokens(email: string): void {
    for (const [k, t] of this.accessTokens)
      if (t.email.toLowerCase() === email.toLowerCase()) this.accessTokens.delete(k);
  }

  /** Grants of new tokens issued by refresh lose these scopes (simulates a narrowed consent). */
  private readonly droppedScopes = new Map<string, Set<string>>();
  dropScopes(email: string, scopes: string[]): void {
    this.droppedScopes.set(email.toLowerCase(), new Set(scopes));
    for (const t of this.accessTokens.values()) {
      if (t.email.toLowerCase() === email.toLowerCase()) t.scopes = t.scopes.filter((s) => !scopes.includes(s));
    }
  }

  private token(form: URLSearchParams): Response {
    if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret) {
      return json(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
    }
    if (form.get('grant_type') === 'authorization_code') {
      const pending = this.codes.get(form.get('code') ?? '');
      if (!pending || pending.used)
        return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
      pending.used = true;
      if (form.get('redirect_uri') !== pending.redirectUri) {
        return json(400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' });
      }
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (challenge !== pending.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' });
      }
      const refresh = `1//${this.next('rt')}`;
      this.refreshTokens.set(refresh, { email: pending.email, scopes: pending.scopes, revoked: false });
      return json(200, {
        ...this.issueAccess(pending),
        refresh_token: refresh,
        scope: pending.scopes.join(' '),
        token_type: 'Bearer',
        id_token: 'fake.id.token',
      });
    }
    if (form.get('grant_type') === 'refresh_token') {
      const grant = this.refreshTokens.get(form.get('refresh_token') ?? '');
      if (!grant || grant.revoked) {
        return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      }
      const dropped = this.droppedScopes.get(grant.email.toLowerCase());
      const scopes = dropped ? grant.scopes.filter((s) => !dropped.has(s)) : grant.scopes;
      return json(200, {
        ...this.issueAccess({ email: grant.email, scopes }),
        scope: scopes.join(' '),
        token_type: 'Bearer',
      });
    }
    return json(400, { error: 'unsupported_grant_type', error_description: 'Invalid grant_type' });
  }

  /** The account behind a bearer token, or the error response. */
  private authorize(request: Request, scope: string | null): Account | Response {
    const auth = request.headers.get('authorization') ?? '';
    const grant = this.accessTokens.get(auth.replace(/^Bearer\s+/i, ''));
    if (!grant || grant.expiresAt < this.now().getTime()) {
      return googleError(401, 'Request had invalid authentication credentials.', 'authError', 'UNAUTHENTICATED');
    }
    if (scope && !grant.scopes.includes(scope)) {
      return json(403, {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }],
          status: 'PERMISSION_DENIED',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      });
    }
    return this.account(grant.email);
  }

  // ---- fault injection ---------------------------------------------------------------------------------------------

  /** The next `times` requests matching `path` (and `method`) answer `status` with `body`. */
  failNext(
    path: RegExp | string,
    status: number,
    options: { method?: string; body?: unknown; headers?: Record<string, string>; times?: number } = {},
  ): void {
    this.failures.push({
      ...(options.method ? { method: options.method } : {}),
      path: typeof path === 'string' ? new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : path,
      status,
      body:
        options.body ??
        (status === 429
          ? {
              error: {
                code: 429,
                message: 'Rate Limit Exceeded',
                errors: [{ reason: 'rateLimitExceeded' }],
                status: 'RESOURCE_EXHAUSTED',
              },
            }
          : { error: { code: status, message: `Injected ${status}`, errors: [{ reason: 'backendError' }] } }),
      headers: options.headers ?? {},
      times: options.times ?? 1,
    });
  }

  /** history.list from any id up to now answers 404 (Gmail keeps about a week of history). */
  expireHistory(email: string): void {
    const a = this.account(email);
    a.minHistoryId = a.historyId + 1;
  }

  /** Every sync token issued so far answers 410 Gone. */
  expireSyncTokens(email: string): void {
    const a = this.account(email);
    a.minSyncSeq = a.calendarSeq + 1;
  }

  /** Count of requests whose path matches. */
  count(path: RegExp | string, method?: string): number {
    return this.requests.filter(
      (r) => (typeof path === 'string' ? r.path.includes(path) : path.test(r.path)) && (!method || r.method === method),
    ).length;
  }

  // ---- mail --------------------------------------------------------------------------------------------------------

  private recordHistory(a: Account, record: Omit<GmailHistoryRecord, 'id'>): void {
    a.historyId++;
    a.history.push({ id: a.historyId, record: { id: String(a.historyId), ...record } });
  }

  private ref = (m: StoredMessage): GmailMessageRef => ({ id: m.id, threadId: m.threadId, labelIds: [...m.labelIds] });

  /** Stores a raw RFC 2822 message in the account (history: messageAdded). */
  addRaw(
    email: string,
    raw: string,
    options: { labels?: string[]; threadId?: string; internalDate?: Date; id?: string } = {},
  ): { id: string; threadId: string } {
    const a = this.account(email);
    const { headers } = splitHeaders(raw);
    let threadId = options.threadId;
    if (!threadId) {
      const parents: string[] =
        `${headerOf(headers, 'In-Reply-To') ?? ''} ${headerOf(headers, 'References') ?? ''}`.match(/<[^>]+>/g) ?? [];
      for (const m of a.messages.values()) {
        const mid = headerOf(splitHeaders(m.raw).headers, 'Message-ID');
        if (mid && parents.includes(mid)) {
          threadId = m.threadId;
          break;
        }
      }
    }
    const id = options.id ?? this.next('');
    const stored: StoredMessage = {
      id,
      threadId: threadId ?? id,
      labelIds: options.labels ?? ['INBOX', 'UNREAD'],
      raw,
      internalDate: (
        options.internalDate ?? new Date(Date.parse(headerOf(headers, 'Date') ?? '') || this.now().getTime())
      ).getTime(),
    };
    a.messages.set(id, stored);
    this.recordHistory(a, { messages: [this.ref(stored)], messagesAdded: [{ message: this.ref(stored) }] });
    return { id, threadId: stored.threadId };
  }

  /** Builds and stores a message (multipart/alternative text + html, optional attachments). */
  addMessage(
    email: string,
    m: {
      from: string;
      to: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      replyTo?: string;
      subject: string;
      text?: string;
      html?: string;
      attachments?: { name: string; contentType: string; data: Buffer | string }[];
      labels?: string[];
      messageId?: string;
      inReplyTo?: string;
      references?: string[];
      date?: Date;
      threadId?: string;
      /** Extra / overriding raw header lines. */
      headers?: Record<string, string>;
    },
  ): { id: string; threadId: string; messageId: string } {
    const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));
    const date = m.date ?? this.now();
    const messageId = m.messageId ?? `<${this.next('m')}@fake.mail.example>`;
    const head: Record<string, string> = {
      From: m.from,
      To: list(m.to),
      ...(m.cc ? { Cc: list(m.cc) } : {}),
      ...(m.bcc ? { Bcc: list(m.bcc) } : {}),
      ...(m.replyTo ? { 'Reply-To': m.replyTo } : {}),
      Subject: m.subject,
      Date: date.toUTCString(),
      'Message-ID': messageId,
      ...(m.inReplyTo ? { 'In-Reply-To': m.inReplyTo } : {}),
      ...(m.references ? { References: m.references.join(' ') } : {}),
      'MIME-Version': '1.0',
      ...m.headers,
    };
    const alt = `alt_${this.seq}`;
    const altBody = [
      `--${alt}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(m.text ?? '').toString('base64'),
      ...(m.html !== undefined
        ? [
            `--${alt}`,
            'Content-Type: text/html; charset="UTF-8"',
            'Content-Transfer-Encoding: quoted-printable',
            '',
            m.html.replace(/=/g, '=3D'),
          ]
        : []),
      `--${alt}--`,
    ];
    let body: string[];
    if (m.attachments?.length) {
      const mixed = `mixed_${this.seq}`;
      head['Content-Type'] = `multipart/mixed; boundary="${mixed}"`;
      body = [`--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '', ...altBody];
      for (const att of m.attachments) {
        body.push(
          `--${mixed}`,
          `Content-Type: ${att.contentType}; name="${att.name}"`,
          `Content-Disposition: attachment; filename="${att.name}"`,
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(att.data).toString('base64'),
        );
      }
      body.push(`--${mixed}--`);
    } else {
      head['Content-Type'] = `multipart/alternative; boundary="${alt}"`;
      body = altBody;
    }
    const raw = [...Object.entries(head).map(([k, v]) => `${k}: ${v}`), '', ...body, ''].join(CRLF);
    return {
      ...this.addRaw(email, raw, {
        ...(m.labels ? { labels: m.labels } : {}),
        ...(m.threadId ? { threadId: m.threadId } : {}),
        internalDate: date,
      }),
      messageId,
    };
  }

  /** Adds / removes labels (history labelAdded / labelRemoved). */
  modifyLabels(email: string, id: string, add: string[], remove: string[] = []): void {
    const a = this.account(email);
    const m = a.messages.get(id);
    if (!m) throw new Error(`FakeGoogle: no message ${id}`);
    m.labelIds = [...new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add])];
    if (add.length > 0)
      this.recordHistory(a, { messages: [this.ref(m)], labelsAdded: [{ message: this.ref(m), labelIds: add }] });
    if (remove.length > 0) {
      this.recordHistory(a, { messages: [this.ref(m)], labelsRemoved: [{ message: this.ref(m), labelIds: remove }] });
    }
  }

  trash(email: string, id: string): void {
    this.modifyLabels(email, id, ['TRASH'], ['INBOX']);
  }

  untrash(email: string, id: string): void {
    this.modifyLabels(email, id, ['INBOX'], ['TRASH']);
  }

  /** Permanently deletes a message (history messageDeleted). */
  deleteMessage(email: string, id: string): void {
    const a = this.account(email);
    const m = a.messages.get(id);
    if (!m) return;
    a.messages.delete(id);
    this.recordHistory(a, { messages: [this.ref(m)], messagesDeleted: [{ message: this.ref(m) }] });
  }

  /** Gmail payload of a stored message (format=full), with attachment ids registered for attachments.get. */
  private payload(a: Account, m: StoredMessage, raw: string, partId: string): GmailPart {
    const { headers, body } = splitHeaders(raw);
    const ct = params(headerOf(headers, 'Content-Type') ?? 'text/plain');
    const mimeType = ct.type || 'text/plain';
    if (mimeType.startsWith('multipart/') && ct.params.boundary) {
      const boundary = `--${ct.params.boundary}`;
      const chunks = body.split(new RegExp(`(?:^|\\r\\n)${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      const parts: GmailPart[] = [];
      for (const chunk of chunks.slice(1)) {
        if (chunk.startsWith('--')) break;
        const childId = partId === '' ? String(parts.length) : `${partId}.${parts.length}`;
        parts.push(this.payload(a, m, chunk.replace(/^\r\n/, ''), childId));
      }
      return { partId, mimeType, filename: '', headers, body: { size: 0 }, parts };
    }
    const data = decodeTransfer(body, headerOf(headers, 'Content-Transfer-Encoding'));
    const filename = filenameOf(headers);
    const disposition = params(headerOf(headers, 'Content-Disposition')).type;
    if (filename || disposition === 'attachment') {
      const attachmentId = `ANGjdJ_${createHash('sha256').update(`${m.id}/${partId}`).digest('base64url').slice(0, 24)}`;
      a.attachments.set(attachmentId, data);
      return { partId, mimeType, filename, headers, body: { attachmentId, size: data.length } };
    }
    return { partId, mimeType, filename: '', headers, body: { size: data.length, data: data.toString('base64url') } };
  }

  private messageResource(a: Account, m: StoredMessage, format: string, metadataHeaders: string[]): GmailMessage {
    const payload = this.payload(a, m, m.raw, '');
    const text = (() => {
      const walk = (p: GmailPart): string | null => {
        if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
        for (const c of p.parts ?? []) {
          const t = walk(c);
          if (t !== null) return t;
        }
        return null;
      };
      return walk(payload) ?? '';
    })();
    const base = {
      id: m.id,
      threadId: m.threadId,
      labelIds: [...m.labelIds],
      snippet: text.replace(/\s+/g, ' ').trim().slice(0, 140).replace(/&/g, '&amp;').replace(/'/g, '&#39;'),
      historyId: String(a.historyId),
      internalDate: String(m.internalDate),
      sizeEstimate: m.raw.length,
    };
    if (format === 'metadata') {
      const wanted = metadataHeaders.map((h) => h.toLowerCase());
      return {
        ...base,
        payload: {
          mimeType: payload.mimeType ?? 'text/plain',
          headers: (payload.headers ?? []).filter((h) => wanted.length === 0 || wanted.includes(h.name.toLowerCase())),
        },
      };
    }
    if (format === 'minimal') return base;
    return { ...base, payload };
  }

  private matches(m: StoredMessage, q: string, includeSpamTrash: boolean): boolean {
    if (!includeSpamTrash && m.labelIds.some((l) => l === 'SPAM' || l === 'TRASH')) return false;
    for (const term of q.split(/\s+/).filter(Boolean)) {
      if (term === '-in:drafts' && m.labelIds.includes('DRAFT')) return false;
      if (term === '-in:chats' && m.labelIds.includes('CHAT')) return false;
      const after = /^after:(\d+)$/.exec(term);
      if (after && m.internalDate / 1000 <= Number(after[1])) return false;
      const rfc = /^rfc822msgid:(.+)$/.exec(term);
      if (rfc) {
        const mid = headerOf(splitHeaders(m.raw).headers, 'Message-ID')?.replace(/^<|>$/g, '');
        if (mid !== rfc[1]) return false;
      }
    }
    return true;
  }

  private send(a: Account, raw: string, threadId: string | null): Response {
    const { headers } = splitHeaders(raw);
    if (!headerOf(headers, 'To') && !headerOf(headers, 'Cc') && !headerOf(headers, 'Bcc')) {
      return googleError(400, 'Recipient address required', 'invalidArgument', 'INVALID_ARGUMENT');
    }
    if (threadId && ![...a.messages.values()].some((m) => m.threadId === threadId)) {
      return googleError(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND');
    }
    let stored = raw;
    if (this.rewriteMessageIds) {
      stored = raw.replace(/^Message-ID:.*$/im, `Message-ID: <${this.next('gm')}@mail.gmail.com>`);
    }
    const { id, threadId: thread } = this.addRaw(a.email, stored, {
      labels: ['SENT'],
      ...(threadId ? { threadId } : {}),
      internalDate: this.now(),
    });
    this.sent.push({ email: a.email, raw, threadId, id });
    return json(200, { id, threadId: thread, labelIds: ['SENT'] });
  }

  // ---- calendar ----------------------------------------------------------------------------------------------------

  /** Adds or replaces an event (an update bumps it into the next incremental sync). */
  putEvent(email: string, event: Partial<GCalEvent> & { id?: string }): GCalEvent {
    const a = this.account(email);
    const id = event.id ?? this.next('evt');
    const current = a.events.get(id)?.event;
    const merged: GCalEvent = {
      kind: 'calendar#event',
      status: 'confirmed',
      iCalUID: `${id}@google.com`,
      organizer: { email: a.email, self: true },
      ...current,
      ...event,
      id,
    } as GCalEvent;
    a.calendarSeq++;
    a.events.set(id, { event: merged, seq: a.calendarSeq });
    return merged;
  }

  cancelEvent(email: string, id: string): void {
    const a = this.account(email);
    const current = a.events.get(id);
    if (!current) return;
    a.calendarSeq++;
    a.events.set(id, { event: { ...current.event, status: 'cancelled' }, seq: a.calendarSeq });
  }

  private listEvents(a: Account, url: URL): Response {
    const q = url.searchParams;
    const max = Math.min(2500, Number(q.get('maxResults') ?? 250));
    const pageToken = q.get('pageToken');
    const syncToken = q.get('syncToken');
    if (syncToken && (q.get('timeMin') || q.get('timeMax'))) {
      return googleError(400, 'timeMin is not allowed with syncToken', 'invalid', 'INVALID_ARGUMENT');
    }
    let since = 0;
    if (syncToken) {
      since = Number(syncToken.replace(/^sync-/, ''));
      if (!Number.isFinite(since) || since < a.minSyncSeq) {
        return googleError(410, 'Sync token is no longer valid, a full sync is required.', 'fullSyncRequired', 'GONE');
      }
    }
    const timeMin = q.get('timeMin') ? Date.parse(q.get('timeMin') as string) : null;
    const timeMax = q.get('timeMax') ? Date.parse(q.get('timeMax') as string) : null;
    const showDeleted = q.get('showDeleted') === 'true' || !!syncToken;
    const startOf = (e: GCalEvent) => Date.parse(e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`);
    const all = [...a.events.values()]
      .filter(({ event, seq }) => {
        if (syncToken) return seq > since;
        if (!showDeleted && event.status === 'cancelled') return false;
        const start = startOf(event);
        return (timeMin === null || start >= timeMin) && (timeMax === null || start < timeMax);
      })
      .sort((x, y) => x.seq - y.seq)
      .map((x) => x.event);
    const offset = pageToken ? Number(pageToken.replace(/^page-/, '')) : 0;
    const items = all.slice(offset, offset + max);
    const more = offset + max < all.length;
    return json(200, {
      kind: 'calendar#events',
      items,
      ...(more ? { nextPageToken: `page-${offset + max}` } : { nextSyncToken: `sync-${a.calendarSeq}` }),
    });
  }

  // ---- routing -----------------------------------------------------------------------------------------------------

  /** The fetch to inject (`GoogleSettings.fetch` / `download`). */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? '' : await request.text();
    this.requests.push({ method: request.method, url: request.url, path: url.pathname, body });
    const failure = this.failures.find(
      (f) => f.times > 0 && f.path.test(`${url.origin}${url.pathname}`) && (!f.method || f.method === request.method),
    );
    if (failure) {
      failure.times--;
      return json(failure.status, failure.body, failure.headers);
    }
    const file = this.files.get(request.url);
    if (file) return new Response(new Uint8Array(file), { status: 200 });
    const endpoint = `${url.origin}${url.pathname}`;
    if (endpoint === GOOGLE_ENDPOINTS.token && request.method === 'POST') return this.token(new URLSearchParams(body));
    if (endpoint === GOOGLE_ENDPOINTS.userinfo) {
      const a = this.authorize(request, null);
      if (a instanceof Response) return a;
      return json(200, { sub: a.sub, email: a.email, email_verified: true, name: a.name, picture: null });
    }
    if (endpoint.startsWith(`${GOOGLE_ENDPOINTS.gmailUpload}/users/me/messages/send`)) {
      const a = this.authorize(request, GMAIL_SEND_SCOPE);
      if (a instanceof Response) return a;
      const ct = params(request.headers.get('content-type'));
      const boundary = ct.params.boundary;
      if (url.searchParams.get('uploadType') !== 'multipart' || !boundary) {
        return googleError(400, 'Bad upload', 'badRequest', 'INVALID_ARGUMENT');
      }
      const [meta, message] = body
        .split(`--${boundary}`)
        .slice(1, 3)
        .map((p) => splitHeaders(p.replace(/^\r\n/, '')).body.replace(/\r\n$/, ''));
      const metadata = JSON.parse(meta || '{}') as { threadId?: string };
      return this.send(a, message ?? '', metadata.threadId ?? null);
    }
    if (endpoint.startsWith(`${GOOGLE_ENDPOINTS.gmail}/users/me/`)) {
      const path = endpoint.slice(`${GOOGLE_ENDPOINTS.gmail}/users/me`.length);
      const isSend = path === '/messages/send';
      const a = this.authorize(request, isSend ? GMAIL_SEND_SCOPE : GMAIL_READONLY_SCOPE);
      if (a instanceof Response) return a;
      return this.gmail(a, request.method, path, url, body);
    }
    if (endpoint === `${GOOGLE_ENDPOINTS.calendar}/calendars/primary/events`) {
      const a = this.authorize(request, CALENDAR_READONLY_SCOPE);
      if (a instanceof Response) return a;
      return this.listEvents(a, url);
    }
    throw new Error(`FakeGoogle: unexpected request ${request.method} ${request.url}`);
  };

  private gmail(a: Account, method: string, path: string, url: URL, body: string): Response {
    const q = url.searchParams;
    const notFound = () => googleError(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND');
    if (path === '/profile') {
      return json(200, { emailAddress: a.email, messagesTotal: a.messages.size, historyId: String(a.historyId) });
    }
    if (path === '/messages' && method === 'GET') {
      const max = Math.min(500, Number(q.get('maxResults') ?? 100));
      const offset = Number(q.get('pageToken') ?? 0);
      const all = [...a.messages.values()]
        .filter((m) => this.matches(m, q.get('q') ?? '', q.get('includeSpamTrash') === 'true'))
        .sort((x, y) => y.internalDate - x.internalDate || (x.id < y.id ? 1 : -1));
      const page = all.slice(offset, offset + max);
      return json(200, {
        ...(page.length > 0 ? { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) } : {}),
        ...(offset + max < all.length ? { nextPageToken: String(offset + max) } : {}),
        resultSizeEstimate: all.length,
      });
    }
    if (path === '/messages/send' && method === 'POST') {
      const { raw, threadId } = JSON.parse(body) as { raw?: string; threadId?: string };
      if (!raw)
        return googleError(
          400,
          "'raw' RFC822 payload message string or uploading message via /upload/* URL required",
          'invalidArgument',
          'INVALID_ARGUMENT',
        );
      return this.send(a, Buffer.from(raw, 'base64url').toString('utf8'), threadId ?? null);
    }
    const attachment = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (attachment) {
      const data = a.attachments.get(decodeURIComponent(attachment[2] ?? ''));
      if (!data || !a.messages.has(decodeURIComponent(attachment[1] ?? ''))) return notFound();
      return json(200, { size: data.length, data: data.toString('base64url') });
    }
    const message = /^\/messages\/([^/]+)$/.exec(path);
    if (message && method === 'GET') {
      const m = a.messages.get(decodeURIComponent(message[1] ?? ''));
      if (!m) return notFound();
      return json(200, this.messageResource(a, m, q.get('format') ?? 'full', q.getAll('metadataHeaders')));
    }
    const thread = /^\/threads\/([^/]+)$/.exec(path);
    if (thread && method === 'GET') {
      const id = decodeURIComponent(thread[1] ?? '');
      const messages = [...a.messages.values()]
        .filter((m) => m.threadId === id)
        .sort((x, y) => x.internalDate - y.internalDate);
      if (messages.length === 0) return notFound();
      return json(200, {
        id,
        historyId: String(a.historyId),
        messages: messages.map((m) => this.messageResource(a, m, q.get('format') ?? 'full', [])),
      });
    }
    if (path === '/history') {
      const start = Number(q.get('startHistoryId'));
      if (!Number.isFinite(start) || start < a.minHistoryId) return notFound();
      const types = new Set(q.getAll('historyTypes'));
      const max = Math.min(500, Number(q.get('maxResults') ?? 100));
      const offset = Number(q.get('pageToken') ?? 0);
      const records = a.history
        .filter((h) => h.id > start)
        .map((h) => h.record)
        .filter(
          (r) =>
            types.size === 0 ||
            (types.has('messageAdded') && r.messagesAdded) ||
            (types.has('messageDeleted') && r.messagesDeleted) ||
            (types.has('labelAdded') && r.labelsAdded) ||
            (types.has('labelRemoved') && r.labelsRemoved),
        );
      const page = records.slice(offset, offset + max);
      return json(200, {
        ...(page.length > 0 ? { history: page } : {}),
        ...(offset + max < records.length ? { nextPageToken: String(offset + max) } : {}),
        historyId: String(a.historyId),
      });
    }
    if (path === '/settings/sendAs') {
      return json(200, {
        sendAs: [
          { sendAsEmail: a.email, displayName: a.name, isPrimary: true, isDefault: true },
          ...a.aliases.map((alias) => ({ sendAsEmail: alias, displayName: a.name, verificationStatus: 'accepted' })),
        ],
      });
    }
    return notFound();
  }
}

/** All scopes the app asks for (a full consent). */
export const FULL_CONSENT = GOOGLE_SCOPES;
