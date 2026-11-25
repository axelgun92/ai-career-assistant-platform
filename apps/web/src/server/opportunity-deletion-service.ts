import type { OpportunityDeletionOutcome, OpportunityDeletionResult } from "@ai-career/database";
import { z } from "zod";
import { safeErrorDetails } from "./safe-error";

// Permanent deletion, from Dismissed only (November 22, 2026). Ordinary
// Move to never deletes. "Delete selected" takes the explicitly selected IDs
// (at most 50); "Empty Dismissed" deletes every dismissed opportunity, but
// only when the count the user confirmed is still the current count. Each
// opportunity is deleted, or refused with a reason, on its own.

export interface OpportunityDeletionStore {
  dismissedCount(): Promise<number>;
  dismissedIds(): Promise<string[]>;
  deleteDismissed(opportunityId: string): Promise<OpportunityDeletionResult>;
}

export const opportunityDeletionBulkLimit = 50;

export const deletionReasons: Record<Exclude<OpportunityDeletionOutcome, "DELETED">, string> = {
  NOT_FOUND: "Not found (it may already be deleted)",
  NOT_DISMISSED: "Not in Dismissed; only dismissed opportunities can be deleted permanently",
  HAS_APPLICATION: "Has application history, which is never deleted; archive it instead",
  EVALUATION_IN_PROGRESS: "An evaluation for it is queued, running or deferred; try again once it has finished",
};

const view = (result: OpportunityDeletionResult) =>
  result.outcome === "DELETED"
    ? { opportunityId: result.opportunityId, result: "DELETED" as const }
    : { opportunityId: result.opportunityId, result: result.outcome, reason: deletionReasons[result.outcome] };

const deleteSchema = z.object({ opportunityIds: z.array(z.uuid()).min(1).max(opportunityDeletionBulkLimit) }).strict();
const emptySchema = z.object({ expectedCount: z.number().int().min(1) }).strict();

async function readBody(request: Request) {
  try {
    return { ok: true as const, body: (await request.json()) as unknown };
  } catch {
    return { ok: false as const, response: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }) };
  }
}

export function createOpportunityDeletionHandlers(store: OpportunityDeletionStore) {
  async function deleteAll(ids: readonly string[]) {
    const results = [];
    for (const id of ids) {
      try {
        results.push(view(await store.deleteDismissed(id)));
      } catch (error) {
        // The error name, code and a redacted message (November 25, 2026):
        // never job text or connection details.
        console.error("Opportunity deletion failed", safeErrorDetails(error));
        results.push({ opportunityId: id, result: "FAILED" as const, reason: "Could not be deleted; nothing was changed for it" });
      }
    }
    return {
      requested: ids.length,
      deleted: results.filter((item) => item.result === "DELETED").length,
      kept: results.filter((item) => item.result !== "DELETED").length,
      results,
    };
  }

  return {
    // POST /api/opportunities/dismissed/delete {opportunityIds}
    async deleteSelected(request: Request) {
      const read = await readBody(request);
      if (!read.ok) return read.response;
      const parsed = deleteSchema.safeParse(read.body);
      if (!parsed.success) {
        return Response.json(
          { error: `Select between 1 and ${opportunityDeletionBulkLimit} dismissed opportunities`, code: "REQUEST_INVALID" },
          { status: 400 },
        );
      }
      return Response.json(await deleteAll([...new Set(parsed.data.opportunityIds)]));
    },
    // POST /api/opportunities/dismissed/empty {expectedCount}
    async empty(request: Request) {
      const read = await readBody(request);
      if (!read.ok) return read.response;
      const parsed = emptySchema.safeParse(read.body);
      if (!parsed.success) return Response.json({ error: "State how many dismissed opportunities to delete", code: "REQUEST_INVALID" }, { status: 400 });
      try {
        const current = await store.dismissedCount();
        if (current !== parsed.data.expectedCount) {
          return Response.json(
            {
              error: `Dismissed now holds ${current} opportunities, not ${parsed.data.expectedCount}; nothing was deleted. Reload and confirm again.`,
              code: "DISMISSED_COUNT_CHANGED",
              current,
            },
            { status: 409 },
          );
        }
        return Response.json(await deleteAll(await store.dismissedIds()));
      } catch (error) {
        console.error("Empty Dismissed failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return Response.json({ error: "Dismissed could not be emptied", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  };
}
