-- Slice 10 (S10-ASK): AI settings (BACKLOG 10.04; ask-agentic §11, ask-agentic-internals §8.2–8.3).
--   workspace_ai_settings   Workspace › Ask Agentic: custom context (≤ 20,000 chars), the admin's limit on workspace
--                           credits for Ask Agentic (null = no extra limit), model overrides per tier
--                           ({ask?, bulk?, fast?}; packages/domain/src/ai/llm.ts workspaceModelFor).
--   member_ai_settings      Personal › Ask Agentic: web search permission (always-ask / auto-approve / disabled),
--                           share downvoted messages, default model (null = Auto), personal custom context, and
--                           whether the default curated prompts were saved for the member.
-- Rows are created lazily on first write; reads fall back to the defaults.

CREATE TABLE workspace_ai_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  custom_context text CHECK (custom_context IS NULL OR char_length(custom_context) <= 20000),
  ask_workspace_credits_limit integer CHECK (ask_workspace_credits_limit IS NULL OR ask_workspace_credits_limit >= 0),
  models jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member_ai_settings (
  member_id uuid PRIMARY KEY REFERENCES workspace_members (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  allow_web_search text NOT NULL DEFAULT 'always-ask'
    CHECK (allow_web_search IN ('always-ask', 'auto-approve', 'disabled')),
  share_thread_feedback text NOT NULL DEFAULT 'always-ask'
    CHECK (share_thread_feedback IN ('always-ask', 'auto-approve', 'disabled')),
  default_model text,
  custom_context text CHECK (custom_context IS NULL OR char_length(custom_context) <= 20000),
  curated_defaults_saved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_ai_settings_ws ON member_ai_settings (workspace_id);

ALTER TABLE workspace_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_ai_settings
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE member_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_ai_settings
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
