// Feature 17: Personal Job-Search Analytics service, API handler and views.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PaApplicationFact, PaEvaluationFact, PaFacts, PaOpportunityFact } from "@ai-career/core";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router, usePathname: () => "/my-search" }));
const { createPersonalAnalyticsService, createPersonalApiHandlers } = await import("../../apps/web/src/server/personal-analytics-service");
const { MySearchControls, MySearchView, parseRoleSort } = await import("../../apps/web/src/components/my-search/my-search");

const now = new Date("2026-10-31T12:00:00.000Z");
const dayOf = (days: number) => new Date(Date.UTC(2026, 9, 31 - days));
const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const boardId = "11111111-1111-4111-8111-111111111111";
let sequence = 0;
const evaluation = (decision: string, completedAt: Date, extra: Partial<PaEvaluationFact> = {}): PaEvaluationFact => ({
  id: `e-${++sequence}`,
  status: "COMPLETED",
  createdAt: completedAt,
  completedAt,
  decision,
  userProfileId: profileId,
  userProfileVersion: 3,
  roleClassification: "CORE_CS",
  customerSegment: "SMB",
  customerType: "B2C",
  alexFit: "STRONG",
  resumeMatch: { band: "GOOD_HIGH", gaps: [{ category: "TOOL", requirementText: "Salesforce", strength: "REQUIRED", decisionImpact: "MATERIAL_UNCERTAINTY" }] },
  resumeMatchVersion: "cs-resume-match-v2",
  ...extra,
});
const application = (stage: string, appliedOn: Date): PaApplicationFact => ({ stage, outcome: null, appliedOn, createdAt: appliedOn, events: [], interviews: [] });
const job = (extra: Partial<PaOpportunityFact> = {}): PaOpportunityFact => ({
  id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  title: "Customer Success Manager",
  status: "APPLIED",
  seniority: null,
  remoteStatus: null,
  workArrangements: [],
  origin: { source: "remote-ok", sourceType: "API", retrievalSourceId: boardId, captureSite: null, externalId: "x" },
  evaluations: [],
  openDeferralReason: null,
  noLongerListed: false,
  markedAppliedAt: null,
  application: null,
  ...extra,
});
const facts: PaFacts = {
  sources: [{ id: boardId, name: "Remote board", adapterKey: "remote-ok", category: "JOB_BOARD", enabled: true, archived: false }],
  profiles: [{ id: profileId, label: "Alex", version: 3 }],
  activeProfileId: profileId,
  opportunities: [
    ...Array.from({ length: 5 }, () => job({ application: application("APPLIED", dayOf(40)), evaluations: [evaluation("APPLY", dayOf(45))] })),
    job({ title: "Implementation Consultant", application: application("INTERVIEWING", dayOf(40)), evaluations: [evaluation("REVIEW", dayOf(40))] }),
    job({ application: application("APPLIED", dayOf(3)), origin: { source: "browser-extension", sourceType: "BROWSER_EXTENSION", retrievalSourceId: null, captureSite: "linkedin", externalId: "linkedin:1" } }),
  ],
};
const reads = { count: 0 };
const service = createPersonalAnalyticsService({
  facts: async () => {
    reads.count += 1;
    return facts;
  },
  timeZone: async () => "UTC",
  now: () => now,
});

describe("My search service and API", () => {
  it("answers 400 for invalid parameters without reading, and 200 with the analytics", async () => {
    const api = createPersonalApiHandlers(service);
    const before = reads.count;
    for (const query of ["window=7d", "recommendation=MAYBE", "profile=latest", "source=../x", "window=custom&from=2026-10-10&to=2026-10-01"]) {
      const response = await api.analytics(new Request(`http://localhost/api/my-search?${query}`));
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ code: "REQUEST_INVALID" });
    }
    expect(reads.count).toBe(before);
    const ok = await api.analytics(new Request("http://localhost/api/my-search"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.personal.window.key).toBe("all");
    expect(body.personal.overview.applied).toBe(7);
    expect(body.personal.funnels.byRecommendationAtApplication.find((row: { key: string }) => row.key === "SAME_DAY_UNKNOWN")).toMatchObject({ applied: 1 });
  });
});

describe("My search views", () => {
  it("renders the seven sections with factual wording, disclosures and no good/bad styling", async () => {
    const personal = await service.analytics({});
    const html = renderToStaticMarkup(
      <>
        <MySearchControls personal={personal} roleSort="title" />
        <MySearchView personal={personal} roleSort="title" />
      </>,
    );
    for (const heading of ["Overview", "Application funnel", "Roles", "Recurring Genuine Gaps", "Sources", "Where applications are not progressing", "Company type"]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain("These tables show what happened after each stored evaluation or recommendation. They do not measure evaluator accuracy.");
    expect(html).toContain("What the evaluator said");
    expect(html).toContain("What actually happened");
    expect(html).toContain("Same-day order unknown");
    expect(html).toContain("Awaiting response");
    expect(html).toContain("In process");
    expect(html).toContain("similar wording is not merged");
    expect(html).toContain("Alex v3 profile");
    expect(html).toContain('href="/sources/insights"');
    expect(html).toContain("Browser extension · LinkedIn");
    expect(html).toContain("5 mature applications, no interviews yet");
    expect(html).toContain("Recommended but not applied");
    expect(html).toContain("Insufficient sample");
    expect(html).toContain('action="/my-search"');
    expect(html).not.toMatch(/best[- ]fit|wasted|accuracy %|precision|recall/i);
    expect(html).not.toMatch(/health-(good|warn|bad)|tone-|positive|negative|highlight/);
  });

  it("ranks roles only when the group meets the sample threshold", async () => {
    const personal = await service.analytics({});
    const html = renderToStaticMarkup(<MySearchView personal={personal} roleSort={parseRoleSort("apply")} />);
    expect(html).toContain("Ordered by most apply recommendations; only groups with at least 5 are ranked.");
    const table = html.slice(html.indexOf("Roles by evaluator fit and by outcomes"));
    expect(table.indexOf(">Customer Success<")).toBeLessThan(table.indexOf(">Implementation<"));
    expect(table).toMatch(/Implementation<span class="sample-label"> · not ranked<\/span>/);
    expect(parseRoleSort("anything")).toBe("title");
  });
});
