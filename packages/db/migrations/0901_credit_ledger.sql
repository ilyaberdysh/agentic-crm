-- Slice 10 (S10-ASK): the credits ledger (C.4 #14 metering as a cost guard; B.14; ask-agentic-internals §7.6).
-- One row per AI spend: Ask Agentic turns, record summaries, AI attribute values, call summaries / insights, formula
-- generation, prompt generation. Workflow block spend stays in workflow_credit_usage (0800; the workflow AI blocks
-- report their token-based cost there); usage and the ledger read both.
--   pool     which allowance paid: 'member' = the member's monthly seat credits (quota
--            workspace_membership_credits_per_month_hard), 'workspace' = the workspace pool (quota
--            workflow_credits_per_month_hard), into which members spill once their seat credits are used.
--   credits  whole credits (1 credit = $0.01 of provider cost, rounded up; AI attribute values cost 1 each).
-- Periods are calendar months (UTC).

CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid,
  pool text NOT NULL CHECK (pool IN ('member', 'workspace')),
  -- 'ask': a member's own AI use (seat credits first, then the workspace pool up to the admin's Ask Agentic limit);
  -- 'workspace': automations (AI attributes, call processing) that always use the workspace pool.
  spend text NOT NULL CHECK (spend IN ('ask', 'workspace')),
  source text NOT NULL CHECK (char_length(source) <= 64),
  credits integer NOT NULL CHECK (credits >= 0),
  micro_usd bigint NOT NULL DEFAULT 0,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  web_search_requests integer NOT NULL DEFAULT 0,
  ref_type text,
  ref_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_ws ON credit_ledger (workspace_id, created_at DESC, id DESC);
CREATE INDEX credit_ledger_member ON credit_ledger (workspace_id, member_id, created_at);
CREATE INDEX credit_ledger_ref ON credit_ledger (ref_type, ref_id) WHERE ref_id IS NOT NULL;

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_ledger
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
