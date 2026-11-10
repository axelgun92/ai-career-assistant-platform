import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityLifecycleRepository,
  PrismaUserProfileRepository,
  type VersionedUserProfileData,
} from "@ai-career/database";
import { createEvaluationWorker } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { readSemanticEnvironment } from "@ai-career/shared";
import { applyStructuredChanges, type ProfileDocument } from "../../apps/web/src/components/profile/structured-fields";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { createProfileService } from "../../apps/web/src/server/profile-service";
import { semanticExecutorConfigFromEnvironment } from "../../apps/web/src/server/semantic-execution-config";
import { createCustomerSuccessFixtureTransport, customerSuccessTestPreferences } from "../fixtures/customer-success";
import { e2eEnvironment } from "../support/e2e-environment";

const domain = "customer-success";
const passKey = "domainPreferences.customerSuccess.salary.passMinimum";
const database = getDatabaseClient();
const tasks = new PrismaEvaluationTaskRepository();
const queries = new PrismaEvaluationQueryRepository();
const profiles = new PrismaUserProfileRepository();
const profileService = createProfileService(profiles);
const semanticConfig = {
  ...semanticExecutorConfigFromEnvironment(readSemanticEnvironment({ ...process.env, ...e2eEnvironment() })),
  apiKey: "deterministic-integration-key",
};
const evaluationService = createEvaluationService({
  queries,
  evaluations: new PrismaEvaluationRepository(),
  tasks,
  semanticConfig,
  jobMaxAttempts: 1,
});
const createdLabels: string[] = [];
const createdOpportunityIds: string[] = [];
let activeBefore: { userProfileId: string; activatedAt: Date } | null = null;

// The active pointer is global per domain; restore whatever was there so
// this suite never changes which profile other suites or a developer use.
beforeEach(async () => {
  activeBefore = await database.activeUserProfile.findUnique({
    where: { domain },
    select: { userProfileId: true, activatedAt: true },
  });
});

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({ where: { id }, select: { companyId: true } });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } });
    if (opportunity?.companyId) await database.company.deleteMany({ where: { id: opportunity.companyId } });
  }
  await database.userProfile.deleteMany({ where: { label: { in: createdLabels.splice(0) } } });
  await database.activeUserProfile.deleteMany({ where: { domain } });
  if (activeBefore && (await database.userProfile.findUnique({ where: { id: activeBefore.userProfileId } }))) {
    await database.activeUserProfile.create({ data: { domain, ...activeBefore } });
  }
});

afterAll(async () => {
  await database.$disconnect();
});

function profileData(label: string): VersionedUserProfileData {
  return {
    label,
    careerGoals: [{ id: "goal-pv", statement: "Build a strategic SaaS career." }],
    experience: [{ id: "experience-pv", statement: "Led customer onboarding, adoption, and education.", relationship: "DIRECT" }],
    skills: [{ id: "skill-pv", statement: "Customer enablement" }],
    transferableSkills: [{ id: "transfer-pv", statement: "Teaching and facilitation" }],
    locationPreferences: null,
    compensationPreferences: null,
    workPreferences: [{ id: "work-pv", statement: "Prefers strategic documented work." }],
    companyPreferences: null,
    domainPreferences: { customerSuccess: customerSuccessTestPreferences },
  } as unknown as VersionedUserProfileData;
}

async function createV1(options: { activate: boolean }) {
  const label = `Profile versioning ${randomUUID()}`;
  createdLabels.push(label);
  const result = await profiles.saveVersion(domain, profileData(label), options);
  expect(result).toMatchObject({ status: "CREATED", version: 1 });
  return { id: result.id, label };
}

async function profileRow(id: string) {
  return database.userProfile.findUniqueOrThrow({ where: { id } });
}

