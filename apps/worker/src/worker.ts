// The pg-boss worker (ARCHITECTURE D-10). Consumes the queues the domain enqueues into transactionally:
//   import.run  {workspaceId, jobId}     → domain.imports.execute (plan if needed, then resumable batches)
//   export.run  {workspaceId, exportId}  → domain.exports.execute (snapshot → CSV → S3)
//   notifications.email (cron, every minute)  → pending notification emails marked skipped until slice 7
//   webhooks (poll loop, every second)          → committed domain events → signed deliveries with back-off (B.28)
//   email.sync  {workspaceId, mailboxId}       → domain.email.syncMailbox (cursor per page; re-queues if cut short)
//   email.sync-poll (cron, every 2 minutes)   → queue email.sync for every active Gmail mailbox (no push yet; 7b)
//   email.outbox {workspaceId?} (+ cron, every minute) → domain.email.outbox.deliverDue (all workspaces when omitted)
//   interactions.connection-strength {workspaceId, records} → recompute connection strength of those records
//   interactions.refresh-due (cron, every 15 min) → next meetings that started move to "last"; daily strength decay
//   workflow.run  {workspaceId, runId}  → domain.workflows.engine.process (one transaction per block; delays re-enqueue)
//   workflow.tick (cron, every minute)  → due recurring schedules, overdue delayed continuations
//   workflow triggers (poll loop, every second) → committed trigger events → runs (B.28)
//   formula recompute (poll loop, every 250 ms) → committed value changes → dependent formulas (< 2 s, slice 10);
//     large batches → formula.recompute {workspaceId, attributeId, instanceIds}; formula.daily (cron) for now()
//   formula.generate {workspaceId, requestId} → AI formula composer request (last failure → request failed)
//   ai-attribute.run {workspaceId, runId, instanceIds} → AI autofill values (last failure → annotations error);
//     ai-attribute.sweep (cron, every minute) → values stuck queued / running end as errors (X-24)
//   calls.process {workspaceId, recordingId} → speakers, summaries, `completed`, call-recording.created (slice 10)
//   calls.generate {workspaceId, kind: insight|preview, id} → one call insight or template preview (slice 10)
// Retries with exponential backoff (QUEUE_OPTIONS); after the last attempt the import / export is marked failed and
// pg-boss copies the job to the dead-letter queue. Graceful shutdown: running imports stop between batches and
// re-queue a continuation; the process waits for in-flight handlers before closing pg-boss and the pool.
import { createDb, type Database } from '@agentic-crm/db';
import {
  ConnectorError,
  createDomain,
  DEAD_LETTER_QUEUE,
  type Domain,
  ensureQueues,
  type GoogleSettings,
  type HttpSender,
  ImportInterruptedError,
  JOB_NAMES,
  type LlmClient,
  type ObjectStorage,
  pgBossJobQueue,
  QUEUE_OPTIONS,
  systemContext,
  type WebhookSender,
} from '@agentic-crm/domain';
import { type JobWithMetadata, PgBoss } from 'pg-boss';
import { createLogger, type Logger } from './log.ts';

export interface WorkerOptions {
  databaseUrl: string;
  storage?: ObjectStorage;
  log?: Logger;
  /** Seconds between polls when idle (default 2). */
  pollingIntervalSeconds?: number;
  /** Concurrent jobs per queue in this process (default 2). */
  concurrency?: number;
  /** Health log interval (default 60 s; 0 = off). */
  healthIntervalMs?: number;
  /** Rows per import batch (default: the domain's). */
  importBatchSize?: number;
  /** How long stop() waits for in-flight jobs (default 30 s). */
  shutdownTimeoutMs?: number;
  /** Webhook fan-out + delivery poll interval (default 1000 ms; 0 = off). */
  webhookIntervalMs?: number;
  /** How webhook requests are sent (default fetch with a 5 s timeout). */
  webhookSender?: WebhookSender;
  /** Workflow trigger fan-out poll interval (default 1000 ms; 0 = off). */
  workflowIntervalMs?: number;
  /** Transport of the workflow "Send HTTP request" block (default fetch). */
  workflowHttp?: HttpSender;
  /** Formula recompute poll interval (default 250 ms; 0 = off). */
  formulaIntervalMs?: number;
  /** LLM for AI attributes and the formula composer (default: not configured); tests inject a fake. */
  /** LLM client of the AI jobs (default: Anthropic with ANTHROPIC_API_KEY, else unconfigured). Tests pass a fake. */
  llm?: LlmClient;
  /** Google connector settings (default: from the environment; null = not configured). Tests pass FakeGoogle's. */
  google?: GoogleSettings | null;
}

