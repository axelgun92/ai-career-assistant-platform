import { z } from "zod";
import type { DuplicateDecisionValue } from "./deduplication";
import { fieldProvenanceInputSchema, type FieldProvenanceInput } from "./field-provenance";
import type { OpportunityNormalizer, PreservedSourceRecord } from "./manual-opportunity-service";
import { normalizedOpportunitySchema, type NormalizedOpportunity } from "./opportunity";
import { rawOpportunitySchema, type RawOpportunity } from "./raw-opportunity";

// Ingestion of one retrieved listing (Core TDD §8, §11, §15). The listing
// is normalized in memory first; persistence then decides, in one capture
// transaction, whether it is a re-observation of a listing already stored
// from the same source (unchanged or changed) or a new capture that goes
// through the deduplication path. Retrieval never evaluates anything.

// CREATED: a new opportunity. ATTACHED: added to an existing opportunity as
// another source (exact duplicate). UNCHANGED: the same source listing seen
// again with the same content; only last-seen times move. CHANGED: the same
// source listing with different material content; a new linked observation
// is stored and the opportunity itself is not changed.
export type RetrievedListingOutcome = "CREATED" | "ATTACHED" | "UNCHANGED" | "CHANGED";

export interface RetrievedListingResult {
  outcome: RetrievedListingOutcome;
  opportunityId: string;
  sourceRecordId: string;
  // The duplicate decision for CREATED/ATTACHED; null for re-observations.
  decision: DuplicateDecisionValue | null;
}

export interface RetrievalIngestionRepository {
  ingestRetrievedListing(input: {
    rawOpportunity: RawOpportunity;
    opportunity: NormalizedOpportunity;
    provenance: FieldProvenanceInput[];
  }): Promise<RetrievedListingResult>;
  // Keeps a retrieved listing whose normalization failed, unlinked, so it
  // can be normalized later without being fetched again. Seeing the same
  // unnormalized content again only moves its last-observed time.
  preserveUnnormalizedListing(rawOpportunity: RawOpportunity): Promise<PreservedSourceRecord>;
}

export class RetrievedListingNormalizationError extends Error {
  constructor(readonly preservedSourceRecordId: string, cause: unknown) {
    super("Retrieved listing could not be normalized; its raw record was preserved", { cause });
    this.name = "RetrievedListingNormalizationError";
  }
}

export interface RetrievalIngestionService {
  ingest(rawOpportunity: RawOpportunity): Promise<RetrievedListingResult>;
}

export function createRetrievalIngestionService(input: {
  repository: RetrievalIngestionRepository;
  normalizer: OpportunityNormalizer;
}): RetrievalIngestionService {
  return {
    async ingest(unvalidated) {
      const rawOpportunity = rawOpportunitySchema.parse(unvalidated);
      if (!rawOpportunity.retrieval) {
        throw new Error("A retrieved listing must carry retrieval provenance");
      }
      let opportunity: NormalizedOpportunity;
      let provenance: FieldProvenanceInput[];
      try {
        const normalized = await input.normalizer.normalize(rawOpportunity);
        opportunity = normalizedOpportunitySchema.parse(normalized.opportunity);
        provenance = z.array(fieldProvenanceInputSchema).parse(normalized.provenance);
        if (opportunity.status !== "DISCOVERED") {
          throw new Error("A newly normalized opportunity must begin in DISCOVERED state");
        }
      } catch (error) {
        const preserved = await input.repository.preserveUnnormalizedListing(rawOpportunity);
        throw new RetrievedListingNormalizationError(preserved.id, error);
      }
      return input.repository.ingestRetrievedListing({ rawOpportunity, opportunity, provenance });
    },
  };
}
