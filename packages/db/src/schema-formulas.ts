// Kysely table types for migrations 0930–0959 (slice 10: formula attributes, AI attributes, entity annotations).
// Same conventions as schema.ts; merged into `DB` by interface augmentation.
import type { ColumnType, Generated } from 'kysely';
import type { CreatedAt, Json, JsonColumn, Timestamp } from './schema.ts';

export interface FormulaAttributeSnapshotsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  attribute_id: string;
  grammar_version: string;
  plaintext: string;
  annotations: JsonColumn;
  output_type_override: string | null;
  created_by: Json;
  created_at: Timestamp;
}

export interface FormulaAttributesTable {
  attribute_id: string;
  workspace_id: string;
  entity_definition_id: string;
  active_snapshot_id: string;
  active_snapshot_created_at: Timestamp;
  uses_now: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: Timestamp;
}

export interface FormulaDependenciesTable {
  id: Generated<string>;
  workspace_id: string;
  formula_attribute_id: string;
  formula_entity_definition_id: string;
  depends_on_attribute_id: string;
  hop_index: number;
  path: JsonColumn;
}

export type AiAutofillType = 'research-web' | 'classify-record' | 'summarize-record' | 'prompt-completion';

export interface AiAttributeConfigsTable {
  attribute_id: string;
  workspace_id: string;
  entity_definition_id: string;
  is_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  type: AiAutofillType;
  prompt: Json;
  is_option_creation_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  created_by: Json;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AiAttributeRunsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  attribute_id: string;
  target: 'records' | 'selection' | 'column';
  record_count: number;
  credits_per_value: number;
  credits_estimated: number;
  credits_used: ColumnType<number, number | undefined, number>;
  values_written: ColumnType<number, number | undefined, number>;
  errors: ColumnType<number, number | undefined, number>;
  status: 'queued' | 'running' | 'complete';
  requested_by: Json;
  created_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface EntityAnnotationsTable {
  workspace_id: string;
  entity_definition_id: string;
  attribute_id: string;
  instance_id: string;
  formula_status: 'pending' | 'complete' | 'error' | null;
  formula_status_changed_at: Timestamp | null;
  formula_snapshot_id: string | null;
  formula_error: string | null;
  formula_error_message: string | null;
  ai_status: 'queued' | 'running' | 'complete' | 'error' | null;
  ai_status_changed_at: Timestamp | null;
  ai_error: string | null;
  ai_run_id: string | null;
  ai_credits: ColumnType<number, number | undefined, number>;
  ai_basis_reasoning: string | null;
  updated_at: Timestamp;
}

export interface FormulaGenerationRequestsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  type: 'generate' | 'refine' | 'fix';
  status: 'queued' | 'generating' | 'completed' | 'failed';
  prompt: string | null;
  selection_start_from: number | null;
  selection_start_to: number | null;
  input_formula_draft: Json;
  output_plaintext: string | null;
  output_annotations: Json;
  refusal_message: string | null;
  refusal_category: string | null;
  created_by: Json;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FormulaRecomputeStateTable {
  id: Generated<number>;
  xid_cursor: string;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    formula_attribute_snapshots: FormulaAttributeSnapshotsTable;
    formula_attributes: FormulaAttributesTable;
    formula_dependencies: FormulaDependenciesTable;
    ai_attribute_configs: AiAttributeConfigsTable;
    ai_attribute_runs: AiAttributeRunsTable;
    entity_annotations: EntityAnnotationsTable;
    formula_generation_requests: FormulaGenerationRequestsTable;
    formula_recompute_state: FormulaRecomputeStateTable;
  }
}
