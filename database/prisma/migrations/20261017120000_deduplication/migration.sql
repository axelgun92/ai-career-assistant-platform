-- Features 1–10 Gap Closure: deduplication with provenance retention.
-- Additive only; no existing row is changed. Company.normalizedName already
-- exists and is filled by the explicit `pnpm db:backfill-dedup` command.
-- Recommendation.evidenceReferences default drift is intentionally excluded.

-- CreateEnum
CREATE TYPE "DuplicateResolution" AS ENUM ('DISTINCT');

-- AlterTable: the user's reversible decision beside the engine's decision.
ALTER TABLE "DuplicateReference" ADD COLUMN "resolution" "DuplicateResolution",
ADD COLUMN "resolvedAt" TIMESTAMPTZ(3);

-- AlterTable: provenance of a source record attached to an existing
-- opportunity as an exact duplicate.
ALTER TABLE "SourceRecord" ADD COLUMN "duplicateDecision" "DuplicateDecision",
ADD COLUMN "duplicateEvidence" JSONB;
