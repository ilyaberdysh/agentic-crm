// A focused, credential-free browser recording of the seeded Agent review flow.
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

const webServers = Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : undefined;

export default defineConfig({
  ...base,
  testMatch: 'demo-capture.spec.ts',
  outputDir: fileURLToPath(new URL('./.capture/', import.meta.url)),
  reporter: [['list']],
  webServer: webServers?.map((server, index) =>
    index === 0
      ? { ...server, env: { ...server.env, E2E_USER_EMAIL: 'demo@example.com', E2E_USER_NAME: 'Demo User' } }
      : server,
  ),
  use: {
    ...base.use,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
  },
});
