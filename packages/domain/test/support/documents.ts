// The `documents` table belongs to apps/collab (migration 0400_documents.sql, slice3-contracts.md decision B.10).
// Until that migration is on this branch, test databases get it here, exactly as the contract describes:
//   documents(id, workspace_id, doc_type, parent_ref, yjs_state bytea, blocks jsonb, markdown text, search_text,
//             version, updated_at …)
// IF NOT EXISTS: once 0400 is merged the migration's table wins and this is a no-op.
export const DOCUMENTS_DDL = `
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  doc_type text NOT NULL,
  parent_ref text,
  yjs_state bytea,
  blocks jsonb,
  markdown text,
  search_text text,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY tenant_isolation ON documents
    USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO agentic_crm_app;
`;
