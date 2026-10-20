// Reads committed change_log rows (contract: packages/realtime ChangeLogRow) and emits each exactly once, in id
// order per poll, as soon as it is visible: LISTEN change_log wakes a poll; a timer is the safety net.
//
// Ids come from an identity sequence, so they are allocated before commit and transactions can commit out of id
// order: a reader can see id 11 while id 10 is still in flight. The feed therefore keeps
//   - `delivered`: ids above the frontier already emitted (never emitted twice),
//   - `gaps`: invisible ids below the highest seen id. A gap is either an in-flight transaction (it will appear
//     and be emitted late) or an aborted insert. Every transaction that inserts into change_log holds a
//     RowExclusiveLock on it from before its id is allocated until it ends, so after a grace period the feed
//     records the virtual transaction ids holding such a lock (`holders`, read after the snapshot that saw the
//     gap). Once none of them holds it any more, a later snapshot that still does not see the id proves its
//     transaction ended without committing it: the gap is dead. Only writers of this database's change_log are
//     waited for, so activity in other databases on the same cluster (or unrelated long transactions) never holds
//     the cursor back.
//   - `frontier`: every id <= frontier is emitted or dead. It is the resume `cursor` handed to clients: a client
//     that has seen cursor C has received everything up to C, whatever the commit order.
import { type Actor, CHANGE_LOG_CHANNEL, type ChangeLogRow, type InvalidationResource } from '@agentic-crm/realtime';
import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';

export const CHANGE_LOG_COLUMNS = `c.id::text AS id, c.workspace_id::text AS workspace_id, c.resource,
  c.resource_id::text AS resource_id, c.scope, c.actor, c.audience, c.created_at`;

export interface ChangeLogDbRow {
  id: string;
  workspace_id: string;
  resource: string;
  resource_id: string | null;
  scope: unknown;
  actor: unknown;
  audience: unknown;
  created_at: Date;
}

function normaliseAudience(value: unknown): ChangeLogRow['audience'] {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const record = value as { userIds?: unknown; user_ids?: unknown };
    const ids = record.userIds ?? record.user_ids;
    if (Array.isArray(ids)) return { userIds: ids.filter((id): id is string => typeof id === 'string') };
  }
  // Malformed audience: fail closed (nobody), never fall back to "the whole workspace".
  return { userIds: [] };
}

export function toChangeLogRow(row: ChangeLogDbRow): ChangeLogRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    resource: row.resource as InvalidationResource,
    resourceId: row.resource_id,
    scope: typeof row.scope === 'object' && row.scope !== null ? (row.scope as Record<string, unknown>) : {},
    actor: (row.actor as Actor | null) ?? null,
    audience: normaliseAudience(row.audience),
    createdAt: row.created_at.toISOString(),
  };
}

const POLL_SQL = `SELECT ${CHANGE_LOG_COLUMNS} FROM change_log c WHERE c.id > $1::bigint ORDER BY c.id LIMIT $2`;

/**
 * Transactions that may still own an invisible change_log id: holders of a write lock on change_log in this
 * database (readers only take AccessShareLock and never allocate ids). pg_locks includes fast-path locks and
 * prepared transactions.
 */
const WRITERS_SQL = `
  SELECT DISTINCT l.virtualtransaction AS vxid
    FROM pg_locks l
   WHERE l.locktype = 'relation'
     AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
     AND l.relation = 'change_log'::regclass
     AND l.mode <> 'AccessShareLock'`;

interface Gap {
  from: bigint;
  to: bigint;
  since: number;
  /** Virtual transaction ids writing change_log when the gap was examined after its grace period. */
  holders: Set<string> | null;
  /** All holders had ended before the current poll's snapshot was taken. */
  cleared: boolean;
  dead: boolean;
}

export interface ChangeFeedOptions {
  pool: pg.Pool;
  connectionString: string;
  log: FastifyBaseLogger;
  pollIntervalMs: number;
  bootLookback: number;
  gapGraceMs: number;
  batchSize?: number;
  onRows: (rows: ChangeLogRow[]) => void;
}

const noop = () => {};

export class ChangeFeed {
  private frontier = 0n;
  private scannedUpTo = 0n;
  private readonly delivered = new Set<bigint>();
  private gaps: Gap[] = [];
  private ready = false;
  private stopped = false;
  private warnedMissingTable = false;
  private polling: Promise<void> | null = null;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private listener: pg.Client | null = null;
  private listenerAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly batchSize: number;

  constructor(private readonly options: ChangeFeedOptions) {
    this.batchSize = options.batchSize ?? 500;
  }

  /** Resume cursor: every change_log id <= cursor has been emitted (or never committed). */
  get cursor(): string {
    return this.frontier.toString();
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isListening(): boolean {
    return this.listener !== null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.timer = setInterval(() => void this.poll(), this.options.pollIntervalMs);
    this.timer.unref();
    await this.connectListener();
    await this.poll();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      listener.removeAllListeners();
      listener.on('error', noop);
      await listener.end().catch(noop);
    }
    await this.polling?.catch(noop);
  }

