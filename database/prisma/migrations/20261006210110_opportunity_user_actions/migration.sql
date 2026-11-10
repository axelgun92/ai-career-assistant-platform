-- Additive only: user lifecycle action history. Evaluator tables are untouched.
-- CreateEnum
CREATE TYPE "OpportunityUserActionType" AS ENUM ('SAVE', 'MARK_APPLIED', 'DISMISS', 'ARCHIVE', 'RESTORE');

-- CreateTable
CREATE TABLE "OpportunityUserAction" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "action" "OpportunityUserActionType" NOT NULL,
    "fromStatus" "OpportunityStatus" NOT NULL,
    "toStatus" "OpportunityStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityUserAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpportunityUserAction_opportunityId_createdAt_idx" ON "OpportunityUserAction"("opportunityId", "createdAt");

-- AddForeignKey
ALTER TABLE "OpportunityUserAction" ADD CONSTRAINT "OpportunityUserAction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
