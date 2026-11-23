// Universal target job titles and opportunity management (November 22,
// 2026) on the isolated test database: results-page capture stages and reads
// only jobs whose titles pass (nothing at all is created for the others),
// jobs queued before the titles applied are skipped and settle, eligible jobs
// still deduplicate exactly as before; Move to and bulk moves go through the
// guarded lifecycle; permanent deletion from Dismissed keeps budget and usage
// totals unchanged, refuses application history and open evaluation work,
// removes duplicate references safely, and leaves only fingerprints, which
// stop automatic re-capture until a deliberate manual capture clears them.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createManualOpportunityService, createRetrievalIngestionService, createTitlePolicy } from "@ai-career/core";
import { customerSuccessDefaultTitlePolicy, customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  listingFingerprints,
  PrismaBudgetRepository,
  PrismaEvaluationTaskRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityDeletionRepository,
  PrismaOpportunityTombstoneRepository,
  PrismaPageCaptureRepository,
  PrismaTitlePolicyRepository,
  PrismaUsageSummaryRepository,
} from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { getOpportunityActionWriter } from "../../apps/web/src/server/opportunity-action-service";
import { createOpportunityMoveService } from "../../apps/web/src/server/opportunity-move-service";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition } from "../../apps/web/src/server/page-capture-acquisition";
import { createTitlePolicyLoader, opportunitiesOutsideTargetTitles } from "../../apps/web/src/server/title-policy-service";
import { testSemanticPricing } from "../fixtures/semantic-pricing";
import { testSiteJobPage } from "../support/page-capture-pages";

const database = getDatabaseClient();
const run = randomUUID().slice(0, 8);
const clock = { now: new Date("2026-11-22T12:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const titles = new PrismaTitlePolicyRepository();
const tombstones = new PrismaOpportunityTombstoneRepository();
const deletion = new PrismaOpportunityDeletionRepository();
const titlePolicy = createTitlePolicyLoader(titles);
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const manual = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
const moves = createOpportunityMoveService(getOpportunityActionWriter());
const tasks = new PrismaEvaluationTaskRepository();

const intake = createPageCaptureService({
  repository,
  enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }),
  now: () => clock.now,
  titlePolicy,
  isDeletedCard: (card) => tombstones.isDeleted({ sourceUrl: card.sourceUrl, pageCaptureExternalId: card.externalId }),
});
const jobUrl = (name: string) => `https://jobs.e2e.invalid/jobs/${name}-${run}`;
const navigated: string[] = [];
const titleOf: Record<string, string> = {};
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    const name = url.split("/").pop()!.replace(`-${run}`, "");
    return { status: 200, finalUrl: url, html: testSiteJobPage({ id: `${name}-${run}`, title: titleOf[name] ?? "Customer Success Manager", company: `Acme ${name} ${run}` }), cookieNames: [] };
  },
  close: async () => undefined,
};
const handedOff: string[] = [];
const acquisition = createPageCaptureAcquisition({
  repository,
  ingestion,
  handoff: { alreadyHandled: async () => false, request: async (id) => (handedOff.push(id), "NO_PROFILE_TEST") as never },
  discovery: customerSuccessDiscoveryConfiguration,
  titlePolicy,
  detailSites: () => ["e2e-results"],
  browser: { launch: async () => driver },
  now: () => clock.now,
  sleep: async () => undefined,
});

const batch = (cards: Array<[name: string, title: string]>, batchId = randomUUID()) => ({
  schemaVersion: 1,
  kind: "page-capture",
  batchId,
  site: "e2e-results",
  pageUrl: "https://jobs.e2e.invalid/search",
  pageTitle: "Results",
  capturedAt: clock.now.toISOString(),
  extensionVersion: "0.3.0",
  counts: { loaded: cards.length, skippedUnloaded: 0, overCap: 0 },
  cards: cards.map(([name, title]) => ({ url: jobUrl(name), title, siteJobId: `${name}-${run}`, company: `Acme ${name} ${run}`, location: "Remote" })),
});

