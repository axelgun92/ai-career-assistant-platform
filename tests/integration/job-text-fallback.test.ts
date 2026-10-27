// Shared job-text fallback on the isolated test database (Feature 14B
// normalization correction): facts read from the posting text persist with
// their markers, the deduplication engine (unchanged) receives the corrected
// company and location, a repeat capture stays a re-observation, link
// precedence is unchanged, and the evaluator subject still withholds the
// Task 7 facts. Synthetic postings only; nothing reaches the network.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualOpportunityService, createRetrievalIngestionService, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  fieldsWithheldFromEvaluator,
  PrismaEvaluationRepository,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { buildRetrievedListing } from "@ai-career/discovery";
import { createManualOpportunityNormalizer, createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { createExtensionApiHandlers } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createCleanup, database } from "../support/budget-integration";

const cleanup = createCleanup();
const repository = new PrismaManualOpportunityRepository();
const ingestion = createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() });
const manual = createManualOpportunityService({ repository, normalizer: createManualOpportunityNormalizer() });
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
const pairingIds: string[] = [];

beforeEach(() => cleanup.before());
afterEach(async () => {
  const opportunityIds = [...new Set(cleanup.opportunityIds)];
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
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

const appOrigin = "http://127.0.0.1:3000";
async function pair() {
  const response = await api.createPairing(
    new Request(`${appOrigin}/api/extension/pairings`, {
      method: "POST",
      body: JSON.stringify({ label: "Fallback browser" }),
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: appOrigin, host: "127.0.0.1:3000" },
    }),
  );
  const body = (await response.json()) as { credential: string; pairing: { id: string } };
  pairingIds.push(body.pairing.id);
  return body.credential;
}

async function capture(credential: string, pageUrl: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const response = await api.capture(
    new Request(`${appOrigin}/api/extension/captures`, {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: extensionCaptureSchemaVersion,
        pageUrl,
        extractor: "main-content",
        capturedAt: new Date().toISOString(),
        extensionVersion: "0.1.0",
        fields: { title: "Customer Success Manager", ...fields },
        ...extra,
      }),
      headers: { authorization: `Bearer ${credential}`, origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "content-type": "application/json" },
    }),
  );
  const body = (await response.json()) as { opportunityId: string; outcome: string; decision: string | null; probableDuplicate: boolean };
  if (body.opportunityId) cleanup.opportunityIds.push(body.opportunityId);
  return { status: response.status, body };
}

async function ingestBoardListing(input: { company: string; location: string; description: string; sourceUrl: string; applicationUrl?: string | null }, category: "JOB_BOARD" | "ATS" = "JOB_BOARD") {
  const raw = buildRetrievedListing(
    {
      key: category === "ATS" ? "test-ats" : "test-board",
      name: category === "ATS" ? "Test ATS" : "Test Board",
      attribution: null,
      sourceType: category === "ATS" ? "ATS" : "API",
      retrievalType: "OFFICIAL_PUBLIC_API_FEED",
      sourceCategory: category,
    },
    {
      externalId: randomUUID(),
      title: "Customer Success Manager",
      company: input.company,
      location: input.location,
      description: input.description,
      sourceUrl: input.sourceUrl,
      applicationUrl: input.applicationUrl ?? null,
      sourceItem: {},
    },
    { domain: "customer-success", discoveredAt: new Date() },
  );
  const result = await ingestion.ingest(raw);
  cleanup.opportunityIds.push(result.opportunityId);
  return result;
}

const body = (token: string) =>
  [
    `Own onboarding, adoption and renewals for a book of mid-market healthcare customers (${token}).`,
    "Run quarterly business reviews, build success plans and partner with Sales on expansion.",
    "3+ years of Customer Success experience in B2B SaaS.",
  ].join("\n");

