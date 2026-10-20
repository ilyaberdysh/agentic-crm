// Gmail + Google Calendar connector (BACKLOG 7.09) against FakeGoogle (never the network): OAuth connect with PKCE
// and sealed credentials, reconnect, initial and incremental mail sync (drafts / spam excluded, trash = deletion),
// expired history id → full resync, calendar sync token + 410 → full resync, recurring instances and private events,
// send with reply headers and Gmail threadId (idempotent per outbox id), token refresh, invalid_grant → needs
// reconnection, missing scopes, error mapping, and the poll job.
import { randomBytes } from 'node:crypto';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { GoogleApiError, GoogleNetworkError, toConnectorError } from '../src/connectors/google/http.ts';
import {
  buildMime,
  decodeEncodedWords,
  deferredBodyParts,
  parseAddressList,
  parseMessageIds,
  toConnectorMessage,
} from '../src/connectors/google/mime.ts';
import {
  type ConnectorError,
  type ConnectorMailbox,
  createDomain,
  createGoogleIntegration,
  FakeGoogle,
  GoogleConnectError,
  type GoogleSettings,
  memberContext,
  type OutgoingMessage,
  RecordingJobQueue,
  type ServiceContext,
} from '../src/index.ts';
import { addMember } from './collab-fixtures.ts';
import { type EmailFixture, emailFixture, recordsByValue } from './email-fixtures.ts';
import { database, expectCode, newId, storage } from './support/harness.ts';

const HOUR = 3_600_000;

/** A FakeGoogle, a clock both sides share, and a domain wired to them. */
function googleWorld(options: { jobs?: RecordingJobQueue } = {}) {
  let clock = Date.now();
  const now = () => new Date(clock);
  const fake = new FakeGoogle({ now });
  const settings: GoogleSettings = { ...fake.settings, encryptionKey: randomBytes(32), now };
  const domain = createDomain({ database, storage, google: settings, ...(options.jobs ? { jobs: options.jobs } : {}) });
  const integration = createGoogleIntegration({ database, settings, queueSync: async () => {} });
  const google = domain.integrations.google;
  if (!google) throw new Error('google not configured');
  return {
    fake,
    domain,
    google,
    connector: integration.connector,
    advance: (ms: number) => {
      clock += ms;
    },
    now,
  };
}

type World = ReturnType<typeof googleWorld>;

/** Runs the whole browser round trip: begin → consent at the fake → verify → complete. */
async function connect(
  w: World,
  f: Pick<EmailFixture, 'workspaceId' | 'slug'>,
  member: { memberId: string; ctx: ServiceContext },
  email: string,
  options: { mailboxId?: string; scopes?: string[] } = {},
) {
  const begun = w.google.begin({
    workspaceId: f.workspaceId,
    memberId: member.memberId,
    slug: f.slug,
    mailboxId: options.mailboxId ?? null,
  });
  const back = new URL(w.fake.consent(begun.url, email, options.scopes ? { scopes: options.scopes } : {}));
  const verified = w.google.verify({ state: back.searchParams.get('state'), cookie: begun.cookie });
  if (!verified.ok) throw new Error(`verify failed: ${verified.reason}`);
  return w.google.complete(member.ctx, {
    code: back.searchParams.get('code') as string,
    state: verified.state,
    verifier: verified.verifier,
  });
}

async function connectorMailbox(mailboxId: string): Promise<ConnectorMailbox> {
  const row = await database.kysely
    .selectFrom('mailboxes as m')
    .innerJoin('connected_accounts as a', 'a.id', 'm.connected_account_id')
    .select([
      'm.id',
      'm.workspace_id',
      'm.member_id',
      'm.provider_type',
      'm.email_address',
      'm.aliases',
      'm.connected_account_id',
      'a.credentials',
    ])
    .where('m.id', '=', mailboxId)
    .executeTakeFirstOrThrow();
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    providerType: row.provider_type,
    emailAddress: row.email_address,
    aliases: row.aliases,
    connectedAccountId: row.connected_account_id,
    credentials: row.credentials,
  };
}

const sync = (w: World, ctx: ServiceContext, mailboxId: string) =>
  w.domain.mailboxes.sync(ctx, { mailboxId, wait: true }).then((r) => r.result);

async function copies(mailboxId: string) {
  const { rows } = await sql<{ provider_message_id: string; deleted: boolean; subject: string; labels: string[] }>`
    SELECT c.provider_message_id, c.deleted_at IS NOT NULL AS deleted, m.subject, c.labels
    FROM email_message_copies c JOIN email_messages m ON m.id = c.message_id
    WHERE c.mailbox_id = ${mailboxId} ORDER BY m.sent_at`.execute(database.kysely);
  return rows;
}

async function cursors(mailboxId: string) {
  const row = await database.kysely
    .selectFrom('mailboxes')
    .select(['mail_cursor', 'calendar_cursor', 'sync_state'])
    .where('id', '=', mailboxId)
    .executeTakeFirstOrThrow();
  return {
    mail: row.mail_cursor ? (JSON.parse(row.mail_cursor) as Record<string, unknown>) : null,
    calendar: row.calendar_cursor ? (JSON.parse(row.calendar_cursor) as Record<string, unknown>) : null,
    syncState: row.sync_state,
  };
}

