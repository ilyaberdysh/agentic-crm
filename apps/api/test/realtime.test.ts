import { randomUUID } from 'node:crypto';
import { memberContext } from '@agentic-crm/domain';
import type { InvalidationMessage, PresenceMember, ServerToClient } from '@agentic-crm/realtime';
import { RealtimeClient } from '@agentic-crm/realtime/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  addMember,
  authPost,
  createWorkspace,
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  sleep,
  startHarness,
  type TestUser,
  WEB_ORIGIN,
  WsClient,
  writeChange,
} from './support/harness';

type Invalidate = Extract<ServerToClient, { type: 'invalidate' }>;
type Presence = Extract<ServerToClient, { type: 'presence' }>;

let h: Harness;
let alice: TestUser; // W1
let carol: TestUser; // W1
let bob: TestUser; // W2
let w1: string;
let w2: string;
let aliceMemberId: string;
const clients: WsClient[] = [];

async function connect(user: TestUser, origin: string | null = WEB_ORIGIN) {
  const client = await WsClient.connect(h, user.cookie, origin);
  clients.push(client);
  return client;
}

beforeAll(async () => {
  h = await startHarness();
  alice = await signUp(h, 'Alice');
  carol = await signUp(h, 'Carol');
  bob = await signUp(h, 'Bob');
  const created = await createWorkspaceWithMembers(h, `w1-${Date.now()}`, [
    { user: alice, admin: true },
    { user: carol },
  ]);
  w1 = created.workspaceId;
  aliceMemberId = created.memberIds.get(alice.id) as string;
  w2 = await createWorkspace(h, `w2-${Date.now()}`, [{ user: bob, admin: true }]);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('connection', () => {
  it('refuses an upgrade without a session (401)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(h.wsUrl, { headers: { origin: WEB_ORIGIN } });
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.on('open', () => reject(new Error('should not open')));
      socket.on('error', () => {});
    });
    expect(status).toBe(401);
  });

  it('refuses a foreign Origin (cross-site WebSocket hijacking)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(h.wsUrl, { headers: { origin: 'https://evil.example', cookie: alice.cookie } });
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.on('open', () => reject(new Error('should not open')));
      socket.on('error', () => {});
    });
    expect(status).toBe(403);
  });

  it('greets with ready: connection id, user id, clientId = userId.connectionId, cursor', async () => {
    const client = await connect(alice);
    const ready = client.messages[0];
    expect(ready).toMatchObject({ type: 'ready', userId: alice.id });
    if (ready?.type !== 'ready') throw new Error('no ready');
    expect(ready.clientId).toBe(`${alice.id}.${ready.connectionId}`);
    expect(ready.cursor).toMatch(/^\d+$/);
  });

  it('answers ping with pong + cursor and rejects malformed messages', async () => {
    const client = await connect(alice);
    client.send({ type: 'ping' });
    expect(await client.nextNew((m) => m.type === 'pong')).toMatchObject({ type: 'pong', cursor: expect.any(String) });
    client.send({ type: 'subscribe-workspace', workspaceId: 'not-a-uuid' });
    expect(await client.nextNew((m) => m.type === 'error')).toMatchObject({ type: 'error', code: 'bad-message' });
    client.socket.send('{nope');
    expect(await client.nextNew((m) => m.type === 'error')).toMatchObject({ code: 'bad-message' });
  });
});

