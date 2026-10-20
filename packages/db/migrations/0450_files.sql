-- Record files and folders (BACKLOG 3.06; specs D README §3.9, §4.4, §5; CROSS-DOMAIN B.23; decision D-19).
-- Bytes live in S3 (SeaweedFS locally, config.s3) under `object_key`; rows are the storage entries of a record.
-- Root entries are the entries without a parent folder; `root_entry_id` is the top-level ancestor (itself for roots).
-- Upload is three-step (D §4.4): create session → presigned PUT → complete (accept), which creates the file entry.
-- Delete is soft (decision X-22); objects are left for a later garbage-collection job.

CREATE TABLE storage_entries (
  id uuid PRIMARY KEY,                      -- file_id / folder id
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  parent_folder_id uuid REFERENCES storage_entries (id),
  root_entry_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('file', 'folder')),
  storage_provider text NOT NULL DEFAULT 'attio' CHECK (storage_provider IN ('attio')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  content_type text,                        -- files only
  content_size bigint,                      -- bytes; files only
  object_key text,                          -- S3 key; files only
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by jsonb
);
-- "A file with this name already exists" (D §3.9): names are unique per folder of a record (case-insensitive).
CREATE UNIQUE INDEX storage_entries_name ON storage_entries (
  entity_instance_id, coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)
) WHERE deleted_at IS NULL;
CREATE INDEX storage_entries_record ON storage_entries (entity_instance_id, parent_folder_id) WHERE deleted_at IS NULL;

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,                      -- entity_storage_upload_session_id; client-minted (I3)
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  entity_instance_id uuid NOT NULL,
  parent_folder_id uuid,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  content_type text NOT NULL,
  content_size bigint NOT NULL CHECK (content_size >= 0),
  object_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'failed')),
  error text,
  file_entry_id uuid,                       -- the storage entry created on accept
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,          -- the presigned PUT stops working then
  completed_at timestamptz
);
CREATE INDEX upload_sessions_record ON upload_sessions (entity_instance_id, created_at);

ALTER TABLE storage_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_entries
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON upload_sessions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
