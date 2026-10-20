-- W8: bounded record-follow-up dispatch queue. Business decisions and effects remain in domain/action services.
CREATE TABLE agentic_tasks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  module_id text NOT NULL CHECK (module_id = 'record-follow-up'),
  task_type text NOT NULL CHECK (task_type = 'record.follow_up'),
  action_id uuid,
  enqueue_digest text NOT NULL CHECK (enqueue_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED_TERMINAL', 'BLOCKED')),
  due_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  next_event text NOT NULL CHECK (length(btrim(next_event)) BETWEEN 1 AND 1000),
  lease_holder text CHECK (length(btrim(lease_holder)) BETWEEN 1 AND 200),
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, action_id) REFERENCES agentic_actions (workspace_id, id),
  CHECK ((status = 'LEASED') = (lease_holder IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status = 'LEASED' OR (lease_holder IS NULL AND lease_expires_at IS NULL)),
  CHECK ((status IN ('SUCCEEDED', 'FAILED_TERMINAL')) = (finished_at IS NOT NULL))
);
CREATE INDEX agentic_tasks_due ON agentic_tasks (workspace_id, due_at, id) WHERE status = 'QUEUED';
CREATE INDEX agentic_tasks_expired ON agentic_tasks (workspace_id, lease_expires_at, id) WHERE status = 'LEASED';
CREATE INDEX agentic_tasks_record ON agentic_tasks (workspace_id, entity_instance_id, created_at, id);

CREATE TABLE agentic_task_history (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  task_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  actor jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, task_id) REFERENCES agentic_tasks (workspace_id, id)
);
CREATE INDEX agentic_task_history_task ON agentic_task_history (workspace_id, task_id, created_at, id);
CREATE TRIGGER immutable_snapshot BEFORE UPDATE OR DELETE ON agentic_task_history
  FOR EACH ROW EXECUTE FUNCTION agentic_reject_snapshot_mutation();
REVOKE UPDATE, DELETE ON agentic_task_history FROM agentic_crm_app;

ALTER TABLE agentic_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agentic_tasks
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE agentic_task_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agentic_task_history
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
