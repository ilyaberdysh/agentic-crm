// Browser/Node client for the /realtime gateway: one connection per tab, reconnect with backoff
// 1/2/5/10/30/60 s (then 60 s), workspace resubscription with resume cursors, continuity-loss signalling,
// app-level heartbeat, and room presence state that survives reconnects (realtime.md §4–5, CROSS-DOMAIN B.9).
import {
  type ClientToServer,
  type InvalidationMessage,
  type PresenceMember,
  RECONNECT_BACKOFF_MS,
  RealtimeCloseCode,
  type RealtimeErrorCode,
  type ServerToClient,
} from './index';

/**
 * Subset of the WHATWG WebSocket used here (browser WebSocket and the `ws` package both satisfy it).
 * Handler events are `any` because the DOM and `ws` event types differ.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: any) => unknown) | null;
  onmessage: ((event: any) => unknown) | null;
  onclose: ((event: any) => unknown) | null;
  onerror: ((event: any) => unknown) | null;
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  /** The server refused the session (signed out / expired): no automatic reconnect; call connect() after sign-in. */
  | 'unauthorized'
  | 'closed';

export interface RealtimeClientOptions {
  /** e.g. `${location.origin.replace(/^http/, 'ws')}/realtime`. */
  url: string | (() => string);
  /** Defaults to `new WebSocket(url)` (browser / Node ≥ 22 global). */
  createSocket?: (url: string) => WebSocketLike;
  backoffMs?: readonly number[];
  /** App-level ping period; a missing pong within pongTimeoutMs counts as a dropped connection. */
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  /** Reconnect immediately when the browser reports it is back online. Default true. */
  reconnectOnOnline?: boolean;
  /** Invalidation for a subscribed workspace: refetch the stale keys with acceptAfter = message.seq. */
  onInvalidate?: (message: InvalidationMessage) => void;
  /** Messages may have been missed: drop/refetch everything cached for the workspace (or all when undefined). */
  onContinuityLost?: (workspaceId: string | undefined) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  /** The server dropped a workspace subscription (membership removed). */
  onUnsubscribed?: (workspaceId: string) => void;
  onServerError?: (error: { code: RealtimeErrorCode; message: string }) => void;
}

export interface RoomHandle {
  readonly room: string;
  /** Everyone in the room, one entry per tab. */
  members(): PresenceMember[];
  /** One entry per user (the UI shows one avatar per user, X-04); the first tab's state wins. */
  users(): PresenceMember[];
  setState(state: Record<string, unknown>): void;
  /** Ephemeral fan-out to the other occupants; dropped while disconnected (never queued). */
  publish(payload: Record<string, unknown>): void;
  onPresence(listener: (members: PresenceMember[]) => void): () => void;
  onEphemeral(
    listener: (message: { from: string; clientId?: string; payload: Record<string, unknown> }) => void,
  ): () => void;
  leave(): void;
}

interface WorkspaceEntry {
  refs: number;
  /** Resume cursor for this subscription; null until the first `subscribed`. */
  cursor: string | null;
  acked: boolean;
}

interface RoomEntry {
  refs: number;
  state: Record<string, unknown>;
  members: PresenceMember[];
  presence: Set<(members: PresenceMember[]) => void>;
  ephemeral: Set<(message: { from: string; clientId?: string; payload: Record<string, unknown> }) => void>;
}

const OPEN = 1;

/** Compares two seq/cursor strings (decimal bigint). */
export function compareSeq(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** One entry per user, keeping the first occurrence. */
export function uniqueUsers(members: PresenceMember[]): PresenceMember[] {
  const seen = new Set<string>();
  return members.filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true)));
}

export class RealtimeClient {
  private socket: WebSocketLike | null = null;
  private status: ConnectionStatus = 'idle';
  private attempt = 0;
  private wanted = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly workspaces = new Map<string, WorkspaceEntry>();
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly backoff: readonly number[];
  private readonly onlineListener = () => this.reconnectNow();
  /** Set from the server's `ready` message. */
  connectionId: string | null = null;
  userId: string | null = null;
  clientId: string | null = null;

