// Ports and files of the editor e2e stack (own ports so it can run next to `pnpm dev` and the web e2e).
import { fileURLToPath } from 'node:url';

export const API_PORT = Number(process.env.E2E_API_PORT ?? 4152);
export const COLLAB_PORT = Number(process.env.COLLAB_TEST_PORT ?? 4151);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5185);
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const STATE_FILE = fileURLToPath(new URL('./.auth/state.json', import.meta.url));
