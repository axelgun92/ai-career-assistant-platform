-- Feature 12: source health and conservative retrieval. Additive and
-- nullable; existing rows need no backfill.

-- AlterTable
ALTER TABLE "RetrievalSource" ADD COLUMN "nextEligibleAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RetrievalRun" ADD COLUMN "retryAfterUntil" TIMESTAMPTZ(3);
