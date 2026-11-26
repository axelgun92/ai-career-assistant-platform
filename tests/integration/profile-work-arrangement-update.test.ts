// The safe activation of Remote and Hybrid (November 25, 2026; review): a
// rehearsal, on the isolated test database, of the targeted profile update
// handed to Alex (one structured change on top of the active version, saved
// and activated as a new version, as the Profile page's form does). It
// allows Remote and Hybrid and excludes Onsite; changes nothing else in the
// profile; leaves exactly one active Customer Success profile; never touches
// work eligibility or confirmed opportunity facts; and makes affected triage
// stale, so it is assessed again (history kept). Running it again creates no
// duplicate version. The bundled import (`pnpm
// profile:import:customer-success --activate`) is not used: it would
// activate the bundled document as a whole and undo any later Profile-page
// edits.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfirmedFactRepository,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaPreEvaluatorTriageRepository,
} from "@ai-career/database";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { getProfileApiHandlers } from "../../apps/web/src/server/profile-service";
import { reassessStaleTriage } from "../../apps/web/src/server/triage-reassessment";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";

const triageRepository = new PrismaPreEvaluatorTriageRepository();
const triageService = createPreEvaluatorTriageService({ repository: triageRepository });
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ pricingCurrencies: () => ["USD"] }).gate,
  triageGate: triageService.gate,
});
const cleanup = createCleanup();
const token = `Prof${randomUUID().slice(0, 8)}`;
const allowedKey = "domainPreferences.customerSuccess.workArrangement.allowed";
let activeBefore: { userProfileId: string } | null = null;
let base: { id: string } = { id: "" };

beforeAll(async () => {
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  // The user's current profile: Remote only, plus an edit of their own.
  const created = await createProfile(cleanup, `Work arrangement ${token}`);
  const preferences = (created.domainPreferences as { customerSuccess: Record<string, unknown> }).customerSuccess;
  base = await database.userProfile.update({
    where: { id: created.id },
    data: {
      workPreferences: [{ id: "work-user-edit", statement: `A preference the user edited (${token}).` }],
      domainPreferences: { customerSuccess: { ...preferences, workArrangement: { ...(preferences.workArrangement as object), allowed: ["REMOTE"] } } },
    },
  });
  await database.activeUserProfile.upsert({ where: { domain: "customer-success" }, create: { domain: "customer-success", userProfileId: base.id }, update: { userProfileId: base.id } });
});

afterAll(async () => {
  const versions = await database.userProfile.findMany({ where: { label: { contains: token } }, select: { id: true } });
  if (activeBefore) await database.activeUserProfile.update({ where: { domain: "customer-success" }, data: { userProfileId: activeBefore.userProfileId } });
  else await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  for (const version of versions) if (!cleanup.profileIds.includes(version.id)) cleanup.profileIds.push(version.id);
  await cleanup.after();
  await database.$disconnect();
});

const strip = (document: Record<string, unknown>) => {
  const copy = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  for (const key of ["id", "version", "label", "createdAt", "updatedAt", "importHash", "contentHash", "sourceHash"]) delete copy[key];
  const cs = (copy.domainPreferences as { customerSuccess: { workArrangement: Record<string, unknown> } }).customerSuccess;
  delete cs.workArrangement.allowed;
  return copy;
};

