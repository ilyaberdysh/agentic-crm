// Editor dev page (port 5175): two editors on one document for manual realtime checks, plus the Playwright e2e.
//   pnpm --filter @agentic-crm/editor dev       (needs the API on 4100 and collab on 4101: `pnpm dev`)
// Proxies: /api → API (Origin rewritten to the API's trusted web origin), /collab → collab WebSocket,
// /collab/dev/* → collab dev endpoints (session info, create a document).
import { fileURLToPath } from 'node:url';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const api = process.env.API_TARGET ?? `http://127.0.0.1:${process.env.API_PORT ?? '4100'}`;
const collab = process.env.COLLAB_TARGET ?? `http://127.0.0.1:${process.env.COLLAB_PORT ?? '4101'}`;
const apiWebOrigin = process.env.API_WEB_ORIGIN ?? 'http://localhost:5173';
const port = Number(process.env.EDITOR_DEV_PORT ?? 5175);

export default defineConfig({
  root,
  plugins: [react(), vanillaExtractPlugin()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: api,
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', apiWebOrigin);
          });
        },
      },
      '/collab/dev': { target: collab, rewrite: (path) => path.replace(/^\/collab/, '') },
      '/collab': { target: collab.replace(/^http/, 'ws'), ws: true },
    },
  },
});
