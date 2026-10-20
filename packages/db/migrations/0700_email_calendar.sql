-- Email and calendar (slice 7a; BACKLOG 7.01, 7.02, 7.04, 7.05; specs F README §4, F settings §1–4, A README §4.14;
-- decisions in research/architecture/decisions/slice7-contracts.md). Connector-agnostic: every row here is written by
-- packages/domain/src/{email,calendar,meetings,interactions,connectors} from what an EmailCalendarConnector returns
-- (the `test` connector now, Gmail / Google Calendar in 7b).
--
-- Model:
--   connected_accounts      a member's provider identity (OAuth credentials in 7b)
--   mailboxes               one per synced address; default visibility level + sync cursors
--   email_threads           conversation; one per thread across every mailbox that synced it
--   email_messages          one logical message per RFC Message-ID (dedupe across mailboxes, "via N mailboxes")
--   email_message_copies    the per-mailbox copy (owner = mailbox member); visibility is decided per copy
--   email_participants      from / reply-to / to / cc / bcc with the matched person / company / member
--   email_message_records   index: records a message is associated with (participants' people and companies)
--   email_grants            sharing beyond the mailbox default (mailbox / thread / record × member / workspace)
--   meetings (+ participants, linked records, calendar_events per mailbox copy)
--   call_recordings + call_transcript_segments   transcript-only recordings (slice 10 builds on these)
--   connection_strengths    per (member, record) score of the connection-strength job
--   record suppression, workspace protected/blocked contacts, mailbox-only blocklist, workspace email settings
--   test_connector_items / test_connector_sent    the test connector's mailbox feed and sent log
-- Actors on these cold tables are jsonb {type, id} (migration 0200 convention).

-- Visibility levels (decision C.4 #13): full-access > subject-line > metadata-only.

CREATE TABLE workspace_email_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  default_visibility text NOT NULL DEFAULT 'subject-line'
    CHECK (default_visibility IN ('full-access', 'subject-line', 'metadata-only')),
  record_creation text NOT NULL DEFAULT 'selective' CHECK (record_creation IN ('all', 'selective', 'none')),
  auto_create_companies boolean NOT NULL DEFAULT true,
  -- Internal domains whose system-default protection was switched off ("Protect <domain>" switch).
  unprotected_domains text[] NOT NULL DEFAULT '{}',
  updated_by jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connected_accounts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  provider text NOT NULL CHECK (provider IN ('test', 'gmail')),
  external_account_id text NOT NULL,          -- provider's account id (the address for the test connector)
  email_address text NOT NULL,
  credential_state text NOT NULL DEFAULT 'active' CHECK (credential_state IN ('active', 'error-detected', 'disconnected')),
  credential_error text,
  credentials jsonb,                          -- provider tokens (7b); never returned by the API
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz
);
CREATE UNIQUE INDEX connected_accounts_identity ON connected_accounts (workspace_id, provider, external_account_id)
  WHERE disconnected_at IS NULL;

CREATE TABLE mailboxes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  connected_account_id uuid NOT NULL REFERENCES connected_accounts (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  provider_type text NOT NULL CHECK (provider_type IN ('test', 'gmail')),
  email_address text NOT NULL,                -- normalised primary address
  aliases text[] NOT NULL DEFAULT '{}',       -- other normalised addresses of the mailbox (send-as)
  is_default boolean NOT NULL DEFAULT false,  -- the member's default sending mailbox
  mail_sync_enabled boolean NOT NULL DEFAULT true,
  calendar_sync_enabled boolean NOT NULL DEFAULT true,
  mail_delivery_enabled boolean NOT NULL DEFAULT true,
  default_visibility text NOT NULL CHECK (default_visibility IN ('full-access', 'subject-line', 'metadata-only')),
  sync_state text NOT NULL DEFAULT 'pre-sync' CHECK (sync_state IN ('pre-sync', 'historic', 'realtime')),
  mail_cursor text,                           -- connector cursor (null = initial sync not started)
  calendar_cursor text,
  messages_synced integer NOT NULL DEFAULT 0,
  events_synced integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  sync_error text,
  default_signature_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz                     -- removed (disconnected) mailbox; its copies are hidden
);
CREATE INDEX mailboxes_member ON mailboxes (member_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX mailboxes_address ON mailboxes (workspace_id, email_address) WHERE archived_at IS NULL;

CREATE TABLE email_threads (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  subject text NOT NULL DEFAULT '',
  first_message_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  thread_id uuid NOT NULL REFERENCES email_threads (id),
  rfc_message_id text NOT NULL,               -- Message-ID header (dedupe key across mailboxes)
  in_reply_to text,
  references_ids text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  body_html text,
  sent_at timestamptz NOT NULL,
  has_attachments boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]',    -- [{id, name, contentType, size}]
  is_internal boolean NOT NULL DEFAULT false, -- only workspace members / internal addresses take part
  is_protected boolean NOT NULL DEFAULT false,-- involves a workspace protected contact (visible to owners only)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_messages_rfc ON email_messages (workspace_id, rfc_message_id);
CREATE INDEX email_messages_thread ON email_messages (thread_id, sent_at);

CREATE TABLE email_message_copies (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  message_id uuid NOT NULL REFERENCES email_messages (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),   -- mailbox owner
  provider_message_id text NOT NULL,
  provider_thread_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  labels text[] NOT NULL DEFAULT '{}',
  synced_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX email_message_copies_provider ON email_message_copies (mailbox_id, provider_message_id);
CREATE INDEX email_message_copies_message ON email_message_copies (message_id) WHERE deleted_at IS NULL;
CREATE INDEX email_message_copies_thread ON email_message_copies (mailbox_id, provider_thread_id);

CREATE TABLE email_participants (
  message_id uuid NOT NULL REFERENCES email_messages (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  role text NOT NULL CHECK (role IN ('from', 'reply-to', 'to', 'cc', 'bcc')),
  position integer NOT NULL,
  email_address text NOT NULL,                -- normalised
  original_email_address text NOT NULL,
  domain text NOT NULL,
  name text,
  member_id uuid,                             -- a workspace member's address
  person_id uuid,                             -- matched / created people record
  company_id uuid,                            -- matched / created company record (by domain)
  PRIMARY KEY (message_id, role, position)
);
CREATE INDEX email_participants_address ON email_participants (workspace_id, email_address);

CREATE TABLE email_message_records (
  message_id uuid NOT NULL REFERENCES email_messages (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  thread_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  sent_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, entity_instance_id)
);
CREATE INDEX email_message_records_record ON email_message_records (entity_instance_id, sent_at DESC);

CREATE TABLE email_grants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  owner_member_id uuid NOT NULL REFERENCES workspace_members (id), -- whose emails are shared
  resource_type text NOT NULL CHECK (resource_type IN ('mailbox', 'thread', 'record')),
  mailbox_id uuid REFERENCES mailboxes (id),
  thread_id uuid REFERENCES email_threads (id),
  entity_definition_id uuid,
  entity_instance_id uuid,
  target_type text NOT NULL CHECK (target_type IN ('member', 'workspace')),
  target_member_id uuid REFERENCES workspace_members (id),
  level text NOT NULL CHECK (level IN ('full-access', 'subject-line', 'metadata-only')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((resource_type = 'mailbox') = (mailbox_id IS NOT NULL)),
  CHECK ((resource_type = 'thread') = (thread_id IS NOT NULL)),
  CHECK ((resource_type = 'record') = (entity_instance_id IS NOT NULL)),
  CHECK ((target_type = 'member') = (target_member_id IS NOT NULL))
);
CREATE UNIQUE INDEX email_grants_unique ON email_grants (
  owner_member_id, resource_type,
  coalesce(mailbox_id, thread_id, entity_instance_id),
  target_type, coalesce(target_member_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX email_grants_target ON email_grants (workspace_id, target_member_id);

-- Settings → Email and calendar → Record creation → Record suppression (F settings §4.2).
CREATE TABLE record_suppressions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  kind text NOT NULL CHECK (kind IN ('domain', 'email')),
  value text NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX record_suppressions_value ON record_suppressions (workspace_id, kind, value);

-- Settings → Email and calendar → Email visibility → Workspace protected and blocked contacts (F settings §4.1).
CREATE TABLE protected_contacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  kind text NOT NULL CHECK (kind IN ('domain', 'email')),
  value text NOT NULL,
  enforcement text NOT NULL DEFAULT 'protected' CHECK (enforcement IN ('protected', 'blocked')),
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX protected_contacts_value ON protected_contacts (workspace_id, kind, value);

-- Mailbox-only blocklist (F settings §2.2): messages from / to these never appear in Attio.
CREATE TABLE mailbox_blocklist (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  kind text NOT NULL CHECK (kind IN ('domain', 'email')),
  value text NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mailbox_blocklist_value ON mailbox_blocklist (mailbox_id, kind, value);

CREATE TABLE meetings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  ical_uid text,                              -- calendar dedupe key across mailboxes (null for manual / API)
  source text NOT NULL CHECK (source IN ('calendar', 'manual', 'api')),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_all_day boolean NOT NULL DEFAULT false,
  start_at timestamptz NOT NULL,              -- all-day: start date 00:00 UTC
  end_at timestamptz NOT NULL,                -- exclusive
  start_timezone text,
  end_timezone text,
  start_date date,                            -- all-day only
  end_date date,                              -- all-day only (exclusive)
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
  conference_url text,
  location text,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
CREATE UNIQUE INDEX meetings_ical ON meetings (workspace_id, ical_uid) WHERE ical_uid IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX meetings_start ON meetings (workspace_id, start_at, id) WHERE deleted_at IS NULL;

CREATE TABLE meeting_participants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  meeting_id uuid NOT NULL REFERENCES meetings (id),
  position integer NOT NULL,
  email_address text,                         -- normalised; null for name-only participants
  original_email_address text,
  domain text,
  name text,
  is_organizer boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('accepted', 'tentative', 'declined', 'pending')),
  member_id uuid,
  person_id uuid,
  company_id uuid
);
CREATE INDEX meeting_participants_meeting ON meeting_participants (meeting_id, position);
CREATE INDEX meeting_participants_person ON meeting_participants (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX meeting_participants_company ON meeting_participants (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX meeting_participants_address ON meeting_participants (workspace_id, email_address);

-- Linked records chosen explicitly (UI "Linked records", API linked_records). Participants' people and companies are
-- associated through meeting_participants and are not listed here.
CREATE TABLE meeting_records (
  meeting_id uuid NOT NULL REFERENCES meetings (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, entity_instance_id)
);
CREATE INDEX meeting_records_record ON meeting_records (entity_instance_id);

-- The synced calendar copies of a meeting (one per mailbox that has the event).
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  meeting_id uuid NOT NULL REFERENCES meetings (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  provider_event_id text NOT NULL,
  self_status text NOT NULL DEFAULT 'pending' CHECK (self_status IN ('accepted', 'tentative', 'declined', 'pending')),
  synced_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX calendar_events_provider ON calendar_events (mailbox_id, provider_event_id);
CREATE INDEX calendar_events_meeting ON calendar_events (meeting_id) WHERE deleted_at IS NULL;

-- Transcript-only call recordings (D-20; I calls §11; public /v2/meetings/{id}/call_recordings). Slice 10 adds
-- summaries, insights and the call pages on top of these rows.
CREATE TABLE call_recordings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  meeting_id uuid NOT NULL REFERENCES meetings (id),
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  video_url text,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX call_recordings_meeting ON call_recordings (meeting_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE call_transcript_segments (
  recording_id uuid NOT NULL REFERENCES call_recordings (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  position integer NOT NULL,
  speech text NOT NULL,
  start_time double precision NOT NULL,       -- seconds from the start of the call
  end_time double precision NOT NULL,
  speaker_name text NOT NULL,
  speaker_email text,
  participant_id uuid,                        -- meeting participant matched by email
  PRIMARY KEY (recording_id, position)
);

-- Connection strength (decision C.4 #12): per member and record, recomputed by the worker job.
CREATE TABLE connection_strengths (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  entity_instance_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL,
  score double precision NOT NULL,
  bucket text NOT NULL,
  email_count integer NOT NULL,
  meeting_count integer NOT NULL,
  last_interaction_at timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, entity_instance_id)
);
CREATE INDEX connection_strengths_record ON connection_strengths (entity_instance_id, score DESC);

-- The test connector (7a): an append-only feed per mailbox that sync reads with a cursor (seq), and the sent log.
CREATE TABLE test_connector_items (
  seq bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  kind text NOT NULL CHECK (kind IN ('message', 'message-deleted', 'event', 'event-deleted')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_connector_items_feed ON test_connector_items (mailbox_id, seq);

CREATE TABLE test_connector_sent (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Email signatures are rich-text documents (B.10): extend the document types.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN ('note', 'note-template', 'email-template', 'email-signature', 'insight-section'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspace_email_settings', 'connected_accounts', 'mailboxes', 'email_threads', 'email_messages',
    'email_message_copies', 'email_participants', 'email_message_records', 'email_grants', 'record_suppressions',
    'protected_contacts', 'mailbox_blocklist', 'meetings', 'meeting_participants', 'meeting_records',
    'calendar_events', 'call_recordings', 'call_transcript_segments', 'connection_strengths',
    'test_connector_items', 'test_connector_sent'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())',
      t);
  END LOOP;
END
$$;