describe('MIME', () => {
  it('parses address lists with quoted names, groups, comments and encoded words', () => {
    expect(
      parseAddressList(
        '"Cooper, Jane" <jane@northwind.example>, wade@northwind.example (Wade W), =?UTF-8?B?0JjQstCw0L0=?= <ivan@x.example>, Team: a@b.example, c@d.example;, undisclosed-recipients:;',
      ),
    ).toEqual([
      { emailAddress: 'jane@northwind.example', name: 'Cooper, Jane' },
      { emailAddress: 'wade@northwind.example', name: 'Wade W' },
      { emailAddress: 'ivan@x.example', name: 'Иван' },
      { emailAddress: 'a@b.example', name: null },
      { emailAddress: 'c@d.example', name: null },
    ]);
    expect(decodeEncodedWords('=?ISO-8859-1?Q?Caf=E9_cr=E8me?= =?UTF-8?Q?_=E2=9C=93?= ok')).toBe('Café crème ✓ ok');
    expect(parseMessageIds('<a@x> \r\n <b@y>')).toEqual(['<a@x>', '<b@y>']);
  });

  it('reads a Latin-1 quoted-printable message and flags body parts Gmail returns by reference', () => {
    const fake = new FakeGoogle();
    fake.addAccount('me@ourco.example');
    const raw = [
      'From: =?ISO-8859-1?Q?Ren=E9?= <rene@client.example>',
      'To: me@ourco.example',
      'Subject: =?ISO-8859-1?Q?R=E9sum=E9?=',
      'Message-ID: <latin@client.example>',
      'Content-Type: text/plain; charset="ISO-8859-1"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Voil=E0 le r=E9sum=E9.\u0000',
      '',
    ].join('\r\n');
    const { id } = fake.addRaw('me@ourco.example', raw);
    const account = fake.account('me@ourco.example');
    const stored = account.messages.get(id);
    expect(stored).toBeDefined();
    // Built from the fake's payload (as Gmail serves it).
    const message = toConnectorMessage({
      id,
      threadId: id,
      labelIds: ['INBOX'],
      internalDate: '1760000000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: '=?ISO-8859-1?Q?Ren=E9?= <rene@client.example>' },
          { name: 'Subject', value: '=?ISO-8859-1?Q?R=E9sum=E9?=' },
          { name: 'Message-ID', value: '<latin@client.example>' },
          { name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' },
        ],
        body: { size: 20, data: Buffer.from('Voilà le résumé.\u0000', 'latin1').toString('base64url') },
      },
    });
    expect(message).toMatchObject({
      subject: 'Résumé',
      bodyText: 'Voilà le résumé.',
      from: { emailAddress: 'rene@client.example', name: 'René' },
      rfcMessageId: '<latin@client.example>',
      sentAt: new Date(1760000000000).toISOString(),
    });
    const big = {
      id: 'm1',
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          { partId: '0', mimeType: 'text/plain', body: { size: 9, data: Buffer.from('short').toString('base64url') } },
          { partId: '1', mimeType: 'text/html', body: { size: 9_000_000, attachmentId: 'big-html' } },
        ],
      },
    };
    expect(deferredBodyParts(big)).toEqual(['big-html']);
    expect(
      toConnectorMessage(big, new Map([['big-html', Buffer.from('<p>huge</p>').toString('base64url')]])).bodyHtml,
    ).toBe('<p>huge</p>');
  });

  it('builds RFC 2822 with encoded headers, reply headers and attachments that Gmail parses back', () => {
    const message: OutgoingMessage = {
      outboundId: 'out-1',
      from: { emailAddress: 'ada@ourco.example', name: 'Ada Lovelace' },
      to: [{ emailAddress: 'jane@client.example', name: 'Cooper, Jane' }],
      cc: [{ emailAddress: 'ivan@client.example', name: 'Иван' }],
      bcc: [],
      subject: 'Re: Résumé\r\nBcc: injected@evil.example',
      bodyText: 'Thanks!',
      bodyHtml: '<p>Thanks!</p>',
      inReplyTo: '<parent@client.example>',
      references: ['<root@client.example>'],
      providerThreadId: null,
      attachments: [],
    };
    const raw = buildMime(message, {
      messageId: '<out-1@ourco.example>',
      date: new Date('2026-10-15T10:00:00Z'),
      attachments: [{ name: 'Offre spéciale.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4') }],
    });
    expect(raw).toContain('To: "Cooper, Jane" <jane@client.example>');
    expect(raw).toContain('Cc: =?UTF-8?B?');
    expect(raw).toContain('In-Reply-To: <parent@client.example>');
    expect(raw).toContain('References: <root@client.example> <parent@client.example>');
    expect(raw).not.toMatch(/^Bcc: injected/m);
    expect(raw.split('\r\n').every((line) => line.length <= 998)).toBe(true);
    const fake = new FakeGoogle();
    fake.addAccount('ada@ourco.example');
    const { id } = fake.addRaw('ada@ourco.example', raw, { labels: ['SENT'] });
    expect(fake.account('ada@ourco.example').messages.get(id)?.raw).toBe(raw);
  });
});

