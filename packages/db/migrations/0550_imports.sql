-- CSV import (BACKLOG 4.07; specs C2 import.md I1–I9). Data model after Attio's (I7):
--   import_mappings            one per import (a CSV layout bound to a destination entity definition)
--   import_mapping_properties  column → attribute path (+ name part, date/timestamp format, decimal separator)
--   import_overrides           per mapping property and distinct raw value (SHA-256): fixed values or "skip"
--   import_jobs                one upload of a file: lifecycle, plan state, progress, who confirmed / canceled
--   import_job_columns         the CSV columns ("mappable properties"): header + example values
--   import_job_rows            raw cells, uploaded in chunks
--   import_job_assertions      the plan and its outcome: one row per (strategy, CSV row)
-- Strategies (one per object written: the destination, linked records, a list's parent records) are derived from
-- the mapping and kept in import_jobs.plan. Every write to records goes through packages/domain (I1).

CREATE TABLE import_mappings (
  id uuid PRIMARY KEY,                        -- importId; client-minted (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,         -- object or list (collection-entry definition)
  title text NOT NULL,                        -- the file name
  source_type text NOT NULL DEFAULT 'csv' CHECK (source_type IN ('csv')),
  list_strategy text NOT NULL DEFAULT 'create' CHECK (list_strategy IN ('create', 'create-or-update')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_mapping_properties (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  import_mapping_id uuid NOT NULL REFERENCES import_mappings (id) ON DELETE CASCADE,
  column_index int NOT NULL CHECK (column_index >= 0),
  path jsonb NOT NULL,                        -- attribute path from the destination definition
  field text CHECK (field IN ('full-name', 'first-name', 'last-name')),
  resolution_type text NOT NULL,              -- Attio's particle resolution type, e.g. 'date:value'
  date_format text CHECK (date_format IN ('iso', 'us', 'uk')),
  timestamp_format text CHECK (timestamp_format IN ('iso', 'us', 'uk')),
  decimal_separator text CHECK (decimal_separator IN ('point', 'comma')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_mapping_id, column_index)
);

CREATE TABLE import_overrides (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  import_mapping_property_id uuid NOT NULL REFERENCES import_mapping_properties (id) ON DELETE CASCADE,
  hashed_value text NOT NULL,                 -- hex SHA-256 of the raw value
  raw_value text NOT NULL,
  override_values jsonb,                      -- NULL = skip the value; else the values to write (property's write form)
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (import_mapping_property_id, hashed_value)
);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY,                        -- jobId; client-minted (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  import_mapping_id uuid NOT NULL REFERENCES import_mappings (id),
  entity_definition_id uuid NOT NULL,
  source_file_name text NOT NULL,
  column_count int NOT NULL CHECK (column_count BETWEEN 1 AND 100),
  row_count int NOT NULL CHECK (row_count BETWEEN 1 AND 100000),
  uploaded_row_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN (
    'uploading', 'upload-failed', 'draft', 'confirmed', 'preparing', 'executing', 'completed', 'canceled', 'failed')),
  ingestion_failure_reason text,
  time_zone text NOT NULL DEFAULT 'UTC',      -- zone of non-ISO timestamps in the file (the uploader's browser)
  plan_status text NOT NULL DEFAULT 'none' CHECK (plan_status IN ('none', 'ready', 'stale')),
  plan jsonb,                                 -- strategies of the last generated plan
  planned_at timestamptz,
  progress_total int NOT NULL DEFAULT 0,      -- assertions to execute (rows × strategies)
  progress_done int NOT NULL DEFAULT 0,
  failure_reason text,                        -- why a job failed as a whole
  confirmed_by jsonb,
  confirmed_at timestamptz,
  canceled_by jsonb,
  canceled_at timestamptz,
  started_execution_at timestamptz,
  completed_at timestamptz,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                      -- deleted drafts
);
CREATE INDEX import_jobs_ws ON import_jobs (workspace_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX import_jobs_def ON import_jobs (entity_definition_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX import_jobs_mapping ON import_jobs (import_mapping_id);

CREATE TABLE import_job_columns (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  import_job_id uuid NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  column_index int NOT NULL CHECK (column_index >= 0),
  visible_name text NOT NULL,
  example_values jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (import_job_id, column_index)
);

CREATE TABLE import_job_rows (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  import_job_id uuid NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  row_index int NOT NULL CHECK (row_index >= 0),
  cells text[] NOT NULL,
  PRIMARY KEY (import_job_id, row_index)
);

CREATE TABLE import_job_assertions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  import_job_id uuid NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  strategy_index int NOT NULL CHECK (strategy_index >= 0),
  row_index int NOT NULL CHECK (row_index >= 0),
  planned_outcome text NOT NULL CHECK (planned_outcome IN ('create', 'update', 'skip', 'fail')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned', 'created', 'updated', 'skipped', 'failed', 'canceled')),
  matched_entity_instance_ids uuid[] NOT NULL DEFAULT '{}',
  entity_instance_ids uuid[] NOT NULL DEFAULT '{}',
  failure_reason text,
  executed_at timestamptz,
  PRIMARY KEY (import_job_id, strategy_index, row_index)
);
CREATE INDEX import_job_assertions_pending ON import_job_assertions (import_job_id, row_index)
  WHERE status = 'planned';
CREATE INDEX import_job_assertions_status ON import_job_assertions (import_job_id, strategy_index, status, row_index);

ALTER TABLE import_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_mappings
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE import_mapping_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_mapping_properties
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE import_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_overrides
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_jobs
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE import_job_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_job_columns
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE import_job_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_job_rows
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE import_job_assertions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_job_assertions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
