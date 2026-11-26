-- Mode B results-page capture staging (browser extension). Additive only.
-- Rollback: DROP TABLE "PageCaptureItem"; DROP TYPE "PageCaptureItemStatus";

-- CreateEnum
CREATE TYPE "PageCaptureItemStatus" AS ENUM ('QUEUED', 'ACQUIRING', 'INGESTED', 'AWAITING_DETAILS', 'UNAVAILABLE', 'ALREADY_SAVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "PageCaptureItem" (
    "id" UUID NOT NULL,
    "site" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "siteJobId" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "location" TEXT,
    "postedText" TEXT,
    "resultsPageUrl" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "sightings" INTEGER NOT NULL DEFAULT 1,
    "lastBatchId" UUID NOT NULL,
    "pairingId" UUID NOT NULL,
    "status" "PageCaptureItemStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lastReason" TEXT,
    "opportunityId" UUID,
    "handoffOutcome" TEXT,
    "handedOffAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PageCaptureItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PageCaptureItem_externalId_key" ON "PageCaptureItem"("externalId");
CREATE INDEX "PageCaptureItem_status_nextAttemptAt_idx" ON "PageCaptureItem"("status", "nextAttemptAt");
CREATE INDEX "PageCaptureItem_site_lastAttemptAt_idx" ON "PageCaptureItem"("site", "lastAttemptAt");
CREATE INDEX "PageCaptureItem_opportunityId_idx" ON "PageCaptureItem"("opportunityId");

ALTER TABLE "PageCaptureItem" ADD CONSTRAINT "PageCaptureItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
