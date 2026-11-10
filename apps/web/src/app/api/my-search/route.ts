import { createPersonalApiHandlers, getPersonalAnalyticsService } from "@/server/personal-analytics-service";

// Personal Job-Search Analytics (feature 17): the user's own evaluations and
// applications for a window (?window=30d|90d|180d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD,
// default all), filtered by titleGroup, recommendation (at application),
// arrangement, seniority, source (first-discovering source) and profile
// (fit and gap sections: active, a profile id, or none). Read-only.
export async function GET(request: Request) {
  return createPersonalApiHandlers(getPersonalAnalyticsService()).analytics(request);
}
