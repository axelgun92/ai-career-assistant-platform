// Workstream B, E4-independent completion (November 6, 2026) on the test
// database: a saved job read again (refresh) under database failures, site
// restrictions and every refresh ending; a job saved before a later step
// failed; restrictions that must survive even when every stopped job is a
// refresh; mixed new and refresh batches within the 25-card cap; saved-job
// fields in capture history and the side panel; the capture transactions'
// settings and query counts; and the retrieval worker lock after its
// connection dies. A fixture browser serves every page; no third-party
// request, no evaluator, no profile (the hand-off is a counter).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createRetrievalIngestionService, pageCaptureMaxCards, type RetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaManualOpportunityRepository, PrismaPageCaptureRepository, RetrievalWorkerLock } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { statusText } from "../../apps/web/src/components/extension/page-capture-labels";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, type EvaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { capturedJobView, extensionCaptureSession } from "../../apps/web/src/server/page-capture-progress";
import { createCleanup, database } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-06T12:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const captureRepository = new PrismaManualOpportunityRepository();
const realIngestion = createRetrievalIngestionService({ repository: captureRepository, normalizer: createRetrievedOpportunityNormalizer() });
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => clock.now });

// Failures injected into the real ingestion by job name, consumed in order.
const injected = new Map<string, Error[]>();
const ingestCalls: string[] = [];
const ingestion: RetrievalIngestionService = {
  ...realIngestion,
  async ingest(raw) {
    const externalId = String((raw as { externalId?: string | null }).externalId ?? "");
    ingestCalls.push(externalId);
    const name = [...injected.keys()].find((key) => externalId.endsWith(`/${key}-${run}`));
    const failure = name ? injected.get(name)!.shift() : undefined;
    if (failure) throw failure;
    return realIngestion.ingest(raw);
  },
};
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
const lines = (name: string, extra: string[] = []) =>
  ["Customer Success Manager for a workflow SaaS platform.", "Own onboarding, adoption and renewals for B2B customers.", `Reference ${name}.`, ...extra]
    .map((line) => `<p>${line}</p>`)
    .join("");
const serve = (name: string, extra: string[] = [], options: { remote?: boolean; status?: number } = {}) =>
  pages.set(jobUrl(name), {
    status: options.status ?? 200,
    html: testSiteJobPage({ id: jobId(name), company: `Refresh ${name} ${run}`, description: lines(name, extra), ...(options.remote === undefined ? {} : { remote: options.remote }) }),
  });
const navigated: string[] = [];
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    const served = pages.get(url) ?? { status: 404, html: "<html><body>Not found</body></html>" };
    return { status: served.status, finalUrl: url, html: served.html, cookieNames: [] };
  },
  close: async () => undefined,
};
type Repository = PrismaPageCaptureRepository;
const acquisition = (repo: Repository = repository) =>
  createPageCaptureAcquisition({
    repository: repo,
    ingestion,
    handoff,
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => ["e2e-results"],
    browser: { launch: async () => driver },
    probeCapture: () => captureRepository.probeCaptureLock(),
    now: () => clock.now,
    sleep: async () => undefined,
  });
// The real repository with one method failing the given number of times
// (for one staged item when itemId is given).
function flaky(method: "markIngested" | "markHandedOff", times: number, error: () => Error, itemId?: string): Repository {
  const wrapped = Object.create(repository) as Repository;
  let left = times;
  const original = repository[method].bind(repository) as (...args: unknown[]) => Promise<unknown>;
  (wrapped as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
    if (left > 0 && (!itemId || args[0] === itemId)) {
      left -= 1;
      throw error();
    }
    return original(...args);
  };
  return wrapped;
}
const transientError = () =>
  Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), { name: "PrismaClientKnownRequestError", code: "P2028" });

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
    company: `Refresh ${name} ${run}`,
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
const later = (minutes: number) => (clock.now = new Date(clock.now.getTime() + minutes * 60_000));
// Saved jobs as the November 4–5 rounds left them: read before the reader
// revision existed, so the next save of their page reads them again (R1).
async function savedAsNov4(names: string[], options: { location?: string | null } = {}) {
  for (const name of names) serve(name);
  await stage(names, options);
  await acquisition().runOnce();
  const items = await Promise.all(names.map(itemOf));
  for (const item of items) {
    expect(item.status, item.externalId).toBe("INGESTED");
    await database.$executeRaw`
      UPDATE "SourceRecord" SET "sourceMetadata" = jsonb_set("sourceMetadata", '{capture}', ("sourceMetadata"->'capture') - 'readerRevision')
      WHERE "opportunityId" = ${item.opportunityId}::uuid AND "source" = 'browser-extension'`;
  }
  later(60);
  return items;
}

