// LinkedIn Mode B end to end on the isolated test database, with the
// production site registry (LinkedIn enabled, verified November 3, 2026):
// the real F0 result cards are read by the results reader and staged by the
// production intake with automatic details; the acquisition pass reads each
// job's public LinkedIn page (served by a fake browser: no network) with the
// unchanged single-job reader at the verified pacing, ingests it through the
// normal capture path under the single-job identity, and hands each new
// opportunity to the real triage-gated evaluation request. A later single-job
// capture of the same job re-observes the same opportunity; repeats are
// idempotent; LinkedIn's anti-bot interstitial stops the site with nothing
// ingested; no configured source or listing ledger row is created.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaEvaluationTaskRepository,
  PrismaExtensionLookupRepository,
  PrismaManualOpportunityRepository,
  PrismaPageCaptureRepository,
  PrismaPreEvaluatorTriageRepository,
} from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildPageCaptureBatch } from "../../apps/extension/src/page-capture-view";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService, enabledSitesFromEnvironment } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, evaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { createPreEvaluatorTriageService } from "../../apps/web/src/server/pre-evaluator-triage-service";
import { createCleanup, createProfile, database, semanticConfig } from "../support/budget-integration";
import { linkedInF0ResultsPage, linkedInGuestJobPage } from "../support/linkedin-guest-pages";
import { runResultsReader } from "../support/page-capture-pages";

const f0 = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/page-capture/linkedin-f0-cards.json"), "utf8")) as { cards: string[] };
const searchUrl = "https://www.linkedin.com/jobs/search?keywords=customer%20success&location=United%20States";
// The real F0 jobs; a fourth is kept out of the saved batch.
const jobs = {
  evaluate: { id: "4484727127", salary: "$72,000-$88,000" },
  review: { id: "4423511448", salary: null },
  reject: { id: "4486498409", salary: "$45,000-$50,000" },
  later: { id: "4444032301", salary: "$72,000-$88,000" },
} as const;
const externalIds = Object.values(jobs).map((job) => `linkedin:${job.id}`).concat("linkedin:4486439538");

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-04T12:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const triageRepository = new PrismaPreEvaluatorTriageRepository();
const evaluation = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks: new PrismaEvaluationTaskRepository(),
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: createBudgetService({ now: () => clock.now, pricingCurrencies: () => ["USD"] }).gate,
  triageGate: createPreEvaluatorTriageService({ repository: triageRepository, now: () => clock.now }).gate,
});
// The production registry decides what is enabled.
const intake = createPageCaptureService({ repository, enabledSites: () => enabledSitesFromEnvironment({}), now: () => clock.now });
const singleJob = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});

const description = (salary: string | null) =>
  [
    "<p>Customer Success Manager for a workflow SaaS platform.</p>",
    "<p>This is a fully remote role. Applicants must reside in the United States.</p>",
    salary ? `<p>Base salary ${salary}.</p>` : "<p>Compensation is not stated.</p>",
    "<p>Own onboarding, adoption, education, and retention for a portfolio of B2B customers.</p>",
  ].join("");
const pageFor = (id: string) => {
  const job = Object.values(jobs).find((candidate) => candidate.id === id);
  return job ? linkedInGuestJobPage({ id, title: "Customer Success Manager", company: `Company ${id}`, location: "United States", descriptionHtml: description(job.salary) }) : null;
};

let serve: (url: string) => { status: number; html: string } = (url) => {
  const html = pageFor(/(\d{5,20})$/.exec(url)?.[1] ?? "");
  return html ? { status: 200, html } : { status: 404, html: "Not found" };
};
const navigated: string[] = [];
const starts: number[] = [];
let fakeTime = 0;
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    // The session paces on the real clock; sleeps are faked here, so the
    // effective start time is real time plus the time slept.
    starts.push(Date.now() + fakeTime);
    const served = serve(url);
    return { status: served.status, finalUrl: url, html: served.html, cookieNames: [] };
  },
  close: async () => undefined,
};
const acquisition = () =>
  createPageCaptureAcquisition({
    repository,
    ingestion,
    handoff: evaluationHandoff(evaluation),
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => enabledSitesFromEnvironment({}).details,
    browser: { launch: async () => driver },
    now: () => clock.now,
    sleep: async (ms) => {
      fakeTime += ms;
    },
  });

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let activeBefore: { userProfileId: string } | null = null;

