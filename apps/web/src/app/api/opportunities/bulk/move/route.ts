import { getOpportunityActionWriter } from "@/server/opportunity-action-service";
import { createOpportunityMoveHandlers, createOpportunityMoveService } from "@/server/opportunity-move-service";

// Bulk Move to (November 22, 2026): the explicitly selected opportunities
// only (at most 50), each moved and reported on its own.
export async function POST(request: Request) {
  return createOpportunityMoveHandlers(createOpportunityMoveService(getOpportunityActionWriter())).moveMany(request);
}
