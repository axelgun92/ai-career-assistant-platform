-- Explicit residency / geographic eligibility on normalized opportunities
-- (additive). Existing rows keep NULL / an empty list, which reads as
-- Unknown; nothing is backfilled.
-- Recommendation.evidenceReferences default drift is intentionally excluded.

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN "residencyRequirement" TEXT,
ADD COLUMN "residencyRegions" TEXT[] DEFAULT ARRAY[]::TEXT[];
