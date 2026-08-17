-- Preserve complete domain results and stable semantic evidence references.
ALTER TABLE "Evaluation" ADD COLUMN "domainResult" JSONB;
ALTER TABLE "EvidenceRecord" ADD COLUMN "referenceId" TEXT;

UPDATE "EvidenceRecord"
SET "referenceId" = "id"::text
WHERE "referenceId" IS NULL;

ALTER TABLE "EvidenceRecord" ALTER COLUMN "referenceId" SET NOT NULL;
CREATE INDEX "EvidenceRecord_evaluationId_referenceId_idx"
ON "EvidenceRecord"("evaluationId", "referenceId");

-- Persist the full domain-owned recommendation explanation.
ALTER TABLE "Recommendation" ADD COLUMN "reviewConditions" JSONB;
ALTER TABLE "Recommendation" ADD COLUMN "evidenceReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "SemanticOperationStatus" AS ENUM (
  'SUCCESS',
  'VALIDATION_FAILURE',
  'PROVIDER_FAILURE',
  'TIMEOUT'
);

CREATE TABLE "EvaluationTask" (
  "id" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMPTZ(3),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "EvaluationTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SemanticOperationAttempt" (
  "id" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "operationId" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" "SemanticOperationStatus" NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "providerRequestId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SemanticOperationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationTask_evaluationId_key" ON "EvaluationTask"("evaluationId");
CREATE INDEX "EvaluationTask_status_availableAt_idx" ON "EvaluationTask"("status", "availableAt");
CREATE INDEX "EvaluationTask_leaseExpiresAt_idx" ON "EvaluationTask"("leaseExpiresAt");
CREATE UNIQUE INDEX "SemanticOperationAttempt_evaluationId_operationId_attempt_key"
ON "SemanticOperationAttempt"("evaluationId", "operationId", "attempt");
CREATE INDEX "SemanticOperationAttempt_evaluationId_createdAt_idx"
ON "SemanticOperationAttempt"("evaluationId", "createdAt");

ALTER TABLE "EvaluationTask"
ADD CONSTRAINT "EvaluationTask_evaluationId_fkey"
FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SemanticOperationAttempt"
ADD CONSTRAINT "SemanticOperationAttempt_evaluationId_fkey"
FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