export interface QueueHealth {
  name: string;
  queued: number;
  active: number;
  failed: number;
}

export interface Worker {
  boss: PgBoss;
  domain: Domain;
  database: Database;
  /** Jobs this process is running now. */
  inFlight(): number;
  health(): Promise<{ queues: QueueHealth[]; inFlight: number; uptimeSeconds: number }>;
  stop(): Promise<void>;
}

interface ImportData {
  workspaceId: string;
  jobId: string;
}
interface ExportData {
  workspaceId: string;
  exportId: string;
}
interface SyncData {
  workspaceId: string;
  mailboxId: string;
}
interface OutboxData {
  workspaceId?: string;
}
interface StrengthData {
  workspaceId: string;
  records: { entityDefinitionId: string; entityInstanceId: string }[];
}
interface WorkflowRunData {
  workspaceId: string;
  runId: string;
}
interface FormulaRecomputeData {
  workspaceId: string;
  attributeId: string;
  instanceIds: string[];
}
interface FormulaGenerateData {
  workspaceId: string;
  requestId: string;
}
interface AiRunData {
  workspaceId: string;
  runId: string;
  instanceIds: string[];
}
interface CallProcessData {
  workspaceId: string;
  recordingId: string;
}
interface CallGenerateData {
  workspaceId: string;
  kind: 'insight' | 'preview';
  id: string;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Cron queue of the notification email channel (slice 5 stub). */
export const NOTIFICATION_EMAIL_QUEUE = 'notifications.email';
/** Cron queue that polls Gmail mailboxes (slice 7b: no Gmail watch / Calendar push notifications yet). */
export const EMAIL_SYNC_POLL_QUEUE = 'email.sync-poll';

/** The email channel stub: marks pending notification emails skipped and logs how many (slice 7 sends them). */
export async function drainNotificationEmails(domain: Domain, log: Logger): Promise<{ skipped: number }> {
  const result = await domain.notifications.drainEmailDeliveries();
  if (result.skipped > 0) {
    log.info('notification emails skipped: outbound email arrives with slice 7', { ...result });
  }
  return { skipped: result.skipped };
}

export async function startWorker(options: WorkerOptions): Promise<Worker> {
  const log = options.log ?? createLogger();
  const startedAt = Date.now();
  const database = createDb({ connectionString: options.databaseUrl, applicationName: 'agentic-crm-worker' });
  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    application_name: 'agentic-crm-worker-boss',
    instanceName: 'worker',
    max: 5,
  });
  boss.on('error', (err) => log.error('pg-boss error', { err }));
  boss.on('warning', (warning) => log.warn('pg-boss warning', { warning }));
  await boss.start();
  await ensureQueues(boss);
  const domain = createDomain({
    database,
    jobs: pgBossJobQueue(boss),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.webhookSender ? { webhookSender: options.webhookSender } : {}),
    ...(options.workflowHttp ? { workflowHttp: options.workflowHttp } : {}),
    ...(options.llm ? { llm: options.llm } : {}),
    ...(options.google !== undefined ? { google: options.google } : {}),
  });

  const shutdown = new AbortController();
  const running = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    running.add(p);
    p.finally(() => running.delete(p)).catch(() => {});
    return p;
  };
  const workOptions = {
    batchSize: 1,
    includeMetadata: true as const,
    pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
    localConcurrency: options.concurrency ?? 2,
  };

  await boss.work(JOB_NAMES.importRun, workOptions, async ([job]: JobWithMetadata<ImportData>[]) => {
    if (!job) return;
    const { workspaceId, jobId } = job.data;
    return track(
      (async () => {
        const signal = AbortSignal.any([job.signal, shutdown.signal]);
        const started = Date.now();
        try {
          const result = await domain.imports.execute(workspaceId, jobId, {
            signal,
            ...(options.importBatchSize ? { batchSize: options.importBatchSize } : {}),
          });
          log.info('import finished', { jobId, workspaceId, ...result, ms: Date.now() - started });
          return result;
        } catch (err) {
          if (err instanceof ImportInterruptedError) {
            // Shutdown between batches: hand the rest to the next worker without spending a retry.
            await boss.send(JOB_NAMES.importRun, job.data, { singletonKey: jobId, startAfter: 5 });
            log.info('import interrupted; continuation queued', { jobId, workspaceId });
            return { status: 'interrupted' };
          }
          const last = job.retryCount >= job.retryLimit;
          log.error('import failed', { jobId, workspaceId, attempt: job.retryCount + 1, final: last, err });
          if (last) await domain.imports.fail(workspaceId, jobId, message(err)).catch(() => {});
          throw err;
        }
      })(),
    );
  });

  await boss.work(JOB_NAMES.exportRun, workOptions, async ([job]: JobWithMetadata<ExportData>[]) => {
    if (!job) return;
    const { workspaceId, exportId } = job.data;
    return track(
      (async () => {
        const started = Date.now();
        try {
          const result = await domain.exports.execute(workspaceId, exportId);
          log.info('export finished', {
            exportId,
            workspaceId,
            status: result.status,
            rows: result.rowCount,
            ms: Date.now() - started,
          });
          return { status: result.status };
        } catch (err) {
          const last = job.retryCount >= job.retryLimit;
          log.error('export failed', { exportId, workspaceId, attempt: job.retryCount + 1, final: last, err });
          if (last) await domain.exports.fail(workspaceId, exportId).catch(() => {});
          throw err;
        }
      })(),
    );
  });

  // Notification emails (B.27): until slice 7 adds outbound email, pending email deliveries are marked skipped once a
  // minute (the in-app inbox is unaffected).
  await boss.createQueue(NOTIFICATION_EMAIL_QUEUE, { retryLimit: 2, expireInSeconds: 300 });
  await boss.schedule(NOTIFICATION_EMAIL_QUEUE, '* * * * *');
  await boss.work(NOTIFICATION_EMAIL_QUEUE, workOptions, async () => track(drainNotificationEmails(domain, log)));

  // Webhooks (slice 6): fan committed domain events out into deliveries, then attempt what is due. One pass at a
  // time per process; concurrent workers are safe (the fan-out cursor is locked, deliveries are leased).
  let webhookPass: Promise<unknown> | null = null;
  const pumpWebhooks = async () => {
    const fanned = await domain.webhooks.fanOut();
    let attempted = 0;
    for (;;) {
      const { attempted: n } = await domain.webhooks.deliverDue({ limit: 25 });
      attempted += n;
      if (n < 25 || shutdown.signal.aborted) break;
    }
    if (fanned.deliveries > 0 || attempted > 0) log.info('webhooks', { ...fanned, attempted });
  };
  const webhookInterval = options.webhookIntervalMs ?? 1000;
  const webhookTimer =
    webhookInterval > 0
      ? setInterval(() => {
          if (webhookPass || shutdown.signal.aborted) return;
          webhookPass = track(pumpWebhooks())
            .catch((err) => log.error('webhook pass failed', { err }))
            .finally(() => {
              webhookPass = null;
            });
        }, webhookInterval)
      : null;
  webhookTimer?.unref();
  // Slice 7: mailbox sync, outbox delivery, connection strength, interaction roll-forward.
  await boss.work(JOB_NAMES.emailSync, workOptions, async ([job]: JobWithMetadata<SyncData>[]) => {
    if (!job) return;
    const { workspaceId, mailboxId } = job.data;
    return track(
      (async () => {
        let result: Awaited<ReturnType<Domain['email']['syncMailbox']>>;
        try {
          result = await domain.email.syncMailbox(workspaceId, mailboxId);
        } catch (err) {
          // Retrying cannot fix these (e.g. a revoked Google grant: the mailbox now asks to be reconnected).
          if (err instanceof ConnectorError && !err.retryable) {
            log.warn('mailbox sync stopped', { workspaceId, mailboxId, code: err.code, message: err.message });
            return { stopped: err.code };
          }
          throw err;
        }
        if (result.messages + result.events + result.deleted > 0) {
          const { createdRecordIds: _created, ...summary } = result;
          log.info('mailbox synced', { workspaceId, ...summary });
        }
        return { messages: result.messages, events: result.events, complete: result.complete };
      })(),
    );
  });

  // Polled providers (Gmail): every 2 minutes each active mailbox gets a sync job (singleton per mailbox).
  await boss.createQueue(EMAIL_SYNC_POLL_QUEUE, { retryLimit: 0, expireInSeconds: 5 * 60 });
  await boss.schedule(EMAIL_SYNC_POLL_QUEUE, '*/2 * * * *');
  await boss.work(EMAIL_SYNC_POLL_QUEUE, workOptions, async () =>
    track(
      domain.email.queuePolledSyncs().then((r) => {
        if (r.queued > 0) log.debug('mailbox syncs queued', { ...r });
        return r;
      }),
    ),
  );

  await boss.work(JOB_NAMES.emailOutbox, workOptions, async ([job]: JobWithMetadata<OutboxData>[]) =>
    track(
      (async () => {
        const result = await domain.email.outbox.deliverDue(job?.data?.workspaceId);
        if (result.sent + result.failed + result.retried > 0) log.info('outbox delivered', { ...result });
        return result;
      })(),
    ),
  );
  await boss.schedule(JOB_NAMES.emailOutbox, '* * * * *');

  await boss.work(JOB_NAMES.connectionStrength, workOptions, async ([job]: JobWithMetadata<StrengthData>[]) => {
    if (!job) return;
    const { workspaceId, records } = job.data;
    return track(
      domain.interactions.recomputeConnectionStrength(systemContext(workspaceId, 'connection-strength'), records),
    );
  });

  await boss.work(JOB_NAMES.interactionsRefreshDue, workOptions, async () =>
    track(
      (async () => {
        const now = new Date();
        // Strength decays daily (once, in the 03:00 UTC run).
        const decay = now.getUTCHours() === 3 && now.getUTCMinutes() < 15;
        const workspaces = await database.kysely.selectFrom('workspaces').select('id').execute();
        let refreshed = 0;
        for (const ws of workspaces) {
          const result = await domain.interactions.refreshDue(systemContext(ws.id, 'interactions'), { decay });
          refreshed += result.refreshed;
        }
        if (refreshed > 0) log.info('interactions rolled forward', { refreshed, decay });
        return { refreshed };
      })(),
    ),
  );
  await boss.schedule(JOB_NAMES.interactionsRefreshDue, '*/15 * * * *');

  // Workflows (slice 8): runs execute block by block; a run waiting for a delay ends its job (the delayed job or the
  // tick resumes it); shutdown hands the rest of a run to the next worker.
  await boss.work(JOB_NAMES.workflowRun, workOptions, async ([job]: JobWithMetadata<WorkflowRunData>[]) => {
    if (!job) return;
    const { workspaceId, runId } = job.data;
    return track(
      (async () => {
        const started = Date.now();
        const signal = AbortSignal.any([job.signal, shutdown.signal]);
        try {
          const result = await domain.workflows.engine.process(workspaceId, runId, { signal });
          log.debug('workflow run step', { runId, workspaceId, ...result, ms: Date.now() - started });
          return result;
        } catch (err) {
          log.error('workflow run failed to execute', { runId, workspaceId, attempt: job.retryCount + 1, err });
          throw err;
        }
      })(),
    );
  });
  await boss.schedule(JOB_NAMES.workflowTick, '* * * * *');
  await boss.work(JOB_NAMES.workflowTick, workOptions, async () =>
    track(
      domain.workflows.engine.tick().then((result) => {
        if (result.scheduled > 0 || result.resumed > 0) log.info('workflow tick', { ...result });
        return result;
      }),
    ),
  );
  // Calls (slice 10): processing of imported recordings and insight / preview generation. Provider errors are
  // retried with back-off; the last attempt records the failure (the call still completes).
  await boss.work(JOB_NAMES.callProcess, workOptions, async ([job]: JobWithMetadata<CallProcessData>[]) => {
    if (!job) return;
    const { workspaceId, recordingId } = job.data;
    return track(
      (async () => {
        const final = job.retryCount >= job.retryLimit;
        try {
          const signal = AbortSignal.any([job.signal, shutdown.signal]);
          const result = await domain.calls.process(workspaceId, recordingId, { final, signal });
          if (result.status) log.info('call processed', { workspaceId, recordingId, summary: result.summaryStatus });
          return result;
        } catch (err) {
          log.error('call processing failed', { workspaceId, recordingId, attempt: job.retryCount + 1, final, err });
          throw err;
        }
      })(),
    );
  });
  await boss.work(JOB_NAMES.callGenerate, workOptions, async ([job]: JobWithMetadata<CallGenerateData>[]) => {
    if (!job) return;
    const { workspaceId, kind, id } = job.data;
    return track(
      (async () => {
        const final = job.retryCount >= job.retryLimit;
        try {
          const signal = AbortSignal.any([job.signal, shutdown.signal]);
          const status = await domain.calls.generate(workspaceId, kind, id, { final, signal });
          return { status };
        } catch (err) {
          log.error('call insight generation failed', {
            workspaceId,
            kind,
            id,
            attempt: job.retryCount + 1,
            final,
            err,
          });
          throw err;
        }
      })(),
    );
  });

  let workflowPass: Promise<unknown> | null = null;
  const workflowInterval = options.workflowIntervalMs ?? 1000;
  const workflowTimer =
    workflowInterval > 0
      ? setInterval(() => {
          if (workflowPass || shutdown.signal.aborted) return;
          workflowPass = track(domain.workflows.engine.fanOut())
            .then((result) => {
              if (result.runs > 0) log.info('workflow triggers', { ...result });
            })
            .catch((err) => log.error('workflow trigger pass failed', { err }))
            .finally(() => {
              workflowPass = null;
            });
        }, workflowInterval)
      : null;
  workflowTimer?.unref();

  // Slice 10: formula recompute (change_log subscription) and AI attribute jobs.
  let formulaPass: Promise<unknown> | null = null;
  const formulaInterval = options.formulaIntervalMs ?? 250;
  const formulaTimer =
    formulaInterval > 0
      ? setInterval(() => {
          if (formulaPass || shutdown.signal.aborted) return;
          formulaPass = track(domain.formulas.pump())
            .then((result) => {
              if (result.recomputed > 0 || result.enqueued > 0 || result.failed > 0)
                log.debug('formula recompute', { ...result });
              if (result.failed > 0) log.warn('formula recompute failures', { failed: result.failed });
            })
            .catch((err) => log.error('formula recompute pass failed', { err }))
            .finally(() => {
              formulaPass = null;
            });
        }, formulaInterval)
      : null;
  formulaTimer?.unref();
  await boss.work(JOB_NAMES.formulaRecompute, workOptions, async ([job]: JobWithMetadata<FormulaRecomputeData>[]) => {
    if (!job) return;
    return track(domain.formulas.recompute(job.data));
  });
  await boss.schedule(JOB_NAMES.formulaDaily, '5 0 * * *');
  await boss.work(JOB_NAMES.formulaDaily, workOptions, async () => track(domain.formulas.daily()));
  await boss.work(JOB_NAMES.formulaGenerate, workOptions, async ([job]: JobWithMetadata<FormulaGenerateData>[]) => {
    if (!job) return;
    return track(
      domain.formulas.processGeneration(job.data).catch(async (err) => {
        if (job.retryCount >= job.retryLimit) await domain.formulas.failGeneration(job.data).catch(() => {});
        log.error('formula generation failed', { requestId: job.data.requestId, err });
        throw err;
      }),
    );
  });
  await boss.work(JOB_NAMES.aiAttributeRun, workOptions, async ([job]: JobWithMetadata<AiRunData>[]) => {
    if (!job) return;
    return track(
      domain.aiAttributes.processBatch(job.data).catch(async (err) => {
        if (job.retryCount >= job.retryLimit) await domain.aiAttributes.failBatch(job.data).catch(() => {});
        log.error('AI attribute batch failed', { runId: job.data.runId, attempt: job.retryCount + 1, err });
        throw err;
      }),
    );
  });
  await boss.schedule(JOB_NAMES.aiAttributeSweep, '* * * * *');
  await boss.work(JOB_NAMES.aiAttributeSweep, workOptions, async () =>
    track(
      domain.aiAttributes.sweep().then((n) => {
        if (n > 0) log.warn('AI values stuck in queue ended as errors', { count: n });
        return { swept: n };
      }),
    ),
  );

  const names = [...Object.keys(QUEUE_OPTIONS), DEAD_LETTER_QUEUE];
  const health = async () => {
    const queues = await boss.getQueues(names);
    return {
      queues: queues.map((q) => ({
        name: q.name,
        queued: q.queuedCount,
        active: q.activeCount,
        failed: q.failedCount,
      })),
      inFlight: running.size,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  };
  const interval = options.healthIntervalMs ?? 60_000;
  const timer =
    interval > 0
      ? setInterval(() => {
          health()
            .then((h) => log.info('worker health', h))
            .catch((err) => log.warn('worker health check failed', { err }));
        }, interval)
      : null;
  timer?.unref();
  log.info('worker ready', { queues: names });

  let stopping: Promise<void> | null = null;
  return {
    boss,
    domain,
    database,
    inFlight: () => running.size,
    health,
    stop() {
      stopping ??= (async () => {
        log.info('worker stopping', { inFlight: running.size });
        if (timer) clearInterval(timer);
        if (webhookTimer) clearInterval(webhookTimer);
        if (workflowTimer) clearInterval(workflowTimer);
        if (formulaTimer) clearInterval(formulaTimer);
        shutdown.abort();
        const timeout = options.shutdownTimeoutMs ?? 30_000;
        await Promise.race([
          Promise.allSettled([...running]),
          new Promise((resolve) => setTimeout(resolve, timeout).unref()),
        ]);
        await boss.stop({ graceful: true, timeout, close: true });
        await database.destroy();
        log.info('worker stopped');
      })();
      return stopping;
    },
  };
}
