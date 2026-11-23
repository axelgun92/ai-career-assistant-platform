import {
  isActiveApplication,
  isSubmitted,
  lifecycleActionGuard,
  opportunityMoveDestinationActions,
  opportunityMoveDestinationSchema,
  opportunityMoveOptions,
  resolveUserAction,
  type ApplicationOutcome,
  type ApplicationStage,
  type OpportunityLifecycleState,
  type OpportunityMoveDestination,
  type OpportunityUserAction,
  type SystemLifecycleState,
  type UserActionHistoryEntry,
} from "@ai-career/core";
import { z } from "zod";
import type { OpportunityActionWriter } from "./opportunity-action-service";

// Move to (November 22, 2026): one implementation for the opportunity page,
// the dashboard's row menu and its bulk actions. Every move is one ordinary
// lifecycle action through the guarded writer (row lock, application guard,
// compare-and-set), recorded in the action history; nothing is fabricated.
// Bulk moves take an explicit list of IDs and report every opportunity's
// own result, never skipping one silently.

export type OpportunityMoveResult =
  | { opportunityId: string; result: "MOVED"; action: OpportunityUserAction; from: OpportunityLifecycleState; status: OpportunityLifecycleState }
  | { opportunityId: string; result: "NOT_ALLOWED" | "BLOCKED_BY_APPLICATION" | "CONFLICT" | "NOT_FOUND" | "FAILED"; reason: string };

export const opportunityMoveBulkLimit = 50;

export const destinationLabels: Record<OpportunityMoveDestination, string> = {
  ACTIVE: "Active",
  SAVED: "Saved",
  DISMISSED: "Dismissed",
  ARCHIVED: "Archived",
  RESTORE: "Restore",
};

export function applicationMoveState(application: { stage: ApplicationStage; outcome: ApplicationOutcome | null } | null) {
  return application ? { submitted: isSubmitted(application.stage, application.outcome), active: isActiveApplication(application.stage) } : null;
}

// The Move to choices for the opportunity page: which destinations apply,
// and which of them the lifecycle allows but the application record blocks
// (shown with the reason).
export function moveChoices(input: {
  status: OpportunityLifecycleState;
  history: readonly UserActionHistoryEntry[];
  systemState: SystemLifecycleState;
  application: { stage: ApplicationStage; outcome: ApplicationOutcome | null } | null;
}): { available: OpportunityMoveDestination[]; blocked: Array<{ destination: OpportunityMoveDestination; reason: string }> } {
  const available: OpportunityMoveDestination[] = [];
  const blocked: Array<{ destination: OpportunityMoveDestination; reason: string }> = [];
  for (const destination of opportunityMoveOptions({ status: input.status, application: null })) {
    const actions: OpportunityUserAction[] = destination === "RESTORE" ? ["RESTORE", "REACTIVATE"] : [opportunityMoveDestinationActions[destination]];
    const action = actions.find(
      (candidate) => resolveUserAction({ action: candidate, currentStatus: input.status, history: input.history, currentSystemState: input.systemState }).allowed,
    );
    if (!action) continue;
    const guard = lifecycleActionGuard(action, input.status, input.application);
    if (guard.allowed) available.push(destination);
    else blocked.push({ destination, reason: guard.reason });
  }
  return { available, blocked };
}

const reasons = {
  NOT_FOUND: "Opportunity not found",
  CONFLICT: "The opportunity changed at the same time; reload and try again",
  FAILED: "The move could not be completed",
};

export function createOpportunityMoveService(writer: OpportunityActionWriter) {
  async function apply(opportunityId: string, action: OpportunityUserAction): Promise<OpportunityMoveResult> {
    const result = await writer.applyUserAction({ opportunityId, action });
    switch (result.status) {
      case "APPLIED":
        return { opportunityId, result: "MOVED", action, from: result.from, status: result.to };
      case "NOT_FOUND":
        return { opportunityId, result: "NOT_FOUND", reason: reasons.NOT_FOUND };
      case "CONFLICT":
        return { opportunityId, result: "CONFLICT", reason: reasons.CONFLICT };
      case "NOT_ALLOWED":
        return { opportunityId, result: "NOT_ALLOWED", reason: result.reason };
      case "BLOCKED_BY_APPLICATION":
        return { opportunityId, result: "BLOCKED_BY_APPLICATION", reason: result.reason };
    }
  }

  async function move(opportunityId: string, destination: OpportunityMoveDestination): Promise<OpportunityMoveResult> {
    try {
      if (destination !== "RESTORE") return await apply(opportunityId, opportunityMoveDestinationActions[destination]);
      // Restore: back to the state before the opportunity was dismissed or
      // archived; when the history does not say, to Active.
      const restored = await apply(opportunityId, "RESTORE");
      return restored.result === "NOT_ALLOWED" ? await apply(opportunityId, "REACTIVATE") : restored;
    } catch (error) {
      console.error("Opportunity move failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
      return { opportunityId, result: "FAILED", reason: reasons.FAILED };
    }
  }

  return {
    move,
    // One opportunity at a time, each in its own transaction, in the given
    // order; every ID gets its own result.
    async moveMany(opportunityIds: readonly string[], destination: OpportunityMoveDestination): Promise<OpportunityMoveResult[]> {
      const results: OpportunityMoveResult[] = [];
      for (const id of opportunityIds) results.push(await move(id, destination));
      return results;
    },
  };
}

const moveSchema = z.object({ destination: opportunityMoveDestinationSchema }).strict();
const bulkMoveSchema = z
  .object({ destination: opportunityMoveDestinationSchema, opportunityIds: z.array(z.uuid()).min(1).max(opportunityMoveBulkLimit) })
  .strict();

async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }) };
  }
}

const statusOf = (result: OpportunityMoveResult) =>
  result.result === "MOVED" ? 200 : result.result === "NOT_FOUND" ? 404 : result.result === "FAILED" ? 500 : 409;

export function createOpportunityMoveHandlers(service: ReturnType<typeof createOpportunityMoveService>) {
  return {
    // POST /api/opportunities/[id]/move {destination}
    async move(request: Request, opportunityIdValue: string) {
      const id = z.uuid().safeParse(opportunityIdValue);
      if (!id.success) return Response.json({ error: "Opportunity not found", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
      const read = await readBody(request);
      if (!read.ok) return read.response;
      const parsed = moveSchema.safeParse(read.body);
      if (!parsed.success) return Response.json({ error: "The move is invalid", code: "REQUEST_INVALID" }, { status: 400 });
      const result = await service.move(id.data, parsed.data.destination);
      return Response.json(result.result === "MOVED" ? result : { ...result, error: result.reason }, { status: statusOf(result) });
    },
    // POST /api/opportunities/bulk/move {destination, opportunityIds}: the
    // stated opportunities only; partial failures are reported one by one.
    async moveMany(request: Request) {
      const read = await readBody(request);
      if (!read.ok) return read.response;
      const parsed = bulkMoveSchema.safeParse(read.body);
      if (!parsed.success) {
        return Response.json(
          { error: `Select between 1 and ${opportunityMoveBulkLimit} opportunities and a destination`, code: "REQUEST_INVALID" },
          { status: 400 },
        );
      }
      const ids = [...new Set(parsed.data.opportunityIds)];
      const results = await service.moveMany(ids, parsed.data.destination);
      return Response.json({
        destination: parsed.data.destination,
        requested: ids.length,
        moved: results.filter((item) => item.result === "MOVED").length,
        failed: results.filter((item) => item.result !== "MOVED").length,
        results,
      });
    },
  };
}
