// Collab test stack: the suite database (`<prefix>collab`), the real API (Better Auth issues the session cookies the
// collab server must accept), the collab server on an ephemeral port (COLLAB_TEST_PORT pins one), and Node Hocuspocus providers that
// connect with a user's cookie.
import { randomUUID } from 'node:crypto';
import { buildApp } from '@agentic-crm/api';
import { databaseUrlFor, testDatabaseName } from '@agentic-crm/config';
import { createDb, type Database, migrateUp } from '@agentic-crm/db';
import { createDomain, type Domain, memberContext, type PolicyResolver } from '@agentic-crm/domain';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import pg from 'pg';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { type CollabServer, createCollabServer } from '../../src/server.ts';

export const TEST_DATABASE = testDatabaseName('collab');
/** 0 = an ephemeral port, so checkouts running the suite at the same time never collide (COLLAB_TEST_PORT pins one). */
export const COLLAB_TEST_PORT = Number(process.env.COLLAB_TEST_PORT ?? 0);
export const WEB_ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-battery';

export function databaseUrl(name = TEST_DATABASE): string {
  return databaseUrlFor(name);
}

export async function recreateTestDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
  await migrateUp(databaseUrl());
}

export interface Stack {
  apiUrl: string;
  collabUrl: string;
  collab: CollabServer;
  database: Database;
  domain: Domain;
  close(): Promise<void>;
}

export async function startStack(
  collabOverrides: Parameters<typeof createCollabServer>[0]['config'] = {},
  options: { policyResolver?: PolicyResolver } = {},
): Promise<Stack> {
  const api = await buildApp({
    config: {
      databaseUrl: databaseUrl(),
      host: '127.0.0.1',
      port: 0,
      webOrigin: WEB_ORIGIN,
      publicUrl: WEB_ORIGIN,
      logLevel: 'silent',
    },
  });
  await api.app.listen({ host: '127.0.0.1', port: 0 });
  const address = api.app.server.address();
  if (!address || typeof address === 'string') throw new Error('no api address');
  const database = createDb({ connectionString: databaseUrl(), max: 6, applicationName: 'collab-tests' });
  const domain = createDomain({
    database,
    ...(options.policyResolver ? { policyResolver: options.policyResolver } : {}),
  });
  const collab = createCollabServer({
    database,
    domain,
    config: {
      host: '127.0.0.1',
      port: COLLAB_TEST_PORT,
      databaseUrl: databaseUrl(),
      authSecret: api.config.authSecret,
      allowedOrigins: [WEB_ORIGIN],
      debounceMs: 50,
      maxDebounceMs: 300,
      sessionCacheMs: 0,
      logLevel: (process.env.TEST_LOG_LEVEL as 'silent' | undefined) ?? 'silent',
      ...collabOverrides,
    },
  });
  await collab.start();
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    collabUrl: `ws://127.0.0.1:${collab.port}`,
    collab,
    database,
    domain,
    async close() {
      await collab.stop();
      await api.app.close();
      await database.destroy();
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

export async function signUp(stack: Stack, name: string): Promise<TestUser> {
  const email = `${name.split(' ')[0]?.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`;
  const response = await fetch(`${stack.apiUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  if (response.status !== 200) throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { id: body.user.id, email, name, cookie };
}

export async function signOut(stack: Stack, user: TestUser): Promise<void> {
  const response = await fetch(`${stack.apiUrl}/api/auth/sign-out`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, cookie: user.cookie },
    body: '{}',
  });
  if (!response.ok) throw new Error(`sign-out failed: ${response.status}`);
}

function identity(user: TestUser) {
  const [firstName = '', ...rest] = user.name.split(' ');
  return { userId: user.id, emailAddress: user.email, firstName, lastName: rest.join(' ') };
}

/** A workspace created by the first user; the others join through invites. Returns member ids by user id. */
export async function createWorkspace(stack: Stack, users: TestUser[]) {
  const [owner, ...others] = users;
  if (!owner) throw new Error('need a user');
  const slug = `ws-${randomUUID().slice(0, 8)}`;
  const ws = await stack.domain.workspaces.create(identity(owner), { name: `Workspace ${slug}`, slug });
  const members = new Map<string, string>([[owner.id, ws.membership.id]]);
  for (const user of others) {
    await stack.domain.invites.create(memberContext(ws.id, ws.membership.id), {
      invites: [{ emailAddress: user.email, accessLevel: 'member' }],
    });
    const joined = await stack.domain.invites.accept(identity(user), { workspaceId: ws.id });
    members.set(user.id, joined.membership.id);
  }
  const ownerCtx = memberContext(ws.id, ws.membership.id);
  return { workspaceId: ws.id, members, ownerCtx };
}

export interface TestClient {
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  doc: Y.Doc;
  /** Resolves on the first `synced`. */
  synced: Promise<void>;
  /** Resolves with the scope on `authenticated`, or rejects with the reason on `authenticationFailed`. */
  authenticated: Promise<string>;
  close(): void;
}

/** A Node Hocuspocus provider authenticating with `cookie` (no cookie = anonymous). */
export function connect(
  stack: Stack,
  documentId: string,
  cookie: string | null,
  options: { origin?: string | null; doc?: Y.Doc; user?: Record<string, unknown> } = {},
): TestClient {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const origin = options.origin === undefined ? WEB_ORIGIN : options.origin;
  if (origin) headers.origin = origin;
  class CookieWebSocket extends WebSocket {
    constructor(url: string) {
      super(url, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({
    url: stack.collabUrl,
    WebSocketPolyfill: CookieWebSocket,
    delay: 50,
    minDelay: 50,
    maxAttempts: 3,
  });
  const doc = options.doc ?? new Y.Doc();
  let resolveSynced: () => void = () => {};
  const synced = new Promise<void>((resolve) => {
    resolveSynced = resolve;
  });
  let settleAuth: { resolve: (scope: string) => void; reject: (err: Error) => void } | null = null;
  const authenticated = new Promise<string>((resolve, reject) => {
    settleAuth = { resolve, reject };
  });
  authenticated.catch(() => {});
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: documentId,
    document: doc,
    onSynced: () => resolveSynced(),
    onAuthenticated: ({ scope }) => settleAuth?.resolve(scope),
    onAuthenticationFailed: ({ reason }) => settleAuth?.reject(new Error(reason)),
  });
  provider.attach();
  if (options.user) provider.setAwarenessField('user', options.user);
  return {
    provider,
    socket,
    doc,
    synced,
    authenticated,
    close() {
      provider.destroy();
      socket.destroy();
    },
  };
}

/** Polls `fn` until it returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  timeoutMs = 5_000,
  label = 'condition',
): Promise<NonNullable<T>> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value as NonNullable<T>;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ''}`);
}

/** Inserts a paragraph with `text` at the end of the document body (as an editor would). */
export function appendParagraph(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment('default');
  doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text)]);
    fragment.insert(fragment.length, [paragraph]);
  });
}
