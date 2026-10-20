// Kysely table types for migrations 0850–0899 (slice 9: reports and dashboards). Same conventions as schema.ts;
// merged into `DB` by interface augmentation.
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json, JsonColumn } from './schema.ts';

export interface ReportingDashboardsTable {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export type EntityReportType = 'insights' | 'historical' | 'funnel' | 'time-in-stage' | 'stage-changed';
export type EntityReportVisualisation =
  | 'bar'
  | 'line'
  | 'pie'
  | 'map'
  | 'single_metric'
  | 'funnel'
  | 'metric'
  | 'steps';

export interface EntityReportsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  entity_filter_id: string | null;
  title: string;
  description: string | null;
  report_type: EntityReportType;
  visualisation_type: EntityReportVisualisation | null;
  settings: JsonColumn;
  depends_on_definition_ids: ColumnType<string[], string[] | undefined, string[]>;
  depends_on_attribute_ids: ColumnType<string[], string[] | undefined, string[]>;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface ReportingDashboardCellsTable {
  id: string;
  workspace_id: string;
  dashboard_id: string;
  report_id: string;
  width: number;
  sort_order: string;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    reporting_dashboards: ReportingDashboardsTable;
    entity_reports: EntityReportsTable;
    reporting_dashboard_cells: ReportingDashboardCellsTable;
  }
}
