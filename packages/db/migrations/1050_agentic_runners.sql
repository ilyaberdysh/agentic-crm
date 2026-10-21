-- Paired, outbound-only runners. Secrets are returned once and only SHA-256 digests are retained.
CREATE TABLE agentic_runner_enrollments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (member_id) REFERENCES workspace_members (id)
);

CREATE TABLE agentic_runners (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  bearer_hash text NOT NULL CHECK (bearer_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (member_id) REFERENCES workspace_members (id)
);

-- This is display/routing metadata. CLI login files and API credentials remain on the runner host.
CREATE TABLE agentic_runner_auth_profiles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  runner_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('codex', 'claude', 'gemini')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, runner_id) REFERENCES agentic_runners (workspace_id, id)
);

-- A grant is usable only while its exact task lease generation remains live.
CREATE TABLE agentic_runner_grants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  runner_id uuid NOT NULL,
  task_id uuid NOT NULL,
  action_id uuid NOT NULL,
  lease_generation bigint NOT NULL CHECK (lease_generation > 0),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, runner_id, task_id, lease_generation),
  FOREIGN KEY (workspace_id, runner_id) REFERENCES agentic_runners (workspace_id, id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES agentic_tasks (workspace_id, id),
  FOREIGN KEY (workspace_id, action_id) REFERENCES agentic_actions (workspace_id, id)
);
CREATE INDEX agentic_runner_grants_task ON agentic_runner_grants (workspace_id, task_id, lease_generation);

ALTER TABLE agentic_runner_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agentic_runner_enrollments USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE agentic_runners ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agentic_runners USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE agentic_runner_auth_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agentic_runner_auth_profiles USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE agentic_runner_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agentic_runner_grants USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
