import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService, type OpportunityUserAction } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityLifecycleRepository,
} from "@ai-career/database";
import { createEvaluationWorker } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { readSemanticEnvironment } from "@ai-career/shared";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { semanticExecutorConfigFromEnvironment } from "../../apps/web/src/server/semantic-execution-config";
import {
  createCustomerSuccessFixtureTransport,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";
import { e2eEnvironment } from "../support/e2e-environment";

const database = getDatabaseClient();
const lifecycle = new PrismaOpportunityLifecycleRepository();
const tasks = new PrismaEvaluationTaskRepository();
const createdOpportunityIds: string[] = [];
const createdProfileIds: string[] = [];
const createdSourceRecordIds: string[] = [];
const semanticConfig = {
  ...semanticExecutorConfigFromEnvironment(readSemanticEnvironment({ ...process.env, ...e2eEnvironment() })),
  apiKey: "deterministic-integration-key",
};
const service = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks,
  semanticConfig,
  jobMaxAttempts: 1,
});

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({ where: { id }, select: { companyId: true } });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } });
    if (opportunity?.companyId) await database.company.deleteMany({ where: { id: opportunity.companyId } });
  }
  await database.sourceRecord.deleteMany({ where: { id: { in: createdSourceRecordIds.splice(0) } } });
  await database.userProfile.deleteMany({ where: { id: { in: createdProfileIds.splice(0) } } });
});

afterAll(async () => {
  await database.$disconnect();
});

