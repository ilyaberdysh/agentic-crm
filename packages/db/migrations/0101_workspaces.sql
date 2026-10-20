-- Workspaces, members and invites (BACKLOG 1.03, 1.04; specs K legacy-welcome §6.5/§9, J workspace-admin §3.2,
-- J permissions §1). Members reference the auth identity `users.id` (migration 0010, owned by apps/api).
-- apps/api's workspace resolver reads workspaces(id, slug, name, logo_url) and
-- workspace_members(id, workspace_id, user_id, access_level).

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  logo_url text,
  country_code text,
  settings jsonb NOT NULL DEFAULT '{}',
  onboarding_flags jsonb NOT NULL DEFAULT '{}',
  created_by_user_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX workspaces_slug ON workspaces (slug);

-- id = workspace member id: the public `workspace_member_id`, the actor id of type `workspace-member`, and the
-- entity instance id of the member's record in the workspace-member entity definition.
CREATE TABLE workspace_members (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id uuid NOT NULL REFERENCES users (id),
  access_level text NOT NULL CHECK (access_level IN ('admin', 'member', 'suspended')),
  -- profile copy taken at join time (source of truth: auth user); mirrored into the member record values
  email_address text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members (user_id);

CREATE TABLE workspace_invites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  email_address text NOT NULL, -- normalised (trimmed, lower-case)
  access_level text NOT NULL CHECK (access_level IN ('admin', 'member')),
  first_name text,
  last_name text,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_member_id uuid,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX workspace_invites_pending ON workspace_invites (workspace_id, email_address)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invites_email ON workspace_invites (email_address)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces
  USING (id = app_workspace_id()) WITH CHECK (id = app_workspace_id());

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_members
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_invites
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
