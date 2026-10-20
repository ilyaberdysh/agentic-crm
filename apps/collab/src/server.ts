// Collab server (D-09, I4b): Hocuspocus over one WebSocket per tab; Yjs documents persisted in Postgres through the
// domain documents module (single write path, I1).
//   upgrade    : Origin allow-list + `agentic-crm-session` cookie (401 / 403 before the WebSocket exists)
//   per doc    : workspace membership + the document's parent permissions → read-write or read-only connection
//   load/store : Yjs state from/to documents.yjs_state (debounced); every store merges with the stored state,
//                rewrites blocks/markdown/search_text and appends a `document` change_log row when they changed
//   awareness  : carets + identity; the server rewrites `user` from the session (name, colour) so it cannot be spoofed
//   NOTIFY     : `document_state` from server-side writes (replace content, delete) → pull + fan out / disconnect
//   sessions   : open connections of signed-out sessions are closed by a periodic re-validation
//   health     : GET /health
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Database } from '@agentic-crm/db';
import {
  DOCUMENT_STATE_CHANNEL,
  type DocumentAccess,
  type Domain,
  DomainError,
  memberContext,
  newId,
  systemContext,
} from '@agentic-crm/domain';
import {
  type CollabAwarenessUser,
  CollabCloseCode,
  type CollabDenyReason,
  presenceColor,
} from '@agentic-crm/editor/model';
import { type Connection, type Document, type Extension, Server } from '@hocuspocus/server';
import pg from 'pg';
import * as Y from 'yjs';
import { type CollabSession, SessionStore } from './auth/session.ts';
import {
  type CollabConfig,
  type CollabConfigOverrides,
  createLogger,
  type Logger,
  loadCollabConfig,
} from './config.ts';

/** Per-document connection context (Hocuspocus `context`). */
export interface CollabContext {
  sessionId: string;
  sessionToken: string;
  userId: string;
  workspaceId: string;
  memberId: string;
  documentId: string;
  docType: string;
  access: Exclude<DocumentAccess, 'none'>;
  presence: CollabAwarenessUser;
}

export interface CollabServerOptions {
  database: Database;
  domain: Domain;
  config?: CollabConfigOverrides;
  log?: Logger;
}

