// Attribute registry e2e (features/attributes): visual review frames of the dev gallery against  and the
// optimistic write path against a real API. Same stack as playwright.config.ts, scoped to attributes-*.spec.ts:
// E2E_DATABASE=agentic_crm_test_s2cells E2E_API_PORT=4110 E2E_WEB_PORT=5180 \
// pnpm --filter @agentic-crm/web exec playwright test -c e2e/attributes.config.ts
// E2E_NO_API=1 starts (or reuses) only the web dev server: enough for the visual review frames, which use fixtures.
import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

const [api, web] = Array.isArray(base.webServer) ? base.webServer : [];
const noApi = process.env.E2E_NO_API === '1';
// The web dev server holds no state: an already running one (same port) is reused.
const webServer = web ? [{ ...web, reuseExistingServer: true }] : [];

export default defineConfig({
  ...base,
  testMatch: noApi ? ['attributes-parity.spec.ts'] : ['attributes-*.spec.ts'],
  timeout: 60_000,
  webServer: noApi || !api ? webServer : [api, ...webServer],
});
