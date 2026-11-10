// Feature 14B on the isolated test database: the extension companion's API
// with the real repositories, retrieval ingestion and evaluation service
// (fixture provider transport only; nothing reaches the network). Covers
// pairing (hash only, revoke), captures as retrieved listings with
// browser-extension provenance (created, unchanged, changed), attachment to
// an ATS listing without replacing its employer link, LinkedIn captures
// attaching to the 14A listing, possible duplicates, lookup, that a capture
// creates no evaluation, admission or reservation, and the evaluation
// wrappers reaching the existing request and status paths.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaDuplicateRepository,
  PrismaEvaluationQueryRepository,
  PrismaEvaluationRepository,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  withDuplicateSpendLock,
} from "@ai-career/database";
import { buildRetrievedListing, linkedInJobUrl } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createBudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationApiHandlers } from "../../apps/web/src/server/evaluation-api";
import { createEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createExtensionApiHandlers, evaluationSummaryReader } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createCleanup, createProfile, database, runWorker, semanticConfig, tasks } from "../support/budget-integration";

const cleanup = createCleanup();
const repository = new PrismaManualOpportunityRepository();
const ingestion = createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() });
const budget = createBudgetService({ now: () => new Date(), pricingCurrencies: () => ["USD"] });
const evaluations = createEvaluationService({
  queries: new PrismaEvaluationQueryRepository(),
  evaluations: new PrismaEvaluationRepository(),
  tasks,
  semanticConfig,
  jobMaxAttempts: 1,
  admissionGate: budget.gate,
  duplicates: new PrismaDuplicateRepository(),
  duplicateSpendLock: (work) => withDuplicateSpendLock(work),
});
// The existing evaluation API handlers, as the production wrappers call them.
const existingEvaluationApi = createEvaluationApiHandlers(evaluations);
const api = createExtensionApiHandlers({
  pairings: new PrismaExtensionPairingRepository(),
  captures: createExtensionCaptureService({
    ingestion,
    lookup: new PrismaExtensionLookupRepository(),
    latestEvaluation: evaluationSummaryReader(evaluations),
    discovery: customerSuccessDiscoveryConfiguration,
  }),
  evaluation: {
    request: (request, id) => existingEvaluationApi.post(request, id),
    status: (request, id) => existingEvaluationApi.get(id, new URL(request.url).searchParams.get("evaluationId")),
  },
});

const pairingIds: string[] = [];
let activeBefore: { userProfileId: string } | null = null;

beforeEach(async () => {
  await cleanup.before();
  activeBefore = await database.activeUserProfile.findUnique({ where: { domain: "customer-success" }, select: { userProfileId: true } });
});

afterEach(async () => {
  const opportunityIds = [...new Set(cleanup.opportunityIds)];
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  // Later observations first: an earlier record is protected while a later
  // observation points at it.
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  if (activeBefore) {
    await database.activeUserProfile.upsert({
      where: { domain: "customer-success" },
      create: { domain: "customer-success", userProfileId: activeBefore.userProfileId },
      update: { userProfileId: activeBefore.userProfileId },
    });
  }
  await cleanup.after();
  if (!activeBefore) await database.activeUserProfile.deleteMany({ where: { domain: "customer-success" } });
  await database.extensionPairing.deleteMany({ where: { id: { in: pairingIds.splice(0) } } });
});

afterAll(() => database.$disconnect());

