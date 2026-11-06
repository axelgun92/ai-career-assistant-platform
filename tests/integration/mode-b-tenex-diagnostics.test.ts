// Mode B Rev 3 acceptance, offline (November 6, 2026), on the isolated test
// database: the November 5 LinkedIn batch as the E4/E4b evidence left it —
// 25 jobs read in claim order, five ingested, the sixth (TENEX.AI, LinkedIn
// 4372638963) failing with a Prisma P2028 whose transaction was never
// recorded, 19 more behind it. Here the P2028 is simulated at each place it
// could have come from (the job's capture transaction, the preservation of an
// unnormalized listing, the staging of the batch), as a failure of that job
// alone and as a database-wide outage, across a worker restart; and each run
// leaves the persistent diagnostics, the opt-in page evidence and a read-only
// failure evidence package that would have identified it. A fixture browser
// serves every page; no site, evaluator, profile or paid call is involved.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRetrievalIngestionService, pageReaderRevision, type RetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { createReadOnlyDatabaseClient, PrismaManualOpportunityRepository, PrismaPageCaptureRepository, readOnlyTransaction } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { assembleDiagnosticsPackage } from "../../apps/web/src/server/diagnostics-package";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, pageCaptureRetryAfterMs, type EvaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { createPageCaptureEvidence } from "../../apps/web/src/server/page-capture-evidence";
import { createWorkerDiagnostics, type WorkerDiagnostics } from "../../apps/web/src/server/worker-diagnostics";
import { createCleanup, database } from "../support/budget-integration";
import { testSiteJobPage } from "../support/page-capture-pages";

const cleanup = createCleanup();
const clock = { now: new Date("2026-11-05T21:40:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const captureRepository = new PrismaManualOpportunityRepository();
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["e2e-results"], details: ["e2e-results"] }), now: () => clock.now });

const run = randomUUID().slice(0, 8);
const tenexListing = "4372638963";
// The batch in claim order: five, then TENEX.AI, then nineteen.
const names = Array.from({ length: 25 }, (_, index) => (index === 5 ? `tenex-${tenexListing}` : `job${String(index + 1).padStart(2, "0")}`));
const tenex = names[5]!;
const jobId = (name: string) => `${name}-${run}`;
const jobUrl = (name: string) => `https://jobs.e2e.invalid/jobs/${jobId(name)}`;
const company = (name: string) => (name === tenex ? `TENEX.AI ${run}` : `Mode B ${name} ${run}`);

const p2028 = () =>
  Object.assign(
    new Error(
      "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 30000 ms, however 30412 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.",
    ),
    { name: "PrismaClientKnownRequestError", code: "P2028" },
  );

// The real ingestion, with failures injected by job name: thrown by the
// capture transaction itself (named as the repository names it) or by the
// normalizer (so the listing is preserved unnormalized).
const failIngest = new Map<string, number>();
const failNormalize = new Set<string>();
const failPreserve = new Map<string, number>();
const nameOf = (externalId: string) => names.find((name) => externalId.endsWith(`/${jobId(name)}`)) ?? "";
const normalizer = createRetrievedOpportunityNormalizer();
const captureWithFailures = Object.create(captureRepository) as PrismaManualOpportunityRepository;
captureWithFailures.ingestRetrievedListing = async (input) => {
  const name = nameOf(String(input.rawOpportunity.externalId ?? ""));
  if ((failIngest.get(name) ?? 0) > 0) {
    failIngest.set(name, failIngest.get(name)! - 1);
    throw Object.assign(p2028(), { captureTransaction: "ingestRetrievedListing" });
  }
  return captureRepository.ingestRetrievedListing(input);
};
captureWithFailures.preserveUnnormalizedListing = async (raw) => {
  const name = nameOf(String(raw.externalId ?? ""));
  if ((failPreserve.get(name) ?? 0) > 0) {
    failPreserve.set(name, failPreserve.get(name)! - 1);
    throw Object.assign(p2028(), { captureTransaction: "preserveUnnormalizedListing" });
  }
  return captureRepository.preserveUnnormalizedListing(raw);
};
const ingestion: RetrievalIngestionService = createRetrievalIngestionService({
  repository: captureWithFailures,
  normalizer: {
    async normalize(raw) {
      if (failNormalize.has(nameOf(String(raw.externalId ?? "")))) throw new Error("normalization failed for this job");
      return normalizer.normalize(raw);
    },
  },
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
    const name = names.find((candidate) => url === jobUrl(candidate));
    if (!name) return { status: 404, finalUrl: url, html: "<html><body>Not found</body></html>", cookieNames: [] };
    const html = testSiteJobPage({
      id: jobId(name),
      company: company(name),
      description: ["Customer Success Manager for a security operations platform.", "Own onboarding, adoption and renewals for enterprise customers.", `Reference ${name}.`].map((line) => `<p>${line}</p>`).join(""),
    });
    return { status: 200, finalUrl: url, html, servedHtml: html, cookieNames: [] };
  },
  close: async () => undefined,
};

