// Feature 18: Company Intelligence service, API handlers and views.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CiApplicationFact, CiFacts, CiOpportunityFact, PostingHistoryListing } from "@ai-career/core";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router, usePathname: () => "/companies" }));
const { createCompanyIntelligenceService, createCompanyApiHandlers } = await import("../../apps/web/src/server/company-intelligence-service");
const { CompanyIndexControls, CompanyIndexView, CompanyDetailControls, CompanyDetailView, timingText } = await import("../../apps/web/src/components/companies/companies");

const now = new Date("2026-11-01T12:00:00.000Z");
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const dayOf = (days: number) => new Date(`${ago(days).toISOString().slice(0, 10)}T00:00:00.000Z`);
const acme = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const acmeLegacy = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const boardId = "11111111-1111-4111-8111-111111111111";
let sequence = 0;
const listing = (extra: Partial<PostingHistoryListing> = {}): PostingHistoryListing => ({
  sourceName: "Acme board", sourceCategory: "ATS", scheduleMinutes: 720, removalCapable: true, currentScope: true, state: "LISTED",
  firstSeenAt: ago(20), lastSeenAt: ago(0.1), missingSince: null, removedAt: null, reappearedAt: null, reappearances: 0, sourceExpiresAt: null, ...extra,
});
const application = (stage: string, appliedOn: Date, extra: Partial<CiApplicationFact> = {}): CiApplicationFact => ({
  stage, outcome: null, appliedOn, closedOn: null, createdAt: appliedOn, events: [], interviews: [], ...extra,
});
const role = (extra: Partial<CiOpportunityFact> = {}): CiOpportunityFact => ({
  id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  companyId: acme, title: "Customer Success Manager", firstSeenAt: ago(20), lastSeenAt: ago(0.1), postingDate: null, closingDate: null, salaryText: "$90k–$110k",
  location: "Remote, US", remoteStatus: "REMOTE", workArrangements: ["REMOTE"], residencyRequirement: null, residencyRegions: ["US"],
  visaSponsorship: null, relocationSupport: null, employerOfRecordRegions: [],
  origin: { source: "greenhouse", sourceType: "ATS", retrievalSourceId: boardId, captureSite: null, externalId: "gh" },
  listings: [listing()], records: [], evaluations: [], markedAppliedAt: null, application: null, ...extra,
});
const facts: CiFacts = {
  companies: [
    { id: acme, name: "Acme", normalizedName: "acme", createdAt: ago(100) },
    { id: acmeLegacy, name: "ACME, Inc.", normalizedName: "acme", createdAt: ago(50) },
  ],
  sources: [{ id: boardId, name: "Acme board", adapterKey: "greenhouse", category: "ATS", enabled: true, archived: false }],
  probablePairs: [],
  withoutCompany: 2,
  opportunities: [
    role({ application: application("APPLIED", dayOf(40)) }),
    role({ listings: [listing({ reappearedAt: ago(3), reappearances: 1, removedAt: ago(9) })], companyId: acmeLegacy }),
    role({ title: "Implementation Consultant", listings: [], remoteStatus: "HYBRID", workArrangements: ["HYBRID"], application: application("CLOSED", dayOf(50), { outcome: "NO_RESPONSE", closedOn: dayOf(30) }) }),
  ],
};
const reads = { count: 0 };
const service = createCompanyIntelligenceService({
  facts: async () => {
    reads.count += 1;
    return facts;
  },
  companyGroupIds: async (id) => (id === acme || id === acmeLegacy ? [acme, acmeLegacy] : []),
  companyIdForOpportunity: async () => acme,
  timeZone: async () => "UTC",
  now: () => now,
});
const forbidden = /\bhire[sd]?\b|hiring speed|time to (hire|fill)|ghost|remote[- ]friendly|suspicious|\bscore\b|\bbest\b|\bworst\b|trustworthy/i;