describe('error mapping', () => {
  it('maps Google failures onto outbox reasons', () => {
    const cases: [unknown, string, boolean][] = [
      [new GoogleApiError(429, 'rateLimitExceeded', 'slow down'), 'provider_rate_limited', true],
      [new GoogleApiError(403, 'userRateLimitExceeded', 'slow down'), 'provider_rate_limited', true],
      [new GoogleApiError(503, 'backendError', 'down'), 'provider_unreachable', true],
      [new GoogleNetworkError('ECONNRESET'), 'provider_unreachable', true],
      [new GoogleApiError(401, 'authError', 'no'), 'account_access_error', false],
      [new GoogleApiError(403, 'forbidden', 'no'), 'account_access_error', false],
      [new GoogleApiError(400, 'invalidArgument', 'Invalid To header'), 'provider_rejected_request', false],
      [new Error('bug'), 'unknown', true],
    ];
    for (const [err, code, retryable] of cases) {
      expect(toConnectorError(err)).toMatchObject({ code, retryable });
    }
  });
});

describe('OAuth connect', () => {
  it('starts with PKCE and a signed state, refuses tampered / foreign / expired callbacks', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const begun = w.google.begin({ workspaceId: f.workspaceId, memberId: f.memberId, slug: f.slug });
    const url = new URL(begun.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: w.fake.clientId,
      redirect_uri: w.fake.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining([
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar.readonly',
      ]),
    );
    const state = url.searchParams.get('state') as string;
    expect(w.google.verify({ state, cookie: begun.cookie })).toMatchObject({ ok: true });
    expect(w.google.verify({ state: `${state}x`, cookie: begun.cookie })).toMatchObject({
      ok: false,
      reason: 'invalid-state',
    });
    const other = w.google.begin({ workspaceId: f.workspaceId, memberId: f.memberId, slug: f.slug });
    expect(w.google.verify({ state, cookie: other.cookie })).toMatchObject({ ok: false, reason: 'cookie-mismatch' });
    expect(w.google.verify({ state, cookie: null })).toMatchObject({ ok: false, reason: 'cookie-mismatch' });
    w.advance(11 * 60_000);
    expect(w.google.verify({ state, cookie: begun.cookie })).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('creates a Gmail mailbox with sealed credentials and aliases; reconnect keeps the mailbox', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email, { name: 'Ada Lovelace', aliases: [`ada@sales-${f.tag}.io`] });
    const { mailbox, reconnected } = await connect(w, f, f, email);
    expect(reconnected).toBe(false);
    expect(mailbox).toMatchObject({
      providerType: 'gmail',
      emailAddress: email,
      aliases: [`ada@sales-${f.tag}.io`],
      credentialState: 'active',
      isDefault: false, // the fixture's test mailbox stays the default sender
      defaultVisibility: 'subject-line',
    });
    const account = await database.kysely
      .selectFrom('connected_accounts')
      .selectAll()
      .where('id', '=', mailbox.connectedAccountId)
      .executeTakeFirstOrThrow();
    expect(account.provider).toBe('gmail');
    expect(account.external_account_id).toBe(w.fake.account(email).sub);
    const stored = JSON.stringify(account.credentials);
    expect(stored).toContain('"alg":"A256GCM"');
    expect(stored).not.toContain('1//'); // no refresh token in clear text
    expect(stored).not.toContain('ya29.');

    // Reconnect (from the mailbox's menu, or simply connecting the same account again) reuses the mailbox.
    const again = await connect(w, f, f, email, { mailboxId: mailbox.id });
    expect(again).toMatchObject({ reconnected: true, mailbox: { id: mailbox.id, credentialState: 'active' } });
    const plain = await connect(w, f, f, email);
    expect(plain.mailbox.id).toBe(mailbox.id);

    // Reconnecting with another Google account is refused; another member cannot take the address.
    w.fake.addAccount(`someone@ourco-${f.tag}.io`);
    await expectCode(
      connect(w, f, f, `someone@ourco-${f.tag}.io`, { mailboxId: mailbox.id }),
      'MAILBOX_ACCOUNT_MISMATCH',
      409,
    );
    const bob = await addMember(f, 'Bob');
    const bobCtx = memberContext(f.workspaceId, bob.memberId);
    await expectCode(connect(w, f, { memberId: bob.memberId, ctx: bobCtx }, email), 'MAILBOX_ALREADY_CONNECTED', 409);
  });

  it('refuses a consent without every permission', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    const failure = await connect(w, f, f, email, {
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(GoogleConnectError);
    expect((failure as GoogleConnectError).reason).toBe('missing-scopes');
    expect((await w.domain.mailboxes.list(f.ctx)).map((m) => m.providerType)).toEqual(['test']);
  });
});

