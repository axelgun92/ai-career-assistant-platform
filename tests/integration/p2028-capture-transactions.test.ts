// P2028 fixes F1–F3 (approved November 9, 2026) against the real database
// (the isolated test database only): a statement that really stalls inside
// the capture transaction, the capture lock really held by another session,
// and a capture whose commit really happened but whose reply was lost. The
// Mode B worker's pass runs with the real repository, ingestion and
// diagnostics; a fixture browser serves the pages. Nothing here touches a
// site, the evaluator, a profile or a paid call.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { PrismaManualOpportunityRepository, PrismaPageCaptureRepository } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, pageCaptureIngestRetryWaitMs, type EvaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { createWorkerDiagnostics } from "../../apps/web/src/server/worker-diagnostics";
import { createCleanup, database } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";

const cleanup = createCleanup();
const now = new Date("2026-11-09T21:00:00.000Z");
const repository = new PrismaPageCaptureRepository();
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => now });

const run = randomUUID().slice(0, 8);
const names = ["neighbour", "target"] as const;
type Name = (typeof names)[number];
const jobId = (name: Name) => `${name}-${run}`;
const jobUrl = (name: Name) => `https://jobs.e2e.invalid/jobs/${jobId(name)}`;
const nameOf = (externalId: string) => names.find((name) => externalId.endsWith(`/${jobId(name)}`)) ?? null;

const p2028 = () =>
  Object.assign(
    new Error(
      "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 30000 ms, however 30412 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.",
    ),
    { name: "PrismaClientKnownRequestError", code: "P2028" },
  );

// Another session holding a lock inside its own transaction until released.
function holdLock(statement: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => (acquired = resolve));
  const done = database.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(statement);
      acquired();
      await released;
    },
    { maxWait: 5_000, timeout: 120_000 },
  );
  return { ready: Promise.race([ready, done.then(() => Promise.reject(new Error("the holder ended before taking its lock")))]), release, done };
}

// The real capture repository. Its client can be made to lose the reply of
// one committed transaction: the transaction really commits, then the call
// fails with Prisma's P2028 (a commit whose outcome the worker cannot know).
const captureRepository = new PrismaManualOpportunityRepository();
const realClient = (captureRepository as unknown as { database: typeof database }).database;
let loseNextCommitReply = false;
(captureRepository as unknown as { database: unknown }).database = new Proxy(realClient, {
  get(target, property) {
    if (property === "$transaction") {
      return async (...args: unknown[]) => {
        const value = await (target.$transaction as (...input: unknown[]) => Promise<unknown>).apply(target, args);
        if (loseNextCommitReply) {
          loseNextCommitReply = false;
          throw p2028();
        }
        return value;
      };
    }
    return Reflect.get(target, property, target);
  },
});
// What happens just before the target's capture transaction, on its first
// attempt only.
let beforeTargetCapture: (() => Promise<void> | void) | null = null;
let targetCaptures = 0;
const ingestion = createRetrievalIngestionService({
  repository: Object.assign(Object.create(captureRepository) as PrismaManualOpportunityRepository, {
    async ingestRetrievedListing(input: Parameters<PrismaManualOpportunityRepository["ingestRetrievedListing"]>[0]) {
      if (nameOf(String(input.rawOpportunity.externalId ?? "")) === "target") {
        targetCaptures += 1;
        if (targetCaptures === 1 && beforeTargetCapture) await beforeTargetCapture();
      }
      return captureRepository.ingestRetrievedListing(input);
    },
  }),
  normalizer: createRetrievedOpportunityNormalizer(),
});
const handoffs: string[] = [];
const handoff: EvaluationHandoff = {
  alreadyHandled: async () => false,
  request: async (opportunityId) => {
    handoffs.push(opportunityId);
    return "NO_ACTIVE_PROFILE";
  },
};
const driver: BrowserDriver = {
  async navigate(url) {
    const name = names.find((candidate) => url === jobUrl(candidate))!;
    const html = testSiteJobPage({
      id: jobId(name),
      company: `P2028 ${name} ${run}`,
      description: ["Customer Success Manager for a security operations platform.", "Own onboarding, adoption and renewals for enterprise customers.", `Reference ${name}.`].map((line) => `<p>${line}</p>`).join(""),
    });
    return { status: 200, finalUrl: url, html, cookieNames: [] };
  },
  close: async () => undefined,
};

const folders: string[] = [];
let sleeps: number[] = [];
let onRetryWait: (() => Promise<void>) | null = null;
function worker() {
  const folder = mkdtempSync(path.join(os.tmpdir(), "aija-p2028-"));
  folders.push(folder);
  const diagnostics = createWorkerDiagnostics({ directory: folder, now: () => now });
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion,
    handoff,
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => ["e2e-results"],
    browser: { launch: async () => driver },
    probeCapture: () => captureRepository.probeCaptureLock(),
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (ms === pageCaptureIngestRetryWaitMs && onRetryWait) await onRetryWait();
    },
    log: { info: () => undefined, warn: () => undefined },
    diagnostics,
  });
  const events = () =>
    readFileSync(diagnostics.file!, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown> & { event: string; itemId?: string });
  return { acquisition, events };
}

