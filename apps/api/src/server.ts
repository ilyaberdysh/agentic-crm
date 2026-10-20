// Entry point: `pnpm --filter @agentic-crm/api dev` (tsx watch) / `start`.
import { buildApp } from './app';

const { app, config } = await buildApp();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    app.log.error('graceful shutdown timed out; exiting');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  force.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled rejection');
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
