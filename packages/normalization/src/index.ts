import type { NormalizedOpportunity, RawOpportunity } from "@ai-career/core";

export interface OpportunityNormalizer {
  normalize(rawOpportunity: RawOpportunity): Promise<NormalizedOpportunity>;
}
