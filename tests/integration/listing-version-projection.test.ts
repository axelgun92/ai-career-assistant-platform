// Current-version projection of a changed listing (Core TDD §51, v1.15) on
// the isolated test database. A CHANGED observation of the listing an
// opportunity was found from keeps every version, re-normalizes the new one
// and makes it the opportunity's current facts, superseding (never deleting)
// the earlier provenance. Attached copies from other sources and manual
// opportunities are never re-projected, a value the user corrected stays,
// nothing is evaluated automatically, and an evaluation stays bound to the
// version it evaluated. Synthetic listings and the deterministic fixture
// transport only; nothing reaches the network or a provider.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService, createRetrievalIngestionService, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  findListingVersionHint,
  PrismaEvaluationRepository,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityLifecycleRepository,
} from "@ai-career/database";
import { buildRetrievedListing, type RetrievedListingInput } from "@ai-career/discovery";
import { createEvaluationWorker, type SemanticProviderTransport } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { createExtensionApiHandlers } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { createCustomerSuccessFixtureTransport } from "../fixtures/customer-success";
import { createCleanup, createHarness, createProfile, database, semanticConfig, tasks } from "../support/budget-integration";

const cleanup = createCleanup();
const repository = new PrismaManualOpportunityRepository();
const ingestion = createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() });
const manual = createManualOpportunityService({ repository, normalizer: createManualOpportunityNormalizer() });
const evaluations = new PrismaEvaluationRepository();
const pairingIds: string[] = [];

beforeEach(() => cleanup.before());
afterEach(async () => {
  const opportunityIds = [...new Set(cleanup.opportunityIds)];
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  // Later observations point at earlier ones, so delete from the newest.
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: { in: pairingIds.splice(0) } } });
});
afterAll(() => database.$disconnect());

