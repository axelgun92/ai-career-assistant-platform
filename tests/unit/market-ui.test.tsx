// Feature 16: Job-Market Analytics service, API handler and views.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MarketEvaluationFact, MarketOpportunityFact } from "@ai-career/core";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router, usePathname: () => "/market" }));
const { createMarketAnalyticsService, createMarketApiHandlers } = await import("../../apps/web/src/server/market-analytics-service");
const { MarketControls, MarketView, dashboardHref } = await import("../../apps/web/src/components/market/market-analytics");
const { formatMedian } = await import("../../apps/web/src/components/market/market-labels");

const now = new Date("2026-10-31T12:00:00.000Z");
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
let sequence = 0;
const job = (extra: Partial<MarketOpportunityFact> = {}): MarketOpportunityFact => ({
  id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  title: "Customer Success Manager",
  status: "NORMALIZED",
  firstSeenAt: ago(3),
  automated: true,
  seniority: null,
  seniorityLabel: null,
  location: null,
  remoteStatus: null,
  workArrangements: [],
  residencyRequirement: null,
  residencyRegions: [],
  workAuthorizationRequirement: null,
  workAuthorizationRegions: [],
  visaSponsorship: null,
  relocationSupport: null,
  employerOfRecordRegions: [],
  timeZoneRequirements: null,
  salaryMin: null,
  salaryMax: null,
  currency: null,
  compensationBasis: null,
  compensationTiers: [],
  evaluations: [],
  openDeferralReason: null,
  probableUnresolved: false,
  noLongerListed: false,
  ...extra,
});
const evaluation = (decision: string): MarketEvaluationFact => ({
  id: `e-${++sequence}`,
  status: "COMPLETED",
  createdAt: ago(1),
  completedAt: ago(1),
  decision,
  roleClassification: "CORE_CS",
  customerSegment: "SMB",
  reconstructionVersion: "cs-jd-reconstruction-v3",
  requirements: [{ requirement: "Gainsight", category: "TOOL", strength: "REQUIRED", statedYears: null, statedYearsMaximum: null, statedYearsOpenEnded: false }],
});

const facts = [
  job({ salaryMin: 100_000, salaryMax: 120_000, currency: "USD", compensationBasis: "BASE", seniority: "SENIOR", evaluations: [evaluation("APPLY")] }),
  job({ salaryMin: 150_000, salaryMax: 170_000, currency: "USD", compensationBasis: "OTE", workArrangements: ["REMOTE", "HYBRID"] }),
  job({ title: "Account Executive", salaryMin: 80_000, salaryMax: 90_000, currency: "CAD", location: "Toronto, Ontario, Canada" }),
  job({ compensationTiers: [{ label: "Zone A", minimum: 130_000, maximum: 150_000, currency: "USD" }, { label: "Zone B", minimum: 110_000, maximum: 130_000, currency: "USD" }] }),
  job({ automated: false, title: "Client Success Lead" }),
  job({ openDeferralReason: "AI_BUDGET_LIMIT" }),
  job({ salaryMin: 70_000, salaryMax: 75_000, currency: null, compensationBasis: "BASE" }),
];
const reads = { count: 0 };
const service = createMarketAnalyticsService({
  facts: async () => {
    reads.count += 1;
    return facts;
  },
  now: () => now,
});

describe("Market service and API", () => {
  it("answers 400 for invalid parameters without reading, and 200 with the analytics", async () => {
    const api = createMarketApiHandlers(service);
    const before = reads.count;
    for (const query of ["window=year", "seniority=STAFF", "collected=manual", "currency=UNKNOWN", "window=custom&from=2026-10-10&to=2026-10-01"]) {
      const response = await api.analytics(new Request(`http://localhost/api/market?${query}`));
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ code: "REQUEST_INVALID" });
    }
    expect(reads.count).toBe(before);
    const ok = await api.analytics(new Request("http://localhost/api/market?collected=all&currency=cad"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.market.overview.total).toBe(7);
    expect(body.market.salary.selectedCurrency).toBe("CAD");
    expect(body.market.notes.selectionBias).toMatch(/selection bias/);
  });

  it("defaults to automated only, using the Customer Success discovery terms", async () => {
    const market = await service.analytics({});
    expect(market.filters.collection).toBe("automated");
    expect(market.overview.total).toBe(6);
    expect(market.titleGroups[0]).toBe("Customer Success");
    expect(market.titleGroups.at(-1)).toBe("OTHER");
  });
});

