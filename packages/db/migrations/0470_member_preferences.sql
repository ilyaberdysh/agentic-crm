-- Per-member calendar preferences (decisions X-09 / X-10 in slice3-contracts.md, CROSS-DOMAIN B.24): time zone and
-- week start used by task deadline buckets, note date buckets and (later) reports. NULL = derive on the client
-- (browser time zone; week start from the locale: ru / most of Europe → Monday, en-US → Sunday).

CREATE TABLE member_preferences (
  member_id uuid PRIMARY KEY REFERENCES workspace_members (id),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  time_zone text,                           -- IANA zone
  locale text,                              -- BCP 47 tag
  week_start_day smallint CHECK (week_start_day BETWEEN 0 AND 6), -- 0 = Sunday … 6 = Saturday
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE member_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_preferences
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