type Timing = { transaction: string; stepsMs: Record<string, number>; inFlight: string | null; inFlightMs: number | null; bodyEnded: boolean; outcome: string | null; totalMs: number | null; statementTimeoutMs: number | null };

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
const externalIds: string[] = [];
async function saveBatch() {
  const result = await intake.capture(
    {
      schemaVersion: 1,
      kind: "page-capture",
      batchId: randomUUID(),
      site: "e2e-results",
      pageUrl: "https://jobs.e2e.invalid/search?keywords=customer+success",
      pageTitle: "Customer success jobs",
      capturedAt: now.toISOString(),
      extensionVersion: "0.3.0",
      counts: { loaded: 2, skippedUnloaded: 0, overCap: 0 },
      cards: names.map((name) => ({ url: jobUrl(name), title: `Customer Success Manager ${jobId(name)}`, siteJobId: jobId(name), company: `P2028 ${name} ${run}`, location: "United States" })),
    },
    pairing,
  );
  expect(result.outcomes).toHaveLength(2);
  // The neighbour is read first.
  for (const [index, name] of names.entries()) {
    const item = await database.pageCaptureItem.update({ where: { externalId: (await itemOf(name)).externalId }, data: { firstSeenAt: new Date(now.getTime() + index * 1_000) } });
    externalIds.push(item.externalId);
  }
}
const itemOf = async (name: Name) => (await database.pageCaptureItem.findFirst({ where: { sourceUrl: jobUrl(name) } }))!;
const recordsOf = (name: Name) => database.sourceRecord.findMany({ where: { externalId: { endsWith: `/${jobId(name)}` } }, select: { id: true, opportunityId: true } });

let defaultStatementTimeout = "";
beforeAll(async () => {
  [{ reset_val: defaultStatementTimeout }] = await database.$queryRaw<Array<{ reset_val: string }>>`SELECT reset_val FROM pg_settings WHERE name = 'statement_timeout'`;
});

beforeEach(async () => {
  await cleanup.before();
  handoffs.splice(0);
  sleeps = [];
  onRetryWait = null;
  beforeTargetCapture = null;
  targetCaptures = 0;
  loseNextCommitReply = false;
  pairing = await database.extensionPairing.create({ data: { label: "P2028 capture transactions", tokenHash: randomUUID(), tokenHint: "test" } });
  await saveBatch();
});

afterEach(async () => {
  const items = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set([...items.map((item) => item.opportunityId).filter((id): id is string => Boolean(id)), ...cleanup.opportunityIds])];
  const ids = externalIds.splice(0);
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: ids } } });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { OR: [{ opportunityId: { in: opportunityIds } }, { externalId: { in: ids } }], laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

afterAll(() => database.$disconnect());

describe("a statement that stalls inside the capture transaction (F2 + F3, real database)", () => {
  it("fails alone with SQLSTATE 57014 after 10 s, not as a P2028; is retried once after the stall clears and saved once; both attempts' timings are recorded; the timeout does not outlive the transaction", { timeout: 90_000 }, async () => {
    // Another session takes the Opportunity table for longer than the
    // statement limit, just as the target's capture transaction starts; it
    // lets go during the retry's wait.
    let holder: ReturnType<typeof holdLock> | null = null;
    beforeTargetCapture = async () => {
      holder = holdLock('LOCK TABLE "Opportunity" IN ACCESS EXCLUSIVE MODE');
      await holder.ready;
    };
    onRetryWait = async () => {
      holder!.release();
      await holder!.done;
    };
    const { acquisition, events } = worker();
    const started = Date.now();
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 2 });
    expect(Date.now() - started).toBeLessThan(25_000);

    const [neighbour, target] = [await itemOf("neighbour"), await itemOf("target")];
    expect(target).toMatchObject({ status: "INGESTED", attempts: neighbour.attempts, lastReason: null });
    const records = await recordsOf("target");
    expect(records).toHaveLength(1);
    expect(records[0]!.opportunityId).toBe(target.opportunityId);
    expect(handoffs.filter((id) => id === target.opportunityId)).toHaveLength(1);
    expect(sleeps.filter((ms) => ms === pageCaptureIngestRetryWaitMs)).toHaveLength(1);

    const log = events();
    const retry = log.find((event) => event.event === "job.retry")!;
    expect(retry).toMatchObject({ itemId: target.id, failure: "TRANSIENT", decision: "RETRY_ONCE", error: { sqlState: "57014", cancelReason: "statement-timeout", statementTimeoutMs: "10000", transaction: "ingestRetrievedListing" } });
    expect((retry.error as Record<string, unknown>).prismaCode).not.toBe("P2028");
    const [first] = retry.transactions as Timing[];
    expect(first).toMatchObject({ transaction: "ingestRetrievedListing", outcome: "rolled-back", bodyEnded: false, statementTimeoutMs: 10_000 });
    expect(first!.inFlight).toEqual(expect.any(String));
    expect(["connect-begin", "capture-lock", "statement-timeout"]).not.toContain(first!.inFlight);
    expect(first!.inFlightMs).toBeGreaterThanOrEqual(9_000);
    expect(Object.keys(first!.stepsMs).slice(0, 3)).toEqual(["connect-begin", "capture-lock", "statement-timeout"]);
    const ingested = log.find((event) => event.event === "job.ingested" && event.itemId === target.id)!;
    expect(ingested).toMatchObject({ retried: true, firstAttemptCommit: "ROLLED_BACK", outcome: "CREATED" });
    expect((ingested.transactions as Timing[])[0]).toMatchObject({ transaction: "ingestRetrievedListing", outcome: "committed", inFlight: null });
    expect((ingested.transactions as Timing[])[0]!.stepsMs).toHaveProperty("commit");
    expect(ingested.firstAttemptTransactions).toEqual(retry.transactions);
    for (const field of ["eventLoopMaxMs", "eventLoopP99Ms", "rssMb", "heapUsedMb"]) expect(ingested).toHaveProperty(field);
    // The neighbour's ordinary success carries its timings too.
    expect((log.find((event) => event.event === "job.ingested" && event.itemId === neighbour.id)!.transactions as Timing[])[0]).toMatchObject({ outcome: "committed", statementTimeoutMs: 10_000 });

    // set_config(…, true) ended with each transaction: no pooled connection keeps it.
    const settings = await Promise.all(Array.from({ length: 8 }, () => database.$queryRaw<Array<{ value: string }>>`SELECT current_setting('statement_timeout') AS value`));
    expect(new Set(settings.map(([row]) => row!.value))).toEqual(new Set([defaultStatementTimeout === "0" ? "0" : defaultStatementTimeout]));
  });
});

