import { describe, expect, it } from "vitest";
import {
  createManualOpportunityService,
  manualOpportunitySubmissionSchema,
  rawOpportunitySchema,
  type ManualOpportunityDetail,
  type ManualOpportunityRepository,
  type NormalizedOpportunity,
  type RawOpportunity,
} from "@ai-career/core";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

const timestamp = new Date("2026-08-12T20:00:00.000Z");
const opportunityId = "2e041b87-368c-4763-b7b4-7685c3eb0946";
const sourceRecordId = "2bd4d9a6-a2d7-4dd5-875e-a4c6181748b1";

function createRepository(calls: string[]): ManualOpportunityRepository {
  let rawOpportunity: RawOpportunity | null = null;
  let opportunity: NormalizedOpportunity | null = null;
  let provenance: Parameters<
    ManualOpportunityRepository["createDiscoveredOpportunity"]
  >[0]["provenance"] = [];

  return {
    async createManualSourceRecord(raw) {
      calls.push("source-record");
      rawOpportunity = raw;
      return { id: sourceRecordId, discoveredAt: raw.discoveredAt };
    },
    async createDiscoveredOpportunity(input) {
      calls.push("opportunity");
      opportunity = input.opportunity;
      provenance = input.provenance;
      return { id: opportunityId };
    },
    async transitionOpportunityStatus() {
      calls.push("transition");
      if (opportunity) {
        opportunity = { ...opportunity, status: "NORMALIZED" };
      }
    },
    async findOpportunityDetail() {
      calls.push("retrieve");
      if (!rawOpportunity || !opportunity) {
        return null;
      }

      return {
        opportunity: {
          ...opportunity,
          id: opportunityId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        sourceRecords: [
          {
            id: sourceRecordId,
            source: rawOpportunity.source,
            sourceType: rawOpportunity.sourceType,
            sourceUrl: rawOpportunity.sourceUrl,
            externalId: rawOpportunity.externalId,
            requisitionId: rawOpportunity.requisitionId,
            rawTitle: rawOpportunity.title,
            rawCompany: rawOpportunity.company,
            rawLocation: rawOpportunity.location,
            rawDescription: rawOpportunity.description,
            rawSalaryText: rawOpportunity.salaryText,
            rawEmploymentType: rawOpportunity.employmentType,
            rawPostingDate: rawOpportunity.postingDate,
            sourceMetadata: rawOpportunity.sourceMetadata,
            rawPayload: rawOpportunity.rawPayload,
            discoveredAt: rawOpportunity.discoveredAt,
            lastObservedAt: rawOpportunity.discoveredAt,
            normalizedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        fieldProvenance: provenance.map((item, index) => ({
          id: `provenance-${index}`,
          sourceRecordId,
          ...item,
          createdAt: timestamp,
        })),
      } satisfies ManualOpportunityDetail;
    },
  };
}

describe("manual opportunity ingestion", () => {
  it("rejects missing raw text and unsupported date formats", () => {
    expect(() =>
      manualOpportunitySubmissionSchema.parse({ rawText: "   " }),
    ).toThrow();
    expect(() =>
      manualOpportunitySubmissionSchema.parse({
        rawText: "A real opportunity",
        postingDate: "08/12/2026",
      }),
    ).toThrow();
    expect(() =>
      manualOpportunitySubmissionSchema.parse({
        rawText: "A real opportunity",
        postingDate: "2026-02-30",
      }),
    ).toThrow();
  });

  it("normalizes only explicit facts and creates field provenance", async () => {
    const rawText = "  Keep this raw text exactly.\nSecond line.  ";
    const raw = rawOpportunitySchema.parse({
      source: "manual-input",
      sourceType: "MANUAL",
      sourceUrl: "https://example.com/source",
      applicationUrl: "https://example.com/apply",
      domain: null,
      externalId: null,
      requisitionId: null,
      title: "  Customer Success Manager  ",
      company: null,
      location: null,
      description: rawText,
      salaryText: null,
      employmentType: null,
      postingDate: "2026-08-12",
      sourceMetadata: null,
      rawPayload: null,
      discoveredAt: timestamp,
    });

    const result = await createManualOpportunityNormalizer().normalize(raw);

    expect(result.opportunity.title).toBe("Customer Success Manager");
    expect(result.opportunity.jobDescription).toBe(rawText);
    expect(result.opportunity.companyName).toBeNull();
    expect(result.opportunity.remoteStatus).toBeNull();
    expect(result.opportunity.status).toBe("DISCOVERED");
    expect(result.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "jobDescription",
          sourceField: "rawText",
          kind: "DIRECT",
          sourceText: rawText,
        }),
        expect.objectContaining({
          fieldName: "title",
          kind: "DETERMINISTIC",
        }),
        expect.objectContaining({
          fieldName: "postingDate",
          kind: "DETERMINISTIC",
        }),
      ]),
    );
  });

  it("preserves SourceRecord before normalization and reaches NORMALIZED", async () => {
    const calls: string[] = [];
    const normalizer = createManualOpportunityNormalizer();
    const service = createManualOpportunityService({
      repository: createRepository(calls),
      normalizer: {
        async normalize(raw) {
          calls.push("normalize");
          return normalizer.normalize(raw);
        },
      },
      clock: () => timestamp,
    });

    const rawText = "Exact raw JD\nwith formatting.";
    const detail = await service.submit({
      rawText,
      title: "CSM",
      domain: "customer-success",
    });

    expect(calls).toEqual([
      "source-record",
      "normalize",
      "opportunity",
      "transition",
      "retrieve",
    ]);
    expect(detail.sourceRecords[0]?.rawDescription).toBe(rawText);
    expect(detail.opportunity.status).toBe("NORMALIZED");
  });

  it("leaves SourceRecord preserved when normalization fails", async () => {
    const calls: string[] = [];
    const service = createManualOpportunityService({
      repository: createRepository(calls),
      normalizer: {
        async normalize() {
          calls.push("normalize");
          throw new Error("normalization failed");
        },
      },
      clock: () => timestamp,
    });

    await expect(service.submit({ rawText: "Preserve me" })).rejects.toThrow(
      "normalization failed",
    );
    expect(calls).toEqual(["source-record", "normalize"]);
  });
});