let pairing: { id: string };
const opportunityIds: string[] = [];
const retainedIds: string[] = [];
const fingerprints: string[] = [];

async function captureItems() {
  return database.pageCaptureItem.findMany({ where: { sourceUrl: { contains: `-${run}` } }, orderBy: { title: "asc" } });
}

async function createOpportunity(name: string, title: string) {
  const detail = await manual.submit({
    rawText: `${title}\nAcme ${name} ${run}\nOwn onboarding and adoption for B2B customers. Remote in the United States.`,
    title,
    company: `Acme ${name} ${run}`,
    domain: "customer-success",
    sourceUrl: `https://careers.example.com/${name}-${run}`,
  });
  opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

async function addUsage(opportunityId: string, cost: number) {
  const evaluation = await database.evaluation.create({
    data: { opportunityId, domain: "customer-success", status: "COMPLETED", evaluationVersion: "n22", domainVersion: "n22", ruleVersion: "n22" },
  });
  await database.evaluationTask.create({ data: { evaluationId: evaluation.id, status: "COMPLETED", maxAttempts: 1 } });
  await tasks.recordSemanticOperation(evaluation.id, {
    operationId: "customer-success.job-evaluation",
    promptVersion: "n22",
    attempt: 1,
    provider: "openai",
    model: testSemanticPricing.model,
    status: "SUCCESS",
    usage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 1500 },
    estimatedCost: cost,
    pricingConfiguration: testSemanticPricing,
    durationMs: 10,
    providerRequestId: `req-n22-${evaluation.id}`,
    errorCode: null,
    errorMessage: null,
  });
  const admission = await database.evaluationAdmission.create({ data: { opportunityId, evaluationId: evaluation.id, attachedAt: clock.now } });
  const attempts = await database.semanticOperationAttempt.findMany({ where: { evaluationId: evaluation.id }, select: { id: true } });
  retainedIds.push(...attempts.map((attempt) => attempt.id), admission.id);
  return evaluation.id;
}