describe("facts read from the posting text persist with their markers", () => {
  it("an employer-page capture gets company from the page title and location, arrangement and pay from the text", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    const statement = "The base salary range for this role is $120,000 - $140,000 per year plus commission.";
    const { status, body: result } = await capture(
      credential,
      `https://careers.fallback-${token}.example/jobs/csm`,
      { description: `This is a full-time, NYC-Hybrid position.\n${statement}\nAnticipated role close date: 11/30/2026\n${body(token)}` },
      { pageTitle: `Job Application for Customer Success Manager at Fallbackco ${token}` },
    );
    expect(status).toBe(201);
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId }, include: { company: true } });
    expect(opportunity).toMatchObject({
      location: "NYC", remoteStatus: "HYBRID", employmentType: "FULL_TIME", salaryText: statement,
      // A bare "$" with "NYC" alone: no recognized U.S. geography, so the
      // currency stays Unknown (the amounts are still read).
      currency: null,
    });
    expect(opportunity.company?.name).toBe(`Fallbackco ${token}`);
    expect(opportunity.salaryMin?.toNumber()).toBe(120000);
    expect(opportunity.closingDate?.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    const provenance = await database.fieldProvenance.findMany({ where: { opportunityId: result.opportunityId } });
    const byField = Object.fromEntries(provenance.map((item) => [item.fieldName, item]));
    expect(byField["company.name"]).toMatchObject({ kind: "DETERMINISTIC", sourceField: "pageContext:page-title-company" });
    expect(byField.location).toMatchObject({ kind: "DETERMINISTIC", sourceField: "rawText:explicit-location-statement" });
    expect(byField.remoteStatus).toMatchObject({ kind: "DETERMINISTIC", sourceField: "rawText:explicit-work-arrangement-statement" });
    expect(byField.salaryMin).toMatchObject({ kind: "DETERMINISTIC", sourceField: "rawText:explicit-compensation-statement" });
    expect(byField.closingDate).toMatchObject({ kind: "DETERMINISTIC", sourceField: "rawText:explicit-closing-date-statement", sourceText: "Anticipated role close date: 11/30/2026" });
    // The source record keeps exactly what was captured, plus the neutral
    // page context.
    const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: result.opportunityId } });
    expect(record).toMatchObject({ rawCompany: null, rawLocation: null, rawSalaryText: null });
    expect(record.sourceMetadata).toMatchObject({ pageTitle: `Job Application for Customer Success Manager at Fallbackco ${token}`, userCorrectedFields: [] });

    // The evaluator subject still withholds the Task 7 facts.
    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: result.opportunityId, userProfileId: null });
    for (const field of fieldsWithheldFromEvaluator) expect(subject!.opportunity[field]).toEqual(["residencyRegions", "workAuthorizationRegions", "employerOfRecordRegions", "workArrangements", "compensationTiers"].includes(field) ? [] : null);
  });

  it("a structured-data capture reads labelled page metadata outside its description, below the structured values", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    const pageUrl = `https://careers.context-${token}.example/jobs/csm`;
    const fields = { description: body(token), company: `Contextco ${token}`, employmentType: "FULL_TIME" };
    const extra = {
      extractor: "structured-data",
      pageText: ["Customer Success Manager", "Remote Type", "Hybrid", "Employment Type: Contract", "Location: Toronto, Ontario, Canada", body(token)].join("\n"),
    };
    const first = await capture(credential, pageUrl, fields, extra);
    expect(first.status).toBe(201);
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: first.body.opportunityId } });
    // Structured employment type wins; the missing facts come from page context.
    expect(opportunity).toMatchObject({ remoteStatus: "HYBRID", employmentType: "FULL_TIME", location: "Toronto, Ontario, Canada" });
    const provenance = await database.fieldProvenance.findMany({ where: { opportunityId: first.body.opportunityId } });
    const byField = Object.fromEntries(provenance.map((item) => [item.fieldName, item]));
    expect(byField.remoteStatus).toMatchObject({ kind: "DETERMINISTIC", sourceField: "pageContext:labelled-work-arrangement", sourceText: "Remote Type\nHybrid" });
    expect(byField.location).toMatchObject({ kind: "DETERMINISTIC", sourceField: "pageContext:labelled-location" });
    expect(byField.employmentType).toMatchObject({ kind: "DIRECT", sourceField: "employmentType", normalizedValue: "FULL_TIME" });
    const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: first.body.opportunityId } });
    expect(record.sourceMetadata).toMatchObject({ pageText: expect.stringContaining("Remote Type\nHybrid") });
    // Page context is not part of the listing's content: a repeat capture is
    // a re-observation.
    const again = await capture(credential, pageUrl, fields, extra);
    expect(again.body).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.body.opportunityId });
  });

  it("a pasted manual job gets the same facts the form left empty, and keeps what the user entered", async () => {
    const token = randomUUID().slice(0, 8);
    const detail = await manual.submit({
      rawText: [`Company: Manualco ${token}`, "Location: Austin, TX", "This is a fully remote role.", "Salary: $95,000 - $105,000", "Closing date: 2026-12-15", body(token)].join("\n"),
      title: "Customer Success Manager",
      workArrangement: "HYBRID",
    });
    cleanup.opportunityIds.push(detail.opportunity.id);
    expect(detail.opportunity).toMatchObject({ location: "Austin, TX", remoteStatus: "HYBRID", salaryText: "Salary: $95,000 - $105,000", currency: "USD" });
    expect(detail.opportunity.closingDate?.toISOString().slice(0, 10)).toBe("2026-12-15");
    const remote = detail.fieldProvenance.filter((item) => item.fieldName === "remoteStatus");
    expect(remote).toEqual([expect.objectContaining({ kind: "DIRECT", sourceField: "workArrangement" })]);
    expect(detail.fieldProvenance).toContainEqual(expect.objectContaining({ fieldName: "company.name", kind: "DETERMINISTIC", sourceField: "rawText:labelled-company" }));
  });
});

