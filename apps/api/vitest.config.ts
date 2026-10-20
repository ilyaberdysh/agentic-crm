import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // All files share the suite database agentic_crm_test_api (and its change_log / LISTEN channel): run them serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
  },
});
