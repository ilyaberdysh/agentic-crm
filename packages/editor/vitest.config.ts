import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vanillaExtractPlugin()],
  test: {
    // Model tests run in Node (as the server does); component tests opt into jsdom with a docblock.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
