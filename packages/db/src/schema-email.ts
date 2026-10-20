// Kysely table types for migrations 0700–0749 (slice 7: email and calendar — mailboxes, synced messages, meetings,
// call recordings, sharing, suppression, connection strength, composer, templates, signatures, outbox). Same
// conventions as schema.ts; merged into `DB` by interface augmentation.
import type { ColumnType, Generated } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

type Defaulted<T> = ColumnType<T, T | undefined, T>;
type JsonDefaulted = ColumnType<Json, Json | undefined, Json>;

export type VisibilityLevel = 'full-access' | 'subject-line' | 'metadata-only';
export type RecordCreationMode = 'all' | 'selective' | 'none';
export type ProviderType = 'test' | 'gmail';
export type ParticipantStatus = 'accepted' | 'tentative' | 'declined' | 'pending';

export interface WorkspaceEmailSettingsTable {
  workspace_id: string;
  default_visibility: Defaulted<VisibilityLevel>;
  record_creation: Defaulted<RecordCreationMode>;
  auto_create_companies: Defaulted<boolean>;
  unprotected_domains: Defaulted<string[]>;
  updated_by: Json | null;
  updated_at: CreatedAt;
}

export interface ConnectedAccountsTable {
  id: string;
  workspace_id: string;
  member_id: string;
  provider: ProviderType;
  external_account_id: string;
  email_address: string;
  credential_state: Defaulted<'active' | 'error-detected' | 'disconnected'>;
  credential_error: string | null;
  credentials: Json | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  disconnected_at: Timestamp | null;
}

export interface MailboxesTable {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  member_id: string;
  provider_type: ProviderType;
  email_address: string;
  aliases: Defaulted<string[]>;
  is_default: Defaulted<boolean>;
  mail_sync_enabled: Defaulted<boolean>;
  calendar_sync_enabled: Defaulted<boolean>;
  mail_delivery_enabled: Defaulted<boolean>;
  default_visibility: VisibilityLevel;
  sync_state: Defaulted<'pre-sync' | 'historic' | 'realtime'>;
  mail_cursor: string | null;
  calendar_cursor: string | null;
  messages_synced: Defaulted<number>;
  events_synced: Defaulted<number>;
  last_synced_at: Timestamp | null;
  sync_error: string | null;
  default_signature_id: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  archived_at: Timestamp | null;
}

export interface EmailThreadsTable {
  id: string;
  workspace_id: string;
  subject: Defaulted<string>;
  first_message_at: Timestamp;
  last_message_at: Timestamp;
  created_at: CreatedAt;
}

export interface EmailMessagesTable {
  id: string;
  workspace_id: string;
  thread_id: string;
  rfc_message_id: string;
  in_reply_to: string | null;
  references_ids: Defaulted<string[]>;
  subject: Defaulted<string>;
  snippet: Defaulted<string>;
  body_text: Defaulted<string>;
  body_html: string | null;
  sent_at: Timestamp;
  has_attachments: Defaulted<boolean>;
  attachments: JsonDefaulted;
  is_internal: Defaulted<boolean>;
  is_protected: Defaulted<boolean>;
  created_at: CreatedAt;
}

