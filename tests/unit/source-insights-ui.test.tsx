// Feature 15: Source Intelligence service, API handlers and views.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { identityFromInsightSlug, sourceInsightSlug, type SiFacts } from "@ai-career/core";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { createSourceInsightsApiHandlers, createSourceInsightsService } = await import("../../apps/web/src/server/source-intelligence-service");
const { InsightsSummary, SourceComparisonTable, SourceInsightDetailView, InsightsControls, RateValue } = await import("../../apps/web/src/components/sources/source-insights");
const { sourceValueSummary } = await import("../../apps/web/src/components/sources/insight-labels");
const { SourcesManager } = await import("../../apps/web/src/components/sources/sources-manager");
type SourceSummary = import("../../apps/web/src/server/retrieval-service").SourceSummary;
type SourceView = import("../../apps/web/src/components/sources/types").SourceView;

const now = new Date("2026-10-31T12:00:00.000Z");
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const boardId = "11111111-1111-4111-8111-111111111111";
const atsId = "22222222-2222-4222-8222-222222222222";

const head = (id: string, opportunityId: string, retrievalSourceId: string | null, source: string, at: Date, extra: Record<string, unknown> = {}) => ({
  recordId: id,
  opportunityId,
  source,
  sourceType: retrievalSourceId ? "API" : source === "manual-input" ? "MANUAL" : "BROWSER_EXTENSION",
  sourceCategory: source === "greenhouse" ? ("ATS" as const) : retrievalSourceId ? ("JOB_BOARD" as const) : null,
  retrievalSourceId,
  captureSite: source === "browser-extension" ? "linkedin" : null,
  externalId: `${source}-${id}`,
  duplicateDecision: null,
  sourceUrl: null,
  applicationUrl: null,
  createdAt: at,
  ...extra,
});
const opportunity = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Job ${id}`, company: "Acme", status: "NORMALIZED", createdAt: ago(20), canonicalUrl: null, applicationUrl: null, atsPlatform: null,
  location: null, remoteStatus: null, workArrangements: [], residencyRegions: [], workAuthorizationRegions: [], evaluations: [], openDeferralReason: null,
  markedAppliedAt: null, application: null, probableUnresolved: false, noLongerListed: false, ...extra,
});
const evaluation = (decision: string, cost = 0.25) => ({ id: `e-${Math.random()}`, status: "COMPLETED" as const, createdAt: ago(5), completedAt: ago(5), decision, knownCost: cost, unknownCostAttempts: 0 });

const facts: SiFacts = {
  sources: [
    { id: boardId, name: "Remote board", adapterKey: "remote-ok", category: "JOB_BOARD", enabled: true, archived: false },
    { id: atsId, name: "Acme Greenhouse", adapterKey: "greenhouse", category: "ATS", enabled: true, archived: false },
  ],
  listings: [
    head("r1", "o1", boardId, "remote-ok", ago(10)),
    head("r2", "o1", atsId, "greenhouse", ago(9), { duplicateDecision: "MATCH" }),
    head("r3", "o2", boardId, "remote-ok", ago(8)),
    head("r4", "o3", null, "browser-extension", ago(4)),
  ],
  ledger: [],
  opportunities: [
    opportunity("o1", { evaluations: [evaluation("APPLY")], markedAppliedAt: ago(7), residencyRegions: ["US", "CA"] }),
    opportunity("o2", { evaluations: [evaluation("SKIP")] }),
    opportunity("o3"),
  ],
  runs: [{ retrievalSourceId: boardId, createdAt: ago(1), status: "COMPLETED", errorCode: null, fetched: 30, keptByTerms: 3 }],
  pendingDetails: [],
};

const summary = (id: string, status: SourceSummary["health"]["status"], stale = false) =>
  ({ id, enabled: true, archivedAt: null, health: { status, stale } }) as unknown as SourceSummary;

const service = createSourceInsightsService({
  facts: async () => facts,
  sources: async () => [summary(boardId, "healthy"), summary(atsId, "failing", true)],
  costBasis: async () => ({ currency: "USD", configuredPricingVersions: ["openai-2026-10"] }),
  now: () => now,
});

describe("Source Intelligence service and API", () => {
  it("returns separate automated and user-collected sections, health and attention counts", async () => {
    const overview = await service.overview({ window: "30d" });
    expect(overview.automated.map((row) => row.key)).toEqual([`source:${atsId}`, `source:${boardId}`]);
    expect(overview.userCollected.map((row) => row.key)).toEqual(["extension:linkedin"]);
    expect(overview.health[`source:${atsId}`]).toMatchObject({ status: "failing", stale: true });
    expect(overview.needsAttention).toBe(1);
    expect(overview.pricingVersions).toEqual(["openai-2026-10"]);
  });

  it("answers 400 for an invalid window and 404 for an unknown source", async () => {
    const api = createSourceInsightsApiHandlers(service);
    const bad = await api.overview(new Request("http://localhost/api/sources/insights?window=year"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "REQUEST_INVALID" });
    expect((await api.detail(new Request("http://localhost/api/sources/x/insights"), "not-a-source")).status).toBe(404);
    expect((await api.detail(new Request("http://localhost/api/sources/x/insights"), "33333333-3333-4333-8333-333333333333")).status).toBe(404);
    const ok = await api.detail(new Request(`http://localhost/api/sources/${boardId}/insights?window=all`), boardId);
    expect(ok.status).toBe(200);
    expect((await ok.json()).insight.source.discovery.new).toBe(2);
  });

  it("gives each configured source its last-30-days value strip", async () => {
    const strips = await service.valueStrips();
    expect(strips[boardId]).toMatchObject({ discovered: 2, new: 2, evaluated: 2, useful: 1, usefulSample: "insufficient", costPerUseful: 0.5 });
    expect(sourceValueSummary(strips[boardId]!)).toBe("Last 30 days: 2 found · 2 new · 1 useful of 2 evaluated (insufficient sample) · $0.50 per useful job");
    expect(sourceValueSummary(strips[atsId]!)).toBe("Last 30 days: 1 found · 0 new · 0 useful of 0 evaluated");
  });

  it("round-trips drill-down path segments", () => {
    for (const key of [`source:${boardId}`, "adapter:greenhouse", "extension:linkedin", "manual"]) expect(identityFromInsightSlug(sourceInsightSlug(key))).toBe(key);
    expect(identityFromInsightSlug("../etc")).toBeNull();
  });
});

