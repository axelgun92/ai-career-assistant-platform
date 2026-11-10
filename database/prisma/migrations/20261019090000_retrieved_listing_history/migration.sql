-- Feature 13: posting history per retrieved listing. Additive: a new enum and
-- table, two nullable columns, and a conservative backfill. No existing row
-- or column is changed.

-- CreateEnum
CREATE TYPE "RetrievedListingState" AS ENUM ('HISTORICAL', 'LISTED', 'MISSING', 'REMOVED', 'UNTRACKED');

-- AlterTable
ALTER TABLE "RetrievalSource" ADD COLUMN "trackingScopeKey" TEXT;

-- AlterTable
ALTER TABLE "RetrievalRun" ADD COLUMN "listingCoverageComplete" BOOLEAN;

-- CreateTable
CREATE TABLE "RetrievedListing" (
    "id" UUID NOT NULL,
    "retrievalSourceId" UUID NOT NULL,
    "trackingScopeKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "opportunityId" UUID,
    "removalCapable" BOOLEAN NOT NULL DEFAULT false,
    "state" "RetrievedListingState" NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenRunId" UUID,
    "missingSince" TIMESTAMPTZ(3),
    "missedCompleteRuns" INTEGER NOT NULL DEFAULT 0,
    "removedAt" TIMESTAMPTZ(3),
    "reappearedAt" TIMESTAMPTZ(3),
    "reappearances" INTEGER NOT NULL DEFAULT 0,
    "sourceExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RetrievedListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetrievedListing_retrievalSourceId_trackingScopeKey_externa_key" ON "RetrievedListing"("retrievalSourceId", "trackingScopeKey", "externalId");

-- CreateIndex
CREATE INDEX "RetrievedListing_opportunityId_idx" ON "RetrievedListing"("opportunityId");

-- CreateIndex
CREATE INDEX "RetrievedListing_lastSeenRunId_idx" ON "RetrievedListing"("lastSeenRunId");

-- AddForeignKey
ALTER TABLE "RetrievedListing" ADD CONSTRAINT "RetrievedListing_retrievalSourceId_fkey" FOREIGN KEY ("retrievalSourceId") REFERENCES "RetrievalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievedListing" ADD CONSTRAINT "RetrievedListing_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievedListing" ADD CONSTRAINT "RetrievedListing_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "RetrievalRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one HISTORICAL row per listing retrieved before feature 13, in
-- the legacy baseline scope (''). It records when the listing was first
-- discovered and last observed, never that it is listed now; a source's
-- first run adopts the baseline into its first scope generation.
INSERT INTO "RetrievedListing" (
    "id", "retrievalSourceId", "trackingScopeKey", "source", "externalId", "opportunityId",
    "removalCapable", "state", "firstSeenAt", "lastSeenAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    sr."retrievalSourceId",
    '',
    MIN(sr."source"),
    sr."externalId",
    (ARRAY_AGG(sr."opportunityId" ORDER BY sr."createdAt" DESC, sr."id" DESC) FILTER (WHERE sr."opportunityId" IS NOT NULL))[1],
    rs."adapterKey" IN ('greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters'),
    'HISTORICAL',
    MIN(sr."discoveredAt"),
    MAX(sr."lastObservedAt"),
    CURRENT_TIMESTAMP
FROM "SourceRecord" sr
JOIN "RetrievalSource" rs ON rs."id" = sr."retrievalSourceId"
WHERE sr."externalId" IS NOT NULL
GROUP BY sr."retrievalSourceId", sr."externalId", rs."adapterKey";