describe("deduplication receives the corrected inputs (the engine and its thresholds are unchanged)", () => {
  it("a cross-site copy of one job is flagged as a probable duplicate, not attached, and the other listing's link is kept", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    const company = `Dupco ${token}`;
    const board = await ingestBoardListing({
      company,
      location: "New York, NY",
      description: `${body(token)}\nThis is a full-time, NYC-Hybrid position.`,
      sourceUrl: `https://board.example.test/jobs/${token}`,
      applicationUrl: `https://board.example.test/jobs/${token}/apply`,
    });
    expect(board.outcome).toBe("CREATED");
    const { body: employer } = await capture(
      credential,
      `https://careers.dupco-${token}.example/jobs/csm`,
      { description: `This is a full-time, NYC-Hybrid position.\n${body(token)}` },
      { pageTitle: `Job Application for Customer Success Manager at ${company}` },
    );
    expect(employer).toMatchObject({ outcome: "CREATED", decision: "PROBABLE_MATCH", probableDuplicate: true });
    expect(employer.opportunityId).not.toBe(board.opportunityId);
    const original = await database.opportunity.findUniqueOrThrow({ where: { id: board.opportunityId } });
    expect(original.applicationUrl).toBe(`https://board.example.test/jobs/${token}/apply`);
  });

  it("the same title at a different company is not flagged", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    await ingestBoardListing({ company: `Alphaco ${token}`, location: "New York, NY", description: body(token), sourceUrl: `https://board.example.test/jobs/a-${token}` });
    const { body: other } = await capture(
      credential,
      `https://careers.betaco-${token}.example/jobs/csm`,
      { description: body(token) },
      { pageTitle: `Customer Success Manager at Betaco ${token}` },
    );
    expect(other).toMatchObject({ outcome: "CREATED", decision: "NO_MATCH", probableDuplicate: false });
  });

  it("a capture of the ATS page itself attaches by its URL and keeps the ATS application link", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    const url = `https://boards.greenhouse.io/precedence${token}/jobs/4242`;
    const ats = await ingestBoardListing(
      { company: `Precedence ${token}`, location: "Chicago, IL", description: body(token), sourceUrl: url, applicationUrl: `${url}#app` },
      "ATS",
    );
    const { body: attached } = await capture(credential, url, { description: `Location: Chicago, IL\n${body(token)}` }, { pageTitle: `Job Application for Customer Success Manager at Precedence ${token}` });
    expect(attached).toMatchObject({ outcome: "ATTACHED", opportunityId: ats.opportunityId });
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: ats.opportunityId } });
    expect(opportunity.applicationUrl).toBe(`${url}#app`);
  });

  it("a repeat capture stays a re-observation with nothing duplicated", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    const pageUrl = `https://careers.repeat-${token}.example/jobs/csm`;
    const fields = { description: `Location: Denver, CO\nSalary: $90,000 - $100,000\n${body(token)}` };
    const extra = { pageTitle: `Customer Success Manager at Repeatco ${token}` };
    const first = await capture(credential, pageUrl, fields, extra);
    const provenanceBefore = await database.fieldProvenance.count({ where: { opportunityId: first.body.opportunityId } });
    const again = await capture(credential, pageUrl, fields, extra);
    expect(again.body).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.body.opportunityId });
    expect(await database.sourceRecord.count({ where: { opportunityId: first.body.opportunityId } })).toBe(1);
    expect(await database.fieldProvenance.count({ where: { opportunityId: first.body.opportunityId } })).toBe(provenanceBefore);
  });
});

