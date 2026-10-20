-- Favorites and favorite folders (BACKLOG 3.17; specs B sidebar §6, A README §4.15, CROSS-DOMAIN B.18). Personal:
-- every row belongs to one workspace member. Ordering by rank (decision X-01, contracts rank.ts). Deleting a folder
-- deletes the favorites inside it (observed: B sidebar §6 "Delete folder").

CREATE TABLE favorite_directories (
  id uuid PRIMARY KEY,                      -- client-minted (PUT favorites-directories/{clientUuid})
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  sort_order text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX favorite_directories_member ON favorite_directories (member_id, sort_order);

CREATE TABLE favorites (
  id uuid PRIMARY KEY,                      -- client-minted (PUT favorites/{type}/{clientUuid})
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  favorite_type text NOT NULL CHECK (favorite_type IN (
    'record', 'entity-view', 'collection-view', 'note', 'note-template', 'email-template', 'message-template',
    'reporting-dashboard', 'report', 'workflow', 'sequence', 'call-recording', 'merlin-thread')),
  entity_definition_id uuid,                -- records and views: their object / list
  target_id uuid NOT NULL,                  -- record id, view id, note id, template id, …
  directory_id uuid REFERENCES favorite_directories (id) ON DELETE CASCADE, -- NULL = top level
  sort_order text COLLATE "C" NOT NULL,     -- rank among the siblings (top level mixes folders and favorites)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX favorites_target ON favorites (member_id, favorite_type, target_id);
CREATE INDEX favorites_member ON favorites (member_id, directory_id, sort_order);
CREATE INDEX favorites_target_any ON favorites (target_id);

ALTER TABLE favorite_directories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON favorite_directories
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON favorites
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
