-- Slice 9: reports and dashboards (BACKLOG 9.01–9.10; H api §1–3, builder §6; CROSS-DOMAIN B.3, B.6, B.12, B.24).
--   reporting_dashboards       dashboards (grants in resource_permissions with resource_kind 'dashboard', 0650)
--   entity_reports             one report = data source + filter (entity_filters, parent_type 'entity-report') +
--                              type + visualisation + the type's settings object (contracts reports.ts)
--   reporting_dashboard_cells  placement of a report on a dashboard: width (12-column grid, 4–12) and rank
-- A report belongs to exactly one cell (H README §4: duplicating creates a new report). Deleting a dashboard deletes
-- its cells, reports and report filters; deleting a report deletes its cell.
-- `depends_on_*` hold the entity definitions and attributes the report reads (data source, path hops, filter,
-- metric, groupings, status attribute). Tx.flush uses them to emit `report-stale` invalidations only for
-- definitions some report depends on (packages/domain/src/reports/stale.ts).

CREATE TABLE reporting_dashboards (
  id uuid PRIMARY KEY,                      -- client-minted (PUT /reporting-dashboards/{uuid})
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text NOT NULL CHECK (char_length(title) <= 256),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reporting_dashboards_created ON reporting_dashboards (workspace_id, created_at DESC, id);

CREATE TABLE entity_reports (
  id uuid PRIMARY KEY,                      -- client-minted (PUT /reports/{uuid})
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  entity_filter_id uuid REFERENCES entity_filters (id),
  title text NOT NULL CHECK (char_length(title) <= 256),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  report_type text NOT NULL CHECK (report_type IN ('insights', 'historical', 'funnel', 'time-in-stage', 'stage-changed')),
  visualisation_type text CHECK (visualisation_type IN (
    'bar', 'line', 'pie', 'map', 'single_metric', 'funnel', 'metric', 'steps')),
  settings jsonb NOT NULL,
  depends_on_definition_ids uuid[] NOT NULL DEFAULT '{}',
  depends_on_attribute_ids uuid[] NOT NULL DEFAULT '{}',
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_reports_definition ON entity_reports (entity_definition_id);
CREATE INDEX entity_reports_depends ON entity_reports USING gin (depends_on_definition_ids);

CREATE TABLE reporting_dashboard_cells (
  id uuid PRIMARY KEY,                      -- client-minted (PUT /reporting-dashboards/{d}/cells/{uuid})
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  dashboard_id uuid NOT NULL REFERENCES reporting_dashboards (id) ON DELETE CASCADE,
  report_id uuid NOT NULL UNIQUE REFERENCES entity_reports (id) ON DELETE CASCADE,
  width smallint NOT NULL CHECK (width BETWEEN 4 AND 12),
  sort_order text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reporting_dashboard_cells_dashboard ON reporting_dashboard_cells (dashboard_id, sort_order, id);

-- Value history reads of the dataset engine (historical values, stage changed, funnel, time in stage): one attribute's
-- rows in time order with everything the as-of / unwind steps need, without heap fetches. av_attr_hist (0200) lacks
-- instance_id, which every report needs to apply the report filter and the record's existence.
CREATE INDEX av_report_hist ON attribute_values (attribute_id, active_from)
  INCLUDE (instance_id, active_until, v_ref, v_num)
  WHERE v_ref IS NOT NULL OR v_num IS NOT NULL;

ALTER TABLE reporting_dashboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reporting_dashboards
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_reports
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE reporting_dashboard_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reporting_dashboard_cells
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
