-- Feature 14B cross-source correction (October 26, 2026). Additive; no
-- backfill.
--   seniorityLabel: the seniority label as a source or page states it
--     ("Mid-Senior level", "Junior and Mid level"), kept beside the
--     normalized level, which stays Unknown when the label names no single
--     level.
--   workArrangements: every work arrangement the posting states for the
--     role, in its order ("Office or Remote" -> ONSITE, REMOTE); remoteStatus
--     stays the one stated arrangement, and null when several are offered.
--
-- Rollback (manual):
--   ALTER TABLE "Opportunity" DROP COLUMN "workArrangements";
--   ALTER TABLE "Opportunity" DROP COLUMN "seniorityLabel";

ALTER TABLE "Opportunity" ADD COLUMN "seniorityLabel" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "workArrangements" TEXT[] DEFAULT ARRAY[]::TEXT[];
