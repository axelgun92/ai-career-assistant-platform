import type { RawOpportunity } from "@ai-career/core";

export interface OpportunityCollector {
  collect(): Promise<RawOpportunity[]>;
}
