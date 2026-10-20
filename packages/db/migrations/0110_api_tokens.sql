-- Workspace API tokens for the public REST API /v2 (BACKLOG 1.12; J workspace-admin §6 "Access tokens"; Attio docs
-- rest-api/guides/authentication). The secret is shown once at creation; only its SHA-256 is stored (secrets are
-- 256-bit random, so a fast hash is enough). Tokens are workspace-level, do not expire, and are revoked rather than
-- deleted so `api-token` actors on values and history stay resolvable.
--   id = the token's client_id / aud in GET /v2/self and the actor id of type `api-token`.

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  token_hash text NOT NULL,                 -- hex SHA-256 of the secret
  token_prefix text NOT NULL,               -- first characters of the secret, for display
  scopes text[] NOT NULL,                   -- '<resource>:<read|read-write>'
  token_level text NOT NULL DEFAULT 'workspace' CHECK (token_level IN ('workspace', 'user')),
  authorized_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX api_tokens_hash ON api_tokens (token_hash);
CREATE INDEX api_tokens_workspace ON api_tokens (workspace_id, created_at);

-- Authentication looks the hash up before the workspace is known; it runs as the owner role (cross-tenant by nature,
-- like the workspace picker). Everything else runs as agentic_crm_app inside the workspace.
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_tokens
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
