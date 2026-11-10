-- Additive only: the application tracker (one Application per Opportunity,
-- append-only events, notes, contacts, follow-ups, interviews). Opportunity,
-- OpportunityUserAction and evaluator tables are untouched; the known
-- Recommendation.evidenceReferences default drift is intentionally excluded.
-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('PLANNED', 'APPLIED', 'SCREENING', 'INTERVIEWING', 'FINAL_ROUND', 'OFFER', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationOutcome" AS ENUM ('OFFER_ACCEPTED', 'OFFER_DECLINED', 'REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'NOT_SUBMITTED');

-- CreateEnum
CREATE TYPE "ApplicationEventType" AS ENUM ('CREATED', 'SUBMITTED', 'STAGE_CHANGED', 'CLOSED', 'REOPENED', 'NOTE_ADDED', 'NOTE_EDITED', 'CONTACT_ADDED', 'CONTACT_UPDATED', 'FOLLOW_UP_ADDED', 'FOLLOW_UP_COMPLETED', 'FOLLOW_UP_REOPENED', 'INTERVIEW_ADDED', 'INTERVIEW_UPDATED', 'DETAILS_UPDATED');

-- CreateEnum
CREATE TYPE "ApplicationContactRole" AS ENUM ('RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationInterviewKind" AS ENUM ('RECRUITER_SCREEN', 'HIRING_MANAGER', 'TECHNICAL', 'CASE_STUDY', 'PANEL', 'FINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');


-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "stage" "ApplicationStage" NOT NULL,
    "outcome" "ApplicationOutcome",
    "appliedOn" DATE,
    "closedOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastEventSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "ApplicationEventType" NOT NULL,
    "fromStage" "ApplicationStage",
    "toStage" "ApplicationStage",
    "outcome" "ApplicationOutcome",
    "occurredOn" DATE,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationNote" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationContact" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ApplicationContactRole" NOT NULL,
    "title" TEXT,
    "organization" TEXT,
    "email" TEXT,
    "profileUrl" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationFollowUp" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationInterview" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "kind" "ApplicationInterviewKind" NOT NULL,
    "roundLabel" TEXT,
    "scheduledAt" TIMESTAMPTZ(3),
    "status" "ApplicationInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "contactId" UUID,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_opportunityId_key" ON "Application"("opportunityId");

-- CreateIndex
CREATE INDEX "Application_stage_idx" ON "Application"("stage");

-- CreateIndex
CREATE INDEX "Application_appliedOn_idx" ON "Application"("appliedOn");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationEvent_applicationId_sequence_key" ON "ApplicationEvent"("applicationId", "sequence");

-- CreateIndex
CREATE INDEX "ApplicationNote_applicationId_createdAt_idx" ON "ApplicationNote"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationContact_applicationId_createdAt_idx" ON "ApplicationContact"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationFollowUp_applicationId_completedAt_dueOn_idx" ON "ApplicationFollowUp"("applicationId", "completedAt", "dueOn");

-- CreateIndex
CREATE INDEX "ApplicationFollowUp_completedAt_dueOn_idx" ON "ApplicationFollowUp"("completedAt", "dueOn");

-- CreateIndex
CREATE INDEX "ApplicationInterview_applicationId_scheduledAt_idx" ON "ApplicationInterview"("applicationId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNote" ADD CONSTRAINT "ApplicationNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationContact" ADD CONSTRAINT "ApplicationContact_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationFollowUp" ADD CONSTRAINT "ApplicationFollowUp_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationInterview" ADD CONSTRAINT "ApplicationInterview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationInterview" ADD CONSTRAINT "ApplicationInterview_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ApplicationContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Stage, outcome, closedOn and appliedOn always agree. appliedOn is empty
-- exactly when the application was never submitted (PLANNED, or closed as
-- NOT_SUBMITTED) and present for every submitted stage and outcome.
ALTER TABLE "Application" ADD CONSTRAINT "Application_outcome_matches_stage"
  CHECK (("stage" = 'CLOSED') = ("outcome" IS NOT NULL));
ALTER TABLE "Application" ADD CONSTRAINT "Application_closed_on_matches_stage"
  CHECK (("stage" = 'CLOSED') = ("closedOn" IS NOT NULL));
ALTER TABLE "Application" ADD CONSTRAINT "Application_applied_on_matches_stage"
  CHECK (
    ("stage" = 'PLANNED' AND "appliedOn" IS NULL)
    OR ("stage" IN ('APPLIED', 'SCREENING', 'INTERVIEWING', 'FINAL_ROUND', 'OFFER') AND "appliedOn" IS NOT NULL)
    OR ("stage" = 'CLOSED' AND "outcome" = 'NOT_SUBMITTED' AND "appliedOn" IS NULL)
    OR ("stage" = 'CLOSED' AND "outcome" IN ('OFFER_ACCEPTED', 'OFFER_DECLINED', 'REJECTED', 'WITHDRAWN', 'NO_RESPONSE') AND "appliedOn" IS NOT NULL)
  );
ALTER TABLE "Application" ADD CONSTRAINT "Application_version_positive" CHECK ("version" >= 1);
ALTER TABLE "Application" ADD CONSTRAINT "Application_sequence_nonnegative" CHECK ("lastEventSequence" >= 0);
ALTER TABLE "ApplicationNote" ADD CONSTRAINT "ApplicationNote_version_positive" CHECK ("version" >= 1);
ALTER TABLE "ApplicationContact" ADD CONSTRAINT "ApplicationContact_version_positive" CHECK ("version" >= 1);
ALTER TABLE "ApplicationFollowUp" ADD CONSTRAINT "ApplicationFollowUp_version_positive" CHECK ("version" >= 1);
ALTER TABLE "ApplicationInterview" ADD CONSTRAINT "ApplicationInterview_version_positive" CHECK ("version" >= 1);
