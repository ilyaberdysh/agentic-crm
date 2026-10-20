// Background jobs (ARCHITECTURE D-10: pg-boss with transactional enqueue). A domain service enqueues follow-up work
// inside its own transaction (I1): the job row is inserted on the transaction's connection, so it exists if and
// only if the data it refers to commits. apps/worker consumes the queues; apps/api only produces.
//
// pg-boss tables live in the `pgboss` schema, created by pg-boss itself on start (migrate). Domain transactions run
// as the RLS-scoped role agentic_crm_app, which has no grants there, so the insert runs as the owner role (Tx.asOwner).

import { DomainError } from '../errors.ts';
import type { Tx } from '../tx.ts';

/** Queue names. */
export const JOB_NAMES = {
  importRun: 'import.run',
  exportRun: 'export.run',
  // Slice 7: mailbox sync {workspaceId, mailboxId}, outbox delivery {workspaceId}, connection strength
  // {workspaceId, records}, interaction roll-forward (cron, no data).
  emailSync: 'email.sync',
  emailOutbox: 'email.outbox',
  connectionStrength: 'interactions.connection-strength',
  interactionsRefreshDue: 'interactions.refresh-due',
  /** Workflow run executor (slice 8): `{workspaceId, runId}`; delayed for Delay / Delay until continuations. */
  workflowRun: 'workflow.run',
  /** Minute tick (cron): due recurring schedules, overdue delayed continuations. */
  workflowTick: 'workflow.tick',
  // Slice 10: formula and AI attributes.
  /** Recompute a batch of one formula's records: `{workspaceId, attributeId, instanceIds}`. */
  formulaRecompute: 'formula.recompute',
  /** Daily (cron, 00:05 UTC): formulas using now() / today(). */
  formulaDaily: 'formula.daily',
  /** AI formula composer request: `{workspaceId, requestId}`. */
  formulaGenerate: 'formula.generate',
  /** AI autofill values of a run: `{workspaceId, runId, instanceIds}`. */
  aiAttributeRun: 'ai-attribute.run',
  /** Minute sweep (cron): AI values stuck in queued / running become errors (X-24). */
  aiAttributeSweep: 'ai-attribute.sweep',
  /** Slice 10: processing of an imported call recording `{workspaceId, recordingId}` (speakers, summaries). */
  callProcess: 'calls.process',
  /** Slice 10: one insight or template preview `{workspaceId, kind: 'insight'|'preview', id}`. */
  callGenerate: 'calls.generate',
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/** Dead-letter queue every queue copies terminally failed jobs to (inspected by operators, not consumed). */
export const DEAD_LETTER_QUEUE = 'jobs.dead-letter';

/**
 * Queue options, shared by producers and the worker (createQueue is idempotent). Imports and exports are resumable
 * (progress is committed per batch), so a retry continues where the previous attempt stopped.
 */
export const QUEUE_OPTIONS: Record<JobName, Record<string, unknown>> = {
  'import.run': {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 4 * 60 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  'export.run': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  // Sync is resumable (cursor committed per page) and idempotent (copies keyed by provider ids).
  'email.sync': {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 30 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  // Delivery state lives on the outbox rows (attempts, backoff); the job only drains due rows.
  'email.outbox': { retryLimit: 2, retryDelay: 30, expireInSeconds: 15 * 60, deadLetter: DEAD_LETTER_QUEUE },
  'interactions.connection-strength': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  'interactions.refresh-due': { retryLimit: 1, expireInSeconds: 15 * 60, deadLetter: DEAD_LETTER_QUEUE },
  // Each block executes in its own transaction and is recorded with it, so a retried job continues where it stopped.
  'workflow.run': {
    retryLimit: 5,
    retryDelay: 2,
    retryBackoff: true,
    retryDelayMax: 120,
    expireInSeconds: 30 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  'workflow.tick': { retryLimit: 0, expireInSeconds: 5 * 60 },
  // Recomputes are idempotent (unchanged values are not rewritten).
  'formula.recompute': {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  'formula.daily': { retryLimit: 1, expireInSeconds: 30 * 60 },
  'formula.generate': { retryLimit: 1, retryDelay: 2, expireInSeconds: 5 * 60, deadLetter: DEAD_LETTER_QUEUE },
  // Values already written are skipped on retry (annotation complete for the run); the last attempt marks errors.
  'ai-attribute.run': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  'ai-attribute.sweep': { retryLimit: 0, expireInSeconds: 5 * 60 },
  // LLM steps: transient provider errors retry with back-off; the last attempt records the failure (and still
  // completes the call, so the webhook fires).
  'calls.process': {
    retryLimit: 4,
    retryDelay: 15,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 15 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
  'calls.generate': {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 15 * 60,
    deadLetter: DEAD_LETTER_QUEUE,
  },
};

export interface JobSendOptions {
  /** pg-boss singleton key (dedupes queued jobs of the same key). */
  singletonKey?: string;
  /** Delay in seconds. */
  startAfterSeconds?: number;
}

export interface JobQueue {
  /** Enqueues inside the transaction of `tx`; returns the pg-boss job id. */
  send(tx: Tx, name: JobName, data: Record<string, unknown>, options?: JobSendOptions): Promise<string | null>;
}

/** The subset of a PgBoss instance the queue needs (keeps the domain free of a hard pg-boss import). */
export interface PgBossLike {
  send(name: string, data: object | null, options: Record<string, unknown>): Promise<string | null>;
}

/** pg-boss `IDatabase` over the caller's Kysely transaction. */
function txDatabase(tx: Tx) {
  return {
    async executeSql(text: string, values?: unknown[]): Promise<{ rows: any[] }> {
      const query = {
        sql: text,
        parameters: values ?? [],
        query: { kind: 'RawNode' },
        queryId: { queryId: 'pgboss' },
      } as unknown as Parameters<Tx['db']['executeQuery']>[0];
      const result = await tx.db.executeQuery(query);
      return { rows: [...result.rows] };
    },
  };
}

/** Transactional enqueue through a started PgBoss instance (the producer of apps/api, or the worker's own). */
export function pgBossJobQueue(boss: PgBossLike | (() => Promise<PgBossLike>)): JobQueue {
  return {
    async send(tx, name, data, options = {}) {
      const instance = typeof boss === 'function' ? await boss() : boss;
      return tx.asOwner(() =>
        instance.send(name, data, {
          ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
          ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
          db: txDatabase(tx),
        }),
      );
    },
  };
}

/** Default when a process wires no queue: enqueuing fails with 503 JOBS_UNAVAILABLE (the transaction rolls back). */
export const unavailableJobQueue: JobQueue = {
  async send() {
    throw new DomainError(503, 'JOBS_UNAVAILABLE', 'Background jobs are not available');
  },
};

/** Test double: records what was sent (regardless of commit). */
export class RecordingJobQueue implements JobQueue {
  readonly sent: { name: JobName; data: Record<string, unknown>; options: JobSendOptions }[] = [];

  async send(_tx: Tx, name: JobName, data: Record<string, unknown>, options: JobSendOptions = {}) {
    this.sent.push({ name, data, options });
    return `recorded-${this.sent.length}`;
  }

  take(name?: JobName) {
    const out = this.sent.filter((j) => name === undefined || j.name === name);
    for (const j of out) this.sent.splice(this.sent.indexOf(j), 1);
    return out;
  }
}

export interface JobProducer {
  queue: JobQueue;
  /** Stops the producer's pg-boss instance (if it was started). */
  stop(): Promise<void>;
}

/**
 * A producer-only pg-boss instance (no supervision, no cron, no workers) for processes that enqueue but do not
 * consume (apps/api). Started lazily on the first send, so processes that never enqueue never touch pg-boss.
 */
export function createJobProducer(options: { connectionString: string; applicationName?: string }): JobProducer {
  let started: Promise<PgBossLike & { stop(o?: object): Promise<void> }> | null = null;
  const start = () => {
    started ??= (async () => {
      const { PgBoss } = await import('pg-boss');
      const boss = new PgBoss({
        connectionString: options.connectionString,
        application_name: options.applicationName ?? 'agentic-crm-jobs-producer',
        supervise: false,
        schedule: false,
        migrate: true,
        max: 2,
        registerInstance: false,
      });
      boss.on('error', () => {
        // Connection errors surface on the next send; nothing to do for a producer.
      });
      await boss.start();
      await ensureQueues(boss);
      return boss as unknown as PgBossLike & { stop(o?: object): Promise<void> };
    })().catch((err) => {
      started = null;
      throw err;
    });
    return started;
  };
  return {
    queue: pgBossJobQueue(start),
    async stop() {
      if (!started) return;
      const boss = await started.catch(() => null);
      started = null;
      await boss?.stop({ graceful: false, close: true });
    },
  };
}

/** Creates the queues (idempotent) with QUEUE_OPTIONS and the dead-letter queue. */
export async function ensureQueues(boss: {
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
}): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE, { retentionSeconds: 14 * 24 * 3600 });
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) await boss.createQueue(name, options);
}
