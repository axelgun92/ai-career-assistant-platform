-- Feature 14B: browsers paired with the extension companion. Additive: one
-- new table, no foreign keys; no existing row or column is changed. Only the
-- SHA-256 hash of each pairing credential is stored. Rollback:
-- DROP TABLE "ExtensionPairing"; (captured opportunities are unaffected).

-- CreateTable
CREATE TABLE "ExtensionPairing" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ExtensionPairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionPairing_tokenHash_key" ON "ExtensionPairing"("tokenHash");
