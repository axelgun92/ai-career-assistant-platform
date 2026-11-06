// Workstream B, Mode B live-round fixes (November 5–6, 2026) on the isolated
// test database: the capture lock under contention, the acquisition pass
// under job-specific and database-wide failures (provisional DB_PENDING
// accounting, crash and interrupted-job recovery), selective re-observation
// of saved jobs (no second hand-off, unstated facts kept, explicit
// withdrawal only), LinkedIn listing-fallback precedence and Captured Jobs
// location hydration. A fixture browser serves every page; no third-party
// request, no evaluator and no profile are involved (the hand-off is a
// counter).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion, type RetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaExtensionLookupRepository, PrismaManualOpportunityRepository, PrismaPageCaptureRepository } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, pageCaptureRetryAfterMs, type EvaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { capturedJobView } from "../../apps/web/src/server/page-capture-progress";
import { classifyJobDatabaseFailure } from "../../apps/web/src/server/worker-errors";
import { createCleanup, database } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-06T12:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const captureRepository = new PrismaManualOpportunityRepository();
const realIngestion = createRetrievalIngestionService({ repository: captureRepository, normalizer: createRetrievedOpportunityNormalizer() });
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => clock.now });

// Failures injected into the real ingestion by call number (the pass reads
// its claimed jobs in queue order, which is not the page order), with the
// external ID each call carried.
const injected = new Map<number, Error>();
const ingestCalls: string[] = [];
const ingestion: RetrievalIngestionService = {
  ...realIngestion,
  async ingest(raw) {
    ingestCalls.push(String((raw as { externalId?: string | null }).externalId ?? ""));
    const failure = injected.get(ingestCalls.length);
    if (failure) throw failure;
    return realIngestion.ingest(raw);
  },
};
// The staged job a given ingestion call read.
const itemOfCall = async (call: number) => (await database.pageCaptureItem.findFirst({ where: { externalId: ingestCalls[call - 1]! } }))!;
const handoffs: string[] = [];
const handoff: EvaluationHandoff = {
  alreadyHandled: async () => false,
  request: async (opportunityId) => {
    handoffs.push(opportunityId);
    return "NO_ACTIVE_PROFILE";
  },
};

const run = randomUUID().slice(0, 8);
const jobId = (name: string) => `${name}-${run}`;
const jobUrl = (name: string) => `https://jobs.e2e.invalid/jobs/${jobId(name)}`;
const pages = new Map<string, { status: number; html: string }>();
const serve = (name: string, description: string, options: { remote?: boolean } = {}) =>
  pages.set(jobUrl(name), { status: 200, html: testSiteJobPage({ id: jobId(name), company: `Mode B ${name} ${run}`, description, ...options }) });
const navigated: string[] = [];
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    const served = pages.get(url) ?? { status: 404, html: "<html><body>Not found</body></html>" };
    return { status: served.status, finalUrl: url, html: served.html, cookieNames: [] };
  },
  close: async () => undefined,
};
const acquisition = () =>
  createPageCaptureAcquisition({
    repository,
    ingestion,
    handoff,
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => ["e2e-results"],
    browser: { launch: async () => driver },
    probeCapture: () => captureRepository.probeCaptureLock(),
    now: () => clock.now,
    sleep: async () => undefined,
  });

const transientError = () =>
  Object.assign(
    new Error("Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 30000 ms, however 30500 ms passed since the start of the transaction."),
    { name: "PrismaClientKnownRequestError", code: "P2028" },
  );

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
const externalIds: string[] = [];

const batch = (names: string[], options: { location?: string | null } = {}) => ({
  schemaVersion: 1,
  kind: "page-capture",
  batchId: randomUUID(),
  site: "e2e-results",
  pageUrl: "https://jobs.e2e.invalid/search",
  pageTitle: "Results",
  capturedAt: clock.now.toISOString(),
  extensionVersion: "0.3.0",
  counts: { loaded: names.length, skippedUnloaded: 0, overCap: 0 },
  cards: names.map((name) => ({
    url: jobUrl(name),
    title: `Customer Success Manager ${jobId(name)}`,
    siteJobId: jobId(name),
    company: `Mode B ${name} ${run}`,
    location: options.location === undefined ? "Remote" : options.location,
  })),
});