  constructor(private readonly options: RealtimeClientOptions) {
    this.backoff = options.backoffMs ?? RECONNECT_BACKOFF_MS;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** The resume cursor of a workspace subscription (for diagnostics/tests). */
  getCursor(workspaceId: string): string | null {
    return this.workspaces.get(workspaceId)?.cursor ?? null;
  }

  connect(): void {
    this.wanted = true;
    if (this.socket || this.reconnectTimer) return;
    if (this.options.reconnectOnOnline !== false) {
      (globalThis as { addEventListener?: (type: string, fn: () => void) => void }).addEventListener?.(
        'online',
        this.onlineListener,
      );
    }
    this.open();
  }

  /** Closes for good (until connect() is called again). */
  close(): void {
    this.wanted = false;
    this.clearTimers();
    (globalThis as { removeEventListener?: (type: string, fn: () => void) => void }).removeEventListener?.(
      'online',
      this.onlineListener,
    );
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      socket.close(1000, 'client closed');
    }
    this.clearPresence();
    this.setStatus('closed');
  }

  /** Skip the backoff wait (e.g. the network came back). */
  reconnectNow(): void {
    if (!this.wanted || this.socket) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    this.open();
  }

  /** Ref-counted; resubscribed (with the resume cursor) after every reconnect. Returns the unsubscribe function. */
  subscribeWorkspace(workspaceId: string): () => void {
    const entry = this.workspaces.get(workspaceId);
    if (entry) entry.refs += 1;
    else {
      this.workspaces.set(workspaceId, { refs: 1, cursor: null, acked: false });
      if (this.isReady()) this.send({ type: 'subscribe-workspace', workspaceId });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.workspaces.get(workspaceId);
      if (!current) return;
      current.refs -= 1;
      if (current.refs > 0) return;
      this.workspaces.delete(workspaceId);
      if (this.isReady()) this.send({ type: 'unsubscribe-workspace', workspaceId });
    };
  }

  /** Enters a presence room (`<namespace>:<workspaceId>[:…]`); re-entered with the last state after reconnects. */
  joinRoom(room: string, initialState: Record<string, unknown> = {}): RoomHandle {
    let entry = this.rooms.get(room);
    if (entry) entry.refs += 1;
    else {
      entry = { refs: 1, state: initialState, members: [], presence: new Set(), ephemeral: new Set() };
      this.rooms.set(room, entry);
      if (this.isReady()) this.send({ type: 'join-room', room, state: initialState });
    }
    const roomEntry = entry;
    let left = false;
    return {
      room,
      members: () => roomEntry.members,
      users: () => uniqueUsers(roomEntry.members),
      setState: (state) => {
        if (left) return;
        roomEntry.state = state;
        if (this.isReady()) this.send({ type: 'room-state', room, state });
      },
      publish: (payload) => {
        if (!left && this.isReady()) this.send({ type: 'room-ephemeral', room, payload });
      },
      onPresence: (listener) => {
        roomEntry.presence.add(listener);
        return () => roomEntry.presence.delete(listener);
      },
      onEphemeral: (listener) => {
        roomEntry.ephemeral.add(listener);
        return () => roomEntry.ephemeral.delete(listener);
      },
      leave: () => {
        if (left) return;
        left = true;
        roomEntry.refs -= 1;
        if (roomEntry.refs > 0) return;
        this.rooms.delete(room);
        if (this.isReady()) this.send({ type: 'leave-room', room });
      },
    };
  }

  // ---- internals ---------------------------------------------------------------------------------------------

