-- Slice 10 (S10-ASK): Ask Agentic threads (BACKLOG 10.01, 10.02, 10.16; ask-agentic §3–10, internals §2).
--   ai_threads      one chat; private to its creator (conversations are private, D:platform/ask). title = user
--                   rename, ai_title = generated; web_search_allowed = "Allow" answered once for the thread.
--   ai_turns        the conversation tree: user turns (parts: text + mention annotations, interests = page context)
--                   and assistant turns (status, model, refinement, cost, feedback, reply suggestions). A user turn's
--                   parent is the assistant turn it replies to; an assistant turn's parent is its user turn
--                   (try again = a sibling assistant turn).
--   ai_turn_steps   one LLM call of an assistant turn and the tool calls it made: `parts` (contracts
--                   aiAssistantPartSchema, what clients render), `llm_content` (the provider's assistant content
--                   blocks verbatim, thinking included, to continue the tool loop and later turns) and
--                   `tool_results` (the tool_result blocks returned for its tool calls). Both are JSON *text*, not
--                   jsonb: replayed history must be byte-identical (jsonb reorders object keys).
-- Write tools pause the turn with tool parts in `awaiting-approval`; approve / deny resume it.

CREATE TABLE ai_threads (
  id uuid PRIMARY KEY,                          -- client-minted
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  type text NOT NULL DEFAULT 'chat' CHECK (type IN ('chat')),
  title text CHECK (title IS NULL OR char_length(title) <= 200),
  ai_title text,
  created_by_member_id uuid NOT NULL REFERENCES workspace_members (id),
  web_search_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ai_threads_member ON ai_threads (workspace_id, created_by_member_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE TABLE ai_turns (
  id uuid PRIMARY KEY,                          -- client-minted
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  thread_id uuid NOT NULL REFERENCES ai_threads (id),
  parent_turn_id uuid REFERENCES ai_turns (id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  parts jsonb NOT NULL DEFAULT '[]',
  llm_content text,                             -- user turns: the exact user message sent to the model (JSON text)
  source text CHECK (source IS NULL OR source IN ('composer', 'suggestion', 'reply-suggestion')),
  time_zone text,
  status text NOT NULL CHECK (status IN ('executing', 'completed', 'canceled', 'failed')),
  model text,
  model_mode text CHECK (model_mode IS NULL OR model_mode IN ('auto', 'manual')),
  refinement jsonb,
  micro_usd bigint NOT NULL DEFAULT 0,
  credit_cost integer,
  context_tokens integer,
  failure_reason text,
  feedback jsonb,
  reply_suggestions jsonb,
  created_by_member_id uuid NOT NULL REFERENCES workspace_members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  canceled_at timestamptz,
  failed_at timestamptz
);
CREATE INDEX ai_turns_thread ON ai_turns (thread_id, created_at, id);
CREATE INDEX ai_turns_executing ON ai_turns (workspace_id, updated_at) WHERE status = 'executing';

CREATE TABLE ai_turn_steps (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  turn_id uuid NOT NULL REFERENCES ai_turns (id),
  position integer NOT NULL,
  status text NOT NULL CHECK (status IN ('executing-llm', 'executing-tools', 'completed', 'canceled', 'failed')),
  parts jsonb NOT NULL DEFAULT '[]',
  llm_content text,                             -- JSON text, byte-stable (prompt cache prefix, thinking blocks)
  tool_results text,                            -- JSON text
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (turn_id, position)
);

ALTER TABLE ai_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_threads
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE ai_turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_turns
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE ai_turn_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_turn_steps
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
