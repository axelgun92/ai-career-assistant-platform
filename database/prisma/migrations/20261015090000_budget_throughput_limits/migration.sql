-- Budget warning thresholds and throughput limits (additive). Existing
-- settings keep no thresholds and no limits.
-- Recommendation.evidenceReferences default drift is intentionally excluded.

-- AlterTable
ALTER TABLE "BudgetSetting" ADD COLUMN "warningThresholds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "dailyEvaluationLimit" INTEGER,
ADD COLUMN "weeklyEvaluationLimit" INTEGER,
ADD COLUMN "monthlyOutputTokenLimit" INTEGER,
ADD COLUMN "evaluationCallLimit" INTEGER;

-- Admission volume is counted per day/week window.
CREATE INDEX "EvaluationAdmission_createdAt_idx" ON "EvaluationAdmission"("createdAt");