describe('Gmail sync', () => {
  async function seeded() {
    const w = googleWorld();
    const f = await emailFixture({ recordCreation: 'all' });
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    const jane = `jane@northwind-${f.tag}.com`;
    w.fake.addAccount(email, { name: 'Ada Lovelace' });
    const base = Date.now() - 10 * 24 * HOUR;
    const at = (h: number) => new Date(base + h * HOUR);
    const first = w.fake.addMessage(email, {
      from: `"Cooper, Jane" <${jane}>`,
      to: email,
      cc: `Wade Warren <wade@northwind-${f.tag}.com>`,
      subject: 'Pilot for Northwind',
      text: 'We would like to start a pilot.',
      html: '<p>We would like to start a <b>pilot</b>.</p>',
      date: at(0),
    });
    const reply = w.fake.addMessage(email, {
      from: `Ada Lovelace <${email}>`,
      to: jane,
      subject: 'Re: Pilot for Northwind',
      text: 'Proposal attached.',
      attachments: [{ name: 'proposal.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 fake') }],
      inReplyTo: first.messageId,
      references: [first.messageId],
      labels: ['SENT'],
      date: at(2),
    });
    w.fake.addMessage(email, {
      from: email,
      to: jane,
      subject: 'Draft not sent',
      text: 'wip',
      labels: ['DRAFT'],
      date: at(3),
    });
    w.fake.addMessage(email, {
      from: `promo@spam-${f.tag}.biz`,
      to: email,
      subject: 'You won',
      text: '!!!',
      labels: ['SPAM'],
      date: at(4),
    });
    const encoded = w.fake.addMessage(email, {
      from: `=?UTF-8?B?0JjQstCw0L0g0J/QtdGC0YDQvtCy?= <ivan@rogi-${f.tag}.ru>`,
      to: email,
      subject: '=?UTF-8?B?0J/RgNC40LLQtdGC?=',
      html: '<div>Only <i>HTML</i> here &amp; there</div>',
      date: at(5),
    });
    const { mailbox } = await connect(w, f, f, email);
    return { w, f, email, jane, first, reply, encoded, mailbox, at };
  }

  it('initial sync ingests mail (not drafts or spam) with bodies, attachments, labels and threads', async () => {
    const { w, f, email, jane, first, reply, encoded, mailbox } = await seeded();
    const result = await sync(w, f.ctx, mailbox.id);
    expect(result).toMatchObject({ messages: 3 });
    const rows = await copies(mailbox.id);
    expect(rows.map((r) => r.provider_message_id)).toEqual([first.id, reply.id, encoded.id]);
    expect(rows.find((r) => r.provider_message_id === reply.id)?.labels).toEqual(['SENT']);
    const cursor = await cursors(mailbox.id);
    expect(cursor.mail).toMatchObject({ phase: 'incremental', historyId: String(w.fake.account(email).historyId) });
    expect(cursor.syncState).toBe('realtime');

    const [person] = await recordsByValue(f, 'people', jane);
    expect(person).toBeDefined();
    const threads = await w.domain.email.threads(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: person as string },
    });
    expect(threads.threads).toHaveLength(1);
    // The row shows the latest message of the thread.
    expect(threads.threads[0]).toMatchObject({ subject: 'Re: Pilot for Northwind', messageCount: 2 });
    const thread = await w.domain.email.thread(f.ctx, { threadId: threads.threads[0]?.threadId as string });
    const [inbound, outbound] = thread.messages;
    expect(inbound?.bodyHtml).toContain('<b>pilot</b>');
    expect(inbound?.participants).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'from', emailAddress: jane, name: 'Cooper, Jane' })]),
    );
    expect(outbound?.attachments).toEqual([expect.objectContaining({ name: 'proposal.pdf', size: 13 })]);

    const ivan = await w.domain.email.get(f.ctx, {
      messageId: (
        await database.kysely
          .selectFrom('email_message_copies')
          .select('message_id')
          .where('provider_message_id', '=', encoded.id)
          .where('mailbox_id', '=', mailbox.id)
          .executeTakeFirstOrThrow()
      ).message_id,
    });
    expect(ivan).toMatchObject({ subject: 'Привет', bodyText: 'Only HTML here & there' });
  });

  it('pages the full sync and hands over to history', async () => {
    const { w, mailbox, email } = await seeded();
    const box = await connectorMailbox(mailbox.id);
    const one = await w.connector.listMailChanges(box, null, { limit: 2 });
    expect(one.changes).toHaveLength(2); // newest first: the encoded one, then (draft / spam skipped by q) the reply
    expect(JSON.parse(one.nextCursor)).toMatchObject({ phase: 'initial', pageToken: '2' });
    // A page token Gmail rejects restarts the full sync instead of failing forever.
    w.fake.failNext(/\/users\/me\/messages$/, 400, { method: 'GET' });
    const restarted = await w.connector.listMailChanges(box, one.nextCursor, { limit: 2 });
    expect(restarted).toMatchObject({ changes: [], hasMore: true });
    expect(JSON.parse(restarted.nextCursor)).toMatchObject({ phase: 'initial', historyId: null, pageToken: null });
    const two = await w.connector.listMailChanges(box, one.nextCursor, { limit: 2 });
    expect(two.changes).toHaveLength(1);
    expect(JSON.parse(two.nextCursor)).toMatchObject({ phase: 'incremental' });
    expect(two.hasMore).toBe(true);
    const three = await w.connector.listMailChanges(box, two.nextCursor, { limit: 2 });
    expect(three).toMatchObject({ changes: [], hasMore: false });
    expect(w.fake.count('/profile')).toBe(1);
    expect(email).toBeTruthy();
  });

  it('incremental sync: new mail, trash and permanent deletes, restore; expired history → full resync', async () => {
    const { w, f, email, jane, first, reply, mailbox, at } = await seeded();
    await sync(w, f.ctx, mailbox.id);
    const late = w.fake.addMessage(email, {
      from: jane,
      to: email,
      subject: 'Re: Pilot for Northwind',
      text: 'Signed!',
      inReplyTo: reply.messageId,
      references: [first.messageId, reply.messageId],
      date: at(30),
    });
    w.fake.trash(email, first.id);
    const listCalls = () => w.fake.count(/\/users\/me\/messages$/, 'GET');
    const listsBefore = listCalls();
    const result = await sync(w, f.ctx, mailbox.id);
    expect(result).toMatchObject({ messages: 1, deleted: 1 });
    expect(listCalls()).toBe(listsBefore); // history only, no messages.list
    let rows = await copies(mailbox.id);
    expect(rows.find((r) => r.provider_message_id === first.id)?.deleted).toBe(true);
    expect(rows.find((r) => r.provider_message_id === late.id)?.deleted).toBe(false);

    w.fake.untrash(email, first.id);
    w.fake.deleteMessage(email, reply.id);
    await sync(w, f.ctx, mailbox.id);
    rows = await copies(mailbox.id);
    expect(rows.find((r) => r.provider_message_id === first.id)?.deleted).toBe(false);
    expect(rows.find((r) => r.provider_message_id === reply.id)?.deleted).toBe(true);

    // History older than Gmail keeps: 404 → the full sync runs again; nothing is duplicated.
    w.fake.expireHistory(email);
    const missed = w.fake.addMessage(email, { from: jane, to: email, subject: 'While away', text: 'hi', date: at(40) });
    const profileCalls = w.fake.count('/profile');
    const resync = await sync(w, f.ctx, mailbox.id);
    expect(w.fake.count('/profile')).toBe(profileCalls + 1);
    expect(resync?.messages).toBeGreaterThanOrEqual(1);
    rows = await copies(mailbox.id);
    expect(rows.filter((r) => r.provider_message_id === missed.id)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.provider_message_id)).size).toBe(rows.length);
    expect((await cursors(mailbox.id)).mail).toMatchObject({ phase: 'incremental' });
  });

  it('fetchThread and fetchMessage read from Gmail', async () => {
    const { w, first, reply, mailbox } = await seeded();
    const box = await connectorMailbox(mailbox.id);
    const thread = await w.connector.fetchThread(box, first.threadId);
    expect(thread.map((m) => m.providerMessageId)).toEqual([first.id, reply.id]);
    expect(thread[1]).toMatchObject({ inReplyTo: first.messageId, references: [first.messageId] });
    expect(await w.connector.fetchMessage(box, 'nope')).toBeNull();
  });
});

