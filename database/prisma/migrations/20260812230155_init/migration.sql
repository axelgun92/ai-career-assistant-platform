-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DISCOVERED', 'NORMALIZED', 'EVALUATED', 'RECOMMENDED', 'SAVED', 'APPLIED', 'REJECTED_BY_USER', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'BROWSER_EXTENSION', 'PUBLIC_SEARCH', 'ATS', 'API', 'COMPANY_WATCHLIST', 'OTHER');

-- CreateEnum
CREATE TYPE "DuplicateDecision" AS ENUM ('MATCH', 'PROBABLE_MATCH', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('CONFIRMED', 'STRONG_EVIDENCE', 'POSSIBLE', 'UNKNOWN', 'CONFLICTING');

-- CreateEnum
CREATE TYPE "ProvenanceKind" AS ENUM ('DIRECT', 'DETERMINISTIC');

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT,
    "brand" TEXT,
    "industry" TEXT,
    "headquarters" TEXT,
    "companySize" TEXT,
    "parentCompanyId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" UUID NOT NULL,
    "domain" TEXT,
    "externalListingId" TEXT,
    "atsRequisitionId" TEXT,
    "canonicalUrl" TEXT,
    "applicationUrl" TEXT,
    "originalSource" TEXT,
    "discoveredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMPTZ(3),
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" UUID,
    "title" TEXT,
    "department" TEXT,
    "employmentType" TEXT,
    "seniority" TEXT,
    "location" TEXT,
    "remoteStatus" TEXT,
    "timeZoneRequirements" TEXT,
    "salaryMin" DECIMAL(12,2),
    "salaryMax" DECIMAL(12,2),
    "salaryText" TEXT,
    "bonus" TEXT,
    "equity" TEXT,
    "currency" TEXT,
    "compensationNotes" TEXT,
    "postingDate" TIMESTAMPTZ(3),
    "closingDate" TIMESTAMPTZ(3),
    "source" TEXT,
    "sourceType" "SourceType",
    "atsPlatform" TEXT,
    "jobDescription" TEXT,
    "responsibilities" TEXT,
    "requirements" TEXT,
    "benefits" TEXT,
    "additionalNotes" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DISCOVERED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" UUID NOT NULL,
    "opportunityId" UUID,
    "source" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceUrl" TEXT,
    "externalId" TEXT,
    "requisitionId" TEXT,
    "rawTitle" TEXT,
    "rawCompany" TEXT,
    "rawLocation" TEXT,
    "rawDescription" TEXT,
    "rawSalaryText" TEXT,
    "rawEmploymentType" TEXT,
    "rawPostingDate" TEXT,
    "sourceMetadata" JSONB,
    "rawPayload" JSONB,
    "discoveredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldProvenance" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "sourceRecordId" UUID,
    "fieldName" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "kind" "ProvenanceKind" NOT NULL,
    "normalizedValue" JSONB,
    "sourceReference" TEXT,
    "sourceText" TEXT,
    "collectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateReference" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "relatedOpportunityId" UUID NOT NULL,
    "decision" "DuplicateDecision" NOT NULL,
    "confidence" DECIMAL(5,4),
    "evidence" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DuplicateReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "careerGoals" JSONB,
    "experience" JSONB,
    "skills" JSONB,
    "transferableSkills" JSONB,
    "locationPreferences" JSONB,
    "compensationPreferences" JSONB,
    "workPreferences" JSONB,
    "companyPreferences" JSONB,
    "domainPreferences" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "userProfileId" UUID,
    "domain" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "evaluationVersion" TEXT NOT NULL,
    "domainVersion" TEXT NOT NULL,
    "promptVersion" TEXT,
    "userProfileVersion" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageResult" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "stageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StageResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "evaluationId" UUID,
    "stageResultId" UUID,
    "stageId" TEXT,
    "criterionId" TEXT,
    "claim" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceReference" TEXT,
    "sourceText" TEXT,
    "evidenceLevel" "EvidenceLevel" NOT NULL,
    "collectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contradiction" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "stageResultId" UUID,
    "claimA" TEXT NOT NULL,
    "claimB" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "significance" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contradiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "scoreSummary" JSONB,
    "strongestPositives" JSONB,
    "strongestConcerns" JSONB,
    "unknowns" JSONB,
    "contradictions" JSONB,
    "explanation" TEXT NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_normalizedName_idx" ON "Company"("normalizedName");

-- CreateIndex
CREATE INDEX "Company_parentCompanyId_idx" ON "Company"("parentCompanyId");

-- CreateIndex
CREATE INDEX "Opportunity_domain_status_idx" ON "Opportunity"("domain", "status");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_idx" ON "Opportunity"("companyId");

-- CreateIndex
CREATE INDEX "Opportunity_externalListingId_idx" ON "Opportunity"("externalListingId");

-- CreateIndex
CREATE INDEX "Opportunity_atsRequisitionId_idx" ON "Opportunity"("atsRequisitionId");

-- CreateIndex
CREATE INDEX "Opportunity_postingDate_idx" ON "Opportunity"("postingDate");

-- CreateIndex
CREATE INDEX "SourceRecord_opportunityId_idx" ON "SourceRecord"("opportunityId");

-- CreateIndex
CREATE INDEX "SourceRecord_source_externalId_idx" ON "SourceRecord"("source", "externalId");

-- CreateIndex
CREATE INDEX "SourceRecord_requisitionId_idx" ON "SourceRecord"("requisitionId");

-- CreateIndex
CREATE INDEX "FieldProvenance_opportunityId_fieldName_idx" ON "FieldProvenance"("opportunityId", "fieldName");

-- CreateIndex
CREATE INDEX "FieldProvenance_sourceRecordId_idx" ON "FieldProvenance"("sourceRecordId");

-- CreateIndex
CREATE INDEX "DuplicateReference_relatedOpportunityId_idx" ON "DuplicateReference"("relatedOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateReference_opportunityId_relatedOpportunityId_key" ON "DuplicateReference"("opportunityId", "relatedOpportunityId");

-- CreateIndex
CREATE INDEX "Evaluation_opportunityId_createdAt_idx" ON "Evaluation"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "Evaluation_userProfileId_idx" ON "Evaluation"("userProfileId");

-- CreateIndex
CREATE INDEX "Evaluation_domain_status_idx" ON "Evaluation"("domain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StageResult_evaluationId_stageId_key" ON "StageResult"("evaluationId", "stageId");

-- CreateIndex
CREATE UNIQUE INDEX "StageResult_evaluationId_position_key" ON "StageResult"("evaluationId", "position");

-- CreateIndex
CREATE INDEX "EvidenceRecord_opportunityId_idx" ON "EvidenceRecord"("opportunityId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_evaluationId_stageId_idx" ON "EvidenceRecord"("evaluationId", "stageId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_stageResultId_idx" ON "EvidenceRecord"("stageResultId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_evidenceLevel_idx" ON "EvidenceRecord"("evidenceLevel");

-- CreateIndex
CREATE INDEX "Contradiction_evaluationId_idx" ON "Contradiction"("evaluationId");

-- CreateIndex
CREATE INDEX "Contradiction_stageResultId_idx" ON "Contradiction"("stageResultId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_evaluationId_key" ON "Recommendation"("evaluationId");

-- CreateIndex
CREATE INDEX "Recommendation_opportunityId_createdAt_idx" ON "Recommendation"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_decision_idx" ON "Recommendation"("decision");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateReference" ADD CONSTRAINT "DuplicateReference_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateReference" ADD CONSTRAINT "DuplicateReference_relatedOpportunityId_fkey" FOREIGN KEY ("relatedOpportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageResult" ADD CONSTRAINT "StageResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_stageResultId_fkey" FOREIGN KEY ("stageResultId") REFERENCES "StageResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contradiction" ADD CONSTRAINT "Contradiction_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contradiction" ADD CONSTRAINT "Contradiction_stageResultId_fkey" FOREIGN KEY ("stageResultId") REFERENCES "StageResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
