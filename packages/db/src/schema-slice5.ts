// Kysely table types for migrations 0600–0649 (slice 5: record search index, notifications, notification
// preferences and email deliveries). Same conventions as schema.ts; merged into `DB` by interface augmentation.
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

/** Derived search rows (migration 0600); written only by the SQL function search_index_refresh(). */
export interface SearchIndexTable {
  instance_id: string;
  workspace_id: string;
  entity_definition_id: string;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  emails: string[];
  domains: string[];
  phones: string[];
  handles: string[];
  description: string;
  location: string;
  name_key: string;
  email_text: string;
  domain_text: string;
  phone_text: string;
  handle_text: string;
  words: string;
  extra_words: string;
  all_text: string;
  prefixes: string[];
  recency_at: Timestamp;
  indexed_at: CreatedAt;
}

/** One inbox row (v2 notification group): consecutive entries with the same grouping key (migration 0610). */
export interface NotificationGroupsTable {
  id: string;
  workspace_id: string;
  recipient_member_id: string;
  /** Type of the newest entry. */
  type: string;
  topic: string;
  /** `<type>:<grouping key value>`; null for types that are never grouped. */
  group_key: string | null;
  first_entry_at: Timestamp;
  latest_entry_at: Timestamp;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface NotificationEntriesTable {
  id: string;
  workspace_id: string;
  group_id: string;
  recipient_member_id: string;
  type: string;
  /** Source actor {type, id}. */
  actor: ColumnType<Json, Json, Json>;
  payload: ColumnType<Json, Json, Json>;
  dedupe_key: string | null;
  created_at: Timestamp;
  acknowledged_at: Timestamp | null;
  resolved_at: Timestamp | null;
}

export interface NotificationPreferencesTable {
  member_id: string;
  workspace_id: string;
  preference_group: string;
  channel: 'in-app' | 'email';
  enabled: boolean;
  updated_at: CreatedAt;
}

/** Outbound copies per non-inbox channel (email). Slice 5 records them; the worker marks them skipped until slice 7. */
export interface NotificationDeliveriesTable {
  id: string;
  workspace_id: string;
  recipient_member_id: string;
  entry_id: string | null;
  type: string;
  channel: 'email';
  actor: ColumnType<Json, Json, Json>;
  payload: ColumnType<Json, Json, Json>;
  status: ColumnType<'pending' | 'skipped' | 'sent' | 'failed', 'pending' | undefined, 'skipped' | 'sent' | 'failed'>;
  detail: string | null;
  created_at: CreatedAt;
  processed_at: Timestamp | null;
}

declare module './schema.ts' {
  interface DB {
    search_index: SearchIndexTable;
    notification_groups: NotificationGroupsTable;
    notification_entries: NotificationEntriesTable;
    notification_preferences: NotificationPreferencesTable;
    notification_deliveries: NotificationDeliveriesTable;
  }
}
