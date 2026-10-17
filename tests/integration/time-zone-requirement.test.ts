import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import { getDatabaseClient, PrismaEvaluationRepository, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

// G5: the time-zone requirement is recorded only as the user states it, and
// the evaluator's input stays exactly as before (it reads the job text).

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

  it("never reads it from the job text", async () => {
    const token = randomUUID().slice(0, 8);
    const detail = await service.submit({ rawText: `Role ${token}. Must overlap with EST and PST hours.`, company: `Zoneco ${token}` });
    ids.push(detail.opportunity.id);
    expect(detail.opportunity.timeZoneRequirements).toBeNull();
    expect(detail.fieldProvenance.map((row) => row.fieldName)).not.toContain("timeZoneRequirements");
  });
});