describe("Source Intelligence views", () => {
  it("renders the summary, sample labels and neutral wording without good/bad colouring", async () => {
    const overview = await service.overview({ window: "30d" });
    const html = renderToStaticMarkup(
      <>
        <InsightsControls overview={overview} />
        <InsightsSummary overview={overview} />
        <SourceComparisonTable rows={overview.automated} overview={overview} caption="Automated" />
        <SourceComparisonTable rows={overview.userCollected} overview={overview} caption="User-collected" />
      </>,
    );
    expect(html).toContain("Insufficient sample");
    expect(html).toContain("No useful jobs yet");
    expect(html).toContain("Failing · stale");
    expect(html).toContain("Browser extension · LinkedIn");
    expect(html).toContain("neither counts against a source");
    expect(html).toContain(`/sources/${boardId}/insights`);
    expect(html).toContain("/sources/extension--linkedin/insights");
    expect(html).not.toMatch(/status-label-health|backlog/i);
  });

  it("drill-down shows credit, presence, evaluation states, multi-valued geography and provenance", async () => {
    const detail = await service.detail(atsId, { window: "all" });
    const html = renderToStaticMarkup(<SourceInsightDetailView detail={detail} />);
    expect(html).toContain("Also listed; discovered by Remote board");
    expect(html).toContain("Also listed here before an outcome credited elsewhere");
    expect(html).toContain("1 applications, 0 interviews, 0 offers");
    expect(html).toContain("Waiting: AI budget");
    expect(html).toContain("Not yet evaluated");
    expect(html).toContain("more than 100%");
    expect(html).toContain("Europe (excluding UK)");
    expect(html).toContain("attached as already known");
    const board = renderToStaticMarkup(<SourceInsightDetailView detail={await service.detail(boardId, { window: "all" })} />);
    expect(board).toContain("Discovered here first");
    expect(board).toContain("Listings scanned in the latest successful run");
  });

  it("shows the compact value strip on a /sources card, linking to the drill-down", () => {
    const view = {
      id: boardId, adapterKey: "remote-ok", adapterName: "Remote OK", name: "Remote board", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "JOB_BOARD",
      enabled: true, config: {}, scheduleMinutes: 720, lastRunAt: null, archivedAt: null, enableBlockedReason: null, configFields: [], runs: [],
      health: { status: "healthy", streak: 0, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null, gate: null, nextRunAt: null, nextRunDue: false, stale: false, neverSucceeded: false, emptyResult: false },
      insights: { discovered: 3, new: 1, evaluated: 0, useful: 0, usefulSample: "none", costPerUseful: null, costIncomplete: false, currency: "USD" },
    } as SourceView;
    const html = renderToStaticMarkup(<SourcesManager sources={[view, { ...view, id: atsId, insights: null }]} adapters={[]} />);
    expect(html).toContain(`href="/sources/${boardId}/insights"`);
    expect(html).toContain("Last 30 days: 3 found · 1 new · 0 useful of 0 evaluated");
    expect(html.match(/source-value-strip/g)).toHaveLength(1);
  });
});

describe("Source Intelligence sample labels", () => {
  it("shows the real value with its label for insufficient and small samples, and no good/bad styling", () => {
    const html = (numerator: number, denominator: number, sample: "insufficient" | "small" | "normal") =>
      renderToStaticMarkup(<RateValue rate={{ numerator, denominator, value: numerator / denominator, sample }} />);
    expect(html(4, 4, "insufficient")).toBe('100% (4 of 4)<span class="sample-label"> · Insufficient sample</span>');
    expect(html(0, 3, "insufficient")).toBe('0% (0 of 3)<span class="sample-label"> · Insufficient sample</span>');
    expect(html(3, 5, "small")).toBe('60% (3 of 5)<span class="sample-label"> · Small sample</span>');
    expect(html(12, 20, "normal")).toBe("60% (12 of 20)");
    for (const markup of [html(4, 4, "insufficient"), html(0, 3, "insufficient"), html(3, 5, "small")]) {
      expect(markup).not.toMatch(/health-(good|warn|bad)|tone|positive|negative|highlight/);
    }
  });
});