describe("the capture lock held by another session (F2 keeps contention as it was)", () => {
  it("waits 20 s for the lock, fails as contention (55P03), never as a statement timeout, and is not retried: the job waits uncounted and the pass ends", { timeout: 90_000 }, async () => {
    let holder: ReturnType<typeof holdLock> | null = null;
    beforeTargetCapture = async () => {
      holder = holdLock("SELECT pg_advisory_xact_lock(hashtext('ai-career:opportunity-capture'))");
      await holder.ready;
    };
    const { acquisition, events } = worker();
    try {
      const pass = await acquisition.runOnce();
      expect(pass).toMatchObject({ ingested: 1, stopped: "CAPTURE_BUSY" });
    } finally {
      holder?.release();
      await holder?.done;
    }
    const target = await itemOf("target");
    expect(target).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "CAPTURE_BUSY" });
    expect(await recordsOf("target")).toHaveLength(0);
    const log = events();
    expect(log.some((event) => event.event === "job.retry")).toBe(false);
    expect(sleeps).not.toContain(pageCaptureIngestRetryWaitMs);
    const failed = log.find((event) => event.event === "job.failed" && event.itemId === target.id)!;
    expect(failed).toMatchObject({ failure: "CONTENTION", decision: "CAPTURE_BUSY_REQUEUED_UNCOUNTED", error: { sqlState: "55P03" } });
    const [timing] = failed.transactions as Timing[];
    // The lock wait is the lock's own (lock_timeout, 20 s); the statement limit was never set.
    expect(timing).toMatchObject({ transaction: "ingestRetrievedListing", outcome: "rolled-back", inFlight: "capture-lock", statementTimeoutMs: null });
    expect(timing!.inFlightMs).toBeGreaterThanOrEqual(19_000);
  });
});

describe("a capture that committed but whose reply was lost (requirement 2)", () => {
  it("is retried; the retry finds the same posting UNCHANGED and the database proves the first attempt committed: one source record, one opportunity, one hand-off", { timeout: 60_000 }, async () => {
    beforeTargetCapture = () => {
      loseNextCommitReply = true;
    };
    const { acquisition, events } = worker();
    const pass = await acquisition.runOnce();
    expect(pass).toMatchObject({ ingested: 2 });
    const target = await itemOf("target");
    expect(target.status).toBe("INGESTED");
    const records = await recordsOf("target");
    expect(records).toHaveLength(1);
    expect(records[0]!.opportunityId).toBe(target.opportunityId);
    expect(await database.opportunity.count({ where: { id: target.opportunityId! } })).toBe(1);
    expect(handoffs.filter((id) => id === target.opportunityId)).toHaveLength(1);

    const log = events();
    const retry = log.find((event) => event.event === "job.retry")!;
    expect(retry).toMatchObject({ itemId: target.id, error: { prismaCode: "P2028", transaction: "ingestRetrievedListing" } });
    expect((retry.transactions as Timing[])[0]).toMatchObject({ outcome: "unknown", bodyEnded: true, inFlight: null });
    const ingested = log.find((event) => event.event === "job.ingested" && event.itemId === target.id)!;
    expect(ingested).toMatchObject({
      outcome: "UNCHANGED",
      retried: true,
      firstAttemptCommit: "FIRST_ATTEMPT_COMMITTED",
      commitVerification: { sameListing: true, recordsWithThisContent: 1, opportunitiesForListing: 1, recordLinkedToOpportunity: true, recordWrittenDuringFirstAttempt: true, recordWrittenBeforeFirstAttempt: false },
    });
  });
});
