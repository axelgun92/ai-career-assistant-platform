import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCustomerSuccessProfileContext,
  customerSuccessUserProfileDataSchema,
} from "@ai-career/customer-success";
import {
  hashUserProfileData,
  PrismaEvaluationRepository,
  PrismaUserProfileImportRepository,
  PrismaUserProfileRepository,
  type VersionedUserProfileData,
} from "@ai-career/database";
import { createDoctorReads } from "../../apps/web/src/server/doctor";
import { createProfileService } from "../../apps/web/src/server/profile-service";
import { alexandraNugentCustomerSuccessProfile } from "../../apps/web/src/server/profile-import/alexandra-nugent-customer-success-profile";
import { customerSuccessTestPreferences } from "../fixtures/customer-success";
import {
  captureOpportunity,
  createCleanup,
  createHarness,
  database,
  setBudget,
} from "../support/budget-integration";

// Product persistence boundary for structured profile limitations. The
// limitation structure belongs to the domain profile contract; here it is
// opaque data that must be stored, versioned and delivered unchanged.
// Acceptance of limitations by the domain contract, the migrated bundled
// profile and Genuine Gap behaviour are post-integration acceptance tests
// (see HANDOFFS.md).

const cleanup = createCleanup();
const clock = { now: new Date() };
let harness = createHarness(clock);
const importer = new PrismaUserProfileImportRepository();
const profiles = new PrismaUserProfileRepository();
const evaluations = new PrismaEvaluationRepository();
const labels: string[] = [];
let activeBefore: { userProfileId: string } | null = null;

const limitation = (statement: string) => ({
  id: "limitation-saas-customer-success-scope",
  statement,
  category: "EXPERIENCE",
  disclaimedExperienceSpecificity: "DIRECT_SAAS_CUSTOMER_SUCCESS",
});

function profileData(label: string, extra: Partial<VersionedUserProfileData> = {}): VersionedUserProfileData {
  return {
    label,
    careerGoals: [{ id: "goal-limitations", statement: "Build a strategic SaaS career." }],
    experience: [{ id: "experience-limitations", statement: "Led customer onboarding and adoption.", relationship: "DIRECT" }],
    skills: [{ id: "skill-limitations", statement: "Customer enablement" }],
    transferableSkills: [{ id: "transfer-limitations", statement: "Teaching and facilitation" }],
    locationPreferences: { regions: ["United States"] },
    compensationPreferences: { minimum: 70000 },
    workPreferences: [{ id: "work-limitations", statement: "Prefers documented work." }],
    companyPreferences: { stage: "growth" },
    domainPreferences: { customerSuccess: customerSuccessTestPreferences },
    ...extra,
  };
}

function newLabel() {
  const label = `Limitations profile ${randomUUID()}`;
  labels.push(label);
  return label;
}

beforeEach(async () => {
  clock.now = new Date();
  harness = createHarness(clock);
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } });
});

afterEach(async () => {
  await cleanup.after();
  await database.activeUserProfile.deleteMany({ where: { domain: "customer-success", userProfile: { label: { in: labels } } } });
  await database.userProfile.deleteMany({ where: { label: { in: labels.splice(0) } } });
  if (activeBefore && !(await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } }))) {
    if (await database.userProfile.findUnique({ where: { id: activeBefore.userProfileId } })) {
      await database.activeUserProfile.create({ data: { domain: "customer-success", userProfileId: activeBefore.userProfileId } });
    }
  }
});
afterAll(() => database.$disconnect());

describe("limitations persistence and version identity", () => {
  it("survive import → database → repository read unchanged", async () => {
    const limitations = [limitation("No source verifies direct SaaS Customer Success Manager employment.")];
    const created = await importer.import(profileData(newLabel(), { limitations }));
    expect(created.status).toBe("CREATED");

    const row = await database.userProfile.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.limitations).toEqual(limitations);
    const version = await profiles.getVersion(created.id);
    expect(version?.document.limitations).toEqual(limitations);
  });

  it("identical content is not duplicated; changed limitations append a new version; old rows never change", async () => {
    const label = newLabel();
    const first = await importer.import(profileData(label, { limitations: [limitation("First wording.")] }));
    const before = await database.userProfile.findUniqueOrThrow({ where: { id: first.id } });

    const duplicate = await importer.import(profileData(label, { limitations: [limitation("First wording.")] }));
    expect(duplicate).toMatchObject({ status: "ALREADY_IMPORTED", id: first.id, version: 1 });

    const changed = await importer.import(profileData(label, { limitations: [limitation("Second wording.")] }));
    expect(changed).toMatchObject({ status: "CREATED", version: 2 });
    expect(changed.id).not.toBe(first.id);

    const removed = await importer.import(profileData(label));
    expect(removed).toMatchObject({ status: "CREATED", version: 3 });

    expect(await database.userProfile.findUniqueOrThrow({ where: { id: first.id } })).toEqual(before);
    expect(await database.userProfile.count({ where: { label } })).toBe(3);
  });

  it("versions without limitations keep their identity: absent and null hash and store the same", async () => {
    const label = newLabel();
    const without = profileData(label);
    expect(hashUserProfileData({ ...without, limitations: null })).toBe(hashUserProfileData(without));
    expect(hashUserProfileData({ ...without, limitations: [] })).not.toBe(hashUserProfileData(without));

    const first = await importer.import(without);
    const again = await importer.import({ ...without, limitations: null });
    expect(again).toMatchObject({ status: "ALREADY_IMPORTED", id: first.id });
    expect((await database.userProfile.findUniqueOrThrow({ where: { id: first.id } })).limitations).toBeNull();
    expect(await profiles.getVersion(first.id)).toMatchObject({ document: expect.not.objectContaining({ limitations: expect.anything() }) });
    expect(Object.keys((await profiles.getVersion(first.id))!.document)).not.toContain("limitations");
  });

  it("existing profiles without limitations still load and build the evaluator's profile context", async () => {
    // A row exactly as written before the column existed.
    const label = newLabel();
    const legacy = await database.userProfile.create({
      data: { ...profileData(label), version: 1, contentHash: hashUserProfileData(profileData(label)) },
    });
    const opportunityId = await captureOpportunity(cleanup);
    const subject = await evaluations.loadSubject({ opportunityId, userProfileId: legacy.id });
    expect(subject?.userProfile?.data).not.toHaveProperty("limitations");
    expect(() => createCustomerSuccessProfileContext(subject!.userProfile!)).not.toThrow();
  });
});