async function update() {
  const response = await getProfileApiHandlers().postStructured(
    new Request("http://test/api/profile/structured", {
      method: "POST",
      body: JSON.stringify({ baseVersionId: base.id, changes: { [allowedKey]: ["REMOTE", "HYBRID"] }, activate: true }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { status: string; id: string; version: number; activated: boolean } };
}

describe("allowing Remote and Hybrid on the active profile", () => {
  it("changes only the allowed work arrangements, activates one version, keeps eligibility and confirmed facts, and makes triage stale", async () => {
    // A job assessed under the current profile, with a fact the user confirmed.
    const company = await database.company.create({ data: { name: `Profco ${token}` } });
    const job = await database.opportunity.create({
      data: {
        domain: "customer-success", status: "NORMALIZED", companyId: company.id, title: "Customer Success Manager",
        location: "Remote - United States", remoteStatus: "HYBRID", workArrangements: ["HYBRID"], employmentType: "FULL_TIME",
        residencyRequirement: "US_REQUIRED", residencyRegions: ["US"], compensationBasis: "BASE", salaryMin: 72_000, salaryMax: 88_000, currency: "USD",
        jobDescription: "Own onboarding and renewals.",
      },
    });
    cleanup.opportunityIds.push(job.id);
    await evaluation.assessTriage(job.id);
    await new PrismaConfirmedFactRepository().save({ opportunityId: job.id, fieldName: "seniority", value: "MID", quotation: "Mid-level role", note: null, capturedValue: null, at: new Date() } as never);
    const eligibilityBefore = await database.userEligibility.findMany();
    const factsBefore = await database.userConfirmedFact.findMany({ where: { opportunityId: job.id } });
    const beforeDocument = (await database.userProfile.findUniqueOrThrow({ where: { id: base.id } })) as unknown as Record<string, unknown>;

    const { status, body } = await update();
    expect(status).toBeLessThan(300);
    expect(body).toMatchObject({ status: "CREATED", activated: true });
    expect(body.id).not.toBe(base.id);

    // Remote and Hybrid, never Onsite; nothing else changed.
    const after = (await database.userProfile.findUniqueOrThrow({ where: { id: body.id } })) as unknown as Record<string, unknown>;
    const allowed = (after.domainPreferences as { customerSuccess: { workArrangement: { allowed: string[] } } }).customerSuccess.workArrangement.allowed;
    expect(allowed).toEqual(["REMOTE", "HYBRID"]);
    expect(allowed).not.toContain("ONSITE");
    expect(strip(after)).toEqual(strip(beforeDocument));
    expect(after.workPreferences).toEqual([{ id: "work-user-edit", statement: `A preference the user edited (${token}).` }]);
    // The earlier version is kept, unchanged.
    expect(((await database.userProfile.findUniqueOrThrow({ where: { id: base.id } })).domainPreferences as { customerSuccess: { workArrangement: { allowed: string[] } } }).customerSuccess.workArrangement.allowed).toEqual(["REMOTE"]);

    // Exactly one active Customer Success profile: the new version.
    expect(await database.activeUserProfile.findMany({ where: { domain: "customer-success" }, select: { userProfileId: true } })).toEqual([{ userProfileId: body.id }]);
    // Eligibility and confirmed facts untouched.
    expect(await database.userEligibility.findMany()).toEqual(eligibilityBefore);
    expect(await database.userConfirmedFact.findMany({ where: { opportunityId: job.id } })).toEqual(factsBefore);

    // The job's triage is stale under the new profile, and is assessed again.
    const profile = await database.userProfile.findUniqueOrThrow({ where: { id: body.id }, select: { id: true, version: true } });
    expect(await triageService.gate.staleness!({ opportunityId: job.id, domain: "customer-success", profile })).toBe("PROFILE_CHANGED");
    const summary = await reassessStaleTriage({ assess: (opportunityId) => evaluation.assessTriage(opportunityId, { onlyIfStale: true }) });
    expect(summary.failed).toBe(0);
    expect((await triageRepository.get(job.id))?.userProfileId).toBe(body.id);
    expect((await triageRepository.history(job.id)).map((entry) => entry.trigger)).toEqual(["INITIAL", "PROFILE_CHANGED"]);
    expect(await triageService.gate.staleness!({ opportunityId: job.id, domain: "customer-success", profile })).toBe("CURRENT");

    // Running the same update again creates no duplicate version.
    const again = await update();
    expect(again.body).toMatchObject({ status: "ALREADY_IMPORTED", id: body.id });
    expect(await database.activeUserProfile.count({ where: { domain: "customer-success" } })).toBe(1);
  });
});