async function captureOpportunity() {
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: "Customer Success Manager",
    company: `Profile Versioning SaaS ${randomUUID()}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    postingDate: "2026-10-01",
    domain,
    rawText: [
      "Customer Success Manager at a SaaS workflow platform.",
      "Remote. Applicants must reside in the United States.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
      "3 years of Customer Success experience required.",
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
      new PrismaOpportunityLifecycleRepository(),
    ),
  }).runOnce();
}

async function profileEvidenceReferences(evaluationId: string) {
  const rows = await database.evidenceRecord.findMany({
    where: { evaluationId, sourceType: "USER_PROFILE" },
    select: { sourceReference: true },
  });
  return [...new Set(rows.map((row) => row.sourceReference))];
}

async function countVersions(label: string) {
  return database.userProfile.count({ where: { label } });
}

describe("historical evaluation linkage", () => {
  it("keeps an evaluation bound to v1 after v2 is saved and activated; new evaluations pin v2", async () => {
    const v1 = await createV1({ activate: true });
    const opportunityId = await captureOpportunity();

    const first = await evaluationService.requestEvaluation(opportunityId, {});
    expect((await runWorker())?.status).toBe("COMPLETED");
    const firstRow = await database.evaluation.findUniqueOrThrow({ where: { id: first.evaluationId } });
    expect(firstRow).toMatchObject({ userProfileId: v1.id, userProfileVersion: 1 });
    const firstReferences = await profileEvidenceReferences(first.evaluationId);
    expect(firstReferences).toEqual([`user-profile:${v1.id}:v1`]);
    const v1Before = await profileRow(v1.id);

    const saved = await profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 65_000 }, activate: true });
    expect(saved).toMatchObject({ status: "CREATED", version: 2, activated: true });

    expect(await database.evaluation.findUniqueOrThrow({ where: { id: first.evaluationId } })).toEqual(firstRow);
    expect(await profileEvidenceReferences(first.evaluationId)).toEqual(firstReferences);
    expect(await profileRow(v1.id)).toEqual(v1Before);
    const historical = await evaluationService.getLatestEvaluation(opportunityId, first.evaluationId);
    expect(historical.versions.userProfile).toBe(1);

    const second = await evaluationService.requestEvaluation(opportunityId, {});
    expect((await runWorker())?.status).toBe("COMPLETED");
    expect(await database.evaluation.findUniqueOrThrow({ where: { id: second.evaluationId } })).toMatchObject({
      userProfileId: saved.id,
      userProfileVersion: 2,
    });
    expect(await profileEvidenceReferences(second.evaluationId)).toEqual([`user-profile:${saved.id}:v2`]);
    // The earlier evaluation is still exactly as it was.
    expect(await database.evaluation.findUniqueOrThrow({ where: { id: first.evaluationId } })).toEqual(firstRow);
    expect((await evaluationService.getLatestEvaluation(opportunityId)).history.map((item) => item.userProfileVersion)).toEqual([2, 1]);
  });

  it("completes a queued evaluation with its pinned v1 even if v2 is activated before the worker runs", async () => {
    const v1 = await createV1({ activate: true });
    const opportunityId = await captureOpportunity();
    const queued = await evaluationService.requestEvaluation(opportunityId, {});

    const v2 = await profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 65_000 }, activate: true });
    expect((await profiles.getActive(domain))?.userProfileId).toBe(v2.id);

    expect((await runWorker())?.status).toBe("COMPLETED");
    expect(await database.evaluation.findUniqueOrThrow({ where: { id: queued.evaluationId } })).toMatchObject({
      userProfileId: v1.id,
      userProfileVersion: 1,
    });
    expect(await profileEvidenceReferences(queued.evaluationId)).toEqual([`user-profile:${v1.id}:v1`]);
  });
});

describe("explicit active version", () => {
  it("saving without activation never changes which version evaluations use, even with no active row (pin guard)", async () => {
    const v1 = await createV1({ activate: false });
    await database.activeUserProfile.deleteMany({ where: { domain } });
    // With nothing activated, the fallback (newest profile) is v1.
    expect(await queries.resolveUserProfile(null, domain)).toEqual({ id: v1.id, version: 1 });

    const v2 = await profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 65_000 } });
    expect(v2).toMatchObject({ status: "CREATED", version: 2, activated: false });
    expect((await profiles.getActive(domain))?.userProfileId).toBe(v1.id);
    expect(await queries.resolveUserProfile(null, domain)).toEqual({ id: v1.id, version: 1 });
    // An explicit profile ID still wins over the active version.
    expect(await queries.resolveUserProfile(v2.id, domain)).toEqual({ id: v2.id, version: 2 });
  });

  it("activation and rollback move only the pointer; no UserProfile row is modified", async () => {
    const v1 = await createV1({ activate: true });
    const v2 = await profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 65_000 } });
    const before = [await profileRow(v1.id), await profileRow(v2.id)];

    await profileService.activate({ userProfileId: v2.id });
    expect(await queries.resolveUserProfile(null, domain)).toEqual({ id: v2.id, version: 2 });
    await profileService.activate({ userProfileId: v1.id });
    expect(await queries.resolveUserProfile(null, domain)).toEqual({ id: v1.id, version: 1 });

    expect([await profileRow(v1.id), await profileRow(v2.id)]).toEqual(before);
  });

  it("falls back to the newest profile only when nothing was ever activated", async () => {
    await database.activeUserProfile.deleteMany({ where: { domain } });
    const v1 = await createV1({ activate: false });
    expect(await queries.resolveUserProfile(null, domain)).toEqual({ id: v1.id, version: 1 });
    expect(await queries.resolveUserProfile(null)).toEqual({ id: v1.id, version: 1 });
  });

  it("identical content creates no version; with activation the matching version becomes active", async () => {
    const v1 = await createV1({ activate: false });
    await profileService.activate({ userProfileId: v1.id });
    const v2 = await profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 65_000 } });

    const v1Document = (await profiles.getVersion(v1.id))!.document;
    const same = await profileService.saveDocument({ baseVersionId: v2.id, document: v1Document, activate: true });
    expect(same).toEqual({ status: "ALREADY_IMPORTED", id: v1.id, version: 1, activated: true });
    expect(await countVersions(v1.label)).toBe(2);
    expect((await profiles.getActive(domain))?.userProfileId).toBe(v1.id);
  });

  it("deleting the active profile removes the active pointer (cascade)", async () => {
    const v1 = await createV1({ activate: true });
    expect((await profiles.getActive(domain))?.userProfileId).toBe(v1.id);
    await database.userProfile.delete({ where: { id: v1.id } });
    expect(await database.activeUserProfile.findUnique({ where: { domain } })).toBeNull();
  });
});

describe("exactly one version per save", () => {
  it("adds one row per structured, JSON, and carried-over save, none for identical content, and never changes earlier rows", async () => {
    const v1 = await createV1({ activate: true });
    const rows = async () => database.userProfile.findMany({ where: { label: v1.label }, orderBy: { version: "asc" } });

    const structured = await profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 61_000 } });
    expect(await countVersions(v1.label)).toBe(2);
    const afterStructured = await rows();

    const v1Document = (await profiles.getVersion(v1.id))!.document as unknown as ProfileDocument;
    const jsonDocument = { ...v1Document, skills: [{ id: "skill-json", statement: "Workshop facilitation" }] };
    const json = await profileService.saveDocument({ baseVersionId: v1.id, document: jsonDocument });
    expect(await countVersions(v1.label)).toBe(3);
    expect((await rows()).slice(0, 2)).toEqual(afterStructured);
    const afterJson = await rows();

    // What the editor sends after carrying form changes into the JSON editor.
    const carried = applyStructuredChanges(v1Document, { [passKey]: 62_500 });
    const carriedSave = await profileService.saveDocument({ baseVersionId: v1.id, document: carried });
    expect(await countVersions(v1.label)).toBe(4);
    const carriedRow = await profileRow(carriedSave.id);
    expect((carriedRow.domainPreferences as { customerSuccess: { salary: { passMinimum: number } } }).customerSuccess.salary.passMinimum)
      .toBe(62_500);
    const afterCarried = await rows();
    expect(afterCarried.slice(0, 3)).toEqual(afterJson);

    const identical = await profileService.saveDocument({ baseVersionId: v1.id, document: carried });
    expect(identical).toMatchObject({ status: "ALREADY_IMPORTED", id: carriedSave.id });
    expect(await rows()).toEqual(afterCarried);

    expect([structured.version, json.version, carriedSave.version]).toEqual([2, 3, 4]);
    expect((await profiles.getActive(domain))?.userProfileId).toBe(v1.id);
  });

  it("rejects an invalid save without creating a row", async () => {
    const v1 = await createV1({ activate: false });
    await expect(
      profileService.saveStructured({ baseVersionId: v1.id, changes: { [passKey]: 1_000 } }),
    ).rejects.toMatchObject({ code: "PROFILE_INVALID" });
    expect(await countVersions(v1.label)).toBe(1);
  });
});