  private isReady(): boolean {
    return this.status === 'connected' && this.socket?.readyState === OPEN;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private send(message: ClientToServer): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private open(): void {
    const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url;
    const create =
      this.options.createSocket ??
      ((u: string) => {
        const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
        if (!Ctor) throw new Error('No WebSocket implementation available; pass createSocket');
        return new Ctor(u);
      });
    this.setStatus(this.attempt === 0 && this.status !== 'reconnecting' ? 'connecting' : 'reconnecting');
    let socket: WebSocketLike;
    try {
      socket = create(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onmessage = (event: { data: unknown }) => this.onMessage(event.data);
    socket.onclose = (event: { code?: number }) => this.onDisconnect(socket, event?.code ?? 1006);
    socket.onerror = () => {
      // 'close' follows; reconnect is handled there.
    };
  }

  private detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  private onMessage(data: unknown): void {
    let message: ServerToClient;
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data)) as ServerToClient;
    } catch {
      return;
    }
    switch (message.type) {
      case 'ready':
        this.connectionId = message.connectionId;
        this.userId = message.userId;
        this.clientId = message.clientId;
        this.attempt = 0;
        this.setStatus('connected');
        this.resubscribe();
        this.startHeartbeat();
        return;
      case 'invalidate':
        if (this.workspaces.has(message.workspaceId)) this.options.onInvalidate?.(message);
        return;
      case 'subscribed': {
        const entry = this.workspaces.get(message.workspaceId);
        if (entry) {
          entry.cursor = message.cursor;
          entry.acked = true;
        }
        return;
      }
      case 'unsubscribed':
        if (message.reason === 'not-a-member' && this.workspaces.delete(message.workspaceId)) {
          this.options.onUnsubscribed?.(message.workspaceId);
        }
        return;
      case 'continuity-lost':
        this.options.onContinuityLost?.(message.workspaceId);
        return;
      case 'pong':
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        if (message.cursor !== undefined) {
          for (const entry of this.workspaces.values()) if (entry.acked) entry.cursor = message.cursor;
        }
        return;
      case 'presence': {
        const room = this.rooms.get(message.room);
        if (!room) return;
        room.members = message.members;
        for (const listener of room.presence) listener(message.members);
        return;
      }
      case 'ephemeral': {
        const room = this.rooms.get(message.room);
        if (!room) return;
        const event =
          message.clientId === undefined
            ? { from: message.from, payload: message.payload }
            : { from: message.from, clientId: message.clientId, payload: message.payload };
        for (const listener of room.ephemeral) listener(event);
        return;
      }
      case 'error':
        this.options.onServerError?.({ code: message.code, message: message.message });
        return;
    }
  }

  /** After (re)connecting: resume every workspace from its cursor and re-enter rooms with the last state. */
  private resubscribe(): void {
    for (const [workspaceId, entry] of this.workspaces) {
      if (entry.cursor !== null) {
        this.send({ type: 'subscribe-workspace', workspaceId, after: entry.cursor });
      } else {
        // Previously subscribed but never received a cursor: we cannot prove nothing was missed.
        if (entry.acked) this.options.onContinuityLost?.(workspaceId);
        this.send({ type: 'subscribe-workspace', workspaceId });
      }
      entry.acked = false;
    }
    for (const [room, entry] of this.rooms) this.send({ type: 'join-room', room, state: entry.state });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.pingIntervalMs ?? 25_000;
    const timeout = this.options.pongTimeoutMs ?? 10_000;
    this.pingTimer = setInterval(() => {
      if (!this.isReady()) return;
      this.send({ type: 'ping' });
      if (this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        // No pong: treat the socket as dead without waiting for the TCP close.
        const socket = this.socket;
        if (!socket) return;
        this.detach(socket);
        try {
          socket.close(4000, 'pong timeout');
        } catch {
          // ignore
        }
        this.onDisconnect(socket, 1006);
      }, timeout);
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearPresence(): void {
    for (const room of this.rooms.values()) {
      if (room.members.length === 0) continue;
      room.members = [];
      for (const listener of room.presence) listener([]);
    }
  }

  private onDisconnect(socket: WebSocketLike, code: number): void {
    if (this.socket !== socket) return;
    this.detach(socket);
    this.socket = null;
    this.stopHeartbeat();
    this.clearPresence();
    if (!this.wanted) {
      this.setStatus('closed');
      return;
    }
    if (code === RealtimeCloseCode.unauthorized) {
      this.wanted = false;
      this.setStatus('unauthorized');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) return;
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 60_000;
    this.attempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}
