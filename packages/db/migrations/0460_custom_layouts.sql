-- Record page layouts (BACKLOG 3.10; specs D README §2.8, §4.1, A README §4.11). One layout per object (multiple
-- layouts are deferred). The element tree (groups + elements, flat with parent ids, Attio's shape) is replaced as a
-- whole on save, so it is stored as one jsonb array; `version` increments on every save.

CREATE TABLE custom_layouts (
  id uuid PRIMARY KEY,                      -- custom_layout_id (the editor URL's configurationId)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  type text NOT NULL DEFAULT 'record-page' CHECK (type IN ('record-page')),
  title text NOT NULL DEFAULT 'Default',
  description text NOT NULL DEFAULT 'Default layout',
  sort_order text COLLATE "C" NOT NULL DEFAULT 'i',
  is_system_layout boolean NOT NULL DEFAULT true,
  elements jsonb NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb,
  archived_at timestamptz
);
CREATE UNIQUE INDEX custom_layouts_one_per_object ON custom_layouts (entity_definition_id, type)
  WHERE archived_at IS NULL;

ALTER TABLE custom_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_layouts
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