describe("Market views", () => {
  it("renders every section with coverage, disclosure and Unknown, without good/bad styling", async () => {
    const market = await service.analytics({});
    const html = renderToStaticMarkup(
      <>
        <MarketControls market={market} />
        <MarketView market={market} />
      </>,
    );
    for (const heading of ["Overview", "Salary", "Roles and titles", "Location and work arrangement", "Seniority", "Requirements", "Customer segment — evaluated jobs only", "Recommendations"]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain("Evaluations are jobs you chose to evaluate. These results describe evaluated opportunities, not the entire collected market.");
    expect(html).toContain("% of all jobs");
    expect(html).toContain("% of known jobs");
    expect(html).toContain("Unresolved possible duplicates");
    expect(html).toContain("Requirement data available");
    expect(html).toContain("Automated retrieval began on October 18, 2026");
    expect(html).toContain("Other title");
    expect(html).toContain("Waiting: AI budget");
    expect(html).toContain("Completed without recommendation");
    expect(html).toContain("Several options");
    expect(html).toContain("Insufficient sample");
    expect(html).toContain("USD, base salary");
    expect(html).toContain("USD, on-target earnings (ote)");
    expect(html).toContain("Zone B");
    expect(html).toContain("Hiring eligibility (stated residency)");
    // Unknown currency: coverage only, never statistics or a selectable currency.
    expect(html).toContain("Currency not stated — 1 job with annual salary amounts that cannot be included in currency-based market statistics.");
    expect(html).not.toMatch(/Salary statistics, Currency not stated/);
    const currencySelect = html.slice(html.indexOf('name="currency"'), html.indexOf("</select>", html.indexOf('name="currency"')));
    expect(currencySelect).toContain('<option value="USD">');
    expect(currencySelect).not.toContain("UNKNOWN");
    // Weekly recommendation distribution with n and coverage.
    expect(html).toMatch(/<th scope="col">Evaluated<\/th><th scope="col">Coverage<\/th><th scope="col">Apply<\/th>/);
    expect(html).toContain("100% (1 of 1)<span class=\"sample-label\"> · Insufficient sample</span>");
    expect(html).toContain("shares of that week’s completed evaluations with a recommendation");
    // Experience wording.
    expect(html).toContain("Highest stated minimum experience requirement per job");
    expect(html).not.toContain("Stated years of experience");
    expect(html).not.toMatch(/health-(good|warn|bad)|tone-|positive|negative|highlight/);
    expect(html).not.toMatch(/selection bias/);
    // Fewer than 5 of a list: alphabetical, never ranked.
    expect(html).toContain("Insufficient sample: listed alphabetically, not ranked.");
    expect(html).toContain('action="/market"');
    expect(html).toContain('name="excludeRemoved"');
  });

  it("shows the All-collected selection-bias note", async () => {
    const html = renderToStaticMarkup(<MarketView market={await service.analytics({ collected: "all" })} />);
    expect(html).toContain("These are user-selected captures and may introduce selection bias.");
  });

  it("links to dashboard filters the dashboard supports", async () => {
    const market = await service.analytics({ window: "30d" });
    const href = dashboardHref(market, { seniority: "SENIOR", segment: "MID_MARKET", rec: "APPLY", title: "Customer Success" });
    expect(href).toMatch(/^\/\?view=all&from=2026-10-01&seniority=senior&segment=mid-market&rec=apply&title=Customer\+Success$/);
    const html = renderToStaticMarkup(<MarketView market={market} />);
    expect(html).toContain("/?view=all&amp;from=2026-10-01&amp;arrangement=remote");
    expect(html).not.toContain("arrangement=several");
  });

  it("formats medians with n and sample label, never zero for no data", () => {
    expect(formatMedian({ value: 110_000, n: 2, sample: "insufficient" }, "USD")).toBe("$110,000 (n = 2) · Insufficient sample");
    expect(formatMedian({ value: 95_000, n: 7, sample: "small" }, "CAD")).toBe("CA$95,000 (n = 7) · Small sample");
    expect(formatMedian({ value: 95_000, n: 25, sample: "normal" }, "EUR")).toBe("€95,000 (n = 25)");
    expect(formatMedian({ value: null, n: 0, sample: "none" }, "USD")).toBe("No data");
  });
});