async function createProfile() {
  const profile = await database.userProfile.create({
    data: {
      label: `Foundation provenance profile ${randomUUID()}`,
      version: 1,
      careerGoals: [{ id: "goal-fp", statement: "Build a strategic SaaS career." }],
      experience: [{ id: "experience-fp", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" }],
      skills: [{ id: "skill-fp", statement: "Customer enablement" }],
      transferableSkills: [{ id: "transfer-fp", statement: "Teaching and facilitation" }],
      workPreferences: [{ id: "work-fp", statement: "Prefers strategic documented work." }],
      domainPreferences: { customerSuccess: customerSuccessTestPreferences },
    },
  });
  createdProfileIds.push(profile.id);
  return profile.id;
}

async function captureManual() {
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: "Customer Success Manager",
    company: `Provenance SaaS ${randomUUID()}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    postingDate: "2026-10-01",
    domain: "customer-success",
    sourceUrl: "https://www.linkedin.com/jobs/view/4242",
    applicationUrl: "https://jobs.example.com/apply/4242",
    sourceJobId: "REQ-4242",
    foundOn: "LinkedIn",
    rawText: [
      "Customer Success Manager at a SaaS workflow platform.",
      "Remote. Applicants must reside in the United States. Central or Eastern time preferred.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
      "Collaborate with Product and hand technical escalations to Support.",
      "3 years of Customer Success experience required. Salesforce preferred.",
    ].join("\n"),
  });
  createdOpportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

function runWorker() {
  return createEvaluationWorker({
    tasks,
    leaseSeconds: 60,
    processor: withOpportunityLifecycleSync(
      createCustomerSuccessEvaluationProcessor({
        evaluations: new PrismaEvaluationRepository(),
        tasks,
        semanticConfig,
        transport: createCustomerSuccessFixtureTransport(),
      }),
      lifecycle,
    ),
  }).runOnce();
}

// Everything that constitutes job provenance; status/updatedAt are excluded
// because lifecycle actions legitimately change them.
async function provenanceSnapshot(opportunityId: string) {
  const opportunity = await database.opportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    select: {
      source: true, sourceType: true, originalSource: true, canonicalUrl: true, applicationUrl: true,
      externalListingId: true, atsRequisitionId: true, discoveredAt: true, firstSeenAt: true,
      lastSeenAt: true, sourceUpdatedAt: true, postingDate: true, closingDate: true, atsPlatform: true,
      jobDescription: true, title: true, companyId: true, location: true, salaryText: true, domain: true,
    },
  });
  const sourceRecords = await database.sourceRecord.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" } });
  const fieldProvenance = await database.fieldProvenance.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" } });
  return { opportunity, sourceRecords, fieldProvenance };
}

describe("manual capture provenance", () => {
  it("persists every provenance field and keeps manual identity despite a reported source", async () => {
    const opportunityId = await captureManual();
    const { opportunity, sourceRecords, fieldProvenance } = await provenanceSnapshot(opportunityId);

    expect(opportunity).toMatchObject({
      source: "manual-input",
      sourceType: "MANUAL",
      originalSource: "manual-input",
      canonicalUrl: "https://www.linkedin.com/jobs/view/4242",
      applicationUrl: "https://jobs.example.com/apply/4242",
      externalListingId: "REQ-4242",
    });
    expect(opportunity.firstSeenAt).toEqual(opportunity.discoveredAt);
    expect(sourceRecords).toHaveLength(1);
    expect(sourceRecords[0]).toMatchObject({
      source: "manual-input",
      sourceType: "MANUAL",
      sourceUrl: "https://www.linkedin.com/jobs/view/4242",
      applicationUrl: "https://jobs.example.com/apply/4242",
      externalId: "REQ-4242",
      sourceMetadata: expect.objectContaining({ reportedSource: "LinkedIn" }),
    });
    expect(sourceRecords[0]!.normalizedAt).not.toBeNull();
    expect(fieldProvenance.map((row) => row.fieldName)).toEqual(
      expect.arrayContaining(["canonicalUrl", "applicationUrl", "externalListingId", "jobDescription"]),
    );
    expect(fieldProvenance.every((row) => row.sourceRecordId === sourceRecords[0]!.id)).toBe(true);
  });
});

describe("provenance survives evaluation, reevaluation, and lifecycle actions", () => {
  it("is byte-for-byte unchanged across the whole flow", async () => {
    const profileId = await createProfile();
    const opportunityId = await captureManual();
    const before = await provenanceSnapshot(opportunityId);
    const act = async (action: OpportunityUserAction) =>
      expect((await lifecycle.applyUserAction({ opportunityId, action })).status).toBe("APPLIED");

    await service.requestEvaluation(opportunityId, { userProfileId: profileId });
    expect((await runWorker())?.status).toBe("COMPLETED");
    expect(await provenanceSnapshot(opportunityId)).toEqual(before);

    await act("SAVE");
    await service.requestEvaluation(opportunityId, { userProfileId: profileId });
    expect((await runWorker())?.status).toBe("COMPLETED");
    for (const action of ["MARK_APPLIED", "ARCHIVE", "RESTORE", "RESTORE"] as const) await act(action);
    await act("DISMISS");
    await act("RESTORE");

    expect(await provenanceSnapshot(opportunityId)).toEqual(before);
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(2);
  });
});

describe("duplicate evaluation guard", () => {
  it("refuses a second request while one is active and allows it once the first finishes", async () => {
    const profileId = await createProfile();
    const opportunityId = await captureManual();

    await service.requestEvaluation(opportunityId, { userProfileId: profileId });
    await expect(service.requestEvaluation(opportunityId, { userProfileId: profileId })).rejects.toMatchObject({
      code: "EVALUATION_ALREADY_ACTIVE",
    });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(1);

    expect((await runWorker())?.status).toBe("COMPLETED");
    await service.requestEvaluation(opportunityId, { userProfileId: profileId });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(2);
    expect((await runWorker())?.status).toBe("COMPLETED");
  });
});

describe("SourceRecord.applicationUrl backfill migration", () => {
  it("copies only well-formed http(s) values and leaves every other row NULL", async () => {
    const migration = await readFile(
      new URL("../../database/prisma/migrations/20261006232000_source_record_application_url/migration.sql", import.meta.url),
      "utf8",
    );
    const backfill = migration.slice(migration.indexOf("UPDATE"));
    const cases = [
      ["valid https", { applicationUrl: " https://jobs.example.com/apply/1 " }, "https://jobs.example.com/apply/1"],
      ["valid http", { applicationUrl: "http://jobs.example.com/apply/2" }, "http://jobs.example.com/apply/2"],
      ["null metadata", null, null],
      ["missing key", { domain: "customer-success" }, null],
      ["json null", { applicationUrl: null }, null],
      ["empty string", { applicationUrl: "   " }, null],
      ["non-string", { applicationUrl: 42 }, null],
      ["non-http", { applicationUrl: "ftp://jobs.example.com/apply" }, null],
      ["javascript", { applicationUrl: "javascript:alert(1)" }, null],
      ["array metadata", ["https://jobs.example.com/apply/3"], null],
    ] as const;
    const ids: Record<string, string> = {};
    for (const [name, metadata] of cases) {
      const record = await database.sourceRecord.create({
        data: {
          source: "backfill-test",
          sourceType: "MANUAL",
          ...(metadata === null ? {} : { sourceMetadata: metadata as never }),
        },
        select: { id: true },
      });
      ids[name] = record.id;
      createdSourceRecordIds.push(record.id);
    }

    await database.$executeRawUnsafe(backfill);

    for (const [name, , expected] of cases) {
      const record = await database.sourceRecord.findUniqueOrThrow({ where: { id: ids[name]! }, select: { applicationUrl: true } });
      expect({ name, applicationUrl: record.applicationUrl }).toEqual({ name, applicationUrl: expected });
    }
  });
});
