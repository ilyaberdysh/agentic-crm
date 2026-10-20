-- Workflows (slice 8, modern only; G-workflows README §4, internal-api §3–6, runs §2; CROSS-DOMAIN B.20, B.28, B.14).
--
-- Storage: workflow → versions (exactly one draft, edited in place, plus immutable published versions) → blocks and
-- paths. Publishing copies the draft into a new immutable version with the same block ids; restore and discard fork a
-- version into a fresh draft. Activation writes the active version's triggers (event matching, action entry points)
-- and recurring schedules; deactivation removes them.
--
-- Runs: one row per run on an immutable version; frames (root attempt, retry attempts, loop iterations) group block
-- executions, which carry the evaluated inputs, outputs, cost and failure reason. The trigger fan-out reads
-- 'workflow-events' rows of change_log between the previous and the current snapshot xmin (as the webhook fan-out).

CREATE TABLE workflows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text,
  description text,
  ai_title text,
  ai_description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'paused')),
  is_transient boolean NOT NULL DEFAULT true,
  is_archived boolean NOT NULL DEFAULT false,
  draft_version_id uuid NOT NULL,
  active_version_id uuid,
  first_set_live_at timestamptz,
  last_published_at timestamptz,
  last_status_change_at timestamptz,
  last_run_failed_at timestamptz,
  timezone text,
  max_credits_per_run int NOT NULL DEFAULT 50,
  dismissed_cycle_warning boolean NOT NULL DEFAULT false,
  run_count int NOT NULL DEFAULT 0,             -- runs created so far = the last run sequence number
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX workflows_workspace ON workflows (workspace_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL REFERENCES workflows (id),
  type text NOT NULL CHECK (type IN ('draft', 'immutable')),
  base_version_id uuid,                         -- draft: the version it was forked from / last committed into
  restored_from_version_id uuid,                -- draft created by "Restore this version"
  published_at timestamptz,
  published_by jsonb,
  activation_status text CHECK (activation_status IN ('activating', 'completed', 'deactivated')),
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_versions_workflow ON workflow_versions (workflow_id, created_at);

CREATE TABLE workflow_blocks (
  version_id uuid NOT NULL REFERENCES workflow_versions (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL,
  block_type text NOT NULL CHECK (block_type IN ('trigger', 'step')),
  slug text NOT NULL,
  block_version int NOT NULL,
  description text,
  position jsonb NOT NULL DEFAULT '{"x": 0, "y": 0}',
  config jsonb NOT NULL DEFAULT '{"type": "object", "entries": {}}',
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, id)
);

CREATE TABLE workflow_paths (
  version_id uuid NOT NULL REFERENCES workflow_versions (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL,
  source_block_id uuid NOT NULL,
  source_outcome text NOT NULL,
  target_block_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, id),
  UNIQUE (version_id, source_block_id, source_outcome, target_block_id)
);

-- Triggers of active versions: event triggers (matched by the fan-out) and action triggers (entry points).
CREATE TABLE workflow_triggers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL REFERENCES workflows (id),
  version_id uuid NOT NULL REFERENCES workflow_versions (id),
  block_id uuid NOT NULL,
  slug text NOT NULL,
  entity_definition_id uuid,                    -- object or list of the trigger (null = any / none)
  attribute_id uuid,                            -- attribute filter (record / entry updated, attribute changed)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, block_id)
);
CREATE INDEX workflow_triggers_slug ON workflow_triggers (workspace_id, slug);

-- Recurring schedules of active versions; the worker's minute tick starts the due ones.
CREATE TABLE workflow_schedules (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL REFERENCES workflows (id),
  version_id uuid NOT NULL REFERENCES workflow_versions (id),
  block_id uuid NOT NULL,
  cron text NOT NULL,
  timezone text NOT NULL,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, block_id)
);
CREATE INDEX workflow_schedules_due ON workflow_schedules (next_run_at);

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL REFERENCES workflows (id),
  version_id uuid NOT NULL REFERENCES workflow_versions (id),
  sequence_number int NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'executing', 'completed', 'failed', 'canceled')),
  trigger_block_id uuid NOT NULL,
  trigger_slug text NOT NULL,
  trigger_payload jsonb NOT NULL,               -- {outcome, data}: the trigger's outputs
  cascade_depth int NOT NULL DEFAULT 1,         -- 1 = started by a member / schedule; +1 per workflow-caused event
  retried_from_run_id uuid,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,
  canceled_by jsonb,
  failure_reason text,
  error_message text,
  credits_used numeric NOT NULL DEFAULT 0,
  execution_count int NOT NULL DEFAULT 0,
  attempt_count int NOT NULL DEFAULT 1,
  UNIQUE (workflow_id, sequence_number)
);
CREATE INDEX workflow_runs_workflow ON workflow_runs (workflow_id, created_at DESC, id DESC);
CREATE INDEX workflow_runs_workspace ON workflow_runs (workspace_id, created_at);
CREATE INDEX workflow_runs_open ON workflow_runs (status) WHERE status IN ('queued', 'executing');

