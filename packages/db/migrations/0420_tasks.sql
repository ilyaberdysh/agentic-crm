-- Tasks (BACKLOG 3.15; specs E README §2.6–2.7b, §3.3, §4.3; public API data-model-documented §5.2).
-- Content is plain text with positioned mentions (E README §4.3 `references` / `assignments` with start_position).
-- Deadlines follow decision X-09 (slice3-contracts.md): `deadline_at` + `deadline_has_time`; a date without a time is
-- stored as the end of that day (23:59:59.999) in the creator's time zone. Buckets (Today / This week / …) are
-- computed in the viewer's time zone at query time.

CREATE TABLE tasks (
  id uuid PRIMARY KEY,                      -- task_id; client-minted on UI creates (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  mentions jsonb NOT NULL DEFAULT '[]',     -- [{start, length, kind: 'record'|'workspace-member', …}]
  mentioned_member_ids uuid[] NOT NULL DEFAULT '{}', -- for mention notifications (slice 5)
  deadline_at timestamptz,
  deadline_has_time boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by jsonb,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE INDEX tasks_open_deadline ON tasks (workspace_id, deadline_at) WHERE deleted_at IS NULL AND completed_at IS NULL;
CREATE INDEX tasks_created ON tasks (workspace_id, created_at) WHERE deleted_at IS NULL;

-- Linked records ("Add record" chip and record mentions in the content); position = display order.
CREATE TABLE task_records (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  position int NOT NULL,
  PRIMARY KEY (task_id, entity_instance_id)
);
CREATE INDEX task_records_record ON task_records (entity_instance_id, task_id);

-- Assignees are workspace members only (E README §2.7; public API: "Only workspace members").
CREATE TABLE task_assignees (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  position int NOT NULL,
  PRIMARY KEY (task_id, member_id)
);
CREATE INDEX task_assignees_member ON task_assignees (member_id, task_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tasks
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE task_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_records
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_assignees
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