export interface EmailMessageCopiesTable {
  id: string;
  workspace_id: string;
  message_id: string;
  mailbox_id: string;
  member_id: string;
  provider_message_id: string;
  provider_thread_id: string | null;
  direction: 'inbound' | 'outbound';
  labels: Defaulted<string[]>;
  synced_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface EmailParticipantsTable {
  message_id: string;
  workspace_id: string;
  role: 'from' | 'reply-to' | 'to' | 'cc' | 'bcc';
  position: number;
  email_address: string;
  original_email_address: string;
  domain: string;
  name: string | null;
  member_id: string | null;
  person_id: string | null;
  company_id: string | null;
}

export interface EmailMessageRecordsTable {
  message_id: string;
  workspace_id: string;
  thread_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  sent_at: Timestamp;
}

export interface EmailGrantsTable {
  id: string;
  workspace_id: string;
  owner_member_id: string;
  resource_type: 'mailbox' | 'thread' | 'record';
  mailbox_id: string | null;
  thread_id: string | null;
  entity_definition_id: string | null;
  entity_instance_id: string | null;
  target_type: 'member' | 'workspace';
  target_member_id: string | null;
  level: VisibilityLevel;
  created_by: Json;
  created_at: CreatedAt;
}

export interface RecordSuppressionsTable {
  id: string;
  workspace_id: string;
  kind: 'domain' | 'email';
  value: string;
  created_by: Json;
  created_at: CreatedAt;
}

export interface ProtectedContactsTable {
  id: string;
  workspace_id: string;
  kind: 'domain' | 'email';
  value: string;
  enforcement: Defaulted<'protected' | 'blocked'>;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface MailboxBlocklistTable {
  id: string;
  workspace_id: string;
  mailbox_id: string;
  kind: 'domain' | 'email';
  value: string;
  created_by: Json;
  created_at: CreatedAt;
}

export interface MeetingsTable {
  id: string;
  workspace_id: string;
  ical_uid: string | null;
  source: 'calendar' | 'manual' | 'api';
  title: Defaulted<string>;
  description: Defaulted<string>;
  is_all_day: Defaulted<boolean>;
  start_at: Timestamp;
  end_at: Timestamp;
  start_timezone: string | null;
  end_timezone: string | null;
  start_date: string | null;
  end_date: string | null;
  status: Defaulted<'confirmed' | 'tentative' | 'cancelled'>;
  conference_url: string | null;
  location: string | null;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json | null;
}

export interface MeetingParticipantsTable {
  id: string;
  workspace_id: string;
  meeting_id: string;
  position: number;
  email_address: string | null;
  original_email_address: string | null;
  domain: string | null;
  name: string | null;
  is_organizer: Defaulted<boolean>;
  status: Defaulted<ParticipantStatus>;
  member_id: string | null;
  person_id: string | null;
  company_id: string | null;
}

export interface MeetingRecordsTable {
  meeting_id: string;
  workspace_id: string;
  entity_definition_id: string;
  entity_instance_id: string;
  position: number;
  created_at: CreatedAt;
}

export interface CalendarEventsTable {
  id: string;
  workspace_id: string;
  meeting_id: string;
  mailbox_id: string;
  member_id: string;
  provider_event_id: string;
  self_status: Defaulted<ParticipantStatus>;
  synced_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface CallRecordingsTable {
  id: string;
  workspace_id: string;
  meeting_id: string;
  status: 'processing' | 'completed' | 'failed';
  video_url: string | null;
  created_by: Json;
  created_at: CreatedAt;
  deleted_at: Timestamp | null;
  // Slice 10 (migration 0960): processing, summaries, search text.
  summary: string | null;
  summary_status: CallProcessingStatus | null;
  concise_summary: string | null;
  concise_summary_status: CallProcessingStatus | null;
  processing_error: string | null;
  processed_at: Timestamp | null;
  transcript_text: Defaulted<string>;
  transcript_hash: string | null;
  segment_count: Defaulted<number>;
  duration_seconds: Defaulted<number>;
  updated_at: CreatedAt;
  deleted_by: Json | null;
}

export type CallProcessingStatus = 'queued' | 'executing' | 'completed' | 'failed';

export interface CallTranscriptSegmentsTable {
  recording_id: string;
  workspace_id: string;
  position: number;
  speech: string;
  start_time: number;
  end_time: number;
  speaker_name: string;
  speaker_email: string | null;
  participant_id: string | null;
  /** call_speakers row (migration 0960); null only for rows written before it. */
  speaker_id: string | null;
}

export interface ConnectionStrengthsTable {
  workspace_id: string;
  member_id: string;
  entity_instance_id: string;
  entity_definition_id: string;
  score: number;
  bucket: string;
  email_count: number;
  meeting_count: number;
  last_interaction_at: Timestamp | null;
  computed_at: CreatedAt;
}

export interface TestConnectorItemsTable {
  seq: Generated<string>;
  workspace_id: string;
  mailbox_id: string;
  kind: 'message' | 'message-deleted' | 'event' | 'event-deleted';
  payload: Json;
  created_at: CreatedAt;
}

export interface TestConnectorSentTable {
  id: string;
  workspace_id: string;
  mailbox_id: string;
  payload: Json;
  created_at: CreatedAt;
}

export interface MessageDraftsTable {
  id: string;
  workspace_id: string;
  member_id: string;
  sender_mailbox_id: string | null;
  subject: JsonDefaulted;
  body: JsonDefaulted;
  to_recipients: JsonDefaulted;
  cc_recipients: JsonDefaulted;
  bcc_recipients: JsonDefaulted;
  is_mass_send: Defaulted<boolean>;
  signature_id: string | null;
  parent_message_id: string | null;
  template_id: string | null;
  revision: Defaulted<number>;
  field_updated_at: JsonDefaulted;
  send_requested_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface MessageDraftAttachmentsTable {
  id: string;
  workspace_id: string;
  draft_id: string;
  name: string;
  content_type: string;
  content_size: ColumnType<string, number | string, number | string>;
  object_key: string;
  state: Defaulted<'pending' | 'committed'>;
  position: number;
  created_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface EmailTemplatesTable {
  id: string;
  workspace_id: string;
  title: Defaulted<string>;
  subject_document_id: string;
  body_document_id: string;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface EmailTemplateFavoritesTable {
  member_id: string;
  template_id: string;
  workspace_id: string;
  created_at: CreatedAt;
}

export interface MailboxSignaturesTable {
  id: string;
  workspace_id: string;
  mailbox_id: string;
  title: Defaulted<string>;
  document_id: string;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export type DeliveryState = 'scheduled' | 'error' | 'completed' | 'failed' | 'canceled';

export interface OutboundEmailsTable {
  id: string;
  workspace_id: string;
  member_id: string;
  mailbox_id: string;
  draft_id: string | null;
  parent_type: 'message-draft' | 'message-draft-mass-send';
  parent_message_id: string | null;
  recipient_entity_definition_id: string | null;
  recipient_entity_instance_id: string | null;
  from_address: string;
  to_recipients: Json;
  cc_recipients: JsonDefaulted;
  bcc_recipients: JsonDefaulted;
  subject: string;
  body_text: string;
  body_html: string;
  attachments: JsonDefaulted;
  delivery_state: DeliveryState;
  delivery_scheduled_at: Timestamp;
  attempts: Defaulted<number>;
  last_attempt_at: Timestamp | null;
  last_error_code: string | null;
  sent_at: Timestamp | null;
  provider_message_id: string | null;
  rfc_message_id: string | null;
  canceled_by: Json | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    workspace_email_settings: WorkspaceEmailSettingsTable;
    connected_accounts: ConnectedAccountsTable;
    mailboxes: MailboxesTable;
    email_threads: EmailThreadsTable;
    email_messages: EmailMessagesTable;
    email_message_copies: EmailMessageCopiesTable;
    email_participants: EmailParticipantsTable;
    email_message_records: EmailMessageRecordsTable;
    email_grants: EmailGrantsTable;
    record_suppressions: RecordSuppressionsTable;
    protected_contacts: ProtectedContactsTable;
    mailbox_blocklist: MailboxBlocklistTable;
    meetings: MeetingsTable;
    meeting_participants: MeetingParticipantsTable;
    meeting_records: MeetingRecordsTable;
    calendar_events: CalendarEventsTable;
    call_recordings: CallRecordingsTable;
    call_transcript_segments: CallTranscriptSegmentsTable;
    connection_strengths: ConnectionStrengthsTable;
    test_connector_items: TestConnectorItemsTable;
    test_connector_sent: TestConnectorSentTable;
    message_drafts: MessageDraftsTable;
    message_draft_attachments: MessageDraftAttachmentsTable;
    email_templates: EmailTemplatesTable;
    email_template_favorites: EmailTemplateFavoritesTable;
    mailbox_signatures: MailboxSignaturesTable;
    outbound_emails: OutboundEmailsTable;
  }
}
