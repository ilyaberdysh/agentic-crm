-- Record search index (BACKLOG 5.01; CROSS-DOMAIN B.8; decision "Search ranking" in
-- research/architecture/decisions/slice5-contracts.md). One row per live record of a record object (people,
-- companies, standard and custom objects) with the searchable fields in match-ready form:
--   name (the record label: epithet attribute, else `name`), email addresses, domains, phone numbers, social handles
--   (AngelList, Facebook, Instagram, LinkedIn, Twitter → the handle), description and primary location
--   (B-shell/command-palette.md §5 "searchable fields"); record ids are matched against entity_instances directly.
-- The index is derived data: search_index_refresh() recomputes rows from the current attribute values and removes
-- rows of deleted / merged records. packages/domain calls it inside the write transaction (I1: ValueEngine.finalize,
-- record delete / merge / restore), so search is consistent with the write that committed.
--
-- Identifier match strings hold one value per line, padded with newlines, so "exact" and "prefix" are plain LIKEs:
--   exact  : email_text LIKE '%' || E'\n' || q || E'\n%'     prefix : email_text LIKE '%' || E'\n' || q || '%'
-- `words` / `extra_words` hold, one value per line, the words (punctuation → space, padded with spaces) of name +
-- identifiers and of description + location for word-prefix matches (' ' || w); a phrase never spans two values.
-- `all_text` holds every value (norm_key, one per line) for trigram candidates and typo tolerance;
-- `prefixes` the 1- and 2-character prefixes of every word (candidates for 1–2 character queries, which trigrams
-- cannot serve).
--
-- Reads run as the table owner with an explicit workspace filter (packages/domain/src/search/service.ts): under RLS the
-- planner may not use an index qual with a non-leakproof operator (LIKE, %>, @>), which turns every search into a
-- sequential scan (measured: 87 ms LIKE / 1.4 s word_similarity on 100k rows vs ~1–5 ms with the index).