async function stage(names: string[], options: { location?: string | null } = {}) {
  const result = await intake.capture(batch(names, options), pairing);
  for (const outcome of result.outcomes) {
    const item = await database.pageCaptureItem.findFirst({ where: { sourceUrl: outcome.url }, select: { externalId: true } });
    if (item && !externalIds.includes(item.externalId)) externalIds.push(item.externalId);
  }
  return result;
}
const itemOf = async (name: string) => (await database.pageCaptureItem.findFirst({ where: { sourceUrl: jobUrl(name) } }))!;
const description = (lines: string[]) => lines.map((line) => `<p>${line}</p>`).join("");
const baseLines = [
  "Customer Success Manager for a workflow SaaS platform.",
  "Own onboarding, adoption, education, and retention for a portfolio of B2B customers.",
  "Run quarterly business reviews and partner with Sales on renewals.",
];

beforeEach(async () => {
  await cleanup.before();
  navigated.splice(0);
  handoffs.splice(0);
  injected.clear();
  ingestCalls.splice(0);
  pages.clear();
  pairing = await database.extensionPairing.create({ data: { label: "Mode B fixes", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const items = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set([...items.map((item) => item.opportunityId).filter((id): id is string => Boolean(id)), ...cleanup.opportunityIds])];
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: externalIds.splice(0) } } });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

afterAll(() => database.$disconnect());

describe("the capture lock and the acquisition pass under database failures", () => {
  it("reports a busy capture lock as contention (55P03), not as an unhealthy database", { timeout: 60_000 }, async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = database.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-career:opportunity-capture'))`;
        held();
        await released;
      },
      { maxWait: 5_000, timeout: 50_000 },
    );
    await holding;
    const started = Date.now();
    const probe = await captureRepository.probeCaptureLock().then(
      () => null,
      (error: unknown) => error,
    );
    release();
    await holder;
    expect(probe).not.toBeNull();
    expect(classifyJobDatabaseFailure(probe)).toBe("CONTENTION");
    expect((probe as { captureTransaction?: string }).captureTransaction).toBe("probeCaptureLock");
    // It waited for the lock (lock_timeout) inside the transaction's timeout.
    expect(Date.now() - started).toBeGreaterThanOrEqual(15_000);
    // Once the lock is free, the same probe succeeds.
    await expect(captureRepository.probeCaptureLock()).resolves.toBeUndefined();
  });

  it("counts a job-specific transient failure once and ingests the other 24 of a 25-job batch", { timeout: 120_000 }, async () => {
    const names = Array.from({ length: 25 }, (_, index) => `job${String(index + 1).padStart(2, "0")}`);
    for (const name of names) serve(name, description([...baseLines, `Reference ${name}.`]));
    await stage(names);
    injected.set(6, transientError());
    const before = await database.opportunity.count();
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ claimed: 25, ingested: 24, stopped: null });
    expect(await itemOfCall(6)).toMatchObject({ status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR", nextAttemptAt: new Date(clock.now.getTime() + pageCaptureRetryAfterMs) });
    expect(await database.opportunity.count()).toBe(before + 24);
    expect(handoffs).toHaveLength(24);
  });

  it("counts nothing when the database fails for two jobs in a row, then completes on the next pass with no duplicate", { timeout: 120_000 }, async () => {
    const names = ["a1", "a2", "a3", "a4", "a5", "a6"];
    for (const name of names) serve(name, description([...baseLines, `Reference ${name}.`]));
    await stage(names);
    injected.set(3, transientError());
    injected.set(4, transientError());
    const before = await database.opportunity.count();
    const worker = acquisition();
    const pass = await worker.runOnce();
    expect(pass).toMatchObject({ claimed: 6, ingested: 2, stopped: "DATABASE_UNAVAILABLE" });
    const failed = [await itemOfCall(3), await itemOfCall(4)];
    for (const item of failed) expect(item, item.externalId).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING", nextAttemptAt: null });
    // The two the pass never read are queued again, uncounted.
    const unread = (await Promise.all(names.map(itemOf))).filter((item) => !ingestCalls.includes(item.externalId));
    expect(unread).toHaveLength(2);
    for (const item of unread) expect(item, item.externalId).toMatchObject({ status: "QUEUED", attempts: 0 });
    // The database is back: the next pass reads the four, counting nothing extra.
    const resumed = await worker.runOnce();
    expect(resumed).toMatchObject({ claimed: 4, ingested: 4, stopped: null });
    for (const name of names) expect(await itemOf(name), name).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(await database.opportunity.count()).toBe(before + 6);
    expect(new Set(handoffs).size).toBe(6);
    expect(handoffs).toHaveLength(6);
  });

  it("leaves a provisional failure uncounted across a crash, and the interrupted-job recovery completes the batch once", { timeout: 120_000 }, async () => {
    const names = ["c1", "c2", "c3"];
    for (const name of names) serve(name, description([...baseLines, `Reference ${name}.`]));
    await stage(names);
    injected.set(1, transientError());
    injected.set(2, new TypeError("worker crashed"));
    await expect(acquisition().runOnce()).rejects.toThrow("worker crashed");
    const pending = await itemOfCall(1);
    expect(pending).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    // A hard crash leaves claimed jobs ACQUIRING; a fresh worker recovers them.
    const unread = (await Promise.all(names.map(itemOf))).find((item) => !ingestCalls.includes(item.externalId))!;
    await database.pageCaptureItem.update({ where: { id: unread.id }, data: { status: "ACQUIRING" } });
    expect(await repository.recoverInterrupted()).toBeGreaterThanOrEqual(1);
    expect(await database.pageCaptureItem.findUniqueOrThrow({ where: { id: unread.id } })).toMatchObject({ status: "QUEUED", attempts: 0 });
    const before = await database.opportunity.count();
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ ingested: 3 });
    for (const name of names) expect(await itemOf(name), name).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(await database.opportunity.count()).toBe(before + 3);
    // A finalization repeated after the job succeeded changes nothing.
    expect(await repository.finalizeProvisionalFailure(pending.id, { now: clock.now, retryAfterMs: pageCaptureRetryAfterMs, maxAttempts: 3 })).toBe(false);
    expect(handoffs).toHaveLength(3);
  });
});

