-- A paired runner polls only its own encrypted local-model work. No prompt or response is stored in plaintext.
CREATE TABLE model_runner_dispatches (
  invocation_id uuid PRIMARY KEY REFERENCES model_invocations (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  runner_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_version integer NOT NULL CHECK (target_version > 0),
  encrypted_request jsonb,
  encrypted_response jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'settled')),
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((status = 'queued' AND encrypted_request IS NOT NULL AND encrypted_response IS NULL
      AND lease_expires_at IS NULL AND settled_at IS NULL)
    OR (status = 'leased' AND encrypted_request IS NOT NULL AND encrypted_response IS NULL
      AND lease_expires_at IS NOT NULL AND settled_at IS NULL)
    OR (status = 'settled' AND encrypted_request IS NULL AND lease_expires_at IS NULL AND settled_at IS NOT NULL))
);
CREATE INDEX model_runner_dispatches_claim ON model_runner_dispatches
  (workspace_id, runner_id, status, lease_expires_at, created_at);
CREATE FUNCTION guard_model_runner_dispatch_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM model_invocations i WHERE i.id = NEW.invocation_id
    AND i.workspace_id = NEW.workspace_id AND i.runner_id = NEW.runner_id
    AND i.target_id = NEW.target_id AND i.target_version = NEW.target_version)
  THEN RAISE EXCEPTION 'Runner dispatch does not match invocation' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND
    (NEW.invocation_id, NEW.workspace_id, NEW.runner_id, NEW.target_id, NEW.target_version, NEW.created_at)
      IS DISTINCT FROM
    (OLD.invocation_id, OLD.workspace_id, OLD.runner_id, OLD.target_id, OLD.target_version, OLD.created_at)
  THEN RAISE EXCEPTION 'Runner dispatch identity is immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_runner_dispatch_scope BEFORE INSERT OR UPDATE ON model_runner_dispatches
  FOR EACH ROW EXECUTE FUNCTION guard_model_runner_dispatch_scope();
ALTER TABLE model_runner_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_runner_dispatches
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE DELETE ON model_runner_dispatches FROM agentic_crm_app;
