-- Composer, drafts, templates, signatures and outbox (slice 7a; BACKLOG 7.06–7.08 server; specs F composer.md §2–6,
-- F settings §2.3; CROSS-DOMAIN B.10, B.11, B.23). Drafts autosave per field (subject, body, recipients, sender, mass
-- send …): each field is written on its own and stamped in `field_updated_at`. Subject and body are text with
-- variable annotations (B.11): a variable occupies one `_` placeholder character with {path, field, fallback}.
-- Templates and signatures are rich-text documents (doc types 'email-template' / 'email-signature').
-- The outbox holds one row per email to deliver (Attio's email instance); the outbox job hands it to the
-- sender mailbox's connector (`test` records it as sent; Gmail in 7b).

CREATE TABLE message_drafts (
  id uuid PRIMARY KEY,                        -- client-minted (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),  -- drafts are private to their creator
  sender_mailbox_id uuid REFERENCES mailboxes (id),
  subject jsonb NOT NULL DEFAULT '{"text": "", "variables": []}',
  body jsonb NOT NULL DEFAULT '[]',           -- blocks (packages/editor model, with variables)
  to_recipients jsonb NOT NULL DEFAULT '[]',  -- [{emailAddress, name, record?}]
  cc_recipients jsonb NOT NULL DEFAULT '[]',
  bcc_recipients jsonb NOT NULL DEFAULT '[]',
  is_mass_send boolean NOT NULL DEFAULT false,
  signature_id uuid,
  parent_message_id uuid,                     -- reply / forward source (email_messages.id)
  template_id uuid,                           -- created from a template
  revision integer NOT NULL DEFAULT 1,
  field_updated_at jsonb NOT NULL DEFAULT '{}',
  send_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX message_drafts_member ON message_drafts (member_id, created_at DESC)
  WHERE deleted_at IS NULL AND send_requested_at IS NULL;

CREATE TABLE message_draft_attachments (
  id uuid PRIMARY KEY,                        -- client-minted
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  draft_id uuid NOT NULL REFERENCES message_drafts (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  content_type text NOT NULL,
  content_size bigint NOT NULL CHECK (content_size >= 0),
  object_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'committed')),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX message_draft_attachments_draft ON message_draft_attachments (draft_id, position) WHERE deleted_at IS NULL;

CREATE TABLE email_templates (
  id uuid PRIMARY KEY,                        -- client-minted
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 1000), -- '' = "Untitled Template"
  subject_document_id uuid NOT NULL,
  body_document_id uuid NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX email_templates_created ON email_templates (workspace_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE email_template_favorites (
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  template_id uuid NOT NULL REFERENCES email_templates (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, template_id)
);

CREATE TABLE mailbox_signatures (
  id uuid PRIMARY KEY,                        -- client-minted
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  title text NOT NULL DEFAULT 'New signature' CHECK (char_length(title) <= 200),
  document_id uuid NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX mailbox_signatures_mailbox ON mailbox_signatures (mailbox_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY,                        -- email instance id
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes (id),
  draft_id uuid REFERENCES message_drafts (id),
  parent_type text NOT NULL CHECK (parent_type IN ('message-draft', 'message-draft-mass-send')),
  parent_message_id uuid,
  recipient_entity_definition_id uuid,        -- mass send: the record the variables were merged from
  recipient_entity_instance_id uuid,
  from_address text NOT NULL,
  to_recipients jsonb NOT NULL,               -- [{emailAddress, name}]
  cc_recipients jsonb NOT NULL DEFAULT '[]',
  bcc_recipients jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',    -- [{id, name, contentType, size, objectKey}]
  delivery_state text NOT NULL CHECK (delivery_state IN ('scheduled', 'error', 'completed', 'failed', 'canceled')),
  delivery_scheduled_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error_code text,
  sent_at timestamptz,
  provider_message_id text,
  rfc_message_id text,
  canceled_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbound_emails_due ON outbound_emails (delivery_scheduled_at)
  WHERE delivery_state IN ('scheduled', 'error');
CREATE INDEX outbound_emails_member ON outbound_emails (member_id, delivery_scheduled_at DESC);
CREATE INDEX outbound_emails_mailbox_sent ON outbound_emails (mailbox_id, sent_at) WHERE sent_at IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'message_drafts', 'message_draft_attachments', 'email_templates', 'email_template_favorites',
    'mailbox_signatures', 'outbound_emails'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())',
      t);
  END LOOP;
END
$$;
