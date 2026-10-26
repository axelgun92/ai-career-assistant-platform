// Shared-normalization convergence on the isolated test database (Feature
// 14B correction, October 25, 2026). The synthetic Healthie posting, through
// the Greenhouse adapter and through the browser extension, persists the same
// normalized facts with path-specific provenance, the detail view shows them,
// the evaluator still withholds the new facts, the user's own eligibility is
// stored outside normalization, and a newly collected application URL is one
// CHANGED version. Fixture transport only; nothing reaches the network.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService, extensionCaptureSchemaVersion, workAuthorizationRelevance } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  fieldsWithheldFromEvaluator,
  PrismaEvaluationRepository,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  PrismaUserEligibilityRepository,
} from "@ai-career/database";
import { buildRetrievedListing, createFixtureTransport, createTitleMatcher, defaultAdapterRegistry } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { createEligibilityApiHandlers } from "../../apps/web/src/server/eligibility-api";
import { createExtensionApiHandlers } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { formatCompensationRange, formatWorkAuthorization } from "../../apps/web/src/components/opportunity-facts";
import { createCleanup, database } from "../support/budget-integration";
import { runExtractor } from "../support/extension-pages";
import { healthieGreenhouseResponse, healthiePage } from "../support/healthie-fixture";
import { geographyName } from "@ai-career/core";

const cleanup = createCleanup();
const repository = new PrismaManualOpportunityRepository();
const ingestion = createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() });
const api = createExtensionApiHandlers({
  pairings: new PrismaExtensionPairingRepository(),
  captures: createExtensionCaptureService({ ingestion, lookup: new PrismaExtensionLookupRepository(), latestEvaluation: async () => null, discovery: customerSuccessDiscoveryConfiguration }),
  evaluation: { request: async () => new Response(null, { status: 500 }), status: async () => new Response(null, { status: 500 }) },
});
const eligibility = new PrismaUserEligibilityRepository();
const pairingIds: string[] = [];
let eligibilityBefore: Awaited<ReturnType<typeof eligibility.get>> = null;

beforeEach(async () => {
  await cleanup.before();
  eligibilityBefore = await eligibility.get();
});
afterEach(async () => {
  const opportunityIds = [...new Set(cleanup.opportunityIds)];
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: { in: pairingIds.splice(0) } } });
  if (eligibilityBefore) await eligibility.save(eligibilityBefore);
  else await database.userEligibility.deleteMany({});
});
afterAll(() => database.$disconnect());

const appOrigin = "http://127.0.0.1:3000";
async function pair() {
  const response = await api.createPairing(new Request(`${appOrigin}/api/extension/pairings`, {
    method: "POST", body: JSON.stringify({ label: "Convergence browser" }),
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: appOrigin, host: "127.0.0.1:3000" },
  }));
  const body = (await response.json()) as { credential: string; pairing: { id: string } };
  pairingIds.push(body.pairing.id);
  return body.credential;
}

// The Healthie page captured from a per-test URL, so tests never share an opportunity.
async function capturePage(credential: string, pageUrl: string, html = healthiePage()) {
  const envelope = buildCaptureEnvelope(runExtractor(html, pageUrl), "page", { extensionVersion: "0.1.0", capturedAt: new Date() });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const response = await api.capture(new Request(`${appOrigin}/api/extension/captures`, {
    method: "POST", body: JSON.stringify(envelope.envelope),
    headers: { authorization: `Bearer ${credential}`, origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "content-type": "application/json" },
  }));
  const body = (await response.json()) as { opportunityId: string; outcome: string };
  cleanup.opportunityIds.push(body.opportunityId);
  return body;
}

async function ingestGreenhouse(board: string, jobUrl: string) {
  const adapter = defaultAdapterRegistry.get("greenhouse")!;
  const config = adapter.configSchema.parse({ board });
  const response = healthieGreenhouseResponse();
  response.jobs[0]!.absolute_url = jobUrl;
  response.jobs[0]!.company_name = `Healthie ${board}`;
  const result = await adapter.collect({
    transport: createFixtureTransport({ [adapter.verificationUrl(config)]: { status: 200, contentType: "application/json", body: JSON.stringify(response) } }),
    discovery: customerSuccessDiscoveryConfiguration, keepTitle: createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms),
    env: {}, now: () => new Date(), maxPages: 1, maxDetailRequests: 0,
  }, config);
  const ingested = await ingestion.ingest(result.listings[0]!);
  cleanup.opportunityIds.push(ingested.opportunityId);
  return ingested;
}

