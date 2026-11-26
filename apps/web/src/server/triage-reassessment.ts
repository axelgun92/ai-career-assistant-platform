import { getDatabaseClient } from "@ai-career/database";
import { getEvaluationService } from "./evaluation-service";
import type { TriageTrigger } from "./pre-evaluator-triage-service";

// Stale triage reassessment (November 25, 2026). A job's triage is assessed
// again whenever a material input changed since its stored assessment: the
// normalized facts (a changed capture or renormalization, new compensation
// tiers), a fact the user confirmed, the active profile or its version, the
// user's work eligibility, or the triage rules themselves. The stored input
// fingerprint tells; an unchanged job is left as it is. Every assessment is
// kept in the triage history.
//
// Reassessment never moves a job between lifecycle states: a job whose
// result changes moves to the matching working category within Active
// (Evaluate, Needs Review, Rejected), and the user decides what to do with
// it. A manual triage decision is never touched.

export interface ReassessmentSummary {
  checked: number;
  reassessed: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

const activeStatuses = ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"] as const;

export async function reassessStaleTriage(options: {
  trigger?: TriageTrigger;
  limit?: number;
  assess?: (opportunityId: string, trigger?: TriageTrigger) => Promise<{ status: string; unchanged?: boolean }>;
  log?: { warn(message: string): void };
} = {}): Promise<ReassessmentSummary> {
  const rows = await getDatabaseClient().preEvaluatorTriage.findMany({
    where: { domain: "customer-success", opportunity: { status: { in: [...activeStatuses] } } },
    select: { opportunityId: true },
    orderBy: [{ assessedAt: "asc" }, { id: "asc" }],
    take: options.limit ?? 2000,
  });
  const assess = options.assess ?? ((opportunityId: string, trigger?: TriageTrigger) =>
    getEvaluationService().assessTriage(opportunityId, { onlyIfStale: true, ...(trigger ? { trigger } : {}) }));
  const summary: ReassessmentSummary = { checked: rows.length, reassessed: 0, unchanged: 0, skipped: 0, failed: 0 };
  // One job at a time: a problem with one never stops the rest.
  for (const row of rows) {
    try {
      const result = await assess(row.opportunityId, options.trigger);
      if (result.status !== "ASSESSED") summary.skipped += 1;
      else if (result.unchanged) summary.unchanged += 1;
      else summary.reassessed += 1;
    } catch (error) {
      summary.failed += 1;
      options.log?.warn(`triage reassessment of opportunity ${row.opportunityId} failed (${error instanceof Error ? error.name : "UnknownError"})`);
    }
  }
  return summary;
}
