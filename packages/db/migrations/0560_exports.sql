-- View export (BACKLOG 4.08; specs C2 export.md E1–E3, C1 README §3.8). One row per export request: the view's
-- saved filter, sorts and columns are frozen at request time; a worker job (pg-boss, enqueued in the same
-- transaction, D-10) materialises the rows, formats them and stores the CSV in S3 under `object_key`; downloads go
-- through short-lived signed URLs.

CREATE TABLE entity_definition_exports (
  id uuid PRIMARY KEY,                        -- exportId; client-minted (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  view_id uuid NOT NULL,
  output_type text NOT NULL DEFAULT 'csv' CHECK (output_type IN ('csv')),
  title text NOT NULL,                        -- toast title "<Object> - <View> Export"
  file_name text NOT NULL,                    -- "<Object> - <View>.csv"
  filter jsonb,                               -- the view's saved predicate at request time
  sorts jsonb NOT NULL DEFAULT '[]',
  attributes jsonb NOT NULL DEFAULT '[]',     -- [{title, path, field, displayConfiguration}] in column order
  locale text NOT NULL DEFAULT 'en-US',       -- number / currency formatting (one locale rule, X-11)
  time_zone text NOT NULL DEFAULT 'UTC',      -- timestamps
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'complete', 'failed')),
  progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  failure_reason text,                        -- 'instance-count-zero' | 'unknown-error'
  row_count int,
  content_size bigint,
  object_key text,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX entity_definition_exports_ws ON entity_definition_exports (workspace_id, created_at DESC);

ALTER TABLE entity_definition_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_definition_exports
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
