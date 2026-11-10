-- Additive only: Opportunity indexes for the dashboard's default sort, lifecycle
-- views, source-type filter and recently-updated sort. No evaluator tables touched;
-- the known Recommendation.evidenceReferences default drift is excluded.

-- CreateIndex
CREATE INDEX "Opportunity_discoveredAt_id_idx" ON "Opportunity"("discoveredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Opportunity_status_discoveredAt_idx" ON "Opportunity"("status", "discoveredAt");

-- CreateIndex
CREATE INDEX "Opportunity_sourceType_idx" ON "Opportunity"("sourceType");

-- CreateIndex
CREATE INDEX "Opportunity_updatedAt_idx" ON "Opportunity"("updatedAt");