describe("Company Intelligence service and API", () => {
  it("answers 400 for invalid parameters without reading, and 200 with the index", async () => {
    const api = createCompanyApiHandlers(service);
    const before = reads.count;
    for (const query of ["window=7d", "sort=best", "page=0", "listed=yes", "arrangement=MOON", "window=custom&from=2026-10-10&to=2026-10-01"]) {
      const response = await api.index(new Request(`http://localhost/api/companies?${query}`));
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ code: "REQUEST_INVALID" });
    }
    expect(reads.count).toBe(before);
    const ok = await api.index(new Request("http://localhost/api/companies"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.companies.rows).toHaveLength(1);
    expect(body.companies.rows[0]).toMatchObject({ id: acme, name: "Acme", otherNames: ["ACME, Inc."], observedRoles: 3, listedAgain: 1 });
  });

  it("answers 404 for an unknown or malformed company id and 200 for any member of the group", async () => {
    const api = createCompanyApiHandlers(service);
    expect((await api.detail(new Request("http://localhost/api/companies/x"), "not-a-uuid")).status).toBe(404);
    expect((await api.detail(new Request("http://localhost/api/companies/x"), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).status).toBe(404);
    expect((await api.detail(new Request("http://localhost/api/companies/x?window=7d"), acme)).status).toBe(400);
    const ok = await api.detail(new Request("http://localhost/api/companies/x"), acmeLegacy);
    expect(ok.status).toBe(200);
    expect((await ok.json()).company.company).toMatchObject({ id: acme, names: ["Acme", "ACME, Inc."] });
  });
});

describe("Company Intelligence views", () => {
  it("renders the index with counts, name variants, disclosures and no scores", async () => {
    const index = await service.index({});
    const html = renderToStaticMarkup(
      <>
        <CompanyIndexControls index={index} />
        <CompanyIndexView index={index} />
      </>,
    );
    expect(html).toContain(`href="/companies/${acme}"`);
    expect(html).toContain("+1 name variant");
    expect(html).toContain("2 jobs have no recorded company");
    expect(html).toContain("Companies are grouped by exact normalized name.");
    expect(html).toContain("not the company&#x27;s actual hiring");
    expect(html).toContain('action="/companies"');
    expect(html).toContain("2 of 3");
    expect(html).toContain(">Listed again after removal</th>");
    expect(html.replace("not the company&#x27;s actual hiring", "")).not.toMatch(forbidden);
  });

  it("renders the six detail sections with factual wording and no labels", async () => {
    const detail = (await service.detail(acme, {}))!;
    const html = renderToStaticMarkup(
      <>
        <CompanyDetailControls detail={detail} />
        <CompanyDetailView detail={detail} />
      </>,
    );
    for (const heading of ["Overview", "Observed postings", "Recurring roles", "Work arrangement and hiring regions", "Your history with this company", "Posting-history signals"]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain("These tables show what happened after your applications to this company. They do not rate the company.");
    expect(html).toContain("not when the company replied");
    expect(html).toContain("not how long hiring took");
    expect(html).toContain("It is not a repost");
    expect(html).toContain("2 of 3 observed roles that state an arrangement were Remote.");
    expect(html).toContain("Listed again after confirmed removal");
    expect(html).toContain("Relisted under a new listing ID — same requisition");
    expect(html).toContain("To first progress recorded in your tracker");
    expect(html).toContain("Listings still listed");
    expect(html).toContain("No response (recorded outcome)");
    expect(html).toContain("Status unknown");
    expect(html).toContain("$90k–$110k");
    expect(html).toContain(`action="/companies/${acme}"`);
    const scrubbed = html.replace("not the company&#x27;s actual hiring", "").replace("not how long hiring took", "");
    expect(scrubbed).not.toMatch(forbidden);
    expect(html).not.toMatch(/health-(good|warn|bad)|tone-|positive|negative|highlight/);
  });

  it("states timings with n, lists values below 5 and a median from 5", () => {
    expect(timingText({ n: 0, values: [], median: null, sample: "none", inconsistent: 1 })).toBe("No dates recorded (1 with dates out of order not counted)");
    expect(timingText({ n: 2, values: [3, 9], median: null, sample: "insufficient", inconsistent: 0 })).toBe("3, 9 days (n = 2) · Insufficient sample");
    expect(timingText({ n: 5, values: [], median: 8, sample: "small", inconsistent: 0 })).toBe("Median 8 days (n = 5) · Small sample");
  });
});
