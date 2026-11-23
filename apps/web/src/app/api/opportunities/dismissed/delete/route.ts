import { PrismaOpportunityDeletionRepository } from "@ai-career/database";
import { createOpportunityDeletionHandlers } from "@/server/opportunity-deletion-service";

// Permanently deletes the selected dismissed opportunities (November 22,
// 2026); each is deleted or refused with its reason.
export async function POST(request: Request) {
  return createOpportunityDeletionHandlers(new PrismaOpportunityDeletionRepository()).deleteSelected(request);
}
