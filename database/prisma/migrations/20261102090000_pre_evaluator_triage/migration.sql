-- CreateEnum
CREATE TYPE "PreEvaluatorTriageOutcome" AS ENUM ('EVALUATE', 'NEEDS_REVIEW', 'REJECT');

-- CreateEnum
CREATE TYPE "PreEvaluatorTriageManualDecision" AS ENUM ('EVALUATE', 'REJECT');

-- CreateTable
CREATE TABLE "PreEvaluatorTriage" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "userProfileId" UUID,
    "userProfileVersion" INTEGER,
    "outcome" "PreEvaluatorTriageOutcome" NOT NULL,
    "reasons" JSONB NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "manualDecision" "PreEvaluatorTriageManualDecision",
    "manuallyDecidedAt" TIMESTAMPTZ(3),
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PreEvaluatorTriage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreEvaluatorTriage_opportunityId_key" ON "PreEvaluatorTriage"("opportunityId");
CREATE INDEX "PreEvaluatorTriage_outcome_manualDecision_assessedAt_idx" ON "PreEvaluatorTriage"("outcome", "manualDecision", "assessedAt");
CREATE INDEX "PreEvaluatorTriage_userProfileId_idx" ON "PreEvaluatorTriage"("userProfileId");

ALTER TABLE "PreEvaluatorTriage" ADD CONSTRAINT "PreEvaluatorTriage_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreEvaluatorTriage" ADD CONSTRAINT "PreEvaluatorTriage_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
