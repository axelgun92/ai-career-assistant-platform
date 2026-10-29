// Feature 14B live acceptance batch (October 29, 2026) on the isolated test
// database: what the corrected page reading and shared normalization now
// produce for the failures of the latest live round persists end to end:
// the job sidebar's salary and job type, the posting's two work styles and
// its bonus (withheld from the evaluator), zone tiers written as label and
// amount lines, the job's own apply link among other jobs' rows, and no
// closing date from Welcome to the Jungle's rolling expiry. Synthetic pages;
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
} from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildCaptureEnvelope, type CaptureChoice } from "../../apps/extension/src/envelope";
import { formatSalary } from "../../apps/web/src/components/opportunity-facts";
import { createExtensionApiHandlers, evaluationSummaryReader } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import { createCleanup, createHarness, database } from "../support/budget-integration";
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

const page = (head: string, body: string, title: string) => `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
const filler = (sentence: string, times = 6) => `<p>${sentence.repeat(times)}</p>`;

describe("the live round's corrections, persisted", () => {
  it("Himalayas: the sidebar's salary and job type, both work styles, and the bonus withheld from the evaluator", async () => {
    const token = randomUUID().slice(0, 8);
    const credential = await pair();
    const html = page(jsonLd({
      title: `Customer Success Manager ${token}`, hiringOrganization: { name: `SMB Team ${token}` }, jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "United States" }, datePosted: "2026-10-20",
      description: "<p>WORK STYLE – WFH or come to the office. The choice is yours!</p><p>The salary for this role is $85,000 - $90,000 with bonus potential up to $10,000.</p>",
    }), `<main><article><h1>Customer Success Manager ${token}</h1>${filler("Help small businesses succeed with bookkeeping. ")}</article>
      <aside class="job-sidebar"><div><span>Salary</span><span>$85K–$90K per year</span></div><div><span>Job type</span><span>Full Time</span></div><div><span>Experience level</span><span>Mid level</span></div></aside></main>`,
      `Customer Success Manager ${token}`);
    const captured = await capture(credential, html, `https://himalayas.app/companies/smb-team/jobs/customer-success-manager-${token}`);
    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: captured.opportunityId } });
    expect([Number(stored.salaryMin), Number(stored.salaryMax)]).toEqual([85000, 90000]);
    expect(stored).toMatchObject({
      currency: "USD", employmentType: "FULL_TIME", bonus: "bonus potential up to $10,000",
      remoteStatus: null, workArrangements: ["REMOTE", "ONSITE"],
    });
    const subject = (await evaluations.loadSubject({ opportunityId: captured.opportunityId, userProfileId: null }))!;
    expect(fieldsWithheldFromEvaluator).toEqual(expect.arrayContaining(["bonus"]));
    expect(subject.opportunity).toMatchObject({ bonus: null });
  });

  it("We Work Remotely: zone tiers written as label and amount lines, with the sidebar's region", async () => {
    const token = randomUUID().slice(0, 8);
    const credential = await pair();
    const html = page("", `<div class="lis-container"><div class="lis-container__header"><h1>Customer Success Manager ${token}</h1></div>
      <div class="lis-container__job"><div class="lis-container__job__content">
        <p>Dropbox is Virtual First, which means remote work is the primary experience for all employees.</p>${filler("Own onboarding and adoption for strategic customers. ")}
        <p>US Zone 1</p><p>This role is not available in Zone 1</p><p>US Zone 2</p><p>$142,700—$193,100 USD</p><p>US Zone 3</p><p>$126,800—$171,600 USD</p></div>
      <aside class="lis-container__job__sidebar"><h4>About the job</h4><ul><li>Job type <span>Full-Time</span></li><li>Region <span>USA Only</span></li></ul></aside></div></div>`,
      `Customer Success Manager ${token} | Dropbox | We Work Remotely`);
    const captured = await capture(credential, html, `https://weworkremotely.com/remote-jobs/dropbox-customer-success-manager-${token}`);
    const detail = (await repository.findOpportunityDetail(captured.opportunityId))!;
    expect(detail.opportunity).toMatchObject({ location: "USA Only", remoteStatus: "REMOTE", employmentType: "FULL_TIME", salaryMin: null, salaryMax: null });
    expect(formatSalary(detail.opportunity)).toBe("US Zone 2: 142,700–193,100 USD · US Zone 3: 126,800–171,600 USD");
  });

  it("Remote OK: the job's own apply link, stored on the source version and the opportunity; Welcome to the Jungle: no rolling closing date", async () => {
    const token = randomUUID().slice(0, 8);
    const credential = await pair();
    const id = `11${token.replace(/[^0-9]/g, "").padEnd(6, "1").slice(0, 6)}`;
    const html = page(jsonLd({
      title: `Customer Success Manager ${token}`, hiringOrganization: { name: `INNERGY ${token}` }, jobLocationType: "TELECOMMUTE", datePosted: "2026-10-22",
      description: `<p>${"INNERGY is hiring a Customer Success Manager to guide woodworking shops through adoption. ".repeat(3)}</p>`,
    }), `<h1>Remote Customer Success Jobs</h1><table id="jobsboard">
      <tr class="job"><td><h2>Customer Success Manager ${token}</h2></td><td><a class="button action-apply" href="/l/${id}">Apply</a></td></tr>
      <tr class="job"><td><a href="/remote-jobs/other-1"><h2>Customer Success Manager</h2></a></td><td><a class="button action-apply" href="/l/1">Apply</a></td></tr></table>`,
      "Remote Customer Success Jobs");
    const captured = await capture(credential, html, `https://remoteok.com/remote-jobs/remote-customer-success-manager-innergy-${id}`);
    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: captured.opportunityId } });
    expect(stored.applicationUrl).toBe(`https://remoteok.com/l/${id}`);
    const version = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId: captured.opportunityId } });
    expect(version.applicationUrl).toBe(`https://remoteok.com/l/${id}`);

    const wttj = await capture(credential, page(jsonLd({
      title: `Customer Success Manager ${token}`, hiringOrganization: { name: `AlphaSense ${token}` }, datePosted: "2025-10-03T02:01:34.000Z", validThrough: "2026-11-12T02:01:34.000Z",
      description: "<p>Partner with corporate customers on research workflows.</p>",
    }), `<main><h1>Customer Success Manager ${token}</h1></main>`, `Customer Success Manager ${token}`), `https://app.welcometothejungle.com/jobs/${token}`);
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: wttj.opportunityId } })).closingDate).toBeNull();
  });
});
