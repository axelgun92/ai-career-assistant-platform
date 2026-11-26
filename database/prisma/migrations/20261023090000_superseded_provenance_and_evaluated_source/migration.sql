-- Feature 14B closeout, current-version projection (Core TDD §51, v1.15).
-- Additive only. Rollback:
--   ALTER TABLE "Evaluation" DROP CONSTRAINT "Evaluation_sourceRecordId_fkey";
--   DROP INDEX "Evaluation_sourceRecordId_idx";
--   ALTER TABLE "Evaluation" DROP COLUMN "sourceRecordId";
--   ALTER TABLE "FieldProvenance" DROP COLUMN "supersededAt";

-- When a newer source version (or a newer application link) replaced this row
-- as its field's current evidence. Superseded rows are kept for history.
ALTER TABLE "FieldProvenance" ADD COLUMN "supersededAt" TIMESTAMPTZ(3);

-- The source version an evaluation evaluates, bound when it is created.
ALTER TABLE "Evaluation" ADD COLUMN "sourceRecordId" UUID;

-- CreateIndex
CREATE INDEX "Evaluation_sourceRecordId_idx" ON "Evaluation"("sourceRecordId");

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
