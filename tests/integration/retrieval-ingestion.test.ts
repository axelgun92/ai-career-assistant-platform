// Feature 11A on the isolated test database: the retrieval worker with the
// fixture transport and synthetic test adapters (their URLs use the
// reserved ".invalid" domain; nothing reaches the network). Covers first
// run, idempotent re-runs, volatile versus material changes, cross-source
// attachment with canonical-link precedence, probable matches, scoped
// listing IDs, per-listing failure isolation, run claiming and scheduling,
// archive-instead-of-delete, and that retrieval never creates evaluations.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService, createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaManualOpportunityRepository,
  PrismaRetrievalSourceRepository,
  RetrievalSourceError,
} from "@ai-career/database";
import { readFileSync } from "node:fs";
import {
  createAdapterRegistry,
  createFixtureTransport,
  fixtureRequestKey,
  greenhouseAdapter,
  smartRecruitersAdapter,
  wellfoundAdapter,
  workableAdapter,
  workdayAdapter,
  workdayListBody,
  type TransportResponse,
} from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";
import { createTestAdapter, jsonResponse, testBoardUrl, type TestJob } from "../support/retrieval-test-adapter";

const database = getDatabaseClient();
const store = new PrismaRetrievalSourceRepository();
const repository = new PrismaManualOpportunityRepository();
const ats = createTestAdapter({ key: "test-ats", name: "Test ATS", sourceCategory: "ATS", sourceType: "ATS" });
const atsTwo = createTestAdapter({ key: "test-ats-two", name: "Second Test ATS", sourceCategory: "ATS", sourceType: "ATS" });
const aggregator = createTestAdapter({ key: "test-aggregator", name: "Test Aggregator", sourceCategory: "AGGREGATOR", sourceType: "API", attribution: "via Test Aggregator" });
const aggregatorTwo = createTestAdapter({ key: "test-aggregator-two", name: "Second Test Aggregator", sourceCategory: "AGGREGATOR", sourceType: "API" });
const responses: Record<string, Omit<TransportResponse, "url">> = {};
let clock = new Date("2026-10-18T09:00:00.000Z");
const worker = createRetrievalWorker({
  store,
  ingestion: createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() }),
  registry: createAdapterRegistry([ats, atsTwo, aggregator, aggregatorTwo, greenhouseAdapter]),
  transport: () => createFixtureTransport(responses),
  discovery: customerSuccessDiscoveryConfiguration,
  env: () => ({}),
  now: () => clock,
  log: { info: () => undefined, warn: () => undefined },
  lastChecked: (source, externalIds) => store.lastCheckedListings(source, externalIds),
});
const manual = createManualOpportunityService({ repository, normalizer: createManualOpportunityNormalizer() });

const tokens: string[] = [];
const sourceIds: string[] = [];

beforeEach(() => {
  clock = new Date("2026-10-18T09:00:00.000Z");
  for (const key of Object.keys(responses)) delete responses[key];
});

afterEach(async () => {
  const companies = await database.company.findMany({
    where: { OR: tokens.map((token) => ({ name: { contains: token } })) },
    select: { id: true },
  });
  const opportunityIds = (
    await database.opportunity.findMany({ where: { companyId: { in: companies.map((company) => company.id) } }, select: { id: true } })
  ).map((item) => item.id);
  const ids = sourceIds.splice(0);
  const scope = { OR: [{ retrievalSourceId: { in: ids } }, { opportunityId: { in: opportunityIds } }] };
  // Later observations first: earlier records are protected while a later
  // observation points at them.
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { ...scope, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  await database.company.deleteMany({ where: { id: { in: companies.map((company) => company.id) } } });
  await database.retrievalRun.deleteMany({ where: { retrievalSourceId: { in: ids } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: ids } } });
  tokens.splice(0);
});

afterAll(() => database.$disconnect());

function newToken() {
  const token = `R${randomUUID().slice(0, 8)}`;
  tokens.push(token);
  return token;
}

async function addSource(adapter: typeof ats, board: string, enabled = true) {
  const source = await store.create({
    adapterKey: adapter.key,
    name: `${adapter.name} ${board}`,
    domain: "customer-success",
    retrievalType: adapter.retrievalType,
    sourceCategory: adapter.sourceCategory,
    config: { board },
    scheduleMinutes: 720,
  });
  sourceIds.push(source.id);
  return enabled ? store.update(source.id, { enabled: true }) : source;
}

function serve(adapter: typeof ats, board: string, jobs: TestJob[], status = 200) {
  responses[testBoardUrl(adapter.key, board, 1)] = status === 200 ? jsonResponse({ jobs }) : jsonResponse({}, status);
}

async function run(sourceId: string) {
  await store.enqueueRun(sourceId, "MANUAL");
  const outcome = await worker.runOnce();
  expect(outcome?.sourceId).toBe(sourceId);
  return outcome!;
}

