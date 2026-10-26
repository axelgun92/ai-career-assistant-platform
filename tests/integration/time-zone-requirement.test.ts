import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import { getDatabaseClient, PrismaEvaluationRepository, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

// G5 and the job-text fallback: a stated time-zone requirement wins; when
// none is stated, only an explicit requirement in the job text is recorded
// (DETERMINISTIC, with its marker), never one inferred from a place. The
// evaluator's input stays exactly as before (it reads the job text).

const database = getDatabaseClient();
const service = createManualOpportunityService({
  repository: new PrismaManualOpportunityRepository(),
  normalizer: createManualOpportunityNormalizer(),
});
const ids: string[] = [];

afterEach(async () => {
  const opportunities = await database.opportunity.findMany({ where: { id: { in: ids.splice(0) } }, select: { id: true, companyId: true } });
  await database.sourceRecord.deleteMany({ where: { opportunityId: { in: opportunities.map((item) => item.id) } } });
  await database.opportunity.deleteMany({ where: { id: { in: opportunities.map((item) => item.id) } } });
  await database.company.deleteMany({ where: { id: { in: opportunities.flatMap((item) => (item.companyId ? [item.companyId] : [])) } } });
});
afterAll(() => database.$disconnect());

describe("stated time-zone requirements", () => {
  it("stores the stated value with DIRECT provenance and keeps it out of the evaluator subject", async () => {
    const token = randomUUID().slice(0, 8);
    const detail = await service.submit({
      rawText: `Customer Success Manager ${token}. Must work US Eastern hours.`,
      company: `Zoneco ${token}`,
      timeZoneRequirements: "US Eastern business hours",
    });
    ids.push(detail.opportunity.id);
    expect(detail.opportunity.timeZoneRequirements).toBe("US Eastern business hours");
    expect(detail.fieldProvenance).toContainEqual(
      expect.objectContaining({ fieldName: "timeZoneRequirements", sourceField: "timeZoneRequirements", kind: "DIRECT", sourceText: "US Eastern business hours" }),
    );
    expect(detail.sourceRecords[0]!.sourceMetadata).toMatchObject({ details: { timeZoneRequirements: "US Eastern business hours" } });
    expect(detail.sourceRecords[0]!.rawPayload).toMatchObject({ timeZoneRequirements: "US Eastern business hours" });

    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: detail.opportunity.id, userProfileId: null });
    expect(subject!.opportunity.timeZoneRequirements).toBeNull();
    expect(subject!.provenance.map((row) => row.fieldName)).not.toContain("timeZoneRequirements");
  });

  it("falls back to an explicit requirement in the job text, and never infers one from a place", async () => {
    const token = randomUUID().slice(0, 8);
    const detail = await service.submit({ rawText: `Role ${token}. Must overlap with EST and PST hours.`, company: `Zoneco ${token}` });
    ids.push(detail.opportunity.id);
    expect(detail.opportunity.timeZoneRequirements).toBe("Must overlap with EST and PST hours.");
    expect(detail.fieldProvenance).toContainEqual(expect.objectContaining({
      fieldName: "timeZoneRequirements", kind: "DETERMINISTIC", sourceField: "rawText:explicit-time-zone-statement",
      sourceText: "Must overlap with EST and PST hours.",
    }));
    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: detail.opportunity.id, userProfileId: null });
    expect(subject!.opportunity.timeZoneRequirements).toBeNull();

    const placed = await service.submit({ rawText: `Role ${token}-b. This position is based in New York.`, location: "New York, NY", company: `Zoneco ${token}` });
    ids.push(placed.opportunity.id);
    expect(placed.opportunity.timeZoneRequirements).toBeNull();
    expect(placed.fieldProvenance.map((row) => row.fieldName)).not.toContain("timeZoneRequirements");
  });
});
