// Feature 13 on the isolated test database: the listing ledger written by
// the retrieval worker with the fixture transport (synthetic Greenhouse
// boards with unique board names and job IDs; nothing reaches the network).
// Covers sightings, the two-check plus 24-hour removal rule, reappearance,
// non-qualifying runs, a title change, bounded sources, scope generations
// (A → B → A), the HISTORICAL baseline and its adoption, the migration's
// backfill, the dashboard badge, and that loadSubject() is unchanged.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityListRepository,
  PrismaRetrievalSourceRepository,
} from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport, greenhouseAdapter, type TransportResponse } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createRetrievalService } from "../../apps/web/src/server/retrieval-service";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";
import { createTestAdapter, jsonResponse, testBoardUrl } from "../support/retrieval-test-adapter";

const database = getDatabaseClient();
const store = new PrismaRetrievalSourceRepository();
const bounded = createTestAdapter({ key: "test-feed", name: "Test Feed", sourceCategory: "JOB_BOARD", sourceType: "PUBLIC_SEARCH" });
const registry = createAdapterRegistry([greenhouseAdapter, bounded]);
const responses: Record<string, Omit<TransportResponse, "url">> = {};
const start = new Date("2026-10-19T09:00:00.000Z");
let clock = start;
const hour = 60 * 60 * 1000;
const worker = createRetrievalWorker({
  store,
  ingestion: createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() }),
  registry,
  transport: () => createFixtureTransport(responses),
  discovery: customerSuccessDiscoveryConfiguration,
  env: () => ({}),
  now: () => clock,
  log: { info: () => undefined, warn: () => undefined },
});
const service = createRetrievalService({ store, registry, env: () => ({}), now: () => clock });

const tokens: string[] = [];
const sourceIds: string[] = [];

beforeEach(() => {
  clock = start;
  for (const key of Object.keys(responses)) delete responses[key];
});

