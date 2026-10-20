-- Built-in module state is explicit for existing and newly created workspaces.
CREATE TABLE workspace_product_modules (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  module_id text NOT NULL CHECK (module_id = 'record-follow-up'),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, module_id)
);

INSERT INTO workspace_product_modules (workspace_id, module_id)
SELECT id, 'record-follow-up' FROM workspaces;

CREATE FUNCTION seed_workspace_product_modules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspace_product_modules (workspace_id, module_id) VALUES (NEW.id, 'record-follow-up');
  RETURN NEW;
END;
$$;
CREATE TRIGGER seed_workspace_product_modules AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION seed_workspace_product_modules();

ALTER TABLE workspace_product_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_product_modules
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