function csJob(token: string, overrides: Partial<TestJob> = {}): TestJob {
  return {
    id: "1001",
    title: "Customer Success Manager",
    company: `Acme ${token}`,
    location: "Remote - United States",
    html: "<p>Own onboarding, adoption and renewals for SaaS customers.</p><ul><li>Run business reviews</li></ul>",
    url: `https://boards.example.com/${token}/jobs/1001`,
    salary: { min: 85000, max: 100000, currency: "USD", period: "YEAR" },
    workplace: "REMOTE",
    updated_at: "2026-10-17T00:00:00Z",
    view_count: 10,
    ...overrides,
  };
}

async function recordsFor(opportunityId: string) {
  return database.sourceRecord.findMany({ where: { opportunityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

describe("retrieval ingestion", () => {
  it("creates unevaluated opportunities on the first run, and re-runs are idempotent", async () => {
    const token = newToken();
    const source = await addSource(ats, token);
    serve(ats, token, [csJob(token), { id: "2002", title: "Data Engineer", company: `Acme ${token}`, html: "<p>Work with Customer Success.</p>" }]);

    const first = await run(source.id);
    expect(first).toMatchObject({ status: "COMPLETED", counts: { fetched: 2, keptByTerms: 1, created: 1, failed: 0 } });
    const opportunity = await database.opportunity.findFirstOrThrow({ where: { company: { name: `Acme ${token}` } } });
    expect(opportunity).toMatchObject({
      status: "NORMALIZED",
      source: "test-ats",
      sourceType: "ATS",
      atsPlatform: "test-ats",
      remoteStatus: "REMOTE",
      jobDescription: "Own onboarding, adoption and renewals for SaaS customers.\n\n- Run business reviews",
    });
    expect(opportunity.salaryMin?.toNumber()).toBe(85000);
    const [record] = await recordsFor(opportunity.id);
    expect(record).toMatchObject({
      retrievalSourceId: source.id,
      retrievalRunId: first.runId,
      retrievalType: "OFFICIAL_PUBLIC_API_FEED",
      sourceCategory: "ATS",
      externalId: "1001",
      previousSourceRecordId: null,
    });
    expect(record!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((record!.rawPayload as { source: { view_count: number } }).source.view_count).toBe(10);
    expect(await database.fieldProvenance.count({ where: { opportunityId: opportunity.id, sourceReference: "retrieval:test-ats" } })).toBeGreaterThan(3);
    // Retrieval never evaluates.
    expect(await database.evaluation.count({ where: { opportunityId: opportunity.id } })).toBe(0);
    expect(await database.evaluationAdmission.count({ where: { opportunityId: opportunity.id } })).toBe(0);
    expect(await database.deferredEvaluation.count({ where: { opportunityId: opportunity.id } })).toBe(0);

    // Identical content an hour later: only last-seen times move.
    clock = new Date("2026-10-18T10:00:00.000Z");
    expect(await run(source.id)).toMatchObject({ status: "COMPLETED", counts: { unchanged: 1, created: 0, changed: 0 } });
    // Volatile metadata (counters, timestamps, tracking parameters) is not a change.
    clock = new Date("2026-10-18T11:00:00.000Z");
    serve(ats, token, [csJob(token, { updated_at: "2026-10-18T10:59:00Z", view_count: 999, url: `https://boards.example.com/${token}/jobs/1001?utm_source=feed` })]);
    expect(await run(source.id)).toMatchObject({ counts: { unchanged: 1, changed: 0 } });

    const records = await recordsFor(opportunity.id);
    expect(records).toHaveLength(1);
    expect(records[0]!.lastObservedAt.toISOString()).toBe("2026-10-18T11:00:00.000Z");
    expect(records[0]!.discoveredAt.toISOString()).toBe("2026-10-18T09:00:00.000Z");
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(after.lastSeenAt.toISOString()).toBe("2026-10-18T11:00:00.000Z");
    expect(after.firstSeenAt.toISOString()).toBe("2026-10-18T09:00:00.000Z");
    expect(await database.opportunity.count({ where: { company: { name: `Acme ${token}` } } })).toBe(1);
  });

  it("adds a linked observation when the description or a structured field changes, never overwriting the original", async () => {
    const token = newToken();
    const source = await addSource(ats, token);
    serve(ats, token, [csJob(token)]);
    await run(source.id);
    const opportunity = await database.opportunity.findFirstOrThrow({ where: { company: { name: `Acme ${token}` } } });

    clock = new Date("2026-10-19T09:00:00.000Z");
    serve(ats, token, [csJob(token, { html: "<p>Own onboarding, adoption, renewals and expansion for SaaS customers.</p>" })]);
    expect(await run(source.id)).toMatchObject({ counts: { changed: 1, created: 0, attached: 0 } });
    clock = new Date("2026-10-20T09:00:00.000Z");
    serve(ats, token, [csJob(token, { html: "<p>Own onboarding, adoption, renewals and expansion for SaaS customers.</p>", salary: { min: 90000, max: 110000, currency: "USD", period: "YEAR" } })]);
    expect(await run(source.id)).toMatchObject({ counts: { changed: 1 } });
    clock = new Date("2026-10-21T09:00:00.000Z");
    expect(await run(source.id)).toMatchObject({ counts: { unchanged: 1, changed: 0 } });

    const [original, changed, salaryChanged] = await recordsFor(opportunity.id);
    expect(original!.rawDescription).toBe("Own onboarding, adoption and renewals for SaaS customers.\n\n- Run business reviews");
    expect(changed).toMatchObject({ previousSourceRecordId: original!.id, opportunityId: opportunity.id });
    expect(changed!.rawDescription).toContain("expansion");
    expect(salaryChanged).toMatchObject({ previousSourceRecordId: changed!.id });
    expect(salaryChanged!.lastObservedAt.toISOString()).toBe("2026-10-21T09:00:00.000Z");
    const unchangedOpportunity = await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    // The canonical description and fields are the first-seen ones.
    expect(unchangedOpportunity.jobDescription).toBe(original!.rawDescription);
    expect(unchangedOpportunity.salaryMax?.toNumber()).toBe(100000);
    const detail = await repository.findOpportunityDetail(opportunity.id);
    expect(detail!.sourceRecords.map((item) => item.previousSourceRecordId)).toEqual([null, original!.id, changed!.id]);
    expect(detail!.sourceRecords[0]).toMatchObject({ retrievalSourceName: `Test ATS ${token}`, sourceCategory: "ATS" });
    // Older records cannot be deleted while a later observation points at them.
    await expect(database.sourceRecord.delete({ where: { id: original!.id } })).rejects.toThrow();
  });

  it("attaches an employer-ATS listing to the aggregator's opportunity and upgrades the application link", async () => {
    const token = newToken();
    const atsUrl = `https://boards.example.com/${token}/jobs/77`;
    const aggregatorSource = await addSource(aggregator, token);
    serve(aggregator, token, [csJob(token, { id: "agg-5", url: `https://aggregator.example.com/${token}/5`, apply_url: atsUrl })]);
    await run(aggregatorSource.id);
    const opportunity = await database.opportunity.findFirstOrThrow({ where: { company: { name: `Acme ${token}` } } });
    expect(opportunity.applicationUrl).toBe(atsUrl);

    const atsSource = await addSource(ats, token);
    serve(ats, token, [csJob(token, { id: "77", url: atsUrl, apply_url: `${atsUrl}/apply` })]);
    expect(await run(atsSource.id)).toMatchObject({ counts: { attached: 1, created: 0 } });
    const upgraded = await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(upgraded.applicationUrl).toBe(`${atsUrl}/apply`);
    const records = await recordsFor(opportunity.id);
    expect(records.map((item) => item.sourceCategory)).toEqual(["AGGREGATOR", "ATS"]);
    expect(records[1]).toMatchObject({ duplicateDecision: "MATCH", retrievalSourceId: atsSource.id });
    const linkProvenance = await database.fieldProvenance.findMany({
      where: { opportunityId: opportunity.id, fieldName: "applicationUrl" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(linkProvenance.at(-1)).toMatchObject({ sourceRecordId: records[1]!.id, kind: "DIRECT", sourceReference: "retrieval:test-ats" });

    // An aggregator seen after the ATS never downgrades the link.
    const later = await addSource(aggregatorTwo, token);
    serve(aggregatorTwo, token, [csJob(token, { id: "agg-9", url: `https://other-aggregator.example.com/${token}/9`, apply_url: atsUrl })]);
    expect(await run(later.id)).toMatchObject({ counts: { attached: 1 } });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).applicationUrl).toBe(`${atsUrl}/apply`);
  });

  it("never replaces an application link the user entered manually", async () => {
    const token = newToken();
    const atsUrl = `https://boards.example.com/${token}/jobs/88`;
    const saved = await manual.submit({
      rawText: "Customer Success Manager. Own onboarding, adoption and renewals for SaaS customers.",
      title: "Customer Success Manager",
      company: `Acme ${token}`,
      sourceUrl: atsUrl,
      applicationUrl: "https://acme.example.com/careers/apply/88",
      domain: "customer-success",
    });
    const source = await addSource(ats, token);
    serve(ats, token, [csJob(token, { id: "88", url: atsUrl, apply_url: `${atsUrl}/apply` })]);
    expect(await run(source.id)).toMatchObject({ counts: { attached: 1 } });
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: saved.opportunity.id } });
    expect(after.applicationUrl).toBe("https://acme.example.com/careers/apply/88");
    expect(await recordsFor(saved.opportunity.id)).toHaveLength(2);
  });

  it("creates a probable duplicate as its own opportunity and records the relationship", async () => {
    const token = newToken();
    await manual.submit({
      rawText: "Own onboarding, adoption and renewals for SaaS customers. Run business reviews.",
      title: "Customer Success Manager",
      company: `Acme ${token}`,
      location: "Remote - United States",
      domain: "customer-success",
    });
    const source = await addSource(ats, token);
    serve(ats, token, [csJob(token, { title: "Senior Customer Success Manager", html: "<p>Own onboarding, adoption and renewals for SaaS customers. Run business reviews.</p>" })]);
    expect(await run(source.id)).toMatchObject({ counts: { created: 1, probable: 1 } });
    const retrieved = await database.opportunity.findFirstOrThrow({ where: { company: { name: `Acme ${token}` }, source: "test-ats" } });
    // Pairs are stored newer → older; which side is newer depends on the
    // real capture time versus the test clock, so either direction is read.
    const reference = await database.duplicateReference.findFirstOrThrow({
      where: { OR: [{ opportunityId: retrieved.id }, { relatedOpportunityId: retrieved.id }] },
    });
    expect(reference).toMatchObject({ decision: "PROBABLE_MATCH", resolution: null });
    expect((reference.evidence as { recordedBy: string }).recordedBy).toBe("RETRIEVAL");
  });

  it("scopes listing IDs by source: the same ID from two sources is not the same listing", async () => {
    const token = newToken();
    const first = await addSource(ats, token);
    const second = await addSource(atsTwo, token);
    serve(ats, token, [csJob(token, { id: "100", url: `https://one.example.com/${token}/100` })]);
    serve(atsTwo, token, [
      csJob(token, { id: "100", title: "Onboarding Specialist", url: `https://two.example.com/${token}/100`, html: "<p>Guide new accounts through setup.</p>" }),
    ]);
    await run(first.id);
    expect(await run(second.id)).toMatchObject({ counts: { created: 1, attached: 0 } });
    expect(await database.opportunity.count({ where: { company: { name: `Acme ${token}` } } })).toBe(2);
  });

  it("keeps a listing that cannot be normalized, unlinked and only once, while the others are stored", async () => {
    const token = newToken();
    const source = await addSource(ats, token);
    serve(ats, token, [csJob(token, { id: "bad", html: "<p> </p>" }), csJob(token, { id: "good", url: `https://boards.example.com/${token}/good` })]);
    expect(await run(source.id)).toMatchObject({ status: "PARTIAL", errorCode: "LISTING_FAILURES", counts: { created: 1, failed: 1 } });
    clock = new Date("2026-10-18T12:00:00.000Z");
    await run(source.id);
    const preserved = await database.sourceRecord.findMany({ where: { retrievalSourceId: source.id, externalId: "bad" } });
    expect(preserved).toHaveLength(1);
    expect(preserved[0]).toMatchObject({ opportunityId: null, rawDescription: null });
    expect(preserved[0]!.lastObservedAt.toISOString()).toBe("2026-10-18T12:00:00.000Z");
  });

  it("records an access failure and a rate limit as failed runs with distinct codes", async () => {
    const token = newToken();
    const source = await addSource(ats, token);
    serve(ats, token, [], 403);
    await run(source.id);
    serve(ats, token, [], 429);
    await run(source.id);
    const runs = await store.listRuns(source.id);
    expect(runs.map((item) => [item.status, item.errorCode])).toEqual([
      ["FAILED", "RATE_LIMITED"],
      ["FAILED", "ACCESS_DENIED"],
    ]);
    expect(runs[1]!.errorMessage).toBe("The source refused access; retrieval stopped.");
  });
});

describe("verified Greenhouse adapter through the worker", () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true";
  const fixture = readFileSync("tests/fixtures/sources/greenhouse/response.json", "utf8");
  const fixtureIds = (JSON.parse(fixture) as { jobs: Array<{ id: number }> }).jobs.map((job) => String(job.id));

  // The fixture's real listing IDs are shared with any other run of it, so
  // its records are removed before and after.
  async function clearFixtureListings() {
    const records = await database.sourceRecord.findMany({ where: { source: "greenhouse", externalId: { in: fixtureIds } }, select: { opportunityId: true } });
    const opportunityIds = records.map((record) => record.opportunityId).filter((id): id is string => id !== null);
    for (;;) {
      const leaves = await database.sourceRecord.findMany({ where: { source: "greenhouse", externalId: { in: fixtureIds }, laterObservations: { none: {} } }, select: { id: true } });
      if (!leaves.length) break;
      await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
    }
    await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  }

  it("stores the Customer Success posting from the real fixture and treats a new updated_at as unchanged", async () => {
    await clearFixtureListings();
    try {
      const source = await store.create({ adapterKey: "greenhouse", name: "GitLab (fixture)", domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", config: { board: "gitlab" }, scheduleMinutes: 720 });
      sourceIds.push(source.id);
      await store.update(source.id, { enabled: true });
      responses[url] = { status: 200, contentType: "application/json", body: fixture };
      expect(await run(source.id)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 1, created: 1 } });
      const record = await database.sourceRecord.findFirstOrThrow({ where: { retrievalSourceId: source.id }, include: { opportunity: { include: { company: true } } } });
      expect(record).toMatchObject({ externalId: "8877426002", requisitionId: "7173", rawTitle: "Customer Success Architect", sourceCategory: "ATS" });
      expect(record.opportunity).toMatchObject({ title: "Customer Success Architect", location: "Remote, United States", status: "NORMALIZED", atsPlatform: "greenhouse" });
      expect(record.opportunity!.company!.name).toBe("GitLab");
      expect(record.opportunity!.jobDescription).not.toMatch(/&lt;|<p>/);

      const touched = JSON.parse(fixture) as { jobs: Array<{ updated_at: string }> };
      touched.jobs[0]!.updated_at = "2026-10-18T12:00:00-04:00";
      responses[url] = { status: 200, contentType: "application/json", body: JSON.stringify(touched) };
      clock = new Date("2026-10-18T13:00:00.000Z");
      expect(await run(source.id)).toMatchObject({ counts: { unchanged: 1, changed: 0, created: 0 } });
    } finally {
      await clearFixtureListings();
    }
  });
});

describe("SmartRecruiters detail requests through the worker", () => {
  // A worker with room for two detail requests per run, so that priority
  // and rotation show with a handful of postings.
  let requested: string[] = [];
  const rationed = createRetrievalWorker({
    store,
    ingestion: createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() }),
    registry: createAdapterRegistry([smartRecruitersAdapter]),
    transport: () => {
      const transport = createFixtureTransport(responses);
      requested = transport.requested;
      return transport;
    },
    discovery: customerSuccessDiscoveryConfiguration,
    env: () => ({}),
    now: () => clock,
    log: { info: () => undefined, warn: () => undefined },
    lastChecked: (source, externalIds) => store.lastCheckedListings(source, externalIds),
    maxDetailRequests: 2,
  });
  const detailFixture = JSON.parse(readFileSync("tests/fixtures/sources/smartrecruiters/detail-744000156080369.json", "utf8")) as Record<string, any>;
  const listUrl = (company: string) => `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`;
  const detailUrl = (company: string, id: string) => `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`;

  // Serves the list (newest first, one short page) and each posting's detail.
  function serveBoard(company: string, token: string, postings: Array<{ id: string; title: string; releasedDate: string }>) {
    for (const key of Object.keys(responses)) delete responses[key];
    const ordered = [...postings].sort((a, b) => b.releasedDate.localeCompare(a.releasedDate));
    responses[listUrl(company)] = jsonResponse({ offset: 0, limit: 100, totalFound: ordered.length, content: ordered.map(({ id, title, releasedDate }) => ({ id, name: title, releasedDate })) });
    for (const posting of ordered) {
      responses[detailUrl(company, posting.id)] = jsonResponse({
        ...detailFixture,
        id: posting.id,
        name: posting.title,
        releasedDate: posting.releasedDate,
        refNumber: `REF-${posting.id}`,
        company: { identifier: company, name: `Bosch ${token}` },
        location: { ...detailFixture.location, fullLocation: `City ${posting.id}, United States` },
        postingUrl: `https://jobs.smartrecruiters.com/${company}/${posting.id}`,
        applyUrl: `https://jobs.smartrecruiters.com/${company}/${posting.id}/apply`,
      });
    }
  }

  async function runRationed(sourceId: string) {
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await store.enqueueRun(sourceId, "MANUAL");
    const outcome = await rationed.runOnce();
    expect(outcome).toMatchObject({ sourceId, status: "COMPLETED" });
    // The detail requests of this run, by posting letter.
    return requested.filter((url) => url.includes("/postings/")).map((url) => letters.get(url.split("/").pop()!)!);
  }
  const letters = new Map<string, string>();

  it("sends detail requests to unseen postings first, oldest first, then rotates stored postings by last check", async () => {
    const token = newToken();
    const company = `Board${token}`;
    const prefix = `9${randomUUID().replace(/\D/g, "").slice(0, 9)}`;
    const posting = (letter: string, hour: number) => {
      const id = `${prefix}${letter.charCodeAt(0)}`;
      letters.set(id, letter);
      return { id, title: `Customer Success Manager ${letter.toUpperCase()} ${token}`, releasedDate: `2026-10-1${hour < 10 ? 6 : 7}T${String(hour % 10).padStart(2, "0")}:00:00.000Z` };
    };
    // a is the oldest posting, d the newest; a run may fetch two details.
    const board = [posting("a", 1), posting("b", 2), posting("c", 3), posting("d", 4)];
    const source = await store.create({ adapterKey: "smartrecruiters", name: `SmartRecruiters ${company}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", config: { company }, scheduleMinutes: 720 });
    sourceIds.push(source.id);
    await store.update(source.id, { enabled: true });
    serveBoard(company, token, board);

    // Unseen postings first, oldest first.
    expect(await runRationed(source.id)).toEqual(["a", "b"]);
    expect(await runRationed(source.id)).toEqual(["c", "d"]);
    // All stored: the longest since last checked go first.
    expect(await runRationed(source.id)).toEqual(["a", "b"]);
    expect(await runRationed(source.id)).toEqual(["c", "d"]);
    // A new posting goes ahead of every stored one, even though it is the
    // newest; the remaining request goes to the longest unchecked.
    board.push(posting("e", 15));
    serveBoard(company, token, board);
    expect(await runRationed(source.id)).toEqual(["e", "a"]);
    expect(await runRationed(source.id)).toEqual(["b", "c"]);
    expect(await runRationed(source.id)).toEqual(["d", "a"]);

    // Every posting was stored once, and the lookup reports each one's
    // latest check.
    const ids = board.map((item) => item.id);
    expect(await database.sourceRecord.count({ where: { source: "smartrecruiters", externalId: { in: ids } } })).toBe(5);
    const checked = await store.lastCheckedListings("smartrecruiters", [...ids, `${prefix}0`]);
    expect([...checked.keys()].sort()).toEqual([...ids].sort());
    expect(checked.get(board[3]!.id)!.toISOString()).toBe(clock.toISOString());
    // The lookup is scoped to the source key.
    expect((await store.lastCheckedListings("greenhouse", ids)).size).toBe(0);
  });
});

describe("Feature 11B adapters through the worker (real fixtures)", () => {
  const sourceWorker = createRetrievalWorker({
    store,
    ingestion: createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() }),
    registry: createAdapterRegistry([workdayAdapter, workableAdapter, wellfoundAdapter]),
    transport: () => createFixtureTransport(responses),
    discovery: customerSuccessDiscoveryConfiguration,
    env: () => ({}),
    now: () => clock,
    log: { info: () => undefined, warn: () => undefined },
    lastChecked: (source, externalIds) => store.lastCheckedListings(source, externalIds),
  });
  const csPath = "/job/USA-IL-Chicago/Revenue-Operations-Director--Global-Customer-Success_JR-0110682";
  const workdayList = readFileSync("tests/fixtures/sources/workday/response.json", "utf8");
  const workdayDetail = readFileSync("tests/fixtures/sources/workday/detail-JR-0110682.json", "utf8");
  const wellfoundPage = readFileSync("tests/fixtures/sources/wellfound/response.html", "utf8");
  const fixtureListings = [
    { source: "workday", externalId: { endsWith: csPath } },
    { source: "wellfound", externalId: { in: ["1716423", "4829861", "3886599"] } },
    { source: "workable", externalId: { in: ["1671f9c9-4f39-44b7-b44a-5889b15bfafd", "0686d816-4047-43c8-8fc9-e73eb6aa2bf2", "87fe7050-1014-4a7f-abdf-d982fed59223"] } },
  ];
  const fixtureCompanies = ["Workday, Inc.", "Pragma (formerly Logisy)", "Medsender", "Trackier", "ClickView", "DMED"];

  // The fixtures' real listing ids are shared with any other run of them,
  // so their records, opportunities and companies are removed before and after.
  async function clearFixtureListings() {
    const where = { OR: fixtureListings };
    const records = await database.sourceRecord.findMany({ where, select: { opportunityId: true } });
    const opportunityIds = records.map((record) => record.opportunityId).filter((id): id is string => id !== null);
    for (;;) {
      const leaves = await database.sourceRecord.findMany({ where: { OR: [...fixtureListings, { opportunityId: { in: opportunityIds } }], laterObservations: { none: {} } }, select: { id: true } });
      if (!leaves.length) break;
      await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
    }
    await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
    await database.company.deleteMany({ where: { name: { in: fixtureCompanies }, opportunities: { none: {} } } });
  }

  async function addAdapterSource(adapterKey: string, name: string, config: unknown, sourceCategory: "ATS" | "MARKETPLACE" | "JOB_BOARD", retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT" | "PUBLIC_HTML") {
    const source = await store.create({ adapterKey, name, domain: "customer-success", retrievalType, sourceCategory, config, scheduleMinutes: 720 });
    sourceIds.push(source.id);
    await store.update(source.id, { enabled: true });
    return source;
  }

  async function runSource(sourceId: string) {
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await store.enqueueRun(sourceId, "MANUAL");
    const outcome = await sourceWorker.runOnce();
    expect(outcome?.sourceId).toBe(sourceId);
    return outcome!;
  }

  function serveWorkday(host: string, tenant: string, site: string, detail = workdayDetail) {
    responses[fixtureRequestKey(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, workdayListBody(0))] = jsonResponse(JSON.parse(workdayList));
    responses[`https://${host}/wday/cxs/${tenant}/${site}${csPath}`] = jsonResponse(JSON.parse(detail));
  }

  it("stores the Workday posting once per tenant-scoped listing, attaches the same requisition from a second site, and ignores daily-changing fields", async () => {
    await clearFixtureListings();
    try {
      const first = await addAdapterSource("workday", "Workday (fixture)", { careerSite: "https://workday.wd5.myworkdayjobs.com/Workday" }, "ATS", "PUBLIC_GUEST_INTERNAL_ENDPOINT");
      serveWorkday("workday.wd5.myworkdayjobs.com", "workday", "Workday");
      expect(await runSource(first.id)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 1, created: 1 } });
      const record = await database.sourceRecord.findFirstOrThrow({ where: { retrievalSourceId: first.id }, include: { opportunity: { include: { company: true } } } });
      expect(record).toMatchObject({ externalId: `workday/Workday:${csPath}`, requisitionId: "JR-0110682", retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT", sourceCategory: "ATS" });
      expect(record.opportunity).toMatchObject({ status: "NORMALIZED", atsPlatform: "workday", salaryMin: null });
      expect(record.opportunity!.company!.name).toBe("Workday, Inc.");
      expect(await database.evaluation.count({ where: { opportunityId: record.opportunityId! } })).toBe(0);

      // The same path at another site is a different listing: it is not a
      // re-observation, and the same requisition at the same company attaches.
      const second = await addAdapterSource("workday", "Workday second site (fixture)", { careerSite: "https://workday.wd5.myworkdayjobs.com/en-US/Workday_Careers" }, "ATS", "PUBLIC_GUEST_INTERNAL_ENDPOINT");
      serveWorkday("workday.wd5.myworkdayjobs.com", "workday", "Workday_Careers");
      expect(await runSource(second.id)).toMatchObject({ status: "COMPLETED", counts: { attached: 1, unchanged: 0, created: 0 } });
      const records = await database.sourceRecord.findMany({ where: { opportunityId: record.opportunityId! }, orderBy: { createdAt: "asc" } });
      expect(records.map((row) => row.externalId)).toEqual([`workday/Workday:${csPath}`, `workday/Workday_Careers:${csPath}`]);

      // Next day: postedOn, timeLeftToApply and similarJobs change; nothing material does.
      const touched = JSON.parse(workdayDetail);
      touched.jobPostingInfo.postedOn = "Posted 4 Days Ago";
      touched.jobPostingInfo.timeLeftToApply = "29 days left to apply";
      touched.similarJobs = [];
      serveWorkday("workday.wd5.myworkdayjobs.com", "workday", "Workday", JSON.stringify(touched));
      expect(await runSource(first.id)).toMatchObject({ status: "COMPLETED", counts: { unchanged: 1, changed: 0, created: 0 } });
    } finally {
      await clearFixtureListings();
    }
  });

  it("stores the Workable Customer Success jobs with their complete text as job-board listings, ignoring freshness stamps on re-run", async () => {
    await clearFixtureListings();
    try {
      const source = await addAdapterSource("workable", "Workable (fixture)", {}, "JOB_BOARD", "PUBLIC_GUEST_INTERNAL_ENDPOINT");
      const page = JSON.parse(readFileSync("tests/fixtures/sources/workable/response.json", "utf8"));
      // One page only, so the run completes without page 2.
      responses["https://jobs.workable.com/api/v1/jobs?query=customer%20success"] = jsonResponse({ ...page, nextPageToken: null });
      expect(await runSource(source.id)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 2, created: 2 } });
      const records = await database.sourceRecord.findMany({ where: { retrievalSourceId: source.id }, include: { opportunity: { include: { company: true } } }, orderBy: { externalId: "asc" } });
      expect(records.map((row) => [row.externalId, row.sourceCategory, row.opportunity?.company?.name, row.opportunity?.remoteStatus])).toEqual([
        ["0686d816-4047-43c8-8fc9-e73eb6aa2bf2", "JOB_BOARD", "ClickView", "REMOTE"],
        ["1671f9c9-4f39-44b7-b44a-5889b15bfafd", "JOB_BOARD", "Trackier", "ONSITE"],
      ]);
      expect(records[1]!.opportunity!.jobDescription).toContain("B.Tech/BE degree is mandatory.");
      page.jobs[0].updated = "2026-10-20T00:00:00.000Z";
      responses["https://jobs.workable.com/api/v1/jobs?query=customer%20success"] = jsonResponse({ ...page, totalSize: 4000, nextPageToken: null });
      expect(await runSource(source.id)).toMatchObject({ status: "COMPLETED", counts: { unchanged: 2, changed: 0, created: 0 } });
    } finally {
      await clearFixtureListings();
    }
  });

  it("stores the Wellfound Customer Success listings from the embedded state as marketplace listings and re-runs idempotently", async () => {
    await clearFixtureListings();
    try {
      const source = await addAdapterSource("wellfound", "Wellfound (fixture)", {}, "MARKETPLACE", "PUBLIC_HTML");
      // One page only, so the run completes without a page 2.
      responses["https://wellfound.com/role/customer-success-specialist"] = {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: wellfoundPage.replace(/"pageCount":\s*11/, '"pageCount": 1'),
      };
      expect(await runSource(source.id)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 2, created: 2 } });
      const records = await database.sourceRecord.findMany({ where: { retrievalSourceId: source.id }, include: { opportunity: { include: { company: true } } }, orderBy: { externalId: "asc" } });
      expect(records.map((row) => [row.externalId, row.sourceCategory, row.retrievalType, row.opportunity?.company?.name])).toEqual([
        ["1716423", "MARKETPLACE", "PUBLIC_HTML", "Pragma (formerly Logisy)"],
        ["4829861", "MARKETPLACE", "PUBLIC_HTML", "Medsender"],
      ]);
      for (const row of records) {
        expect(row.opportunity!.salaryMin).toBeNull();
        expect(row.opportunity!.jobDescription).not.toMatch(/\*\*|&amp;/);
        expect(await database.evaluation.count({ where: { opportunityId: row.opportunityId! } })).toBe(0);
      }
      expect(await runSource(source.id)).toMatchObject({ status: "COMPLETED", counts: { unchanged: 2, created: 0, changed: 0 } });
    } finally {
      await clearFixtureListings();
    }
  });
});

