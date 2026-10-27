// Feature 14B final cross-source batch (October 27, 2026) on the isolated
// test database: labelled pay tiers and variable pay persist, project with
// a changed version, reach the dashboard read and stay withheld from the
// evaluator; a requisition ID read from the page is the opportunity's; and
// "Use my selected text instead" on a page whose structured description is
// shortened replaces the description everywhere downstream: the new source
// version, the opportunity, the evaluator's subject and the reconstruction
// stage's input, with the popup told the earlier evaluation is of an
// earlier version. Synthetic pages, the fixture semantic transport, and
// nothing reaches the network or a provider.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  fieldsWithheldFromEvaluator,
  findListingVersionHint,
  PrismaEvaluationRepository,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityListRepository,
  PrismaOpportunityLifecycleRepository,
} from "@ai-career/database";
import { buildRetrievedListing } from "@ai-career/discovery";
import { createEvaluationWorker, type SemanticProviderTransport } from "@ai-career/evaluation";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildCaptureEnvelope, type CaptureChoice } from "../../apps/extension/src/envelope";
import { evaluationLine } from "../../apps/extension/src/popup-view";
import { formatSalary } from "../../apps/web/src/components/opportunity-facts";
import { createCustomerSuccessEvaluationProcessor } from "../../apps/web/src/server/customer-success-evaluation-processor";
import { createExtensionApiHandlers, evaluationSummaryReader } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { createCustomerSuccessFixtureTransport } from "../fixtures/customer-success";
import { createCleanup, createHarness, createProfile, database, semanticConfig, tasks } from "../support/budget-integration";
import { runExtractor } from "../support/extension-pages";

const cleanup = createCleanup();
const repository = new PrismaManualOpportunityRepository();
const ingestion = createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() });
const evaluations = new PrismaEvaluationRepository();
const pairingIds: string[] = [];

beforeEach(() => cleanup.before());
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
});
afterAll(() => database.$disconnect());

const ats = { key: "test-ats", name: "Test ATS", attribution: null, sourceType: "ATS", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS" } as const;
const tiersText = (token: string, extra = "") =>
  `Customer Success Manager ${token}.\nOwn a portfolio of contractors.\nPay range by geography:\nZone 1: $92,600 - $139,000 USD\nZone 2: $86,600 - $129,800 USD\nBonus potential up to $10,000 annually.${extra}`;
const observe = async (token: string, description: string) => {
  const result = await ingestion.ingest(buildRetrievedListing(ats, {
    externalId: `tiers-${token}`, title: `Customer Success Manager ${token}`, company: `Zoneco ${token}`, location: "Remote - United States", description,
    sourceUrl: `https://ats.example.test/tiers-${token}`, applicationUrl: null, sourceItem: {},
  }, { domain: "customer-success", discoveredAt: new Date() }));
  cleanup.opportunityIds.push(result.opportunityId);
  return result;
};

describe("labelled pay tiers and variable pay, persisted", () => {
  it("persist, list and display side by side; a changed version re-projects them; the evaluator never sees them", async () => {
    const token = randomUUID().slice(0, 8);
    const first = await observe(token, tiersText(token));
    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } });
    expect(stored).toMatchObject({ salaryMin: null, salaryMax: null, bonus: "Bonus potential up to $10,000 annually." });
    expect(stored.compensationTiers).toEqual([
      { label: "Zone 1", minimum: 92600, maximum: 139000, currency: "USD" },
      { label: "Zone 2", minimum: 86600, maximum: 129800, currency: "USD" },
    ]);

    const detail = (await repository.findOpportunityDetail(first.opportunityId))!;
    expect(formatSalary(detail.opportunity)).toBe("Zone 1: 92,600–139,000 USD · Zone 2: 86,600–129,800 USD");
    const listed = await new PrismaOpportunityListRepository().listPage({ filters: { searchTerms: [token] }, sort: "newest", page: 1, pageSize: 25 });
    const row = listed.items.find((item) => item.id === first.opportunityId)!;
    expect(formatSalary(row)).toBe("Zone 1: 92,600–139,000 USD · Zone 2: 86,600–129,800 USD");

    const subject = (await evaluations.loadSubject({ opportunityId: first.opportunityId, userProfileId: null }))!;
    expect(fieldsWithheldFromEvaluator).toEqual(expect.arrayContaining(["compensationTiers", "bonus"]));
    expect(subject.opportunity).toMatchObject({ compensationTiers: [], bonus: null, salaryMin: null, salaryMax: null });
    expect(subject.provenance.map((item) => item.fieldName)).not.toContain("compensationTiers");
    expect(subject.provenance.map((item) => item.fieldName)).not.toContain("bonus");

    // A changed version of the listing: its tiers become current.
    const second = await observe(token, tiersText(token).replace("$86,600 - $129,800", "$88,000 - $131,000").replace("Bonus potential up to $10,000 annually.", ""));
    expect(second.outcome).toBe("CHANGED");
    const changed = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } });
    expect(changed.compensationTiers).toEqual([
      { label: "Zone 1", minimum: 92600, maximum: 139000, currency: "USD" },
      { label: "Zone 2", minimum: 88000, maximum: 131000, currency: "USD" },
    ]);
    expect(changed.bonus).toBeNull();
    const current = await database.fieldProvenance.findMany({ where: { opportunityId: first.opportunityId, fieldName: "compensationTiers", supersededAt: null } });
    expect(current.map((item) => item.sourceRecordId)).toEqual([second.sourceRecordId]);
  });
});