describe("selective re-observation of saved jobs", () => {
  async function saveAsNov4(name: string, lines: string[]) {
    serve(name, description(lines));
    await stage([name]);
    await acquisition().runOnce();
    const item = await itemOf(name);
    // A record read before the reader revision existed (the Nov 4–5 rounds).
    await database.$executeRaw`
      UPDATE "SourceRecord" SET "sourceMetadata" = jsonb_set("sourceMetadata", '{capture}', ("sourceMetadata"->'capture') - 'readerRevision')
      WHERE "opportunityId" = ${item.opportunityId}::uuid AND "source" = 'browser-extension'`;
    return item;
  }

  it("re-reads an outdated record onto the same job, keeps unstated facts, withdraws only on an explicit statement, and hands nothing off again", { timeout: 120_000 }, async () => {
    const saved = await saveAsNov4("refresh", [...baseLines, "Base salary $70,000-$80,000 USD per year.", "Applications close on December 20, 2026."]);
    const opportunityBefore = await database.opportunity.findUniqueOrThrow({ where: { id: saved.opportunityId! } });
    expect(Number(opportunityBefore.salaryMin)).toBe(70_000);
    expect(opportunityBefore.closingDate).not.toBeNull();
    expect(handoffs).toEqual([saved.opportunityId]);

    // The page now omits the salary and states there is no deadline.
    serve("refresh", description([...baseLines, "There is no application deadline for this role."]));
    clock.now = new Date(clock.now.getTime() + 3_600_000);
    const staged = await stage(["refresh"]);
    expect(staged.counts).toMatchObject({ refreshing: 1, queued: 0, alreadySaved: 0 });
    expect(staged.outcomes[0]).toMatchObject({ outcome: "REFRESHING", opportunityId: saved.opportunityId });
    expect(await itemOf("refresh")).toMatchObject({ status: "QUEUED", lastReason: "REFRESH:0", opportunityId: saved.opportunityId });

    const opportunities = await database.opportunity.count();
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ claimed: 1, ingested: 1 });
    const refreshed = await itemOf("refresh");
    expect(refreshed.status).toBe("INGESTED");
    expect(refreshed.opportunityId).toBe(saved.opportunityId);
    expect(refreshed.lastReason).toMatch(/^REFRESHED:CHANGED:\d$/);
    expect(await database.opportunity.count()).toBe(opportunities);
    expect(handoffs).toEqual([saved.opportunityId]);
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: saved.opportunityId! } });
    // Unstated: kept, with its provenance.
    expect(Number(after.salaryMin)).toBe(70_000);
    expect(Number(after.salaryMax)).toBe(80_000);
    // Explicitly withdrawn: cleared, with the statement as provenance.
    expect(after.closingDate).toBeNull();
    const withdrawal = await database.fieldProvenance.findFirst({ where: { opportunityId: saved.opportunityId!, sourceField: "explicit-withdrawal:closingDate", supersededAt: null } });
    expect(withdrawal?.sourceText ?? "").toMatch(/no application deadline/i);

    // The same page again: current reader, just read; nothing is read.
    navigated.splice(0);
    const repeat = await stage(["refresh"]);
    expect(repeat.counts).toMatchObject({ refreshing: 0, alreadySaved: 1 });
    expect(await acquisition().runOnce()).toBeNull();
    expect(navigated).toEqual([]);
  });

  it("restores a saved job untouched when its refresh finds the listing gone, and never refreshes a dismissed job", { timeout: 120_000 }, async () => {
    const gone = await saveAsNov4("gone", [...baseLines, "Base salary $90,000-$100,000 USD per year."]);
    const before = await database.opportunity.findUniqueOrThrow({ where: { id: gone.opportunityId! } });
    pages.delete(jobUrl("gone"));
    await stage(["gone"]);
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ unavailable: 1 });
    expect(await itemOf("gone")).toMatchObject({ status: "INGESTED", opportunityId: gone.opportunityId, lastReason: "REFRESH_UNAVAILABLE:0" });
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: gone.opportunityId! } });
    expect({ salaryMin: String(after.salaryMin), title: after.title, updatedAt: after.updatedAt }).toEqual({ salaryMin: String(before.salaryMin), title: before.title, updatedAt: before.updatedAt });

    const dismissed = await saveAsNov4("dismissed", baseLines);
    await database.pageCaptureItem.update({ where: { id: dismissed.id }, data: { status: "DISMISSED" } });
    const again = await stage(["dismissed"]);
    expect(again.counts.refreshing).toBe(0);
    expect(await itemOf("dismissed")).toMatchObject({ status: "DISMISSED" });
  });
});

