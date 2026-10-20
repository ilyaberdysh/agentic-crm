-- Views, filters, sorts and query snapshots (specs A §4.10, C1 §4/§6–7, A internal-api-shapes §3;
-- spike S1 §8.4 and compiler rules; CROSS-DOMAIN X-20 "one predicate AST").

-- A filter owned by a view (later also by reports and validation rules). `predicate` holds the single internal
-- predicate AST (packages/contracts predicateSchema); NULL = no filter.
CREATE TABLE entity_filters (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  parent_type text NOT NULL CHECK (parent_type IN ('entity-view', 'entity-report', 'particle-gate')),
  predicate jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entity_views (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  type text NOT NULL CHECK (type IN ('table', 'kanban')),
  title text NOT NULL,
  sort_order text COLLATE "C" NOT NULL,
  entity_filter_id uuid NOT NULL REFERENCES entity_filters (id),
  kanban_pivot_path jsonb,                  -- path to a pipeline (or select) attribute
  kanban_attribute_label_display_mode text CHECK (kanban_attribute_label_display_mode IN ('icon', 'text')),
  kanban_is_no_status_visible boolean,
  kanban_is_time_in_status_visible boolean,
  kanban_aggregation jsonb,
  table_record_column_width int,
  is_archived boolean NOT NULL DEFAULT false,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_views_def ON entity_views (entity_definition_id, sort_order);

CREATE TABLE entity_view_attributes (        -- columns
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_view_id uuid NOT NULL REFERENCES entity_views (id) ON DELETE CASCADE,
  sort_order text COLLATE "C" NOT NULL,
  path jsonb NOT NULL,                      -- [{entityDefinitionId, attributeDefinitionId}, …] (<= 5 hops)
  field text,                               -- sub-field (e.g. 'country_code', 'interacted_at')
  title text,
  table_column_width int,
  table_column_aggregation_type text CHECK (table_column_aggregation_type IN (
    'count_empty', 'count_not_empty', 'percent_empty', 'percent_not_empty', 'sum', 'mean', 'max', 'min')),
  display_configuration jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_view_attributes_view ON entity_view_attributes (entity_view_id, sort_order);

CREATE TABLE entity_view_sorts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_view_id uuid NOT NULL REFERENCES entity_views (id) ON DELETE CASCADE,
  sort_order text COLLATE "C" NOT NULL,
  path jsonb NOT NULL,
  field text,
  direction text NOT NULL CHECK (direction IN ('asc', 'desc')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_view_sorts_view ON entity_view_sorts (entity_view_id, sort_order);

-- Query snapshots ("MRL"): the frozen ordered id list of (filter, sorts) at accurate_at, stored as 1000-id chunks.
-- UNLOGGED: a crash loses snapshots, clients simply re-query. Expired rows are purged by the domain
-- (slice-1 simplification; production plan: per-day tables dropped after the TTL, S1 §9 "Operations").
CREATE UNLOGGED TABLE list_snapshots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL,
  query_hash text NOT NULL,
  predicate jsonb,                          -- resolved predicate (dynamic values already expanded)
  sorts jsonb NOT NULL DEFAULT '[]',
  total int NOT NULL,
  accurate_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX list_snapshots_expiry ON list_snapshots (expires_at);

CREATE UNLOGGED TABLE list_snapshot_chunks (
  snapshot_id uuid NOT NULL,
  chunk_no int NOT NULL,
  workspace_id uuid NOT NULL,
  ids uuid[] NOT NULL,
  PRIMARY KEY (snapshot_id, chunk_no)
);

-- The ordered SELECT runs as its own statement (parallel plan possible) and is never inside a data-modifying
-- statement (S1 compiler rule 3). p_sql must select a single column `id` in the snapshot order.
CREATE OR REPLACE FUNCTION snapshot_create(p_id uuid, p_workspace_id uuid, p_sql text, p_chunk int DEFAULT 1000)
RETURNS TABLE (total int, first_chunk uuid[])
LANGUAGE plpgsql
AS $$
DECLARE
  ids uuid[];
  n int;
BEGIN
  EXECUTE format('SELECT array_agg(id) FROM (%s) q', p_sql) INTO ids;
  n := coalesce(cardinality(ids), 0);
  IF n > 0 THEN
    INSERT INTO list_snapshot_chunks (snapshot_id, chunk_no, workspace_id, ids)
    SELECT p_id, g, p_workspace_id, ids[g * p_chunk + 1 : (g + 1) * p_chunk]
    FROM generate_series(0, (n - 1) / p_chunk) g;
  END IF;
  RETURN QUERY SELECT n, coalesce(ids[1:p_chunk], '{}'::uuid[]);
END
$$;

ALTER TABLE entity_filters ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_filters
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_views
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_view_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_view_attributes
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_view_sorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_view_sorts
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE list_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON list_snapshots
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE list_snapshot_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON list_snapshot_chunks
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
