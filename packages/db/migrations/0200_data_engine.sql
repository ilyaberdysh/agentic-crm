-- Data engine (ARCHITECTURE D-06, spike S1 §8–9, sql/10_final_schema.sql; specs A §4.3–4.9).
--   truth + history : attribute_values (typed EAV, one row per value, active_from/active_until; I6)
--   views           : proj.p_<definition> typed projection per entity definition, created and maintained by
--                     packages/domain in the same transaction as the value rows; rebuildable from the EAV
--   outbox          : change_log (contract: packages/realtime ChangeLogRow)
--
-- Actor columns on hot tables are (type smallint, id uuid). Type codes (packages/domain/src/actors.ts):
--   1 workspace-member · 2 api-token · 3 system · 4 workflow · 5 app · 6 ai-autofill-attribute ·
--   7 formula-attribute · 8 enrichment-provider · 9 comint · 10 workflow-run · 11 import
-- Cold tables store the actor as jsonb {type, id}.

-- Text sort/compare key (S1 compiler rule 4): lower + unaccent, compared in COLLATE "C".
CREATE OR REPLACE FUNCTION norm_key(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT lower(unaccent('unaccent'::regdictionary, t)) $$;

CREATE TABLE entity_definitions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_type text NOT NULL CHECK (entity_type IN (
    'person-record', 'company-record', 'standard-object', 'custom-record', 'collection-entry', 'task',
    'workspace-member', 'interface')),
  standard_object_type text CHECK (standard_object_type IN ('deal', 'user', 'workspace')),
  entity_sub_type text,
  api_slug text NOT NULL,
  singular_noun text NOT NULL,
  plural_noun text NOT NULL,
  icon text,
  image_path jsonb,                         -- attribute path used as the record avatar
  epithet_path jsonb,                       -- attribute path used as the record display name
  interface_ids uuid[] NOT NULL DEFAULT '{}', -- direct interface parents (entity_interface_bindings)
  sort_order text COLLATE "C",
  is_archived boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false, -- standard/system definition: slug locked, cannot be deleted
  seeded_at timestamptz,                    -- system attributes and default views created (standard objects seed on first activation)
  projection_table text,                    -- table name in schema proj; NULL for interfaces
  next_attnum int NOT NULL DEFAULT 1,       -- allocator for attribute_definitions.attnum (never reused)
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, api_slug)
);

CREATE TABLE attribute_definitions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  api_slug text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN (
    'text', 'number', 'checkbox', 'currency', 'date', 'timestamp', 'rating', 'pipeline', 'select',
    'entity-reference', 'actor-reference', 'location', 'domain', 'email-address', 'phone-number', 'interaction',
    'personal-name')),
  is_multiselect boolean NOT NULL DEFAULT false,
  is_unique boolean NOT NULL DEFAULT false,
  is_required boolean NOT NULL DEFAULT false,
  is_historic boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  system_attribute_type text,               -- A attribute-types §4 (e.g. 'id', 'created-at', 'domains')
  is_read_only boolean NOT NULL DEFAULT false, -- written only by the system (record id, created_*, interactions)
  is_hidden boolean NOT NULL DEFAULT false,    -- hidden from the public API (list_entries, next_due_task)
  config jsonb NOT NULL DEFAULT '{}',          -- numberConfiguration / currencyConfiguration / entityReferenceConfiguration
  default_value jsonb,                         -- {type: 'static'|'dynamic', identifier}
  relationship_attribute_id uuid,              -- the other side of a relationship pair
  interface_attribute_id uuid,                 -- interface attribute this attribute implements
  attnum int NOT NULL,                         -- stable, never reused: projection column a<attnum>
  is_indexed boolean NOT NULL DEFAULT false,   -- projection index exists (created on demand)
  sort_order text COLLATE "C" NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_definition_id, api_slug),
  UNIQUE (entity_definition_id, attnum)
);
CREATE INDEX attribute_definitions_def ON attribute_definitions (entity_definition_id, sort_order);
CREATE INDEX attribute_definitions_ws_type ON attribute_definitions (workspace_id, type);

