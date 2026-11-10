// Feature 14 on the isolated test database: LinkedIn browser-assisted
// retrieval through the real retrieval worker and repositories, with
// synthetic public pages served by a fixture browser driver (no browser is
// launched and nothing reaches the network). Covers the discovered pool kept
// as pending ledger rows and worked through across runs within the detail
// budget, no refetch of stored jobs, a gone pending job leaving the queue,
// bounded coverage never inferring absence, a stop reaching Feature 12
// backoff with no further navigation, and no evaluation being started.
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { getDatabaseClient, PrismaManualOpportunityRepository, PrismaRetrievalSourceRepository } from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport, linkedinAdapter, linkedInJobUrl, linkedInKeywords, linkedInSearchUrl } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createRetrievalService } from "../../apps/web/src/server/retrieval-service";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";
import { createFixtureBrowser, jobPage, noResultsPage, parsePage, searchPage, type FixturePage } from "../support/linkedin-fixtures";

const database = getDatabaseClient();
const store = new PrismaRetrievalSourceRepository();
// Verified only here: the real adapter has not had a live verification.
const registry = createAdapterRegistry([{ ...linkedinAdapter, verified: true }]);
const env = { RETRIEVAL_BROWSER_EXECUTABLE: "/opt/fixture/chromium" };
const pages: Record<string, FixturePage> = {};
const navigations: string[][] = [];
const httpTransports: Array<ReturnType<typeof createFixtureTransport>> = [];
const start = new Date("2026-10-19T09:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
let clock = start;
const worker = createRetrievalWorker({
  store,
  ingestion: createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() }),
  registry,
  // A browser-assisted run never sends an HTTP request.
  transport: () => {
    const transport = createFixtureTransport({});
    httpTransports.push(transport);
    return transport;
  },
  discovery: customerSuccessDiscoveryConfiguration,
  env: () => env,
  now: () => clock,
  log: { info: () => undefined, warn: () => undefined },
  lastChecked: (source, externalIds) => store.lastCheckedListings(source, externalIds),
  pendingListings: (sourceId, trackingScopeKey, since) => store.pendingListings(sourceId, trackingScopeKey, since),
  browser: {
    launch: async () => {
      const fixture = createFixtureBrowser((url) => pages[url]);
      navigations.push(fixture.navigations);
      return fixture.driver;
    },
    parse: (html, url) => parsePage(html, url),
    sleep: async () => undefined,
  },
});
const service = createRetrievalService({ store, registry, env: () => env, now: () => clock });

const tokens: string[] = [];
const sourceIds: string[] = [];

beforeEach(() => {
  clock = start;
  navigations.length = 0;
  for (const key of Object.keys(pages)) delete pages[key];
});

afterEach(async () => {
  expect(httpTransports.splice(0).flatMap((transport) => transport.requested)).toEqual([]);
  const ids = sourceIds.splice(0);
  const records = await database.sourceRecord.findMany({ where: { retrievalSourceId: { in: ids } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set(records.map((record) => record.opportunityId).filter((id): id is string => id !== null))];
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ retrievalSourceId: { in: ids } }, { opportunityId: { in: opportunityIds } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.retrievedListing.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  await database.company.deleteMany({ where: { OR: tokens.splice(0).map((token) => ({ name: { contains: token } })) } });
  await database.retrievalRun.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: ids } } });
});

afterAll(() => database.$disconnect());

// Unique job IDs and companies per test, so nothing matches another test's
// listings (LinkedIn job IDs are global to the adapter key).
function scenario() {
  const token = `L${randomUUID().slice(0, 8)}`;
  tokens.push(token);
  const base = randomInt(1_000_000, 9_000_000) * 1000;
  const id = (n: number) => String(base + n);
  const company = (n: number) => `Acme ${token} ${n}`;
  return { token, id, company };
}

async function newSource(config: Record<string, unknown>) {
  const created = await service.create({ adapterKey: "linkedin", name: `LinkedIn ${randomUUID().slice(0, 6)}`, config });
  sourceIds.push(created.id);
  await service.update(created.id, { enabled: true });
  return created.id;
}

const config = (overrides: Record<string, unknown>) => linkedinAdapter.configSchema.parse(overrides);
const searchAt = (overrides: Record<string, unknown>, offset: number) => {
  const parsed = config(overrides);
  return linkedInSearchUrl(parsed, linkedInKeywords(parsed, customerSuccessDiscoveryConfiguration.searchQueries), offset);
};

// Serves one search page of these cards (then no more results) and a job
// page for every Customer Success card.
function serveSearch(overrides: Record<string, unknown>, cards: Array<{ id: string; title: string; company: string }>) {
  pages[searchAt(overrides, 0)] = { status: 200, html: searchPage(cards) };
  pages[searchAt(overrides, cards.length)] = { status: 200, html: noResultsPage() };
  for (const card of cards) pages[linkedInJobUrl(card.id)] ??= { status: 200, html: jobPage({ id: card.id, title: card.title, company: card.company }) };
}

async function runAt(sourceId: string, offsetDays: number) {
  clock = new Date(start.getTime() + offsetDays * day);
  await store.enqueueRun(sourceId, "MANUAL", { now: clock });
  const outcome = await worker.runOnce();
  expect(outcome?.sourceId).toBe(sourceId);
  return outcome!;
}

const detailsOf = (run: string[]) => run.filter((url) => url.includes("/jobs/view/")).map((url) => url.split("/").pop());
const ledger = (sourceId: string) =>
  database.retrievedListing.findMany({ where: { retrievalSourceId: sourceId }, orderBy: [{ firstSeenAt: "asc" }, { externalId: "asc" }] });

