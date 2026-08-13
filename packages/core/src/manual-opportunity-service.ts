import { z } from "zod";
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
  type OpportunityLifecycleState,
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
  createManualSourceRecord(
    rawOpportunity: RawOpportunity,
  ): Promise<PreservedSourceRecord>;
  createDiscoveredOpportunity(input: {
    sourceRecordId: string;
    opportunity: NormalizedOpportunity;
    provenance: FieldProvenanceInput[];
  }): Promise<{ id: string }>;
  transitionOpportunityStatus(input: {
    opportunityId: string;
    from: OpportunityLifecycleState;
    to: OpportunityLifecycleState;
  }): Promise<void>;
  findOpportunityDetail(id: string): Promise<ManualOpportunityDetail | null>;
}

export interface ManualOpportunityService {
  submit(input: unknown): Promise<ManualOpportunityDetail>;
  getById(id: unknown): Promise<ManualOpportunityDetail | null>;
}

export function createManualOpportunityService(input: {
  repository: ManualOpportunityRepository;
  normalizer: OpportunityNormalizer;
  clock?: () => Date;
}): ManualOpportunityService {
  const clock = input.clock ?? (() => new Date());

  return {
    async submit(unvalidatedInput) {
      const submission = manualOpportunitySubmissionSchema.parse(unvalidatedInput);
      const discoveredAt = clock();
      const rawOpportunity = rawOpportunitySchema.parse({
        source: "manual-input",
        sourceType: "MANUAL",
        sourceUrl: submission.sourceUrl ?? null,
        applicationUrl: submission.applicationUrl ?? null,
        domain: submission.domain ?? null,
        externalId: null,
        requisitionId: null,
        title: submission.title ?? null,
        company: submission.company ?? null,
        location: submission.location ?? null,
        description: submission.rawText,
        salaryText: submission.compensationText ?? null,
        employmentType: null,
        postingDate: submission.postingDate ?? null,
        sourceMetadata: {
          applicationUrl: submission.applicationUrl ?? null,
          domain: submission.domain ?? null,
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
        },
        discoveredAt,
      });

      const sourceRecord = await input.repository.createManualSourceRecord(
        rawOpportunity,
      );
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

      const created = await input.repository.createDiscoveredOpportunity({
        sourceRecordId: sourceRecord.id,
        opportunity,
        provenance,
      });

      await input.repository.transitionOpportunityStatus({
        opportunityId: created.id,
        from: "DISCOVERED",
        to: "NORMALIZED",
      });

      const detail = await input.repository.findOpportunityDetail(created.id);
      if (!detail) {
        throw new Error("Persisted opportunity could not be retrieved");
      }

      return detail;
    },

    async getById(id) {
      return input.repository.findOpportunityDetail(opportunityIdSchema.parse(id));
    },
  };
}
