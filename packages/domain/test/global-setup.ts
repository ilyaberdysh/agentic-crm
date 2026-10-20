// Recreates the suite database agentic_crm_test_domain (CLAUDE.md: never the dev DB `agentic_crm`) and applies all migrations.
import { migrateUp } from '@agentic-crm/db';
import pg from 'pg';
import { DOCUMENTS_DDL } from './support/documents.ts';
import { databaseUrl, TEST_DATABASE } from './support/env.ts';

export default async function setup(): Promise<void> {
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
