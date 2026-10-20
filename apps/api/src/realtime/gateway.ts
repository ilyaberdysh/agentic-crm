// Realtime gateway at /realtime (D-08, I4). One WebSocket per tab, authenticated by the session cookie.
//  - Data channel: the connection subscribes to workspaces it is a member of and receives InvalidationMessages
//    built from change_log rows (what is stale + seq), filtered by audience. Never business data (I4a).
//  - Resume: `subscribe-workspace {after: cursor}` replays newer rows from change_log, or answers
//    `continuity-lost` when the cursor is older than retention; the client must refetch before resuming.
//  - Rooms: presence (join/leave/state) and ephemeral fan-out, in memory (I4b).
import { randomUUID } from 'node:crypto';
import {
  type ChangeLogRow,
  type ClientToServer,
  type InvalidationMessage,
  RealtimeCloseCode,
  type RealtimeErrorCode,
  type ServerToClient,
} from '@agentic-crm/realtime';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { RawData, WebSocket } from 'ws';
import type { Auth, AuthSession } from '../auth/auth';
import { getRequestSession } from '../auth/session';
import type { RealtimeConfig } from '../config';
import { envelope, toApiError, UNAUTHENTICATED_MESSAGE } from '../errors';
import type { WorkspaceResolver } from '../workspaces/resolver';
import { CHANGE_LOG_COLUMNS, ChangeFeed, type ChangeLogDbRow, toChangeLogRow } from './change-feed';
import { clientMessageSchema, parseRoom } from './protocol';
import { type RoomPeer, RoomRegistry } from './rooms';

const OPEN = 1;
const MEMBERSHIP_TTL_MS = 60_000;

export interface RealtimeGatewayOptions {
  auth: Auth;
  workspaces: WorkspaceResolver;
  pool: pg.Pool;
  databaseUrl: string;
  config: RealtimeConfig;
  /** Origins allowed to open the socket from a browser (requests without Origin are non-browser clients). */
  allowedOrigins: string[];
  log: FastifyBaseLogger;
  /** Permission hook (D-16): may this user receive this invalidation? Allow-all until permissions land. */
  canReceive?: (userId: string, row: ChangeLogRow) => boolean;
  /**
   * Room access beyond workspace membership (e.g. `view:<workspaceId>:<viewId>` needs read access to the view's
   * object). Absent = members may join every room of their workspace.
   */
  authorizeRoom?: RoomAuthorizer;
}

export interface RoomAccessRequest {
  userId: string;
  workspaceId: string;
  memberId: string;
  namespace: string;
  /** Room name segments after the workspace id. */
  params: string[];
}

export type RoomAuthorizer = (request: RoomAccessRequest) => Promise<boolean>;

interface Subscription {
  workspaceId: string;
  /** false while the resume replay runs; live rows are buffered meanwhile. */
  live: boolean;
  buffer: ChangeLogRow[];
}

class Connection implements RoomPeer {
  readonly id = randomUUID();
  readonly userId: string;
  readonly sessionId: string;
  readonly clientId: string;
  readonly subs = new Map<string, Subscription>();
  readonly rooms = new Set<string>();
  /** workspaceId → membership verified until (ms). */
  readonly memberOf = new Map<string, number>();
  /** workspaceId → the user's member id there (rooms authorise as that member). */
  readonly memberIds = new Map<string, string>();
  alive = true;
  closed = false;
  queue: Promise<void> = Promise.resolve();
  private tokens: number;
  private refilledAt = Date.now();

  constructor(
    readonly socket: WebSocket,
    session: AuthSession,
    private readonly config: RealtimeConfig,
  ) {
    this.userId = session.user.id;
    this.sessionId = session.session.id;
    this.clientId = `${this.userId}.${this.id}`;
    this.tokens = config.messageBurst;
  }

