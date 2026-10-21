import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API origin the dev server proxies to (e2e runs its own API on another port).
const api = process.env.API_TARGET ?? `http://127.0.0.1:${process.env.API_PORT ?? '4100'}`;
// The collab server (Hocuspocus, apps/collab): the note editor connects to ws(s)://<web origin>/collab.
const collab = process.env.COLLAB_TARGET ?? `ws://127.0.0.1:${process.env.COLLAB_PORT ?? '4101'}`;

export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],
  server: {
    port: 5173,
    // Playwright writes traces and visual examples under e2e/out: they must not reload the page under test.
    watch: { ignored: ['**/e2e/out/**', '**/e2e/.auth/**'] },
    proxy: {
      '/trpc': api,
      '/api': api,
      '/v2': api,
      '/realtime': { target: api.replace(/^http/, 'ws'), ws: true },
      '/collab': { target: collab, ws: true },
    },
  },
});
