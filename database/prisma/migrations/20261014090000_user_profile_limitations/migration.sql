-- Structured profile limitations (additive, nullable). Existing profile
-- versions keep NULL and are never rewritten.
-- Recommendation.evidenceReferences default drift is intentionally excluded.

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "limitations" JSONB;
