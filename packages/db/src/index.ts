// @agentic-crm/db: Kysely schema, migrations, RLS (see ../migrations) and the connection factory.
import { config } from '@agentic-crm/config';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB, Json } from './schema.ts';

export { type Kysely, type Selectable, sql, type Transaction, type Updateable } from 'kysely';
export {
  inspectMigrations,
  type MigrationInspection,
  type MigrationResult,
  migrateReset,
  migrateUp,
} from './migrate.ts';
export * from './schema.ts';
export * from './schema-ai.ts';
export * from './schema-calls.ts';
export * from './schema-collab.ts';
export * from './schema-email.ts';
export * from './schema-formulas.ts';
export * from './schema-imports.ts';
export * from './schema-lists.ts';
export * from './schema-model-gateway.ts';
export * from './schema-reports.ts';
export * from './schema-slice5.ts';
export * from './schema-slice6.ts';
export * from './schema-workflows.ts';

const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_DATE = 1082;

/**
 * '2026-10-10 12:00:00.1234+00' → '2026-10-10T12:00:00.123400Z' (sessions run with TimeZone=UTC). The fraction is
 * always 6 digits, so ISO strings of the same instant are identical and compare chronologically as strings.
 */
export function pgTimestampToIso(raw: string): string {
  const utc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:\+00(?::00)?)?$/.exec(raw);
  if (utc) return `${utc[1]}T${utc[2]}.${(utc[3] ?? '').padEnd(6, '0')}Z`;
  if (raw === 'infinity' || raw === '-infinity') return raw;
  return new Date(raw).toISOString().replace('Z', '000Z');
}

const isoTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === OID_TIMESTAMPTZ || oid === OID_TIMESTAMP) return pgTimestampToIso;
    if (oid === OID_DATE) return (raw: string) => raw;
    return (pg.types.getTypeParser as any)(oid, format);
  },
};

/**
 * Value for a jsonb column. pg serialises JS arrays as Postgres array literals, so every jsonb write goes through
 * JSON text (SQL NULL for null/undefined).
 */
export function jsonb(value: unknown): Json {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export interface Database {
  kysely: Kysely<DB>;
  pool: pg.Pool;
  destroy(): Promise<void>;
}

export interface CreateDbOptions {
  connectionString?: string;
  max?: number;
  /** Application name visible in pg_stat_activity. */
  applicationName?: string;
}

/**
 * Creates a pg pool + Kysely instance with the conventions documented in schema.ts (UTC sessions, ISO timestamp
 * strings with microsecond precision, dates as 'YYYY-MM-DD'). The overrides apply to this pool only.
 */
export function createDb(options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString ?? config.databaseUrl,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'agentic-crm',
    options: '-c TimeZone=UTC',
    types: isoTypes,
  });
  const kysely = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    kysely,
    pool,
    async destroy() {
      await kysely.destroy();
    },
  };
}
