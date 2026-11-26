import {
  getDatabaseClient,
  PrismaTriageRoutingRepository,
  type AutomaticDismissalReason,
  type AutomaticDismissalResult,
} from "@ai-career/database";
import type { TitlePolicy } from "@ai-career/core";

// Triage-to-lifecycle routing (November 25, 2026): where a job lands once
// automatic acquisition has stored, deduplicated and triaged it. The same
// rule for every automatic path (configured and ATS sources, the LinkedIn
// adapter, LinkedIn and Welcome to the Jungle Mode B):
//
//   EVALUATE       -> stays Active, ready for evaluation
//   NEEDS_REVIEW   -> stays Active, needing review
//   REJECT         -> Dismissed (reason TRIAGE_REJECT)
//   title outside the target job titles (or no readable title)
//                  -> Dismissed (reason OUTSIDE_TARGET_TITLES)
//
// A REJECT is recorded as the reason when both apply. Dismissing is the
// existing reversible DISMISS: Restore or Move to brings the job back, and a
// job the user has restored or moved is never moved again. The guarded
// writer (PrismaTriageRoutingRepository) also leaves alone any job with
// application history, a manual triage decision or evaluation work in
// flight. Deliberate captures (Single Capture, the manual form, an overridden
// Mode B card) are never routed: the user chose to save them.

export function automaticDismissalReason(input: {
  triageOutcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT" | string | null;
  titleAccepted: boolean;
}): AutomaticDismissalReason | null {
  if (input.triageOutcome === "REJECT") return "TRIAGE_REJECT";
  if (!input.titleAccepted) return "OUTSIDE_TARGET_TITLES";
  return null;
}

export type TriageRoutingResult =
  | { status: "ACTIVE"; triageOutcome: string | null }
  | AutomaticDismissalResult
  | { status: "FAILED" };

export interface TriageRoutingDependencies {
  // The effective triage outcome (a manual decision wins), or null.
  triageOutcome(opportunityId: string): Promise<string | null>;
  title(opportunityId: string): Promise<string | null>;
  titlePolicy: () => Promise<TitlePolicy>;
  dismiss(input: { opportunityId: string; reason: AutomaticDismissalReason }): Promise<AutomaticDismissalResult>;
  log?: { warn(message: string): void };
}

export function createTriageRouting(dependencies: TriageRoutingDependencies) {
  // Never throws: a routing problem leaves the job Active, where the user
  // still sees it.
  return async function routeAfterTriage(opportunityId: string): Promise<TriageRoutingResult> {
    try {
      const [triageOutcome, title, policy] = await Promise.all([
        dependencies.triageOutcome(opportunityId),
        dependencies.title(opportunityId),
        dependencies.titlePolicy(),
      ]);
      const reason = automaticDismissalReason({ triageOutcome, titleAccepted: policy(title).verdict === "ACCEPTED" });
      if (!reason) return { status: "ACTIVE", triageOutcome };
      return await dependencies.dismiss({ opportunityId, reason });
    } catch (error) {
      dependencies.log?.warn(
        `triage routing of opportunity ${opportunityId} failed (${error instanceof Error ? error.name : "UnknownError"}); it stays Active`,
      );
      return { status: "FAILED" };
    }
  };
}

export type TriageRouting = ReturnType<typeof createTriageRouting>;

// The production wiring: the stored triage (a manual decision wins), the
// stored title and the guarded writer.
export function createProductionTriageRouting(titlePolicy: () => Promise<TitlePolicy>, log?: { warn(message: string): void }): TriageRouting {
  const database = getDatabaseClient();
  const repository = new PrismaTriageRoutingRepository(database);
  return createTriageRouting({
    triageOutcome: async (opportunityId) => {
      const triage = await database.preEvaluatorTriage.findUnique({ where: { opportunityId }, select: { outcome: true, manualDecision: true } });
      return triage ? (triage.manualDecision ?? triage.outcome) : null;
    },
    title: async (opportunityId) => (await database.opportunity.findUnique({ where: { id: opportunityId }, select: { title: true } }))?.title ?? null,
    titlePolicy,
    dismiss: (input) => repository.dismissAutomatically(input),
    ...(log ? { log } : {}),
  });
}
