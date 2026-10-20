import { fileURLToPath } from 'node:url';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), vanillaExtractPlugin()],
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: { port: 5174, strictPort: true },
});
