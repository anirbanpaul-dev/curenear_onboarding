-- Free-text search filters use ILIKE, which needs a trigram index to stay fast.
-- pg_trgm is a trusted extension in PostgreSQL 13+; the migration user must be
-- allowed to create extensions (the bundled docker-compose database is).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Provider_displayName_trgm_idx"
  ON "Provider" USING GIN ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Provider_legalName_trgm_idx"
  ON "Provider" USING GIN ("legalName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Provider_city_trgm_idx"
  ON "Provider" USING GIN ("city" gin_trgm_ops);
