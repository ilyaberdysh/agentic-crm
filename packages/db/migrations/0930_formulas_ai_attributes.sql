-- Slice 10: formula attributes, AI autofill attributes, entity annotations (I-ai-calls/formulas.md §5,
-- ai-attributes.md §4–6, A README §4.6).
--
-- A formula attribute is an ordinary attribute definition (type = output type, is_read_only) plus a pointer to its
-- active immutable snapshot (plaintext + annotations). Dependencies list every attribute along every reference path
-- so the recompute pump can turn committed value changes (change_log 'attribute-value-list') into the records whose
-- formulas must be recomputed. Per-record state of formula and AI values lives in entity_annotations.

CREATE TABLE formula_attribute_snapshots (
  id uuid PRIMARY KEY,                       -- client-minted per save (formula_attribute_snapshot_id)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  attribute_id uuid NOT NULL REFERENCES attribute_definitions (id),
  grammar_version text NOT NULL,
  plaintext text NOT NULL,
  annotations jsonb NOT NULL,
  output_type_override text CHECK (output_type_override IN (
    'text', 'number', 'checkbox', 'date', 'timestamp', 'rating', 'currency', 'phone-number')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX formula_attribute_snapshots_attr ON formula_attribute_snapshots (attribute_id, created_at);

CREATE TABLE formula_attributes (
  attribute_id uuid PRIMARY KEY REFERENCES attribute_definitions (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  active_snapshot_id uuid NOT NULL REFERENCES formula_attribute_snapshots (id),
  active_snapshot_created_at timestamptz NOT NULL,
  uses_now boolean NOT NULL DEFAULT false,   -- now() / today(): also recomputed daily
  updated_at timestamptz NOT NULL
);
CREATE INDEX formula_attributes_ws ON formula_attributes (workspace_id);

-- One row per attribute on a reference path: a change of `depends_on_attribute_id` on instances S affects the
-- formula's records reached from S by walking `path` back from hop `hop_index` to hop 0.
CREATE TABLE formula_dependencies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  formula_attribute_id uuid NOT NULL REFERENCES attribute_definitions (id),
  formula_entity_definition_id uuid NOT NULL,
  depends_on_attribute_id uuid NOT NULL,
  hop_index int NOT NULL,
  path jsonb NOT NULL
);
CREATE INDEX formula_dependencies_dep ON formula_dependencies (workspace_id, depends_on_attribute_id);
CREATE INDEX formula_dependencies_formula ON formula_dependencies (formula_attribute_id);

-- AI autofill configuration of an attribute (ai-attributes §2–4). The prompt keeps variables as attribute paths.
CREATE TABLE ai_attribute_configs (
  attribute_id uuid PRIMARY KEY REFERENCES attribute_definitions (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  is_enabled boolean NOT NULL DEFAULT true,
  type text NOT NULL CHECK (type IN ('research-web', 'classify-record', 'summarize-record', 'prompt-completion')),
  prompt jsonb,                              -- {plaintext, variables: [{startPosition, path}]} | null
  is_option_creation_enabled boolean NOT NULL DEFAULT false,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- A confirmed recalculation request (records, a selection or a whole column).
CREATE TABLE ai_attribute_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  attribute_id uuid NOT NULL REFERENCES attribute_definitions (id),
  target text NOT NULL CHECK (target IN ('records', 'selection', 'column')),
  record_count int NOT NULL,
  credits_per_value int NOT NULL,
  credits_estimated int NOT NULL,
  credits_used int NOT NULL DEFAULT 0,
  values_written int NOT NULL DEFAULT 0,
  errors int NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'complete')),
  requested_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX ai_attribute_runs_attr ON ai_attribute_runs (attribute_id, created_at);

-- Per-record state of formula and AI values (entity annotations).
CREATE TABLE entity_annotations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  attribute_id uuid NOT NULL REFERENCES attribute_definitions (id),
  instance_id uuid NOT NULL,
  formula_status text CHECK (formula_status IN ('pending', 'complete', 'error')),
  formula_status_changed_at timestamptz,
  formula_snapshot_id uuid,
  formula_error text,
  formula_error_message text,
  ai_status text CHECK (ai_status IN ('queued', 'running', 'complete', 'error')),
  ai_status_changed_at timestamptz,
  ai_error text,
  ai_run_id uuid,
  ai_credits int NOT NULL DEFAULT 0,
  ai_basis_reasoning text,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (attribute_id, instance_id)
);
CREATE INDEX entity_annotations_ai_open ON entity_annotations (workspace_id, ai_status_changed_at)
  WHERE ai_status IN ('queued', 'running');

-- AI formula composer requests (formulas §4.5): queued → generating → completed | failed.
CREATE TABLE formula_generation_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  type text NOT NULL CHECK (type IN ('generate', 'refine', 'fix')),
  status text NOT NULL CHECK (status IN ('queued', 'generating', 'completed', 'failed')),
  prompt text,
  selection_start_from int,
  selection_start_to int,
  input_formula_draft jsonb,
  output_plaintext text,
  output_annotations jsonb,
  refusal_message text,
  refusal_category text,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Recompute pump cursor (one row, owner role only), like the webhook and workflow fan-outs.
CREATE TABLE formula_recompute_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  xid_cursor xid8 NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO formula_recompute_state (id, xid_cursor) VALUES (1, pg_snapshot_xmin(pg_current_snapshot()));
REVOKE ALL ON formula_recompute_state FROM agentic_crm_app;

ALTER TABLE formula_attribute_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON formula_attribute_snapshots
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE formula_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON formula_attributes
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE formula_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON formula_dependencies
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE ai_attribute_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_attribute_configs
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE ai_attribute_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_attribute_runs
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_annotations
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE formula_generation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON formula_generation_requests
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
