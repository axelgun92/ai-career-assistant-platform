-- Mode B capture history: one row per "Save selected jobs" from a results
-- page, listing the staged items it covered; and, for Setup & Connection, the
-- extension version that last used each pairing. Additive only: one new
-- table and one nullable column.
-- Rollback: DROP TABLE "PageCaptureSession";
--           ALTER TABLE "ExtensionPairing" DROP COLUMN "lastExtensionVersion";

-- AlterTable
ALTER TABLE "ExtensionPairing" ADD COLUMN "lastExtensionVersion" TEXT;

-- CreateTable
CREATE TABLE "PageCaptureSession" (
    "id" UUID NOT NULL,
    "site" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "pageTitle" TEXT,
    "pairingId" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "itemIds" UUID[],
    "counts" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageCaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageCaptureSession_receivedAt_idx" ON "PageCaptureSession"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "PageCaptureSession_site_receivedAt_idx" ON "PageCaptureSession"("site", "receivedAt");