// Page-context change detection on the real ingestion path. The labelled
// page facts take part in the listing's content hash; page noise does not.
// A meaningful change is a CHANGED re-observation: under the existing
// re-observation contract (Feature 13) it adds a new source record linked to
// the previous one, which carries the new evidence, and the opportunity's
// own facts are left as first recorded, exactly as for a changed
// description from any source.
describe("page-context change detection", () => {
  const meta = (lines: string[], noise = "Home Careers Contact") => [noise, "Customer Success Manager", ...lines, "Own onboarding and renewals.", "Similar jobs: Account Executive"].join("\n");
  const setup = async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    return { credential, token, pageUrl: `https://careers.change-${token}.example/jobs/csm`, fields: { description: body(token), company: `Changeco ${token}` } };
  };
  const records = (opportunityId: string) =>
    database.sourceRecord.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" }, select: { id: true, previousSourceRecordId: true, sourceMetadata: true } });

  it("1, 2 and 6: the same page facts, page noise, or no page context at all stay UNCHANGED", async () => {
    const { credential, pageUrl, fields } = await setup();
    const first = await capture(credential, pageUrl, fields, { extractor: "structured-data", pageText: meta(["Remote Type: Hybrid", "Location: Chicago, IL"]) });
    expect(first.status).toBe(201);
    const same = await capture(credential, pageUrl, fields, { extractor: "structured-data", pageText: meta(["Remote Type: Hybrid", "Location: Chicago, IL"]) });
    expect(same.body).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.body.opportunityId });
    const noisy = await capture(credential, pageUrl, fields, { extractor: "structured-data", pageText: meta(["Remote Type: Hybrid", "Location: Chicago, IL"], "Jobs Blog Sign in · Cookie settings · 3 new messages") });
    expect(noisy.body).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.body.opportunityId });
    expect(await records(first.body.opportunityId)).toHaveLength(1);
    // Nothing was re-projected: no provenance superseded, the facts as first recorded.
    expect(await database.fieldProvenance.count({ where: { opportunityId: first.body.opportunityId, supersededAt: { not: null } } })).toBe(0);
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: first.body.opportunityId } })).toMatchObject({ remoteStatus: "HYBRID", location: "Chicago, IL" });

    // An ordinary capture with no page context is idempotent as before.
    const plainUrl = `${pageUrl}-plain`;
    const plain = await capture(credential, plainUrl, fields);
    const again = await capture(credential, plainUrl, fields);
    expect(again.body).toMatchObject({ outcome: "UNCHANGED", opportunityId: plain.body.opportunityId });
  });

  it("3 and 4: a changed labelled arrangement or location is a CHANGED observation carrying the new evidence", async () => {
    const { credential, pageUrl, fields } = await setup();
    const first = await capture(credential, pageUrl, fields, { extractor: "structured-data", pageText: meta(["Remote Type: Hybrid", "Location: New York, NY"]) });
    const opportunityId = first.body.opportunityId;
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).toMatchObject({ remoteStatus: "HYBRID", location: "New York, NY" });

    const remote = await capture(credential, pageUrl, fields, { extractor: "structured-data", pageText: meta(["Remote Type: Remote", "Location: New York, NY"]) });
    expect(remote.body).toMatchObject({ outcome: "CHANGED", opportunityId });
    const moved = await capture(credential, pageUrl, fields, { extractor: "structured-data", pageText: meta(["Remote Type: Remote", "Location: Chicago, IL"]) });
    expect(moved.body).toMatchObject({ outcome: "CHANGED", opportunityId });

    const stored = await records(opportunityId);
    expect(stored).toHaveLength(3);
    expect(stored[1]!.previousSourceRecordId).toBe(stored[0]!.id);
    expect(stored[2]!.previousSourceRecordId).toBe(stored[1]!.id);
    expect(stored[2]!.sourceMetadata).toMatchObject({ pageText: expect.stringContaining("Remote Type: Remote\nLocation: Chicago, IL") });
    // The opportunity is re-projected from the latest version of its
    // originating listing; the earlier versions and their provenance stay.
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).toMatchObject({ remoteStatus: "REMOTE", location: "Chicago, IL" });
    const remoteRows = await database.fieldProvenance.findMany({ where: { opportunityId, fieldName: "remoteStatus" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(remoteRows.filter((row) => row.supersededAt === null)).toEqual([
      expect.objectContaining({ sourceRecordId: stored[2]!.id, sourceField: "pageContext:labelled-work-arrangement", sourceText: "Remote Type: Remote" }),
    ]);
    expect(remoteRows.find((row) => row.sourceRecordId === stored[0]!.id)).toMatchObject({ sourceText: "Remote Type: Hybrid", supersededAt: expect.any(Date) });
  });

  it("5: with a structured workplace type, a changed page arrangement is not evidence: UNCHANGED, and Remote stays", async () => {
    const { credential, pageUrl, fields } = await setup();
    const structured = { ...fields, workplaceType: "REMOTE" };
    const first = await capture(credential, pageUrl, structured, { extractor: "structured-data", pageText: meta(["Remote Type: Hybrid"]) });
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: first.body.opportunityId } })).toMatchObject({ remoteStatus: "REMOTE" });
    const onsite = await capture(credential, pageUrl, structured, { extractor: "structured-data", pageText: meta(["Remote Type: On-site"]) });
    expect(onsite.body).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.body.opportunityId });
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: first.body.opportunityId } })).toMatchObject({ remoteStatus: "REMOTE" });
  });
});

