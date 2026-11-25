-- November 25, 2026: triage-to-lifecycle routing and the duplicate review.
-- The reason the app itself moved an opportunity to Dismissed (a triage
-- REJECT or a title outside the target job titles; null for the user's own
-- actions), and the user's "same job" duplicate decision. Additive only:
-- no existing row changes.

-- CreateEnum
CREATE TYPE "AutomaticDismissalReason" AS ENUM ('TRIAGE_REJECT', 'OUTSIDE_TARGET_TITLES');

-- AlterEnum
ALTER TYPE "DuplicateResolution" ADD VALUE 'SAME_JOB';

-- AlterTable
ALTER TABLE "OpportunityUserAction" ADD COLUMN     "automaticReason" "AutomaticDismissalReason";
