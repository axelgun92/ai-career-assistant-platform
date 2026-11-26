-- November 25, 2026: triage reassessment history and user-confirmed facts.
-- Every pre-evaluator triage assessment is kept (PreEvaluatorTriageHistory;
-- the existing current assessments are copied in as their first entries),
-- and the facts a user confirms from the job description are stored apart
-- from the captured evidence, with an audit trail of every save, edit and
-- undo. Additive only: no existing row changes.

-- CreateTable
CREATE TABLE "PreEvaluatorTriageHistory" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "outcome" "PreEvaluatorTriageOutcome" NOT NULL,
    "reasons" JSONB NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "userProfileId" UUID,
    "userProfileVersion" INTEGER,
    "trigger" TEXT NOT NULL,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreEvaluatorTriageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConfirmedFact" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "fieldName" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "capturedValue" JSONB,
    "quotation" TEXT,
    "note" TEXT,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserConfirmedFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConfirmedFactEvent" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "fieldName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "value" JSONB,
    "quotation" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConfirmedFactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreEvaluatorTriageHistory_opportunityId_assessedAt_idx" ON "PreEvaluatorTriageHistory"("opportunityId", "assessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserConfirmedFact_opportunityId_fieldName_key" ON "UserConfirmedFact"("opportunityId", "fieldName");

-- CreateIndex
CREATE INDEX "UserConfirmedFactEvent_opportunityId_createdAt_idx" ON "UserConfirmedFactEvent"("opportunityId", "createdAt");

-- AddForeignKey
ALTER TABLE "PreEvaluatorTriageHistory" ADD CONSTRAINT "PreEvaluatorTriageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConfirmedFact" ADD CONSTRAINT "UserConfirmedFact_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConfirmedFactEvent" ADD CONSTRAINT "UserConfirmedFactEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The existing current assessments, as each opportunity's first history entry.
INSERT INTO "PreEvaluatorTriageHistory" ("id", "opportunityId", "outcome", "reasons", "inputFingerprint", "userProfileId", "userProfileVersion", "trigger", "assessedAt")
SELECT gen_random_uuid(), t."opportunityId", t."outcome", t."reasons", t."inputFingerprint", t."userProfileId", t."userProfileVersion", 'INITIAL', t."assessedAt"
FROM "PreEvaluatorTriage" t;
