import type { NormalizedOpportunity } from "@ai-career/core";

export type DuplicateDecision = "MATCH" | "PROBABLE_MATCH" | "NO_MATCH";

export interface DuplicateResult {
  decision: DuplicateDecision;
  confidence: number | null;
  relatedOpportunityId: string | null;
}

export interface OpportunityDuplicateDetector {
  evaluate(opportunity: NormalizedOpportunity): Promise<DuplicateResult>;
}
