import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/ai-openai-compatible.test.ts'] },
});
