-- Lists (BACKLOG 4.01–4.06; specs A §4.4, C2 README §2.1/§2.7/§4, J objects-lists §4, J permissions §2–3).
-- A list = a collection row (name, icon, sidebar rank, parent-object allowlist) + an entity definition of
-- entity_type 'collection-entry' with the SAME id (A §4.4). Entries are entity instances of that definition with the
-- system attribute parent_record; list attributes, values, history, projections, views and snapshots reuse the data
-- engine (migrations 0200/0300). Deleting a list is a soft delete (deleted_at; entries archived like records, X-22).

CREATE TABLE collections (
  id uuid PRIMARY KEY REFERENCES entity_definitions (id), -- = the collection-entry definition's id
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  icon text,                                              -- 'emoji:<shortname>' (C2 §2.2); NULL = default 📋
  sort_order text COLLATE "C" NOT NULL,                   -- sidebar rank (X-01)
  parent_entity_definition_ids uuid[] NOT NULL,           -- allowlist of parent objects (public parent_object)
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE INDEX collections_rank ON collections (workspace_id, sort_order) WHERE deleted_at IS NULL;

-- Access grants per entity definition (J permissions §3: {target_type, target_id, scope}; A §4.12). Slice 4 resolves
-- them for lists (collection-entry definitions): effective access = the most permissive of the workspace grant and the
-- member's own grant (teams arrive with slice 6). Exactly one workspace grant per list (target_id = workspace id).
CREATE TABLE entity_definition_permissions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  target_type text NOT NULL CHECK (target_type IN ('workspace', 'team', 'workspace-member', 'workflow')),
  target_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('full-access', 'read-write', 'read-only', 'no-access')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_definition_id, target_type, target_id)
);
CREATE INDEX entity_definition_permissions_target ON entity_definition_permissions (target_type, target_id);

-- Kanban stage visibility per view (C2 kanban K3 "Hide stage" / K4 "Visible columns"; Attio's
-- kanban-stage-characteristic rows reduced to the set of hidden stage ids). Collapsed stages are client-only.
ALTER TABLE entity_views ADD COLUMN kanban_hidden_stage_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON collections
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_definition_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_definition_permissions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
