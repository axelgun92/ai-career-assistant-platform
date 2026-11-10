-- Additive only: each SourceRecord keeps its own application URL so multiple
-- sources for one opportunity never lose their apply links. Evaluator tables
-- are untouched.

-- AlterTable
ALTER TABLE "SourceRecord" ADD COLUMN "applicationUrl" TEXT;

-- Null-safe backfill from the URL previously kept only in sourceMetadata.
-- Copies a value only when it is a non-empty http(s) string; every other row
-- (null metadata, missing key, JSON null, non-string, empty, non-http) stays
-- NULL. Nothing is synthesized.
UPDATE "SourceRecord"
SET "applicationUrl" = btrim("sourceMetadata"->>'applicationUrl')
WHERE jsonb_typeof("sourceMetadata") = 'object'
  AND jsonb_typeof("sourceMetadata"->'applicationUrl') = 'string'
  AND btrim("sourceMetadata"->>'applicationUrl') ~* '^https?://';