const folders: string[] = [];
const temporary = () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "aija-tenex-"));
  folders.push(folder);
  return folder;
};
// One worker process: its own diagnostics session and evidence folder.
function worker(roots: { diagnostics: string; evidence: string }) {
  const diagnostics = createWorkerDiagnostics({ directory: roots.diagnostics, now: () => clock.now });
  const evidence = createPageCaptureEvidence({ directory: roots.evidence, sessionId: diagnostics.sessionId, now: () => clock.now });
  const acquisition = createPageCaptureAcquisition({
    repository,
    ingestion,
    handoff,
    discovery: customerSuccessDiscoveryConfiguration,
    detailSites: () => ["e2e-results"],
    browser: { launch: async () => driver },
    probeCapture: () => captureRepository.probeCaptureLock(),
    now: () => clock.now,
    sleep: async () => undefined,
    diagnostics,
    evidence,
  });
  return { acquisition, diagnostics, evidence };
}
const eventsOf = (diagnostics: WorkerDiagnostics) =>
  readFileSync(diagnostics.file!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown> & { event: string; session: string });

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
let batchId = "";
const externalIds: string[] = [];
// Saves the 25 cards in one batch, ordered as the November 5 claim order
// (first seen, then id) so TENEX.AI is the sixth job read.
async function saveBatch() {
  batchId = randomUUID();
  const result = await intake.capture(
    {
      schemaVersion: 1,
      kind: "page-capture",
      batchId,
      site: "e2e-results",
      pageUrl: "https://jobs.e2e.invalid/search?keywords=customer+success",
      pageTitle: "Customer success jobs",
      capturedAt: clock.now.toISOString(),
      extensionVersion: "0.3.0",
      counts: { loaded: 25, skippedUnloaded: 0, overCap: 0 },
      cards: names.map((name) => ({ url: jobUrl(name), title: `Customer Success Manager ${jobId(name)}`, siteJobId: jobId(name), company: company(name), location: "United States" })),
    },
    pairing,
  );
  expect(result.outcomes).toHaveLength(25);
  for (const [index, name] of names.entries()) {
    const item = await database.pageCaptureItem.update({ where: { externalId: (await itemOf(name)).externalId }, data: { firstSeenAt: new Date(clock.now.getTime() + index * 1_000) } });
    externalIds.push(item.externalId);
  }
}
const itemOf = async (name: string) => (await database.pageCaptureItem.findFirst({ where: { sourceUrl: jobUrl(name) } }))!;
const later = (minutes: number) => (clock.now = new Date(clock.now.getTime() + minutes * 60_000));

beforeEach(async () => {
  await cleanup.before();
  clock.now = new Date("2026-11-05T21:40:00.000Z");
  handoffs.splice(0);
  failIngest.clear();
  failNormalize.clear();
  failPreserve.clear();
  pairing = await database.extensionPairing.create({ data: { label: "TENEX diagnostics", tokenHash: randomUUID(), tokenHint: "test" } });
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
  vi.restoreAllMocks();
});

afterAll(() => database.$disconnect());

