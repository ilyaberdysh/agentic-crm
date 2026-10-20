-- Make cancellation an explicit, durable queue outcome. A cancelled task is terminal and cannot retain a lease.
ALTER TABLE agentic_tasks DROP CONSTRAINT agentic_tasks_status_check;
ALTER TABLE agentic_tasks ADD CONSTRAINT agentic_tasks_status_check
  CHECK (status IN ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED_TERMINAL', 'BLOCKED', 'CANCELLED'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'agentic_tasks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%finished_at%'
    AND pg_get_constraintdef(oid) LIKE '%SUCCEEDED%';

  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'agentic_tasks terminal finished_at constraint not found';
  END IF;

  EXECUTE format('ALTER TABLE agentic_tasks DROP CONSTRAINT %I', constraint_name);
END $$;

ALTER TABLE agentic_tasks ADD CONSTRAINT agentic_tasks_terminal_finished_at_check
  CHECK ((status IN ('SUCCEEDED', 'FAILED_TERMINAL', 'CANCELLED')) = (finished_at IS NOT NULL));
