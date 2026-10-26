-- Feature 14B shared-normalization convergence (Core TDD §51, v1.15).
-- Additive only; every new column is nullable or defaults to an empty array.
-- Rollback:
--   DROP TABLE "UserEligibility";
--   ALTER TABLE "Opportunity" DROP COLUMN "compensationBasis",
--     DROP COLUMN "workAuthorizationRequirement", DROP COLUMN "workAuthorizationRegions",
--     DROP COLUMN "visaSponsorship", DROP COLUMN "relocationSupport",
--     DROP COLUMN "employerOfRecordRegions";

-- What a stated compensation range is: BASE or OTE (null when not stated).
ALTER TABLE "Opportunity" ADD COLUMN "compensationBasis" TEXT;

-- Explicit work-authorization facts, separate from residency.
ALTER TABLE "Opportunity" ADD COLUMN "workAuthorizationRequirement" TEXT,
ADD COLUMN "workAuthorizationRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "visaSponsorship" TEXT,
ADD COLUMN "relocationSupport" TEXT,
ADD COLUMN "employerOfRecordRegions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The user's own work eligibility (one row), for display only.
CREATE TABLE "UserEligibility" (
    "id" TEXT NOT NULL,
    "authorizedRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "citizenshipRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserEligibility_pkey" PRIMARY KEY ("id")
);
