-- Additive only: the explicitly chosen active profile version per domain.
-- UserProfile rows are never updated by activation; evaluator tables are untouched.
-- CreateTable
CREATE TABLE "ActiveUserProfile" (
    "domain" TEXT NOT NULL,
    "userProfileId" UUID NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveUserProfile_pkey" PRIMARY KEY ("domain")
);

-- CreateIndex
CREATE INDEX "ActiveUserProfile_userProfileId_idx" ON "ActiveUserProfile"("userProfileId");

-- AddForeignKey
ALTER TABLE "ActiveUserProfile" ADD CONSTRAINT "ActiveUserProfile_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