describe("evaluation subject delivery and pinning", () => {
  it("loadSubject delivers the pinned version's limitations; a newer version never changes queued or deferred work", async () => {
    const label = newLabel();
    const v1 = await importer.import(profileData(label));
    await profiles.setActive("customer-success", v1.id);
    const queuedOpportunity = await captureOpportunity(cleanup);
    const queued = await harness.service.requestEvaluation(queuedOpportunity, {});
    if (queued.outcome !== "QUEUED") throw new Error("expected a queued evaluation");

    await setBudget({ amount: 0.1, reservePerEvaluation: 0.6 });
    const deferredOpportunity = await captureOpportunity(cleanup);
    const deferred = await harness.service.requestEvaluation(deferredOpportunity, {});
    if (deferred.outcome !== "DEFERRED") throw new Error("expected a deferral");

    const limitations = [limitation("No source verifies direct SaaS Customer Success Manager employment.")];
    const v2 = await importer.import(profileData(label, { limitations }));
    expect(v2.version).toBe(2);
    await profiles.setActive("customer-success", v2.id);

    const evaluation = await database.evaluation.findUniqueOrThrow({ where: { id: queued.evaluationId } });
    expect(evaluation).toMatchObject({ userProfileId: v1.id, userProfileVersion: 1 });
    const pinned = await evaluations.loadSubject({ opportunityId: queuedOpportunity, userProfileId: evaluation.userProfileId });
    expect(pinned?.userProfile).toMatchObject({ id: v1.id, version: 1 });
    expect(pinned?.userProfile?.data).not.toHaveProperty("limitations");

    const deferral = await database.deferredEvaluation.findUniqueOrThrow({ where: { id: deferred.deferredEvaluationId } });
    expect(deferral).toMatchObject({ userProfileId: v1.id, userProfileVersion: 1 });

    const current = await evaluations.loadSubject({ opportunityId: queuedOpportunity, userProfileId: v2.id });
    expect(current?.userProfile).toMatchObject({ id: v2.id, version: 2 });
    expect((current?.userProfile?.data as { limitations?: unknown }).limitations).toEqual(limitations);

    // The read-only operator check sees the migration state without changing it.
    const doctor = createDoctorReads(database, {
      workerConnected: async () => false,
      queueSnapshot: async () => ({ pending: 0, oldestPendingAt: null, running: 0, expiredReclaimable: 0, expiredExhausted: 0 }),
    });
    expect(await doctor.activeCustomerSuccessProfile()).toEqual({ version: 2, storesLimitations: true });
    const open = await doctor.openDeferrals();
    expect(open.pinnedToOtherVersion).toBeGreaterThanOrEqual(1);
    expect(open.open).toBeGreaterThanOrEqual(open.pinnedToOtherVersion);
    expect(await database.deferredEvaluation.findUniqueOrThrow({ where: { id: deferred.deferredEvaluationId } }))
      .toMatchObject({ status: "DEFERRED", userProfileId: v1.id });
  });
});

describe("profile save paths", () => {
  it("the starting-profile document saves through the web path and reads back intact", async () => {
    const service = createProfileService(profiles);
    const document = { ...alexandraNugentCustomerSuccessProfile, label: newLabel() };
    const existing = await database.userProfile.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    const saved = await service.saveDocument({ baseVersionId: existing?.id ?? null, document, activate: false });
    expect(saved).toMatchObject({ status: "CREATED", version: 1, activated: false });
    const stored = await profiles.getVersion(saved.id);
    expect(stored?.document).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it("limitations in an edited document are judged only by the installed domain contract, never stripped or loosened", async () => {
    const service = createProfileService(profiles);
    const base = await importer.import(profileData(newLabel()));
    const label = (await profiles.getVersion(base.id))!.label;
    const document = { ...profileData(label), limitations: [limitation("A stated limitation.")] };
    const accepted = customerSuccessUserProfileDataSchema.safeParse(document).success;

    const attempt = service.saveDocument({ baseVersionId: base.id, document, activate: false });
    if (accepted) {
      const saved = await attempt;
      expect((await profiles.getVersion(saved.id))?.document.limitations).toEqual(document.limitations);
    } else {
      await expect(attempt).rejects.toMatchObject({
        code: "PROFILE_INVALID",
        issues: expect.arrayContaining([expect.objectContaining({ path: "limitations" })]),
      });
      expect(await database.userProfile.count({ where: { label } })).toBe(1);
    }
  });
});
