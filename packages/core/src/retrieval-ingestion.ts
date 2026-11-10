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
// again with the same content; last-seen times move, and for a browser
// extension re-read of the listing that created the opportunity, saved facts
// the current normalization reads differently from the same evidence are
// corrected (D1; normalizationCorrected). CHANGED: the same
// source listing with different material content; a new linked observation
// is stored, and if it is the listing that created the opportunity, its
// current facts are re-projected from the new version (history is kept and
// nothing is evaluated).
export type RetrievedListingOutcome = "CREATED" | "ATTACHED" | "UNCHANGED" | "CHANGED";

export interface RetrievedListingResult {
  outcome: RetrievedListingOutcome;
  opportunityId: string;
  sourceRecordId: string;
  // The duplicate decision for CREATED/ATTACHED; null for re-observations.
  decision: DuplicateDecisionValue | null;
  // UNCHANGED only (D1, approved November 8, 2026): the saved facts the
  // current normalization of the same, unchanged source version corrected
  // (field provenance names), when any. The posting did not change and no
  // new source version was stored; empty or absent when nothing needed
  // correcting.
  normalizationCorrected?: string[];
}

// The three events a re-read of a saved listing can be (D1): the same
// posting observed again with nothing to correct; the same posting, whose
// saved facts the current normalization corrected (no new source version);
// a changed posting (a new source version).
export type ReobservationEvent = "UNCHANGED_OBSERVATION" | "NORMALIZATION_CORRECTION" | "SOURCE_CONTENT_CHANGE";
export function reobservationEvent(result: Pick<RetrievedListingResult, "outcome" | "normalizationCorrected">): ReobservationEvent | null {
  if (result.outcome === "CHANGED") return "SOURCE_CONTENT_CHANGE";
  if (result.outcome !== "UNCHANGED") return null;
  return result.normalizationCorrected?.length ? "NORMALIZATION_CORRECTION" : "UNCHANGED_OBSERVATION";
}

// The facts a normalization correction changed, as the product names them
// (field provenance names to labels; one label per fact group, in order).
const correctedFactLabelOf: Record<string, string> = {
  salaryMin: "Salary", salaryMax: "Salary", currency: "Salary", compensationBasis: "Salary", compensationTiers: "Salary", salaryText: "Salary", bonus: "Bonus",
  remoteStatus: "Work arrangement", workArrangements: "Work arrangement",
  residencyRequirement: "Residency", residencyRegions: "Residency", residencyExclusions: "Residency",
  workAuthorizationRequirement: "Work authorization", workAuthorizationRegions: "Work authorization",
  visaSponsorship: "Sponsorship", relocationSupport: "Relocation", employerOfRecordRegions: "Employer of record",
  title: "Title", "company.name": "Company", location: "Location", employmentType: "Employment type", seniority: "Seniority", seniorityLabel: "Seniority",
  department: "Department", timeZoneRequirements: "Time zone", postingDate: "Posting date", closingDate: "Closing date", jobDescription: "Description",
  applicationUrl: "Application link",
};
// The normalization corrections recorded on a source version (D1), oldest
// first; anything not in their shape is ignored.
export interface NormalizationCorrection {
  at: Date;
  fields: string[];
}
export function normalizationCorrectionsOf(sourceMetadata: unknown): NormalizationCorrection[] {
  const list = sourceMetadata && typeof sourceMetadata === "object" ? (sourceMetadata as Record<string, unknown>).normalizationCorrections : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { at, fields } = entry as Record<string, unknown>;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || !Array.isArray(fields)) return [];
    return [{ at: new Date(at), fields: fields.filter((field): field is string => typeof field === "string") }];
  });
}

export function correctedFactLabels(fields: readonly string[] | null | undefined): string[] {
  return [...new Set((fields ?? []).map((field) => correctedFactLabelOf[field] ?? field))];
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