  send(message: ServerToClient): void {
    if (this.closed || this.socket.readyState !== OPEN) return;
    if (this.socket.bufferedAmount > this.config.maxBufferedBytes) {
      this.close(RealtimeCloseCode.slowConsumer, 'slow consumer');
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  error(code: RealtimeErrorCode, message: string): void {
    this.send({ type: 'error', code, message });
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch {
      this.socket.terminate();
    }
  }

  /** Token bucket; false = rate limited. */
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.config.messageBurst,
      this.tokens + ((now - this.refilledAt) / 1000) * this.config.messagesPerSecond,
    );
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  get hasPendingSubscription(): boolean {
    for (const sub of this.subs.values()) if (!sub.live) return true;
    return false;
  }
}

function toInvalidation(row: ChangeLogRow): InvalidationMessage {
  return {
    type: 'invalidate',
    seq: row.id,
    workspaceId: row.workspaceId,
    resource: row.resource,
    resourceId: row.resourceId,
    scope: row.scope,
  };
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export class RealtimeGateway {
  readonly feed: ChangeFeed;
  readonly rooms = new RoomRegistry();
  private readonly connections = new Map<string, Connection>();
  private readonly byWorkspace = new Map<string, Set<Connection>>();
  private readonly membershipChecks = new Set<string>();
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly canReceive: (userId: string, row: ChangeLogRow) => boolean;

  constructor(private readonly options: RealtimeGatewayOptions) {
    this.canReceive = options.canReceive ?? (() => true);
    this.feed = new ChangeFeed({
      pool: options.pool,
      connectionString: options.databaseUrl,
      log: options.log,
      pollIntervalMs: options.config.pollIntervalMs,
      bootLookback: options.config.bootLookback,
      gapGraceMs: options.config.gapGraceMs,
      onRows: (rows) => this.dispatch(rows),
    });
  }

  async start(): Promise<void> {
    await this.feed.start();
    this.heartbeat = setInterval(() => void this.tick(), this.options.config.heartbeatIntervalMs);
    this.heartbeat.unref();
  }

  /** Closes every connection with "service restart" so clients reconnect with backoff, then stops the feed. */
  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.closeAll(RealtimeCloseCode.serviceRestart, 'server restarting');
    await this.feed.stop();
  }

  closeAll(code: number, reason: string): void {
    for (const conn of [...this.connections.values()]) {
      conn.close(code, reason);
      this.drop(conn);
    }
  }

  /** Ends the connections of a signed-out / revoked session. */
  closeSession(sessionId: string): void {
    for (const conn of [...this.connections.values()]) {
      if (conn.sessionId !== sessionId) continue;
      conn.close(RealtimeCloseCode.unauthorized, 'signed out');
      this.drop(conn);
    }
  }

  stats() {
    return {
      connections: this.connections.size,
      rooms: this.rooms.size,
      feed: { ready: this.feed.isReady, listening: this.feed.isListening, cursor: this.feed.cursor },
    };
  }

  register(app: FastifyInstance): void {
    const sessions = new WeakMap<FastifyRequest, AuthSession>();
    app.get(
      '/realtime',
      {
        websocket: true,
        preValidation: async (request, reply) => {
          const origin = request.headers.origin;
          if (origin && !this.isAllowedOrigin(origin, request)) {
            return reply.status(403).send(envelope(403, 'Origin not allowed'));
          }
          const session = await getRequestSession(this.options.auth, request.headers);
          if (!session) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
          sessions.set(request, session);
        },
      },
      (socket, request) => {
        const session = sessions.get(request);
        if (!session) {
          socket.close(RealtimeCloseCode.unauthorized, 'unauthorized');
          return;
        }
        this.accept(socket, session);
      },
    );
  }

  private isAllowedOrigin(origin: string, request: FastifyRequest): boolean {
    return this.options.allowedOrigins.includes(origin) || origin === `${request.protocol}://${request.host}`;
  }

  private accept(socket: WebSocket, session: AuthSession): void {
    const conn = new Connection(socket, session, this.options.config);
    this.connections.set(conn.id, conn);
    socket.on('message', (data, isBinary) => {
      if (conn.closed) return;
      if (!conn.take()) {
        conn.error('rate-limited', 'Too many messages');
        return;
      }
      // Messages of one connection are handled strictly in order (subscribe → unsubscribe must not race).
      conn.queue = conn.queue.then(() => this.onMessage(conn, data, isBinary)).catch(() => {});
    });
    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('close', () => this.drop(conn));
    socket.on('error', (err) => this.options.log.debug({ err, connectionId: conn.id }, 'realtime socket error'));
    conn.send({
      type: 'ready',
      connectionId: conn.id,
      userId: conn.userId,
      clientId: conn.clientId,
      cursor: this.feed.cursor,
    });
  }

  private drop(conn: Connection): void {
    conn.closed = true;
    if (!this.connections.delete(conn.id)) return;
    for (const workspaceId of conn.subs.keys()) this.unindex(workspaceId, conn);
    conn.subs.clear();
    for (const room of conn.rooms) this.rooms.leave(room, conn);
    conn.rooms.clear();
  }

  private async onMessage(conn: Connection, data: RawData, isBinary: boolean): Promise<void> {
    if (conn.closed) return;
    if (isBinary) {
      conn.error('bad-message', 'Binary messages are not supported');
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawToString(data));
    } catch {
      conn.error('bad-message', 'Messages must be JSON');
      return;
    }
    const parsed = clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      conn.error('bad-message', issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message');
      return;
    }
    try {
      await this.handle(conn, parsed.data);
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.statusCode >= 500) this.options.log.error({ err, connectionId: conn.id }, 'realtime message failed');
      conn.error(apiError.statusCode === 403 ? 'forbidden' : 'bad-message', apiError.message);
    }
  }

  private async handle(conn: Connection, message: ClientToServer): Promise<void> {
    switch (message.type) {
      case 'ping':
        // A cursor is only safe when no resume replay is in progress on this connection.
        conn.send(conn.hasPendingSubscription ? { type: 'pong' } : { type: 'pong', cursor: this.feed.cursor });
        return;
      case 'subscribe-workspace':
        return this.subscribe(conn, message.workspaceId, message.after);
      case 'unsubscribe-workspace':
        this.unsubscribe(conn, message.workspaceId, 'requested');
        return;
      case 'join-room':
        return this.joinRoom(conn, message.room, message.state ?? {});
      case 'leave-room':
        if (conn.rooms.delete(message.room)) this.rooms.leave(message.room, conn);
        return;
      case 'room-state':
        if (!this.rooms.setState(message.room, conn, message.state)) conn.error('not-found', 'Not in this room');
        return;
      case 'room-ephemeral':
        if (!this.rooms.publish(message.room, conn, message.payload)) conn.error('not-found', 'Not in this room');
        return;
    }
  }

  // ---- data channel ------------------------------------------------------------------------------------------

  private index(workspaceId: string, conn: Connection): void {
    let set = this.byWorkspace.get(workspaceId);
    if (!set) {
      set = new Set();
      this.byWorkspace.set(workspaceId, set);
    }
    set.add(conn);
  }

  private unindex(workspaceId: string, conn: Connection): void {
    const set = this.byWorkspace.get(workspaceId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.byWorkspace.delete(workspaceId);
  }

  private async subscribe(conn: Connection, workspaceId: string, after: string | undefined): Promise<void> {
    if (!conn.subs.has(workspaceId) && conn.subs.size >= this.options.config.maxSubscriptionsPerConnection) {
      conn.error('limit-exceeded', 'Too many workspace subscriptions');
      return;
    }
    const resolution = await this.options.workspaces.resolve(conn.userId, { id: workspaceId });
    if (conn.closed) return;
    if (resolution.status !== 'ok') {
      conn.error(
        resolution.status === 'not-found' ? 'not-found' : 'forbidden',
        resolution.status === 'not-found' ? 'Workspace not found' : 'You are not a member of this workspace',
      );
      return;
    }
    conn.memberOf.set(workspaceId, Date.now() + MEMBERSHIP_TTL_MS);
    conn.memberIds.set(workspaceId, resolution.membership.id);

    const sub: Subscription = { workspaceId, live: false, buffer: [] };
    conn.subs.set(workspaceId, sub);
    this.index(workspaceId, conn);

    let replayed = new Set<string>();
    if (after !== undefined) {
      const outcome = await this.replay(conn, workspaceId, BigInt(after));
      if (conn.closed || conn.subs.get(workspaceId) !== sub) return; // superseded meanwhile
      if (outcome === 'lost') conn.send({ type: 'continuity-lost', workspaceId });
      else replayed = outcome;
    }
    for (const row of sub.buffer) if (!replayed.has(row.id)) conn.send(toInvalidation(row));
    sub.buffer = [];
    sub.live = true;
    conn.send({ type: 'subscribed', workspaceId, cursor: this.feed.cursor });
  }

  private unsubscribe(conn: Connection, workspaceId: string, reason: 'requested' | 'not-a-member'): void {
    const had = conn.subs.delete(workspaceId);
    this.unindex(workspaceId, conn);
    if (had || reason === 'requested') conn.send({ type: 'unsubscribed', workspaceId, reason });
  }

  /**
   * Sends the workspace's invalidations with id > after, or returns 'lost' when that cannot be done faithfully:
   * the cursor is from the future (database reset), older than retention, points past pruned rows, or the
   * backlog exceeds maxReplayRows. Returns the replayed ids for de-duplication against buffered live rows.
   */
  private async replay(conn: Connection, workspaceId: string, after: bigint): Promise<Set<string> | 'lost'> {
    const { pool, config, log } = this.options;
    try {
      const probe = await pool.query<{ cursor_at: Date | null; min_id: string | null; last_id: string | null }>(
        `SELECT (SELECT created_at FROM change_log WHERE id <= $1::bigint ORDER BY id DESC LIMIT 1) AS cursor_at,
                (SELECT min(id) FROM change_log)::text AS min_id,
                pg_sequence_last_value(pg_get_serial_sequence('change_log', 'id')::regclass)::text AS last_id`,
        [after.toString()],
      );
      const { cursor_at: cursorAt, min_id: minId, last_id: lastId } = probe.rows[0] ?? {};
      const last = lastId ? BigInt(lastId) : 0n;
      if (after > last) return 'lost';
      if (!cursorAt) {
        const pruned = minId ? BigInt(minId) > after + 1n : after < last;
        if (pruned) return 'lost';
      } else if (cursorAt.getTime() < Date.now() - config.changeLogRetentionMs) {
        return 'lost';
      }
      const { rows } = await pool.query<ChangeLogDbRow>(
        `SELECT ${CHANGE_LOG_COLUMNS} FROM change_log c
          WHERE c.workspace_id = $1::uuid AND c.id > $2::bigint ORDER BY c.id LIMIT $3`,
        [workspaceId, after.toString(), config.maxReplayRows + 1],
      );
      if (rows.length > config.maxReplayRows) return 'lost';
      const ids = new Set<string>();
      for (const dbRow of rows) {
        const row = toChangeLogRow(dbRow);
        ids.add(row.id);
        if (this.audienceAllows(conn.userId, row)) conn.send(toInvalidation(row));
      }
      return ids;
    } catch (err) {
      log.warn({ err, workspaceId }, 'realtime replay failed; reporting continuity loss');
      return 'lost';
    }
  }

  private audienceAllows(userId: string, row: ChangeLogRow): boolean {
    if (row.audience !== null && !row.audience.userIds.includes(userId)) return false;
    return this.canReceive(userId, row);
  }

  /** Called by the change feed with newly committed rows, in id order. */
  private dispatch(rows: ChangeLogRow[]): void {
    for (const row of rows) {
      const subscribers = this.byWorkspace.get(row.workspaceId);
      if (subscribers) {
        let message: InvalidationMessage | null = null;
        for (const conn of subscribers) {
          const sub = conn.subs.get(row.workspaceId);
          if (!sub || !this.audienceAllows(conn.userId, row)) continue;
          if (!sub.live) {
            sub.buffer.push(row);
            continue;
          }
          message ??= toInvalidation(row);
          conn.send(message);
        }
      }
      if (row.resource === 'workspace-member' || row.resource === 'workspace') {
        this.scheduleMembershipCheck(row.workspaceId);
      }
    }
  }

  /** After a membership change, drop subscriptions and rooms of users who are no longer members. */
  private scheduleMembershipCheck(workspaceId: string): void {
    if (this.membershipChecks.has(workspaceId)) return;
    this.membershipChecks.add(workspaceId);
    setImmediate(() => {
      this.membershipChecks.delete(workspaceId);
      void this.recheckMembership(workspaceId);
    });
  }

  private async recheckMembership(workspaceId: string): Promise<void> {
    const affected = [...this.connections.values()].filter(
      (conn) => conn.subs.has(workspaceId) || conn.memberOf.has(workspaceId),
    );
    const byUser = new Map<string, Connection[]>();
    for (const conn of affected) byUser.set(conn.userId, [...(byUser.get(conn.userId) ?? []), conn]);
    for (const [userId, conns] of byUser) {
      let member: boolean;
      try {
        member = (await this.options.workspaces.resolve(userId, { id: workspaceId })).status === 'ok';
      } catch (err) {
        this.options.log.warn({ err, workspaceId }, 'realtime membership re-check failed');
        continue;
      }
      for (const conn of conns) {
        if (member) {
          conn.memberOf.set(workspaceId, Date.now() + MEMBERSHIP_TTL_MS);
          continue;
        }
        conn.memberOf.delete(workspaceId);
        conn.memberIds.delete(workspaceId);
        if (conn.subs.has(workspaceId)) this.unsubscribe(conn, workspaceId, 'not-a-member');
        for (const room of [...conn.rooms]) {
          if (parseRoom(room)?.workspaceId !== workspaceId) continue;
          conn.rooms.delete(room);
          this.rooms.leave(room, conn);
        }
      }
    }
  }

  // ---- rooms -------------------------------------------------------------------------------------------------

  /** The user's member id in the workspace (verified at most MEMBERSHIP_TTL_MS ago), or null. */
  private async memberIdIn(conn: Connection, workspaceId: string): Promise<string | null> {
    const known = conn.memberIds.get(workspaceId);
    const until = conn.memberOf.get(workspaceId);
    if (known && (conn.subs.get(workspaceId)?.live || (until !== undefined && until > Date.now()))) return known;
    const resolution = await this.options.workspaces.resolve(conn.userId, { id: workspaceId });
    if (resolution.status !== 'ok') {
      conn.memberOf.delete(workspaceId);
      conn.memberIds.delete(workspaceId);
      return null;
    }
    conn.memberOf.set(workspaceId, Date.now() + MEMBERSHIP_TTL_MS);
    conn.memberIds.set(workspaceId, resolution.membership.id);
    return resolution.membership.id;
  }

  private async joinRoom(conn: Connection, room: string, state: Record<string, unknown>): Promise<void> {
    const parsed = parseRoom(room);
    if (!parsed) {
      conn.error('bad-message', 'Invalid room name');
      return;
    }
    if (!conn.rooms.has(room) && conn.rooms.size >= this.options.config.maxRoomsPerConnection) {
      conn.error('limit-exceeded', 'Too many rooms');
      return;
    }
    const memberId = await this.memberIdIn(conn, parsed.workspaceId);
    if (!memberId) {
      conn.error('forbidden', 'You are not a member of this workspace');
      return;
    }
    if (!conn.rooms.has(room) && this.options.authorizeRoom) {
      let allowed = false;
      try {
        allowed = await this.options.authorizeRoom({ userId: conn.userId, memberId, ...parsed });
      } catch (err) {
        this.options.log.warn({ err, room }, 'realtime room authorisation failed');
      }
      if (!allowed) {
        conn.error('forbidden', 'You do not have access to this room');
        return;
      }
    }
    if (conn.closed) return;
    conn.rooms.add(room);
    this.rooms.join(room, conn, state);
  }

  // ---- heartbeat ---------------------------------------------------------------------------------------------

  /** Pings every socket (terminating ones that missed the last pong) and drops connections of ended sessions. */
  async tick(): Promise<void> {
    const conns = [...this.connections.values()];
    for (const conn of conns) {
      if (!conn.alive) {
        conn.socket.terminate();
        this.drop(conn);
        continue;
      }
      conn.alive = false;
      try {
        conn.socket.ping();
      } catch {
        // socket already closing
      }
    }
    const sessionIds = [...new Set(conns.filter((c) => !c.closed).map((c) => c.sessionId))];
    if (sessionIds.length === 0) return;
    try {
      const { rows } = await this.options.pool.query<{ id: string }>(
        'SELECT id::text AS id FROM sessions WHERE id = ANY($1::uuid[]) AND expires_at > now()',
        [sessionIds],
      );
      const valid = new Set(rows.map((r) => r.id));
      for (const conn of conns) {
        if (!conn.closed && !valid.has(conn.sessionId)) {
          conn.close(RealtimeCloseCode.unauthorized, 'session ended');
          this.drop(conn);
        }
      }
    } catch (err) {
      this.options.log.warn({ err }, 'realtime session revalidation failed');
    }
  }
}