CREATE TABLE search_index (
  instance_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  entity_definition_id uuid NOT NULL,
  title text,                                       -- display label (null when the record has none)
  subtitle text,                                    -- first domain (companies) / email address (people)
  image text,                                       -- avatar / logo URL
  emails text[] NOT NULL DEFAULT '{}',              -- normalised email addresses
  domains text[] NOT NULL DEFAULT '{}',             -- normalised domains
  phones text[] NOT NULL DEFAULT '{}',              -- normalised E.164 numbers
  handles text[] NOT NULL DEFAULT '{}',             -- social handles (last path segment, lower case)
  description text NOT NULL DEFAULT '',             -- first 2000 characters
  location text NOT NULL DEFAULT '',                -- line1 locality region postcode country code
  name_key text COLLATE "C" NOT NULL DEFAULT '',    -- norm_key(title)
  email_text text COLLATE "C" NOT NULL DEFAULT E'\n',
  domain_text text COLLATE "C" NOT NULL DEFAULT E'\n',
  phone_text text COLLATE "C" NOT NULL DEFAULT E'\n', -- digits only
  handle_text text COLLATE "C" NOT NULL DEFAULT E'\n',
  words text COLLATE "C" NOT NULL DEFAULT '',
  extra_words text COLLATE "C" NOT NULL DEFAULT '',
  all_text text COLLATE "C" NOT NULL DEFAULT '',
  prefixes text[] NOT NULL DEFAULT '{}',
  recency_at timestamptz NOT NULL,                  -- last update of the record (ranking tie-break, empty query)
  indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_index_trgm ON search_index USING gin (all_text gin_trgm_ops);
CREATE INDEX search_index_prefixes ON search_index USING gin (prefixes);
CREATE INDEX search_index_recency ON search_index (workspace_id, recency_at DESC, instance_id DESC);
CREATE INDEX search_index_definition ON search_index (entity_definition_id, recency_at DESC);

ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search_index
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- Words of a text for word-prefix matching: norm_key, punctuation and spaces collapsed to one space, padded.
CREATE OR REPLACE FUNCTION search_words(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT ' ' || btrim(regexp_replace(coalesce(norm_key(t), ''), '[[:space:][:punct:]]+', ' ', 'g')) || ' ' $$;

-- Recomputes the index rows of `p_ids` (any entity instances; non-records and dead records lose their row).
-- p_recency: the recency to store (the write's transaction time); NULL derives it from the record's value history.
CREATE OR REPLACE FUNCTION search_index_refresh(p_ids uuid[], p_recency timestamptz) RETURNS void
LANGUAGE sql VOLATILE
AS $fn$
  WITH inst AS (
    SELECT i.id, i.workspace_id, i.entity_definition_id, i.created_at
    FROM entity_instances i
    JOIN entity_definitions d ON d.id = i.entity_definition_id
    WHERE i.id = ANY(p_ids) AND i.archived_at IS NULL AND i.merged_at IS NULL
      AND d.entity_type IN ('person-record', 'company-record', 'standard-object', 'custom-record')
  ),
  attrs AS (
    SELECT a.id,
      CASE
        WHEN a.type IN ('text', 'personal-name')
             AND (a.id::text = d.epithet_path -> 0 ->> 'attributeDefinitionId'
                  OR (d.epithet_path IS NULL AND a.api_slug = 'name')) THEN 'label'
        WHEN a.system_attribute_type = 'email-address' THEN 'email'
        WHEN a.system_attribute_type = 'domains' THEN 'domain'
        WHEN a.system_attribute_type = 'phone-numbers' THEN 'phone'
        WHEN a.system_attribute_type = 'description' THEN 'description'
        WHEN a.system_attribute_type IN ('angel-list', 'facebook', 'instagram', 'linked-in', 'twitter') THEN 'handle'
        WHEN a.system_attribute_type = 'primary-location' THEN 'location'
        WHEN a.system_attribute_type = 'avatar-url'
             OR a.id::text = d.image_path -> 0 ->> 'attributeDefinitionId' THEN 'image'
      END AS kind
    FROM attribute_definitions a
    JOIN entity_definitions d ON d.id = a.entity_definition_id
    WHERE a.entity_definition_id IN (SELECT DISTINCT entity_definition_id FROM inst)
  ),
  vals AS (
    SELECT v.instance_id, at.kind, v.v_text, v.v_json, v.sort_order, v.active_from, v.id
    FROM attribute_values v
    JOIN attrs at ON at.id = v.attribute_id AND at.kind IS NOT NULL
    WHERE v.instance_id = ANY(p_ids) AND v.active_until IS NULL
  ),
  agg AS (
    SELECT inst.id, inst.workspace_id, inst.entity_definition_id, inst.created_at,
      (array_agg(vals.v_text ORDER BY vals.sort_order NULLS FIRST, vals.active_from DESC, vals.id)
        FILTER (WHERE vals.kind = 'label' AND vals.v_text <> ''))[1] AS title,
      coalesce(array_agg(lower(vals.v_text) ORDER BY vals.sort_order NULLS LAST, vals.id)
        FILTER (WHERE vals.kind = 'email' AND vals.v_text IS NOT NULL), '{}') AS emails,
      coalesce(array_agg(lower(vals.v_text) ORDER BY vals.sort_order NULLS LAST, vals.id)
        FILTER (WHERE vals.kind = 'domain' AND vals.v_text IS NOT NULL), '{}') AS domains,
      coalesce(array_agg(vals.v_text ORDER BY vals.sort_order NULLS LAST, vals.id)
        FILTER (WHERE vals.kind = 'phone' AND vals.v_text IS NOT NULL), '{}') AS phones,
      coalesce(array_agg(norm_key(substring(
          regexp_replace(regexp_replace(btrim(vals.v_text), '[?#].*$', ''), '/+$', '') FROM '([^/@]+)$'))
          ORDER BY vals.id)
        FILTER (WHERE vals.kind = 'handle' AND btrim(coalesce(vals.v_text, '')) <> ''), '{}') AS handles,
      left(coalesce(string_agg(vals.v_text, ' ' ORDER BY vals.id) FILTER (WHERE vals.kind = 'description'), ''),
        2000) AS description,
      coalesce(string_agg(concat_ws(' ', vals.v_json ->> 'line1', vals.v_json ->> 'locality',
          vals.v_json ->> 'region', vals.v_json ->> 'postcode', vals.v_json ->> 'countryCode'), ' ' ORDER BY vals.id)
        FILTER (WHERE vals.kind = 'location'), '') AS location,
      (array_agg(vals.v_text ORDER BY vals.active_from DESC, vals.id)
        FILTER (WHERE vals.kind = 'image' AND vals.v_text <> ''))[1] AS image
    FROM inst LEFT JOIN vals ON vals.instance_id = inst.id
    GROUP BY inst.id, inst.workspace_id, inst.entity_definition_id, inst.created_at
  ),
  shaped AS (
    SELECT agg.*,
      coalesce(norm_key(agg.title), '') AS name_key,
      array(SELECT x FROM unnest(agg.handles) x WHERE x IS NOT NULL AND x <> '') AS clean_handles,
      array(SELECT regexp_replace(p, '\D', '', 'g') FROM unnest(agg.phones) p) AS phone_digits
    FROM agg
  ),
  rows AS (
    SELECT s.*,
      array_to_string(array(SELECT search_words(x) FROM unnest(ARRAY[s.title] || s.emails || s.domains
        || s.clean_handles) x WHERE x <> ''), E'\n') AS words,
      array_to_string(array(SELECT search_words(x) FROM unnest(ARRAY[s.description, s.location]) x
        WHERE x <> ''), E'\n') AS extra_words
    FROM shaped s
  ),
  deleted AS (
    DELETE FROM search_index si
    WHERE si.instance_id = ANY(p_ids) AND NOT EXISTS (SELECT 1 FROM inst WHERE inst.id = si.instance_id)
  )
  INSERT INTO search_index AS si (instance_id, workspace_id, entity_definition_id, title, subtitle, image, emails,
    domains, phones, handles, description, location, name_key, email_text, domain_text, phone_text, handle_text,
    words, extra_words, all_text, prefixes, recency_at, indexed_at)
  SELECT r.id, r.workspace_id, r.entity_definition_id, r.title, coalesce(r.domains[1], r.emails[1]), r.image,
    r.emails, r.domains, r.phones, r.clean_handles, r.description, r.location, r.name_key,
    E'\n' || coalesce(norm_key(array_to_string(r.emails, E'\n')), '') || E'\n',
    E'\n' || coalesce(norm_key(array_to_string(r.domains, E'\n')), '') || E'\n',
    E'\n' || array_to_string(r.phone_digits, E'\n') || E'\n',
    E'\n' || array_to_string(r.clean_handles, E'\n') || E'\n',
    r.words, r.extra_words,
    norm_key(array_to_string(ARRAY[nullif(r.title, '')] || r.emails || r.domains || r.clean_handles
      || r.phone_digits || ARRAY[nullif(r.description, ''), nullif(r.location, '')], E'\n')),
    array(SELECT DISTINCT p FROM (
      SELECT left(w, 1) AS p FROM unnest(regexp_split_to_array(r.words, E'[ \n]+')) w WHERE w <> ''
      UNION SELECT left(w, 2) FROM unnest(regexp_split_to_array(r.words, E'[ \n]+')) w WHERE length(w) >= 2
      UNION SELECT left(d, 1) FROM unnest(r.phone_digits) d WHERE d <> ''
      UNION SELECT left(d, 2) FROM unnest(r.phone_digits) d WHERE length(d) >= 2
    ) pp),
    coalesce(p_recency, greatest(r.created_at,
      (SELECT max(greatest(v.active_from, coalesce(v.active_until, v.active_from)))
       FROM attribute_values v WHERE v.instance_id = r.id))),
    now()
  FROM rows r
  ON CONFLICT (instance_id) DO UPDATE SET
    title = excluded.title, subtitle = excluded.subtitle, image = excluded.image, emails = excluded.emails,
    domains = excluded.domains, phones = excluded.phones, handles = excluded.handles,
    description = excluded.description, location = excluded.location, name_key = excluded.name_key,
    email_text = excluded.email_text, domain_text = excluded.domain_text, phone_text = excluded.phone_text,
    handle_text = excluded.handle_text, words = excluded.words, extra_words = excluded.extra_words,
    all_text = excluded.all_text, prefixes = excluded.prefixes, recency_at = excluded.recency_at,
    indexed_at = excluded.indexed_at
$fn$;

-- Backfill every live record (migrations run as the owner: no RLS).
SELECT search_index_refresh(array_agg(id), NULL) FROM entity_instances
WHERE archived_at IS NULL AND merged_at IS NULL;
