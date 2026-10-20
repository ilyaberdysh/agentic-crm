// @agentic-crm/collab runnable entry: Hocuspocus on COLLAB_PORT (default 4101) against DATABASE_URL.
//   pnpm --filter @agentic-crm/collab dev
// SIGTERM/SIGINT: persist pending documents, close connections, exit.
import { createDb } from '@agentic-crm/db';
import { createDomain } from '@agentic-crm/domain';
import { createLogger, loadCollabConfig } from './config.ts';
import { createCollabServer } from './server.ts';

const config = loadCollabConfig();
const log = createLogger(config.logLevel);
const database = createDb({ connectionString: config.databaseUrl, applicationName: 'agentic-crm-collab' });
const domain = createDomain({ database });
const collab = createCollabServer({ database, domain, config, log });

let stopping: Promise<void> | null = null;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return stopping;
  log.info('shutting down', { signal });
  stopping = (async () => {
    try {
      await collab.stop();
    } finally {
      await database.destroy().catch(() => {});
    }
  })();
  await stopping;
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

collab.start().catch((err: unknown) => {
  log.error('collab failed to start', { err: String(err) });
  process.exit(1);
});
