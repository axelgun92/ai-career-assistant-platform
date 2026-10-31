import { createSourceInsightsApiHandlers, getSourceInsightsService } from "@/server/source-intelligence-service";

// Source Intelligence (feature 15): per-source evidence for a window
// (?window=7d|30d|90d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD), grouped by
// configured source or adapter (?groupBy=adapter), optionally with archived
// sources (?archived=include). Read-only.
export async function GET(request: Request) {
  return createSourceInsightsApiHandlers(getSourceInsightsService()).overview(request);
}
