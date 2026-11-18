// Continuous capture's server side (November 15, 2026) on the isolated test
// database: the read-only selection decides each card exactly as staging
// does; a save's session reports whether every job has settled, its jobs as
// stored and its still-queued background-tab jobs; a stopped or expired tab
// job submitted again is requeued as the same job with its attempts
// unchanged; a repeated batch changes nothing; successive batches of one run
// never duplicate a job.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageCaptureTabStaleMs } from "@ai-career/core";
import { PrismaPageCaptureRepository } from "@ai-career/database";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { extensionCaptureSession } from "../../apps/web/src/server/page-capture-progress";
import { database } from "../support/budget-integration";

const run = randomUUID().slice(0, 8);
const testJob = (index: number) => `https://jobs.e2e.invalid/jobs/cc-${run}-${index}`;
const wttjJob = (index: number) => `https://www.welcometothejungle.com/en/companies/cc-${run}/jobs/cc-${run}-${index}`;
const clock = { now: new Date("2026-11-15T20:00:00.000Z") };
const repository = new PrismaPageCaptureRepository();
const enabledSites = () => ({ cards: ["e2e-results", "welcome-to-the-jungle"], details: ["e2e-results", "welcome-to-the-jungle"] });
const intake = createPageCaptureService({ repository, enabledSites, now: () => clock.now });
let pairing: { id: string };

const batch = (site: "e2e-results" | "welcome-to-the-jungle", urls: string[], options: { batchId?: string; batchNumber?: number } = {}) => ({
  schemaVersion: 1,
  kind: "page-capture",
  batchId: options.batchId ?? randomUUID(),
  site,
  pageUrl: site === "e2e-results" ? "https://jobs.e2e.invalid/search" : "https://www.welcometothejungle.com/en/jobs?query=cs&page=1",
  pageTitle: "Search",
  capturedAt: clock.now.toISOString(),
  extensionVersion: "0.3.0",
  counts: { loaded: urls.length, skippedUnloaded: 0, overCap: 0 },
  cards: urls.map((url, index) => ({ url, title: `Customer Success Manager ${index}`, siteJobId: null, company: "Acme", location: null, postedText: null })),
  ...(options.batchNumber ? { continuous: { runId: `run-${run}`, batchNumber: options.batchNumber } } : {}),
});

const ours = { externalId: { contains: `cc-${run}-` } };

beforeEach(async () => {
  clock.now = new Date("2026-11-15T20:00:00.000Z");
  pairing = await database.extensionPairing.create({ data: { label: "Continuous capture test", tokenHash: randomUUID(), tokenHint: "test" } });
});

afterEach(async () => {
  await database.pageCaptureItem.deleteMany({ where: ours });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
});

describe("selection agrees with staging", () => {
  it("for every disposition: new, in progress, already captured, dismissed, unavailable and awaiting (tab site requeue, worker site not)", async () => {
    const urls = Array.from({ length: 6 }, (_unused, index) => testJob(index));
    const tabUrls = [wttjJob(0), wttjJob(1)];
    await intake.capture(batch("e2e-results", urls.slice(1)), pairing as never);
    await intake.capture(batch("welcome-to-the-jungle", tabUrls), pairing as never);
    const set = async (url: string, data: Record<string, unknown>) => {
      const item = await database.pageCaptureItem.findFirst({ where: { sourceUrl: url } });
      await database.pageCaptureItem.update({ where: { id: item!.id }, data });
    };
    await set(urls[2]!, { status: "INGESTED" });
    await set(urls[3]!, { status: "DISMISSED" });
    await set(urls[4]!, { status: "UNAVAILABLE" });
    await set(urls[5]!, { status: "AWAITING_DETAILS", lastReason: "FAILED_REPEATEDLY", attempts: 3 });
    await set(tabUrls[0]!, { status: "AWAITING_DETAILS", lastReason: "BATCH_STOPPED" });
    const worker = await intake.selection({ site: "e2e-results", cards: urls.map((url) => ({ url, siteJobId: null })) });
    expect(worker.cards.map((card) => [card.disposition, card.selectable])).toEqual([
      ["NEW", true],
      ["IN_PROGRESS", false],
      ["ALREADY_SAVED", false],
      ["DISMISSED", false],
      ["UNAVAILABLE", false],
      ["AWAITING", false],
    ]);
    const tabs = await intake.selection({ site: "welcome-to-the-jungle", cards: tabUrls.map((url) => ({ url, siteJobId: null })) });
    expect(tabs.cards.map((card) => [card.disposition, card.selectable])).toEqual([
      ["AWAITING", true],
      ["IN_PROGRESS", false],
    ]);
    // Selection staged nothing.
    expect(await database.pageCaptureItem.count({ where: ours })).toBe(7);
    // Staging the same cards does what selection said.
    const staged = await intake.capture(batch("e2e-results", urls), pairing as never);
    expect(staged.outcomes.map((outcome) => outcome.outcome)).toEqual(["QUEUED", "SEEN_AGAIN", "SEEN_AGAIN", "SEEN_AGAIN", "SEEN_AGAIN", "SEEN_AGAIN"]);
    const restaged = await intake.capture(batch("welcome-to-the-jungle", tabUrls), pairing as never);
    expect(restaged.outcomes.map((outcome) => outcome.outcome)).toEqual(["QUEUED", "SEEN_AGAIN"]);
    // A card of another site is rejected, never staged.
    const foreign = await intake.selection({ site: "e2e-results", cards: [{ url: "https://example.com/jobs/1", siteJobId: null }] });
    expect(foreign.cards[0]).toMatchObject({ disposition: "REJECTED", selectable: false });
  });
});

