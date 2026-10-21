-- Stored targets carry routing metadata only. Provider secrets stay in provider_connections.
CREATE TABLE model_targets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  owner_kind text NOT NULL CHECK (owner_kind IN ('workspace', 'member')),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('cloud-api', 'runner-local')),
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openai-compatible')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  connection_id uuid,
  connection_version integer CHECK (connection_version > 0),
  runner_id uuid,
  endpoint text,
  features jsonb,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES provider_connections (workspace_id, id),
  CHECK (owner_kind <> 'workspace' OR owner_id = workspace_id),
  CHECK ((kind = 'cloud-api' AND provider IN ('anthropic', 'openai') AND connection_id IS NOT NULL
    AND connection_version IS NOT NULL AND runner_id IS NULL AND endpoint IS NULL AND features IS NULL)
    OR (kind = 'runner-local' AND provider = 'openai-compatible' AND owner_kind = 'member'
      AND connection_id IS NULL AND connection_version IS NULL AND runner_id IS NOT NULL
      AND endpoint IS NOT NULL AND jsonb_typeof(features) = 'object'))
);
CREATE INDEX model_targets_owner ON model_targets (workspace_id, owner_kind, owner_id, id);

CREATE FUNCTION guard_model_target_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
    (NEW.id, NEW.workspace_id, NEW.owner_kind, NEW.owner_id, NEW.created_by_member_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.owner_kind, OLD.owner_id, OLD.created_by_member_id, OLD.created_at)
  THEN RAISE EXCEPTION 'Model target identity is immutable' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND id = NEW.created_by_member_id)
    OR (NEW.owner_kind = 'member' AND NOT EXISTS (
      SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND id = NEW.owner_id))
  THEN RAISE EXCEPTION 'Model target member is outside its workspace' USING ERRCODE = '23514'; END IF;
  IF NEW.kind = 'cloud-api' AND NOT EXISTS (SELECT 1 FROM provider_connections c
      WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.connection_id AND c.provider = NEW.provider
        AND (c.owner_kind = 'workspace' OR (NEW.owner_kind = 'member' AND c.owner_id = NEW.owner_id)))
  THEN RAISE EXCEPTION 'Model target connection scope differs' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_target_scope BEFORE INSERT OR UPDATE ON model_targets
  FOR EACH ROW EXECUTE FUNCTION guard_model_target_scope();

-- Independent from the prepaid-credit ledger: externally billed/unknown price is never zero or a credit error.
CREATE TABLE model_invocations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  target_id uuid NOT NULL,
  target_version integer NOT NULL CHECK (target_version > 0),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openai-compatible')),
  model text NOT NULL,
  connection_id uuid,
  connection_version integer CHECK (connection_version > 0),
  runner_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'completed', 'failed', 'canceled')),
  failure_code text CHECK (failure_code IN ('not_configured', 'auth', 'rate_limit', 'context_limit', 'unsupported',
    'transient', 'invalid_response', 'canceled', 'provider')),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cache_read_tokens integer CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer CHECK (cache_write_tokens >= 0),
  cost_status text NOT NULL CHECK (cost_status IN ('known', 'unknown')),
  cost_reason text CHECK (cost_reason IN ('unknown_model_price', 'usage_unavailable')),
  micro_usd bigint CHECK (micro_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (workspace_id, target_id) REFERENCES model_targets (workspace_id, id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES provider_connections (workspace_id, id),
  CHECK ((cost_status = 'known' AND cost_reason IS NULL AND micro_usd IS NOT NULL)
    OR (cost_status = 'unknown' AND cost_reason IS NOT NULL AND micro_usd IS NULL)),
  CHECK ((outcome = 'pending' AND completed_at IS NULL) OR (outcome <> 'pending' AND completed_at IS NOT NULL)),
  CHECK ((connection_id IS NOT NULL AND connection_version IS NOT NULL AND runner_id IS NULL)
    OR (connection_id IS NULL AND connection_version IS NULL AND runner_id IS NOT NULL))
);
CREATE INDEX model_invocations_workspace_time ON model_invocations (workspace_id, created_at, id);
CREATE FUNCTION guard_model_invocation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND id = NEW.member_id)
  THEN RAISE EXCEPTION 'Invocation member is outside its workspace' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.outcome <> 'pending' OR
      (NEW.id, NEW.workspace_id, NEW.target_id, NEW.target_version, NEW.member_id, NEW.provider, NEW.model,
       NEW.connection_id, NEW.connection_version, NEW.runner_id, NEW.created_at) IS DISTINCT FROM
      (OLD.id, OLD.workspace_id, OLD.target_id, OLD.target_version, OLD.member_id, OLD.provider, OLD.model,
       OLD.connection_id, OLD.connection_version, OLD.runner_id, OLD.created_at))
  THEN RAISE EXCEPTION 'Invocation identity and completed usage are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_invocation_scope BEFORE INSERT OR UPDATE ON model_invocations
  FOR EACH ROW EXECUTE FUNCTION guard_model_invocation_scope();
ALTER TABLE model_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_targets
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE model_invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_invocations
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE DELETE ON model_targets, model_invocations FROM agentic_crm_app;