export interface CollabServer {
  readonly config: CollabConfig;
  readonly server: Server<CollabContext>;
  /** Port actually bound (after start()). */
  readonly port: number;
  start(): Promise<void>;
  /** Persists pending changes, closes every connection and stops listening. */
  stop(): Promise<void>;
  stats(): { documents: number; connections: number };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hook rejection without `message` (Hocuspocus logs only errors that have one) carrying the deny reason. */
function deny(reason: CollabDenyReason): { reason: CollabDenyReason } {
  return { reason };
}

function rejectUpgrade(socket: Duplex, status: 401 | 403, text: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`,
  );
  socket.destroy();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(payload);
}

async function readJson(request: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : JSON.parse(text);
}

function displayName(member: { firstName: string; lastName: string }, session: CollabSession): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  return name || session.name || session.email;
}

export function createCollabServer(options: CollabServerOptions): CollabServer {
  const config = loadCollabConfig(options.config);
  const log = options.log ?? createLogger(config.logLevel);
  const { domain, database } = options;
  const sessions = new SessionStore(database.pool, config.authSecret, config.sessionCacheMs);
  /** Workspace of every loaded document (stores run without a connection context when the last client left). */
  const workspaceOf = new Map<string, string>();
  let listener: pg.Client | null = null;
  let listenerRetry: NodeJS.Timeout | null = null;
  let revalidateTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let boundPort = config.port;

  const isAllowedOrigin = (origin: string) => config.allowedOrigins.includes(origin);

  async function authenticate(documentName: string, cookie: string | null, readOnlyRequested: boolean) {
    const session = await sessions.fromCookieHeader(cookie);
    if (!session) throw deny('unauthorized');
    if (!UUID.test(documentName)) throw deny('not-found');
    const located = await domain.documents.locate(documentName);
    if (!located || located.deleted) throw deny('not-found');
    const resolution = await domain.workspaces.resolveForUser(session.userId, { id: located.workspaceId });
    // Not telling non-members whether the document exists.
    if (resolution.status !== 'ok') throw deny('not-found');
    const member = resolution.membership;
    const access = await domain.documents.resolveAccess(memberContext(located.workspaceId, member.id), documentName);
    if (access === 'none') throw deny('forbidden');
    const context: CollabContext = {
      sessionId: session.sessionId,
      sessionToken: session.token,
      userId: session.userId,
      workspaceId: located.workspaceId,
      memberId: member.id,
      documentId: documentName,
      docType: located.docType,
      access: readOnlyRequested ? 'read' : access,
      presence: {
        id: session.userId,
        memberId: member.id,
        name: displayName(member, session),
        color: presenceColor(member.id),
      },
    };
    return context;
  }

  async function store(documentName: string, document: Document, lastContext: Partial<CollabContext> | undefined) {
    const workspaceId = lastContext?.workspaceId ?? workspaceOf.get(documentName);
    if (!workspaceId) {
      log.error('store without workspace', { documentId: documentName });
      return;
    }
    const ctx = lastContext?.memberId
      ? memberContext(workspaceId, lastContext.memberId)
      : systemContext(workspaceId, 'collab');
    try {
      const result = await domain.documents.storeState(ctx, {
        id: documentName,
        state: Y.encodeStateAsUpdate(document),
      });
      // The stored state may hold changes made elsewhere (server-side replace): bring them into the live document.
      if (result.written) Y.applyUpdate(document, result.state, { source: 'local', skipStoreHooks: true });
      log.debug('document stored', { documentId: documentName, version: result.version, written: result.written });
    } catch (err) {
      if (err instanceof DomainError && err.statusCode === 404) {
        // Deleted while open: nothing to persist; let the document unload.
        log.info('store skipped: document deleted', { documentId: documentName });
        return;
      }
      if (err instanceof DomainError && err.statusCode === 413) {
        log.warn('document over the size limit, not stored', { documentId: documentName });
        return;
      }
      throw err;
    }
  }

  /** Server-side write (replace content / delete) committed: pull the state or disconnect. */
  async function onDocumentState(payload: string): Promise<void> {
    let message: { id?: unknown; op?: unknown };
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    const id = typeof message.id === 'string' ? message.id : null;
    if (!id) return;
    const document = server.hocuspocus.documents.get(id);
    if (!document) return;
    if (message.op === 'delete') {
      log.info('document deleted while open: closing connections', { documentId: id });
      for (const connection of document.getConnections())
        connection.close({ code: CollabCloseCode.documentDeleted, reason: 'document-deleted' });
      return;
    }
    const workspaceId = workspaceOf.get(id);
    if (!workspaceId) return;
    const stored = await domain.documents.loadState(systemContext(workspaceId, 'collab'), id);
    if (stored?.state) Y.applyUpdate(document, stored.state, { source: 'local', skipStoreHooks: true });
  }

  async function startListener(): Promise<void> {
    if (stopping) return;
    const client = new pg.Client({
      connectionString: config.databaseUrl,
      application_name: 'agentic-crm-collab-listen',
    });
    client.on('notification', (n) => {
      if (n.channel === DOCUMENT_STATE_CHANNEL && n.payload)
        onDocumentState(n.payload).catch((err) => log.error('document_state handling failed', { err: String(err) }));
    });
    client.on('error', (err) => {
      log.warn('listener connection lost', { err: String(err) });
      scheduleListener();
    });
    client.on('end', () => {
      if (listener === client) scheduleListener();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${DOCUMENT_STATE_CHANNEL}`);
      listener = client;
    } catch (err) {
      log.warn('listener connect failed', { err: String(err) });
      client.end().catch(() => {});
      scheduleListener();
    }
  }

  function scheduleListener(): void {
    if (stopping || listenerRetry) return;
    const old = listener;
    listener = null;
    old?.end().catch(() => {});
    listenerRetry = setTimeout(() => {
      listenerRetry = null;
      void startListener();
    }, 2_000);
    listenerRetry.unref();
  }

  /** Closes connections whose session no longer exists (sign-out, revocation, expiry). */
  async function revalidateSessions(): Promise<void> {
    const byToken = new Map<string, Connection[]>();
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        const token = (connection.context as CollabContext | undefined)?.sessionToken;
        if (!token) continue;
        const list = byToken.get(token) ?? [];
        list.push(connection);
        byToken.set(token, list);
      }
    }
    if (byToken.size === 0) return;
    const valid = await sessions.validTokens([...byToken.keys()]);
    const remaining: Connection[] = [];
    for (const [token, connections] of byToken) {
      if (valid.has(token)) {
        remaining.push(...connections);
        continue;
      }
      for (const connection of connections)
        connection.close({ code: CollabCloseCode.unauthorized, reason: 'unauthorized' });
    }
    // Access may have changed since the connection opened (note deleted, parent record removed, permissions
    // lowered): re-resolve per (document, member) and close connections that lost it (clients reconnect and are
    // re-authorised, e.g. as read-only).
    const checked = new Map<string, Promise<DocumentAccess>>();
    for (const connection of remaining) {
      const context = connection.context as CollabContext;
      const key = `${context.documentId}:${context.memberId}`;
      let access = checked.get(key);
      if (!access) {
        access = domain.documents
          .resolveAccess(memberContext(context.workspaceId, context.memberId), context.documentId)
          .catch(() => 'none' as const);
        checked.set(key, access);
      }
      const now = await access;
      if (now === 'none' || (now === 'read' && context.access === 'edit'))
        connection.close({ code: CollabCloseCode.documentDeleted, reason: 'forbidden' });
    }
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://collab.local');
    if (url.pathname === '/health') {
      let db = true;
      try {
        await database.pool.query('SELECT 1');
      } catch {
        db = false;
      }
      sendJson(response, db ? 200 : 503, { status: db ? 'ok' : 'degraded', db, ...stats() });
      return;
    }
    if (config.devEndpoints && url.pathname.startsWith('/dev/')) {
      await handleDevRequest(url, request, response);
      return;
    }
    sendJson(response, 404, { status: 404, message: 'Not found' });
  }

  /** Helpers for the editor dev page (packages/editor/dev): who am I, create a document to edit. */
  async function handleDevRequest(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = await sessions.fromCookieHeader(request.headers.cookie);
    if (!session) return sendJson(response, 401, { status: 401, message: 'Sign in first' });
    const workspaces = await domain.workspaces.listForUser(session.userId);
    if (url.pathname === '/dev/session' && request.method === 'GET') {
      return sendJson(response, 200, {
        user: { id: session.userId, name: session.name, email: session.email },
        workspaces: workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          memberId: w.membership.id,
          memberName: `${w.membership.firstName} ${w.membership.lastName}`.trim() || session.name,
          color: presenceColor(w.membership.id),
        })),
      });
    }
    if (url.pathname === '/dev/documents' && request.method === 'POST') {
      const body = (await readJson(request)) as { workspaceId?: string; markdown?: string; id?: string };
      const workspace = workspaces.find((w) => w.id === body.workspaceId) ?? workspaces[0];
      if (!workspace) return sendJson(response, 400, { status: 400, message: 'No workspace' });
      const doc = await domain.documents.create(memberContext(workspace.id, workspace.membership.id), {
        id: body.id && UUID.test(body.id) ? body.id : newId(),
        docType: 'note-template',
        ...(body.markdown ? { content: { markdown: body.markdown } } : {}),
      });
      return sendJson(response, 200, { id: doc.id, workspaceId: doc.workspaceId });
    }
    if (url.pathname === '/dev/mentions' && request.method === 'GET') {
      // Mention typeahead data for the dev page: workspace members, then records (search B.8).
      const workspace = workspaces.find((w) => w.id === url.searchParams.get('workspaceId')) ?? workspaces[0];
      if (!workspace) return sendJson(response, 200, { items: [] });
      const ctx = memberContext(workspace.id, workspace.membership.id);
      const query = url.searchParams.get('q') ?? '';
      const [members, records, objects] = await Promise.all([
        domain.search.members(ctx, { query, limit: 10 }),
        domain.search.records(ctx, { query, limit: 10 }),
        domain.schema.listObjects(ctx),
      ]);
      const objectById = new Map(objects.map((o) => [o.id, o]));
      return sendJson(response, 200, {
        items: [
          ...members.hits.map((m) => ({
            kind: 'member',
            id: m.id,
            label: `${m.firstName} ${m.lastName}`.trim() || m.emailAddress,
            secondary: m.emailAddress.split('@')[1] ?? null,
          })),
          ...records.hits.map((r) => {
            const object = objectById.get(r.entityDefinitionId);
            return {
              kind: 'record',
              id: r.entityInstanceId,
              entityDefinitionId: r.entityDefinitionId,
              label: r.title ?? r.entityInstanceId,
              secondary: r.subtitle,
              objectName: object?.singularNoun ?? null,
              shape: object?.apiSlug === 'people' ? 'round' : 'box',
            };
          }),
        ],
      });
    }
    if (url.pathname.startsWith('/dev/documents/') && request.method === 'GET') {
      const id = url.pathname.slice('/dev/documents/'.length);
      const located = await domain.documents.locate(id);
      const workspace = located && workspaces.find((w) => w.id === located.workspaceId);
      if (!located || !workspace) return sendJson(response, 404, { status: 404, message: 'Not found' });
      const doc = await domain.documents.get(memberContext(workspace.id, workspace.membership.id), id);
      return sendJson(response, 200, doc);
    }
    sendJson(response, 404, { status: 404, message: 'Not found' });
  }

  const extension: Extension<CollabContext> = {
    extensionName: 'agentic-crm-collab',

    async onUpgrade({ request, socket }) {
      const origin = request.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        rejectUpgrade(socket, 403, 'Forbidden');
        throw null;
      }
      const session = await sessions.fromCookieHeader(request.headers.cookie);
      if (!session) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        throw null;
      }
    },

    async onRequest({ request, response }) {
      try {
        await handleRequest(request, response);
      } catch (err) {
        log.error('request failed', { err: String(err), url: request.url });
        if (!response.headersSent) sendJson(response, 500, { status: 500, message: 'Internal error' });
      }
      throw null; // handled: skip Hocuspocus' default response
    },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig, requestParameters }) {
      try {
        const context = await authenticate(
          documentName,
          requestHeaders.get('cookie'),
          requestParameters.get('readonly') === 'true',
        );
        connectionConfig.readOnly = context.access === 'read';
        log.debug('connection authorised', {
          documentId: documentName,
          memberId: context.memberId,
          access: context.access,
        });
        return context;
      } catch (err) {
        if (err && typeof err === 'object' && 'reason' in err) throw err;
        log.error('authentication failed', { documentId: documentName, err: String(err) });
        throw deny('forbidden');
      }
    },

    async onLoadDocument({ documentName, context }) {
      workspaceOf.set(documentName, context.workspaceId);
      const stored = await domain.documents.loadState(
        memberContext(context.workspaceId, context.memberId),
        documentName,
      );
      if (!stored) throw deny('not-found');
      return stored.state ?? undefined;
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      await store(documentName, document, lastContext as Partial<CollabContext> | undefined);
    },

    async beforeHandleAwareness({ states, context }) {
      if (!context?.presence) return;
      for (const state of states.values()) {
        if (!state || typeof state !== 'object') continue;
        const previous = typeof state.user === 'object' && state.user ? state.user : {};
        state.user = { ...previous, ...context.presence };
      }
    },

    async afterUnloadDocument({ documentName }) {
      workspaceOf.delete(documentName);
    },
  };

  const server = new Server<CollabContext>({
    name: 'agentic-crm-collab',
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: false,
    debounce: config.debounceMs,
    maxDebounce: config.maxDebounceMs,
    timeout: config.timeoutMs,
    unloadImmediately: true,
    websocketOptions: { maxPayload: config.maxMessageBytes },
    extensions: [extension],
  });

  function stats() {
    return { documents: server.hocuspocus.getDocumentsCount(), connections: server.hocuspocus.getConnectionsCount() };
  }

  return {
    config,
    server,
    get port() {
      return boundPort;
    },
    async start() {
      await server.listen();
      boundPort = server.address.port;
      await startListener();
      revalidateTimer = setInterval(() => {
        revalidateSessions().catch((err) => log.warn('session revalidation failed', { err: String(err) }));
      }, config.sessionRevalidateMs);
      revalidateTimer.unref();
      log.info('collab listening', { host: config.host, port: boundPort });
    },
    async stop() {
      stopping = true;
      if (revalidateTimer) clearInterval(revalidateTimer);
      if (listenerRetry) clearTimeout(listenerRetry);
      revalidateTimer = null;
      listenerRetry = null;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), config.shutdownTimeoutMs);
      });
      // destroy(): close connections, flush pending stores, wait until every document unloaded.
      const outcome = await Promise.race([server.destroy().then(() => 'done' as const), timeout]);
      clearTimeout(timer);
      if (outcome === 'timeout') log.warn('shutdown timed out; some documents may not have been stored');
      const client = listener;
      listener = null;
      await client?.end().catch(() => {});
      log.info('collab stopped');
    },
    stats,
  };
}

export type { CollabConfig } from './config.ts';
export { loadCollabConfig } from './config.ts';
