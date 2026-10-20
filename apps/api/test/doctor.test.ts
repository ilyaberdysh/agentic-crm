import { describe, expect, it } from 'vitest';
import { checkConfiguration, type DoctorConfig, runDoctor } from '../src/cli/doctor.ts';

const developmentConfig: DoctorConfig = {
  databaseUrl: 'postgres://agentic_crm:agentic_crm@127.0.0.1:5450/agentic_crm',
  authSecret: 'dev-only-secret-change-me-0123456789abcdef',
  isProduction: false,
  google: {},
  s3: {
    endpoint: 'http://127.0.0.1:8333',
    bucket: 'agentic-crm',
    accessKeyId: 'dev',
    secretAccessKey: 'dev',
  },
};

describe('self-hosting doctor', () => {
  it('accepts supported Node and reachable services when migrations are current', async () => {
    const checks = await runDoctor({
      nodeVersion: 'v24.11.0',
      configuration: developmentConfig,
      postgres: async () => {},
      migrations: async () => ({ missing: [], changed: [] }),
      s3: async () => {},
    });

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.map((check) => check.name)).toEqual([
      'Node.js',
      'Configuration',
      'PostgreSQL',
      'Migrations',
      'S3 endpoint',
    ]);
  });

  it('reports unsupported runtime, production defaults, service failures, and migration drift without secrets', async () => {
    const secret = 'private-database-password';
    const unsafeConfig: DoctorConfig = {
      ...developmentConfig,
      databaseUrl: `postgres://admin:${secret}@db.internal:5432/crm`,
      isProduction: true,
    };
    const checks = await runDoctor({
      nodeVersion: 'v22.0.0',
      configuration: unsafeConfig,
      postgres: async () => {
        throw new Error(`connection failed: ${secret}`);
      },
      migrations: async () => ({ missing: ['0100_tenancy.sql'], changed: ['0010_auth.sql'] }),
      s3: async () => {
        throw new Error('connection failed');
      },
    });

    expect(checks.map((check) => check.ok)).toEqual([false, false, false, false, false]);
    expect(checks.find((check) => check.name === 'Migrations')?.detail).toContain('checksum mismatch');
    expect(checks.map((check) => check.detail).join(' ')).not.toContain(secret);
  });

  it('rejects malformed service URLs without echoing values', () => {
    const check = checkConfiguration({
      ...developmentConfig,
      databaseUrl: 'not-a-url-with-credentials',
      s3: { ...developmentConfig.s3, endpoint: 'file:///private/path' },
      google: { clientId: 'configured' },
      encryptionKey: 'too-short',
    });

    expect(check.ok).toBe(false);
    expect(check.detail).toContain('DATABASE_URL must be a PostgreSQL URL');
    expect(check.detail).toContain('S3_ENDPOINT must be an HTTP(S) URL');
    expect(check.detail).toContain('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
    expect(check.detail).toContain('AGENTIC_CRM_ENCRYPTION_KEY must encode exactly 32 bytes');
    expect(check.detail).not.toContain('private/path');
  });
});