describe("display and application links", () => {
  it("shows the saved job's location on Captured Jobs when the card stated none", { timeout: 60_000 }, async () => {
    serve("located", description(baseLines), { remote: false });
    await stage(["located"], { location: null });
    await acquisition().runOnce();
    const item = await itemOf("located");
    expect(item.location).toBeNull();
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: item.opportunityId! } });
    expect(opportunity.location).toMatch(/Paris/);
    const { rows } = await repository.capturedJobs({ method: "batch", statuses: null, site: "e2e-results", itemIds: [item.id], page: 1, pageSize: 10 });
    expect(rows[0]).toMatchObject({ location: null, opportunityLocation: opportunity.location });
    expect(capturedJobView(rows[0]!).location).toBe(opportunity.location);
  });

  it("keeps a LinkedIn listing fallback only until an employer link is read, and never lets the fallback replace it", { timeout: 60_000 }, async () => {
    const linkedInId = String(4_390_000_000 + Math.floor(Math.random() * 1_000_000));
    const pageUrl = `https://www.linkedin.com/jobs/view/${linkedInId}/`;
    const single = createExtensionCaptureService({
      ingestion: realIngestion,
      lookup: new PrismaExtensionLookupRepository(),
      latestEvaluation: async () => null,
      discovery: customerSuccessDiscoveryConfiguration,
      now: () => clock.now,
    });
    const capture = (applicationUrl: string | null, extra: string) =>
      single.capture(
        {
          schemaVersion: extensionCaptureSchemaVersion,
          pageUrl,
          extractor: "site:linkedin",
          capturedAt: clock.now.toISOString(),
          extensionVersion: "0.3.0",
          fields: {
            title: "Customer Success Manager",
            company: `Fallback ${run}`,
            description: [...baseLines, extra].join("\n\n"),
            applicationUrl,
          },
        },
        { ...pairing, tokenHint: "test" },
      );
    const first = await capture(null, "First read.");
    cleanup.opportunityIds.push(first.result.opportunityId);
    const link = async () => (await database.opportunity.findUniqueOrThrow({ where: { id: first.result.opportunityId }, select: { applicationUrl: true } })).applicationUrl;
    expect(await link()).toBe(`https://www.linkedin.com/jobs/view/${linkedInId}`);

    const employer = `https://boards.greenhouse.io/fallback${run}/jobs/123456`;
    const second = await capture(employer, "Second read.");
    expect(second.result.opportunityId).toBe(first.result.opportunityId);
    expect(await link()).toBe(employer);

    const third = await capture(null, "Third read.");
    expect(third.result.opportunityId).toBe(first.result.opportunityId);
    expect(await link()).toBe(employer);
  });
});
