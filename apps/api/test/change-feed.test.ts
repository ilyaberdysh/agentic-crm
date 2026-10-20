// Commit order != id order: the feed must emit late commits, skip aborted ids, never emit twice, and only move
// its resume cursor past ids that are resolved.
import { randomUUID } from 'node:crypto';
import type { ChangeLogRow } from '@agentic-crm/realtime';
import Fastify from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChangeFeed } from '../src/realtime/change-feed';
import { databaseUrl } from './support/database';
import { sleep } from './support/harness';

const url = databaseUrl();
let pool: pg.Pool;
const feeds: ChangeFeed[] = [];
const log = Fastify({ logger: false }).log;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: url, max: 4 });
});
afterEach(async () => {
  await Promise.all(feeds.splice(0).map((f) => f.stop()));
});
afterAll(async () => {
  await pool.end();
});

function startFeed(workspaceId: string, bootLookback = 0) {
  const rows: ChangeLogRow[] = [];
  const feed = new ChangeFeed({
    pool,
    connectionString: url,
    log,
    pollIntervalMs: 60_000, // tests drive polls explicitly
    bootLookback,
    gapGraceMs: 30,
    onRows: (batch) => rows.push(...batch.filter((r) => r.workspaceId === workspaceId)),
  });
  feeds.push(feed);
  return { feed, rows, ids: () => rows.map((r) => r.id) };
}

