// Editor e2e: two browsers editing one document through the real collab server, plus parity screenshots against
// research/evidence/E. Starts its own backend (apps/collab/scripts/e2e-stack.ts: fresh database, API on 4152,
// collab on 4151) and the editor dev page (Vite on 5185).
//   pnpm --filter @agentic-crm/editor e2e          (E2E_REUSE=1 reuses servers already listening)
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { API_PORT, COLLAB_PORT, STATE_FILE, WEB_ORIGIN, WEB_PORT } from './env.ts';

const editorRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  outputDir: './out/results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
      command: 'pnpm --filter @agentic-crm/collab exec tsx scripts/e2e-stack.ts',
      cwd: editorRoot,
      url: `http://127.0.0.1:${COLLAB_PORT}/health`,
      env: {
        E2E_API_PORT: String(API_PORT),
        COLLAB_TEST_PORT: String(COLLAB_PORT),
        E2E_WEB_ORIGIN: WEB_ORIGIN,
        E2E_STATE_FILE: STATE_FILE,
      },
      reuseExistingServer: process.env.E2E_REUSE === '1',
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: 'pnpm exec vite --config dev/vite.config.ts',
      cwd: editorRoot,
      url: WEB_ORIGIN,
      env: {
        EDITOR_DEV_PORT: String(WEB_PORT),
        API_TARGET: `http://127.0.0.1:${API_PORT}`,
        COLLAB_TARGET: `http://127.0.0.1:${COLLAB_PORT}`,
        API_WEB_ORIGIN: WEB_ORIGIN,
      },
      reuseExistingServer: process.env.E2E_REUSE === '1',
      timeout: 60_000,
    },
  ],
});