describe("Healthie through both paths, persisted", () => {
  it("persists the same facts, with provenance, current views and display, and withholds the new facts from the evaluator", async () => {
    const token = randomUUID().slice(0, 8);
    const automated = await ingestGreenhouse(`healthie${token}`, `https://job-boards.greenhouse.io/healthie${token}/jobs/4425790009`);
    const credential = await pair();
    const pageUrl = `https://job-boards.greenhouse.io/healthie-page-${token}/jobs/4425790009`;
    const captured = await capturePage(credential, pageUrl);
    expect(captured.outcome).toBe("CREATED");

    for (const [id, url] of [[automated.opportunityId, `https://job-boards.greenhouse.io/healthie${token}/jobs/4425790009`], [captured.opportunityId, pageUrl]] as const) {
      const stored = await database.opportunity.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({
        remoteStatus: "HYBRID", employmentType: "FULL_TIME", department: "Customer Success", compensationBasis: "OTE", currency: null,
        workAuthorizationRequirement: "RIGHT_TO_WORK", workAuthorizationRegions: ["US"], visaSponsorship: null, residencyRequirement: null,
        seniority: null, timeZoneRequirements: null, closingDate: null, applicationUrl: url,
        salaryText: "The salary range is $105,000 - $155,000 per year (OTE) annually.",
      });
      expect([stored.salaryMin?.toNumber(), stored.salaryMax?.toNumber()]).toEqual([105000, 155000]);
      const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: id } });
      expect(record.applicationUrl).toBe(url);

      const detail = (await repository.findOpportunityDetail(id))!;
      expect(formatCompensationRange(detail.opportunity.salaryMin, detail.opportunity.salaryMax, detail.opportunity.currency, detail.opportunity.compensationBasis))
        .toBe("105,000–155,000 (currency unknown) (OTE)");
      expect(formatWorkAuthorization(detail.opportunity, geographyName)).toBe("United States authorization required · Sponsorship: Unknown");
      expect(workAuthorizationRelevance(detail.opportunity, { authorizedRegions: ["US"], citizenshipRegions: ["US"] }).status).toBe("SATISFIED");

      const subject = (await new PrismaEvaluationRepository().loadSubject({ opportunityId: id, userProfileId: null }))!;
      for (const field of fieldsWithheldFromEvaluator) {
        expect(subject.opportunity[field]).toEqual(["residencyRegions", "workAuthorizationRegions", "employerOfRecordRegions", "workArrangements"].includes(field) ? [] : null);
      }
      expect(subject.provenance.map((row) => row.fieldName)).not.toContain("workAuthorizationRequirement");
    }
    const markers = async (id: string) =>
      (await database.fieldProvenance.findMany({ where: { opportunityId: id, fieldName: "applicationUrl", supersededAt: null } })).map((row) => row.sourceField);
    expect(await markers(automated.opportunityId)).toEqual(["source.postingPageIsApplication"]);
    expect(await markers(captured.opportunityId)).toEqual(["page:application-form"]);
  });

  it("a recapture of the same page is UNCHANGED; a page that newly shows its application form is one CHANGED version", async () => {
    const credential = await pair();
    const pageUrl = `https://careers.formco-${randomUUID().slice(0, 8)}.example/jobs/csm`;
    const withoutForm = healthiePage().replace(/<section id="application">[\s\S]*?<\/section>/, "");
    const first = await capturePage(credential, pageUrl, withoutForm);
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } })).toMatchObject({ applicationUrl: null });
    expect((await capturePage(credential, pageUrl, withoutForm)).outcome).toBe("UNCHANGED");
    const second = await capturePage(credential, pageUrl);
    expect(second).toMatchObject({ outcome: "CHANGED", opportunityId: first.opportunityId });
    expect((await capturePage(credential, pageUrl)).outcome).toBe("UNCHANGED");
    expect(await database.sourceRecord.count({ where: { opportunityId: first.opportunityId } })).toBe(2);
    // The newest version of the listing the job was found from now gives
    // its application link, with its basis; nothing is evaluated.
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } })).toMatchObject({ applicationUrl: pageUrl });
    expect((await database.fieldProvenance.findMany({ where: { opportunityId: first.opportunityId, fieldName: "applicationUrl", supersededAt: null } })).map((row) => row.sourceField)).toEqual(["page:application-form"]);
    expect(await database.evaluation.count({ where: { opportunityId: first.opportunityId } })).toBe(0);
  });
});

