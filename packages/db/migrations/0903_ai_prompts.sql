-- Slice 10 (S10-ASK): the prompts library (BACKLOG 10.03; ask-agentic §2.2–2.3, §11.2; internals §7.5).
--   ai_prompts                 custom prompts: body, user title / icon, AI metadata filled after save (ai_title,
--                              ai_summary, ai_icon_*, ai_targets), preferred model, workspace access level
--                              (default read-only, as observed), transient drafts from "Generate".
--   ai_prompt_member_access    per-member access levels from the Share popover (full-access / read-write /
--                              read-only); the creator always has full access.
--   ai_curated_prompt_saves    curated prompts (code catalogue, packages/domain/src/ai/prompts/curated.ts) a member
--                              saved to "My prompts"; three are saved for every member on first use.

CREATE TABLE ai_prompts (
  id uuid PRIMARY KEY,                          -- client-minted
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text CHECK (title IS NULL OR char_length(title) <= 200),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 20000),
  icon_id text,
  icon_color text,
  ai_title text,
  ai_summary text,
  ai_icon_id text,
  ai_icon_color text,
  ai_targets text[] NOT NULL DEFAULT '{}',
  default_model text,
  workspace_access text NOT NULL DEFAULT 'read-only'
    CHECK (workspace_access IN ('full-access', 'read-write', 'read-only', 'no-access')),
  is_transient boolean NOT NULL DEFAULT false,
  created_by_member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ai_prompts_ws ON ai_prompts (workspace_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE ai_prompt_member_access (
  prompt_id uuid NOT NULL REFERENCES ai_prompts (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  access text NOT NULL CHECK (access IN ('full-access', 'read-write', 'read-only', 'no-access')),
  PRIMARY KEY (prompt_id, member_id)
);

CREATE TABLE ai_curated_prompt_saves (
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  curated_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, curated_id)
);
CREATE INDEX ai_curated_prompt_saves_ws ON ai_curated_prompt_saves (workspace_id, curated_id);

ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_prompts
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE ai_prompt_member_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_prompt_member_access
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE ai_curated_prompt_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_curated_prompt_saves
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
