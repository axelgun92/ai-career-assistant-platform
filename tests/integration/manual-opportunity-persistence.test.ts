import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

const database = getDatabaseClient();
const createdOpportunityIds: string[] = [];

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({
      where: { id },
      select: { companyId: true },
    });

    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } });

    if (opportunity?.companyId) {
      await database.company.deleteMany({
        where: { id: opportunity.companyId },
      });
    }
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe("manual opportunity PostgreSQL persistence", () => {
  it("persists raw, normalized, provenance, null, and lifecycle data", async () => {
    const service = createManualOpportunityService({
      repository: new PrismaManualOpportunityRepository(),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => new Date("2026-08-12T22:00:00.000Z"),
    });
    const rawText = "Exact integration JD\nwith two lines and trailing space. ";

    const detail = await service.submit({
      rawText,
      title: "  Customer Success Manager  ",
      company: "Example Company",
      compensationText: "$65,000 - $75,000",
      postingDate: "2026-08-10",
      sourceUrl: "https://example.com/jobs/123",
      applicationUrl: "https://example.com/jobs/123/apply",
    });
    createdOpportunityIds.push(detail.opportunity.id);

    expect(detail.opportunity.status).toBe("NORMALIZED");
    expect(detail.opportunity.title).toBe("Customer Success Manager");
    expect(detail.opportunity.domain).toBeNull();
    expect(detail.opportunity.remoteStatus).toBeNull();
    expect(detail.opportunity.salaryMin).toBeNull();
    expect(detail.opportunity.salaryText).toBe("$65,000 - $75,000");
    expect(detail.sourceRecords).toHaveLength(1);
    expect(detail.sourceRecords[0]?.rawDescription).toBe(rawText);
    expect(detail.sourceRecords[0]?.sourceType).toBe("MANUAL");
    expect(detail.sourceRecords[0]?.normalizedAt).toBeInstanceOf(Date);
    expect(detail.fieldProvenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRecordId: detail.sourceRecords[0]?.id,
          fieldName: "jobDescription",
          sourceField: "rawText",
          kind: "DIRECT",
          sourceText: rawText,
        }),
        expect.objectContaining({
          fieldName: "title",
          kind: "DETERMINISTIC",
        }),
      ]),
    );
  });
});
