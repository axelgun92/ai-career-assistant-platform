import type { RetrievalRunCounts, RetrievedListingOutcome } from "@ai-career/core";
import { EvaluationApiError } from "./evaluation-errors";
import type { TriageAssessment } from "./evaluation-service";

// Automatic pre-evaluator triage after ingestion (November 23, 2026): the
// one rule every automatic acquisition path applies once a listing has been
// stored and deduplicated. It runs the existing deterministic triage
// (EvaluationService.assessTriage: the active User Profile, the same gate an
// evaluation request runs) and nothing else: no admission, no budget
// reservation, no queueing and no provider call. An EVALUATE outcome only
// makes the job eligible for a later evaluation.
//
// Which ingestion outcomes are triaged:
// - CREATED: a new opportunity (also when a possible duplicate was only
//   suggested; it is its own opportunity until the user links it).
// - CHANGED: a changed listing of an opportunity that has no triage yet. An
//   opportunity already assessed keeps its assessment (the evaluation request
//   re-runs triage on the current facts before any paid evaluation).
// - ATTACHED (an exact duplicate attached to an existing opportunity) and
//   UNCHANGED (a re-observation): never.
// A manual triage decision is never touched: the assessment upsert keeps it.

export type AutomaticTriageResult =
  | { status: "ASSESSED"; outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT" }
  | { status: "SKIPPED"; reason: "ATTACHED" | "UNCHANGED" | "ALREADY_ASSESSED" }
  | { status: "NO_PROFILE" }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "FAILED" };

export interface AutomaticTriageDependencies {
  assess(opportunityId: string): Promise<TriageAssessment>;
  // The opportunity's current triage record, if any.
  existing(opportunityId: string): Promise<unknown | null>;
  log?: { warn(message: string): void };
}

export function createAutomaticTriage(dependencies: AutomaticTriageDependencies) {
  // Never throws: a triage problem leaves the stored opportunity as it is and
  // never stops the acquisition work around it.
  return async function triageAfterIngestion(ingested: {
    outcome: RetrievedListingOutcome;
    opportunityId: string;
  }): Promise<AutomaticTriageResult> {
    if (ingested.outcome === "ATTACHED" || ingested.outcome === "UNCHANGED") {
      return { status: "SKIPPED", reason: ingested.outcome };
    }
    try {
      if (await dependencies.existing(ingested.opportunityId)) return { status: "SKIPPED", reason: "ALREADY_ASSESSED" };
      const assessment = await dependencies.assess(ingested.opportunityId);
      if (assessment.status === "ASSESSED") return { status: "ASSESSED", outcome: assessment.triage.outcome };
      return assessment;
    } catch (error) {
      // An opportunity that can no longer be evaluated (restored first, for
      // example) has a safe code; anything else is a failure of this step.
      if (error instanceof EvaluationApiError) return { status: "UNAVAILABLE", reason: error.code };
      dependencies.log?.warn(
        `automatic triage of opportunity ${ingested.opportunityId} failed (${error instanceof Error ? error.name : "UnknownError"})`,
      );
      return { status: "FAILED" };
    }
  };
}

export type AutomaticTriage = ReturnType<typeof createAutomaticTriage>;

// Adds one result to a run's counts. The tally is present only once a
// listing was triaged or could not be; skipped listings are not counted.
export function countAutomaticTriage(counts: RetrievalRunCounts, result: AutomaticTriageResult): void {
  if (result.status === "SKIPPED") return;
  const key = result.status === "ASSESSED" ? result.outcome :
    result.status === "NO_PROFILE" ? "noProfile" :
    result.status === "UNAVAILABLE" ? "unavailable" : "failed";
  const tally = (counts.triage ??= {});
  tally[key] = (tally[key] ?? 0) + 1;
}
