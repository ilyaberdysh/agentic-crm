import { pathToFileURL } from 'node:url';
import { config } from '@agentic-crm/config';
import { inspectMigrations } from '@agentic-crm/db';
import pg from 'pg';

const DEFAULT_DATABASE_URL = 'postgres://agentic_crm:agentic_crm@127.0.0.1:5450/agentic_crm';
const DEFAULT_AUTH_SECRET = 'dev-only-secret-change-me-0123456789abcdef';
const MIN_NODE_VERSION = { major: 24, minor: 11 };

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorConfig {
  databaseUrl: string;
  authSecret: string;
  isProduction: boolean;
  s3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  google: { clientId?: string; clientSecret?: string };
  encryptionKey?: string;
}

export interface DoctorProbes {
  nodeVersion?: string;
  configuration?: DoctorConfig;
  postgres?: (connectionString: string) => Promise<void>;
  migrations?: (connectionString: string) => Promise<{ missing: string[]; changed: string[] }>;
  s3?: (endpoint: string) => Promise<void>;
}

function supportedNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > MIN_NODE_VERSION.major || (major === MIN_NODE_VERSION.major && minor >= MIN_NODE_VERSION.minor);
}

function validUrl(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validEncryptionKey(value: string): boolean {
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return false;
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length === 32;
}

export function checkConfiguration(value: DoctorConfig): DoctorCheck {
  const issues: string[] = [];
  if (!value.databaseUrl.trim() || !validUrl(value.databaseUrl, ['postgres:', 'postgresql:'])) {
    issues.push('DATABASE_URL must be a PostgreSQL URL');
  }
  if (!value.authSecret.trim()) issues.push('AUTH_SECRET is missing');
  if (!value.s3.endpoint.trim() || !validUrl(value.s3.endpoint, ['http:', 'https:'])) {
    issues.push('S3_ENDPOINT must be an HTTP(S) URL');
  }
  if (!value.s3.bucket.trim()) issues.push('S3_BUCKET is missing');
  if (!value.s3.accessKeyId.trim() || !value.s3.secretAccessKey.trim()) {
    issues.push('S3 credentials are missing');
  }
  const hasGoogleClientId = Boolean(value.google.clientId?.trim());
  const hasGoogleClientSecret = Boolean(value.google.clientSecret?.trim());
  if (hasGoogleClientId !== hasGoogleClientSecret)
    issues.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
  if (value.encryptionKey && !validEncryptionKey(value.encryptionKey)) {
    issues.push('AGENTIC_CRM_ENCRYPTION_KEY must encode exactly 32 bytes');
  }

  if (value.isProduction) {
    if (value.databaseUrl === DEFAULT_DATABASE_URL)
      issues.push('DATABASE_URL still uses the local development default');
    if (value.authSecret === DEFAULT_AUTH_SECRET || value.authSecret.length < 32) {
      issues.push('AUTH_SECRET must be a non-default secret of at least 32 characters');
    }
    if (value.s3.endpoint === 'http://127.0.0.1:8333')
      issues.push('S3_ENDPOINT still uses the local development default');
    if (value.s3.accessKeyId === 'dev' || value.s3.secretAccessKey === 'dev') {
      issues.push('S3 credentials still use development defaults');
    }
    if (!value.encryptionKey)
      issues.push('AGENTIC_CRM_ENCRYPTION_KEY is required in production for encrypted provider credentials');
  }

  return issues.length
    ? { name: 'Configuration', ok: false, detail: `${issues.join('; ')}. Review .env or the service environment.` }
    : { name: 'Configuration', ok: true, detail: 'required database, auth, and S3 settings are present and valid' };
}

async function postgresProbe(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

async function s3Probe(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
  // S3 commonly returns 403 at its root for an unsigned request; an HTTP response still proves endpoint reachability.
  void response.status;
}

function shortNames(names: string[]): string {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown}, and ${names.length - 3} more` : shown;
}

export async function runDoctor(probes: DoctorProbes = {}): Promise<DoctorCheck[]> {
  const nodeVersion = probes.nodeVersion ?? process.version;
  const runtime = probes.configuration ?? {
    databaseUrl: config.databaseUrl,
    authSecret: config.authSecret,
    isProduction: config.isProduction,
    s3: config.s3,
    google: config.google,
    encryptionKey: config.encryptionKey,
  };
  const checks: DoctorCheck[] = [
    {
      name: 'Node.js',
      ok: supportedNodeVersion(nodeVersion),
      detail: supportedNodeVersion(nodeVersion)
        ? `${nodeVersion} (requires 24.11 or newer)`
        : `${nodeVersion} found; install Node.js 24.11 or newer`,
    },
    checkConfiguration(runtime),
  ];

  try {
    await (probes.postgres ?? postgresProbe)(runtime.databaseUrl);
    checks.push({ name: 'PostgreSQL', ok: true, detail: 'connection and read-only query succeeded' });
  } catch {
    checks.push({
      name: 'PostgreSQL',
      ok: false,
      detail: 'unreachable; verify DATABASE_URL, credentials, network access, and that PostgreSQL is running',
    });
  }

  try {
    const status = await (probes.migrations ?? inspectMigrations)(runtime.databaseUrl);
    const issues = [
      status.missing.length ? `${status.missing.length} unapplied (${shortNames(status.missing)})` : '',
      status.changed.length ? `${status.changed.length} checksum mismatch (${shortNames(status.changed)})` : '',
    ].filter(Boolean);
    checks.push(
      issues.length
        ? {
            name: 'Migrations',
            ok: false,
            detail: `${issues.join('; ')}. Run pnpm db:migrate after reviewing migration history.`,
          }
        : { name: 'Migrations', ok: true, detail: 'all committed migrations are applied with matching checksums' },
    );
  } catch {
    checks.push({
      name: 'Migrations',
      ok: false,
      detail: 'could not inspect migration history; verify PostgreSQL access and schema_migrations permissions',
    });
  }

  try {
    await (probes.s3 ?? s3Probe)(runtime.s3.endpoint);
    checks.push({ name: 'S3 endpoint', ok: true, detail: 'HTTP endpoint responded to a read-only HEAD request' });
  } catch {
    checks.push({
      name: 'S3 endpoint',
      ok: false,
      detail: 'unreachable; verify S3_ENDPOINT, network access, and that the S3-compatible service is running',
    });
  }
  return checks;
}

export async function main(): Promise<void> {
  const checks = await runDoctor();
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
