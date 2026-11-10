-- Feature 11A: automated retrieval sources, runs and retrieval provenance
-- on source records. Additive only; no existing row is changed.
-- Retrieval sources and runs that produced records cannot be deleted
-- (ON DELETE RESTRICT); they are archived instead.
-- Recommendation.evidenceReferences default drift is intentionally excluded.

-- CreateEnum
CREATE TYPE "RetrievalType" AS ENUM ('OFFICIAL_PUBLIC_API_FEED', 'BROWSER_ASSISTED', 'PUBLIC_GUEST_INTERNAL_ENDPOINT', 'PUBLIC_HTML');

-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('ATS', 'COMPANY_CAREERS', 'JOB_BOARD', 'MARKETPLACE', 'AGGREGATOR');

-- CreateEnum
CREATE TYPE "RetrievalRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "RetrievalTrigger" AS ENUM ('MANUAL', 'SCHEDULE');

-- AlterTable
ALTER TABLE "SourceRecord" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "previousSourceRecordId" UUID,
ADD COLUMN     "retrievalRunId" UUID,
ADD COLUMN     "retrievalSourceId" UUID,
ADD COLUMN     "retrievalType" "RetrievalType",
ADD COLUMN     "sourceCategory" "SourceCategory";

-- CreateTable
CREATE TABLE "RetrievalSource" (
    "id" UUID NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "retrievalType" "RetrievalType" NOT NULL,
    "sourceCategory" "SourceCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "scheduleMinutes" INTEGER NOT NULL DEFAULT 720,
    "lastRunAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RetrievalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalRun" (
    "id" UUID NOT NULL,
    "retrievalSourceId" UUID NOT NULL,
    "trigger" "RetrievalTrigger" NOT NULL,
    "status" "RetrievalRunStatus" NOT NULL DEFAULT 'QUEUED',
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "counts" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RetrievalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetrievalSource_enabled_archivedAt_idx" ON "RetrievalSource"("enabled", "archivedAt");

-- CreateIndex
CREATE INDEX "RetrievalRun_retrievalSourceId_createdAt_idx" ON "RetrievalRun"("retrievalSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "RetrievalRun_status_createdAt_idx" ON "RetrievalRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SourceRecord_retrievalSourceId_idx" ON "SourceRecord"("retrievalSourceId");

-- CreateIndex
CREATE INDEX "SourceRecord_retrievalRunId_idx" ON "SourceRecord"("retrievalRunId");

-- CreateIndex
CREATE INDEX "SourceRecord_previousSourceRecordId_idx" ON "SourceRecord"("previousSourceRecordId");

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_retrievalSourceId_fkey" FOREIGN KEY ("retrievalSourceId") REFERENCES "RetrievalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_retrievalRunId_fkey" FOREIGN KEY ("retrievalRunId") REFERENCES "RetrievalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_previousSourceRecordId_fkey" FOREIGN KEY ("previousSourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalRun" ADD CONSTRAINT "RetrievalRun_retrievalSourceId_fkey" FOREIGN KEY ("retrievalSourceId") REFERENCES "RetrievalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