afterEach(async () => {
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

const csJob = (id: number, token: string, title = "Customer Success Manager") => ({
  id,
  title,
  company_name: `Acme ${token}`,
  content: "&lt;p&gt;Own onboarding, adoption and renewals.&lt;/p&gt;",
  absolute_url: `https://boards.greenhouse.io/${token}/jobs/${id}`,
});
const otherJob = (id: number) => ({ id, title: "Data Engineer", content: "<p>Pipelines.</p>" });

function serveBoard(board: string, jobs: unknown[], total: number | null = jobs.length) {
  responses[greenhouseAdapter.verificationUrl({ board })] = jsonResponse({ jobs, ...(total === null ? {} : { meta: { total } }) });
}

async function newSource(board: string) {
  const token = `P${randomUUID().slice(0, 8)}`;
  tokens.push(token);
  const created = await service.create({ adapterKey: "greenhouse", name: `Greenhouse ${token}`, config: { board } });
  sourceIds.push(created.id);
  await service.update(created.id, { enabled: true });
  return { id: created.id, token };
}

async function runAt(sourceId: string, offsetHours: number) {
  clock = new Date(start.getTime() + offsetHours * hour);
  await store.enqueueRun(sourceId, "MANUAL", { now: clock });
  const outcome = await worker.runOnce();
  expect(outcome?.sourceId).toBe(sourceId);
  return outcome!;
}

const rowFor = async (sourceId: string, externalId: string) =>
  database.retrievedListing.findMany({ where: { retrievalSourceId: sourceId, externalId }, orderBy: { createdAt: "asc" } });
const badge = async (token: string) =>
  (await new PrismaOpportunityListRepository().listPage({ filters: { searchTerms: [token] }, sort: "newest", page: 1, pageSize: 25 })).items.map(
    (item) => item.noLongerListed,
  );

describe("the listing ledger", () => {
  it("confirms removal only after two complete misses at least 24 hours apart, shows the badge, and counts a return as a reappearance", async () => {
    const board = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { id: sourceId, token } = await newSource(board);
    serveBoard(board, [csJob(id, token), otherJob(id + 1)]);
    expect(await runAt(sourceId, 0)).toMatchObject({ status: "COMPLETED", counts: { created: 1 } });
    let [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "LISTED", removalCapable: true, firstSeenAt: start, lastSeenAt: start });
    expect((await database.retrievalRun.findFirstOrThrow({ where: { retrievalSourceId: sourceId } })).listingCoverageComplete).toBe(true);

    serveBoard(board, [otherJob(id + 1)]);
    await runAt(sourceId, 1);
    [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "MISSING", missedCompleteRuns: 1, missingSince: new Date(start.getTime() + hour) });
    // A second miss within 24 hours of the first stays MISSING.
    await runAt(sourceId, 2);
    [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "MISSING", missedCompleteRuns: 2 });
    expect(await badge(token)).toEqual([false]);
    // A non-qualifying run (stated total does not match) neither counts nor resets.
    serveBoard(board, [otherJob(id + 1)], 2);
    await runAt(sourceId, 10);
    [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "MISSING", missedCompleteRuns: 2 });
    serveBoard(board, [otherJob(id + 1)]);
    const confirm = await runAt(sourceId, 25);
    expect(confirm.counts.listings).toMatchObject({ removed: 1 });
    [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "REMOVED", removedAt: new Date(start.getTime() + 25 * hour) });
    expect(await badge(token)).toEqual([true]);
    // Nothing closes or archives the opportunity.
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: row!.opportunityId! } })).status).toBe("NORMALIZED");

    serveBoard(board, [csJob(id, token), otherJob(id + 1)]);
    const back = await runAt(sourceId, 30);
    expect(back.counts.listings).toMatchObject({ reappeared: 1 });
    [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "LISTED", reappearances: 1, reappearedAt: new Date(start.getTime() + 30 * hour), firstSeenAt: start });
    expect(await badge(token)).toEqual([false]);
  });

  it("keeps a listing whose title stops matching as listed, moving Opportunity.lastSeenAt but not the content observation", async () => {
    const board = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { id: sourceId, token } = await newSource(board);
    serveBoard(board, [csJob(id, token)]);
    await runAt(sourceId, 0);
    serveBoard(board, [csJob(id, token, "Data Analyst")]);
    await runAt(sourceId, 26);
    const [row] = await rowFor(sourceId, String(id));
    expect(row).toMatchObject({ state: "LISTED", lastSeenAt: new Date(start.getTime() + 26 * hour) });
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: row!.opportunityId! }, include: { sourceRecords: true } });
    expect(opportunity.lastSeenAt).toEqual(new Date(start.getTime() + 26 * hour));
    expect(opportunity.sourceRecords.map((record) => record.lastObservedAt)).toEqual([start]);
  });

  it("never infers absence from a bounded source", async () => {
    const token = `P${randomUUID().slice(0, 8)}`;
    tokens.push(token);
    const created = await service.create({ adapterKey: bounded.key, name: `Feed ${token}`, config: { board: token } });
    sourceIds.push(created.id);
    await service.update(created.id, { enabled: true });
    const page = (jobs: unknown[]) => (responses[testBoardUrl(bounded.key, token, 1)] = jsonResponse({ jobs }));
    page([{ id: "1", title: "Customer Success Manager", company: `Acme ${token}`, html: "<p>Renewals.</p>", url: `https://feed.example.com/${token}/1` }]);
    await runAt(created.id, 0);
    page([]);
    await runAt(created.id, 30);
    await runAt(created.id, 60);
    const [row] = await rowFor(created.id, "1");
    expect(row).toMatchObject({ state: "LISTED", removalCapable: false, missedCompleteRuns: 0 });
  });

  it("starts a fresh scope generation on each retrieval-scope change: A → B → A does not inherit A₁'s history", async () => {
    const boardA = `a${randomUUID().slice(0, 8)}`;
    const boardB = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { id: sourceId, token } = await newSource(boardA);
    const keyA1 = (await store.get(sourceId))!.trackingScopeKey;
    expect(keyA1).toMatch(/^[0-9a-f-]{36}$/);
    serveBoard(boardA, [csJob(id, token)]);
    await runAt(sourceId, 0);
    // Removed in A₁.
    serveBoard(boardA, []);
    await runAt(sourceId, 1);
    await runAt(sourceId, 26);
    expect((await rowFor(sourceId, String(id)))[0]).toMatchObject({ state: "REMOVED", trackingScopeKey: keyA1 });

    // A display-only change keeps the scope; renaming does too.
    await service.update(sourceId, { name: "Renamed" });
    expect((await store.get(sourceId))!.trackingScopeKey).toBe(keyA1);

    await service.update(sourceId, { config: { board: boardB } });
    const keyB = (await store.get(sourceId))!.trackingScopeKey;
    await service.update(sourceId, { config: { board: boardA } });
    const keyA2 = (await store.get(sourceId))!.trackingScopeKey;
    expect(new Set([keyA1, keyB, keyA2]).size).toBe(3);

    serveBoard(boardA, [csJob(id, token)]);
    const outcome = await runAt(sourceId, 40);
    expect(outcome.counts.listings).toMatchObject({ reappeared: 0 });
    const rows = await rowFor(sourceId, String(id));
    expect(rows.map((row) => [row.trackingScopeKey, row.state])).toEqual([
      [keyA1, "UNTRACKED"],
      [keyA2, "LISTED"],
    ]);
    // A₂ starts fresh: first seen now, no removal or reappearance carried over.
    expect(rows[1]).toMatchObject({ firstSeenAt: new Date(start.getTime() + 40 * hour), reappearances: 0, removedAt: null, reappearedAt: null });
    // The old row keeps its history.
    expect(rows[0]).toMatchObject({ removedAt: new Date(start.getTime() + 26 * hour), firstSeenAt: start });
  });
});