beforeEach(async () => {
  await cleanup.before();
  navigated.splice(0);
  handoffs.splice(0);
  injected.clear();
  ingestCalls.splice(0);
  pages.clear();
  pairing = await database.extensionPairing.create({ data: { label: "Refresh recovery", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  const items = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set([...items.map((item) => item.opportunityId).filter((id): id is string => Boolean(id)), ...cleanup.opportunityIds])];
  const orphans = await database.opportunity.findMany({ where: { company: { name: { contains: run } } }, select: { id: true } });
  for (const orphan of orphans) if (!opportunityIds.includes(orphan.id)) opportunityIds.push(orphan.id);
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
  vi.restoreAllMocks();
});

afterAll(() => database.$disconnect());

describe("a refresh under database failures", () => {
  it("a transient failure proven the refresh's own ends that refresh with the saved job untouched; nothing counted, nothing handed off", { timeout: 60_000 }, async () => {
    const [saved] = await savedAsNov4(["rt"]);
    const before = await database.opportunity.findUniqueOrThrow({ where: { id: saved!.opportunityId! } });
    serve("rt", ["Now hiring for two teams."]);
    serve("rt-new");
    const staged = await stage(["rt", "rt-new"]);
    expect(staged.counts).toMatchObject({ refreshing: 1, queued: 1 });
    injected.set("rt", [transientError()]);
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ claimed: 2, ingested: 1, stopped: null });
    expect(await itemOf("rt")).toMatchObject({ status: "INGESTED", attempts: 0, lastReason: "REFRESH_FAILED:0", opportunityId: saved!.opportunityId });
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: saved!.opportunityId! } });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.jobDescription).toBe(before.jobDescription);
    expect(handoffs).toHaveLength(2); // rt's first save and rt-new; never the refresh
  });

  it("a refresh caught in a database outage stays a refresh, uncounted, and the next pass reads it onto the same job", { timeout: 60_000 }, async () => {
    const [saved] = await savedAsNov4(["ro"]);
    serve("ro", ["Now hiring for two teams."]);
    serve("ro-new");
    await stage(["ro", "ro-new"]);
    injected.set("ro", [transientError()]);
    injected.set("ro-new", [transientError()]);
    const worker = acquisition();
    expect((await worker.runOnce())?.stopped).toBe("DATABASE_UNAVAILABLE");
    expect(await itemOf("ro")).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "REFRESH:0", opportunityId: saved!.opportunityId });
    expect(await itemOf("ro-new")).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    const opportunities = await database.opportunity.count();
    await worker.runOnce();
    expect(await itemOf("ro")).toMatchObject({ status: "INGESTED", lastReason: "REFRESHED:CHANGED:1", opportunityId: saved!.opportunityId });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: saved!.opportunityId! } })).jobDescription).toContain("two teams");
    expect(await itemOf("ro-new")).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(await database.opportunity.count()).toBe(opportunities + 1);
    expect(handoffs.filter((id) => id === saved!.opportunityId)).toHaveLength(1);
  });
});