async function insert(client: pg.Pool | pg.Client, workspaceId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO change_log (workspace_id, resource, resource_id) VALUES ($1, 'entity-instance', $2) RETURNING id::text`,
    [workspaceId, randomUUID()],
  );
  return rows[0]?.id ?? '';
}

async function openTx(connectionString = url): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('BEGIN');
  return client;
}

describe('ChangeFeed', () => {
  it('emits a late commit with a lower id, and holds the cursor below it until then', async () => {
    const ws = randomUUID();
    const { feed, ids } = startFeed(ws);
    await feed.start();

    const tx = await openTx();
    const low = await insert(tx, ws); // allocated first, committed last
    const high = await insert(pool, ws);
    expect(BigInt(low) < BigInt(high)).toBe(true);

    await feed.poll();
    expect(ids()).toEqual([high]);
    expect(BigInt(feed.cursor) < BigInt(low)).toBe(true);

    await tx.query('COMMIT');
    await tx.end();
    await feed.poll();
    expect(ids()).toEqual([high, low]);
    expect(BigInt(feed.cursor) >= BigInt(high)).toBe(true);
  });

  it('declares an aborted id dead and moves the cursor past it', async () => {
    const ws = randomUUID();
    const { feed, ids } = startFeed(ws);
    await feed.start();

    const tx = await openTx();
    const aborted = await insert(tx, ws);
    const committed = await insert(pool, ws);
    await feed.poll();
    expect(ids()).toEqual([committed]);
    expect(BigInt(feed.cursor) < BigInt(aborted)).toBe(true);

    await tx.query('ROLLBACK');
    await tx.end();
    await sleep(60); // gap grace
    await feed.poll(); // records the change_log writers that could own the gap (none: the insert rolled back)
    await feed.poll(); // they are all gone and the id is still invisible: dead
    expect(BigInt(feed.cursor) >= BigInt(committed)).toBe(true);
    expect(ids()).toEqual([committed]);
  });

  it('declares an aborted id dead while unrelated transactions stay open (here or in another database)', async () => {
    // Long transactions holding an xid, which kept the cluster-wide snapshot xmin behind the gap before: one in
    // another database of the same cluster (another test suite), one in this database writing another table.
    const elsewhere = await openTx(databaseUrl('postgres'));
    await elsewhere.query('SELECT pg_current_xact_id()');
    const unrelated = await openTx();
    await unrelated.query('CREATE TEMP TABLE unrelated (id int)');
    await unrelated.query('INSERT INTO unrelated VALUES (1)');
    try {
      const ws = randomUUID();
      const { feed, ids } = startFeed(ws);
      await feed.start();
      const tx = await openTx();
      const aborted = await insert(tx, ws);
      const committed = await insert(pool, ws);
      await feed.poll();
      expect(BigInt(feed.cursor) < BigInt(aborted)).toBe(true);
      await tx.query('ROLLBACK');
      await tx.end();
      await sleep(60);
      await feed.poll();
      await feed.poll();
      expect(BigInt(feed.cursor) >= BigInt(committed)).toBe(true);
      expect(ids()).toEqual([committed]);
    } finally {
      await elsewhere.query('ROLLBACK');
      await unrelated.query('ROLLBACK');
      await Promise.all([elsewhere.end(), unrelated.end()]);
    }
  });

  it('waits for a gap whose owner is still writing, however long it takes', async () => {
    const ws = randomUUID();
    const { feed, ids } = startFeed(ws);
    await feed.start();
    const tx = await openTx();
    const pending = await insert(tx, ws);
    const committed = await insert(pool, ws);
    for (let i = 0; i < 4; i += 1) {
      await sleep(40);
      await feed.poll();
    }
    expect(ids()).toEqual([committed]);
    expect(BigInt(feed.cursor) < BigInt(pending)).toBe(true);
    await tx.query('COMMIT');
    await tx.end();
    await feed.poll();
    expect(ids()).toEqual([committed, pending]);
    expect(BigInt(feed.cursor) >= BigInt(committed)).toBe(true);
  });

  it('keeps delivering while an unrelated long transaction holds the snapshot xmin back', async () => {
    const ws = randomUUID();
    const { feed, ids } = startFeed(ws);
    await feed.start();

    const tx = await openTx();
    const pending = await insert(tx, ws);
    const delivered: string[] = [];
    for (let i = 0; i < 3; i += 1) delivered.push(await insert(pool, ws));
    await sleep(60);
    await feed.poll();
    await feed.poll();
    expect(ids()).toEqual(delivered); // latency does not depend on the open transaction
    expect(BigInt(feed.cursor) < BigInt(pending)).toBe(true);
    await tx.query('COMMIT');
    await tx.end();
    await feed.poll();
    expect(ids()).toEqual([...delivered, pending]);
  });

  it('never emits a row twice across polls', async () => {
    const ws = randomUUID();
    const { feed, ids } = startFeed(ws);
    await feed.start();
    const a = await insert(pool, ws);
    const b = await insert(pool, ws);
    await feed.poll();
    await feed.poll();
    await feed.poll();
    expect(ids()).toEqual([a, b]);
  });

  it('wakes on NOTIFY without waiting for the safety-net poll', async () => {
    const ws = randomUUID();
    const { feed, ids } = startFeed(ws);
    await feed.start();
    const id = await insert(pool, ws);
    await pool.query(`SELECT pg_notify('change_log', $1)`, [id]);
    const start = Date.now();
    while (!ids().includes(id) && Date.now() - start < 2_000) await sleep(10);
    expect(ids()).toEqual([id]);
  });

  it('emits rows that were still in flight when it booted (boot lookback)', async () => {
    const ws = randomUUID();
    const tx = await openTx();
    const inFlight = await insert(tx, ws);
    const committed = await insert(pool, ws); // a later committed id, so the sequence is ahead of the in-flight row
    // The 1,000-id lookback window also covers what earlier tests and files left behind: aborted ids, rows deleted
    // by the realtime suite and full 500-row batches. Each of those holds the frontier for a grace period and two
    // polls, so the in-flight row is reached after a bounded number of polls — not necessarily the first one.
    const { feed, ids } = startFeed(ws, 1_000);
    await feed.start();
    expect(ids()).not.toContain(inFlight);
    await tx.query('COMMIT');
    await tx.end();
    for (let i = 0; i < 20 && !ids().includes(inFlight); i += 1) {
      await sleep(40); // > gapGraceMs
      await feed.poll();
    }
    expect(ids()).toContain(inFlight);
    expect(ids()).toContain(committed);
    expect(new Set(ids()).size).toBe(ids().length);
  });

  it('does not spin on full batches while the frontier is held by an open writer', async () => {
    const ws = randomUUID();
    const tx = await openTx();
    const pending = await insert(tx, ws);
    // More committed rows above the gap than one batch holds.
    await pool.query(
      `INSERT INTO change_log (workspace_id, resource, resource_id)
       SELECT $1, 'entity-instance', gen_random_uuid() FROM generate_series(1, 600)`,
      [ws],
    );
    const { feed, ids } = startFeed(ws, 1_000);
    await feed.start(); // used to loop on the same full batch until the writer committed
    expect(ids()).not.toContain(pending);
    await tx.query('COMMIT');
    await tx.end();
    // Older aborted ids in the lookback window (earlier tests) resolve once no writer can own them any more.
    await sleep(60);
    for (let i = 0; i < 4; i += 1) await feed.poll();
    expect(ids()).toContain(pending);
    expect(new Set(ids()).size).toBe(601);
  });
});