describe("compensation basis from the description's statement of the same range (Feature 14B v5)", () => {
  it("persists structured bounds and currency as stated, the OTE basis with its statement, and still withholds the basis from the evaluator", async () => {
    const token = randomUUID().slice(0, 8);
    const raw = buildRetrievedListing(
      { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" },
      {
        externalId: `ote-${token}`, title: "Customer Success Manager", company: `Rangeco ${token}`, location: "Denver, CO",
        description: "Own a book of enterprise accounts. OTE: $120,000 - $150,000 per year (60/40 base to variable).",
        sourceUrl: `https://ats.example.test/ote-${token}`, applicationUrl: null, sourceItem: {},
        structured: { salaryMin: 120000, salaryMax: 150000, salaryCurrency: "USD", salaryPeriod: "YEAR" },
      },
      { domain: "customer-success", discoveredAt: new Date("2026-10-25T09:00:00.000Z") },
    );
    const result = await ingestion.ingest(raw);
    cleanup.opportunityIds.push(result.opportunityId);
    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId } });
    expect(stored).toMatchObject({ compensationBasis: "OTE", currency: "USD" });
    expect([stored.salaryMin?.toNumber(), stored.salaryMax?.toNumber()]).toEqual([120000, 150000]);
    const rows = await database.fieldProvenance.findMany({ where: { opportunityId: result.opportunityId, fieldName: { in: ["compensationBasis", "salaryMin", "currency"] }, supersededAt: null } });
    expect(Object.fromEntries(rows.map((row) => [row.fieldName, row.sourceField]))).toEqual({
      compensationBasis: "rawText:explicit-compensation-statement", salaryMin: "source.salaryMin", currency: "source.salaryCurrency",
    });
    expect(rows.find((row) => row.fieldName === "compensationBasis")?.sourceText).toBe("OTE: $120,000 - $150,000 per year (60/40 base to variable).");
    const subject = (await new PrismaEvaluationRepository().loadSubject({ opportunityId: result.opportunityId, userProfileId: null }))!;
    expect(subject.opportunity.compensationBasis).toBeNull();
    expect(subject.opportunity.salaryMin).toBeNull();
  });
});

describe("cross-source correction persisted (October 26, 2026)", () => {
  it("stores the LinkedIn page's location statement, stated seniority label, dated posted age and regional tiers; the label is withheld from the evaluator", async () => {
    const token = randomUUID().slice(0, 6);
    const html = `<!doctype html><html><head><title>Scaled CSM | Serrala | LinkedIn</title></head><body><main>
      <h1 class="top-card-layout__title">Scaled Customer Success Manager, NA</h1><a class="topcard__org-name-link">Serrala ${token}</a>
      <span class="topcard__flavor topcard__flavor--bullet">Canada</span><span class="posted-time-ago__text">2 weeks ago</span>
      <div class="show-more-less-html__markup"><p>Location: Chicago Office or Remote, North America (US &amp; Canada)</p><p>Grow a scaled book of customers.</p>
        <p>Compensation:</p><p>U.S.: USD 63,000 - 75,000</p><p>Canada: CAD 88,000 - 110,000</p></div>
      <ul><li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Mid-Senior level</span></li></ul>
    </main></body></html>`;
    const receivedAt = new Date("2026-10-26T15:00:00.000Z");
    const extraction = runExtractor(html, `https://www.linkedin.com/jobs/view/43${Date.now() % 10_000_000}01/`);
    const envelope = buildCaptureEnvelope(extraction, "page", { extensionVersion: "0.1.0", capturedAt: receivedAt });
    if (!envelope.ok) throw new Error(envelope.problems.join("; "));
    const { capturedListing, parseCapture } = await import("../../apps/web/src/server/extension-capture");
    const { raw } = capturedListing(parseCapture(envelope.envelope), { pairingId: "p1", domain: "customer-success", receivedAt });
    const result = await ingestion.ingest(raw);
    cleanup.opportunityIds.push(result.opportunityId);

    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId } });
    expect(stored).toMatchObject({
      location: "Chicago Office or Remote, North America (US & Canada)", remoteStatus: null, workArrangements: ["ONSITE", "REMOTE"],
      seniority: null, seniorityLabel: "Mid-Senior level",
      salaryMin: null, salaryMax: null, currency: null, residencyRequirement: "NON_US", residencyRegions: ["US", "CA"],
    });
    expect(stored.salaryText).toContain("Canada: CAD 88,000 - 110,000");
    expect(stored.postingDate?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    const rows = await database.fieldProvenance.findMany({ where: { opportunityId: result.opportunityId, fieldName: { in: ["postingDate", "seniorityLabel", "location"] }, supersededAt: null } });
    expect(Object.fromEntries(rows.map((row) => [row.fieldName, row.sourceField]))).toEqual({
      postingDate: "postingDate:relative-posted-age", seniorityLabel: "source.seniority", location: "rawText:labelled-location",
    });
    const subject = (await new PrismaEvaluationRepository().loadSubject({ opportunityId: result.opportunityId, userProfileId: null }))!;
    expect(subject.opportunity.seniorityLabel).toBeNull();
    expect(subject.opportunity.workArrangements).toEqual([]);
    // The approximate posting date is withheld from the evaluator.
    expect(subject.opportunity.postingDate).toBeNull();
    expect(subject.provenance.filter((row) => row.fieldName === "postingDate")).toEqual([]);
    expect(subject.provenance.map((row) => row.fieldName)).not.toContain("seniorityLabel");
    expect(subject.provenance.map((row) => row.fieldName)).not.toContain("workArrangements");

    // The dashboard's arrangement filter finds it under each offered option,
    // and not as Unknown.
    const { parseOpportunityQuery, toListFilters } = await import("../../apps/web/src/server/opportunity-query");
    const { PrismaOpportunityListRepository } = await import("@ai-career/database");
    const listed = async (arrangement: string) => {
      const filters = toListFilters(parseOpportunityQuery(new URLSearchParams(`view=all&arrangement=${arrangement}`)));
      const page = await new PrismaOpportunityListRepository().listPage({ filters: { ...filters, searchTerms: [token] }, sort: "newest", page: 1, pageSize: 10 });
      return page.items.map((item) => item.id);
    };
    expect(await listed("remote")).toContain(result.opportunityId);
    expect(await listed("onsite")).toContain(result.opportunityId);
    expect(await listed("hybrid")).not.toContain(result.opportunityId);
    expect(await listed("unknown")).not.toContain(result.opportunityId);
  });
});