const ats = { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" } as const;
const board = { key: "test-board", name: "Test Board", attribution: null, sourceType: "API", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "JOB_BOARD" } as const;

const body = (token: string, ...lines: string[]) =>
  [
    ...lines,
    `Own onboarding, adoption and renewals for a book of mid-market SaaS customers (${token}).`,
    "Run quarterly business reviews, build success plans and partner with Sales on expansion.",
    "3+ years of Customer Success experience in B2B SaaS.",
  ].join("\n");

function job(token: string) {
  const externalId = `job-${token}`;
  const sourceUrl = `https://ats.example.test/${token}/jobs/1`;
  const base = (): RetrievedListingInput => ({
    externalId,
    title: "Customer Success Manager",
    company: `Versionco ${token}`,
    location: "Austin, TX",
    description: body(token),
    sourceUrl,
    applicationUrl: `${sourceUrl}/apply`,
    sourceItem: {},
  });
  let day = 0;
  return {
    externalId,
    sourceUrl,
    async observe(changes: Partial<RetrievedListingInput> = {}, adapter: typeof ats | typeof board = ats) {
      day += 1;
      const raw = buildRetrievedListing(adapter, { ...base(), ...changes }, { domain: "customer-success", discoveredAt: new Date(Date.UTC(2026, 9, day, 9)) });
      const result = await ingestion.ingest(raw);
      cleanup.opportunityIds.push(result.opportunityId);
      return result;
    },
  };
}

const records = (opportunityId: string) =>
  database.sourceRecord.findMany({ where: { opportunityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const provenanceOf = (opportunityId: string, fieldName?: string) =>
  database.fieldProvenance.findMany({ where: { opportunityId, ...(fieldName ? { fieldName } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const currentOf = async (opportunityId: string, fieldName: string) =>
  (await provenanceOf(opportunityId, fieldName)).filter((row) => row.supersededAt === null);
const opportunityOf = (id: string) => database.opportunity.findUniqueOrThrow({ where: { id }, include: { company: true } });

const projectedFieldNames = [
  "title", "company.name", "location", "remoteStatus", "employmentType", "seniority", "department",
  "timeZoneRequirements", "residencyRequirement", "residencyRegions", "salaryText", "salaryMin", "salaryMax",
  "currency", "postingDate", "closingDate", "jobDescription",
];

describe("a changed originating listing re-projects the opportunity's current facts", () => {
  it("1 and 15: Hybrid → Remote keeps both versions, and the opportunity is Remote", async () => {
    const listing = job(randomUUID().slice(0, 8));
    const first = await listing.observe({ structured: { workplaceType: "HYBRID" } });
    expect(first.outcome).toBe("CREATED");
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ remoteStatus: "HYBRID" });
    const second = await listing.observe({ structured: { workplaceType: "REMOTE" } });
    expect(second).toMatchObject({ outcome: "CHANGED", opportunityId: first.opportunityId });

    const [v1, v2] = await records(first.opportunityId);
    expect(v1!.id).toBe(first.sourceRecordId);
    expect(v2).toMatchObject({ id: second.sourceRecordId, previousSourceRecordId: v1!.id });
    expect(v1!.sourceMetadata).toMatchObject({ structured: { workplaceType: "HYBRID" } });
    expect(v2!.sourceMetadata).toMatchObject({ structured: { workplaceType: "REMOTE" } });
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ remoteStatus: "REMOTE" });
    expect(await currentOf(first.opportunityId, "remoteStatus")).toEqual([
      expect.objectContaining({ sourceRecordId: v2!.id, normalizedValue: "REMOTE", sourceField: "source.workplaceType" }),
    ]);
  });

  it("2 and 3: a changed location and salary become current, with the earlier values kept as history", async () => {
    const listing = job(randomUUID().slice(0, 8));
    const salaryA = { salaryMin: 90000, salaryMax: 100000, salaryCurrency: "USD", salaryPeriod: "YEAR" } as const;
    const salaryB = { salaryMin: 105000, salaryMax: 120000, salaryCurrency: "USD", salaryPeriod: "YEAR" } as const;
    const first = await listing.observe({ structured: salaryA });
    const before = await opportunityOf(first.opportunityId);
    expect(before.location).toBe("Austin, TX");
    expect(before.salaryMax?.toNumber()).toBe(100000);

    await listing.observe({ location: "Denver, CO", structured: salaryB });
    const after = await opportunityOf(first.opportunityId);
    expect(after.location).toBe("Denver, CO");
    expect(after.salaryMin?.toNumber()).toBe(105000);
    expect(after.salaryMax?.toNumber()).toBe(120000);
    expect(after.currency).toBe("USD");
    const [v1, v2] = await records(first.opportunityId);
    expect(await currentOf(first.opportunityId, "location")).toEqual([expect.objectContaining({ sourceRecordId: v2!.id, normalizedValue: "Denver, CO" })]);
    expect(await currentOf(first.opportunityId, "salaryMax")).toEqual([expect.objectContaining({ sourceRecordId: v2!.id, normalizedValue: 120000 })]);
    const history = (await provenanceOf(first.opportunityId)).filter((row) => row.supersededAt !== null);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "location", sourceRecordId: v1!.id, normalizedValue: "Austin, TX" }),
      expect.objectContaining({ fieldName: "salaryMax", sourceRecordId: v1!.id, normalizedValue: 100000 }),
    ]));
  });

  it("4 and 5: a changed closing date becomes current, and a fact the newest version no longer states becomes Unknown", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const pay = "The base salary range for this role is $120,000 - $140,000 per year.";
    const first = await listing.observe({ description: body(token, "Anticipated role close date: 11/30/2026", pay) });
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ closingDate: new Date("2026-11-30T00:00:00.000Z"), salaryText: pay });

    await listing.observe({ description: body(token, "Anticipated role close date: 12/15/2026", pay) });
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ closingDate: new Date("2026-12-15T00:00:00.000Z"), salaryText: pay });

    // The newest version states neither a close date nor pay: both become
    // Unknown, with no current provenance; every earlier statement is kept.
    await listing.observe({ description: body(token) });
    const current = await opportunityOf(first.opportunityId);
    expect(current).toMatchObject({ closingDate: null, salaryText: null });
    expect(current.salaryMin).toBeNull();
    expect(await currentOf(first.opportunityId, "closingDate")).toEqual([]);
    expect(await currentOf(first.opportunityId, "salaryText")).toEqual([]);
    const closing = await provenanceOf(first.opportunityId, "closingDate");
    expect(closing.map((row) => row.normalizedValue)).toEqual(["2026-11-30T00:00:00.000Z", "2026-12-15T00:00:00.000Z"]);
    expect(closing.every((row) => row.supersededAt !== null)).toBe(true);
    expect(await records(first.opportunityId)).toHaveLength(3);
  });

  it("7: structured evidence in the new version outranks the posting text", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const first = await listing.observe({ description: body(token, "This is a hybrid role in Austin.") });
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ remoteStatus: "HYBRID" });
    await listing.observe({ description: body(token, "This is a hybrid role in Austin, open to remote."), structured: { workplaceType: "REMOTE" } });
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ remoteStatus: "REMOTE" });
    expect(await currentOf(first.opportunityId, "remoteStatus")).toEqual([
      expect.objectContaining({ sourceField: "source.workplaceType", kind: "DIRECT", normalizedValue: "REMOTE" }),
    ]);
  });

  it("8, 16 and 17: V1 → V2 → V3 leaves one current value per field, all from V3; V1 and V2 stay queryable as history", async () => {
    const listing = job(randomUUID().slice(0, 8));
    const first = await listing.observe({ location: "Austin, TX", structured: { workplaceType: "HYBRID" } });
    await listing.observe({ location: "Denver, CO", structured: { workplaceType: "REMOTE" } });
    await listing.observe({ location: "Chicago, IL", structured: { workplaceType: "ONSITE" } });
    const [v1, v2, v3] = await records(first.opportunityId);
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ location: "Chicago, IL", remoteStatus: "ONSITE" });

    const rows = await provenanceOf(first.opportunityId);
    const current = rows.filter((row) => row.supersededAt === null && projectedFieldNames.includes(row.fieldName));
    // No contradiction: at most one current row per field, every one from V3.
    expect(new Set(current.map((row) => row.fieldName)).size).toBe(current.length);
    expect(current.every((row) => row.sourceRecordId === v3!.id)).toBe(true);
    expect(rows.filter((row) => row.fieldName === "location").map((row) => [row.sourceRecordId, row.normalizedValue, row.supersededAt === null])).toEqual([
      [v1!.id, "Austin, TX", false],
      [v2!.id, "Denver, CO", false],
      [v3!.id, "Chicago, IL", true],
    ]);

    // The detail view shows current provenance only, and the history apart.
    const detail = await repository.findOpportunityDetail(first.opportunityId);
    expect(detail!.fieldProvenance.find((row) => row.fieldName === "location")).toMatchObject({ sourceRecordId: v3!.id, normalizedValue: "Chicago, IL" });
    expect(detail!.fieldProvenance.filter((row) => row.fieldName === "location")).toHaveLength(1);
    // Identity and link provenance (not projected) stays with the record it came from.
    expect(detail!.fieldProvenance.some((row) => projectedFieldNames.includes(row.fieldName) && row.sourceRecordId !== v3!.id)).toBe(false);
    expect(detail!.supersededProvenance!.filter((row) => row.fieldName === "location").map((row) => row.normalizedValue)).toEqual(["Austin, TX", "Denver, CO"]);
    expect(detail!.supersededProvenance!.every((row) => row.supersededAt instanceof Date)).toBe(true);
    // The evaluator's current subject (no evaluation yet) sees V3 only.
    const subject = await evaluations.loadSubject({ opportunityId: first.opportunityId, userProfileId: null });
    expect(subject!.subjectSourceRecordId).toBe(v3!.id);
    expect(subject!.opportunity.location).toBe("Chicago, IL");
    expect(subject!.provenance.every((row) => rows.find((stored) => stored.id === row.id)!.supersededAt === null)).toBe(true);
  });

  it("14: a changed department and seniority stated by the source update the projection", async () => {
    const listing = job(randomUUID().slice(0, 8));
    const first = await listing.observe({ sourceFacts: { department: "Customer Success", seniority: ["Entry level"] }, material: { department: "Customer Success", seniority: ["Entry level"] } });
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ department: "Customer Success", seniority: "ENTRY" });
    const changed = await listing.observe({ sourceFacts: { department: "Customer Experience", seniority: ["Senior"] }, material: { department: "Customer Experience", seniority: ["Senior"] } });
    expect(changed.outcome).toBe("CHANGED");
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ department: "Customer Experience", seniority: "SENIOR" });
    expect(await currentOf(first.opportunityId, "seniority")).toEqual([expect.objectContaining({ sourceField: "source.seniority", sourceText: "Senior", sourceRecordId: changed.sourceRecordId })]);
  });

  it("12 and 13: an identical or reformatted re-observation is UNCHANGED and changes nothing", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const first = await listing.observe({ structured: { workplaceType: "HYBRID" } });
    const opportunityBefore = await opportunityOf(first.opportunityId);
    const provenanceBefore = await provenanceOf(first.opportunityId);
    expect(await listing.observe({ structured: { workplaceType: "HYBRID" } })).toMatchObject({ outcome: "UNCHANGED", sourceRecordId: first.sourceRecordId });
    // Whitespace and tracking parameters are not material.
    expect(await listing.observe({
      structured: { workplaceType: "HYBRID" },
      description: body(token).replace(/ /g, "  "),
      sourceUrl: `${listing.sourceUrl}?utm_source=feed`,
    })).toMatchObject({ outcome: "UNCHANGED" });
    expect(await records(first.opportunityId)).toHaveLength(1);
    expect(await provenanceOf(first.opportunityId)).toEqual(provenanceBefore);
    const opportunityAfter = await opportunityOf(first.opportunityId);
    expect({ ...opportunityAfter, lastSeenAt: null, updatedAt: null }).toEqual({ ...opportunityBefore, lastSeenAt: null, updatedAt: null });
  });

  it("18 and 26: a changed version never creates a second opportunity or a deduplication decision", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const first = await listing.observe();
    const referencesBefore = await database.duplicateReference.count({ where: { opportunityId: first.opportunityId } });
    // Even a changed company name and title stay on the same opportunity.
    const changed = await listing.observe({ title: "Senior Customer Success Manager", company: `Versionco Holdings ${token}` });
    expect(changed).toMatchObject({ outcome: "CHANGED", opportunityId: first.opportunityId, decision: null });
    const stored = await records(first.opportunityId);
    expect(stored[1]!.duplicateDecision).toBeNull();
    expect(await database.duplicateReference.count({ where: { opportunityId: first.opportunityId } })).toBe(referencesBefore);
    expect(await database.opportunity.count({ where: { sourceRecords: { some: { externalId: listing.externalId } } } })).toBe(1);
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ title: "Senior Customer Success Manager", company: { name: `Versionco Holdings ${token}` } });
  });

  it("a changed company relinks the opportunity to the current company and keeps the old Company row, which is no longer current", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const first = await listing.observe();
    const oldCompanyId = (await opportunityOf(first.opportunityId)).companyId!;
    const changed = await listing.observe({ company: `Renamedco ${token}` });
    expect(changed.outcome).toBe("CHANGED");

    const current = await opportunityOf(first.opportunityId);
    expect(current.company).toMatchObject({ name: `Renamedco ${token}` });
    expect(current.companyId).not.toBe(oldCompanyId);
    expect((await repository.findOpportunityDetail(first.opportunityId))!.opportunity.companyName).toBe(`Renamedco ${token}`);
    // The old row is kept (never deleted automatically) but nothing current points at it.
    expect(await database.company.findUnique({ where: { id: oldCompanyId } })).toMatchObject({ name: `Versionco ${token}` });
    expect(await database.opportunity.count({ where: { companyId: oldCompanyId } })).toBe(0);
    // Its name survives only as superseded V1 provenance; V2 is the one current company fact.
    expect(await currentOf(first.opportunityId, "company.name")).toEqual([
      expect.objectContaining({ sourceRecordId: changed.sourceRecordId, normalizedValue: `Renamedco ${token}` }),
    ]);
    expect((await provenanceOf(first.opportunityId, "company.name")).filter((row) => row.supersededAt !== null)).toEqual([
      expect.objectContaining({ sourceRecordId: first.sourceRecordId, normalizedValue: `Versionco ${token}` }),
    ]);
    await database.company.delete({ where: { id: oldCompanyId } }); // test cleanup only
  });
});