const appOrigin = "http://127.0.0.1:3000";
const sameOrigin = (path: string, body: unknown = {}) =>
  new Request(`${appOrigin}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: appOrigin, host: "127.0.0.1:3000" },
  });

async function pair(label = "Integration browser") {
  const response = await api.createPairing(sameOrigin("/api/extension/pairings", { label }));
  expect(response.status).toBe(201);
  const body = (await response.json()) as { credential: string; pairing: { id: string } };
  pairingIds.push(body.pairing.id);
  return body;
}

function fromExtension(credential: string, path: string, init: { method?: string; body?: unknown } = {}) {
  return new Request(`${appOrigin}${path}`, {
    method: init.method ?? "GET",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      authorization: `Bearer ${credential}`,
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

const envelope = (pageUrl: string, fields: Record<string, unknown>, extractor = "structured-data") => ({
  schemaVersion: extensionCaptureSchemaVersion,
  pageUrl,
  extractor,
  capturedAt: new Date().toISOString(),
  extensionVersion: "0.1.0",
  fields,
});

const description = (token: string) =>
  [
    `Customer Success Manager at Capture SaaS ${token}.`,
    "Remote. Applicants must reside in the United States.",
    "Own onboarding, adoption, renewals and business reviews.",
  ].join("\n");

async function capture(credential: string, body: unknown) {
  const response = await api.capture(fromExtension(credential, "/api/extension/captures", { method: "POST", body }));
  const json = (await response.json()) as Record<string, unknown> & { opportunityId: string };
  if (json.opportunityId) cleanup.opportunityIds.push(json.opportunityId);
  return { status: response.status, body: json };
}

async function noSpendFor(opportunityId: string) {
  expect(await database.evaluation.count({ where: { opportunityId } })).toBe(0);
  expect(await database.evaluationTask.count({ where: { evaluation: { opportunityId } } })).toBe(0);
  expect(await database.evaluationAdmission.count({ where: { opportunityId } })).toBe(0);
  expect(await database.evaluationBudgetReservation.count({ where: { admission: { opportunityId } } })).toBe(0);
  expect(await database.deferredEvaluation.count({ where: { opportunityId } })).toBe(0);
  expect(await database.semanticOperationAttempt.count({ where: { evaluation: { opportunityId } } })).toBe(0);
}

describe("extension pairing", () => {
  it("stores only the credential's hash, records use, and stops working when revoked", async () => {
    const { credential, pairing } = await pair();
    const stored = await database.extensionPairing.findUniqueOrThrow({ where: { id: pairing.id } });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(credential);
    expect(stored.lastUsedAt).toBeNull();

    expect((await api.status(fromExtension(credential, "/api/extension/status"))).status).toBe(200);
    expect((await database.extensionPairing.findUniqueOrThrow({ where: { id: pairing.id } })).lastUsedAt).not.toBeNull();

    const revoked = await api.revokePairing(sameOrigin(`/api/extension/pairings/${pairing.id}/revoke`), pairing.id);
    expect(revoked.status).toBe(200);
    const after = await api.status(fromExtension(credential, "/api/extension/status"));
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ code: "PAIRING_INVALID" });
  });
});

describe("extension captures", () => {
  it("save an unrecognized site's page as an aggregator listing, re-observe it unchanged, record a changed version, and spend nothing", async () => {
    const { credential, pairing } = await pair();
    const token = randomUUID().slice(0, 8);
    const pageUrl = `https://careers.capture-${token}.example/roles/csm?utm_source=newsletter`;
    const fields = { title: "Customer Success Manager", description: description(token), company: `Capture SaaS ${token}`, location: "Remote - United States" };

    const first = await capture(credential, { ...envelope(pageUrl, fields, "main-content"), editedFields: ["company"] });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ outcome: "CREATED", sourceCategory: "AGGREGATOR", site: { knownHost: false }, evaluation: null, probableDuplicate: false });
    const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: first.body.opportunityId } });
    expect(record).toMatchObject({
      source: "browser-extension",
      sourceType: "BROWSER_EXTENSION",
      retrievalType: "BROWSER_ASSISTED",
      sourceCategory: "AGGREGATOR",
      retrievalSourceId: null,
      sourceUrl: `https://careers.capture-${token}.example/roles/csm`,
      applicationUrl: null,
      externalId: `careers.capture-${token}.example:careers.capture-${token}.example/roles/csm`,
    });
    expect(record.sourceMetadata).toMatchObject({
      sourceName: `careers.capture-${token}.example (browser extension)`,
      capture: { pairingId: pairing.id, extractor: "main-content", host: `careers.capture-${token}.example`, knownHost: false, editedFields: ["company"] },
    });
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: first.body.opportunityId } });
    expect(opportunity).toMatchObject({ applicationUrl: null, title: "Customer Success Manager" });
    expect(await database.retrievedListing.count({ where: { opportunityId: first.body.opportunityId } })).toBe(0);

    const repeat = await capture(credential, envelope(pageUrl, fields, "main-content"));
    expect(repeat).toMatchObject({ status: 200, body: { outcome: "UNCHANGED", opportunityId: first.body.opportunityId } });
    const changed = await capture(credential, envelope(pageUrl, { ...fields, description: `${description(token)}\nNow hiring two roles.` }, "main-content"));
    expect(changed).toMatchObject({ status: 200, body: { outcome: "CHANGED", opportunityId: first.body.opportunityId } });
    expect(await database.sourceRecord.count({ where: { opportunityId: first.body.opportunityId } })).toBe(2);
    expect(await database.opportunity.count({ where: { company: { name: `Capture SaaS ${token}` } } })).toBe(1);
    await noSpendFor(first.body.opportunityId);
  });

  it("attach to an ATS listing without replacing its employer application link", async () => {
    const { credential } = await pair();
    const token = randomUUID().slice(0, 8);
    const atsUrl = `https://boards.greenhouse.io/capture${token}/jobs/1001`;
    const employerLink = `https://capture-${token}.example/careers/apply/1001`;
    const ats = await ingestion.ingest(
      buildRetrievedListing(
        { key: "greenhouse", name: "Greenhouse", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
        {
          externalId: `1001-${token}`,
          title: "Customer Success Manager",
          company: `Capture SaaS ${token}`,
          location: "Remote - United States",
          description: description(token),
          sourceUrl: atsUrl,
          applicationUrl: employerLink,
          sourceItem: { id: 1001 },
        },
        { domain: "customer-success", discoveredAt: new Date() },
      ),
    );
    cleanup.opportunityIds.push(ats.opportunityId);

    // An aggregator page that links to the ATS posting.
    const result = await capture(
      credential,
      envelope(`https://jobs-aggregator-${token}.example/listing/77`, {
        title: "Customer Success Manager",
        description: description(token),
        company: `Capture SaaS ${token}`,
        applicationUrl: atsUrl,
      }),
    );
    expect(result.body).toMatchObject({ outcome: "ATTACHED", opportunityId: ats.opportunityId, sourceCategory: "AGGREGATOR" });
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: ats.opportunityId } });
    expect(opportunity.applicationUrl).toBe(employerLink);
    await noSpendFor(ats.opportunityId);
  });

  it("attach a LinkedIn job page captured in the user's browser to the listing 14A stored", async () => {
    const { credential } = await pair();
    const token = randomUUID().slice(0, 8);
    const jobId = String(4_200_000_000 + Math.floor(Math.random() * 99_999_999));
    const stored = await ingestion.ingest(
      buildRetrievedListing(
        { key: "linkedin", name: "LinkedIn", attribution: null, sourceType: "PUBLIC_SEARCH", retrievalType: "BROWSER_ASSISTED", sourceCategory: "JOB_BOARD" },
        {
          externalId: jobId,
          title: "Customer Success Manager",
          company: `Capture SaaS ${token}`,
          location: "Denver, CO",
          description: description(token),
          sourceUrl: linkedInJobUrl(jobId),
          applicationUrl: null,
          sourceItem: { id: jobId },
        },
        { domain: "customer-success", discoveredAt: new Date() },
      ),
    );
    cleanup.opportunityIds.push(stored.opportunityId);

    const result = await capture(
      credential,
      envelope(
        `https://www.linkedin.com/jobs/search/?currentJobId=${jobId}&keywords=customer%20success`,
        { title: "Customer Success Manager", description: description(token), company: `Capture SaaS ${token}`, location: "Denver, CO", siteJobId: jobId },
        "site:linkedin",
      ),
    );
    expect(result.body).toMatchObject({ outcome: "ATTACHED", opportunityId: stored.opportunityId, site: { name: "LinkedIn" }, sourceCategory: "JOB_BOARD" });
    const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: stored.opportunityId, source: "browser-extension" } });
    expect(record).toMatchObject({ externalId: `linkedin:${jobId}`, sourceUrl: linkedInJobUrl(jobId) });

    const feed = await api.capture(fromExtension(credential, "/api/extension/captures", { method: "POST", body: envelope("https://www.linkedin.com/feed/", { title: "x", description: "y" }) }));
    expect(feed.status).toBe(422);
  });

  it("flag a possible duplicate of an existing opportunity", async () => {
    const { credential } = await pair();
    const token = randomUUID().slice(0, 8);
    const fields = { title: "Customer Success Manager", description: description(token), company: `Capture SaaS ${token}`, location: "Remote - United States" };
    const first = await capture(credential, envelope(`https://first-${token}.example/jobs/1`, fields));
    const second = await capture(credential, envelope(`https://second-${token}.example/jobs/2`, fields));
    expect(first.body.outcome).toBe("CREATED");
    expect(second.body).toMatchObject({ outcome: "CREATED", decision: "PROBABLE_MATCH", probableDuplicate: true });
    expect(second.body.opportunityId).not.toBe(first.body.opportunityId);
  });

  it("are looked up by page before anything is read, read-only", async () => {
    const { credential } = await pair();
    const token = randomUUID().slice(0, 8);
    const pageUrl = `https://careers.lookup-${token}.example/roles/9`;
    const lookup = async (url: string) => (await api.lookup(fromExtension(credential, `/api/extension/lookup?url=${encodeURIComponent(url)}`))).json();
    expect(await lookup(pageUrl)).toMatchObject({ found: false, supported: true, site: { knownHost: false } });
    const saved = await capture(credential, envelope(pageUrl, { title: "Customer Success Manager", description: description(token), company: `Capture SaaS ${token}` }));
    expect(await lookup(`${pageUrl}?utm_campaign=x`)).toMatchObject({ found: true, opportunityId: saved.body.opportunityId, title: "Customer Success Manager", evaluation: null });
    expect(await lookup("https://www.linkedin.com/feed/")).toMatchObject({ found: false, supported: false });
  });
});

