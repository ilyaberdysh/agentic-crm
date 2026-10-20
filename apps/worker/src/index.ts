// @agentic-crm/worker: pg-boss workers (imports, exports). `pnpm --filter @agentic-crm/worker dev` (tsx watch) / `start`.
// Env: DATABASE_URL, S3_* (packages/config), LOG_LEVEL (debug|info|warn|error), WORKER_CONCURRENCY,
// WORKER_HEALTH_INTERVAL_MS, WORKER_SHUTDOWN_TIMEOUT_MS.
import { config } from '@agentic-crm/config';
import { createLogger, type LogLevel } from './log.ts';
import { startWorker } from './worker.ts';

const log = createLogger((process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info');
const int = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const worker = await startWorker({
  databaseUrl: config.databaseUrl,
  log,
  concurrency: int('WORKER_CONCURRENCY', 2),
  healthIntervalMs: int('WORKER_HEALTH_INTERVAL_MS', 60_000),
  shutdownTimeoutMs: int('WORKER_SHUTDOWN_TIMEOUT_MS', 30_000),
}).catch((err: unknown) => {
  log.error('worker failed to start', { err });
  process.exit(1);
});

let exiting = false;
async function shutdown(signal: string): Promise<void> {
  if (exiting) return;
  exiting = true;
  log.info('shutting down', { signal });
  const force = setTimeout(() => {
    log.error('graceful shutdown timed out; exiting');
    process.exit(1);
  }, int('WORKER_SHUTDOWN_TIMEOUT_MS', 30_000) + 10_000);
  force.unref();
  try {
    await worker.stop();
    process.exit(0);
  } catch (err) {
    log.error('error during shutdown', { err });
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { err: reason }));