describe("a job saved before a later step failed", () => {
  it("its item could not be marked: never charged; read again onto the same job with no new source record; handed off once", { timeout: 60_000 }, async () => {
    serve("pm1");
    serve("pm2");
    await stage(["pm1", "pm2"]);
    const pass = await acquisition(flaky("markIngested", 1, transientError, (await itemOf("pm1")).id)).runOnce();
    expect(pass).toMatchObject({ claimed: 2, ingested: 2, stopped: null });
    const pending = await itemOf("pm1");
    expect(pending).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "SAVED_UNMARKED", opportunityId: null });
    const saved = await database.opportunity.findFirstOrThrow({ where: { company: { name: `Refresh pm1 ${run}` } } });
    const records = await database.sourceRecord.count({ where: { opportunityId: saved.id } });
    expect(records).toBe(1);
    expect(handoffs).toHaveLength(1); // pm2

    const opportunities = await database.opportunity.count();
    await acquisition().runOnce();
    expect(await itemOf("pm1")).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null, opportunityId: saved.id });
    expect(await database.opportunity.count()).toBe(opportunities);
    expect(await database.sourceRecord.count({ where: { opportunityId: saved.id } })).toBe(records);
    expect(handoffs.filter((id) => id === saved.id)).toHaveLength(1);
  });

  it("its hand-off could not be recorded: it stays added and is not read again", { timeout: 60_000 }, async () => {
    serve("ph");
    await stage(["ph"]);
    expect(await acquisition(flaky("markHandedOff", 2, transientError)).runOnce()).toMatchObject({ ingested: 1, stopped: null });
    const item = await itemOf("ph");
    expect(item).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(handoffs).toEqual([item.opportunityId]);
    navigated.splice(0);
    expect(await acquisition().runOnce()).toBeNull();
    expect(navigated).toEqual([]);
  });
});

describe("site restrictions and refresh endings", () => {
  it("a save while the site is stopped queues no refresh; after the stop ends the same save reads the job again", { timeout: 60_000 }, async () => {
    const [saved] = await savedAsNov4(["ss"]);
    serve("ss-blocker");
    await stage(["ss-blocker"]);
    await repository.deferSite("e2e-results", new Date(clock.now.getTime() + 24 * 3_600_000), "ACCESS_STOPPED");
    later(60);
    const during = await stage(["ss"]);
    expect(during.counts).toMatchObject({ refreshing: 0, alreadySaved: 1 });
    expect(await itemOf("ss")).toMatchObject({ status: "INGESTED", lastReason: null, opportunityId: saved!.opportunityId });
    expect(await acquisition().runOnce()).toBeNull();
    later(24 * 60);
    const afterStop = await stage(["ss"]);
    expect(afterStop.counts).toMatchObject({ refreshing: 1 });
  });

  it("a restriction met while every queued job is a refresh still stops the site; the refreshes are restored untouched", { timeout: 60_000 }, async () => {
    const saved = await savedAsNov4(["rd1", "rd2"]);
    // Whichever is read first meets the restriction.
    serve("rd1", [], { status: 429 });
    serve("rd2", [], { status: 429 });
    await stage(["rd1", "rd2"]);
    const pass = await acquisition().runOnce();
    expect(pass?.stopped).toBe("RATE_LIMITED");
    for (const [index, name] of ["rd1", "rd2"].entries()) {
      expect(await itemOf(name), name).toMatchObject({ status: "INGESTED", lastReason: "REFRESH_DEFERRED:0", opportunityId: saved[index]!.opportunityId });
    }
    const stoppedUntil = await repository.siteStoppedUntil("e2e-results", clock.now);
    expect(stoppedUntil!.getTime() - clock.now.getTime()).toBeGreaterThanOrEqual(24 * 3_600_000);
    // Another save during the stop reads nothing and queues no refresh.
    later(5);
    const during = await stage(["rd1", "rd2"]);
    expect(during.counts).toMatchObject({ refreshing: 0 });
    navigated.splice(0);
    expect(await acquisition().runOnce()).toBeNull();
    expect(navigated).toEqual([]);
  });

  it("a failed load is no restriction: refreshes wait with the rest, still refreshes; an unreadable refresh ends REFRESH_FAILED; a stopped one REFRESH_STOPPED", { timeout: 60_000 }, async () => {
    const saved = await savedAsNov4(["fl1", "fl2", "fl3"]);
    // Both fail to load; the pass ends at whichever it opens first.
    for (const name of ["fl1", "fl2"]) pages.set(jobUrl(name), { status: 503, html: "<html><body>Unavailable</body></html>" });
    await stage(["fl1", "fl2"]);
    navigated.splice(0);
    const pass = await acquisition().runOnce();
    expect(pass?.stopped).toBe("SERVER_ERROR");
    const [opened, waiting] = navigated[0] === jobUrl("fl1") ? (["fl1", "fl2"] as const) : (["fl2", "fl1"] as const);
    const savedOf = (name: string) => saved[name === "fl1" ? 0 : 1]!.opportunityId;
    expect(await itemOf(opened)).toMatchObject({ status: "INGESTED", lastReason: "REFRESH_FAILED:0", opportunityId: savedOf(opened) });
    const queued = await itemOf(waiting);
    expect(queued).toMatchObject({ status: "QUEUED", lastReason: "REFRESH:0", opportunityId: savedOf(waiting) });
    expect(queued.nextAttemptAt!.getTime()).toBeGreaterThan(clock.now.getTime());
    expect(await repository.siteStoppedUntil("e2e-results", clock.now)).toBeNull();
    serve(waiting);

    pages.set(jobUrl("fl3"), { status: 200, html: "<html><body><p>Nothing to read here.</p></body></html>" });
    later(61);
    await stage(["fl3"]);
    await acquisition().runOnce();
    expect(await itemOf("fl3")).toMatchObject({ status: "INGESTED", lastReason: "REFRESH_FAILED:0" });
    expect(await itemOf(waiting)).toMatchObject({ status: "INGESTED", lastReason: expect.stringMatching(/^REFRESHED:/) });

    // A refresh the user stops (background-tab reading) is restored as it was.
    await database.pageCaptureItem.update({ where: { id: (await itemOf(waiting)).id }, data: { status: "QUEUED", lastReason: "REFRESH:1" } });
    expect(await repository.stopTabItems("e2e-results", [(await itemOf(waiting)).id], "BATCH_STOPPED")).toBe(1);
    expect(await itemOf(waiting)).toMatchObject({ status: "INGESTED", lastReason: "REFRESH_STOPPED:1", opportunityId: savedOf(waiting) });
  });

  it("dates a gone listing's refresh with the time its page was opened", { timeout: 60_000 }, async () => {
    await savedAsNov4(["gone"]);
    pages.delete(jobUrl("gone"));
    await stage(["gone"]);
    await acquisition().runOnce();
    const item = await itemOf("gone");
    expect(item).toMatchObject({ status: "INGESTED", lastReason: "REFRESH_UNAVAILABLE:0" });
    const { rows } = await repository.capturedJobs({ method: "batch", statuses: null, site: "e2e-results", itemIds: [item.id], page: 1, pageSize: 5 });
    expect(statusText(capturedJobView(rows[0]!))).toContain(`Read again on ${item.lastAttemptAt!.toISOString().slice(0, 10)}: the listing was no longer available`);
  });
});

