-- W3: bounded cloud API-key connections. No endpoint, runner, routing, or reveal-secret surface.
-- A workspace connection belongs to the workspace; a member connection belongs only to that member.
CREATE TABLE provider_connections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  owner_kind text NOT NULL CHECK (owner_kind IN ('workspace', 'member')),
  owner_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  encrypted_credentials jsonb NOT NULL CHECK (
    jsonb_typeof(encrypted_credentials) = 'object' AND
    encrypted_credentials @> '{"v":1,"alg":"A256GCM"}'::jsonb AND
    encrypted_credentials ?& ARRAY['kid', 'iv', 'tag', 'data']
  ),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  disabled_at timestamptz,
  UNIQUE (workspace_id, id),
  CHECK ((enabled AND disabled_at IS NULL) OR (NOT enabled AND disabled_at IS NOT NULL)),
  CHECK (owner_kind <> 'workspace' OR owner_id = workspace_id)
);
CREATE INDEX provider_connections_owner ON provider_connections (workspace_id, owner_kind, owner_id, id);

-- Validate member ownership in the same tenant without adding a new constraint to the member table. Identity
-- fields cannot change: the encrypted payload is authenticated against all of them, and rotation keeps identity.
CREATE FUNCTION guard_provider_connection_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
    (NEW.id, NEW.workspace_id, NEW.owner_kind, NEW.owner_id, NEW.provider, NEW.created_by_member_id, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.workspace_id, OLD.owner_kind, OLD.owner_id, OLD.provider, OLD.created_by_member_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Provider connection identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND id = NEW.created_by_member_id)
    OR (NEW.owner_kind = 'member' AND NOT EXISTS (
      SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND id = NEW.owner_id
    ))
  THEN
    RAISE EXCEPTION 'Provider connection member is outside its workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER provider_connection_scope BEFORE INSERT OR UPDATE ON provider_connections
  FOR EACH ROW EXECUTE FUNCTION guard_provider_connection_scope();

-- Credential history records operations and versions only. No key, suffix, ciphertext, or submitted metadata.
CREATE TABLE provider_connection_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  connection_id uuid NOT NULL,
  connection_version integer NOT NULL CHECK (connection_version > 0),
  kind text NOT NULL CHECK (kind IN ('created', 'rotated', 'disabled')),
  actor_member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES provider_connections (workspace_id, id),
  UNIQUE (connection_id, connection_version)
);

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_connections
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE provider_connection_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_connection_events
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
REVOKE DELETE ON provider_connections FROM agentic_crm_app;
REVOKE UPDATE, DELETE ON provider_connection_events FROM agentic_crm_app;
