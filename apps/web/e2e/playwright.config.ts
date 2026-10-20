// E2E: starts its own API (fresh database `agentic_crm_test_web_e2e`, seeded), collab server, worker and web dev server,
// then drives Chromium.
//   pnpm --filter @agentic-crm/web e2e
// Ports and database are overridable (e2e/env.ts); E2E_REUSE=1 reuses servers already listening on those ports.
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { API_ORIGIN, API_PORT, COLLAB_PORT, databaseUrl, E2E_DATABASE, WEB_ORIGIN, WEB_PORT } from './env.ts';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  outputDir: './out/results',
  // One worker: tests share the seeded workspace and create workspaces of their own.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: WEB_ORIGIN,
    viewport: { width: 1512, height: 945 },
    deviceScaleFactor: 1,
    browserName: 'chromium',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/prepare.ts && pnpm --filter @agentic-crm/api start',
      cwd: webRoot,
      url: `${API_ORIGIN}/api/health`,
      env: {
        DATABASE_URL: databaseUrl(E2E_DATABASE),
        API_PORT: String(API_PORT),
        WEB_ORIGIN,
        LOG_LEVEL: 'warn',
        // AI features answer from the scripted scenarios of the deterministic fake (packages/domain src/ai/fixtures/e2e).
        AGENTIC_CRM_LLM: process.env.AGENTIC_CRM_LLM ?? 'fake',
        // The stack must not pick up the checkout's .env secrets (Google client, Anthropic key): deterministic e2e.
        AGENTIC_CRM_DOTENV: '0',
      },
      reuseExistingServer: process.env.E2E_REUSE === '1',
      timeout: 180_000,
      stdout: 'pipe',
    },
    {
      // Note bodies (slice 3): the collab server on the same database; started after the API prepared it.
      command: `node e2e/wait-for.ts ${API_ORIGIN}/api/health && pnpm --filter @agentic-crm/collab start`,
      cwd: webRoot,
      url: `http://127.0.0.1:${COLLAB_PORT}/health`,
      env: {
        DATABASE_URL: databaseUrl(E2E_DATABASE),
        COLLAB_PORT: String(COLLAB_PORT),
        WEB_ORIGIN,
        LOG_LEVEL: 'warn',
        AGENTIC_CRM_DOTENV: '0',
      },
      reuseExistingServer: process.env.E2E_REUSE === '1',
      timeout: 60_000,
    },
    {
      // CSV imports and view exports run in the worker (pg-boss, slice 4) on the same database; it has no HTTP
      // port, so the stack waits for its "worker ready" log line.
      command: `node e2e/wait-for.ts ${API_ORIGIN}/api/health && pnpm --filter @agentic-crm/worker start`,
      cwd: webRoot,
      env: {
        DATABASE_URL: databaseUrl(E2E_DATABASE),
        LOG_LEVEL: 'info',
        WORKER_HEALTH_INTERVAL_MS: '0',
        AGENTIC_CRM_DOTENV: '0',
        AGENTIC_CRM_LLM: process.env.AGENTIC_CRM_LLM ?? 'fake',
      },
      wait: { stdout: /worker ready/ },
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      cwd: webRoot,
      url: WEB_ORIGIN,
      env: { API_TARGET: API_ORIGIN, COLLAB_TARGET: `ws://127.0.0.1:${COLLAB_PORT}` },
      reuseExistingServer: process.env.E2E_REUSE === '1',
      timeout: 60_000,
    },
  ],
});
