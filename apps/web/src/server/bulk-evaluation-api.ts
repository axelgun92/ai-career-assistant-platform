import { getDatabaseClient } from "@ai-career/database";
import { z } from "zod";
import type { AdmitBatchResult } from "./budget-service";
import { safeError } from "./evaluation-api";
import type { EvaluationService } from "./evaluation-service";
import { getEvaluationService } from "./evaluation-service";

// Bulk evaluation API (November 26, 2026). The server is the authority: a
// preflight checks the explicit selection (never a query) against every
// selected job's eligibility and every enabled limit and writes nothing; a
// submit rechecks everything in one transaction and queues every job or
// none. Responses carry only IDs, titles, reason codes and counts: no job
// text, URLs or credentials. Like the individual request (which answers 200
// for a deferred or triage-held request), an expected refusal (a limit, or
// jobs no longer available) is a 200 distinguished by its status, so the
// browser never logs a normal outcome as a failed request; 202 means queued
// and 400 an invalid selection.
export const bulkEvaluationLimit = 50;

const requestSchema = z
  .object({ opportunityIds: z.array(z.uuid()).min(1).max(bulkEvaluationLimit) })
  .strict();

export type BulkEvaluationResponse =
  | { status: "READY"; count: number; reservation: { perEvaluation: number; total: number; currency: string } | null }
  | { status: "QUEUED"; queued: Array<{ opportunityId: string; evaluationId: string }> }
  | { status: "INELIGIBLE"; items: Array<{ opportunityId: string; title: string | null; reason: string }> }
  | { status: "LIMITS_EXCEEDED"; selected: number; shortfalls: Array<{ limit: string; remaining: number }> };

type Titles = (ids: readonly string[]) => Promise<Map<string, string | null>>;

const productionTitles: Titles = async (ids) => {
  const rows = await getDatabaseClient().opportunity.findMany({ where: { id: { in: [...ids] } }, select: { id: true, title: true } });
  return new Map(rows.map((row) => [row.id, row.title]));
};

export function createBulkEvaluationHandlers(dependencies: {
  service: Pick<EvaluationService, "requestEvaluationBatch">;
  titles?: Titles;
}) {
  const titles = dependencies.titles ?? productionTitles;

  async function readSelection(request: Request) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { error: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }) };
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        error: Response.json(
          { error: `Select between 1 and ${bulkEvaluationLimit} opportunities`, code: "REQUEST_INVALID" },
          { status: 400 },
        ),
      };
    }
    const ids = parsed.data.opportunityIds;
    if (new Set(ids).size !== ids.length) {
      return { error: Response.json({ error: "Each opportunity may be selected only once", code: "DUPLICATE_OPPORTUNITY_ID" }, { status: 400 }) };
    }
    return { ids };
  }

  async function respond(ids: readonly string[], result: AdmitBatchResult) {
    switch (result.outcome) {
      case "READY":
        return Response.json({ status: "READY", count: result.count, reservation: result.reservation } satisfies BulkEvaluationResponse);
      case "QUEUED":
        return Response.json(
          { status: "QUEUED", queued: result.queued.map(({ opportunityId, evaluationId }) => ({ opportunityId, evaluationId })) } satisfies BulkEvaluationResponse,
          { status: 202 },
        );
      case "INELIGIBLE": {
        const names = await titles(result.items.map((item) => item.opportunityId));
        return Response.json(
          {
            status: "INELIGIBLE",
            items: result.items.map((item) => ({ opportunityId: item.opportunityId, title: names.get(item.opportunityId) ?? null, reason: item.reason })),
          } satisfies BulkEvaluationResponse,
        );
      }
      case "LIMITS_EXCEEDED":
        return Response.json(
          { status: "LIMITS_EXCEEDED", selected: ids.length, shortfalls: result.shortfalls } satisfies BulkEvaluationResponse,
        );
    }
  }

  async function run(request: Request, mode: "PREFLIGHT" | "SUBMIT") {
    const selection = await readSelection(request);
    if ("error" in selection) return selection.error;
    try {
      return await respond(selection.ids, await dependencies.service.requestEvaluationBatch(selection.ids, { mode }));
    } catch (error) {
      return safeError(error);
    }
  }

  return {
    preflight: (request: Request) => run(request, "PREFLIGHT"),
    submit: (request: Request) => run(request, "SUBMIT"),
  };
}

export function getBulkEvaluationHandlers() {
  return createBulkEvaluationHandlers({ service: getEvaluationService() });
}
