import { PrismaOpportunityDeletionRepository } from "@ai-career/database";
import { createOpportunityDeletionHandlers } from "@/server/opportunity-deletion-service";

// Empty Dismissed (November 22, 2026): deletes every dismissed opportunity,
// only when the confirmed count is still the current count.
export async function POST(request: Request) {
  return createOpportunityDeletionHandlers(new PrismaOpportunityDeletionRepository()).empty(request);
}
