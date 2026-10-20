// Kysely table types for migrations 0960–0989 (slice 10: calls — speakers, insight templates, snapshots, sections,
// previews, call insights, member call settings). Same conventions as schema.ts; merged into `DB` by interface
// augmentation. The call_recordings / call_transcript_segments columns added by 0960 live in schema-email.ts.
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';
import type { CallProcessingStatus } from './schema-email.ts';

type Defaulted<T> = ColumnType<T, T | undefined, T>;
type JsonDefaulted = ColumnType<Json, Json | undefined, Json>;

export interface CallSpeakersTable {
  id: string;
  workspace_id: string;
  recording_id: string;
  position: number;
  name: string;
  email_address: string | null;
  participant_id: string | null;
  manual_participant_id: string | null;
  member_id: string | null;
}

export type InsightTemplateStatus = 'draft' | 'enabled' | 'disabled';
export type InsightSnapshotStatus = 'draft' | 'active' | 'superseded' | 'discarded';
export type InsightSectionType = 'plaintext' | 'list';

export interface InsightTemplatesTable {
  id: string;
  workspace_id: string;
  title: string | null;
  ai_title: string | null;
  status: Defaulted<InsightTemplateStatus>;
  is_transient: Defaulted<boolean>;
  sort_order: string;
  first_enabled_at: Timestamp | null;
  archived_at: Timestamp | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface InsightTemplateSnapshotsTable {
  id: string;
  workspace_id: string;
  template_id: string;
  parent_snapshot_id: string | null;
  status: InsightSnapshotStatus;
  first_touched_at: Timestamp | null;
  last_touched_at: Timestamp | null;
  published_at: Timestamp | null;
  published_by: Json | null;
  created_by: Json;
  created_at: CreatedAt;
}

export interface InsightTemplateSectionsTable {
  id: string;
  workspace_id: string;
  snapshot_id: string;
  title_document_id: string;
  prompt_document_id: string;
  type: InsightSectionType;
  sort_order: string;
  created_by: Json;
  created_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface InsightTemplatePreviewsTable {
  id: string;
  workspace_id: string;
  template_id: string;
  snapshot_id: string;
  recording_id: string;
  status: CallProcessingStatus;
  sections: JsonDefaulted;
  error: string | null;
  credit_cost: Defaulted<number>;
  draft_touched_at: Timestamp | null;
  requested_by_member_id: string | null;
  created_by: Json;
  created_at: CreatedAt;
  completed_at: Timestamp | null;
}

export interface CallInsightsTable {
  id: string;
  workspace_id: string;
  recording_id: string;
  template_id: string;
  snapshot_id: string;
  status: CallProcessingStatus;
  sections: JsonDefaulted;
  error: string | null;
  credit_cost: Defaulted<number>;
  input_tokens: number | null;
  output_tokens: number | null;
  requested_by_member_id: string | null;
  created_by: Json;
  created_at: CreatedAt;
  completed_at: Timestamp | null;
}

export interface MemberCallSettingsTable {
  member_id: string;
  workspace_id: string;
  default_insight_template_id: string | null;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    call_speakers: CallSpeakersTable;
    insight_templates: InsightTemplatesTable;
    insight_template_snapshots: InsightTemplateSnapshotsTable;
    insight_template_sections: InsightTemplateSectionsTable;
    insight_template_previews: InsightTemplatePreviewsTable;
    call_insights: CallInsightsTable;
    member_call_settings: MemberCallSettingsTable;
  }
}
