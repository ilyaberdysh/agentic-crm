// Kysely table types for migrations 0410–0470 (slice 3: notes, templates, tasks, comments, favorites, files, record
// page layouts, member preferences). Same conventions as schema.ts; merged into `DB` by interface augmentation so
// parallel areas can add their tables without editing one shared interface. The `documents` table (migration
// 0400_documents.sql) is typed by its owner (apps/collab); slice-3 services read it with raw SQL.
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

type Defaulted<T> = ColumnType<T, T | undefined, T>;

export interface NotesTable {
  id: string;
  workspace_id: string;
  title: Defaulted<string>;
  document_id: string;
  meeting_id: string | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export interface NoteRecordsTable {
  note_id: string;
  workspace_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  position: number;
  created_at: CreatedAt;
}

export interface NoteTemplatesTable {
  id: string;
  workspace_id: string;
  title: Defaulted<string>;
  header_title: Defaulted<string>;
  document_id: string;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export interface TasksTable {
  id: string;
  workspace_id: string;
  content: string;
  mentions: Defaulted<Json>;
  mentioned_member_ids: Defaulted<string[]>;
  deadline_at: Timestamp | null;
  deadline_has_time: Defaulted<boolean>;
  completed_at: Timestamp | null;
  completed_by: Json | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export interface TaskRecordsTable {
  task_id: string;
  workspace_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  position: number;
}

export interface TaskAssigneesTable {
  task_id: string;
  workspace_id: string;
  member_id: string;
  position: number;
}

export interface CommentsTable {
  id: string;
  workspace_id: string;
  thread_id: string;
  target_kind: 'record' | 'list-entry';
  entity_definition_id: string;
  entity_instance_id: string;
  content: string;
  mentions: Defaulted<Json>;
  styles: Defaulted<Json>;
  mentioned_member_ids: Defaulted<string[]>;
  resolved_at: Timestamp | null;
  resolved_by: Json | null;
  author: Json;
  created_by: Json;
  created_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export interface CommentReactionsTable {
  id: string;
  workspace_id: string;
  comment_id: string;
  emoji: string;
  member_id: string;
  created_at: CreatedAt;
}

export interface FavoriteDirectoriesTable {
  id: string;
  workspace_id: string;
  member_id: string;
  title: string;
  sort_order: string;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface FavoritesTable {
  id: string;
  workspace_id: string;
  member_id: string;
  favorite_type: string;
  entity_definition_id: string | null;
  target_id: string;
  directory_id: string | null;
  sort_order: string;
  created_at: CreatedAt;
}

export interface StorageEntriesTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  parent_folder_id: string | null;
  root_entry_id: string;
  entry_type: 'file' | 'folder';
  storage_provider: Defaulted<'agentic-crm'>;
  name: string;
  content_type: string | null;
  /** bigint → string */
  content_size: ColumnType<string | null, number | string | null, number | string | null>;
  object_key: string | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export interface UploadSessionsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  parent_folder_id: string | null;
  filename: string;
  content_type: string;
  content_size: ColumnType<string, number | string, number | string>;
  object_key: string;
  state: Defaulted<'pending' | 'accepted' | 'failed'>;
  error: string | null;
  file_entry_id: string | null;
  created_by: Json;
  created_at: CreatedAt;
  expires_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface CustomLayoutsTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  type: Defaulted<'record-page'>;
  title: Defaulted<string>;
  description: Defaulted<string>;
  sort_order: Defaulted<string>;
  is_system_layout: Defaulted<boolean>;
  elements: Json;
  version: Defaulted<number>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  updated_by: Json | null;
  archived_at: Timestamp | null;
}

export interface MemberPreferencesTable {
  member_id: string;
  workspace_id: string;
  time_zone: string | null;
  locale: string | null;
  week_start_day: number | null;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    notes: NotesTable;
    note_records: NoteRecordsTable;
    note_templates: NoteTemplatesTable;
    tasks: TasksTable;
    task_records: TaskRecordsTable;
    task_assignees: TaskAssigneesTable;
    comments: CommentsTable;
    comment_reactions: CommentReactionsTable;
    favorite_directories: FavoriteDirectoriesTable;
    favorites: FavoritesTable;
    storage_entries: StorageEntriesTable;
    upload_sessions: UploadSessionsTable;
    custom_layouts: CustomLayoutsTable;
    member_preferences: MemberPreferencesTable;
  }
}
