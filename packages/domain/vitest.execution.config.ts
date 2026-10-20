import { defineConfig } from 'vitest/config';

// Local process fixtures need no database, provider credentials, or application configuration.
export default defineConfig({ test: { include: ['test/ai-execution.test.ts'], testTimeout: 10_000 } });
