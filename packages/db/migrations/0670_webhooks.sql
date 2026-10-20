-- Webhooks (BACKLOG 6.07; J workspace-admin §6; Attio docs rest-api/guides/webhooks; CROSS-DOMAIN B.28).
-- Domain services record webhook events in their transaction as one change_log row (resource 'domain-events',
-- audience nobody, so the realtime gateway never forwards it). The worker fans committed events out into
-- webhook_deliveries — reading change_log by transaction id between the previous and the current snapshot xmin, so
-- every committed row is seen exactly once whatever the commit order — and delivers them with HMAC signatures and
-- exponential back-off.

CREATE TABLE webhooks (
  id uuid PRIMARY KEY,                         -- webhook_id
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  target_url text NOT NULL CHECK (target_url ~ '^https://'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'inactive')),
  secret text NOT NULL,                        -- HMAC-SHA256 key (hex); shown on creation and to admins
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  degraded_at timestamptz,
  last_delivery_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX webhooks_workspace ON webhooks (workspace_id, created_at) WHERE deleted_at IS NULL;

-- Subscriptions: (target URL, event type, filter) is unique per workspace (filter_key = canonical filter text,
-- key order and operation order ignored, null = empty $and). Checked by the domain across webhooks of one URL.
CREATE TABLE webhook_subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  webhook_id uuid NOT NULL REFERENCES webhooks (id),
  event_type text NOT NULL,
  filter jsonb,
  filter_key text NOT NULL,
  position int NOT NULL,
  UNIQUE (webhook_id, event_type, filter_key)
);
CREATE INDEX webhook_subscriptions_event ON webhook_subscriptions (workspace_id, event_type);

-- One row per (webhook, event); id = the Idempotency-Key header (stable across retries).
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  webhook_id uuid NOT NULL REFERENCES webhooks (id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,                      -- {webhook_id, events: [event]}
  is_test boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_status_code int,
  last_error text,
  attempt_log jsonb NOT NULL DEFAULT '[]',     -- [{at, statusCode, error, durationMs}]
  change_log_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_webhook ON webhook_deliveries (webhook_id, created_at DESC);

-- Fan-out cursor (one row, owner role only): every change_log row with xid < xmin has been fanned out.
CREATE TABLE webhook_fanout_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  xid_cursor xid8 NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO webhook_fanout_state (id, xid_cursor) VALUES (1, pg_snapshot_xmin(pg_current_snapshot()));
REVOKE ALL ON webhook_fanout_state FROM agentic_crm_app;

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhooks
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_subscriptions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
