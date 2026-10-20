// Kysely table types for migrations 0550–0599 (slice 4: CSV import and view export). Same conventions as schema.ts;
// merged into `DB` by interface augmentation (see schema-collab.ts).
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

type Defaulted<T> = ColumnType<T, T | undefined, T>;

export interface ImportMappingsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  title: string;
  source_type: Defaulted<'csv'>;
  list_strategy: Defaulted<'create' | 'create-or-update'>;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface ImportMappingPropertiesTable {
  id: string;
  workspace_id: string;
  import_mapping_id: string;
  column_index: number;
  path: Json;
  field: 'full-name' | 'first-name' | 'last-name' | null;
  resolution_type: string;
  date_format: 'iso' | 'us' | 'uk' | null;
  timestamp_format: 'iso' | 'us' | 'uk' | null;
  decimal_separator: 'point' | 'comma' | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface ImportOverridesTable {
  workspace_id: string;
  import_mapping_property_id: string;
  hashed_value: string;
  raw_value: string;
  override_values: Json | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export type ImportJobStatus =
  | 'uploading'
  | 'upload-failed'
  | 'draft'
  | 'confirmed'
  | 'preparing'
  | 'executing'
  | 'completed'
  | 'canceled'
  | 'failed';

export interface ImportJobsTable {
  id: string;
  workspace_id: string;
  import_mapping_id: string;
  entity_definition_id: string;
  source_file_name: string;
  column_count: number;
  row_count: number;
  uploaded_row_count: Defaulted<number>;
  status: Defaulted<ImportJobStatus>;
  ingestion_failure_reason: string | null;
  time_zone: Defaulted<string>;
  plan_status: Defaulted<'none' | 'ready' | 'stale'>;
  plan: Json | null;
  planned_at: Timestamp | null;
  progress_total: Defaulted<number>;
  progress_done: Defaulted<number>;
  failure_reason: string | null;
  confirmed_by: Json | null;
  confirmed_at: Timestamp | null;
  canceled_by: Json | null;
  canceled_at: Timestamp | null;
  started_execution_at: Timestamp | null;
  completed_at: Timestamp | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface ImportJobColumnsTable {
  workspace_id: string;
  import_job_id: string;
  column_index: number;
  visible_name: string;
  example_values: Defaulted<Json>;
}

export interface ImportJobRowsTable {
  workspace_id: string;
  import_job_id: string;
  row_index: number;
  cells: string[];
}

export type ImportAssertionStatus = 'planned' | 'created' | 'updated' | 'skipped' | 'failed' | 'canceled';

export interface ImportJobAssertionsTable {
  workspace_id: string;
  import_job_id: string;
  strategy_index: number;
  row_index: number;
  planned_outcome: 'create' | 'update' | 'skip' | 'fail';
  status: Defaulted<ImportAssertionStatus>;
  matched_entity_instance_ids: Defaulted<string[]>;
  entity_instance_ids: Defaulted<string[]>;
  failure_reason: string | null;
  executed_at: Timestamp | null;
}

export interface EntityDefinitionExportsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  view_id: string;
  output_type: Defaulted<'csv'>;
  title: string;
  file_name: string;
  filter: Json | null;
  sorts: Defaulted<Json>;
  attributes: Defaulted<Json>;
  locale: Defaulted<string>;
  time_zone: Defaulted<string>;
  status: Defaulted<'pending' | 'in-progress' | 'complete' | 'failed'>;
  progress: Defaulted<number>;
  failure_reason: string | null;
  row_count: number | null;
  content_size: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  object_key: string | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  completed_at: Timestamp | null;
}

declare module './schema.ts' {
  interface DB {
    import_mappings: ImportMappingsTable;
    import_mapping_properties: ImportMappingPropertiesTable;
    import_overrides: ImportOverridesTable;
    import_jobs: ImportJobsTable;
    import_job_columns: ImportJobColumnsTable;
    import_job_rows: ImportJobRowsTable;
    import_job_assertions: ImportJobAssertionsTable;
    entity_definition_exports: EntityDefinitionExportsTable;
  }
}