describe('data channel', () => {
  it('delivers an invalidation only to members of the workspace, with seq = change_log id', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    expect(await a.subscribe(w1)).toMatchObject({ type: 'subscribed', workspaceId: w1, cursor: expect.any(String) });
    expect(await b.subscribe(w2)).toMatchObject({ type: 'subscribed', workspaceId: w2 });

    const resourceId = randomUUID();
    const definitionId = randomUUID();
    const seq = await writeChange(h, {
      workspaceId: w1,
      resource: 'attribute-value-list',
      resourceId,
      scope: { entityDefinitionId: definitionId, entityInstanceIds: [resourceId] },
    });
    const received = await a.next<Invalidate>((m) => m.type === 'invalidate' && m.seq === seq);
    expect(received).toEqual({
      type: 'invalidate',
      seq,
      workspaceId: w1,
      resource: 'attribute-value-list',
      resourceId,
      scope: { entityDefinitionId: definitionId, entityInstanceIds: [resourceId] },
    } satisfies InvalidationMessage);

    // A later W2 change reaches Bob; the W1 one never did.
    const seq2 = await writeChange(h, { workspaceId: w2 });
    await b.next((m) => m.type === 'invalidate' && m.seq === seq2);
    expect(b.invalidations().map((m) => m.seq)).toEqual([seq2]);
    expect(a.invalidations().some((m) => m.seq === seq2)).toBe(false);
  });

  it('honours an explicit audience', async () => {
    const a = await connect(alice);
    const c = await connect(carol);
    await a.subscribe(w1);
    await c.subscribe(w1);
    const privateSeq = await writeChange(h, { workspaceId: w1, audience: { userIds: [carol.id] } });
    const publicSeq = await writeChange(h, { workspaceId: w1 });
    await c.next((m) => m.type === 'invalidate' && m.seq === publicSeq);
    await a.next((m) => m.type === 'invalidate' && m.seq === publicSeq);
    expect(c.invalidations().map((m) => m.seq)).toContain(privateSeq);
    expect(a.invalidations().map((m) => m.seq)).not.toContain(privateSeq);
  });

  it('refuses to subscribe to a workspace the user is not a member of', async () => {
    const b = await connect(bob);
    expect(await b.subscribe(w1)).toMatchObject({ type: 'error', code: 'forbidden' });
    expect(await b.subscribe(randomUUID())).toMatchObject({ type: 'error', code: 'not-found' });
    const seq = await writeChange(h, { workspaceId: w1 });
    await sleep(300);
    expect(b.invalidations().some((m) => m.seq === seq)).toBe(false);
  });

  it('stops delivering after unsubscribe', async () => {
    const a = await connect(alice);
    await a.subscribe(w1);
    a.send({ type: 'unsubscribe-workspace', workspaceId: w1 });
    await a.nextNew((m) => m.type === 'unsubscribed');
    const seq = await writeChange(h, { workspaceId: w1 });
    await sleep(300);
    expect(a.invalidations().some((m) => m.seq === seq)).toBe(false);
  });

  it('drops the subscription when the user is removed from the workspace', async () => {
    const dave = await signUp(h, 'Dave');
    const daveMemberId = await addMember(h, w1, { memberId: aliceMemberId }, dave);
    const d = await connect(dave);
    await d.subscribe(w1);
    // Removal = suspension through the domain, which writes the workspace-member change_log row.
    await h.domain.members.updateAccessLevel(memberContext(w1, aliceMemberId), {
      memberId: daveMemberId,
      accessLevel: 'suspended',
    });
    // The removal itself is delivered (the client refetches and learns it lost access), then the channel closes.
    await d.next((m) => m.type === 'invalidate' && m.resource === 'workspace-member' && m.resourceId === daveMemberId);
    expect(await d.next((m) => m.type === 'unsubscribed')).toEqual({
      type: 'unsubscribed',
      workspaceId: w1,
      reason: 'not-a-member',
    });
    const after = await writeChange(h, { workspaceId: w1 });
    await sleep(300);
    expect(d.invalidations().some((m) => m.seq === after)).toBe(false);
  });

  it('closes the socket with 4401 when the session signs out', async () => {
    const eve = await signUp(h, 'Eve');
    const e = await connect(eve);
    const closed = e.waitClosed();
    const response = await authPost(h, '/sign-out', {}, eve.cookie);
    expect(response.status).toBe(200);
    expect(await closed).toBe(4401);
  });

  it('closes sockets of revoked or expired sessions on the heartbeat', async () => {
    const frank = await signUp(h, 'Frank');
    const f = await connect(frank);
    const a = await connect(alice);
    const closed = f.waitClosed();
    await h.db.query('DELETE FROM sessions WHERE user_id = $1', [frank.id]); // e.g. admin "End this session"
    await h.gateway.tick();
    expect(await closed).toBe(4401);
    expect(a.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('resume and continuity', () => {
  it('replays invalidations missed while disconnected (accept after the cursor)', async () => {
    const a1 = await connect(alice);
    const { cursor } = await a1.subscribe(w1);
    await a1.close();
    const missed = [await writeChange(h, { workspaceId: w1 }), await writeChange(h, { workspaceId: w1 })];
    await writeChange(h, { workspaceId: w2 }); // not Alice's workspace
    const a2 = await connect(alice);
    const ack = await a2.subscribe(w1, cursor);
    expect(ack.type).toBe('subscribed');
    const replayed = a2.invalidations().map((m) => m.seq);
    expect(replayed).toEqual(missed);
    expect(a2.messages.some((m) => m.type === 'continuity-lost')).toBe(false);
    expect(BigInt(ack.cursor) >= BigInt(missed[1] ?? '0')).toBe(true);
  });

  it('sends continuity-lost when the cursor is older than the retained change_log', async () => {
    const a1 = await connect(alice);
    const { cursor } = await a1.subscribe(w1);
    await a1.close();
    const ids = [await writeChange(h, { workspaceId: w1 }), await writeChange(h, { workspaceId: w1 })];
    // Retention pruning removed everything up to and including the first row after the cursor.
    await h.db.query('DELETE FROM change_log WHERE id <= $1', [ids[0]]);
    const a2 = await connect(alice);
    const ack = await a2.subscribe(w1, cursor);
    expect(ack.type).toBe('subscribed');
    expect(a2.messages).toContainEqual({ type: 'continuity-lost', workspaceId: w1 });
    expect(a2.invalidations()).toEqual([]);
  });

  it('sends continuity-lost when the cursor row is older than the retention window', async () => {
    const seq = await writeChange(h, { workspaceId: w1 });
    await h.db.query(`UPDATE change_log SET created_at = now() - interval '8 days' WHERE id = $1`, [seq]);
    try {
      const a = await connect(alice);
      await a.subscribe(w1, seq);
      expect(a.messages).toContainEqual({ type: 'continuity-lost', workspaceId: w1 });
    } finally {
      await h.db.query('UPDATE change_log SET created_at = now() WHERE id = $1', [seq]);
    }
  });

  it('does not report continuity loss for a recent cursor with nothing new', async () => {
    const seq = await writeChange(h, { workspaceId: w2 });
    const a = await connect(alice);
    await a.subscribe(w1, seq);
    expect(a.messages.some((m) => m.type === 'continuity-lost')).toBe(false);
    expect(a.invalidations()).toEqual([]);
  });

  it('sends continuity-lost for a cursor from the future (database reset)', async () => {
    const a = await connect(alice);
    await a.subscribe(w1, '999999999999');
    expect(a.messages).toContainEqual({ type: 'continuity-lost', workspaceId: w1 });
  });
});

describe('rooms', () => {
  // A namespace without its own access rule (record and note rooms check the record / note: slice3.test.ts; `thread`
  // is Ask Agentic's since slice 10).
  const room = () => `scratch:${w1}:${randomUUID()}`;

  it('tracks presence on join, state change and leave', async () => {
    const name = room();
    const a = await connect(alice);
    const c = await connect(carol);
    a.send({ type: 'join-room', room: name, state: { activeCell: null } });
    const first = await a.nextNew<Presence>((m) => m.type === 'presence' && m.room === name);
    expect(first.members).toEqual([
      { userId: alice.id, clientId: expect.stringMatching(`^${alice.id}\\.`), state: { activeCell: null } },
    ]);

    c.send({ type: 'join-room', room: name, state: { activeCell: 'A1' } });
    const both = await a.nextNew<Presence>((m) => m.type === 'presence' && m.members.length === 2);
    expect(both.members.map((m: PresenceMember) => m.userId).sort()).toEqual([alice.id, carol.id].sort());
    await c.next((m) => m.type === 'presence' && m.room === name && m.members.length === 2);

    c.send({ type: 'room-state', room: name, state: { activeCell: 'B2', draft: 'Hel' } });
    const updated = await a.nextNew<Presence>((m) => m.type === 'presence' && m.room === name);
    expect(updated.members.find((m: PresenceMember) => m.userId === carol.id)?.state).toEqual({
      activeCell: 'B2',
      draft: 'Hel',
    });

    c.send({ type: 'leave-room', room: name });
    const left = await a.nextNew<Presence>((m) => m.type === 'presence' && m.room === name);
    expect(left.members.map((m: PresenceMember) => m.userId)).toEqual([alice.id]);
  });

  it('removes a disconnected occupant', async () => {
    const name = room();
    const a = await connect(alice);
    const c = await connect(carol);
    a.send({ type: 'join-room', room: name });
    c.send({ type: 'join-room', room: name });
    await a.next((m) => m.type === 'presence' && m.room === name && m.members.length === 2);
    await c.close();
    const after = await a.nextNew<Presence>((m) => m.type === 'presence' && m.room === name);
    expect(after.members.map((m: PresenceMember) => m.userId)).toEqual([alice.id]);
  });

  it('fans out ephemeral payloads to the others only (no echo)', async () => {
    const name = room();
    const a = await connect(alice);
    const c = await connect(carol);
    a.send({ type: 'join-room', room: name });
    c.send({ type: 'join-room', room: name });
    await a.next((m) => m.type === 'presence' && m.room === name && m.members.length === 2);
    a.send({ type: 'room-ephemeral', room: name, payload: { cursor: { x: 1, y: 2 } } });
    const got = await c.nextNew((m) => m.type === 'ephemeral');
    expect(got).toMatchObject({ type: 'ephemeral', room: name, from: alice.id, payload: { cursor: { x: 1, y: 2 } } });
    await sleep(100);
    expect(a.messages.some((m) => m.type === 'ephemeral')).toBe(false);
  });

  it('refuses rooms of a workspace the user is not a member of, and bad room names', async () => {
    const b = await connect(bob);
    b.send({ type: 'join-room', room: room() });
    expect(await b.nextNew((m) => m.type === 'error')).toMatchObject({ code: 'forbidden' });
    b.send({ type: 'join-room', room: 'no-workspace-here' });
    expect(await b.nextNew((m) => m.type === 'error')).toMatchObject({ code: 'bad-message' });
    b.send({ type: 'room-ephemeral', room: `scratch:${w2}:x`, payload: {} });
    expect(await b.nextNew((m) => m.type === 'error')).toMatchObject({ code: 'not-found' });
  });

  it('never persists room traffic', async () => {
    const before = await h.db.query('SELECT count(*)::int AS n FROM change_log');
    const name = room();
    const a = await connect(alice);
    a.send({ type: 'join-room', room: name, state: { draft: 'secret draft' } });
    a.send({ type: 'room-ephemeral', room: name, payload: { draft: 'x' } });
    await a.next((m) => m.type === 'presence' && m.room === name);
    const after = await h.db.query('SELECT count(*)::int AS n FROM change_log');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});

describe('RealtimeClient (packages/realtime) against the gateway', () => {
  it('reconnects after a server restart and resumes without losing invalidations', async () => {
    const received: InvalidationMessage[] = [];
    const statuses: string[] = [];
    let continuityLost = 0;
    const client = new RealtimeClient({
      url: h.wsUrl,
      createSocket: (url) => new WebSocket(url, { headers: { cookie: alice.cookie, origin: WEB_ORIGIN } }),
      backoffMs: [100, 200],
      onInvalidate: (m) => received.push(m),
      onContinuityLost: () => {
        continuityLost += 1;
      },
      onStatusChange: (s) => statuses.push(s),
      reconnectOnOnline: false,
    });
    try {
      // View rooms need a view the member can read (room-access.ts).
      const [view] = await h.domain.views.list(memberContext(w1, aliceMemberId), { entityDefinitionId: 'companies' });
      client.connect();
      client.subscribeWorkspace(w1);
      const roomHandle = client.joinRoom(`view:${w1}:${view?.id}`, { activeCell: 'C3' });
      await waitFor(() => client.getCursor(w1) !== null);
      const live = await writeChange(h, { workspaceId: w1 });
      await waitFor(() => received.some((m) => m.seq === live));
      await waitFor(() => roomHandle.members().length === 1);

      // Server drops every connection ("service restart"); a write lands while the client is away.
      h.gateway.closeAll(1012, 'restart');
      const whileAway = await writeChange(h, { workspaceId: w1 });
      await waitFor(() => received.some((m) => m.seq === whileAway), 5_000);
      expect(statuses).toContain('reconnecting');
      expect(client.getStatus()).toBe('connected');
      expect(continuityLost).toBe(0);
      // Presence is re-entered with the last state.
      await waitFor(() => roomHandle.members()[0]?.state.activeCell === 'C3');
    } finally {
      client.close();
    }
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await sleep(20);
  }
}