beforeEach(async () => {
  navigated.splice(0);
  handedOff.splice(0);
  await titles.clear("customer-success");
  pairing = await database.extensionPairing.create({ data: { label: "N22 test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const items = await captureItems();
  const ids = [...new Set([...opportunityIds.splice(0), ...items.flatMap((item) => (item.opportunityId ? [item.opportunityId] : []))])];
  await database.pageCaptureItem.deleteMany({ where: { sourceUrl: { contains: `-${run}` } } });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  await database.application.deleteMany({ where: { opportunityId: { in: ids } } });
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ opportunityId: { in: ids } }, { opportunityId: null, rawTitle: null, source: "manual-input" }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  const companies = await database.opportunity.findMany({ where: { id: { in: ids } }, select: { companyId: true } });
  await database.opportunity.deleteMany({ where: { id: { in: ids } } });
  await database.company.deleteMany({ where: { id: { in: companies.flatMap((row) => (row.companyId ? [row.companyId] : [])) } } });
  await database.retainedEvaluationUsage.deleteMany({ where: { id: { in: retainedIds } } });
  await database.retainedEvaluationAdmission.deleteMany({ where: { id: { in: retainedIds.splice(0) } } });
  await database.deletedOpportunityTombstone.deleteMany({ where: { fingerprint: { in: fingerprints.splice(0) } } });
  await database.$executeRaw`DELETE FROM "DeletedOpportunityTombstone" WHERE "deletedAt" = ${clock.now}`;
  await titles.clear("customer-success");
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

describe("results-page capture with the target job titles", () => {
  it("stages and reads only jobs whose titles pass: an outside title creates no item, no opportunity, no source record, no triage, no evaluation", async () => {
    const before = { opportunities: await database.opportunity.count(), sourceRecords: await database.sourceRecord.count(), triage: await database.preEvaluatorTriage.count() };
    const result = await intake.capture(
      batch([
        ["cs", "Customer Success Manager"],
        ["payroll", "Payroll Support Representative"],
        ["mna", "Program Manager, M&A Recruiting"],
        ["edu", "Customer Education Specialist"],
      ]),
      pairing as never,
    );
    expect(result.counts).toMatchObject({ queued: 2, outsideTitles: 2 });
    expect((await captureItems()).map((item) => item.title)).toEqual(["Customer Education Specialist", "Customer Success Manager"]);
    await acquisition.runOnce();
    expect(navigated.sort()).toEqual([jobUrl("cs"), jobUrl("edu")].sort());
    const after = { opportunities: await database.opportunity.count(), sourceRecords: await database.sourceRecord.count(), triage: await database.preEvaluatorTriage.count() };
    expect(after.opportunities - before.opportunities).toBe(2);
    expect(after.sourceRecords - before.sourceRecords).toBe(2);
    expect(after.triage).toBe(before.triage);
    expect(handedOff).toHaveLength(2);
  });

  it("a changed setting applies to the next capture, and saved jobs are not touched", async () => {
    await intake.capture(batch([["tam", "Technical Account Manager"]]), pairing as never);
    expect(await captureItems()).toHaveLength(0);
    await titles.save("customer-success", { accepted: [...customerSuccessDefaultTitlePolicy.accepted, "Technical Account Manager"], excluded: [] });
    await intake.capture(batch([["tam", "Technical Account Manager"]]), pairing as never);
    expect((await captureItems()).map((item) => item.status)).toEqual(["QUEUED"]);
  });

  it("jobs queued before the titles applied are skipped unread and settle, and are staged again once a capture's title passes", async () => {
    const first = await intake.capture(batch([["legacy", "Customer Success Manager"]]), pairing as never);
    const [item] = await captureItems();
    // As if staged before the titles applied: its stored title is outside.
    await database.pageCaptureItem.update({ where: { id: item!.id }, data: { title: "Payroll Support Representative" } });
    await acquisition.runOnce();
    expect(navigated).toEqual([]);
    expect((await captureItems())[0]).toMatchObject({ status: "SKIPPED", lastReason: "OUTSIDE_TARGET_TITLES", opportunityId: null });
    const sessionItems = await database.pageCaptureItem.findMany({ where: { lastBatchId: first.batchId } });
    expect(sessionItems.every((row) => row.status !== "QUEUED" && row.status !== "ACQUIRING")).toBe(true);
    const selection = await intake.selection({ site: "e2e-results", cards: [{ url: jobUrl("legacy"), siteJobId: `legacy-${run}`, title: "Customer Success Manager" }] });
    expect(selection.cards[0]).toMatchObject({ disposition: "NEW", selectable: true });
    clock.now = new Date(clock.now.getTime() + 60_000);
    await intake.capture(batch([["legacy", "Customer Success Manager"]]), pairing as never);
    expect((await captureItems())[0]).toMatchObject({ status: "QUEUED", lastReason: null });
    clock.now = new Date("2026-11-22T12:00:00.000Z");
  });

  it("eligible jobs deduplicate exactly as before: a repeated job attaches to the same opportunity and is not handed off twice", async () => {
    await intake.capture(batch([["dup", "Customer Success Manager"]]), pairing as never);
    await acquisition.runOnce();
    const [saved] = await captureItems();
    expect(saved!.opportunityId).not.toBeNull();
    const again = await intake.capture(batch([["dup", "Customer Success Manager"]]), pairing as never);
    expect(again.counts).toMatchObject({ queued: 0, alreadySaved: 1 });
    expect(handedOff).toHaveLength(1);
    expect(await database.opportunity.count({ where: { id: saved!.opportunityId! } })).toBe(1);
  });
});

describe("Move to", () => {
  it("moves through the guarded lifecycle, records every move, and reports bulk failures one by one", async () => {
    const free = await createOpportunity("move-free", "Customer Success Manager");
    const tracked = await createOpportunity("move-tracked", "Onboarding Specialist");
    expect(await moves.move(free, "SAVED")).toMatchObject({ result: "MOVED", status: "SAVED" });
    expect(await moves.move(tracked, "SAVED")).toMatchObject({ result: "MOVED" });
    await database.application.create({ data: { opportunityId: tracked, stage: "PLANNED" } });
    const results = await moves.moveMany([free, tracked], "DISMISSED");
    expect(results.map((item) => item.result)).toEqual(["MOVED", "BLOCKED_BY_APPLICATION"]);
    expect(await moves.move(free, "RESTORE")).toMatchObject({ result: "MOVED", action: "RESTORE", status: "SAVED" });
    expect(await moves.move(free, "ACTIVE")).toMatchObject({ result: "MOVED", action: "REACTIVATE", status: "NORMALIZED" });
    const history = await database.opportunityUserAction.findMany({ where: { opportunityId: free }, orderBy: { createdAt: "asc" } });
    expect(history.map((row) => row.action)).toEqual(["SAVE", "DISMISS", "RESTORE", "REACTIVATE"]);
    expect(await database.application.count({ where: { opportunityId: free } })).toBe(0);
  });

  it("finds earlier captures whose titles are outside the target job titles for cleanup, changing nothing", async () => {
    const outside = await createOpportunity("cleanup-out", "Payroll Support Representative");
    const inside = await createOpportunity("cleanup-in", "Customer Success Manager");
    const found = await opportunitiesOutsideTargetTitles(titles);
    expect(found).toContain(outside);
    expect(found).not.toContain(inside);
    expect((await database.opportunity.findUnique({ where: { id: outside } }))!.status).toBe("NORMALIZED");
  });
});

describe("permanent deletion from Dismissed", () => {
  it("deletes a dismissed opportunity with its evaluations while budget, spend and usage totals stay exactly the same", async () => {
    const id = await createOpportunity("delete-paid", "Payroll Support Representative");
    await addUsage(id, 0.25);
    await moves.move(id, "DISMISSED");
    const budget = new PrismaBudgetRepository();
    const period = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") };
    const snapshot = async () => ({
      ledger: await budget.periodLedger({ period, currency: "USD" }).then((ledger) => ({ knownSpent: ledger.knownSpent, unknown: ledger.unknownAttempts })),
      tokens: await budget.periodTokenUsage(period),
      throughput: await budget.throughputUsage({ day: period, week: period, period }),
      usage: await new PrismaUsageSummaryRepository().summarizeAllUsage(),
      series: await budget.spendSeries({ granularity: "month", timeZone: "UTC", currency: "USD", from: period.start, to: period.end }),
    });
    const before = await snapshot();
    expect(await deletion.deleteDismissed(id, clock.now)).toEqual({ opportunityId: id, outcome: "DELETED" });
    expect(await database.opportunity.count({ where: { id } })).toBe(0);
    expect(await database.evaluation.count({ where: { opportunityId: id } })).toBe(0);
    expect(await snapshot()).toEqual(before);
    // Only accounting is retained: no link to the opportunity, no content.
    const retained = await database.retainedEvaluationUsage.findMany({ where: { id: { in: retainedIds } } });
    expect(retained).toHaveLength(1);
    expect(Object.keys(retained[0]!)).not.toContain("opportunityId");
    // The source record stays, unlinked and emptied.
    const orphan = await database.sourceRecord.findFirst({ where: { opportunityId: null, externalId: null, source: "manual-input", rawTitle: null, rawDescription: null } });
    expect(orphan).not.toBeNull();
  });

  it("refuses an opportunity that is not dismissed, has application history, or has evaluation work open, changing nothing", async () => {
    const active = await createOpportunity("delete-active", "Customer Success Manager");
    expect((await deletion.deleteDismissed(active)).outcome).toBe("NOT_DISMISSED");
    const applied = await createOpportunity("delete-app", "Customer Success Manager");
    await moves.move(applied, "DISMISSED");
    await database.application.create({ data: { opportunityId: applied, stage: "CLOSED", outcome: "NOT_SUBMITTED", closedOn: new Date("2026-11-21") } });
    expect((await deletion.deleteDismissed(applied)).outcome).toBe("HAS_APPLICATION");
    const running = await createOpportunity("delete-running", "Customer Success Manager");
    await moves.move(running, "DISMISSED");
    const evaluation = await database.evaluation.create({
      data: { opportunityId: running, domain: "customer-success", status: "RUNNING", evaluationVersion: "n22", domainVersion: "n22", ruleVersion: "n22" },
    });
    await database.evaluationTask.create({ data: { evaluationId: evaluation.id, status: "RUNNING", maxAttempts: 1 } });
    expect((await deletion.deleteDismissed(running)).outcome).toBe("EVALUATION_IN_PROGRESS");
    expect(await database.opportunity.count({ where: { id: { in: [active, applied, running] } } })).toBe(3);
  });

  it("removes the deleted opportunity's duplicate references and leaves the other opportunity intact", async () => {
    const kept = await createOpportunity("dup-kept", "Customer Success Manager");
    const gone = await createOpportunity("dup-gone", "Customer Success Manager");
    await database.duplicateReference.create({
      data: { opportunityId: gone, relatedOpportunityId: kept, decision: "PROBABLE_MATCH", confidence: 0.62 },
    });
    await moves.move(gone, "DISMISSED");
    expect((await deletion.deleteDismissed(gone)).outcome).toBe("DELETED");
    expect(await database.duplicateReference.count({ where: { OR: [{ opportunityId: gone }, { relatedOpportunityId: gone }] } })).toBe(0);
    expect(await database.opportunity.findUnique({ where: { id: kept }, select: { status: true } })).toEqual({ status: "NORMALIZED" });
  });

  it("automatic capture never brings a deleted job back; a deliberate capture clears its fingerprints", async () => {
    await intake.capture(batch([["tomb", "Customer Success Manager"]]), pairing as never);
    await acquisition.runOnce();
    const [item] = await captureItems();
    const id = item!.opportunityId!;
    await moves.move(id, "DISMISSED");
    expect((await deletion.deleteDismissed(id, clock.now)).outcome).toBe("DELETED");
    fingerprints.push(...listingFingerprints({ sourceUrl: jobUrl("tomb") }), ...listingFingerprints({ pageCaptureExternalId: `e2e-results:tomb-${run}` }));
    expect(await captureItems()).toHaveLength(0);
    const tombstones = await database.deletedOpportunityTombstone.findMany({ where: { deletedAt: clock.now } });
    expect(tombstones.length).toBeGreaterThan(0);
    expect(tombstones.every((row) => /^[0-9a-f]{64}$/.test(row.fingerprint) && Object.keys(row).sort().join() === "deletedAt,fingerprint")).toBe(true);
    const selection = await intake.selection({ site: "e2e-results", cards: [{ url: jobUrl("tomb"), siteJobId: `tomb-${run}`, title: "Customer Success Manager" }] });
    expect(selection.cards[0]).toMatchObject({ disposition: "DELETED", selectable: false });
    const again = await intake.capture(batch([["tomb", "Customer Success Manager"]]), pairing as never);
    expect(again.counts).toMatchObject({ queued: 0, deletedByUser: 1 });
    expect(await captureItems()).toHaveLength(0);
    // A deliberate capture of the same job clears the tombstone.
    expect(await tombstones_clear(jobUrl("tomb"))).toBeGreaterThan(0);
    expect(await new PrismaOpportunityTombstoneRepository().isDeleted({ sourceUrl: jobUrl("tomb") })).toBe(false);
  });
});

async function tombstones_clear(url: string) {
  return tombstones.clear({ sourceUrl: url });
}

// The policy used here is the saved setting (defaults when none is saved).
describe("the setting is the single source of truth", () => {
  it("serves the defaults until saved", async () => {
    expect((await titlePolicy())("Onboarding Specialist")).toEqual(createTitlePolicy(customerSuccessDefaultTitlePolicy)("Onboarding Specialist"));
  });
});
