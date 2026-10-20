import { defineConfig } from 'vitest/config';

// Inference contracts need neither a database nor credentials. Avoid the DB suite's global setup.
export default defineConfig({
  test: { include: ['test/ai-llm.test.ts', 'test/ai-inference.test.ts'] },
});
