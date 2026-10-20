-- Notifications (BACKLOG 5.05–5.06; B-shell/notifications.md §3–6; CROSS-DOMAIN B.27; decision "Notifications" in
-- research/architecture/decisions/slice5-contracts.md). Attio's v2 model: entries (one per event and recipient) are
-- grouped into inbox rows; consecutive entries with the same grouping key within the type's max gap share a row
-- (packages/contracts/src/notifications.ts holds the type registry). Read state lives on entries (acknowledged_at;
-- a row is read when every entry is), archive on rows. Producers write in the same transaction as the event (I1) and
-- emit a change_log row with resource 'notification' whose audience is the recipient's user.

CREATE TABLE notification_groups (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  recipient_member_id uuid NOT NULL REFERENCES workspace_members (id),
  type text NOT NULL,                       -- type of the newest entry
  topic text NOT NULL,
  group_key text,                           -- '<type>:<key value>'; NULL = never grouped (workflow-message)
  first_entry_at timestamptz NOT NULL,
  latest_entry_at timestamptz NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_groups_inbox ON notification_groups (recipient_member_id, latest_entry_at DESC, id DESC);
CREATE INDEX notification_groups_key ON notification_groups (recipient_member_id, group_key, latest_entry_at DESC)
  WHERE group_key IS NOT NULL AND archived_at IS NULL;

CREATE TABLE notification_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  group_id uuid NOT NULL REFERENCES notification_groups (id) ON DELETE CASCADE,
  recipient_member_id uuid NOT NULL REFERENCES workspace_members (id),
  type text NOT NULL,
  actor jsonb NOT NULL,                     -- source actor {type, id}
  payload jsonb NOT NULL,
  dedupe_key text,                          -- at most one entry per (recipient, key), e.g. 'comment:<id>'
  created_at timestamptz NOT NULL,
  acknowledged_at timestamptz,              -- read
  resolved_at timestamptz                   -- actionable types: the request was handled
);
CREATE UNIQUE INDEX notification_entries_dedupe ON notification_entries (recipient_member_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_entries_group ON notification_entries (group_id, created_at DESC, id DESC);
CREATE INDEX notification_entries_unread ON notification_entries (recipient_member_id, group_id)
  WHERE acknowledged_at IS NULL;

-- Per member, preference group and channel ('in-app' | 'email'); a missing row means the registry default.
CREATE TABLE notification_preferences (
  member_id uuid NOT NULL REFERENCES workspace_members (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  preference_group text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in-app', 'email')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, preference_group, channel)
);

-- Outbound copies for non-inbox channels. Slice 5 records email copies (pending); the worker marks them skipped until
-- slice 7 adds outbound email.
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  recipient_member_id uuid NOT NULL REFERENCES workspace_members (id),
  entry_id uuid,                            -- the inbox entry, when the in-app channel is on too
  type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email')),
  actor jsonb NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'skipped', 'sent', 'failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX notification_deliveries_pending ON notification_deliveries (created_at, id) WHERE status = 'pending';

ALTER TABLE notification_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_groups
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE notification_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_entries
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_deliveries
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
