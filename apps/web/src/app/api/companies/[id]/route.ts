import { createCompanyApiHandlers, getCompanyIntelligenceService } from "@/server/company-intelligence-service";

// Company Intelligence (feature 18): one company's observed postings, recurring
// roles, work arrangement and hiring regions, posting-history signals and your
// application history, for a window (as the index). Any Company id of the
// company's name group resolves to it; an unknown id is 404. Read-only.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createCompanyApiHandlers(getCompanyIntelligenceService()).detail(request, id);
}