// ------------------------------------------------- extension capture paths

const api = createExtensionApiHandlers({
  pairings: new PrismaExtensionPairingRepository(),
  captures: createExtensionCaptureService({
    ingestion,
    lookup: new PrismaExtensionLookupRepository(),
    latestEvaluation: (opportunityId) =>
      evaluationSummaryReader(createHarness({ now: new Date() }).service, async (id) => (await findListingVersionHint(id)) !== null)(opportunityId),
    discovery: customerSuccessDiscoveryConfiguration,
  }),
  evaluation: { request: async () => new Response(null, { status: 500 }), status: async () => new Response(null, { status: 500 }) },
});
const appOrigin = "http://127.0.0.1:3000";
async function pair() {
  const response = await api.createPairing(new Request(`${appOrigin}/api/extension/pairings`, {
    method: "POST", body: JSON.stringify({ label: "Final batch browser" }),
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: appOrigin, host: "127.0.0.1:3000" },
  }));
  const body = (await response.json()) as { credential: string; pairing: { id: string } };
  pairingIds.push(body.pairing.id);
  return body.credential;
}
async function capture(credential: string, html: string, pageUrl: string, choice: CaptureChoice = "page", select?: string) {
  const envelope = buildCaptureEnvelope(runExtractor(html, pageUrl, select ? { select } : {}), choice, { extensionVersion: "0.1.0", capturedAt: new Date() });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const response = await api.capture(new Request(`${appOrigin}/api/extension/captures`, {
    method: "POST", body: JSON.stringify(envelope.envelope),
    headers: { authorization: `Bearer ${credential}`, origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "content-type": "application/json" },
  }));
  const body = (await response.json()) as { opportunityId: string; outcome: string; evaluation: { queueState: string; recommendation: { decision: string } | null; evaluatedEarlierVersion?: boolean } | null };
  cleanup.opportunityIds.push(body.opportunityId);
  return body;
}
const jsonLd = (posting: Record<string, unknown>) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", ...posting }).replace(/</g, "\\u003c")}</script>`;