describe("the pre-feature-13 baseline", () => {
  // A source as it was before feature 13: no scope key, its listings as
  // HISTORICAL rows in the '' baseline.
  async function legacySource(board: string, id: number) {
    const { id: sourceId, token } = await newSource(board);
    serveBoard(board, [csJob(id, token)]);
    await runAt(sourceId, 0);
    await database.retrievedListing.deleteMany({ where: { retrievalSourceId: sourceId } });
    await database.retrievalSource.update({ where: { id: sourceId }, data: { trackingScopeKey: null } });
    return { sourceId, token };
  }

  it("is backfilled by the migration as HISTORICAL, never as currently listed", async () => {
    const board = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { sourceId } = await legacySource(board, id);
    const migration = readFileSync("database/prisma/migrations/20261019090000_retrieved_listing_history/migration.sql", "utf8");
    const backfill = migration.slice(migration.indexOf('INSERT INTO "RetrievedListing"')).replace(
      'WHERE sr."externalId" IS NOT NULL',
      `WHERE sr."externalId" IS NOT NULL AND sr."retrievalSourceId" = '${sourceId}'`,
    );
    await database.$executeRawUnsafe(backfill);
    const [row] = await rowFor(sourceId, String(id));
    const record = await database.sourceRecord.findFirstOrThrow({ where: { retrievalSourceId: sourceId } });
    expect(row).toMatchObject({ state: "HISTORICAL", trackingScopeKey: "", removalCapable: true, opportunityId: record.opportunityId, firstSeenAt: record.discoveredAt, lastSeenAt: record.lastObservedAt });
  });

  it("is adopted by the source's first run and becomes LISTED only when seen; absence never moves it", async () => {
    const board = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { sourceId, token } = await legacySource(board, id);
    const opportunityId = (await database.sourceRecord.findFirstOrThrow({ where: { retrievalSourceId: sourceId } })).opportunityId;
    const historical = { retrievalSourceId: sourceId, trackingScopeKey: "", source: "greenhouse", opportunityId, removalCapable: true, state: "HISTORICAL" as const, firstSeenAt: start, lastSeenAt: start };
    await database.retrievedListing.create({ data: { ...historical, externalId: String(id) } });
    await database.retrievedListing.create({ data: { ...historical, externalId: String(id + 5) } });
    serveBoard(board, [csJob(id, token)]);
    await runAt(sourceId, 30);
    const key = (await store.get(sourceId))!.trackingScopeKey;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect((await rowFor(sourceId, String(id)))[0]).toMatchObject({ trackingScopeKey: key, state: "LISTED", firstSeenAt: start });
    await runAt(sourceId, 60);
    expect((await rowFor(sourceId, String(id + 5)))[0]).toMatchObject({ trackingScopeKey: key, state: "HISTORICAL", missedCompleteRuns: 0 });
    expect(await badge(token)).toEqual([false]);
  });

  it("stays UNTRACKED when the first scope is set by a scope-changing settings change", async () => {
    const board = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { sourceId } = await legacySource(board, id);
    await database.retrievedListing.create({
      data: { retrievalSourceId: sourceId, trackingScopeKey: "", source: "greenhouse", externalId: String(id), removalCapable: true, state: "HISTORICAL", firstSeenAt: start, lastSeenAt: start },
    });
    await service.update(sourceId, { config: { board: `${board}x` } });
    expect((await store.get(sourceId))!.trackingScopeKey).toMatch(/^[0-9a-f-]{36}$/);
    expect((await rowFor(sourceId, String(id)))[0]).toMatchObject({ trackingScopeKey: "", state: "UNTRACKED" });
  });
});

describe("the evaluator boundary", () => {
  it("leaves loadSubject() unchanged: no posting history reaches the evaluator", async () => {
    const board = `b${randomUUID().slice(0, 8)}`;
    const id = randomInt(10_000_000, 99_999_999);
    const { id: sourceId, token } = await newSource(board);
    serveBoard(board, [csJob(id, token)]);
    await runAt(sourceId, 0);
    serveBoard(board, []);
    await runAt(sourceId, 1);
    await runAt(sourceId, 26);
    const [row] = await rowFor(sourceId, String(id));
    expect(row!.state).toBe("REMOVED");
    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: row!.opportunityId!, userProfileId: null });
    expect(subject!.rawSources).toHaveLength(1);
    expect(Object.keys(subject!.rawSources[0]!)).toEqual(["id", "source", "sourceType", "sourceUrl", "rawDescription", "rawPayload"]);
    expect(Object.keys(subject!.rawSources[0]!.rawPayload as object)).toEqual(["source"]);
    expect(JSON.stringify(subject)).not.toContain("postingHistory");
  });
});
