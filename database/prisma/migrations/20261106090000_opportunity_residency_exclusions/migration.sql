-- Places a posting explicitly excludes from hiring (Workstream B, November 5,
-- 2026). Additive: existing rows read as "none stated".
ALTER TABLE "Opportunity"
ADD COLUMN "residencyExclusions" TEXT[] DEFAULT ARRAY[]::TEXT[];