describe("a changed originating listing and the application link", () => {
  it("never replaces a higher-precedence link attached from another source", async () => {
    const token = randomUUID().slice(0, 8);
    const atsUrl = `https://boards.greenhouse.io/linkco${token}/jobs/1`;
    const board = { key: "test-board", name: "Test Board", attribution: null, sourceType: "API", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "JOB_BOARD" } as const;
    const ats = { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" } as const;
    const listing = (adapter: typeof board | typeof ats, input: { externalId: string; sourceUrl: string; applicationUrl: string; description: string; basis: "SOURCE_APPLY_URL" | "SOURCE_POSTING_PAGE" }) =>
      buildRetrievedListing(adapter, {
        externalId: input.externalId, title: "Customer Success Manager", company: `Linkco ${token}`, location: "Austin, TX", description: input.description,
        sourceUrl: input.sourceUrl, applicationUrl: input.applicationUrl, sourceItem: {}, sourceFacts: { applicationUrlBasis: input.basis },
      }, { domain: "customer-success", discoveredAt: new Date() });
    const body = `Own onboarding and renewals for Linkco ${token} customers.`;
    const origin = await ingestion.ingest(listing(board, { externalId: `b-${token}`, sourceUrl: `https://board.example.test/${token}`, applicationUrl: atsUrl, description: body, basis: "SOURCE_APPLY_URL" }));
    cleanup.opportunityIds.push(origin.opportunityId);
    const attached = await ingestion.ingest(listing(ats, { externalId: `a-${token}`, sourceUrl: atsUrl, applicationUrl: `${atsUrl}/apply`, description: body, basis: "SOURCE_APPLY_URL" }));
    expect(attached).toMatchObject({ outcome: "ATTACHED", opportunityId: origin.opportunityId });
    const changed = await ingestion.ingest(listing(board, { externalId: `b-${token}`, sourceUrl: `https://board.example.test/${token}`, applicationUrl: `https://elsewhere.example.test/${token}`, description: `${body} Updated.`, basis: "SOURCE_APPLY_URL" }));
    expect(changed.outcome).toBe("CHANGED");
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: origin.opportunityId } })).toMatchObject({ applicationUrl: `${atsUrl}/apply`, jobDescription: `${body} Updated.` });
  });
});

describe("the user's own work eligibility", () => {
  const handlers = createEligibilityApiHandlers(eligibility);
  const put = (body: unknown) => handlers.put(new Request(`${appOrigin}/api/eligibility`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

  it("is stored as countries only, outside normalization and evaluation", async () => {
    const saved = await put({ authorizedRegions: "United States", citizenshipRegions: "US" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ authorizedRegions: ["US"], citizenshipRegions: ["US"] });
    expect(await eligibility.get()).toMatchObject({ authorizedRegions: ["US"], citizenshipRegions: ["US"] });
    const refused = await put({ authorizedRegions: "Texas", citizenshipRegions: "" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "REQUEST_INVALID", fields: [{ field: "authorizedRegions" }] });
    expect((await put({ authorizedRegions: "", citizenshipRegions: "" })).status).toBe(200);
    expect(await eligibility.get()).toMatchObject({ authorizedRegions: [], citizenshipRegions: [] });
  });
});
