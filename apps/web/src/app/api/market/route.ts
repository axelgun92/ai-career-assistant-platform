import { createMarketApiHandlers, getMarketAnalyticsService } from "@/server/market-analytics-service";

// Job-Market Analytics (feature 16): the collected market for a first-seen
// window (?window=7d|30d|90d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD),
// filtered by titleGroup, seniority, arrangement, region, currency,
// collected=automated|all (default automated) and excludeRemoved=1. Read-only.
export async function GET(request: Request) {
  return createMarketApiHandlers(getMarketAnalyticsService()).analytics(request);
}
