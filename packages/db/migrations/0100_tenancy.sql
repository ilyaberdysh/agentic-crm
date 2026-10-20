-- Tenancy backstop (ARCHITECTURE I2).
-- Domain transactions run as the non-owner role `agentic_crm_app` (SET LOCAL ROLE) with the GUC `app.workspace_id`
-- set to the request's workspace. Every tenant table enables RLS with a policy comparing its workspace_id to
-- app_workspace_id(); an unset GUC yields NULL, so nothing is visible. Migrations, the realtime gateway and
-- explicitly cross-tenant reads (workspace picker, invite lookup) run as the owner role, which bypasses RLS.

DO $$
BEGIN
  CREATE ROLE agentic_crm_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION
  -- roles are cluster-wide: another database (e.g. a parallel test database) may have created it already
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT agentic_crm_app TO %I', current_user);
EXCEPTION
  WHEN OTHERS THEN NULL; -- already a member, or a superuser that does not need membership
END
$$;

GRANT USAGE ON SCHEMA public TO agentic_crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agentic_crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agentic_crm_app;

CREATE OR REPLACE FUNCTION app_workspace_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
