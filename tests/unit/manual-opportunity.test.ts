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

type IngestInput = Parameters<ManualOpportunityRepository["ingestManualOpportunity"]>[0];

function createRepository(
  calls: string[],
  options: { ingestFails?: boolean; seen?: { ingest?: IngestInput; preserved?: RawOpportunity } } = {},
): ManualOpportunityRepository {
  let rawOpportunity: RawOpportunity | null = null;
  let opportunity: NormalizedOpportunity | null = null;
  let provenance: IngestInput["provenance"] = [];

  return {
    async createManualSourceRecord(raw) {
      calls.push("source-record");
      if (options.seen) options.seen.preserved = raw;
      return { id: sourceRecordId, discoveredAt: raw.discoveredAt };
    },
    async ingestManualOpportunity(input) {
      calls.push("ingest");
      if (options.seen) options.seen.ingest = input;
      // A real ingest is one transaction: a failure leaves nothing behind.
      if (options.ingestFails) throw new Error("ingest transaction failed");
      rawOpportunity = input.rawOpportunity;
      opportunity = { ...input.opportunity, status: "NORMALIZED" };
      provenance = input.provenance;
      return {
        opportunityId,
        deduplication: { outcome: "CREATED", decision: "NO_MATCH", canonicalOpportunityId: null, matches: [] },
      };
    },
    async checkDuplicates() {
      calls.push("check");
      return { decision: "NO_MATCH", canonicalOpportunityId: null, matches: [] };
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
            applicationUrl: rawOpportunity.applicationUrl,
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

  it("writes the raw SourceRecord and the opportunity in one ingest after normalizing", async () => {
    const calls: string[] = [];
    const seen: { ingest?: IngestInput } = {};
    const normalizer = createManualOpportunityNormalizer();
    const service = createManualOpportunityService({
      repository: createRepository(calls, { seen }),
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

    expect(calls).toEqual(["normalize", "ingest", "retrieve"]);
    expect(seen.ingest?.rawOpportunity.description).toBe(rawText);
    expect(seen.ingest?.duplicateResolution).toBeNull();
    expect(detail.sourceRecords[0]?.rawDescription).toBe(rawText);
    expect(detail.opportunity.status).toBe("NORMALIZED");
    expect(detail.deduplication).toEqual({ outcome: "CREATED", decision: "NO_MATCH", canonicalOpportunityId: null, matches: [] });
  });

  it("leaves the raw SourceRecord preserved (unlinked) when normalization fails", async () => {
    const calls: string[] = [];
    const seen: { preserved?: RawOpportunity } = {};
    const service = createManualOpportunityService({
      repository: createRepository(calls, { seen }),
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
    expect(calls).toEqual(["normalize", "source-record"]);
    expect(seen.preserved?.description).toBe("Preserve me");
  });

  it("writes nothing outside the ingest transaction when it fails", async () => {
    const calls: string[] = [];
    const service = createManualOpportunityService({
      repository: createRepository(calls, { ingestFails: true }),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => timestamp,
    });

    await expect(service.submit({ rawText: "Job" })).rejects.toThrow("ingest transaction failed");
    expect(calls).toEqual(["ingest"]);
  });

  it("passes the duplicate choice through without storing it as a listing fact", async () => {
    const seen: { ingest?: IngestInput } = {};
    const service = createManualOpportunityService({
      repository: createRepository([], { seen }),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => timestamp,
    });

    await service.submit({ rawText: "Job", duplicateResolution: "SEPARATE" });
    expect(seen.ingest?.duplicateResolution).toBe("SEPARATE");
    expect(JSON.stringify(seen.ingest?.rawOpportunity)).not.toContain("SEPARATE");
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "x", duplicateResolution: "MERGE" }).success).toBe(false);
  });

  it("checks duplicates without writing anything", async () => {
    const calls: string[] = [];
    const service = createManualOpportunityService({
      repository: createRepository(calls),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => timestamp,
    });

    await expect(service.checkDuplicates({ rawText: "Job" })).resolves.toMatchObject({ decision: "NO_MATCH" });
    expect(calls).toEqual(["check"]);
  });
});
