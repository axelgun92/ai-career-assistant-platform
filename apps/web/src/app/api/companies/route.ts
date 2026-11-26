import { createCompanyApiHandlers, getCompanyIntelligenceService } from "@/server/company-intelligence-service";

// Company Intelligence (feature 18): the company index for a window
// (?window=30d|90d|180d|365d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD, default
// all), filtered by q (name), listed, applied, signals (1 or 0), titleGroup and
// arrangement, ordered by sort (roles|recent|relisted|applications|name), 50
// per page. Read-only.
export async function GET(request: Request) {
  return createCompanyApiHandlers(getCompanyIntelligenceService()).index(request);
}
