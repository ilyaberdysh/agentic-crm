// Runtime configuration. Defaults target the local docker compose stack (docker/compose.dev.yml).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Loads the checkout's `.env` (repo root) into process.env for keys the environment does not set already, so secrets
 * such as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / AGENTIC_CRM_ENCRYPTION_KEY take effect by being added there. Skipped in
 * tests (vitest, NODE_ENV=test: suites must not depend on a developer's secrets) and when AGENTIC_CRM_DOTENV=0.
 */
function loadDotEnv(): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test' || process.env.AGENTIC_CRM_DOTENV === '0') return;
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!existsSync(file)) return;
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
    }
  } catch {
    // An unreadable .env is ignored: the environment and the defaults below still apply.
  }
}
loadDotEnv();

const env = (k: string, d: string) => process.env[k] ?? d;
/** An optional value: unset and blank (`KEY=` in .env.example) both mean "not configured". */
const optional = (k: string): string | undefined => {
  const value = process.env[k]?.trim();
  return value ? value : undefined;
};

const apiPort = Number(env('API_PORT', '4100'));

export const config = {
  databaseUrl: env('DATABASE_URL', 'postgres://agentic_crm:agentic_crm@127.0.0.1:5450/agentic_crm'),
  apiPort,
  collabPort: Number(env('COLLAB_PORT', '4101')),
  webOrigin: env('WEB_ORIGIN', 'http://localhost:5173'),
  authSecret: env('AUTH_SECRET', 'dev-only-secret-change-me-0123456789abcdef'),
  isProduction: process.env.NODE_ENV === 'production',
  s3: {
    endpoint: env('S3_ENDPOINT', 'http://127.0.0.1:8333'),
    bucket: env('S3_BUCKET', 'agentic-crm'),
    accessKeyId: env('S3_ACCESS_KEY_ID', 'dev'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY', 'dev'),
    /** Origin browsers use for presigned URLs when it differs from S3_ENDPOINT (production: the web origin). */
    publicEndpoint: optional('S3_PUBLIC_ENDPOINT'),
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  /**
   * Key encrypting provider credentials at rest (AES-256-GCM): 32 bytes as 64 hex characters or base64. Required in
   * production once Google is configured; in dev a stable key is derived from AUTH_SECRET (with a warning).
   */
  encryptionKey: optional('AGENTIC_CRM_ENCRYPTION_KEY'),
  /** Google OAuth client (Internal Workspace app) for Gmail + Google Calendar (slice 7b). */
  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    /** Authorised redirect URI of the OAuth client; default: the API's browser-visible origin + the callback path. */
    redirectUri:
      optional('GOOGLE_REDIRECT_URI') ??
      `${(optional('API_PUBLIC_URL') ?? `http://localhost:${apiPort}`).replace(/\/+$/, '')}/api/integrations/google/callback`,
    /** Initial mail sync window in days (unset = every message that was not deleted, as Attio documents). */
    mailSyncDays: optional('GOOGLE_MAIL_SYNC_DAYS') ? Number(optional('GOOGLE_MAIL_SYNC_DAYS')) : undefined,
  },
} as const;

// ---- test databases ------------------------------------------------------------------------------------------------

const PREFIX_RE = /^[a-z_][a-z0-9_]{0,40}$/;

/**
 * Prefix of this checkout's test databases (CLAUDE.md: every suite has its own database, never the dev DB `agentic_crm`).
 * `AGENTIC_CRM_TEST_DB_PREFIX` wins. Otherwise the prefix is derived from the checkout's path: the main checkout and every
 * worktree share one Postgres container, and each suite's global setup drops and recreates its database, so a constant
 * default (`agentic_crm_test_api`) let two checkouts running `pnpm test` at the same time kill each other's connections
 * mid-run (the "intermittent" seed / auth-meta failures). Per checkout: `agentic_crm_test_<8 hex of the path>_<suite>`.
 */
export function testDatabasePrefix(): string {
  const fromEnv = process.env.AGENTIC_CRM_TEST_DB_PREFIX ?? '';
  if (PREFIX_RE.test(fromEnv)) return fromEnv;
  const checkout = fileURLToPath(new URL('../../..', import.meta.url));
  return `agentic_crm_test_${createHash('sha256').update(checkout).digest('hex').slice(0, 8)}_`;
}

/** `<prefix><suite>` (e.g. `agentic_crm_test_1a2b3c4d_api`). */
export function testDatabaseName(suite: string): string {
  return `${testDatabasePrefix()}${suite}`;
}

/** The connection URL of database `name` on the configured server. */
export function databaseUrlFor(name: string): string {
  const url = new URL(config.databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