const testDatabaseUrl = () => process.env.DATABASE_URL!;
async function evidencePackage(roots: { diagnostics: string; evidence: string }) {
  const out = path.join(temporary(), "package");
  const database = decodeURIComponent(new URL(testDatabaseUrl()).pathname.slice(1));
  const client = createReadOnlyDatabaseClient(testDatabaseUrl());
  try {
    const result = await assembleDiagnosticsPackage(
      {
        connectionString: testDatabaseUrl(),
        database,
        databaseLabel: `${database} (test)`,
        captureSession: batchId,
        site: null,
        out,
        logsDirectory: roots.diagnostics,
        evidenceDirectory: roots.evidence,
        windowMinutes: 24 * 60,
      },
      { read: (reads) => readOnlyTransaction(client, reads) },
      { gitSha: "0".repeat(40), gitBranch: "test", pageReaderRevision, environmentNames: ["DATABASE_URL"], now: () => new Date(clock.now.getTime() + 60_000) },
    );
    const read = <T>(file: string) => JSON.parse(readFileSync(path.join(out, file), "utf8")) as T;
    return { out, manifest: result.manifest as { files: Record<string, { present: boolean; count?: number }> }, read };
  } finally {
    await client.$disconnect();
  }
}

describe("the November 5 batch: TENEX.AI (4372638963) sixth, a simulated P2028", () => {
  it("localized to TENEX.AI's capture transaction: 5 + 19 ingested, TENEX counted once; the diagnostics, page evidence and package name it", { timeout: 180_000 }, async () => {
    const roots = { diagnostics: temporary(), evidence: temporary() };
    await saveBatch();
    failIngest.set(tenex, 1);
    const before = await database.opportunity.count();
    const first = worker(roots);
    const pass = await first.acquisition.runOnce();
    expect(pass).toMatchObject({ claimed: 25, ingested: 24, stopped: null });
    expect(await itemOf(tenex)).toMatchObject({ status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR", nextAttemptAt: new Date(clock.now.getTime() + pageCaptureRetryAfterMs), opportunityId: null });
    expect(await database.opportunity.count()).toBe(before + 24);
    expect(await database.sourceRecord.count({ where: { externalId: (await itemOf(tenex)).externalId } })).toBe(0);
    expect(handoffs).toHaveLength(24);

    // The diagnostics file: TENEX.AI is the sixth job claimed, and its failure
    // names the stage, the transaction, Prisma's fixed P2028 form and timing,
    // and the decision; the seventh job's success counts it once.
    const events = eventsOf(first.diagnostics);
    const tenexItem = await itemOf(tenex);
    const start = events.find((event) => event.event === "pass.start")!;
    expect((start.jobs as Array<{ itemId: string }>)[5]!.itemId).toBe(tenexItem.id);
    expect(events.find((event) => event.event === "job.failed")).toMatchObject({
      itemId: tenexItem.id,
      batchId,
      stage: "ingest",
      failure: "TRANSIENT",
      decision: "DB_PENDING_PROVISIONAL",
      error: { prismaCode: "P2028", transactionError: "expired", timeoutMs: "30000", elapsedMs: "30412", transaction: "ingestRetrievedListing" },
      transactionSettings: { maxWait: 15_000, timeout: 30_000, lockTimeoutMs: 20_000 },
    });
    expect(events.find((event) => event.event === "job.decision" && event.itemId === tenexItem.id)).toMatchObject({ decision: "PROVISIONAL_FAILURE_COUNTED" });
    expect(events.filter((event) => event.event === "job.ingested")).toHaveLength(24);

    // The opt-in page evidence: the page as read for every job, TENEX included.
    const evidence = readdirSync(first.evidence.directory!);
    expect(evidence.filter((file) => file.endsWith(".json"))).toHaveLength(25);
    expect(evidence).toContain(`${tenexItem.id}.rendered.html`);
    expect(statSync(path.join(first.evidence.directory!, `${tenexItem.id}.json`)).mode & 0o777).toBe(0o600);

    // The failure evidence package, read-only from the test database.
    const assembled = await evidencePackage(roots);
    expect(statSync(assembled.out).mode & 0o777).toBe(0o700);
    expect(assembled.manifest.files).toMatchObject({
      "capture-session.json": { present: true },
      "capture-items.json": { present: true, count: 25 },
      "opportunities.json": { present: true, count: 24 },
      "worker-log.jsonl": { present: true },
      "page-evidence/": { present: true, count: 75 },
      "timeline.json": { present: true },
    });
    const items = assembled.read<Array<Record<string, unknown>>>("capture-items.json");
    expect(items[5]).toMatchObject({ id: tenexItem.id, status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR", opportunityId: null });
    const records = assembled.read<Array<Record<string, unknown>>>("source-records.json");
    expect(records.filter((record) => record.externalId === tenexItem.externalId)).toEqual([]);
    expect(records.every((record) => record.linkedToCapturedJob === true)).toBe(true);
    const timeline = assembled.read<Array<{ source: string; what: string; itemId?: string }>>("timeline.json");
    expect(timeline.some((entry) => entry.source === "worker" && entry.what === "job.failed" && entry.itemId === tenexItem.id)).toBe(true);
    expect(timeline.some((entry) => entry.source === "database" && entry.what === "job last attempted" && entry.itemId === tenexItem.id)).toBe(true);

    // Its retry an hour later completes, counted once, no duplicate.
    later(61);
    const retry = await first.acquisition.runOnce();
    expect(retry).toMatchObject({ claimed: 1, ingested: 1 });
    expect(await itemOf(tenex)).toMatchObject({ status: "INGESTED", lastReason: null });
    expect(await database.opportunity.count()).toBe(before + 25);
    expect(new Set(handoffs).size).toBe(25);
  });

  it("a database-wide outage at TENEX.AI: nothing counted, the pass ends with 18 unread queued again; after a restart the 20 complete, no duplicate", { timeout: 180_000 }, async () => {
    const roots = { diagnostics: temporary(), evidence: temporary() };
    await saveBatch();
    failIngest.set(tenex, 1);
    failIngest.set(names[6]!, 1);
    const before = await database.opportunity.count();
    const first = worker(roots);
    expect(await first.acquisition.runOnce()).toMatchObject({ claimed: 25, ingested: 5, stopped: "DATABASE_UNAVAILABLE" });
    for (const name of [tenex, names[6]!]) expect(await itemOf(name), name).toMatchObject({ status: "QUEUED", attempts: 0, lastReason: "DB_PENDING" });
    for (const name of names.slice(7)) expect(await itemOf(name), name).toMatchObject({ status: "QUEUED", attempts: 0 });
    const firstEvents = eventsOf(first.diagnostics);
    expect(firstEvents.filter((event) => event.event === "job.failed").map((event) => event.decision)).toEqual(["DB_PENDING_PROVISIONAL", "DB_PENDING_SECOND_IN_A_ROW_OUTAGE"]);
    expect(firstEvents.find((event) => event.event === "pass.decision")).toMatchObject({ decision: "DATABASE_UNAVAILABLE", unreadJobsQueuedAgain: 18 });

    // The worker is killed and restarted: a new diagnostics session, recovery first.
    const restarted = worker(roots);
    expect(restarted.diagnostics.sessionId).not.toBe(first.diagnostics.sessionId);
    expect(await restarted.acquisition.runOnce()).toMatchObject({ claimed: 20, ingested: 20, stopped: null });
    for (const name of names) expect(await itemOf(name), name).toMatchObject({ status: "INGESTED", attempts: 1, lastReason: null });
    expect(await database.opportunity.count()).toBe(before + 25);
    expect(handoffs).toHaveLength(25);
    const restartEvents = eventsOf(restarted.diagnostics).filter((event) => event.session === restarted.diagnostics.sessionId);
    expect(restartEvents[0]).toMatchObject({ event: "recovery" });
    // Both sessions are in the package's worker log.
    const assembled = await evidencePackage(roots);
    const log = readFileSync(path.join(assembled.out, "worker-log.jsonl"), "utf8");
    expect(log).toContain(first.diagnostics.sessionId);
    expect(log).toContain(restarted.diagnostics.sessionId);
  });

  it("a P2028 while preserving TENEX.AI's unnormalized listing: provisional, counted once, nothing preserved; the next read preserves it and counts it unreadable", { timeout: 180_000 }, async () => {
    const roots = { diagnostics: temporary(), evidence: temporary() };
    await saveBatch();
    failNormalize.add(tenex);
    failPreserve.set(tenex, 1);
    const first = worker(roots);
    expect(await first.acquisition.runOnce()).toMatchObject({ claimed: 25, ingested: 24, stopped: null });
    const item = await itemOf(tenex);
    expect(item).toMatchObject({ status: "QUEUED", attempts: 1, lastReason: "INGEST_DB_ERROR" });
    expect(await database.sourceRecord.count({ where: { externalId: item.externalId } })).toBe(0);
    expect(eventsOf(first.diagnostics).find((event) => event.event === "job.failed")).toMatchObject({
      itemId: item.id,
      stage: "ingest",
      failure: "TRANSIENT",
      decision: "DB_PENDING_PROVISIONAL",
      error: { prismaCode: "P2028", transaction: "preserveUnnormalizedListing" },
    });
    // An hour later the database is fine but the listing still cannot be
    // normalized: it is preserved (unlinked) and counted as unreadable.
    later(61);
    expect(await first.acquisition.runOnce()).toMatchObject({ claimed: 1, ingested: 0 });
    expect(await itemOf(tenex)).toMatchObject({ status: "QUEUED", attempts: 2, lastReason: "UNREADABLE" });
    expect(await database.sourceRecord.findMany({ where: { externalId: item.externalId }, select: { opportunityId: true } })).toEqual([{ opportunityId: null }]);
    expect(eventsOf(first.diagnostics).filter((event) => event.itemId === item.id && event.event === "job.failed").at(-1)).toMatchObject({ stage: "normalize", failure: "UNREADABLE" });
    // The package shows the preserved listing as unlinked.
    const assembled = await evidencePackage(roots);
    const records = assembled.read<Array<Record<string, unknown>>>("source-records.json");
    expect(records.find((record) => record.externalId === item.externalId)).toMatchObject({ opportunityId: null, orphan: true, linkedToCapturedJob: false });
  });

  it("a P2028 while staging the batch saves nothing and names the transaction; saving the same page again stages it once", { timeout: 120_000 }, async () => {
    const original = database.$transaction.bind(database);
    const spy = vi.spyOn(database, "$transaction").mockImplementationOnce((() => Promise.reject(p2028())) as never);
    batchId = randomUUID();
    const body = {
      schemaVersion: 1,
      kind: "page-capture",
      batchId,
      site: "e2e-results",
      pageUrl: "https://jobs.e2e.invalid/search?keywords=customer+success",
      pageTitle: "Customer success jobs",
      capturedAt: clock.now.toISOString(),
      extensionVersion: "0.3.0",
      counts: { loaded: 25, skippedUnloaded: 0, overCap: 0 },
      cards: names.map((name) => ({ url: jobUrl(name), title: `Customer Success Manager ${jobId(name)}`, siteJobId: jobId(name), company: company(name), location: "United States" })),
    };
    const failure = await intake.capture(body, pairing).then(
      () => null,
      (error: unknown) => error as Record<string, unknown>,
    );
    expect(failure).toMatchObject({ code: "P2028", captureTransaction: "stageBatch" });
    expect(await database.pageCaptureItem.count({ where: { sourceUrl: { in: names.map(jobUrl) } } })).toBe(0);
    expect(await database.pageCaptureSession.count({ where: { id: batchId } })).toBe(0);
    spy.mockImplementation(original as never);
    const saved = await intake.capture(body, pairing);
    expect(saved.outcomes).toHaveLength(25);
    for (const name of names) externalIds.push((await itemOf(name)).externalId);
    expect(await intake.capture(body, pairing)).toMatchObject({ outcomes: expect.any(Array) });
    expect(await database.pageCaptureItem.count({ where: { sourceUrl: { in: names.map(jobUrl) } } })).toBe(25);
    expect(await database.pageCaptureSession.count({ where: { id: batchId } })).toBe(1);
  });
});

describe("the failure evidence package reads only", () => {
  it("cannot write: its reads run in a read-only session and transaction", { timeout: 60_000 }, async () => {
    const client = createReadOnlyDatabaseClient(testDatabaseUrl());
    try {
      await expect(
        readOnlyTransaction(client, (transaction) => transaction.$executeRawUnsafe(`UPDATE "PageCaptureItem" SET "attempts" = "attempts" WHERE false`)),
      ).rejects.toThrow(/read-only transaction/);
    } finally {
      await client.$disconnect();
    }
  });
});
