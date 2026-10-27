-- Feature 14B final cross-source batch (October 27, 2026). Additive; no
-- backfill.
--   compensationTiers: labelled pay ranges a posting states for several
--     places, zones or bands ("Zone 2", "U.S.", "Canada"), each with its own
--     amounts and currency, as [{ "label", "minimum", "maximum", "currency" }].
--     salaryMin/salaryMax stay null when there are tiers. Empty when not
--     stated.
--
-- Rollback (manual):
--   ALTER TABLE "Opportunity" DROP COLUMN "compensationTiers";

ALTER TABLE "Opportunity" ADD COLUMN "compensationTiers" JSONB NOT NULL DEFAULT '[]';
