-- Comments, threads and reactions (BACKLOG 3.16; specs E README §2.8, §3.5, §4.4; public API data-model-documented
-- §5.3). Threads are one level deep: a thread root has thread_id = id, replies point at the root. Comments target a
-- record or a list entry (both are entity instances; for entries entity_definition_id is the list's definition).
-- Content is plain text with positioned mentions and Bold / Italic / Link styles (E README §3.5); no edit.

CREATE TABLE comments (
  id uuid PRIMARY KEY,                      -- comment_header_id; client-minted on UI creates (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  thread_id uuid NOT NULL,                  -- = id for a thread root
  target_kind text NOT NULL CHECK (target_kind IN ('record', 'list-entry')),
  entity_definition_id uuid NOT NULL,       -- the object (records) or the list (entries)
  entity_instance_id uuid NOT NULL,         -- the record or the entry
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  mentions jsonb NOT NULL DEFAULT '[]',
  styles jsonb NOT NULL DEFAULT '[]',
  mentioned_member_ids uuid[] NOT NULL DEFAULT '{}', -- for mention notifications (slice 5)
  resolved_at timestamptz,                  -- thread roots only
  resolved_by jsonb,
  author jsonb NOT NULL,                    -- public `author` (an API token may write on behalf of a member)
  created_by jsonb NOT NULL,                -- the actor that made the request ("via API" when it differs)
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE INDEX comments_target ON comments (entity_instance_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX comments_thread ON comments (thread_id, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX comments_definition_roots ON comments (entity_definition_id, created_at DESC)
  WHERE deleted_at IS NULL AND id = thread_id;

-- Reactions: one row per (comment, emoji, member); clicking your own chip removes it (E README §2.8).
CREATE TABLE comment_reactions (
  id uuid PRIMARY KEY,                      -- client-minted (PUT …/reactions/{clientUuid})
  workspace_id uuid NOT NULL,
  comment_id uuid NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 32),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, emoji, member_id)
);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comments
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comment_reactions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