describe("retrieval runs and sources", () => {
  it("allows one queued or running run per source and a single claim of it", async () => {
    const token = newToken();
    const source = await addSource(ats, token);
    const first = await store.enqueueRun(source.id, "MANUAL");
    const second = await store.enqueueRun(source.id, "MANUAL");
    expect(second).toMatchObject({ alreadyActive: true, run: { id: first.run.id } });
    const claims = await Promise.all([store.claimNextRun(clock), store.claimNextRun(clock)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)!.run).toMatchObject({ id: first.run.id, status: "RUNNING" });
    expect((await store.enqueueRun(source.id, "MANUAL")).alreadyActive).toBe(true);
    // A run left RUNNING by a stopped worker is closed when its lease ends.
    expect(await store.failInterruptedRuns(new Date(clock.getTime() + 16 * 60_000))).toBe(1);
    expect((await store.listRuns(source.id))[0]).toMatchObject({ status: "FAILED", errorCode: "WORKER_INTERRUPTED" });
  });

  it("queues scheduled runs only for enabled sources whose interval has passed", async () => {
    const token = newToken();
    const enabled = await addSource(ats, token);
    const disabled = await addSource(ats, `${token}-off`, false);
    expect(await store.enqueueDueRuns(clock)).toBe(1);
    const claimed = await store.claimNextRun(clock);
    expect(claimed?.run).toMatchObject({ retrievalSourceId: enabled.id, trigger: "SCHEDULE" });
    await store.finishRun(claimed!.run.id, { status: "COMPLETED", counts: { fetched: 0, keptByTerms: 0, created: 0, attached: 0, unchanged: 0, changed: 0, probable: 0, failed: 0 }, errorCode: null, errorMessage: null });
    expect(await store.enqueueDueRuns(new Date(clock.getTime() + 60 * 60_000))).toBe(0);
    expect(await store.enqueueDueRuns(new Date(clock.getTime() + 12 * 60 * 60_000))).toBe(1);
    await expect(store.enqueueRun(disabled.id, "MANUAL")).rejects.toBeInstanceOf(RetrievalSourceError);
    // A queued run whose source is disabled before it starts never runs.
    await store.update(enabled.id, { enabled: false });
    expect(await store.claimNextRun(clock)).toBeNull();
    expect((await store.listRuns(enabled.id))[0]).toMatchObject({ status: "FAILED", errorCode: "SOURCE_DISABLED" });
  });

  it("archives a source that produced runs or records instead of deleting it, and deletes one that never ran", async () => {
    const token = newToken();
    const used = await addSource(ats, token);
    serve(ats, token, [csJob(token)]);
    await run(used.id);
    expect(await store.remove(used.id)).toBe("ARCHIVED");
    const archived = await store.get(used.id);
    expect(archived).toMatchObject({ enabled: false });
    expect(archived!.archivedAt).not.toBeNull();
    expect(await database.sourceRecord.count({ where: { retrievalSourceId: used.id } })).toBe(1);
    // The database itself refuses to delete a source with history.
    await expect(database.retrievalSource.delete({ where: { id: used.id } })).rejects.toThrow();
    await expect(store.update(used.id, { enabled: true })).rejects.toMatchObject({ code: "SOURCE_ARCHIVED" });
    expect(await store.restore(used.id)).toMatchObject({ archivedAt: null, enabled: false });

    const unused = await addSource(ats, `${token}-new`, false);
    expect(await store.remove(unused.id)).toBe("DELETED");
    expect(await store.get(unused.id)).toBeNull();
  });
});