CREATE TABLE workflow_run_frames (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  run_id uuid NOT NULL REFERENCES workflow_runs (id),
  parent_frame_id uuid,
  type text NOT NULL CHECK (type IN ('root', 'retry', 'loop-iteration')),
  attempt int NOT NULL,
  status text NOT NULL DEFAULT 'executing' CHECK (status IN ('executing', 'completed', 'failed', 'canceled')),
  loop_execution_id uuid,
  iteration int,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX workflow_run_frames_run ON workflow_run_frames (run_id, created_at);

CREATE TABLE workflow_block_executions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  run_id uuid NOT NULL REFERENCES workflow_runs (id),
  frame_id uuid NOT NULL REFERENCES workflow_run_frames (id),
  block_id uuid NOT NULL,
  slug text NOT NULL,
  parent_execution_id uuid,                     -- the upstream execution that led here
  seq bigint GENERATED ALWAYS AS IDENTITY,      -- execution order
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'executing', 'delayed', 'completed', 'failed', 'canceled')),
  outcome text,
  inputs jsonb,                                 -- evaluated config
  outputs jsonb,
  output_types jsonb,
  state jsonb,                                  -- loop bookkeeping (items, index)
  cost numeric,
  cost_is_final boolean,
  failure_reason text,
  error_message text,
  resume_at timestamptz,                        -- delayed executions continue at this instant
  attempt int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz
);
CREATE INDEX workflow_block_executions_run ON workflow_block_executions (run_id, seq);
CREATE INDEX workflow_block_executions_delayed ON workflow_block_executions (resume_at) WHERE status = 'delayed';

-- Credits ledger (B.14): one row per charged block execution (failed blocks are not charged).
CREATE TABLE workflow_credit_usage (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  type text NOT NULL DEFAULT 'workflow-block-execution',
  amount numeric NOT NULL,
  workflow_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_credit_usage_ws ON workflow_credit_usage (workspace_id, created_at);

-- "Get notified when this workflow fails" (runs §6).
CREATE TABLE workflow_notification_subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL REFERENCES workflows (id),
  member_id uuid NOT NULL,
  subscription_type text NOT NULL DEFAULT 'workflow-run-failure' CHECK (subscription_type IN ('workflow-run-failure')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, member_id, subscription_type)
);

-- Round robin rotation per workflow block (block ids are stable across versions).
CREATE TABLE workflow_round_robin_state (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL,
  block_id uuid NOT NULL,
  last_member_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, block_id)
);

-- Broadcast messages and celebrations sent by workflows (clients fetch them on the invalidation, I4).
CREATE TABLE workflow_broadcasts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  workflow_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('toast', 'celebration')),
  payload jsonb NOT NULL,
  recipient_member_ids uuid[],                  -- null = every member
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_broadcasts_ws ON workflow_broadcasts (workspace_id, created_at);

-- Trigger fan-out cursor (one row, owner role only).
CREATE TABLE workflow_trigger_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  xid_cursor xid8 NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workflow_trigger_state (id, xid_cursor) VALUES (1, pg_snapshot_xmin(pg_current_snapshot()));
REVOKE ALL ON workflow_trigger_state FROM agentic_crm_app;

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflows
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_versions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_blocks
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_paths ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_paths
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_triggers
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_schedules
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_runs
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_run_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_run_frames
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_block_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_block_executions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_credit_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_credit_usage
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_notification_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_notification_subscriptions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_round_robin_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_round_robin_state
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workflow_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_broadcasts
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
