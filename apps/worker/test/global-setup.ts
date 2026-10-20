// Recreates the suite database and applies all migrations (pg-boss installs its own schema on start).
import { migrateUp } from '@agentic-crm/db';
import pg from 'pg';
import { databaseUrl, TEST_DATABASE } from './env.ts';

const DOCUMENTS_DDL = `
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, doc_type text NOT NULL, parent_ref text, yjs_state bytea,
  blocks jsonb, markdown text, search_text text, version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON documents
    USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO agentic_crm_app;
`;

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
