import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: 'agentic-crm-api' });
}

/** Untyped Kysely over the shared pool for Better Auth's own tables; the typed schema belongs to packages/db. */
export function createKysely(pool: pg.Pool): Kysely<any> {
  return new Kysely({ dialect: new PostgresDialect({ pool }) });
}

/** Postgres error with its SQLSTATE `code` (node-postgres DatabaseError shape). */
export function isPgError(err: unknown): err is { code: string; constraint?: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((err as { code: string }).code) &&
    (err as { severity?: unknown }).severity !== undefined
  );
}
