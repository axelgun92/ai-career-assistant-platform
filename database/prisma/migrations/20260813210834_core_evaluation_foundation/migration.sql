/*
  Warnings:

  - Added the required column `ruleVersion` to the `Evaluation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `evidenceType` to the `EvidenceRecord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `origin` to the `EvidenceRecord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ruleVersion` to the `StageResult` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stageVersion` to the `StageResult` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EvidenceOrigin" AS ENUM ('EXPLICIT', 'DERIVED', 'INFERRED');

-- CreateEnum
CREATE TYPE "ContradictionResolutionStatus" AS ENUM ('UNRESOLVED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Contradiction" ADD COLUMN     "evidenceIdsA" UUID[],
ADD COLUMN     "evidenceIdsB" UUID[],
ADD COLUMN     "relevantField" TEXT,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolutionStatus" "ContradictionResolutionStatus" NOT NULL DEFAULT 'UNRESOLVED',
ADD COLUMN     "resolvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "stageId" TEXT;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "executionMetadata" JSONB,
ADD COLUMN     "ruleVersion" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "EvidenceRecord" ADD COLUMN     "evidenceType" TEXT NOT NULL,
ADD COLUMN     "origin" "EvidenceOrigin" NOT NULL,
ADD COLUMN     "provenanceId" UUID,
ADD COLUMN     "sourceField" TEXT,
ADD COLUMN     "sourceRecordId" UUID;

-- AlterTable
ALTER TABLE "StageResult" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "retryable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ruleVersion" TEXT NOT NULL,
ADD COLUMN     "stageVersion" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "EvidenceRecord_sourceRecordId_idx" ON "EvidenceRecord"("sourceRecordId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_provenanceId_idx" ON "EvidenceRecord"("provenanceId");

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_provenanceId_fkey" FOREIGN KEY ("provenanceId") REFERENCES "FieldProvenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