describe("retrieved listings: facts stated in a source's own fields persist", () => {
  it("a department and a level stated by the source reach the opportunity with DIRECT/DETERMINISTIC source provenance", async () => {
    const token = randomUUID().slice(0, 8);
    const raw = buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      {
        externalId: randomUUID(), title: "Customer Success Manager", company: `Factco ${token}`, location: "Austin, TX", description: body(token),
        sourceUrl: `https://ats.example.test/jobs/${token}`, applicationUrl: null, sourceItem: {},
        sourceFacts: { department: "Customer Success", seniority: ["Entry level"] },
        material: { department: "Customer Success", seniority: ["Entry level"] },
      },
      { domain: "customer-success", discoveredAt: new Date() },
    );
    const result = await ingestion.ingest(raw);
    cleanup.opportunityIds.push(result.opportunityId);
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId } })).toMatchObject({ department: "Customer Success", seniority: "ENTRY" });
    const provenance = await database.fieldProvenance.findMany({ where: { opportunityId: result.opportunityId, fieldName: { in: ["department", "seniority"] } } });
    expect(provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "department", kind: "DIRECT", sourceField: "source.department" }),
      expect.objectContaining({ fieldName: "seniority", kind: "DETERMINISTIC", sourceField: "source.seniority", sourceText: "Entry level" }),
    ]));
  });
});
