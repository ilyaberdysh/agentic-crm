// The api suite's own database (CLAUDE.md: never the dev DB `agentic_crm`), with every packages/db migration applied:
// procedures run against the real domain schema (RLS, projections, change_log).
import { databaseUrlFor, testDatabaseName } from '@agentic-crm/config';
import { migrateUp } from '@agentic-crm/db';
import pg from 'pg';
import { DOCUMENTS_DDL } from './documents';

/** Per checkout (or `AGENTIC_CRM_TEST_DB_PREFIX`): parallel checkouts sharing the Postgres container never share it. */
export const TEST_DATABASE = testDatabaseName('api');

export function databaseUrl(name = TEST_DATABASE): string {
  return databaseUrlFor(name);
}

export async function recreateTestDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
  await migrateUp(databaseUrl());
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    await db.query(DOCUMENTS_DDL);
  } finally {
    await db.end();
  }
}
