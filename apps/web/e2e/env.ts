// Ports and database of the e2e stack: its own API and web dev server on non-default ports and its own database
// Test suites never use the dev DB `agentic_crm`. Parallel workstreams override these values per worktree with
// E2E_DATABASE / E2E_API_PORT / E2E_WEB_PORT.
export const E2E_DATABASE = process.env.E2E_DATABASE ?? 'agentic_crm_test_web_e2e';
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4110);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5183);
/** apps/collab (note bodies, Yjs); the web dev server proxies `/collab` to it. */
export const COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? 4111);
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const WORKSPACE_SLUG = 'mymeet';

/** Credentials file of a database in e2e/.auth (the default database keeps the historical name). */
export const credentialsFile = (database: string): string =>
  database === 'agentic_crm_test_web_e2e' ? 'credentials.json' : `credentials-${database}.json`;
export const E2E_USER = { email: 'e2e@mymeet.ai', name: 'Ada Tester' };

export function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL_BASE ?? 'postgres://agentic_crm:agentic_crm@127.0.0.1:5450/agentic_crm');
  url.pathname = `/${name}`;
  return url.toString();
}