describe('Google Calendar sync', () => {
  it('syncs the primary calendar: attendees, conference links, recurring instances, private events skipped', async () => {
    const w = googleWorld();
    const f = await emailFixture({ recordCreation: 'all' });
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    const guest = `jane@northwind-${f.tag}.com`;
    w.fake.addAccount(email);
    const day = (d: number, h = 10) => new Date(Date.now() + d * 24 * HOUR + h * HOUR).toISOString();
    const attendees = [
      { email, self: true, organizer: true, responseStatus: 'accepted' as const },
      { email: guest, displayName: 'Jane Cooper', responseStatus: 'needsAction' as const },
      { email: 'room-1@resource.calendar.google.com', resource: true, responseStatus: 'accepted' as const },
    ];
    w.fake.putEvent(email, {
      id: 'evt1',
      summary: 'Discovery call',
      description: '<p>Scope the <b>pilot</b></p>',
      start: { dateTime: day(-2), timeZone: 'Europe/Berlin' },
      end: { dateTime: day(-2, 11), timeZone: 'Europe/Berlin' },
      attendees,
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
    });
    for (const [i, d] of [3, 10].entries()) {
      w.fake.putEvent(email, {
        id: `weekly_${i}`,
        iCalUID: `weekly-${f.tag}@google.com`,
        recurringEventId: 'weekly',
        originalStartTime: { dateTime: day(d), timeZone: 'UTC' },
        summary: 'Weekly sync',
        start: { dateTime: day(d) },
        end: { dateTime: day(d, 11) },
        attendees,
      });
    }
    w.fake.putEvent(email, {
      id: 'private1',
      summary: 'Doctor',
      visibility: 'private',
      start: { dateTime: day(1) },
      end: { dateTime: day(1, 11) },
      attendees,
    });
    w.fake.putEvent(email, {
      id: 'wl',
      eventType: 'workingLocation',
      start: { date: '2026-10-20' },
      end: { date: '2026-10-21' },
    });
    w.fake.putEvent(email, {
      id: 'offsite',
      summary: 'Offsite',
      start: { date: day(5).slice(0, 10) },
      end: { date: day(6).slice(0, 10) },
      attendees,
    });
    const { mailbox } = await connect(w, f, f, email);
    const result = await sync(w, f.ctx, mailbox.id);
    expect(result?.events).toBe(4);
    const [person] = await recordsByValue(f, 'people', guest);
    const meetings = await w.domain.meetings.list(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: person as string },
    });
    const titles = meetings.meetings.map((m) => m.title).sort();
    expect(titles).toEqual(['Discovery call', 'Offsite', 'Weekly sync', 'Weekly sync']);
    const discovery = meetings.meetings.find((m) => m.title === 'Discovery call');
    expect(discovery).toMatchObject({ description: 'Scope the pilot' });
    expect(JSON.stringify(discovery)).toContain('https://meet.google.com/abc-defg-hij');
    const cursor = await cursors(mailbox.id);
    expect(cursor.calendar).toMatchObject({ phase: 'incremental', syncToken: expect.stringMatching(/^sync-/) });
    const firstList = w.fake.requests.find((r) => r.path.endsWith('/events'));
    expect(firstList?.url).toContain('timeMin=');
    expect(firstList?.url).toContain('singleEvents=true');

    // Incremental: a title change and a cancellation.
    w.fake.putEvent(email, { id: 'evt1', summary: 'Discovery call (moved)' });
    w.fake.cancelEvent(email, 'weekly_1');
    w.fake.putEvent(email, { id: 'private1', visibility: 'default' });
    await sync(w, f.ctx, mailbox.id);
    const incremental = w.fake.requests.filter((r) => r.path.endsWith('/events')).at(-1);
    expect(incremental?.url).toContain('syncToken=');
    expect(incremental?.url).not.toContain('timeMin=');
    const after = await w.domain.meetings.list(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: person as string },
    });
    expect(after.meetings.map((m) => m.title).sort()).toEqual([
      'Discovery call (moved)',
      'Doctor',
      'Offsite',
      'Weekly sync',
    ]);

    // An expired sync token (410) runs the full sync again.
    w.fake.expireSyncTokens(email);
    w.fake.putEvent(email, {
      id: 'late',
      summary: 'Late addition',
      start: { dateTime: day(7) },
      end: { dateTime: day(7, 11) },
      attendees,
    });
    await sync(w, f.ctx, mailbox.id);
    const gone = w.fake.requests.filter((r) => r.path.endsWith('/events')).slice(-2);
    expect(gone[0]?.url).toContain('syncToken=');
    expect(gone[1]?.url).toContain('timeMin=');
    const final = await w.domain.meetings.list(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: person as string },
    });
    expect(final.meetings.map((m) => m.title)).toContain('Late addition');
  });
});

