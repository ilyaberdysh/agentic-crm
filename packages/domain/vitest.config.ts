import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Every test creates its own workspace, so files can share the suite database agentic_crm_test_domain.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
