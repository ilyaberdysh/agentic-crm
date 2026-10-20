-- Slice 10 (S10-ASK): AI record summaries (BACKLOG 10.07; D README §2.5 item 4: "{noun} summary", "Generated at
-- {time}", regenerate). One cached summary per record; it is stale once any value of the record changed after
-- `generated_at` (records.summary.get reports `stale`, Regenerate replaces it).

CREATE TABLE record_ai_summaries (
  entity_instance_id uuid PRIMARY KEY REFERENCES entity_instances (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  summary text NOT NULL,
  model text NOT NULL,
  credit_cost integer NOT NULL DEFAULT 0,
  generated_by_member_id uuid REFERENCES workspace_members (id),
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE record_ai_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON record_ai_summaries
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
