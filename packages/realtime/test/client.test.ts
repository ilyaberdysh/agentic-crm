import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, type RealtimeClientOptions, uniqueUsers, type WebSocketLike } from '../src/client';
import type { ClientToServer, ServerToClient } from '../src/index';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: ClientToServer[] = [];
  closedWith: number | null = null;
  onopen: ((event: unknown) => unknown) | null = null;
  onmessage: ((event: { data: unknown }) => unknown) | null = null;
  onclose: ((event: { code: number }) => unknown) | null = null;
  onerror: ((event: unknown) => unknown) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientToServer);
  }
  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }
  /** Server side helpers. */
  accept(connectionId = 'c1'): void {
    this.readyState = 1;
    this.onopen?.({});
    this.push({ type: 'ready', connectionId, userId: 'u1', clientId: `u1.${connectionId}`, cursor: '0' });
  }
  push(message: ServerToClient): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let sockets: FakeSocket[];
const latest = () => {
  const s = sockets.at(-1);
  if (!s) throw new Error('no socket');
  return s;
};

function makeClient(extra: Partial<RealtimeClientOptions> = {}) {
  return new RealtimeClient({
    url: 'ws://test/realtime',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    reconnectOnOnline: false,
    ...extra,
  });
}

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reconnect backoff', () => {
  it('waits 1, 2, 5, 10, 30, 60, 60 s between attempts', () => {
    const client = makeClient();
    client.connect();
    const delays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const count = sockets.length;
      latest().drop();
      let waited = 0;
      while (sockets.length === count) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 60_000]);
    client.close();
  });

  it('starts over after a successful connection', () => {
    const client = makeClient();
    client.connect();
    latest().drop();
    vi.advanceTimersByTime(1_000);
    latest().drop();
    vi.advanceTimersByTime(2_000);
    latest().accept();
    expect(client.getStatus()).toBe('connected');
    latest().drop();
    expect(client.getStatus()).toBe('reconnecting');
    const count = sockets.length;
    vi.advanceTimersByTime(999);
    expect(sockets.length).toBe(count);
    vi.advanceTimersByTime(1);
    expect(sockets.length).toBe(count + 1);
    client.close();
  });

  it('does not reconnect after 4401 (signed out)', () => {
    const statuses: string[] = [];
    const client = makeClient({ onStatusChange: (s) => statuses.push(s) });
    client.connect();
    latest().accept();
    latest().drop(4401);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe('unauthorized');
  });

  it('reconnectNow skips the wait', () => {
    const client = makeClient();
    client.connect();
    latest().drop();
    client.reconnectNow();
    expect(sockets).toHaveLength(2);
    client.close();
  });
});

describe('subscriptions', () => {
  it('subscribes once connected and resumes from the cursor after a reconnect', () => {
    const invalidations: string[] = [];
    const client = makeClient({ onInvalidate: (m) => invalidations.push(m.seq) });
    const unsubscribe = client.subscribeWorkspace('w1');
    client.subscribeWorkspace('w1'); // ref-counted: one wire subscription
    client.connect();
    latest().accept();
    expect(latest().sent).toEqual([{ type: 'subscribe-workspace', workspaceId: 'w1' }]);
    latest().push({ type: 'subscribed', workspaceId: 'w1', cursor: '10' });
    latest().push({
      type: 'invalidate',
      seq: '11',
      workspaceId: 'w1',
      resource: 'entity-instance',
      resourceId: null,
      scope: {},
    });
    latest().push({
      type: 'invalidate',
      seq: '12',
      workspaceId: 'other',
      resource: 'entity-instance',
      resourceId: null,
      scope: {},
    });
    expect(invalidations).toEqual(['11']);
    expect(client.getCursor('w1')).toBe('10');

    // A pong carries a newer cursor for acked subscriptions.
    latest().push({ type: 'pong', cursor: '11' });
    expect(client.getCursor('w1')).toBe('11');

    latest().drop();
    vi.advanceTimersByTime(1_000);
    latest().accept('c2');
    expect(latest().sent).toEqual([{ type: 'subscribe-workspace', workspaceId: 'w1', after: '11' }]);

    unsubscribe();
    expect(latest().sent.at(-1)).toEqual({ type: 'subscribe-workspace', workspaceId: 'w1', after: '11' }); // still 1 ref
    client.close();
  });

  it('forwards continuity-lost and membership removal', () => {
    const lost: (string | undefined)[] = [];
    const removed: string[] = [];
    const client = makeClient({ onContinuityLost: (w) => lost.push(w), onUnsubscribed: (w) => removed.push(w) });
    client.subscribeWorkspace('w1');
    client.connect();
    latest().accept();
    latest().push({ type: 'continuity-lost', workspaceId: 'w1' });
    latest().push({ type: 'unsubscribed', workspaceId: 'w1', reason: 'not-a-member' });
    expect(lost).toEqual(['w1']);
    expect(removed).toEqual(['w1']);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    latest().accept();
    expect(latest().sent).toEqual([]); // the dropped subscription is not resumed
    client.close();
  });

  it('sends unsubscribe when the last reference is released', () => {
    const client = makeClient();
    client.connect();
    latest().accept();
    const release = client.subscribeWorkspace('w1');
    release();
    release(); // idempotent
    expect(latest().sent).toEqual([
      { type: 'subscribe-workspace', workspaceId: 'w1' },
      { type: 'unsubscribe-workspace', workspaceId: 'w1' },
    ]);
    client.close();
  });
});