describe("a save's session for continuous capture", () => {
  it("is settled only when no job is queued or being read; lists its jobs and its queued background-tab jobs", async () => {
    const urls = [wttjJob(10), wttjJob(11), wttjJob(12)];
    const staged = await intake.capture(batch("welcome-to-the-jungle", urls, { batchNumber: 1 }), pairing as never);
    let detail = (await extensionCaptureSession(staged.sessionId!, repository, () => clock.now))!;
    expect(detail.settled).toBe(false);
    expect(detail.queuedTabItems.map((item) => item.url)).toEqual(urls);
    expect(detail.items.map((item) => item.status)).toEqual(["QUEUED", "QUEUED", "QUEUED"]);
    expect(detail.stoppedUntil).toBeNull();
    // The user's Stop: the queued jobs wait (BATCH_STOPPED), none counted.
    await repository.stopTabItems("welcome-to-the-jungle", detail.items.map((item) => item.itemId), "BATCH_STOPPED");
    detail = (await extensionCaptureSession(staged.sessionId!, repository, () => clock.now))!;
    expect(detail.settled).toBe(true);
    expect(detail.queuedTabItems).toEqual([]);
    const stopped = await database.pageCaptureItem.findMany({ where: ours });
    expect(stopped.every((item) => item.status === "AWAITING_DETAILS" && item.attempts === 0)).toBe(true);
    // Resume submits them again: the same jobs, queued, attempts unchanged.
    const again = await intake.capture(batch("welcome-to-the-jungle", urls, { batchNumber: 2 }), pairing as never);
    expect(again.acquisition!.items.map((item) => item.itemId).sort()).toEqual(stopped.map((item) => item.id).sort());
    expect(await database.pageCaptureItem.count({ where: ours })).toBe(3);
    // A batch's run label is kept in its session.
    const session = await database.pageCaptureSession.findUnique({ where: { id: again.sessionId! } });
    expect(session!.counts).toMatchObject({ continuousRunId: `run-${run}`, continuousBatch: 2 });
  });

  it("jobs whose tab reading stopped with the browser expire (attempt not counted) and are requeued as the same jobs", async () => {
    const urls = [wttjJob(20), wttjJob(21)];
    const staged = await intake.capture(batch("welcome-to-the-jungle", urls), pairing as never);
    clock.now = new Date(clock.now.getTime() + pageCaptureTabStaleMs + 60_000);
    const detail = (await extensionCaptureSession(staged.sessionId!, repository, () => clock.now))!;
    expect(detail.settled).toBe(true);
    expect(detail.items.map((item) => [item.status, item.lastReason])).toEqual([
      ["AWAITING_DETAILS", "INTERRUPTED"],
      ["AWAITING_DETAILS", "INTERRUPTED"],
    ]);
    const selection = await intake.selection({ site: "welcome-to-the-jungle", cards: urls.map((url) => ({ url, siteJobId: null })) });
    expect(selection.cards.every((card) => card.selectable)).toBe(true);
    const again = await intake.capture(batch("welcome-to-the-jungle", urls), pairing as never);
    expect(again.acquisition!.items).toHaveLength(2);
    const rows = await database.pageCaptureItem.findMany({ where: ours });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "QUEUED" && row.attempts === 0)).toBe(true);
  });
});

describe("successive batches of one run", () => {
  it("never duplicate a job, and a repeated batch changes nothing", async () => {
    const urls = Array.from({ length: 53 }, (_unused, index) => testJob(100 + index));
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await intake.capture(batch("e2e-results", urls.slice(0, 25), { batchId: ids[0], batchNumber: 1 }), pairing as never);
    await intake.capture(batch("e2e-results", urls.slice(25, 50), { batchId: ids[1], batchNumber: 2 }), pairing as never);
    // The same batch sent again after a crash.
    const repeat = await intake.capture(batch("e2e-results", urls.slice(25, 50), { batchId: ids[1], batchNumber: 2 }), pairing as never);
    expect(repeat.sessionId).toBe(ids[1]);
    await intake.capture(batch("e2e-results", urls.slice(50), { batchId: ids[2], batchNumber: 3 }), pairing as never);
    expect(await database.pageCaptureItem.count({ where: ours })).toBe(53);
    const sessions = await database.pageCaptureSession.findMany({ where: { id: { in: ids } } });
    expect(sessions.map((session) => (session.counts as { continuousBatch: number }).continuousBatch).sort()).toEqual([1, 2, 3]);
    expect(sessions.map((session) => session.itemIds.length).sort((a, b) => a - b)).toEqual([3, 25, 25]);
    // Each job is in exactly one batch's session.
    const all = sessions.flatMap((session) => session.itemIds);
    expect(new Set(all).size).toBe(53);
    // All selectable none: every one is in progress.
    const selection = await intake.selection({ site: "e2e-results", cards: urls.slice(0, 200).map((url) => ({ url, siteJobId: null })) });
    expect(selection.cards.filter((card) => card.selectable)).toHaveLength(0);
  });
});
