import { defineConfig } from 'vitest/config';

// Local process fixtures need no database, provider credentials, or application configuration.
export default defineConfig({
  test: {
    include: ['test/ai-execution.test.ts', 'test/ai-container.test.ts', 'test/ai-container-live.test.ts'],
    testTimeout: 10_000,
  },
});
