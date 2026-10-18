import { z } from "zod";
import type {
  DeduplicationOutcome,
  DuplicateCheckResult,
  DuplicateResolutionChoice,
} from "./deduplication";
import {
  fieldProvenanceInputSchema,
  type FieldProvenanceInput,
} from "./field-provenance";
import {
  manualOpportunitySubmissionSchema,
  opportunityIdSchema,
} from "./manual-opportunity";
import {
  normalizedOpportunitySchema,
  type NormalizedOpportunity,
} from "./opportunity";
import { rawOpportunitySchema, type RawOpportunity } from "./raw-opportunity";

export interface OpportunityNormalizationResult {
  opportunity: NormalizedOpportunity;
  provenance: FieldProvenanceInput[];
}

export interface OpportunityNormalizer {
  normalize(rawOpportunity: RawOpportunity): Promise<OpportunityNormalizationResult>;
}

export interface PreservedSourceRecord {
  id: string;
  discoveredAt: Date;
}

export interface ManualOpportunityDetail {
  opportunity: NormalizedOpportunity & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  };
  sourceRecords: Array<{
    id: string;
    source: string;
    sourceType: string;
    sourceUrl: string | null;
    applicationUrl: string | null;
    externalId: string | null;
    requisitionId: string | null;
    rawTitle: string | null;
    rawCompany: string | null;
    rawLocation: string | null;
    rawDescription: string | null;
    rawSalaryText: string | null;
    rawEmploymentType: string | null;
    rawPostingDate: string | null;
    sourceMetadata: unknown;
    rawPayload: unknown;
    // Set when this record was attached to the opportunity as an exact
    // duplicate of an earlier capture.
    duplicateDecision?: "MATCH" | "PROBABLE_MATCH" | "NO_MATCH" | null;
    duplicateEvidence?: unknown;
    // Set on records produced by automated retrieval.
    retrievalType?: "OFFICIAL_PUBLIC_API_FEED" | "BROWSER_ASSISTED" | "PUBLIC_GUEST_INTERNAL_ENDPOINT" | "PUBLIC_HTML" | null;
    sourceCategory?: "ATS" | "COMPANY_CAREERS" | "JOB_BOARD" | "MARKETPLACE" | "AGGREGATOR" | null;
    retrievalSourceId?: string | null;
    retrievalSourceName?: string | null;
    retrievalRunId?: string | null;
    // A changed observation of the same source listing points at the
    // earlier record.
    previousSourceRecordId?: string | null;
    discoveredAt: Date;
    lastObservedAt: Date;
    normalizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  fieldProvenance: Array<{
    id: string;
    sourceRecordId: string | null;
    fieldName: string;
    sourceField: string;
    kind: "DIRECT" | "DETERMINISTIC";
    normalizedValue: unknown;
    sourceReference: string | null;
    sourceText: string | null;
    collectedAt: Date | null;
    createdAt: Date;
  }>;
}

export interface ManualOpportunityRepository {
  // Preserves a raw capture whose normalization failed. It stays unlinked
  // (no opportunity) so normalization can be corrected later without
  // recollecting it (Core TDD §11).
  createManualSourceRecord(
    rawOpportunity: RawOpportunity,
  ): Promise<PreservedSourceRecord>;
  // One transaction: the raw SourceRecord is written first, then the
  // duplicate decision and either a new NORMALIZED opportunity (with field
  // provenance and any duplicate references) or, for an exact duplicate,
  // the attachment of that SourceRecord to the existing opportunity. A
  // failure leaves nothing behind.
  ingestManualOpportunity(input: {
    rawOpportunity: RawOpportunity;
    opportunity: NormalizedOpportunity;
    provenance: FieldProvenanceInput[];
    duplicateResolution: DuplicateResolutionChoice | null;
  }): Promise<{ opportunityId: string; deduplication: DeduplicationOutcome }>;
  // Read-only: the decision a capture would get now.
  checkDuplicates(input: {
    rawOpportunity: RawOpportunity;
    opportunity: NormalizedOpportunity;
  }): Promise<DuplicateCheckResult>;
  findOpportunityDetail(id: string): Promise<ManualOpportunityDetail | null>;
}

export type ManualOpportunitySubmitResult = ManualOpportunityDetail & {
  deduplication: DeduplicationOutcome;
};

export interface ManualOpportunityService {
  submit(input: unknown): Promise<ManualOpportunitySubmitResult>;
  checkDuplicates(input: unknown): Promise<DuplicateCheckResult>;
  getById(id: unknown): Promise<ManualOpportunityDetail | null>;
}