describe("batches, history and the side panel", () => {
  it("a save of 25 cards mixing 10 saved jobs to read again and 15 new ones reads all 25 in one pass, hands off only the new ones", { timeout: 120_000 }, async () => {
    const savedNames = Array.from({ length: 10 }, (_, index) => `mx-saved-${index}`);
    const newNames = Array.from({ length: 15 }, (_, index) => `mx-new-${index}`);
    await savedAsNov4(savedNames);
    handoffs.splice(0);
    for (const name of newNames) serve(name);
    const staged = await stage([...savedNames, ...newNames]);
    expect(savedNames.length + newNames.length).toBe(pageCaptureMaxCards);
    expect(staged.counts).toMatchObject({ refreshing: 10, queued: 15, alreadySaved: 0 });
    const pass = await acquisition().runOnce();
    expect(pass).toMatchObject({ claimed: 25, ingested: 25, stopped: null });
    expect(handoffs).toHaveLength(15);
    // The same page again: nothing read, nothing queued.
    later(5);
    const repeat = await stage([...savedNames, ...newNames]);
    expect(repeat.counts).toMatchObject({ refreshing: 0, queued: 0, alreadySaved: 25 });
  });

  it("times each read by when it was read, not when the card was first seen: a job first seen 20 days ago and just read again is not read on the next save", { timeout: 60_000 }, async () => {
    const [saved] = await savedAsNov4(["age"]);
    later(20 * 24 * 60);
    // R1 (outdated reader) reads it once, UNCHANGED; then neither R1 nor R3.
    expect((await stage(["age"])).counts).toMatchObject({ refreshing: 1 });
    await acquisition().runOnce();
    expect(await itemOf("age")).toMatchObject({ status: "INGESTED", lastReason: expect.stringMatching(/^REFRESHED:UNCHANGED:/), opportunityId: saved!.opportunityId });
    later(5);
    expect((await stage(["age"])).counts).toMatchObject({ refreshing: 0, alreadySaved: 1 });
    // (Later saves follow R2/R3 from this read's time; this fixture page has
    // no apply link, so R2 would read it again after a day, at most 3 times.)
  });

  it("capture history and the side panel show each saved job's own company and location", { timeout: 60_000 }, async () => {
    serve("hy", [], { remote: false });
    const staged = await stage(["hy"], { location: null });
    await acquisition().runOnce();
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: (await itemOf("hy")).opportunityId! }, include: { company: true } });
    const panel = await extensionCaptureSession(staged.sessionId!, repository, () => clock.now);
    expect(panel?.jobs[0]).toMatchObject({ company: opportunity.company!.name, location: opportunity.location });
    expect(opportunity.location).toMatch(/Paris/);
  });
});

