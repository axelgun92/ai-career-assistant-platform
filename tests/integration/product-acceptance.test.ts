import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createManualOpportunityService,
  rawOpportunitySchema,
  type RawOpportunity,
} from "@ai-career/core";
import {
  PrismaApplicationRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityDashboardRepository,
  PrismaOpportunityListRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import {
  createCleanup,
  createHarness,
  createProfile,
  database,
  runWorker,
  setBudget,
} from "../support/budget-integration";

// Whole-product acceptance: one connected manual-input scenario through
// every major system, deterministic (fixture provider transport, no paid
// calls). Feature-level details are covered by each feature's own suite.

const cleanup = createCleanup();
const clock = { now: new Date() };
let harness = createHarness(clock);
const applications = new PrismaApplicationRepository();
let previousActive: { userProfileId: string } | null = null;

beforeEach(async () => {
  clock.now = new Date();
  harness = createHarness(clock);
  await cleanup.before();
  previousActive = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" } });
});

afterEach(async () => {
  await cleanup.after();
  await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  if (previousActive && (await database.userProfile.findUnique({ where: { id: previousActive.userProfileId } }))) {
    await database.activeUserProfile.create({
      data: { domain: "customer-success", userProfileId: previousActive.userProfileId },
    });
  }
});
afterAll(() => database.$disconnect());

async function activate(profileId: string) {
  await database.activeUserProfile.upsert({
    where: { domain: "customer-success" },
    create: { domain: "customer-success", userProfileId: profileId },
    update: { userProfileId: profileId, activatedAt: new Date() },
  });
}

async function capture(token: string) {
  const repository = new PrismaManualOpportunityRepository();
  const captured: RawOpportunity[] = [];
  const detail = await createManualOpportunityService({
    repository: {
      createManualSourceRecord: (raw) => {
        captured.push(raw);
        return repository.createManualSourceRecord(raw);
      },
      createDiscoveredOpportunity: (input) => repository.createDiscoveredOpportunity(input),
      transitionOpportunityStatus: (input) => repository.transitionOpportunityStatus(input),
      findOpportunityDetail: (id) => repository.findOpportunityDetail(id),
    } as typeof repository,
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: "Customer Success Manager",
    company: `Acceptance SaaS ${token}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    postingDate: "2026-10-01",
    sourceUrl: `https://jobs.example.com/acceptance/${token}`,
    applicationUrl: `https://jobs.example.com/acceptance/${token}/apply`,
    sourceJobId: `ACC-${token}`,
    foundOn: "A company newsletter",
    domain: "customer-success",
    rawText: [
      "Customer Success Manager at a SaaS workflow platform.",
      "Remote. Applicants must reside in the United States.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
      "3 years of Customer Success experience required.",
    ].join("\n"),
  });
  cleanup.opportunityIds.push(detail.opportunity.id);
  return { detail, raw: captured[0]! };
}

describe("manual opportunity → evaluation → recommendation → lifecycle → application → reevaluation", () => {
  it("works as one product", async () => {
    const token = `acc${randomUUID().slice(0, 8)}`;

    // 1. Capture: the manual path builds a schema-valid RawOpportunity and
    //    keeps the provenance a later multi-source pipeline relies on.
    const { detail, raw } = await capture(token);
    const opportunityId = detail.opportunity.id;
    expect(rawOpportunitySchema.safeParse(raw).success).toBe(true);
    expect(raw).toMatchObject({ source: "manual-input", sourceType: "MANUAL" });
    expect(detail.opportunity).toMatchObject({
      status: "NORMALIZED",
      source: "manual-input",
      sourceType: "MANUAL",
      canonicalUrl: `https://jobs.example.com/acceptance/${token}`,
      applicationUrl: `https://jobs.example.com/acceptance/${token}/apply`,
      externalListingId: `ACC-${token}`,
    });
    expect(detail.opportunity.firstSeenAt).toEqual(detail.opportunity.lastSeenAt);
    expect(detail.sourceRecords).toHaveLength(1);
    expect(detail.sourceRecords[0]).toMatchObject({
      source: "manual-input",
      sourceType: "MANUAL",
      externalId: `ACC-${token}`,
      applicationUrl: `https://jobs.example.com/acceptance/${token}/apply`,
      sourceMetadata: expect.objectContaining({ reportedSource: "A company newsletter" }),
    });
    expect(detail.sourceRecords[0]!.normalizedAt).not.toBeNull();

    // 2. Profile: the active version is resolved and pinned.
    const first = await createProfile(cleanup, `Acceptance profile A ${token}`);
    await activate(first.id);

    // 3. Budget: no room defers (nothing queued, nothing spent); raising the
    //    budget and resuming queues it with the pinned profile.
    await setBudget({ amount: 0.1, reservePerEvaluation: 0.6 });
    const deferred = await harness.service.requestEvaluation(opportunityId, {});
    expect(deferred).toMatchObject({ outcome: "DEFERRED", reason: "BUDGET_UNAVAILABLE", userProfileVersion: first.version });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(0);
    await setBudget({ amount: 5, reservePerEvaluation: 0.6 });
    if (deferred.outcome !== "DEFERRED") throw new Error("unreachable");
    const resumed = await harness.service.resumeDeferred(deferred.deferredEvaluationId);
    expect(resumed).toMatchObject({ outcome: "QUEUED", status: "PENDING" });
    if (resumed.outcome !== "QUEUED") throw new Error("unreachable");
    expect(await harness.service.getLatestEvaluation(opportunityId)).toMatchObject({ status: "PENDING", queueState: "QUEUED" });
    expect(await database.evaluation.findUniqueOrThrow({ where: { id: resumed.evaluationId } })).toMatchObject({
      userProfileId: first.id,
      userProfileVersion: first.version,
    });

    // 4. The deterministic worker completes it: recommendation, evidence,
    //    history, usage and cost, lifecycle sync.
    const task = await runWorker();
    expect(task).toMatchObject({ status: "COMPLETED", evaluationId: resumed.evaluationId });
    const firstView = await harness.service.getLatestEvaluation(opportunityId);
    expect(firstView).toMatchObject({ status: "COMPLETED", queueState: "COMPLETED", recommendation: { decision: "APPLY" } });
    expect(firstView.evidence.length).toBeGreaterThan(0);
    expect(firstView.history).toHaveLength(1);
    expect(firstView.operations.length).toBeGreaterThan(0);
    expect(firstView.usage.attemptCount).toBeGreaterThan(0);
    expect(firstView.usage.estimatedCost).not.toBeNull();
    expect(JSON.stringify(firstView)).not.toContain("providerRequestId");
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).status).toBe("RECOMMENDED");
    const budget = await harness.budget.status();
    if (!budget.configured) throw new Error("expected a budget");
    expect(budget.held).toBe(0);
    expect(budget.knownSpent).toBeGreaterThan(0);

    // 5. Dashboard state reflects it.
    const list = new PrismaOpportunityListRepository();
    const row = async () =>
      (await list.listPage({ filters: { searchTerms: [token] }, sort: "newest", page: 1, pageSize: 10 })).items[0]!;
    expect(await row()).toMatchObject({
      status: "RECOMMENDED",
      latestEvaluation: { status: "COMPLETED" },
      currentRecommendation: { decision: "APPLY", isLatest: true },
      deferred: false,
      application: null,
    });

    // 6. Lifecycle action and application tracking.
    expect(await applications.applyLifecycleActionGuarded({ opportunityId, action: "SAVE" })).toMatchObject({ status: "APPLIED", to: "SAVED" });
    const planned = await applications.create(opportunityId, { mode: "plan" });
    const submitted = await applications.submit(planned.id, { expectedVersion: planned.version, appliedOn: "2026-10-05" });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).status).toBe("APPLIED");
    await applications.addFollowUp(submitted.id, { description: "Email the recruiter", dueOn: "2026-10-20" });
    await applications.addInterview(submitted.id, {
      kind: "RECRUITER_SCREEN", roundLabel: null, scheduledAt: new Date("2026-10-22T15:00:00Z"), status: "SCHEDULED", contactId: null, notes: null,
    });
    expect(await row()).toMatchObject({
      status: "APPLIED",
      application: { stage: "APPLIED", nextFollowUpOn: "2026-10-20" },
    });
    const applicationBefore = JSON.stringify(await database.application.findUniqueOrThrow({
      where: { id: submitted.id },
      include: { events: true, followUps: true, interviews: true },
    }));

    // 7. A new active profile version; reevaluation pins it, and leaves the
    //    lifecycle and application untouched.
    const second = await createProfile(cleanup, `Acceptance profile B ${token}`);
    await activate(second.id);
    const again = await harness.service.requestEvaluation(opportunityId, {});
    if (again.outcome !== "QUEUED") throw new Error("expected the reevaluation to queue");
    expect(await database.evaluation.findUniqueOrThrow({ where: { id: again.evaluationId } })).toMatchObject({ userProfileId: second.id });
    expect((await row()).currentRecommendation).toMatchObject({ evaluationId: resumed.evaluationId, isLatest: false });
    expect(await runWorker()).toMatchObject({ status: "COMPLETED", evaluationId: again.evaluationId });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).status).toBe("APPLIED");
    expect(JSON.stringify(await database.application.findUniqueOrThrow({
      where: { id: submitted.id },
      include: { events: true, followUps: true, interviews: true },
    }))).toBe(applicationBefore);

    // 8. Both evaluations remain in history; the newest is current.
    const latest = await harness.service.getLatestEvaluation(opportunityId);
    expect(latest.history.map((item) => item.evaluationId)).toEqual([again.evaluationId, resumed.evaluationId]);
    expect(latest.history.every((item) => item.status === "COMPLETED")).toBe(true);
    const older = await harness.service.getLatestEvaluation(opportunityId, resumed.evaluationId);
    expect(older).toMatchObject({ isLatest: false, status: "COMPLETED", versions: { userProfile: first.version } });
    expect(await row()).toMatchObject({
      currentRecommendation: { evaluationId: again.evaluationId, isLatest: true },
      application: { stage: "APPLIED" },
    });

    // The dashboard's counts include this opportunity in the views they link to.
    const summary = await new PrismaOpportunityDashboardRepository().summarize();
    expect(summary.applied).toBeGreaterThanOrEqual(1);
  });
});
