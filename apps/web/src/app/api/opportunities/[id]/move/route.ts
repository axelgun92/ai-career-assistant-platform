import { getOpportunityActionWriter } from "@/server/opportunity-action-service";
import { createOpportunityMoveHandlers, createOpportunityMoveService } from "@/server/opportunity-move-service";

// Move to (November 22, 2026): Active, Saved, Dismissed, Archived or Restore,
// through the same guarded lifecycle actions as every other change.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createOpportunityMoveHandlers(createOpportunityMoveService(getOpportunityActionWriter())).move(request, id);
}
