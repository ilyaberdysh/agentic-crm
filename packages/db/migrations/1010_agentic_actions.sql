-- W6: one record-scoped crm.task.create intent. No queue, retry, mutation, or compensation engine.
-- Snapshots, decisions and terminal receipts are append-only; mutable state uses CAS versions.
CREATE TABLE agentic_evidence (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX agentic_evidence_record ON agentic_evidence (workspace_id, entity_instance_id, created_at, id);

CREATE TABLE agentic_action_proposals (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  -- Canonical digest binds capability, exact subject/version, diff, evidence and policy snapshots, and reviewer.
  proposal jsonb NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX agentic_action_proposals_record
  ON agentic_action_proposals (workspace_id, entity_instance_id, created_at, id);

CREATE TABLE agentic_actions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  status text NOT NULL CHECK (status IN (
    'PROPOSED', 'APPROVED', 'REJECTED', 'STALE', 'EXECUTING', 'SUCCEEDED', 'FAILED_TERMINAL', 'OUTCOME_UNKNOWN'
  )),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, id) REFERENCES agentic_action_proposals (workspace_id, id)
);

CREATE TABLE agentic_action_decisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  action_id uuid NOT NULL,
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('APPROVE', 'REJECT')),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, action_id),
  UNIQUE (workspace_id, id, action_id),
  FOREIGN KEY (workspace_id, action_id) REFERENCES agentic_actions (workspace_id, id)
);

CREATE TABLE agentic_action_attempts (
  id uuid PRIMARY KEY, -- client/server-minted attempt id is the dispatch idempotency key
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  action_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('EXECUTING', 'SUCCEEDED', 'FAILED_TERMINAL', 'OUTCOME_UNKNOWN')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  executor jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, id, action_id),
  -- This bounded packet permits one dispatch only. Unknown outcomes cannot be retried.
  UNIQUE (workspace_id, action_id),
  FOREIGN KEY (workspace_id, action_id) REFERENCES agentic_actions (workspace_id, id),
  FOREIGN KEY (workspace_id, decision_id, action_id) REFERENCES agentic_action_decisions (workspace_id, id, action_id)
);

CREATE TABLE agentic_action_receipts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  action_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED_TERMINAL', 'OUTCOME_UNKNOWN')),
  result jsonb NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, action_id),
  UNIQUE (workspace_id, attempt_id),
  FOREIGN KEY (workspace_id, action_id) REFERENCES agentic_actions (workspace_id, id),
  FOREIGN KEY (workspace_id, attempt_id, action_id) REFERENCES agentic_action_attempts (workspace_id, id, action_id)
);

CREATE TABLE agentic_action_history (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  action_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  from_version integer NOT NULL,
  to_version integer NOT NULL CHECK (to_version = from_version + 1),
  actor jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, action_id, to_version),
  FOREIGN KEY (workspace_id, action_id) REFERENCES agentic_actions (workspace_id, id)
);

CREATE FUNCTION agentic_reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agentic snapshots are immutable' USING ERRCODE = '23514';
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agentic_evidence', 'agentic_action_proposals', 'agentic_actions', 'agentic_action_decisions',
    'agentic_action_attempts', 'agentic_action_receipts', 'agentic_action_history'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'agentic_evidence', 'agentic_action_proposals', 'agentic_action_decisions',
    'agentic_action_receipts', 'agentic_action_history'
  ] LOOP
    EXECUTE format('CREATE TRIGGER immutable_snapshot BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION agentic_reject_snapshot_mutation()', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM agentic_crm_app', t);
  END LOOP;
END
$$;
