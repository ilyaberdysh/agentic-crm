-- Requirement rules ("particle gates", BACKLOG 6.06; J permissions §7, J objects-lists §3.2, A §4.13).
-- condition = a resolved-on-evaluation filter predicate (views AST, contracts views.ts) or NULL for every record;
-- requirements = [{id, attributeDefinitionId, operator, value}] (contracts rules.ts); applies_to = identity triggers
-- (only all workspace members; member/team/workflow triggers are Enterprise and deferred). Deleting a rule is soft.

CREATE TABLE requirement_rules (
  id uuid PRIMARY KEY,                         -- particle_gate_id; client-minted (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  sort_order text COLLATE "C" NOT NULL,
  condition jsonb,
  requirements jsonb NOT NULL,
  applies_to jsonb NOT NULL DEFAULT '[{"type": "all-workspace-members"}]',
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE INDEX requirement_rules_definition ON requirement_rules (entity_definition_id, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE requirement_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON requirement_rules
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
