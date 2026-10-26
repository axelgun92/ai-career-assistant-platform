// Every implemented source adapter's fixture listings, ingested on the
// isolated test database (Feature 14B correction, October 25, 2026): what
// the shared normalizer produced is what the opportunity, its source record
// and its field provenance store, including salary in the source's own
// currency, the compensation basis, the application link and its basis,
// identifiers and dates. Nothing reaches the network.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { applicationUrlBasisOf, applicationUrlProvenance, createRetrievalIngestionService } from "@ai-career/core";
import { PrismaManualOpportunityRepository } from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createCleanup, database } from "../support/budget-integration";
import { collectFixture, fixtureAdapterKeys } from "../support/adapter-fixture-harness";

const cleanup = createCleanup();
const normalizer = createRetrievedOpportunityNormalizer();
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer });

beforeEach(() => cleanup.before());
afterEach(async () => {
  const opportunityIds = [...new Set(cleanup.opportunityIds)];
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await cleanup.after();
});
afterAll(() => database.$disconnect());

const amount = (value: { toNumber(): number } | null) => value?.toNumber() ?? null;

describe("every implemented adapter: normalized facts persist as normalized", () => {
  it.each(fixtureAdapterKeys)("%s", async (key) => {
    for (const raw of await collectFixture(key)) {
      const label = `${key}:${raw.externalId}`;
      const { opportunity: expected } = await normalizer.normalize(raw);
      const result = await ingestion.ingest(raw);
      cleanup.opportunityIds.push(result.opportunityId);
      expect(result.outcome, label).toBe("CREATED");

      const stored = await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId }, include: { company: true } });
      expect({
        externalListingId: stored.externalListingId, atsRequisitionId: stored.atsRequisitionId, canonicalUrl: stored.canonicalUrl,
        applicationUrl: stored.applicationUrl, title: stored.title, companyName: stored.company?.name ?? null, location: stored.location,
        remoteStatus: stored.remoteStatus, employmentType: stored.employmentType, department: stored.department, seniority: stored.seniority,
        salaryMin: amount(stored.salaryMin), salaryMax: amount(stored.salaryMax), currency: stored.currency, salaryText: stored.salaryText,
        compensationBasis: stored.compensationBasis, postingDate: stored.postingDate, closingDate: stored.closingDate,
        residencyRequirement: stored.residencyRequirement, residencyRegions: stored.residencyRegions,
        workAuthorizationRequirement: stored.workAuthorizationRequirement, workAuthorizationRegions: stored.workAuthorizationRegions,
      }, label).toEqual({
        externalListingId: expected.externalListingId, atsRequisitionId: expected.atsRequisitionId, canonicalUrl: expected.canonicalUrl,
        applicationUrl: expected.applicationUrl, title: expected.title, companyName: expected.companyName, location: expected.location,
        remoteStatus: expected.remoteStatus, employmentType: expected.employmentType, department: expected.department, seniority: expected.seniority,
        salaryMin: expected.salaryMin, salaryMax: expected.salaryMax, currency: expected.currency, salaryText: expected.salaryText,
        compensationBasis: expected.compensationBasis, postingDate: expected.postingDate, closingDate: expected.closingDate,
        residencyRequirement: expected.residencyRequirement, residencyRegions: expected.residencyRegions,
        workAuthorizationRequirement: expected.workAuthorizationRequirement, workAuthorizationRegions: expected.workAuthorizationRegions,
      });

      const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: result.opportunityId } });
      expect(record.applicationUrl, label).toBe(raw.applicationUrl);
      expect(record.contentHash, label).toBe(raw.retrieval!.contentHash);
      const linkRows = await database.fieldProvenance.findMany({ where: { opportunityId: result.opportunityId, fieldName: "applicationUrl", supersededAt: null } });
      expect(linkRows.map((row) => row.sourceField), label).toEqual(stored.applicationUrl ? [applicationUrlProvenance(applicationUrlBasisOf(raw.sourceMetadata)).sourceField] : []);
      if (stored.currency) {
        const currencyRows = await database.fieldProvenance.findMany({ where: { opportunityId: result.opportunityId, fieldName: "currency", supersededAt: null } });
        expect(currencyRows.map((row) => row.normalizedValue), label).toEqual([stored.currency]);
      }
    }
  });
});
