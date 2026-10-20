// Kysely table types for the hand-written migrations in ../migrations (kept in sync by hand; one interface per table).
// Conventions of the pool created by createDb(): timestamptz/timestamp come back as ISO-8601 strings with
// microsecond precision ('2026-10-10T12:00:00.123456Z'), date as 'YYYY-MM-DD', numeric and bigint as strings,
// jsonb as parsed JSON. Projection tables (schema proj) are dynamic and are queried with raw SQL.
import type { ColumnType, Generated } from 'kysely';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
/** ISO-8601 timestamp string (microsecond precision). */
export type Timestamp = string;
/** Defaults to now() in the database. */
export type CreatedAt = ColumnType<Timestamp, Timestamp | undefined, Timestamp>;
export type JsonColumn<T = Json> = ColumnType<T, T, T>;

/** Auth identities (migration 0010, owned by apps/api / Better Auth); the domain only reads them. */
export interface UsersTable {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface WorkspacesTable {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  country_code: string | null;
  settings: ColumnType<Json, Json | undefined, Json>;
  onboarding_flags: ColumnType<Json, Json | undefined, Json>;
  created_by_user_id: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface WorkspaceMembersTable {
  id: string;
  workspace_id: string;
  user_id: string;
  access_level: 'admin' | 'member' | 'suspended';
  email_address: string;
  first_name: ColumnType<string, string | undefined, string>;
  last_name: ColumnType<string, string | undefined, string>;
  suspended_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface WorkspaceInvitesTable {
  id: string;
  workspace_id: string;
  email_address: string;
  access_level: 'admin' | 'member';
  first_name: string | null;
  last_name: string | null;
  created_by_member_id: string | null;
  created_at: CreatedAt;
  accepted_at: Timestamp | null;
  accepted_member_id: string | null;
  revoked_at: Timestamp | null;
}

export interface EntityDefinitionsTable {
  id: string;
  workspace_id: string;
  entity_type: string;
  standard_object_type: string | null;
  entity_sub_type: string | null;
  api_slug: string;
  singular_noun: string;
  plural_noun: string;
  icon: string | null;
  image_path: JsonColumn | null;
  epithet_path: JsonColumn | null;
  interface_ids: ColumnType<string[], string[] | undefined, string[]>;
  sort_order: string | null;
  is_archived: ColumnType<boolean, boolean | undefined, boolean>;
  is_system: ColumnType<boolean, boolean | undefined, boolean>;
  seeded_at: Timestamp | null;
  projection_table: string | null;
  next_attnum: ColumnType<number, number | undefined, number>;
  created_by: JsonColumn;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface AttributeDefinitionsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  api_slug: string;
  title: string;
  description: ColumnType<string, string | undefined, string>;
  type: string;
  is_multiselect: ColumnType<boolean, boolean | undefined, boolean>;
  is_unique: ColumnType<boolean, boolean | undefined, boolean>;
  is_required: ColumnType<boolean, boolean | undefined, boolean>;
  is_historic: ColumnType<boolean, boolean | undefined, boolean>;
  is_archived: ColumnType<boolean, boolean | undefined, boolean>;
  is_system: ColumnType<boolean, boolean | undefined, boolean>;
  system_attribute_type: string | null;
  is_read_only: ColumnType<boolean, boolean | undefined, boolean>;
  is_hidden: ColumnType<boolean, boolean | undefined, boolean>;
  config: ColumnType<Json, Json | undefined, Json>;
  default_value: JsonColumn | null;
  relationship_attribute_id: string | null;
  interface_attribute_id: string | null;
  attnum: number;
  is_indexed: ColumnType<boolean, boolean | undefined, boolean>;
  sort_order: string;
  created_by: JsonColumn;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface SelectOptionsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  attribute_id: string;
  kind: 'option' | 'stage';
  title: string;
  color: string;
  sort_order: string;
  lifecycle_phase: 'ACTIVE' | 'WON' | 'LOST' | null;
  target_time_in_status: string | null;
  celebration_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  is_archived: ColumnType<boolean, boolean | undefined, boolean>;
  created_by: JsonColumn;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface EntityInstancesTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  version: ColumnType<string, string | number | undefined, string | number>;
  search_text: string | null;
  created_at: CreatedAt;
  created_by_type: number;
  created_by_id: string | null;
  archived_at: Timestamp | null;
  archived_by_type: number | null;
  archived_by_id: string | null;
  merged_at: Timestamp | null;
  merged_into_id: string | null;
}

export interface AttributeValuesTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  instance_id: string;
  attribute_id: string;
  active_from: Timestamp;
  active_until: Timestamp | null;
  created_by_type: number;
  created_by_id: string | null;
  deactivated_by_type: number | null;
  deactivated_by_id: string | null;
  sort_order: string | null;
  v_text: string | null;
  v_num: ColumnType<string | null, string | number | null, string | number | null>;
  v_ts: Timestamp | null;
  v_date: string | null;
  v_bool: boolean | null;
  v_ref: string | null;
  v_ref_def: string | null;
  v_json: JsonColumn | null;
  sort_key: string | null;
  unique_key: string | null;
}

export interface ChangeLogTable {
  id: Generated<string>;
  workspace_id: string;
  xid: Generated<string>;
  resource: string;
  resource_id: string | null;
  scope: ColumnType<Json, Json | undefined, Json>;
  actor: JsonColumn | null;
  audience: JsonColumn | null;
  created_at: CreatedAt;
}

export interface EntityFiltersTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  parent_type: 'entity-view' | 'entity-report' | 'particle-gate';
  predicate: JsonColumn | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface EntityViewsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  type: 'table' | 'kanban';
  title: string;
  sort_order: string;
  entity_filter_id: string;
  kanban_pivot_path: JsonColumn | null;
  kanban_attribute_label_display_mode: 'icon' | 'text' | null;
  kanban_is_no_status_visible: boolean | null;
  kanban_is_time_in_status_visible: boolean | null;
  kanban_aggregation: JsonColumn | null;
  table_record_column_width: number | null;
  is_archived: ColumnType<boolean, boolean | undefined, boolean>;
  created_by: JsonColumn;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface EntityViewAttributesTable {
  id: string;
  workspace_id: string;
  entity_view_id: string;
  sort_order: string;
  path: JsonColumn;
  field: string | null;
  title: string | null;
  table_column_width: number | null;
  table_column_aggregation_type: string | null;
  display_configuration: ColumnType<Json, Json | undefined, Json>;
  created_at: CreatedAt;
}

export interface EntityViewSortsTable {
  id: string;
  workspace_id: string;
  entity_view_id: string;
  sort_order: string;
  path: JsonColumn;
  field: string | null;
  direction: 'asc' | 'desc';
  created_at: CreatedAt;
}

export interface ListSnapshotsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  query_hash: string;
  predicate: JsonColumn | null;
  sorts: ColumnType<Json, Json | undefined, Json>;
  total: number;
  accurate_at: CreatedAt;
  expires_at: Timestamp;
}

export interface ListSnapshotChunksTable {
  snapshot_id: string;
  chunk_no: number;
  workspace_id: string;
  ids: string[];
}

/** Workspace API tokens for /v2 (migration 0110). */
export interface ApiTokensTable {
  id: string;
  workspace_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string[];
  token_level: ColumnType<'workspace' | 'user', 'workspace' | 'user' | undefined, 'workspace' | 'user'>;
  authorized_by_member_id: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  last_used_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

/** Rich-text documents (migration 0400): Yjs state + projections; written only by the domain documents module. */
export interface DocumentsTable {
  id: string;
  workspace_id: string;
  doc_type: 'note' | 'note-template' | 'email-template' | 'email-signature' | 'insight-section';
  /** Owning header (note / template id); null = standalone workspace document. */
  parent_ref: string | null;
  yjs_state: Buffer | null;
  blocks: JsonColumn | null;
  markdown: string | null;
  search_text: string | null;
  /** Generated column (to_tsvector('simple', search_text)); never written. */
  search_vector: ColumnType<string, never, never>;
  version: ColumnType<string, string | number | undefined, string | number>;
  created_by: JsonColumn | null;
  updated_by: JsonColumn | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface SchemaMigrationsTable {
  name: string;
  checksum: string;
  applied_at: CreatedAt;
}

export interface DB {
  users: UsersTable;
  workspaces: WorkspacesTable;
  workspace_members: WorkspaceMembersTable;
  workspace_invites: WorkspaceInvitesTable;
  entity_definitions: EntityDefinitionsTable;
  attribute_definitions: AttributeDefinitionsTable;
  select_options: SelectOptionsTable;
  entity_instances: EntityInstancesTable;
  attribute_values: AttributeValuesTable;
  change_log: ChangeLogTable;
  entity_filters: EntityFiltersTable;
  entity_views: EntityViewsTable;
  entity_view_attributes: EntityViewAttributesTable;
  entity_view_sorts: EntityViewSortsTable;
  list_snapshots: ListSnapshotsTable;
  list_snapshot_chunks: ListSnapshotChunksTable;
  schema_migrations: SchemaMigrationsTable;
  api_tokens: ApiTokensTable;
  documents: DocumentsTable;
}
