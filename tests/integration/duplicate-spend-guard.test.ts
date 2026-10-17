import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  PrismaDuplicateRepository,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
  withDuplicateSpendLock,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createDuplicateResolutionHandler } from "../../apps/web/src/server/duplicate-service";
import { EvaluationApiError } from "../../apps/web/src/server/evaluation-errors";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createCleanup, createProfile, database, runWorker, semanticConfig, tasks } from "../support/budget-integration";

const clock = { now: new Date() };
const cleanup = createCleanup();
const duplicates = new PrismaDuplicateRepository();
const budget = createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] });
const service = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks,
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: budget.gate,
  duplicates,
  duplicateSpendLock: (work) => withDuplicateSpendLock(work),
});
const capture = createManualOpportunityService({
  repository: new PrismaManualOpportunityRepository(),
  normalizer: createManualOpportunityNormalizer(),
});

beforeEach(async () => {
  clock.now = new Date();
  await cleanup.before();
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

function listing(token: string, overrides: Record<string, unknown> = {}) {
  return {
    title: "Customer Success Manager",
    company: `Guardco ${token}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    domain: "customer-success",
    sourceUrl: `https://jobs.example.com/guard/${token}`,
    rawText: [
      `Customer Success Manager at Guardco ${token}, a SaaS workflow platform.`,
      "Remote. Applicants must reside in the United States.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
      "3 years of Customer Success experience required.",
    ].join("\n"),
    ...overrides,
  };
}

// An exact duplicate pair as it exists from before deduplication: two
// opportunities for one listing and no stored relationship.
async function legacyPair() {
  const token = randomUUID().slice(0, 8);
  const first = await capture.submit(listing(token));
  const second = await capture.submit(listing(token, { duplicateResolution: "SEPARATE" }));
  await database.duplicateReference.deleteMany({ where: { opportunityId: second.opportunity.id } });
  cleanup.opportunityIds.push(first.opportunity.id, second.opportunity.id);
  return { a: first.opportunity.id, b: second.opportunity.id };
}

async function evaluateToCompletion(opportunityId: string, userProfileId: string) {
  const queued = await service.requestEvaluation(opportunityId, { userProfileId });
  expect(queued.outcome).toBe("QUEUED");
  expect((await runWorker())?.status).toBe("COMPLETED");
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(EvaluationApiError);
  return error as EvaluationApiError;
}

async function spendRows(opportunityId: string) {
  return {
    evaluations: await database.evaluation.count({ where: { opportunityId } }),
    admissions: await database.evaluationAdmission.count({ where: { opportunityId } }),
    deferrals: await database.deferredEvaluation.count({ where: { opportunityId } }),
  };
}

describe("duplicate-spend guard", () => {
  it("refuses a paid evaluation of a never-evaluated exact duplicate and writes nothing", async () => {
    const profile = await createProfile(cleanup);
    const { a, b } = await legacyPair();
    await evaluateToCompletion(a, profile.id);

    const error = await refusal(service.requestEvaluation(b, { userProfileId: profile.id }));
    expect(error).toMatchObject({ code: "DUPLICATE_LISTING_ALREADY_EVALUATED", status: 409 });
    expect(error.details).toMatchObject({ duplicateOfOpportunityId: a, title: "Customer Success Manager" });
    expect(await spendRows(b)).toEqual({ evaluations: 0, admissions: 0, deferrals: 0 });

    // The evaluated opportunity's own reevaluation is never blocked.
    expect((await service.requestEvaluation(a, { userProfileId: profile.id })).outcome).toBe("QUEUED");
  });

  it("refuses while the twin's evaluation is still queued", async () => {
    const profile = await createProfile(cleanup);
    const { a, b } = await legacyPair();
    expect((await service.requestEvaluation(a, { userProfileId: profile.id })).outcome).toBe("QUEUED");
    expect((await refusal(service.requestEvaluation(b, { userProfileId: profile.id }))).code).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");
  });

  it("allows the pair once marked as different jobs, and refuses again after reopening", async () => {
    const profile = await createProfile(cleanup);
    const { a, b } = await legacyPair();
    await evaluateToCompletion(a, profile.id);

    await duplicates.resolve({ opportunityId: b, otherOpportunityId: a, resolution: "DISTINCT" });
    const stored = await database.duplicateReference.findUniqueOrThrow({
      where: { opportunityId_relatedOpportunityId: { opportunityId: b, relatedOpportunityId: a } },
    });
    expect(stored).toMatchObject({ decision: "MATCH", resolution: "DISTINCT", evidence: expect.objectContaining({ recordedBy: "USER_RESOLUTION" }) });

    const reopened = await duplicates.resolve({ opportunityId: b, otherOpportunityId: a, resolution: null });
    expect(reopened).toMatchObject({ decision: "MATCH", resolution: null, persisted: true });
    expect((await refusal(service.requestEvaluation(b, { userProfileId: profile.id }))).code).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");

    await duplicates.resolve({ opportunityId: a, otherOpportunityId: b, resolution: "DISTINCT" });
    expect((await service.requestEvaluation(b, { userProfileId: profile.id })).outcome).toBe("QUEUED");
  });

  it("refuses to resume a deferred request whose listing became a duplicate of an evaluated one; the deferral stays open", async () => {
    const profile = await createProfile(cleanup);
    const { a, b } = await legacyPair();
    // Different jobs at first: b is deferred for the budget, a is evaluated.
    await duplicates.resolve({ opportunityId: b, otherOpportunityId: a, resolution: "DISTINCT" });
    await budget.updateSettings({ amount: 0.01, currency: "USD", timeZone: "UTC", enforced: true, reservePerEvaluation: 0.6, warningThresholds: [] });
    const deferred = await service.requestEvaluation(b, { userProfileId: profile.id });
    expect(deferred.outcome).toBe("DEFERRED");
    await budget.removeBudget();
    await evaluateToCompletion(a, profile.id);
    // The user reopens the pair: they are the same listing after all.
    await duplicates.resolve({ opportunityId: b, otherOpportunityId: a, resolution: null });

    const deferralId = (deferred as { deferredEvaluationId: string }).deferredEvaluationId;
    const error = await refusal(service.resumeDeferred(deferralId));
    expect(error.code).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");
    expect(await database.deferredEvaluation.findUniqueOrThrow({ where: { id: deferralId } })).toMatchObject({ status: "DEFERRED" });
    expect(await database.evaluationAdmission.count({ where: { opportunityId: b, evaluationId: null, abandonedAt: null } })).toBe(0);
    expect(await database.evaluation.count({ where: { opportunityId: b } })).toBe(0);
    // Requesting again resumes that deferral and is refused the same way.
    expect((await refusal(service.requestEvaluation(b, { userProfileId: profile.id }))).code).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");
  });

  it("counts a twin's open deferred request as pending spend", async () => {
    const profile = await createProfile(cleanup);
    const { a, b } = await legacyPair();
    await budget.updateSettings({ amount: 0.01, currency: "USD", timeZone: "UTC", enforced: true, reservePerEvaluation: 0.6, warningThresholds: [] });
    expect((await service.requestEvaluation(a, { userProfileId: profile.id })).outcome).toBe("DEFERRED");
    expect((await refusal(service.requestEvaluation(b, { userProfileId: profile.id }))).code).toBe("DUPLICATE_LISTING_ALREADY_EVALUATED");
    expect(await spendRows(b)).toEqual({ evaluations: 0, admissions: 0, deferrals: 0 });
  });

  it("never blocks a probable match", async () => {
    const profile = await createProfile(cleanup);
    const token = randomUUID().slice(0, 8);
    const first = await capture.submit(listing(token, { sourceUrl: undefined }));
    const second = await capture.submit(listing(token, { sourceUrl: undefined, title: "Senior Customer Success Manager" }));
    cleanup.opportunityIds.push(first.opportunity.id, second.opportunity.id);
    expect(second.deduplication.decision).toBe("PROBABLE_MATCH");
    await evaluateToCompletion(first.opportunity.id, profile.id);
    expect((await service.requestEvaluation(second.opportunity.id, { userProfileId: profile.id })).outcome).toBe("QUEUED");
  });

  it("serializes simultaneous requests for two exact duplicates: exactly one is admitted", async () => {
    const profile = await createProfile(cleanup);
    for (let round = 0; round < 6; round += 1) {
      const { a, b } = await legacyPair();
      const results = await Promise.allSettled([
        service.requestEvaluation(a, { userProfileId: profile.id }),
        service.requestEvaluation(b, { userProfileId: profile.id }),
      ]);
      const admitted = results.filter((result) => result.status === "fulfilled");
      const refused = results.filter(
        (result) => result.status === "rejected" && (result.reason as EvaluationApiError).code === "DUPLICATE_LISTING_ALREADY_EVALUATED",
      );
      expect({ round, admitted: admitted.length, refused: refused.length }).toEqual({ round, admitted: 1, refused: 1 });
      const evaluations = await database.evaluation.count({ where: { opportunityId: { in: [a, b] } } });
      expect(evaluations).toBe(1);
    }
  });
});

describe("POST /api/opportunities/[id]/duplicates", () => {
  const handler = createDuplicateResolutionHandler(duplicates);
  const post = (id: string, body: unknown) =>
    handler(new Request(`http://localhost/api/opportunities/${id}/duplicates`, { method: "POST", body: JSON.stringify(body) }), id);

  it("marks a pair as different jobs and reopens it", async () => {
    const { a, b } = await legacyPair();
    const marked = await post(b, { otherOpportunityId: a, resolution: "DISTINCT" });
    expect(marked.status).toBe(200);
    expect((await marked.json()).relationship).toMatchObject({ otherOpportunityId: a, decision: "MATCH", resolution: "DISTINCT" });
    const reopened = await post(b, { otherOpportunityId: a, resolution: null });
    expect((await reopened.json()).relationship).toMatchObject({ resolution: null, resolvedAt: null });
  });

  it("refuses invalid bodies, unknown opportunities and pairs that are not duplicates", async () => {
    const { a } = await legacyPair();
    const token = randomUUID().slice(0, 8);
    const unrelated = await capture.submit(listing(token, { title: "Implementation Engineer", company: `Elsewhere ${token}`, rawText: `Build integrations ${token}.` }));
    cleanup.opportunityIds.push(unrelated.opportunity.id);
    expect((await post(a, { otherOpportunityId: a, resolution: "MERGE" })).status).toBe(400);
    expect((await post(a, { otherOpportunityId: "not-a-uuid", resolution: "DISTINCT" })).status).toBe(400);
    expect((await post("bad", { otherOpportunityId: a, resolution: "DISTINCT" })).status).toBe(404);
    expect((await post(a, { otherOpportunityId: randomUUID(), resolution: "DISTINCT" })).status).toBe(404);
    const notDuplicates = await post(a, { otherOpportunityId: unrelated.opportunity.id, resolution: "DISTINCT" });
    expect(notDuplicates.status).toBe(409);
    expect((await notDuplicates.json()).code).toBe("DUPLICATE_PAIR_NOT_FOUND");
  });
});
