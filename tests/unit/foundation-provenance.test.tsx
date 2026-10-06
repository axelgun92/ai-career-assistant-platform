import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createManualOpportunityService,
  manualOpportunitySubmissionSchema,
  type ManualOpportunityDetail,
  type ManualOpportunityRepository,
  type RawOpportunity,
} from "@ai-career/core";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import {
  OpportunityProvenance,
  reportedSource,
  sourceTypeLabel,
} from "../../apps/web/src/components/opportunity-provenance";

const discoveredAt = new Date("2026-10-06T12:00:00.000Z");

describe("manual capture provenance fields", () => {
  it("accepts an optional source job ID and found-on note, and rejects blank or unknown fields", () => {
    expect(
      manualOpportunitySubmissionSchema.parse({ rawText: "JD", sourceJobId: "REQ-42", foundOn: "LinkedIn" }),
    ).toMatchObject({ sourceJobId: "REQ-42", foundOn: "LinkedIn" });
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "JD", sourceJobId: "   " }).success).toBe(false);
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "JD", foundOn: "" }).success).toBe(false);
    expect(manualOpportunitySubmissionSchema.safeParse({ rawText: "JD", source: "linkedin" }).success).toBe(false);
  });

  it("keeps manual source identity even when the user says it was found on LinkedIn", async () => {
    let captured: RawOpportunity | null = null;
    let normalized: Parameters<ManualOpportunityRepository["createDiscoveredOpportunity"]>[0] | null = null;
    const repository: ManualOpportunityRepository = {
      async createManualSourceRecord(raw) {
        captured = raw;
        return { id: "2bd4d9a6-a2d7-4dd5-875e-a4c6181748b1", discoveredAt: raw.discoveredAt };
      },
      async createDiscoveredOpportunity(input) {
        normalized = input;
        return { id: "2e041b87-368c-4763-b7b4-7685c3eb0946" };
      },
      async transitionOpportunityStatus() {},
      async findOpportunityDetail() {
        return { opportunity: {}, sourceRecords: [], fieldProvenance: [] } as unknown as ManualOpportunityDetail;
      },
    };
    await createManualOpportunityService({
      repository,
      normalizer: createManualOpportunityNormalizer(),
      clock: () => discoveredAt,
    }).submit({
      rawText: "Customer Success Manager",
      sourceUrl: "https://www.linkedin.com/jobs/view/1",
      applicationUrl: "https://jobs.example.com/apply/1",
      sourceJobId: " REQ-42 ",
      foundOn: " LinkedIn ",
    });

    expect(captured).toMatchObject({
      source: "manual-input",
      sourceType: "MANUAL",
      externalId: "REQ-42",
      sourceUrl: "https://www.linkedin.com/jobs/view/1",
      applicationUrl: "https://jobs.example.com/apply/1",
      sourceMetadata: { reportedSource: "LinkedIn" },
    });
    expect(normalized!.opportunity).toMatchObject({
      source: "manual-input",
      sourceType: "MANUAL",
      originalSource: "manual-input",
      externalListingId: "REQ-42",
      applicationUrl: "https://jobs.example.com/apply/1",
      firstSeenAt: discoveredAt,
      lastSeenAt: discoveredAt,
    });
    expect(normalized!.provenance).toContainEqual(
      expect.objectContaining({ fieldName: "externalListingId", sourceField: "sourceJobId", sourceText: "REQ-42" }),
    );
  });
});

function sourceRecord(overrides: Partial<ManualOpportunityDetail["sourceRecords"][number]> = {}) {
  return {
    id: "2bd4d9a6-a2d7-4dd5-875e-a4c6181748b1",
    source: "manual-input",
    sourceType: "MANUAL",
    sourceUrl: "https://www.linkedin.com/jobs/view/1",
    applicationUrl: "https://jobs.example.com/apply/1",
    externalId: "REQ-42",
    requisitionId: null,
    rawTitle: null,
    rawCompany: null,
    rawLocation: null,
    rawDescription: "JD",
    rawSalaryText: null,
    rawEmploymentType: null,
    rawPostingDate: null,
    sourceMetadata: { reportedSource: "LinkedIn" },
    rawPayload: null,
    discoveredAt,
    lastObservedAt: discoveredAt,
    normalizedAt: discoveredAt,
    createdAt: discoveredAt,
    updatedAt: discoveredAt,
    ...overrides,
  } satisfies ManualOpportunityDetail["sourceRecords"][number];
}

const opportunity = {
  source: "manual-input",
  sourceType: "MANUAL" as const,
  firstSeenAt: discoveredAt,
  lastSeenAt: discoveredAt,
  sourceUpdatedAt: null,
};

describe("provenance presentation", () => {
  it("labels manual entries and keeps the reported source informational", () => {
    const html = renderToStaticMarkup(
      <OpportunityProvenance opportunity={opportunity} sourceRecords={[sourceRecord()]} />,
    );
    expect(html).toContain("Source and provenance");
    expect(html).toMatch(/Entry method<\/dt><dd>Manual entry/);
    expect(html).toContain("Reported by you: found on LinkedIn");
    expect(html).toContain('href="https://jobs.example.com/apply/1"');
    expect(html).toContain('href="https://www.linkedin.com/jobs/view/1"');
    expect(html).toMatch(/Source job ID<\/dt><dd>REQ-42/);
    expect(html).toMatch(/Requisition ID<\/dt><dd>Unknown/);
    expect(html).toMatch(/Source last updated<\/dt><dd>Unknown/);
    expect(html).toContain("2026-10-06 12:00 UTC");
  });

  it("lists every source record and never links unsafe URLs", () => {
    const html = renderToStaticMarkup(
      <OpportunityProvenance
        opportunity={opportunity}
        sourceRecords={[
          sourceRecord(),
          sourceRecord({
            id: "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22",
            source: "greenhouse",
            sourceType: "ATS",
            sourceUrl: "javascript:alert(1)",
            applicationUrl: null,
            sourceMetadata: null,
          }),
        ]}
      />,
    );
    expect(html).toContain("Source records (2)");
    expect(html).toContain("Applicant tracking system");
    expect(html).not.toContain('href="javascript:');
    expect(html.match(/Reported by you/g)).toHaveLength(1);
  });

  it("reads the reported source only from a well-formed metadata object", () => {
    expect(reportedSource({ reportedSource: " Indeed " })).toBe("Indeed");
    for (const value of [null, undefined, "LinkedIn", [], { reportedSource: "" }, { reportedSource: 7 }, {}]) {
      expect(reportedSource(value)).toBeNull();
    }
    expect(sourceTypeLabel("MANUAL")).toBe("Manual entry");
    expect(sourceTypeLabel(null)).toBe("Unknown");
  });
});