describe("only the originating listing writes the current facts", () => {
  it("9: a changed copy attached from another source is history only", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const origin = await listing.observe({ structured: { workplaceType: "HYBRID" } });
    const copy = job(token);
    const boardCopy = { externalId: `board-${token}`, sourceUrl: `https://board.example.test/${token}/9`, applicationUrl: listing.sourceUrl };
    const attached = await copy.observe({ ...boardCopy, location: "Remote - US", structured: { workplaceType: "REMOTE" } }, board);
    expect(attached).toMatchObject({ outcome: "ATTACHED", opportunityId: origin.opportunityId });
    const changedCopy = await copy.observe({ ...boardCopy, location: "Seattle, WA", structured: { workplaceType: "ONSITE" } }, board);
    expect(changedCopy).toMatchObject({ outcome: "CHANGED", opportunityId: origin.opportunityId });

    expect(await opportunityOf(origin.opportunityId)).toMatchObject({ location: "Austin, TX", remoteStatus: "HYBRID" });
    expect(await currentOf(origin.opportunityId, "location")).toEqual([expect.objectContaining({ sourceRecordId: origin.sourceRecordId })]);
    expect(await database.fieldProvenance.count({ where: { opportunityId: origin.opportunityId, sourceRecordId: changedCopy.sourceRecordId } })).toBe(0);
    expect(await records(origin.opportunityId)).toHaveLength(3);
  });

  it("10: a manual opportunity is never re-projected by a retrieved listing's change", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const saved = await manual.submit({
      rawText: body(token),
      title: "Customer Success Manager",
      company: `Versionco ${token}`,
      location: "Boston, MA",
      sourceUrl: listing.sourceUrl,
      domain: "customer-success",
    });
    cleanup.opportunityIds.push(saved.opportunity.id);
    expect(await listing.observe({ location: "Austin, TX" })).toMatchObject({ outcome: "ATTACHED", opportunityId: saved.opportunity.id });
    expect(await listing.observe({ location: "Denver, CO", structured: { workplaceType: "REMOTE" } })).toMatchObject({ outcome: "CHANGED" });
    const after = await opportunityOf(saved.opportunity.id);
    expect(after).toMatchObject({ location: "Boston, MA", jobDescription: saved.opportunity.jobDescription });
    expect(await database.fieldProvenance.count({ where: { opportunityId: saved.opportunity.id, supersededAt: { not: null } } })).toBe(0);
  });
});

