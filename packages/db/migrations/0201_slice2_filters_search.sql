-- Slice 2 (tables): projection and search data the filter engine and record pickers need.
--
-- 1. actor-reference attributes get a projection column a<attnum>_type holding the referenced actor type (filter
--    "Type is Member / API token / …", C1 filters-sorts-calcs §3). New attributes get it from
--    packages/domain/src/projection.ts; this backfills existing projection tables from the current values.
DO $$
DECLARE
  r record;
  col text;
BEGIN
  FOR r IN
    SELECT a.id, a.attnum, a.is_multiselect, d.projection_table
    FROM attribute_definitions a
    JOIN entity_definitions d ON d.id = a.entity_definition_id
    WHERE a.type = 'actor-reference' AND d.projection_table IS NOT NULL
  LOOP
    col := 'a' || r.attnum || '_type';
    EXECUTE format('ALTER TABLE proj.%I ADD COLUMN IF NOT EXISTS %I %s', r.projection_table, col,
      CASE WHEN r.is_multiselect THEN 'text[] COLLATE "C"' ELSE 'text COLLATE "C"' END);
    IF r.is_multiselect THEN
      EXECUTE format(
        'UPDATE proj.%I p SET %I = (SELECT NULLIF(array_agg((v.v_text) COLLATE "C" ORDER BY v.sort_order, v.id), ''{}'')
           FROM attribute_values v
           WHERE v.instance_id = p.instance_id AND v.attribute_id = %L AND v.active_until IS NULL)',
        r.projection_table, col, r.id);
    ELSE
      EXECUTE format(
        'UPDATE proj.%I p SET %I = (SELECT (array_agg((v.v_text) COLLATE "C" ORDER BY v.active_from DESC, v.id DESC))[1]
           FROM attribute_values v
           WHERE v.instance_id = p.instance_id AND v.attribute_id = %L AND v.active_until IS NULL)',
        r.projection_table, col, r.id);
    END IF;
  END LOOP;
END
$$;

-- 2. search_text (record pickers, Cmd+K; CROSS-DOMAIN B.8) now also holds phone numbers and the record label of
--    every object (its epithet attribute, else a `name` attribute — custom objects included). Same rule as
--    packages/domain/src/records/engine.ts isSearchable(); recomputed here for existing records.
UPDATE entity_instances i
SET search_text = s.t
FROM (
  SELECT v.instance_id, string_agg(v.sort_key, ' ' ORDER BY v.attribute_id, v.sort_order, v.id) AS t
  FROM attribute_values v
  JOIN attribute_definitions a ON a.id = v.attribute_id
  JOIN entity_definitions d ON d.id = a.entity_definition_id
  WHERE v.active_until IS NULL
    AND (
      a.system_attribute_type IN ('name', 'personal-name', 'domains', 'email-address', 'phone-numbers',
                                  'workspace-member-name', 'workspace-member-email-address')
      OR (a.type IN ('text', 'personal-name') AND (
            a.id::text = d.epithet_path -> 0 ->> 'attributeDefinitionId'
            OR (d.epithet_path IS NULL AND a.api_slug = 'name')))
    )
  GROUP BY v.instance_id
) s
WHERE s.instance_id = i.id;
