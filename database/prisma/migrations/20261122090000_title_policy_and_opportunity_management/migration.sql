-- November 22, 2026: universal target job titles and opportunity management.
-- Target job titles (TitlePolicySetting), the listing title kept on
-- RetrievedListing for re-checking pending listings, the deliberate title
-- override and the SKIPPED status for results-page items, the REACTIVATE
-- user action (Move to Active), and permanent deletion from Dismissed:
-- fingerprint-only tombstones and the retained usage accounting that keeps
-- budget and usage totals unchanged. Additive only.

-- AlterEnum
ALTER TYPE "OpportunityUserActionType" ADD VALUE 'REACTIVATE';

-- AlterEnum
ALTER TYPE "PageCaptureItemStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "PageCaptureItem" ADD COLUMN     "titleOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RetrievedListing" ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "TitlePolicySetting" (
    "domain" TEXT NOT NULL,
    "acceptedPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TitlePolicySetting_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "DeletedOpportunityTombstone" (
    "fingerprint" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeletedOpportunityTombstone_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateTable
CREATE TABLE "RetainedEvaluationUsage" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "jobSource" TEXT,
    "sourceType" TEXT,
    "source" TEXT,
    "operationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DECIMAL(18,12),
    "pricingConfigurationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "retainedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetainedEvaluationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetainedEvaluationAdmission" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "retainedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetainedEvaluationAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetainedEvaluationUsage_createdAt_idx" ON "RetainedEvaluationUsage"("createdAt");

-- CreateIndex
CREATE INDEX "RetainedEvaluationUsage_pricingConfigurationId_idx" ON "RetainedEvaluationUsage"("pricingConfigurationId");

-- CreateIndex
CREATE INDEX "RetainedEvaluationAdmission_createdAt_idx" ON "RetainedEvaluationAdmission"("createdAt");

-- AddForeignKey
ALTER TABLE "RetainedEvaluationUsage" ADD CONSTRAINT "RetainedEvaluationUsage_pricingConfigurationId_fkey" FOREIGN KEY ("pricingConfigurationId") REFERENCES "AiModelPricingConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