describe('sending through Gmail', () => {
  it('replies in the Gmail thread with In-Reply-To / References; the sent copy syncs once', async () => {
    const w = googleWorld();
    const f = await emailFixture({ recordCreation: 'all' });
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    const jane = `jane@northwind-${f.tag}.com`;
    w.fake.addAccount(email, { name: 'Ada Lovelace' });
    const inbound = w.fake.addMessage(email, {
      from: `Jane Cooper <${jane}>`,
      to: email,
      subject: 'Pricing question',
      text: 'How much?',
      date: new Date(Date.now() - HOUR),
    });
    const { mailbox } = await connect(w, f, f, email);
    await w.domain.mailboxes.update(f.ctx, { mailboxId: mailbox.id, isDefault: true });
    await sync(w, f.ctx, mailbox.id);
    const parent = await database.kysely
      .selectFrom('email_message_copies')
      .select('message_id')
      .where('provider_message_id', '=', inbound.id)
      .where('mailbox_id', '=', mailbox.id)
      .executeTakeFirstOrThrow();

    const draftId = newId();
    await w.domain.email.drafts.create(f.ctx, {
      id: draftId,
      senderMailboxId: mailbox.id,
      parentMessageId: parent.message_id,
      subject: { text: 'Re: Pricing question', variables: [] },
      body: [{ type: 'unstyled', indent: 0, text: 'It is free.', styles: [], mentions: [], variables: [] }] as never,
      to: [{ emailAddress: jane, name: 'Jane Cooper' }],
    });
    const { outbox } = await w.domain.email.drafts.send(f.ctx, { draftId });
    const delivered = await w.domain.email.outbox.deliverDue(f.workspaceId);
    expect(delivered).toMatchObject({ sent: 1, failed: 0 });
    expect(w.fake.sent).toHaveLength(1);
    const sent = w.fake.sent[0] as (typeof w.fake.sent)[number];
    expect(sent.threadId).toBe(inbound.threadId);
    expect(sent.raw).toContain(`In-Reply-To: ${inbound.messageId}`);
    expect(sent.raw).toContain(`References: ${inbound.messageId}`);
    expect(sent.raw).toContain(`From: Ada Lovelace <${email}>`);
    expect(sent.raw).toContain('To: Jane Cooper <');
    expect(sent.raw).toContain(`Message-ID: <${outbox[0]?.id}@ourco-${f.tag}.io>`);
    const row = await database.kysely
      .selectFrom('outbound_emails')
      .select(['delivery_state', 'provider_message_id', 'rfc_message_id'])
      .where('id', '=', outbox[0]?.id as string)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      delivery_state: 'completed',
      provider_message_id: sent.id,
      rfc_message_id: `<${outbox[0]?.id}@ourco-${f.tag}.io>`,
    });

    await sync(w, f.ctx, mailbox.id);
    const rows = await copies(mailbox.id);
    expect(rows.map((r) => r.subject)).toEqual(['Pricing question', 'Re: Pricing question']);
    const { rows: threads } = await sql<{ n: string }>`
      SELECT count(DISTINCT m.thread_id)::text AS n FROM email_message_copies c JOIN email_messages m ON m.id = c.message_id
      WHERE c.mailbox_id = ${mailbox.id}`.execute(database.kysely);
    expect(threads[0]?.n).toBe('1');
  });

  it('is idempotent per outbox id, uploads large messages, maps failures', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email);
    const { mailbox } = await connect(w, f, f, email);
    const box = await connectorMailbox(mailbox.id);
    w.fake.files.set('https://files.example/a.pdf', Buffer.alloc(5 * 1024 * 1024, 7));
    const message: OutgoingMessage = {
      outboundId: newId(),
      from: { emailAddress: email, name: null },
      to: [{ emailAddress: 'kim@client.example', name: null }],
      cc: [],
      bcc: [],
      subject: 'Deck',
      bodyText: 'See attached',
      bodyHtml: '<p>See attached</p>',
      inReplyTo: null,
      references: [],
      providerThreadId: null,
      attachments: [
        {
          name: 'deck.pdf',
          contentType: 'application/pdf',
          size: 5 * 1024 * 1024,
          downloadUrl: 'https://files.example/a.pdf',
        },
      ],
    };
    const one = await w.connector.sendMessage(box, message);
    expect(w.fake.count('/upload/gmail/v1/users/me/messages/send', 'POST')).toBe(1);
    const two = await w.connector.sendMessage(box, message);
    expect(two).toEqual(one);
    expect(w.fake.sent).toHaveLength(1);

    // Gmail rewrote the Message-ID: the stored one is reported.
    w.fake.rewriteMessageIds = true;
    const rewritten = await w.connector.sendMessage(box, { ...message, outboundId: newId(), attachments: [] });
    expect(rewritten.rfcMessageId).toMatch(/@mail\.gmail\.com>$/);

    const fail = async (status: number, body?: unknown) => {
      w.fake.failNext(/\/messages\/send$/, status, body ? { body } : {});
      return (await w.connector
        .sendMessage(box, { ...message, outboundId: newId(), attachments: [] })
        .catch((e: unknown) => e)) as ConnectorError;
    };
    expect(await fail(429)).toMatchObject({ code: 'provider_rate_limited', retryable: true });
    expect(await fail(500)).toMatchObject({ code: 'provider_unreachable', retryable: true });
    expect(
      await fail(400, { error: { code: 400, message: 'Invalid To header', errors: [{ reason: 'invalidArgument' }] } }),
    ).toMatchObject({ code: 'provider_rejected_request', retryable: false });
    const missing = await w.connector
      .sendMessage(box, {
        ...message,
        outboundId: newId(),
        attachments: [{ name: 'x', contentType: 'text/plain', size: 1, downloadUrl: null }],
      })
      .catch((e: unknown) => e);
    expect(missing).toMatchObject({ code: 'email_preparation_failed' });
    // A reply whose Gmail thread is gone is sent as a new conversation.
    const orphan = await w.connector.sendMessage(box, {
      ...message,
      outboundId: newId(),
      attachments: [],
      providerThreadId: 'gone-thread',
    });
    expect(orphan.providerThreadId).not.toBe('gone-thread');
  });

  it('outbox: a rate-limited send is retried later', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email);
    const { mailbox } = await connect(w, f, f, email);
    const draftId = newId();
    await w.domain.email.drafts.create(f.ctx, {
      id: draftId,
      senderMailboxId: mailbox.id,
      subject: { text: 'Hi', variables: [] },
      body: [{ type: 'unstyled', indent: 0, text: 'Hello', styles: [], mentions: [], variables: [] }] as never,
      to: [{ emailAddress: 'kim@client.example' }],
    });
    const { outbox } = await w.domain.email.drafts.send(f.ctx, { draftId });
    w.fake.failNext(/\/messages\/send$/, 429, { times: 1 });
    expect(await w.domain.email.outbox.deliverDue(f.workspaceId)).toMatchObject({ retried: 1 });
    const [item] = await w.domain.email.outbox.list(f.ctx);
    expect(item).toMatchObject({ id: outbox[0]?.id, deliveryState: 'error', lastErrorCode: 'provider_rate_limited' });
    const later = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(await w.domain.email.outbox.deliverDue(f.workspaceId, { now: later })).toMatchObject({ sent: 1 });
  });
});

