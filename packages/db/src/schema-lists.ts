// Kysely table types for migration 0500 (slice 4: lists, access grants, kanban stage visibility). Same conventions as
// schema.ts; merged into `DB` (and into EntityViewsTable) by interface augmentation.
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

export interface CollectionsTable {
  id: string;
  workspace_id: string;
  name: string;
  icon: string | null;
  sort_order: string;
  parent_entity_definition_ids: string[];
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export type AccessScopeColumn = 'full-access' | 'read-write' | 'read-only' | 'no-access';

export interface EntityDefinitionPermissionsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  target_type: 'workspace' | 'team' | 'workspace-member' | 'workflow';
  target_id: string;
  scope: AccessScopeColumn;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    collections: CollectionsTable;
    entity_definition_permissions: EntityDefinitionPermissionsTable;
  }
  interface EntityViewsTable {
    kanban_hidden_stage_ids: ColumnType<string[], string[] | undefined, string[]>;
  }
}