describe("a value the user corrected stays until the user changes it", () => {
  const appOrigin = "http://127.0.0.1:3000";
  const api = createExtensionApiHandlers({
    pairings: new PrismaExtensionPairingRepository(),
    captures: createExtensionCaptureService({
      ingestion,
      lookup: new PrismaExtensionLookupRepository(),
      latestEvaluation: async () => null,
      discovery: customerSuccessDiscoveryConfiguration,
    }),
    evaluation: {
      request: async () => new Response(null, { status: 500 }),
      status: async () => new Response(null, { status: 500 }),
    },
  });

  it("6: a corrected title survives a changed listing, and the user's own later change replaces it", async () => {
    const response = await api.createPairing(new Request(`${appOrigin}/api/extension/pairings`, {
      method: "POST",
      body: JSON.stringify({ label: "Version browser" }),
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: appOrigin, host: "127.0.0.1:3000" },
    }));
    const { credential, pairing } = (await response.json()) as { credential: string; pairing: { id: string } };
    pairingIds.push(pairing.id);
    const token = randomUUID().slice(0, 8);
    const pageUrl = `https://careers.version-${token}.example/jobs/csm`;
    const capture = async (fields: Record<string, unknown>, editedFields: string[] = []) => {
      const result = await api.capture(new Request(`${appOrigin}/api/extension/captures`, {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: extensionCaptureSchemaVersion, pageUrl, extractor: "main-content",
          capturedAt: new Date().toISOString(), extensionVersion: "0.1.0",
          fields: { company: `Correctco ${token}`, location: "Austin, TX", ...fields }, editedFields,
        }),
        headers: { authorization: `Bearer ${credential}`, origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "content-type": "application/json" },
      }));
      const json = (await result.json()) as { opportunityId: string; outcome: string };
      cleanup.opportunityIds.push(json.opportunityId);
      return json;
    };
    const first = await capture({ title: "Customer Success Manager (Healthcare)", description: body(token) }, ["title"]);
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ title: "Customer Success Manager (Healthcare)" });

    const changed = await capture({ title: "CSM", description: body(token, "Now hiring for two teams."), location: "Denver, CO" });
    expect(changed.outcome).toBe("CHANGED");
    const kept = await opportunityOf(first.opportunityId);
    expect(kept).toMatchObject({ title: "Customer Success Manager (Healthcare)", location: "Denver, CO" });
    expect(kept.jobDescription).toContain("Now hiring for two teams.");
    expect(await currentOf(first.opportunityId, "title")).toEqual([expect.objectContaining({ sourceField: "userCorrected:title" })]);

    const corrected = await capture({ title: "Senior CSM (Healthcare)", description: body(token, "Now hiring for two teams.") }, ["title"]);
    expect(corrected.outcome).toBe("CHANGED");
    expect(await opportunityOf(first.opportunityId)).toMatchObject({ title: "Senior CSM (Healthcare)" });
    const titles = await provenanceOf(first.opportunityId, "title");
    expect(titles.map((row) => [row.normalizedValue, row.supersededAt === null])).toEqual([
      ["Customer Success Manager (Healthcare)", false],
      ["Senior CSM (Healthcare)", true],
    ]);
  });
});

