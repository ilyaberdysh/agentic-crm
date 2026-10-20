-- Platform extensions (see research/architecture/ARCHITECTURE.md D-06, D-12).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS vector;
-- uuidv7() is built into Postgres 18.
