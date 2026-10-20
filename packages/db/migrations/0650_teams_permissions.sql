-- Slice 6: teams, grants for every resource kind, member administration, profile and workspace settings
-- (BACKLOG 6.01–6.05; J permissions §1–6, J workspace-admin §1–3; A §4.12; CROSS-DOMAIN B.12, X-06, OQ-067).
--
-- Grants on objects and lists stay in entity_definition_permissions (migration 0500); grants on the other kinds
-- (dashboards, workflows, sequences — later slices) go to resource_permissions with the same columns. A member's
-- effective level = the most permissive of the workspace grant, the grants of their teams and their own grant.

-- Teams (J permissions §6): `PUT /workspace-teams/{uuid} {name, description, icon:{id, color}, sort_order}`.
-- Deleting a team archives it (its id may still appear in history) and removes its memberships and grants.
CREATE TABLE workspace_teams (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  icon jsonb,                                  -- {id, color}
  sort_order text COLLATE "C" NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by jsonb
);
CREATE INDEX workspace_teams_rank ON workspace_teams (workspace_id, sort_order) WHERE archived_at IS NULL;

CREATE TABLE workspace_team_memberships (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  team_id uuid NOT NULL REFERENCES workspace_teams (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, member_id)
);
CREATE INDEX workspace_team_memberships_member ON workspace_team_memberships (member_id);

-- Grants of dashboards, workflows and sequences (H api §1.5, G internal-api §6, F sequences §5).
CREATE TABLE resource_permissions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  resource_kind text NOT NULL CHECK (resource_kind IN ('dashboard', 'workflow', 'sequence')),
  resource_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('workspace', 'team', 'workspace-member', 'workflow')),
  target_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('full-access', 'read-write', 'read-only', 'no-access')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_kind, resource_id, target_type, target_id)
);
CREATE INDEX resource_permissions_target ON resource_permissions (target_type, target_id);

-- Member administration: removal keeps the row (the id is the actor of the member's history and their record) but
-- takes the member out of every list; profile avatar = a file on the member's own record.
ALTER TABLE workspace_members ADD COLUMN removed_at timestamptz;
ALTER TABLE workspace_members ADD COLUMN avatar_file_id uuid;

-- "Add to team (optional)" in the invite dialog: the teams joined when the invite is accepted.
ALTER TABLE workspace_invites ADD COLUMN team_ids uuid[] NOT NULL DEFAULT '{}';

-- Workspace › General: a logo uploaded through files (logo_url stays for external URLs).
ALTER TABLE workspaces ADD COLUMN logo_file_id uuid;

ALTER TABLE workspace_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_teams
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE workspace_team_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_team_memberships
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE resource_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resource_permissions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