function savedBatch(kept: boolean[], batchId = randomUUID()) {
  const reading = runResultsReader(linkedInF0ResultsPage(f0.cards), searchUrl, "linkedin");
  const built = buildPageCaptureBatch(reading, kept, { site: "linkedin", batchId, extensionVersion: "0.2.0", capturedAt: clock.now });
  if (!built.ok) throw new Error(built.problem);
  return built.batch;
}

async function tableCounts() {
  const [opportunities, sources, listings, attempts] = await Promise.all([
    database.opportunity.count(),
    database.retrievalSource.count(),
    database.retrievedListing.count(),
    database.semanticOperationAttempt.count(),
  ]);
  return { opportunities, sources, listings, attempts };
}

const items = () => database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } }, orderBy: { externalId: "asc" } });
const itemOf = async (id: string) => (await items()).find((item) => item.externalId === `linkedin:${id}`)!;

beforeEach(async () => {
  // These are real LinkedIn job IDs: refuse to run over any existing data for them.
  const existing = await database.sourceRecord.count({ where: { OR: [{ externalId: { in: externalIds } }, { source: "linkedin", externalId: { in: Object.values(jobs).map((job) => job.id) } }] } });
  const staged = await database.pageCaptureItem.count({ where: { externalId: { in: externalIds } } });
  expect({ existing, staged }, "the test database already holds these LinkedIn jobs").toEqual({ existing: 0, staged: 0 });
  await cleanup.before();
  navigated.splice(0);
  starts.splice(0);
  fakeTime = 0;
  serve = (url) => {
    const html = pageFor(/(\d{5,20})$/.exec(url)?.[1] ?? "");
    return html ? { status: 200, html } : { status: 404, html: "Not found" };
  };
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
  const profile = await createProfile(cleanup);
  await database.activeUserProfile.upsert({
    where: { domain: "customer-success" },
    create: { domain: "customer-success", userProfileId: profile.id },
    update: { userProfileId: profile.id },
  });
  pairing = await database.extensionPairing.create({ data: { label: "LinkedIn batch test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const staged = await items();
  const opportunityIds = [...new Set([...staged.map((item) => item.opportunityId).filter((id): id is string => Boolean(id)), ...cleanup.opportunityIds])];
  const records = await database.sourceRecord.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  for (const record of records) if (record.opportunityId && !opportunityIds.includes(record.opportunityId)) opportunityIds.push(record.opportunityId);
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: externalIds } } });
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ opportunityId: { in: opportunityIds } }, { externalId: { in: externalIds } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  if (activeBefore) {
    await database.activeUserProfile.upsert({
      where: { domain: "customer-success" },
      create: { domain: "customer-success", userProfileId: activeBefore.userProfileId },
      update: { userProfileId: activeBefore.userProfileId },
    });
  }
  await cleanup.after();
  if (!activeBefore) await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

describe("LinkedIn Mode B on the test database", () => {
  it("stages the real F0 cards, reads each job's public page automatically, ingests it like a single-job capture and hands it to the existing triage", async () => {
    const before = await tableCounts();
    // Save four of the five loaded cards (the fifth left out in the preview).
    const staged = await intake.capture(savedBatch([true, true, true, true, false]), pairing);
    expect(staged).toMatchObject({ site: { key: "linkedin", automaticDetails: true }, counts: { queued: 4, rejected: 0 } });
    expect(await tableCounts()).toEqual(before);
    expect((await items()).map((item) => item.externalId)).not.toContain("linkedin:4486439538");

    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ site: "linkedin", claimed: 4, ingested: 4, stopped: null });
    // Canonical job pages, each once, at least 5 s apart.
    expect([...navigated].sort()).toEqual(Object.values(jobs).map((job) => `https://www.linkedin.com/jobs/view/${job.id}`).sort());
    for (let index = 1; index < starts.length; index += 1) expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(5_000);

    for (const job of Object.values(jobs)) {
      const item = await itemOf(job.id);
      expect(item, job.id).toMatchObject({ status: "INGESTED", sourceUrl: `https://www.linkedin.com/jobs/view/${job.id}`, siteJobId: job.id });
      const record = await database.sourceRecord.findFirst({ where: { opportunityId: item.opportunityId! } });
      expect(record, job.id).toMatchObject({ source: "browser-extension", sourceType: "BROWSER_EXTENSION", externalId: `linkedin:${job.id}`, retrievalSourceId: null });
      const opportunity = await database.opportunity.findUnique({ where: { id: item.opportunityId! } });
      expect(opportunity?.discoveredAt.toISOString(), job.id).toBe(item.firstSeenAt.toISOString());
      expect(opportunity?.jobDescription, job.id).toContain("Own onboarding, adoption, education, and retention");
    }
    expect(await itemOf(jobs.evaluate.id)).toMatchObject({ handoffOutcome: "QUEUED" });
    expect(await itemOf(jobs.review.id)).toMatchObject({ handoffOutcome: "NEEDS_REVIEW" });
    expect(await itemOf(jobs.reject.id)).toMatchObject({ handoffOutcome: "REJECT" });
    expect(await triageRepository.get((await itemOf(jobs.review.id)).opportunityId!)).toMatchObject({ outcome: "NEEDS_REVIEW", manualDecision: null });

    // Only EVALUATE reached admission; nothing reached a provider.
    for (const [job, admissions] of [[jobs.evaluate, 1], [jobs.review, 0], [jobs.reject, 0]] as const) {
      const opportunityId = (await itemOf(job.id)).opportunityId!;
      expect(await database.evaluationAdmission.count({ where: { opportunityId } }), job.id).toBe(admissions);
    }
    const after = await tableCounts();
    expect(after).toEqual({ ...before, opportunities: before.opportunities + 4 });

    // Nothing is read twice.
    navigated.splice(0);
    expect(await acquisition().runOnce()).toBeNull();
    expect(navigated).toEqual([]);
  });

  it("repeats idempotently, and a later single-job capture of a batch job re-observes the same opportunity", async () => {
    const id = randomUUID();
    await intake.capture(savedBatch([true, false, false, false, false], id), pairing);
    expect((await intake.capture(savedBatch([true, false, false, false, false], id), pairing)).counts).toMatchObject({ queued: 0, seenAgain: 1 });
    await acquisition().runOnce();
    const item = await itemOf(jobs.evaluate.id);
    expect(item).toMatchObject({ status: "INGESTED", sightings: 1 });
    const before = await tableCounts();

    const modeA = await singleJob.capture(
      {
        schemaVersion: extensionCaptureSchemaVersion,
        pageUrl: `https://www.linkedin.com/jobs/view/everhealth-strategic-customer-success-manager-remote-us-at-evercommerce-${jobs.evaluate.id}/?trk=public_jobs`,
        extractor: "site:linkedin",
        capturedAt: clock.now.toISOString(),
        extensionVersion: "0.2.0",
        fields: { title: "Customer Success Manager", company: `Company ${jobs.evaluate.id}`, location: "United States", description: "Customer Success Manager for a workflow SaaS platform." },
      },
      { ...pairing, tokenHint: "test" },
    );
    expect(modeA.result.opportunityId).toBe(item.opportunityId);
    expect(["UNCHANGED", "CHANGED"]).toContain(modeA.result.outcome);
    expect((await tableCounts()).opportunities).toBe(before.opportunities);

    // A new batch seeing the job again does not queue or read it again.
    navigated.splice(0);
    const again = await intake.capture(savedBatch([true, false, false, false, false]), pairing);
    expect(again.counts).toMatchObject({ queued: 0 });
    expect(await acquisition().runOnce()).toBeNull();
    expect(navigated).toEqual([]);
  });

  it("stops the site with nothing ingested when LinkedIn serves its anti-bot interstitial, even with HTTP 200", async () => {
    serve = () => ({ status: 200, html: '<html><head><meta http-equiv="refresh" content="0;url=/jobs"></head><body></body></html>' });
    const before = await tableCounts();
    await intake.capture(savedBatch([true, true, false, false, false]), pairing);
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ site: "linkedin", ingested: 0, stopped: "ACCESS_STOPPED" });
    expect(navigated).toHaveLength(1);
    const staged = await items();
    expect(staged.every((item) => item.opportunityId === null && item.status === "QUEUED")).toBe(true);
    expect(staged.every((item) => item.nextAttemptAt && item.nextAttemptAt.getTime() - clock.now.getTime() >= 24 * 60 * 60 * 1000)).toBe(true);
    expect(await tableCounts()).toEqual(before);
    // The stopped site is not contacted again before its backoff.
    navigated.splice(0);
    expect(await acquisition().runOnce()).toBeNull();
    expect(navigated).toEqual([]);
  });
});
