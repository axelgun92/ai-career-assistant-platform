CREATE TABLE "AiModelPricingConfiguration" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "inputCostPerMillionTokens" DECIMAL(18,6) NOT NULL,
  "cachedInputCostPerMillionTokens" DECIMAL(18,6) NOT NULL,
  "outputCostPerMillionTokens" DECIMAL(18,6) NOT NULL,
  "longContextThresholdTokens" INTEGER,
  "longContextInputMultiplier" DECIMAL(8,4) NOT NULL,
  "longContextOutputMultiplier" DECIMAL(8,4) NOT NULL,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveTo" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiModelPricingConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiModelPricingConfiguration_provider_model_version_key"
ON "AiModelPricingConfiguration"("provider", "model", "version");

CREATE INDEX "AiModelPricingConfiguration_provider_model_effectiveFrom_idx"
ON "AiModelPricingConfiguration"("provider", "model", "effectiveFrom");

INSERT INTO "AiModelPricingConfiguration" (
  "id",
  "provider",
  "model",
  "version",
  "currency",
  "inputCostPerMillionTokens",
  "cachedInputCostPerMillionTokens",
  "outputCostPerMillionTokens",
  "longContextThresholdTokens",
  "longContextInputMultiplier",
  "longContextOutputMultiplier",
  "effectiveFrom",
  "effectiveTo"
) VALUES (
  '56000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-5.6-terra',
  'openai-gpt-5.6-terra-standard-2026-07-30',
  'USD',
  2.000000,
  0.200000,
  12.000000,
  272000,
  2.0000,
  1.5000,
  '2026-07-30T00:00:00.000Z',
  NULL
);

ALTER TABLE "SemanticOperationAttempt"
  ADD COLUMN "opportunityId" UUID,
  ADD COLUMN "domain" TEXT,
  ADD COLUMN "sourceRecordId" UUID,
  ADD COLUMN "jobSource" TEXT,
  ADD COLUMN "cachedInputTokens" INTEGER,
  ADD COLUMN "reasoningTokens" INTEGER,
  ADD COLUMN "estimatedCost" DECIMAL(18,12),
  ADD COLUMN "pricingConfigurationId" UUID;

UPDATE "SemanticOperationAttempt" AS attempt
SET
  "opportunityId" = evaluation."opportunityId",
  "domain" = evaluation."domain"
FROM "Evaluation" AS evaluation
WHERE evaluation."id" = attempt."evaluationId";

UPDATE "SemanticOperationAttempt" AS attempt
SET
  "sourceRecordId" = source_record."id",
  "jobSource" = COALESCE(source_record."source", opportunity."source")
FROM "Evaluation" AS evaluation
JOIN "Opportunity" AS opportunity
  ON opportunity."id" = evaluation."opportunityId"
LEFT JOIN LATERAL (
  SELECT source."id", source."source"
  FROM "SourceRecord" AS source
  WHERE source."opportunityId" = opportunity."id"
  ORDER BY source."createdAt" ASC
  LIMIT 1
) AS source_record ON TRUE
WHERE evaluation."id" = attempt."evaluationId";

ALTER TABLE "SemanticOperationAttempt"
  ALTER COLUMN "opportunityId" SET NOT NULL,
  ALTER COLUMN "domain" SET NOT NULL;

CREATE INDEX "SemanticOperationAttempt_opportunityId_createdAt_idx"
ON "SemanticOperationAttempt"("opportunityId", "createdAt");

CREATE INDEX "SemanticOperationAttempt_domain_createdAt_idx"
ON "SemanticOperationAttempt"("domain", "createdAt");

CREATE INDEX "SemanticOperationAttempt_sourceRecordId_idx"
ON "SemanticOperationAttempt"("sourceRecordId");

CREATE INDEX "SemanticOperationAttempt_pricingConfigurationId_idx"
ON "SemanticOperationAttempt"("pricingConfigurationId");

ALTER TABLE "SemanticOperationAttempt"
ADD CONSTRAINT "SemanticOperationAttempt_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SemanticOperationAttempt"
ADD CONSTRAINT "SemanticOperationAttempt_sourceRecordId_fkey"
FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SemanticOperationAttempt"
ADD CONSTRAINT "SemanticOperationAttempt_pricingConfigurationId_fkey"
FOREIGN KEY ("pricingConfigurationId")
REFERENCES "AiModelPricingConfiguration"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
