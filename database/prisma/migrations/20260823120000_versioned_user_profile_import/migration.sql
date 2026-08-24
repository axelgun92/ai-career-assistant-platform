ALTER TABLE "UserProfile"
ADD COLUMN "contentHash" TEXT;

CREATE UNIQUE INDEX "UserProfile_label_version_key"
ON "UserProfile"("label", "version");

CREATE UNIQUE INDEX "UserProfile_label_contentHash_key"
ON "UserProfile"("label", "contentHash");
