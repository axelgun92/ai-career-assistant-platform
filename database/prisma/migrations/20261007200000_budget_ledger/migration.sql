-- Additive only: budget ledger, evaluation admissions (request integrity), and
-- the deferred-evaluation backlog. Evaluator tables are untouched; the known
-- Recommendation.evidenceReferences default drift is intentionally excluded.
-- CreateEnum
CREATE TYPE "BudgetPeriodType" AS ENUM ('CALENDAR_MONTH');

-- CreateEnum
CREATE TYPE "DeferredEvaluationStatus" AS ENUM ('DEFERRED', 'RESUMED', 'CANCELLED');


-- CreateTable
CREATE TABLE "EvaluationAdmission" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "evaluationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedAt" TIMESTAMPTZ(3),
    "abandonedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EvaluationAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSetting" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "periodType" "BudgetPeriodType" NOT NULL DEFAULT 'CALENDAR_MONTH',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "enforced" BOOLEAN NOT NULL DEFAULT true,
    "reservePerEvaluation" DECIMAL(18,6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BudgetSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationBudgetReservation" (
    "id" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "amount" DECIMAL(18,12) NOT NULL,
    "currency" TEXT NOT NULL,
    "enforced" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeferredEvaluation" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "userProfileId" UUID,
    "userProfileVersion" INTEGER,
    "status" "DeferredEvaluationStatus" NOT NULL DEFAULT 'DEFERRED',
    "reasonCode" TEXT NOT NULL,
    "reasonSnapshot" JSONB NOT NULL,
    "lastCheckedAt" TIMESTAMPTZ(3) NOT NULL,
    "resumedAdmissionId" UUID,
    "resumedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeferredEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAdmission_evaluationId_key" ON "EvaluationAdmission"("evaluationId");

-- CreateIndex
CREATE INDEX "EvaluationAdmission_opportunityId_createdAt_idx" ON "EvaluationAdmission"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationAdmission_evaluationId_abandonedAt_idx" ON "EvaluationAdmission"("evaluationId", "abandonedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationBudgetReservation_admissionId_key" ON "EvaluationBudgetReservation"("admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "DeferredEvaluation_resumedAdmissionId_key" ON "DeferredEvaluation"("resumedAdmissionId");

-- CreateIndex
CREATE INDEX "DeferredEvaluation_status_createdAt_idx" ON "DeferredEvaluation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeferredEvaluation_opportunityId_status_idx" ON "DeferredEvaluation"("opportunityId", "status");

-- AddForeignKey
ALTER TABLE "EvaluationAdmission" ADD CONSTRAINT "EvaluationAdmission_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAdmission" ADD CONSTRAINT "EvaluationAdmission_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationBudgetReservation" ADD CONSTRAINT "EvaluationBudgetReservation_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "EvaluationAdmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeferredEvaluation" ADD CONSTRAINT "DeferredEvaluation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeferredEvaluation" ADD CONSTRAINT "DeferredEvaluation_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeferredEvaluation" ADD CONSTRAINT "DeferredEvaluation_resumedAdmissionId_fkey" FOREIGN KEY ("resumedAdmissionId") REFERENCES "EvaluationAdmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- An admission is consumed (evaluationId) or abandoned, never both.
ALTER TABLE "EvaluationAdmission" ADD CONSTRAINT "EvaluationAdmission_consumed_or_abandoned_check" CHECK (NOT ("evaluationId" IS NOT NULL AND "abandonedAt" IS NOT NULL));