describe("LinkedIn browser-assisted retrieval", () => {
  it("keeps the discovered pool as pending listings and works through it across runs without refetching stored jobs", async () => {
    const { id, company } = scenario();
    const settings = { maxDetailsPerRun: 2 };
    const sourceId = await newSource(settings);
    const first = [1, 2, 3, 4, 5, 6].map((n) => ({ id: id(n), title: "Customer Success Manager", company: company(n) }));
    serveSearch(settings, [...first, { id: id(90), title: "Backend Engineer", company: company(90) }]);

    const run1 = await runAt(sourceId, 0);
    expect(run1).toMatchObject({ status: "COMPLETED", counts: { fetched: 7, created: 2 } });
    expect(detailsOf(navigations[0]!)).toEqual([id(1), id(2)]);
    let rows = await ledger(sourceId);
    // Every Customer Success match has a row; the non-match has none.
    expect(rows.map((row) => row.externalId).sort()).toEqual(first.map((card) => card.id).sort());
    expect(rows.filter((row) => row.opportunityId).map((row) => row.externalId).sort()).toEqual([id(1), id(2)]);
    expect(rows.every((row) => row.state === "LISTED" && !row.removalCapable)).toBe(true);
    const source = await store.get(sourceId);
    expect((await store.pendingListings(sourceId, source!.trackingScopeKey!, new Date(0))).map((row) => row.externalId).sort()).toEqual(
      [id(3), id(4), id(5), id(6)],
    );
    expect((await database.retrievalRun.findFirstOrThrow({ where: { retrievalSourceId: sourceId } })).listingCoverageComplete).toBe(false);

    // The next day the search shows two new jobs only: the earlier pending
    // ones still go first, though they left the search window.
    for (const key of Object.keys(pages)) delete pages[key];
    const second = [7, 8].map((n) => ({ id: id(n), title: "Customer Success Manager", company: company(n) }));
    serveSearch(settings, second);
    for (const card of first) pages[linkedInJobUrl(card.id)] = { status: 200, html: jobPage({ id: card.id, title: card.title, company: card.company }) };
    const run2 = await runAt(sourceId, 1);
    expect(run2).toMatchObject({ status: "COMPLETED", counts: { created: 2 } });
    expect(detailsOf(navigations[1]!).sort()).toEqual([id(3), id(4)].sort());
    await runAt(sourceId, 2);
    expect(detailsOf(navigations[2]!).sort()).toEqual([id(5), id(6)].sort());
    await runAt(sourceId, 3);
    expect(detailsOf(navigations[3]!).sort()).toEqual([id(7), id(8)].sort());
    // Everything is stored: a later run fetches nothing that is stored and
    // checked within 7 days.
    await runAt(sourceId, 4);
    expect(detailsOf(navigations[4]!)).toEqual([]);

    rows = await ledger(sourceId);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.opportunityId !== null)).toBe(true);
    // Bounded: listings missing from the search are never marked missing.
    expect(rows.every((row) => row.state === "LISTED" && row.missedCompleteRuns === 0)).toBe(true);
    // Retrieval never starts an evaluation.
    const opportunityIds = rows.map((row) => row.opportunityId!);
    expect(await database.evaluation.count({ where: { opportunityId: { in: opportunityIds } } })).toBe(0);
    const record = await database.sourceRecord.findFirstOrThrow({ where: { retrievalSourceId: sourceId, externalId: id(1) } });
    expect(record).toMatchObject({ source: "linkedin", retrievalType: "BROWSER_ASSISTED", sourceCategory: "JOB_BOARD", sourceUrl: linkedInJobUrl(id(1)) });
  });

  it("drops a pending job whose page is gone from the queue", async () => {
    const { id, company } = scenario();
    const settings = { maxDetailsPerRun: 1 };
    const sourceId = await newSource(settings);
    serveSearch(settings, [1, 2].map((n) => ({ id: id(n), title: "Customer Success Manager", company: company(n) })));
    pages[linkedInJobUrl(id(2))] = { status: 404, html: "<html><body>gone</body></html>" };
    await runAt(sourceId, 0);
    // The next search no longer lists either job.
    pages[searchAt(settings, 0)] = { status: 200, html: noResultsPage() };
    expect((await ledger(sourceId)).map((row) => row.externalId).sort()).toEqual([id(1), id(2)].sort());
    const run2 = await runAt(sourceId, 1);
    expect(detailsOf(navigations[1]!)).toEqual([id(2)]);
    expect(run2).toMatchObject({ status: "FAILED", errorCode: "LISTING_FAILURES" });
    // The placeholder is gone; nothing else changed.
    const rows = await ledger(sourceId);
    expect(rows.map((row) => row.externalId)).toEqual([id(1)]);
  });

  it("stops at the first block, backs the source off through Feature 12 and navigates no further", async () => {
    const settings = {};
    const sourceId = await newSource(settings);
    pages[searchAt(settings, 0)] = { status: 999, html: "" };
    const outcome = await runAt(sourceId, 0);
    expect(outcome).toMatchObject({ status: "FAILED", errorCode: "ACCESS_DENIED" });
    expect(navigations[0]).toEqual([searchAt(settings, 0)]);
    const source = await store.get(sourceId);
    expect(source!.nextEligibleAt!.getTime()).toBeGreaterThanOrEqual(clock.getTime() + day);
    // A Run now cannot jump the gate.
    await expect(service.runNow(sourceId)).rejects.toMatchObject({ code: expect.any(String) });
    expect(await ledger(sourceId)).toEqual([]);
  });
});