describe('tokens', () => {
  it('refreshes expired access tokens (and on 401) and stores them sealed', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email);
    const { mailbox } = await connect(w, f, f, email);
    await sync(w, f.ctx, mailbox.id);
    const tokenCalls = () => w.fake.count('/token', 'POST');
    expect(tokenCalls()).toBe(1); // the code exchange only
    const before = JSON.stringify(
      (
        await database.kysely
          .selectFrom('connected_accounts')
          .select('credentials')
          .where('id', '=', mailbox.connectedAccountId)
          .executeTakeFirstOrThrow()
      ).credentials,
    );
    w.advance(2 * HOUR);
    await sync(w, f.ctx, mailbox.id);
    expect(tokenCalls()).toBe(2);
    const after = JSON.stringify(
      (
        await database.kysely
          .selectFrom('connected_accounts')
          .select('credentials')
          .where('id', '=', mailbox.connectedAccountId)
          .executeTakeFirstOrThrow()
      ).credentials,
    );
    expect(after).not.toBe(before);
    w.fake.expireAccessTokens(email);
    await sync(w, f.ctx, mailbox.id);
    expect(tokenCalls()).toBe(3);
    expect((await w.domain.mailboxes.get(f.ctx, mailbox.id)).status).toBe('in-sync');
  });

  it('a revoked grant marks the mailbox for reconnection, stops sync and delivery; reconnect resumes', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email);
    const { mailbox } = await connect(w, f, f, email);
    await sync(w, f.ctx, mailbox.id);
    // An email queued before the grant is revoked.
    const draftId = newId();
    await w.domain.email.drafts.create(f.ctx, {
      id: draftId,
      senderMailboxId: mailbox.id,
      subject: { text: 'Hi', variables: [] },
      body: [{ type: 'unstyled', indent: 0, text: 'Hello', styles: [], mentions: [], variables: [] }] as never,
      to: [{ emailAddress: 'kim@client.example' }],
    });
    const { outbox } = await w.domain.email.drafts.send(f.ctx, { draftId });

    w.fake.revoke(email);
    w.advance(2 * HOUR);
    await expectCode(sync(w, f.ctx, mailbox.id), 'mailbox_disconnected');
    const broken = await w.domain.mailboxes.get(f.ctx, mailbox.id);
    expect(broken).toMatchObject({ credentialState: 'error-detected', status: 'sync-error' });
    expect(broken.syncError).toMatch(/reconnect/i);
    const calls = w.fake.requests.length;
    expect(await sync(w, f.ctx, mailbox.id)).toMatchObject({ messages: 0, events: 0 });
    expect(w.fake.requests.length).toBe(calls); // no Google call while it needs reconnection
    expect((await w.domain.email.queuePolledSyncs()).queued).toBe(0);

    // Delivery stops too: the queued email fails with the account-access reason, nothing reaches Google.
    expect(await w.domain.email.outbox.deliverDue(f.workspaceId)).toMatchObject({ failed: 1 });
    const [failed] = await w.domain.email.outbox.list(f.ctx);
    expect(failed).toMatchObject({ id: outbox[0]?.id, deliveryState: 'failed', lastErrorCode: 'account_access_error' });
    expect(w.fake.sent).toHaveLength(0);
    // New drafts from it are refused at review.
    const next = newId();
    await w.domain.email.drafts.create(f.ctx, {
      id: next,
      senderMailboxId: mailbox.id,
      subject: { text: 'Hi', variables: [] },
      body: [{ type: 'unstyled', indent: 0, text: 'Hello', styles: [], mentions: [], variables: [] }] as never,
      to: [{ emailAddress: 'kim@client.example' }],
    });
    expect((await w.domain.email.drafts.review(f.ctx, next)).issues).toContain('sender-disconnected');

    const { mailbox: back } = await connect(w, f, f, email, { mailboxId: mailbox.id });
    expect(back).toMatchObject({ id: mailbox.id, credentialState: 'active', syncError: null });
    w.fake.addMessage(email, { from: `kim@client-${f.tag}.example`, to: email, subject: 'After reconnect', text: 'x' });
    expect(await sync(w, f.ctx, mailbox.id)).toMatchObject({ messages: 1 });
  });

  it('missing scopes on an API call mark the mailbox for reconnection', async () => {
    const w = googleWorld();
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email);
    const { mailbox } = await connect(w, f, f, email);
    w.fake.dropScopes(email, ['https://www.googleapis.com/auth/calendar.readonly']);
    await expectCode(sync(w, f.ctx, mailbox.id), 'mailbox_disconnected');
    expect((await w.domain.mailboxes.get(f.ctx, mailbox.id)).syncError).toMatch(/permission/i);
  });
});

describe('polling', () => {
  it('queues a sync for active Gmail mailboxes only', async () => {
    const jobs = new RecordingJobQueue();
    const w = googleWorld({ jobs });
    const f = await emailFixture();
    const email = `ada.lovelace@ourco-${f.tag}.io`;
    w.fake.addAccount(email);
    const { mailbox } = await connect(w, f, f, email);
    jobs.take();
    await w.domain.email.queuePolledSyncs();
    const queued = jobs.take('email.sync').map((j) => j.data.mailboxId);
    expect(queued).toContain(mailbox.id);
    expect(queued).not.toContain(f.ada.mailboxId); // test mailboxes sync on inject, not by polling
  });
});