describe("a requisition ID the page labels is the opportunity's", () => {
  it("Workday-style details: persisted on the opportunity and shown with its facts", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    const html = `<!doctype html><html><head><title>Careers at Reqco</title></head><body><main>
      <h2 data-automation-id="jobPostingHeader">Customer Success Manager ${token}</h2>
      <div><dl><dt>job requisition id</dt><dd>JREQ${token.replace(/[a-f]/g, "7")}</dd></dl><dl><dt>posted on</dt><dd>Posted 3 Days Ago</dd></dl></div>
      <div data-automation-id="jobPostingDescription"><p>${"Help customers adopt the platform. ".repeat(6)}</p><p>Applications close on December 31, 2026.</p></div></main></body></html>`;
    const result = await capture(credential, html, `https://reqco.wd1.myworkdayjobs.com/External/job/Remote/CSM_${token}`);
    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId } });
    expect(stored).toMatchObject({ title: `Customer Success Manager ${token}`, atsRequisitionId: `JREQ${token.replace(/[a-f]/g, "7")}` });
    expect(stored.closingDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect((await repository.findOpportunityDetail(result.opportunityId))!.opportunity.atsRequisitionId).toBe(stored.atsRequisitionId);
  });
});

describe("'Use my selected text instead' on a page with a shortened structured description", () => {
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
      processor: withOpportunityLifecycleSync(createCustomerSuccessEvaluationProcessor({ evaluations, tasks, semanticConfig, transport }), new PrismaOpportunityLifecycleRepository()),
    });
  }

  it("replaces the description in the new version, the opportunity, the evaluator's subject and its reconstruction input", async () => {
    const credential = await pair();
    const token = randomUUID().slice(0, 8);
    // A board whose job data holds only a shortened copy, and whose page
    // words the full text differently (so the reader cannot tell it is the
    // same description): the reader keeps the shortened copy, and the user
    // selects the full text instead.
    const teaser = `<p>Selectco ${token} is hiring a Customer Success Manager to guide customers through onboarding and adoption.</p><p>Apply now and work remotely at Selectco</p>`;
    const full = `About the role at Selectco ${token}: you will guide customers through onboarding and adoption. ${"Own renewals and expansion for a book of mid-market accounts. ".repeat(8)}Remote. Applicants must reside in the United States. Salary $72,000-$88,000.`;
    const html = `<!doctype html><html><head><title>Customer Success Manager</title>${jsonLd({ title: "Customer Success Manager", hiringOrganization: { name: `Selectco ${token}` }, description: teaser })}</head>
      <body><h1>Customer Success Manager</h1><blockquote id="full">${full}</blockquote></body></html>`;
    const pageUrl = `https://jobs.selectco-${token}.example/csm`;

    const first = await capture(credential, html, pageUrl);
    expect(first.outcome).toBe("CREATED");
    const opportunityId = first.opportunityId;
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).jobDescription).toContain("Apply now and work remotely at Selectco");

    // The user evaluates the shortened version.
    const profile = await createProfile(cleanup);
    const { service } = createHarness({ now: new Date() });
    const seen: string[] = [];
    await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(await worker(seen).runOnce()).toMatchObject({ status: "COMPLETED" });
    expect(seen[0]).toContain("Apply now and work remotely at Selectco");

    // Then saves the selected full text instead: a new version, which is now
    // the opportunity's description, with nothing evaluated automatically.
    const second = await capture(credential, html, pageUrl, "selection", "#full");
    expect(second.outcome).toBe("CHANGED");
    const versions = await database.sourceRecord.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" } });
    expect(versions).toHaveLength(2);
    expect(versions[1]!.rawDescription).toBe(full);
    expect(versions[1]!.sourceMetadata).toMatchObject({ capture: { extractor: "selection" } });
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
    expect(opportunity.jobDescription).toBe(full);
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(1);

    // The popup is told the evaluation it shows is of the earlier version.
    expect(second.evaluation).toMatchObject({ evaluatedEarlierVersion: true });
    expect(evaluationLine(second.evaluation)).toContain("It evaluated an earlier version of this posting");

    // A requested evaluation evaluates the selected text.
    const subject = (await evaluations.loadSubject({ opportunityId, userProfileId: profile.id }))!;
    expect(subject.opportunity.jobDescription).toBe(full);
    expect(subject.subjectSourceRecordId).toBe(versions[1]!.id);
    await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(await worker(seen).runOnce()).toMatchObject({ status: "COMPLETED" });
    expect(seen[1]).toBe(full);
    expect(await findListingVersionHint(opportunityId)).toBeNull();
  });
});