describe('heartbeat', () => {
  it('pings and treats a missing pong as a dropped connection', () => {
    const client = makeClient({ pingIntervalMs: 25_000, pongTimeoutMs: 10_000 });
    client.connect();
    latest().accept();
    vi.advanceTimersByTime(25_000);
    expect(latest().sent).toContainEqual({ type: 'ping' });
    latest().push({ type: 'pong' });
    vi.advanceTimersByTime(25_000);
    expect(client.getStatus()).toBe('connected');
    vi.advanceTimersByTime(10_000); // second ping unanswered
    expect(client.getStatus()).toBe('reconnecting');
    expect(sockets[0]?.closedWith).toBe(4000);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    client.close();
  });
});

describe('rooms', () => {
  it('tracks presence, re-enters with the last state after reconnect, clears presence while offline', () => {
    const client = makeClient();
    const room = client.joinRoom('record:w1:r1', { activeCell: null });
    const seen: number[] = [];
    room.onPresence((members) => seen.push(members.length));
    const ephemeral: unknown[] = [];
    room.onEphemeral((m) => ephemeral.push(m.payload));
    client.connect();
    latest().accept();
    expect(latest().sent).toEqual([{ type: 'join-room', room: 'record:w1:r1', state: { activeCell: null } }]);
    latest().push({
      type: 'presence',
      room: 'record:w1:r1',
      members: [
        { userId: 'u1', clientId: 'u1.c1', state: {} },
        { userId: 'u2', clientId: 'u2.a', state: {} },
        { userId: 'u2', clientId: 'u2.b', state: {} },
      ],
    });
    expect(room.members()).toHaveLength(3);
    expect(room.users().map((m) => m.userId)).toEqual(['u1', 'u2']);
    latest().push({ type: 'ephemeral', room: 'record:w1:r1', from: 'u2', clientId: 'u2.a', payload: { x: 1 } });
    expect(ephemeral).toEqual([{ x: 1 }]);

    room.setState({ activeCell: 'B2' });
    expect(latest().sent.at(-1)).toEqual({ type: 'room-state', room: 'record:w1:r1', state: { activeCell: 'B2' } });

    latest().drop();
    expect(room.members()).toEqual([]);
    room.publish({ dropped: true }); // ephemeral: not queued while offline
    vi.advanceTimersByTime(1_000);
    latest().accept('c2');
    expect(latest().sent).toEqual([{ type: 'join-room', room: 'record:w1:r1', state: { activeCell: 'B2' } }]);
    expect(seen).toEqual([3, 0]);

    room.leave();
    expect(latest().sent.at(-1)).toEqual({ type: 'leave-room', room: 'record:w1:r1' });
    client.close();
  });

  it('uniqueUsers keeps one entry per user', () => {
    expect(
      uniqueUsers([
        { userId: 'a', state: { n: 1 } },
        { userId: 'a', state: { n: 2 } },
        { userId: 'b', state: {} },
      ]),
    ).toEqual([
      { userId: 'a', state: { n: 1 } },
      { userId: 'b', state: {} },
    ]);
  });
});
