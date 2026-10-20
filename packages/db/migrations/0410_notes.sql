-- Notes and note templates: headers only (BACKLOG 3.12, 3.14; specs E README §4.1–4.2, §5.1–5.2; decision B.10 in
-- research/architecture/decisions/slice3-contracts.md). The body of a note or template is a row of `documents`
-- (migration 0400_documents.sql, owned by apps/collab): Yjs state + `blocks` / `markdown` projections. Headers point
-- at their document by id (no foreign key: the documents table belongs to another area).
--
-- Actors on these cold tables are jsonb {type, id} (migration 0200 convention).
-- Delete is soft for audit and for restoring a deleted record's notes (decision X-22); users see it as permanent.

CREATE TABLE notes (
  id uuid PRIMARY KEY,                      -- note_id; client-minted on UI creates (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 1000), -- '' = untitled
  document_id uuid NOT NULL,                -- documents.id holding the body
  meeting_id uuid,                          -- "Link a meeting" (meetings arrive in slice 7)
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE INDEX notes_created ON notes (workspace_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX notes_document ON notes (document_id);

-- Parent records of a note. Attio has exactly one parent; we allow several (position 0 = the primary parent shown
-- in the breadcrumb and returned as the public `parent_record_id`).
CREATE TABLE note_records (
  note_id uuid NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  position int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, entity_instance_id)
);
CREATE INDEX note_records_record ON note_records (entity_instance_id, note_id);

CREATE TABLE note_templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 1000),
  header_title text NOT NULL DEFAULT '' CHECK (char_length(header_title) <= 1000), -- title given to notes made from it
  document_id uuid NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE INDEX note_templates_created ON note_templates (workspace_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notes
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE note_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON note_records
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE note_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON note_templates
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
