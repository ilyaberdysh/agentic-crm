import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Modules that reach @agentic-crm/ui import vanilla-extract styles.
  plugins: [vanillaExtractPlugin()],
  test: {
    environment: 'node',
    // Component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