describe("evaluation from the extension", () => {
  it("is requested only on the explicit request, through the existing path, and its persisted state is read back", async () => {
    const { credential } = await pair();
    const profile = await createProfile(cleanup);
    await database.activeUserProfile.upsert({
      where: { domain: "customer-success" },
      create: { domain: "customer-success", userProfileId: profile.id },
      update: { userProfileId: profile.id },
    });
    const token = randomUUID().slice(0, 8);
    const pageUrl = `https://careers.evaluate-${token}.example/roles/1`;
    const fields = {
      title: "Customer Success Manager",
      description: [
        `Customer Success Manager at Evaluate SaaS ${token}, a SaaS workflow platform.`,
        "Remote. Applicants must reside in the United States.",
        "Salary $72,000-$88,000. No travel required.",
        "Own onboarding, adoption, education, retention, and business reviews.",
        "3 years of Customer Success experience required.",
      ].join("\n"),
      company: `Evaluate SaaS ${token}`,
      location: "Remote - United States",
      salaryText: "$72,000-$88,000",
    };
    const saved = await capture(credential, envelope(pageUrl, fields));
    const opportunityId = saved.body.opportunityId;
    await noSpendFor(opportunityId);
    const statusPath = `/api/extension/opportunities/${opportunityId}/evaluation`;
    expect((await api.evaluationStatus(fromExtension(credential, statusPath), opportunityId)).status).toBe(404);

    const requested = await api.requestEvaluation(
      fromExtension(credential, `/api/extension/opportunities/${opportunityId}/evaluation-requests`, { method: "POST", body: {} }),
      opportunityId,
    );
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({ outcome: "QUEUED" });
    const queued = await (await api.evaluationStatus(fromExtension(credential, statusPath), opportunityId)).json();
    expect(queued).toMatchObject({ status: "PENDING", queueState: "QUEUED", recommendation: null });

    expect((await runWorker())?.status).toBe("COMPLETED");
    const completed = (await (await api.evaluationStatus(fromExtension(credential, statusPath), opportunityId)).json()) as {
      queueState: string;
      recommendation: { decision: string } | null;
    };
    expect(completed.queueState).toBe("COMPLETED");
    expect(completed.recommendation?.decision).toEqual(expect.any(String));

    // A repeat capture reports the persisted result, read-only.
    const again = await capture(credential, envelope(pageUrl, fields));
    expect(again.body).toMatchObject({ outcome: "UNCHANGED", evaluation: { queueState: "COMPLETED", recommendation: { decision: completed.recommendation?.decision } } });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(1);
  });
});