describe("evaluations stay bound to the listing version they evaluated", () => {
  // The production processor over the deterministic fixture transport,
  // recording the job text each run's reconstruction stage received.
  function worker(seen: string[]) {
    const fixture = createCustomerSuccessFixtureTransport();
    const transport: SemanticProviderTransport = {
      async execute(request) {
        if (request.operationId === "customer-success.jd-reconstruction") {
          seen.push((JSON.parse(request.input) as { untrustedSourceContent: string }).untrustedSourceContent);
        }
        return fixture.execute(request);
      },
    };
    return createEvaluationWorker({
      tasks,
      leaseSeconds: 60,
      processor: withOpportunityLifecycleSync(
        createCustomerSuccessEvaluationProcessor({ evaluations, tasks, semanticConfig, transport }),
        new PrismaOpportunityLifecycleRepository(),
      ),
    });
  }

  it("19–25: no automatic work, an additive reevaluation of the current version, the old one kept and hinted", async () => {
    const token = randomUUID().slice(0, 8);
    const listing = job(token);
    const v1Text = body(token, "Remote. Applicants must reside in the United States.", "Salary $72,000-$88,000.");
    const v2Text = body(token, "Remote. Applicants must reside in the United States.", "Salary $80,000-$96,000.", "This version adds enterprise accounts.");
    const first = await listing.observe({ location: "Remote - United States", description: v1Text });
    const opportunityId = first.opportunityId;
    const profile = await createProfile(cleanup);
    const { service } = createHarness({ now: new Date() });
    const seen: string[] = [];

    const v1Request = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(await worker(seen).runOnce()).toMatchObject({ status: "COMPLETED" });
    const v1Evaluation = await database.evaluation.findUniqueOrThrow({ where: { id: v1Request.evaluationId }, include: { evidenceRecords: true, recommendation: true, semanticOperations: true } });
    expect(v1Evaluation).toMatchObject({ status: "COMPLETED", sourceRecordId: first.sourceRecordId });
    expect(v1Evaluation.semanticOperations.length).toBeGreaterThan(0);
    expect(v1Evaluation.semanticOperations.every((attempt) => attempt.sourceRecordId === first.sourceRecordId)).toBe(true);
    expect(seen).toEqual([v1Text]);
    const v1ProvenanceRefs = v1Evaluation.evidenceRecords.flatMap((record) => (record.provenanceId ? [record.provenanceId] : []));
    expect(v1ProvenanceRefs.length).toBeGreaterThan(0);
    expect(await findListingVersionHint(opportunityId)).toBeNull();

    // 25: an unchanged re-observation creates no evaluation work.
    const evaluationsBefore = await database.evaluation.count({ where: { opportunityId } });
    const tasksBefore = await database.evaluationTask.count({ where: { evaluation: { opportunityId } } });
    expect(await listing.observe({ location: "Remote - United States", description: v1Text })).toMatchObject({ outcome: "UNCHANGED" });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(evaluationsBefore);

    // 20: a changed listing re-projects the facts and evaluates nothing.
    const second = await listing.observe({ location: "Remote - United States", description: v2Text });
    expect(second.outcome).toBe("CHANGED");
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(evaluationsBefore);
    expect(await database.evaluationTask.count({ where: { evaluation: { opportunityId } } })).toBe(tasksBefore);
    expect((await opportunityOf(opportunityId)).jobDescription).toBe(v2Text);

    // 19: the existing evaluation, its recommendation and its evidence
    // references are untouched; the provenance it cited is kept (superseded).
    const kept = await database.evaluation.findUniqueOrThrow({ where: { id: v1Request.evaluationId }, include: { evidenceRecords: true, recommendation: true } });
    expect(kept).toMatchObject({ status: "COMPLETED", sourceRecordId: first.sourceRecordId, completedAt: v1Evaluation.completedAt });
    expect(kept.recommendation).toEqual(v1Evaluation.recommendation);
    expect(kept.evidenceRecords).toEqual(v1Evaluation.evidenceRecords);
    const cited = await database.fieldProvenance.findMany({ where: { id: { in: v1ProvenanceRefs } } });
    expect(cited).toHaveLength(new Set(v1ProvenanceRefs).size);
    expect(cited.some((row) => row.supersededAt !== null)).toBe(true);

    // 24: the hint names the evaluated and the current version.
    const v2Record = (await records(opportunityId))[1]!;
    expect(await findListingVersionHint(opportunityId)).toEqual({
      evaluatedAt: v1Evaluation.completedAt,
      evaluatedVersionSeenAt: (await records(opportunityId))[0]!.createdAt,
      currentVersionSeenAt: v2Record.createdAt,
    });

    // 22: the historical evaluation's subject is still V1 as it stood.
    const v1Subject = await evaluations.loadSubject({ opportunityId, userProfileId: profile.id, evaluationId: v1Request.evaluationId });
    expect(v1Subject!.subjectSourceRecordId).toBe(first.sourceRecordId);
    expect(v1Subject!.opportunity.jobDescription).toBe(v1Text);

    // 21: a user-requested reevaluation is a new, additive evaluation bound
    // to the latest originating version, never the oldest record.
    const v2Request = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(v2Request.evaluationId).not.toBe(v1Request.evaluationId);
    expect(await database.evaluation.findUniqueOrThrow({ where: { id: v2Request.evaluationId } })).toMatchObject({ sourceRecordId: v2Record.id });
    const v2Subject = await evaluations.loadSubject({ opportunityId, userProfileId: profile.id, evaluationId: v2Request.evaluationId });
    expect(v2Subject!.rawSources[0]!.id).toBe(first.sourceRecordId);
    expect(v2Subject!.subjectSourceRecordId).toBe(v2Record.id);
    expect(v2Subject!.opportunity.jobDescription).toBe(v2Text);
    // 23: its provenance is the current rows only.
    const v2Provenance = await database.fieldProvenance.findMany({ where: { id: { in: v2Subject!.provenance.map((row) => row.id) } } });
    expect(v2Provenance.every((row) => row.supersededAt === null)).toBe(true);
    expect(v2Subject!.provenance.find((row) => row.fieldName === "jobDescription")).toMatchObject({ sourceRecordId: v2Record.id });

    expect(await worker(seen).runOnce()).toMatchObject({ status: "COMPLETED" });
    expect(seen).toEqual([v1Text, v2Text]);
    const v2Evaluation = await database.evaluation.findUniqueOrThrow({ where: { id: v2Request.evaluationId }, include: { semanticOperations: true, evidenceRecords: true } });
    expect(v2Evaluation.semanticOperations.every((attempt) => attempt.sourceRecordId === v2Record.id)).toBe(true);
    const v2Cited = await database.fieldProvenance.findMany({ where: { id: { in: v2Evaluation.evidenceRecords.flatMap((record) => (record.provenanceId ? [record.provenanceId] : [])) } } });
    expect(v2Cited.length).toBeGreaterThan(0);
    expect(v2Cited.every((row) => row.supersededAt === null)).toBe(true);
    // The earlier evaluation's attempts still name V1, and the hint is gone.
    expect((await database.semanticOperationAttempt.findMany({ where: { evaluationId: v1Request.evaluationId } })).every((attempt) => attempt.sourceRecordId === first.sourceRecordId)).toBe(true);
    expect(await findListingVersionHint(opportunityId)).toBeNull();
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(2);
  });
});
