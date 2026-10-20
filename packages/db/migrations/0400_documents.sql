-- Rich-text documents (ARCHITECTURE D-09; research/architecture/decisions/slice3-contracts.md "Rich text").
-- One store for every rich-text body: notes, note templates, later email templates and insight-template sections.
-- The Yjs state persisted by apps/collab (Hocuspocus) is the source of truth; `blocks` (Attio's flat block model,
-- E editor.md §6), `markdown` (public API / AI) and `search_text` are projections written in the same transaction
-- as the state by the domain documents module (I1). Headers (notes, note_templates) point at their document with
-- `document_id`; the document points back at its owner with `parent_ref`, which governs access.

CREATE TABLE documents (
  id uuid PRIMARY KEY,                        -- UUIDv7
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  doc_type text NOT NULL CHECK (doc_type IN ('note', 'note-template', 'email-template', 'insight-section')),
  parent_ref uuid,                            -- owning header (note / template id); NULL = standalone workspace document
  yjs_state bytea,                            -- Y.encodeStateAsUpdate of the whole Y.Doc (fragment "default")
  blocks jsonb,                               -- flat blocks (packages/editor model, Block[]); NULL = never written
  markdown text,
  search_text text,                           -- block texts + image captions, one line per block
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED,
  version bigint NOT NULL DEFAULT 0,          -- +1 per persisted content change (change_log scope.version)
  created_by jsonb,                           -- actor {type, id}
  updated_by jsonb,                           -- actor of the last persisted change
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                      -- soft delete: collab refuses and disconnects
);
CREATE INDEX documents_parent ON documents (parent_ref) WHERE parent_ref IS NOT NULL;
CREATE INDEX documents_ws_type ON documents (workspace_id, doc_type, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX documents_search ON documents USING gin (search_vector) WHERE deleted_at IS NULL;
CREATE INDEX documents_search_trgm ON documents USING gin (search_text gin_trgm_ops) WHERE deleted_at IS NULL;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