-- Select options (kind 'option', colours pastel_*) and pipeline stages (kind 'stage', colours block_*).
CREATE TABLE select_options (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  attribute_id uuid NOT NULL REFERENCES attribute_definitions (id),
  kind text NOT NULL CHECK (kind IN ('option', 'stage')),
  title text NOT NULL,
  color text NOT NULL,
  sort_order text COLLATE "C" NOT NULL,
  lifecycle_phase text CHECK (lifecycle_phase IN ('ACTIVE', 'WON', 'LOST')),
  target_time_in_status text,               -- ISO-8601 duration, NULL = none
  celebration_enabled boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX select_options_attr ON select_options (attribute_id, sort_order);

-- Records and list entries: narrow header, no values inside (A §4.5). Delete is soft (decision X-22).
CREATE TABLE entity_instances (
  id uuid PRIMARY KEY,                      -- UUIDv7, client-minted on UI creates (I3)
  workspace_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL REFERENCES entity_definitions (id),
  version bigint NOT NULL DEFAULT 1,
  search_text text,                         -- normalised name + emails + domains (Cmd+K trigram)
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_type smallint NOT NULL,
  created_by_id uuid,
  archived_at timestamptz,                  -- soft delete
  archived_by_type smallint,
  archived_by_id uuid,
  merged_at timestamptz,
  merged_into_id uuid
);
CREATE INDEX ei_def ON entity_instances (entity_definition_id, id) WHERE archived_at IS NULL AND merged_at IS NULL;
CREATE INDEX ei_search_trgm ON entity_instances USING gin (search_text gin_trgm_ops);

CREATE TABLE attribute_values (
  id uuid PRIMARY KEY,                      -- UUIDv7
  workspace_id uuid NOT NULL,
  entity_definition_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  active_from timestamptz NOT NULL,
  active_until timestamptz,                 -- NULL = current value
  created_by_type smallint NOT NULL,
  created_by_id uuid,
  deactivated_by_type smallint,
  deactivated_by_id uuid,
  sort_order text COLLATE "C",              -- rank among the values of a multi-value attribute
  v_text text,
  v_num numeric,
  v_ts timestamptz,
  v_date date,
  v_bool boolean,
  v_ref uuid,
  v_ref_def uuid,
  v_json jsonb,
  sort_key text COLLATE "C",                -- norm_key(display text), <= 128 chars
  unique_key text COLLATE "C"               -- canonical key, set only for unique attributes
);
CREATE INDEX av_inst ON attribute_values (instance_id, attribute_id, active_from);
CREATE INDEX av_ref ON attribute_values (attribute_id, v_ref, instance_id)
  WHERE active_until IS NULL AND v_ref IS NOT NULL;
CREATE UNIQUE INDEX av_unique ON attribute_values (attribute_id, unique_key)
  WHERE active_until IS NULL AND unique_key IS NOT NULL;
CREATE INDEX av_attr_hist ON attribute_values (attribute_id, active_from) INCLUDE (active_until, v_ref)
  WHERE v_ref IS NOT NULL;
CREATE INDEX av_def_active ON attribute_values (entity_definition_id, instance_id)
  WHERE active_until IS NULL;               -- projection rebuild / verification scans
ALTER TABLE attribute_values ALTER COLUMN attribute_id SET STATISTICS 1000;

-- Transactional outbox (I1; contract in packages/realtime/src/index.ts). Consumers read rows with
-- xid < pg_snapshot_xmin(pg_current_snapshot()) to never skip a slower concurrent transaction.
CREATE TABLE change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  resource text NOT NULL,
  resource_id uuid,
  scope jsonb NOT NULL DEFAULT '{}',
  actor jsonb,
  audience jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_xid ON change_log (xid, id);
CREATE INDEX change_log_ws ON change_log (workspace_id, id);

-- Generated projection tables live here (one per entity definition), owned by the migration role.
CREATE SCHEMA IF NOT EXISTS proj;
GRANT USAGE ON SCHEMA proj TO agentic_crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA proj GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agentic_crm_app;

ALTER TABLE entity_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_definitions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE attribute_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attribute_definitions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE select_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON select_options
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE entity_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_instances
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE attribute_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attribute_values
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON change_log
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