describe("capture transactions and the worker lock", () => {
  it("every capture-lock transaction uses the same options, and staging reads a constant number of times whatever the batch size", { timeout: 60_000 }, async () => {
    const options: Array<unknown> = [];
    let reads = 0;
    const original = database.$transaction.bind(database) as (...args: unknown[]) => Promise<unknown>;
    const countReads = (client: Record<string, unknown>) =>
      new Proxy(client, {
        get(target, property) {
          const value = target[property as string];
          if (property === "$queryRaw" || property === "$queryRawUnsafe") {
            return (...args: unknown[]) => ((reads += 1), (value as (...a: unknown[]) => unknown).apply(target, args));
          }
          if (value && typeof value === "object" && "findMany" in (value as object)) {
            return new Proxy(value as Record<string, unknown>, {
              get(model, name) {
                const method = model[name as string];
                if (typeof method !== "function") return method;
                return (...args: unknown[]) => {
                  if (/^find|^count|^aggregate/.test(String(name))) reads += 1;
                  return (method as (...a: unknown[]) => unknown).apply(model, args);
                };
              },
            });
          }
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    vi.spyOn(database, "$transaction").mockImplementation(((work: unknown, settings?: unknown) => {
      options.push(settings);
      if (typeof work !== "function") return original(work, settings);
      return original((transaction: Record<string, unknown>) => (work as (t: unknown) => unknown)(countReads(transaction)), settings);
    }) as never);

    const small = Array.from({ length: 5 }, (_, index) => `qs-${index}`);
    await stage(small);
    const smallReads = reads;
    reads = 0;
    const large = Array.from({ length: 25 }, (_, index) => `ql-${index}`);
    await stage(large);
    expect(reads).toBe(smallReads);
    serve("tx");
    await stage(["tx"]);
    await acquisition().runOnce();
    await captureRepository.probeCaptureLock();
    const capture = options.filter((value) => value && typeof value === "object" && "timeout" in (value as object));
    expect(capture.length).toBeGreaterThanOrEqual(4);
    for (const value of capture) expect(value).toEqual({ maxWait: 15_000, timeout: 30_000 });
  });

  it("the retrieval worker lock is free again when its holder's connection dies", { timeout: 60_000 }, async () => {
    const connectionString = process.env.DATABASE_URL!;
    const first = new RetrievalWorkerLock(connectionString);
    const second = new RetrievalWorkerLock(connectionString);
    try {
      expect(await first.acquire()).toBe(true);
      expect(await second.acquire()).toBe(false);
      // The holder's process dies: PostgreSQL ends its session.
      await database.$executeRaw`
        SELECT pg_terminate_backend(l.pid) FROM pg_locks l
        WHERE l.locktype = 'advisory' AND l.granted AND l.classid = 41220 AND l.objid = 4 AND l.objsubid = 2`;
      await vi.waitFor(() => expect(first.isHeld()).toBe(false), { timeout: 5_000 });
      expect(await second.acquire()).toBe(true);
    } finally {
      await first.release();
      await second.release();
    }
  });
});