export function createManualOpportunityService(input: {
  repository: ManualOpportunityRepository;
  normalizer: OpportunityNormalizer;
  clock?: () => Date;
}): ManualOpportunityService {
  const clock = input.clock ?? (() => new Date());

  function rawOpportunityFor(
    submission: z.infer<typeof manualOpportunitySubmissionSchema>,
    discoveredAt: Date,
  ): RawOpportunity {
    return rawOpportunitySchema.parse({
      source: "manual-input",
      sourceType: "MANUAL",
      sourceUrl: submission.sourceUrl ?? null,
      applicationUrl: submission.applicationUrl ?? null,
      domain: submission.domain ?? null,
      externalId: submission.sourceJobId?.trim() ?? null,
      requisitionId: null,
      title: submission.title ?? null,
      company: submission.company ?? null,
      location: submission.location ?? null,
      description: submission.rawText,
      salaryText: submission.compensationText ?? null,
      employmentType: submission.employmentType ?? null,
      postingDate: submission.postingDate ?? null,
      sourceMetadata: {
        applicationUrl: submission.applicationUrl ?? null,
        domain: submission.domain ?? null,
        // Informational only; never used as the source identity.
        reportedSource: submission.foundOn?.trim() ?? null,
        // Details the user stated explicitly (see manualStatedDetailsSchema).
        details: {
          workArrangement: submission.workArrangement ?? null,
          seniority: submission.seniority ?? null,
          department: submission.department ?? null,
          closingDate: submission.closingDate ?? null,
          timeZoneRequirements: submission.timeZoneRequirements ?? null,
          compensationCurrency: submission.compensationCurrency ?? null,
          residencyRequirement: submission.residencyRequirement ?? null,
          residencyRegions: submission.residencyRegions ?? null,
        },
      },
      rawPayload: {
        rawText: submission.rawText,
        title: submission.title ?? null,
        company: submission.company ?? null,
        location: submission.location ?? null,
        compensationText: submission.compensationText ?? null,
        postingDate: submission.postingDate ?? null,
        sourceUrl: submission.sourceUrl ?? null,
        applicationUrl: submission.applicationUrl ?? null,
        domain: submission.domain ?? null,
        sourceJobId: submission.sourceJobId ?? null,
        foundOn: submission.foundOn ?? null,
        workArrangement: submission.workArrangement ?? null,
        seniority: submission.seniority ?? null,
        employmentType: submission.employmentType ?? null,
        department: submission.department ?? null,
        closingDate: submission.closingDate ?? null,
        timeZoneRequirements: submission.timeZoneRequirements ?? null,
        compensationCurrency: submission.compensationCurrency ?? null,
        residencyRequirement: submission.residencyRequirement ?? null,
        residencyRegions: submission.residencyRegions ?? null,
      },
      discoveredAt,
    });
  }

  // Deterministic and side-effect free.
  async function normalize(rawOpportunity: RawOpportunity) {
    const normalization = await input.normalizer.normalize(rawOpportunity);
    const opportunity = normalizedOpportunitySchema.parse(
      normalization.opportunity,
    );
    const provenance = z
      .array(fieldProvenanceInputSchema)
      .parse(normalization.provenance);

    if (opportunity.status !== "DISCOVERED") {
      throw new Error(
        "A newly normalized opportunity must begin in DISCOVERED state",
      );
    }
    return { opportunity, provenance };
  }

  return {
    async submit(unvalidatedInput) {
      const submission = manualOpportunitySubmissionSchema.parse(unvalidatedInput);
      const rawOpportunity = rawOpportunityFor(submission, clock());

      let normalized: Awaited<ReturnType<typeof normalize>>;
      try {
        normalized = await normalize(rawOpportunity);
      } catch (error) {
        // The raw capture is still preserved, unlinked, before the error is
        // reported.
        await input.repository.createManualSourceRecord(rawOpportunity);
        throw error;
      }

      const ingested = await input.repository.ingestManualOpportunity({
        rawOpportunity,
        opportunity: normalized.opportunity,
        provenance: normalized.provenance,
        duplicateResolution: submission.duplicateResolution ?? null,
      });

      const detail = await input.repository.findOpportunityDetail(ingested.opportunityId);
      if (!detail) {
        throw new Error("Persisted opportunity could not be retrieved");
      }

      return { ...detail, deduplication: ingested.deduplication };
    },

    async checkDuplicates(unvalidatedInput) {
      const submission = manualOpportunitySubmissionSchema.parse(unvalidatedInput);
      const rawOpportunity = rawOpportunityFor(submission, clock());
      const { opportunity } = await normalize(rawOpportunity);
      return input.repository.checkDuplicates({ rawOpportunity, opportunity });
    },

    async getById(id) {
      return input.repository.findOpportunityDetail(opportunityIdSchema.parse(id));
    },
  };
}
