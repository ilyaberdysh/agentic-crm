// Starts the real app on an ephemeral port against agentic_crm_test_api, plus helpers for users, workspaces (created
// through the domain), tRPC calls, change_log writes and WebSocket clients.
import { randomUUID } from 'node:crypto';
import { memberContext } from '@agentic-crm/domain';
import type { ClientToServer, InvalidationResource, ServerToClient } from '@agentic-crm/realtime';
import pg from 'pg';
import WebSocket from 'ws';
import { type ApiApp, type BuildAppOptions, buildApp } from '../../src/app';
import type { ApiConfigOverrides } from '../../src/config';
import { databaseUrl } from './database';

export const WEB_ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-battery';

export interface Harness extends ApiApp {
  baseUrl: string;
  wsUrl: string;
  db: pg.Pool;
  close(): Promise<void>;
}

export async function startHarness(
  overrides: ApiConfigOverrides = {},
  options: Omit<BuildAppOptions, 'config'> = {},
): Promise<Harness> {
  const api = await buildApp({
    ...options,
    config: {
      databaseUrl: databaseUrl(),
      host: '127.0.0.1',
      port: 0,
      webOrigin: WEB_ORIGIN,
      publicUrl: WEB_ORIGIN,
      logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
      ...overrides,
      realtime: { pollIntervalMs: 250, gapGraceMs: 50, heartbeatIntervalMs: 60_000, ...overrides.realtime },
    },
  });
  await api.app.listen({ host: '127.0.0.1', port: 0 });
  const address = api.app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const db = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  return {
    ...api,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/realtime`,
    db,
    async close() {
      await api.app.close();
      await db.end();
    },
  };
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

/** `name=value` pairs from Set-Cookie headers, joined for a Cookie header. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

export async function authPost(h: Harness, path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${h.baseUrl}/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: WEB_ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}

export async function signUp(h: Harness, name = 'Test User', email = uniqueEmail()): Promise<TestUser> {
  const response = await authPost(h, '/sign-up/email', { email, password: PASSWORD, name });
  if (response.status !== 200) throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, email, name, cookie: cookieHeader(response) };
}

/** The domain identity of a test user (what apps/api derives from the session). */
export function identity(user: TestUser) {
  const [firstName = '', ...rest] = user.name.split(' ');
  return { userId: user.id, emailAddress: user.email, firstName, lastName: rest.join(' ') };
}

/** Marks the user's email as verified (team accounts created by the CLI are; self sign-ups are not). */
export async function verifyEmail(h: Harness, user: TestUser): Promise<void> {
  await h.db.query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
}

/** Adds `user` to the workspace through the domain (invite by `admin`, then accept). Returns the member id. */
export async function addMember(
  h: Harness,
  workspaceId: string,
  admin: { memberId: string },
  user: TestUser,
  accessLevel: 'admin' | 'member' = 'member',
): Promise<string> {
  await h.domain.invites.create(memberContext(workspaceId, admin.memberId), {
    invites: [{ emailAddress: user.email, accessLevel }],
  });
  const joined = await h.domain.invites.accept(identity(user), { workspaceId });
  return joined.membership.id;
}

/**
 * Creates a workspace through the domain: the first admin listed (or the first user) creates it, the others join
 * through invites. Returns the workspace id.
 */
export async function createWorkspace(h: Harness, slug: string, members: { user: TestUser; admin?: boolean }[]) {
  return (await createWorkspaceWithMembers(h, slug, members)).workspaceId;
}

export async function createWorkspaceWithMembers(
  h: Harness,
  slug: string,
  members: { user: TestUser; admin?: boolean }[],
): Promise<{ workspaceId: string; memberIds: Map<string, string> }> {
  const creator = members.find((m) => m.admin) ?? members[0];
  if (!creator) throw new Error('a workspace needs a member');
  const ws = await h.domain.workspaces.create(identity(creator.user), { name: `Workspace ${slug}`, slug });
  const memberIds = new Map([[creator.user.id, ws.membership.id]]);
  for (const { user, admin } of members) {
    if (user === creator.user) continue;
    const id = await addMember(h, ws.id, { memberId: ws.membership.id }, user, admin ? 'admin' : 'member');
    memberIds.set(user.id, id);
  }
  return { workspaceId: ws.id, memberIds };
}

export interface TrpcOptions {
  user?: TestUser;
  slug?: string;
  acceptAfter?: string;
}

export interface TrpcErrorShape {
  message: string;
  statusCode: number;
  error: string;
  status_code: number;
  additional_information?: Record<string, unknown>;
  data: { code: string; httpStatus: number; path: string };
}

/** Error thrown by trpcCall for non-2xx answers, carrying the Attio envelope fields. */
export class TrpcCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: TrpcErrorShape,
  ) {
    super(`${status} ${body.message}`);
  }
}

/** POSTs one tRPC procedure (queries use the method override) and returns `result.data`. */
export async function trpcCall<T = unknown>(
  h: Harness,
  path: string,
  input?: unknown,
  opts: TrpcOptions = {},
): Promise<T> {
  const response = await fetch(`${h.baseUrl}/trpc/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: WEB_ORIGIN,
      ...(opts.user ? { cookie: opts.user.cookie } : {}),
      ...(opts.slug ? { 'x-workspace-slug': opts.slug } : {}),
      ...(opts.acceptAfter ? { 'x-accept-after': opts.acceptAfter } : {}),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const body = (await response.json()) as { result?: { data: T }; error?: TrpcErrorShape };
  if (!response.ok || body.error) throw new TrpcCallError(response.status, body.error as TrpcErrorShape);
  return body.result?.data as T;
}

/** Resolves with the error of a failing call. */
export async function trpcError(promise: Promise<unknown>): Promise<TrpcCallError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof TrpcCallError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

/** Acts as the domain writer: one change_log row, then NOTIFY after commit (packages/realtime contract). */
export async function writeChange(
  h: Harness,
  row: {
    workspaceId: string;
    resource?: InvalidationResource;
    resourceId?: string | null;
    scope?: Record<string, unknown>;
    audience?: { userIds: string[] } | null;
  },
): Promise<string> {
  const { rows } = await h.db.query<{ id: string }>(
    `INSERT INTO change_log (workspace_id, resource, resource_id, scope, audience)
     VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
    [
      row.workspaceId,
      row.resource ?? 'entity-instance',
      row.resourceId === undefined ? randomUUID() : row.resourceId,
      JSON.stringify(row.scope ?? {}),
      row.audience === undefined || row.audience === null ? null : JSON.stringify(row.audience),
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('change_log insert failed');
  await h.db.query(`SELECT pg_notify('change_log', $1)`, [id]);
  return id;
}

/** A WebSocket test client that records every server message and can wait for one. */
export class WsClient {
  readonly messages: ServerToClient[] = [];
  private waiters: { predicate: (m: ServerToClient) => boolean; resolve: (m: ServerToClient) => void }[] = [];
  closeCode: number | null = null;
  private readonly closed: Promise<number>;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerToClient;
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.predicate(message)) return true;
        w.resolve(message);
        return false;
      });
    });
    this.closed = new Promise((resolve) => {
      socket.on('close', (code) => {
        this.closeCode = code;
        resolve(code);
      });
    });
  }

  static async connect(h: Harness, cookie: string, origin: string | null = WEB_ORIGIN): Promise<WsClient> {
    const socket = new WebSocket(h.wsUrl, { headers: { cookie, ...(origin ? { origin } : {}) } });
    const client = new WsClient(socket);
    await client.next((m) => m.type === 'ready');
    return client;
  }

  send(message: ClientToServer | Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves with the first already-received or future message matching the predicate. */
  next<T extends ServerToClient = ServerToClient>(
    predicate: (m: ServerToClient) => boolean,
    timeoutMs = 3_000,
    since = 0,
  ): Promise<T> {
    const existing = this.messages.slice(since).find(predicate);
    if (existing) return Promise.resolve(existing as T);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for message (${timeoutMs} ms)`)), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      });
    });
  }

  /** Waits for the next matching message received after now. */
  nextNew<T extends ServerToClient = ServerToClient>(predicate: (m: ServerToClient) => boolean, timeoutMs = 3_000) {
    return this.next<T>(predicate, timeoutMs, this.messages.length);
  }

  async subscribe(workspaceId: string, after?: string) {
    const since = this.messages.length;
    this.send(
      after === undefined
        ? { type: 'subscribe-workspace', workspaceId }
        : { type: 'subscribe-workspace', workspaceId, after },
    );
    return this.next<Extract<ServerToClient, { type: 'subscribed' }>>(
      (m) => (m.type === 'subscribed' && m.workspaceId === workspaceId) || m.type === 'error',
      3_000,
      since,
    );
  }

  invalidations(): Extract<ServerToClient, { type: 'invalidate' }>[] {
    return this.messages.filter((m): m is Extract<ServerToClient, { type: 'invalidate' }> => m.type === 'invalidate');
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close();
    await this.closed;
  }

  waitClosed(): Promise<number> {
    return this.closed;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
