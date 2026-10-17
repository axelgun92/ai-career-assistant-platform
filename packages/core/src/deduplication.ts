import { z } from "zod";

// Domain-neutral deduplication results at the ingestion boundary. The
// decision engine lives in @ai-career/deduplication; persistence applies it
// inside the capture transaction.

export const duplicateResolutionChoiceSchema = z.enum(["ATTACH", "SEPARATE"]);
// What to do with an exact duplicate found at capture: ATTACH (the default)
// adds the new source record to the existing opportunity; SEPARATE keeps it
// as its own opportunity because the user says it is a different job.
export type DuplicateResolutionChoice = z.infer<typeof duplicateResolutionChoiceSchema>;

export type DuplicateDecisionValue = "MATCH" | "PROBABLE_MATCH" | "NO_MATCH";

export interface DuplicateMatchSummary {
  opportunityId: string;
  decision: Exclude<DuplicateDecisionValue, "NO_MATCH">;
  confidence: number;
  matchedOn: string[];
  conflicts: string[];
  title: string | null;
  companyName: string | null;
}

export interface DeduplicationOutcome {
  // CREATED: a new opportunity; ATTACHED: the source record was added to an
  // existing opportunity (exact duplicate), so no new opportunity exists.
  outcome: "CREATED" | "ATTACHED";
  decision: DuplicateDecisionValue;
  canonicalOpportunityId: string | null;
  matches: DuplicateMatchSummary[];
}

// The read-only pre-capture check (nothing is written).
export interface DuplicateCheckResult {
  decision: DuplicateDecisionValue;
  canonicalOpportunityId: string | null;
  matches: DuplicateMatchSummary[];
}