  /** Reads newly visible rows. Concurrent calls coalesce; the returned promise settles after the catch-up. */
  poll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.polling) {
      this.dirty = true;
      return this.polling;
    }
    this.polling = (async () => {
      try {
        do {
          this.dirty = false;
          if (!this.ready && !(await this.init())) return;
          // A full batch means more rows may be waiting, but only if the frontier moved: while it is held at an
          // unresolved gap every batch re-reads the same rows, and looping would spin until the gap resolves.
          const before = this.frontier;
          if ((await this.pollOnce()) && this.frontier > before) this.dirty = true;
        } while (this.dirty && !this.stopped);
      } catch (err) {
        if ((err as { code?: string }).code === '42P01') this.ready = false; // change_log dropped (test resets)
        this.options.log.error({ err }, 'realtime change feed poll failed');
      } finally {
        this.polling = null;
      }
    })();
    return this.polling;
  }

  private async init(): Promise<boolean> {
    const { pool, log, bootLookback } = this.options;
    const present = await pool.query<{ present: boolean }>(`SELECT to_regclass('change_log') IS NOT NULL AS present`);
    if (!present.rows[0]?.present) {
      if (!this.warnedMissingTable) {
        log.warn('realtime: change_log table does not exist yet; invalidations start once it is migrated');
        this.warnedMissingTable = true;
      }
      return false;
    }
    const { rows } = await pool.query<{ last: string }>(
      `SELECT coalesce(pg_sequence_last_value(pg_get_serial_sequence('change_log', 'id')::regclass), 0)::text AS last`,
    );
    const last = BigInt(rows[0]?.last ?? '0');
    // Start a little behind the sequence so rows still in flight at boot are emitted when they commit.
    const lookback = BigInt(bootLookback);
    this.frontier = last > lookback ? last - lookback : 0n;
    this.scannedUpTo = this.frontier;
    this.delivered.clear();
    this.gaps = [];
    this.ready = true;
    log.info({ cursor: this.cursor }, 'realtime change feed ready');
    return true;
  }

  /** Current writers of change_log (see WRITERS_SQL). */
  private async writers(): Promise<Set<string>> {
    const { rows } = await this.options.pool.query<{ vxid: string }>(WRITERS_SQL);
    return new Set(rows.map((r) => r.vxid));
  }

  /** One batch. Returns true when the batch was full (more rows may be waiting). */
  private async pollOnce(): Promise<boolean> {
    // Before this poll's snapshot: which examined gaps have lost all their potential owners?
    const watched = this.gaps.filter((g) => !g.dead && g.holders !== null && !g.cleared);
    if (watched.length > 0) {
      const live = await this.writers();
      for (const gap of watched) {
        if (![...(gap.holders as Set<string>)].some((vxid) => live.has(vxid))) gap.cleared = true;
      }
    }
    const { rows } = await this.options.pool.query<ChangeLogDbRow>(POLL_SQL, [
      this.frontier.toString(),
      this.batchSize,
    ]);
    const now = Date.now();
    const fresh: ChangeLogRow[] = [];
    let expected = this.frontier + 1n;
    let lastId = this.frontier;
    for (const row of rows) {
      const id = BigInt(row.id);
      if (id > expected) this.addGap(expected, id - 1n, now);
      if (!this.delivered.has(id)) {
        this.delivered.add(id);
        fresh.push(toChangeLogRow(row));
      }
      expected = id + 1n;
      lastId = id;
      if (id > this.scannedUpTo) this.scannedUpTo = id;
    }
    const full = rows.length >= this.batchSize;
    // Visibility of a gap id is only known if this snapshot's batch reached it.
    const checkedUpTo = full ? lastId : this.scannedUpTo;
    let examine = false;
    for (const gap of this.gaps) {
      if (gap.dead || gap.to > checkedUpTo) continue;
      // Holders ended before this snapshot was taken and the ids are still invisible: never committed.
      if (gap.cleared) gap.dead = true;
      else if (gap.holders === null && now - gap.since >= this.options.gapGraceMs) examine = true;
    }
    if (examine) {
      // After the snapshot that saw the gaps: any transaction still owning one of their ids is among these.
      const holders = await this.writers();
      for (const gap of this.gaps) {
        if (gap.dead || gap.holders !== null || gap.to > checkedUpTo) continue;
        if (now - gap.since >= this.options.gapGraceMs) gap.holders = holders;
      }
    }
    if (fresh.length > 0) {
      try {
        this.options.onRows(fresh);
      } catch (err) {
        this.options.log.error({ err }, 'realtime change feed consumer failed');
      }
    }
    this.advanceFrontier();
    return full;
  }

  private addGap(from: bigint, to: bigint, now: number): void {
    const start = from > this.scannedUpTo ? from : this.scannedUpTo + 1n;
    if (start > to) return;
    this.gaps.push({ from: start, to, since: now, holders: null, cleared: false, dead: false });
  }

  private advanceFrontier(): void {
    for (;;) {
      const next = this.frontier + 1n;
      if (this.delivered.delete(next)) {
        this.frontier = next;
        continue;
      }
      const gap = this.gaps.find((g) => next >= g.from && next <= g.to);
      if (gap?.dead) {
        this.frontier = next;
        continue;
      }
      break;
    }
    if (this.gaps.length > 0) this.gaps = this.gaps.filter((g) => g.to > this.frontier);
  }

  private async connectListener(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({
      connectionString: this.options.connectionString,
      application_name: 'agentic-crm-realtime-listen',
    });
    let failed = false;
    const fail = (err?: unknown) => {
      if (failed) return;
      failed = true;
      if (err) this.options.log.warn({ err }, 'realtime LISTEN connection lost');
      if (this.listener === client) this.listener = null;
      client.removeAllListeners();
      client.on('error', noop);
      client.end().catch(noop);
      this.scheduleListenerReconnect();
    };
    client.on('notification', (message) => {
      if (message.channel === CHANGE_LOG_CHANNEL) void this.poll();
    });
    client.on('error', fail);
    client.on('end', () => fail());
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANGE_LOG_CHANNEL}`);
      if (this.stopped) {
        fail();
        return;
      }
      this.listener = client;
      this.listenerAttempts = 0;
      void this.poll(); // catch up on anything committed while we were not listening
    } catch (err) {
      fail(err);
    }
  }

  private scheduleListenerReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** this.listenerAttempts);
    this.listenerAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectListener();
    }, delay);
    this.reconnectTimer.unref();
  }
}
