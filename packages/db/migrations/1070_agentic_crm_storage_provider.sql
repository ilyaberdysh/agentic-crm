ALTER TABLE storage_entries
  DROP CONSTRAINT storage_entries_storage_provider_check;

UPDATE storage_entries
SET storage_provider = 'agentic-crm'
WHERE storage_provider = 'attio';

ALTER TABLE storage_entries
  ALTER COLUMN storage_provider SET DEFAULT 'agentic-crm',
  ADD CONSTRAINT storage_entries_storage_provider_check CHECK (storage_provider IN ('agentic-crm'));
