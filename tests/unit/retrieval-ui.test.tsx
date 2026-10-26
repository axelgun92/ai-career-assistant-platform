// @vitest-environment jsdom
// Feature 11A: the /sources manager, retrieval provenance on the
// opportunity page, and the dashboard's "Found via" and "Listing changed".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { SourcesManager } = await import("../../apps/web/src/components/sources/sources-manager");
const { OpportunityProvenance } = await import("../../apps/web/src/components/opportunity-provenance");
const { OpportunityList } = await import("../../apps/web/src/components/dashboard/opportunity-list");
const { scheduleLabel } = await import("../../apps/web/src/components/sources/source-labels");
const { PostingHistory } = await import("../../apps/web/src/components/posting-history");
const { ListingVersionHint } = await import("../../apps/web/src/components/evaluation/listing-version-hint");
type RetrievedListingRecord = import("@ai-career/database").RetrievedListingRecord;
type SourceView = import("../../apps/web/src/components/sources/types").SourceView;
type AdapterView = import("../../apps/web/src/components/sources/types").AdapterView;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sourceId = "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e";
let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  router.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (element: React.ReactNode) => act(() => root.render(element));
const button = (name: string) => {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

const boardField = { name: "board", label: "Board", help: "The board name.", required: true };
const adapters: AdapterView[] = [
  { key: "test-board", name: "Test Board", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", verified: true, missingEnvironment: [], attribution: null, configFields: [boardField] },
  { key: "adzuna", name: "Adzuna", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "AGGREGATOR", verified: false, missingEnvironment: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"], attribution: "Jobs by Adzuna", configFields: [] },
];

function source(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: sourceId,
    adapterKey: "test-board",
    adapterName: "Test Board",
    name: "Acme careers",
    retrievalType: "OFFICIAL_PUBLIC_API_FEED",
    sourceCategory: "ATS",
    enabled: false,
    config: { board: "acme" },
    scheduleMinutes: 720,
    lastRunAt: null,
    archivedAt: null,
    enableBlockedReason: null,
    configFields: [boardField],
    runs: [],
    health: {
      status: "not_run", streak: 0, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null, gate: null,
      nextRunAt: null, nextRunDue: false, stale: false, neverSucceeded: false, emptyResult: false,
    },
    ...overrides,
  };
}

describe("sources manager", () => {
  it("shows each source's type, schedule, state and run history", () => {
    const html = renderToStaticMarkup(
      <SourcesManager
        adapters={adapters}
        sources={[
          source({
            enabled: true,
            lastRunAt: "2026-10-18T09:00:00.000Z",
            runs: [
              {
                id: "r1", trigger: "SCHEDULE", status: "PARTIAL", createdAt: "2026-10-18T09:00:00.000Z", startedAt: null,
                finishedAt: "2026-10-18T09:01:00.000Z", errorCode: "RATE_LIMITED", errorMessage: "The source rate-limited retrieval; retrieval stopped.",
                counts: { fetched: 40, keptByTerms: 3, created: 1, attached: 1, unchanged: 0, changed: 1, probable: 1, failed: 0 },
              },
            ],
          }),
          source({ id: "a1", name: "Old board", archivedAt: "2026-10-01T00:00:00.000Z" }),
        ]}
      />,
    );
    expect(html).toContain("Your sources (1)");
    expect(html).toContain("Test Board (employer ATS · official API or feed)");
    expect(html).toContain("Board: <code>acme</code>");
    expect(html).toContain("Runs every 12 hours when enabled");
    expect(html).toContain("Partly completed");
    expect(html).toContain("40 fetched, 3 matched the role terms: 1 new (1 possible duplicate), 1 added to existing, 1 changed, 0 unchanged");
    expect(html).toContain("rate-limited retrieval");
    expect(html).toContain("Archived sources (1)");
    expect(html).toContain("Adzuna (awaiting verification)");
  });

  it("enables a source, queues Run now and confirms removal", async () => {
    fetchMock.mockReturnValue(json({ source: {} }));
    render(<SourcesManager adapters={adapters} sources={[source()]} />);
    expect(button("Run now").disabled).toBe(true);
    await act(async () => button("Enable").click());
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`/api/sources/${sourceId}`, expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ enabled: true });
    expect(router.refresh).toHaveBeenCalled();

    render(<SourcesManager adapters={adapters} sources={[source({ enabled: true })]} />);
    await act(async () => button("Run now").click());
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/sources/${sourceId}/runs`, expect.objectContaining({ method: "POST" }));
    expect(container.textContent).toContain("Run queued. The retrieval worker will pick it up.");

    await act(async () => button("Remove").click());
    expect(container.textContent).toContain("This source has never run and will be deleted.");
    await act(async () => button("Confirm remove").click());
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/sources/${sourceId}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("explains why a source cannot be enabled and shows server refusals", async () => {
    fetchMock.mockReturnValue(json({ error: "This source is awaiting verification and cannot be enabled yet", code: "ADAPTER_UNVERIFIED" }, 409));
    render(<SourcesManager adapters={adapters} sources={[source({ adapterKey: "adzuna", enableBlockedReason: "Awaiting verification against a real response." })]} />);
    expect(container.textContent).toContain("Cannot be enabled: Awaiting verification against a real response.");
    expect(button("Enable").disabled).toBe(true);
    render(<SourcesManager adapters={adapters} sources={[source({ runs: [] })]} />);
    await act(async () => button("Enable").click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enable: This source is awaiting verification and cannot be enabled yet");
  });

  it("adds a source with its settings and schedule", async () => {
    fetchMock.mockReturnValue(json({ source: {} }, 201));
    render(<SourcesManager adapters={adapters} sources={[]} />);
    const board = [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Board"))!.querySelector("input")!;
    await act(async () => setValue(board, " acme "));
    const hours = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => setValue(hours, "24"));
    await act(async () => button("Add source").click());
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/sources", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ adapterKey: "test-board", config: { board: "acme" }, scheduleMinutes: 1440 });
    // The browser's own validation stops an out-of-range number; the form
    // also refuses one if it is submitted anyway.
    await act(async () => setValue(board, "beta"));
    await act(async () => setValue(hours, "0"));
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("The schedule must be a whole number of hours from 1 to 168.");
  });

  // Feature 12: health, freshness and the Run now gate.
  const healthy = (overrides: Partial<SourceView["health"]> = {}): SourceView["health"] => ({
    status: "healthy", streak: 0, lastAttemptAt: "2026-10-18T09:00:00.000Z", lastSuccessAt: "2026-10-18T09:01:00.000Z", lastFailure: null,
    gate: null, nextRunAt: "2026-10-18T21:00:00.000Z", nextRunDue: false, stale: false, neverSucceeded: false, emptyResult: false,
    ...overrides,
  });

  it("shows an enabled source's health, last success, next run and freshness notes", () => {
    const html = renderToStaticMarkup(
      <SourcesManager
        adapters={adapters}
        sources={[
          source({ enabled: true, lastRunAt: "2026-10-18T09:00:00.000Z", health: healthy({ emptyResult: true }) }),
          source({
            id: "f1", name: "Flaky board", enabled: true, lastRunAt: "2026-10-18T09:00:00.000Z",
            health: healthy({
              status: "failing", streak: 3, lastSuccessAt: "2026-10-15T09:00:00.000Z", stale: true,
              lastFailure: { at: "2026-10-18T09:01:00.000Z", code: "SERVER_ERROR", message: "The source had a server error; retrieval stopped." },
              gate: { kind: "backoff", until: "2026-10-20T09:01:00.000Z" }, nextRunAt: "2026-10-20T09:01:00.000Z",
            }),
          }),
          source({ id: "d1", name: "Off board", health: healthy({ status: "disabled" }) }),
        ]}
      />,
    );
    expect(html).toContain('aria-label="Health: Healthy"');
    expect(html).toContain("Last attempt: 18 Oct 2026, 09:00 UTC");
    expect(html).toContain("Last successful retrieval: 18 Oct 2026, 09:01 UTC · Next run: 18 Oct 2026, 21:00 UTC");
    expect(html).toContain("The last successful retrieval returned no listings; the board may be empty.");
    expect(html).toContain('aria-label="Health: Failing"');
    expect(html).toContain("Next run: 20 Oct 2026, 09:01 UTC (backing off after 3 source failures)");
    expect(html).toContain("Latest failure: 18 Oct 2026, 09:01 UTC · The source had a server error; retrieval stopped.");
    expect(html).toContain("No successful retrieval for more than two schedule intervals.");
    // A disabled source shows no health badge or health lines.
    expect(html).not.toContain('aria-label="Health: Disabled"');
    expect(html.match(/Last successful retrieval/g)).toHaveLength(2);
  });

  it("disables Run now during a rate limit or a wait the source asked for, with distinct wording", () => {
    render(
      <SourcesManager
        adapters={adapters}
        sources={[source({ enabled: true, health: healthy({ status: "rate_limited", gate: { kind: "rate_limited", until: "2026-12-17T12:00:00.000Z" } }) })]}
      />,
    );
    expect(button("Run now").disabled).toBe(true);
    expect(container.textContent).toContain("Rate limited until 17 Dec 2026, 12:00 UTC");
    expect(container.textContent).not.toContain("requested by the source");
    render(
      <SourcesManager
        adapters={adapters}
        sources={[source({ enabled: true, health: healthy({ status: "provider_wait", gate: { kind: "provider_wait", until: "2026-10-18T13:00:00.000Z" } }) })]}
      />,
    );
    expect(button("Run now").disabled).toBe(true);
    expect(container.textContent).toContain("Retry after 18 Oct 2026, 13:00 UTC (requested by the source)");
    expect(container.textContent).not.toContain("Rate limited until");
    expect(container.textContent).toContain("Waiting (requested by the source)");
  });

  it("asks before running past our own backoff and sends the override only after confirmation", async () => {
    fetchMock.mockReturnValue(json({ run: {}, alreadyActive: false }, 202));
    render(
      <SourcesManager
        adapters={adapters}
        sources={[source({ enabled: true, health: healthy({ status: "needs_attention", streak: 1, gate: { kind: "backoff", until: "2026-10-19T09:00:00.000Z" } }) })]}
      />,
    );
    await act(async () => button("Run now").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Retrieval is backing off after source failures until 19 Oct 2026, 09:00 UTC.");
    await act(async () => button("Wait").click());
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => button("Run now").click());
    await act(async () => button("Run now anyway").click());
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`/api/sources/${sourceId}/runs`, expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ override: true });
    expect(container.textContent).toContain("Run queued. The retrieval worker will pick it up.");
  });

  it("formats schedules", () => {
    expect(scheduleLabel(720)).toBe("every 12 hours");
    expect(scheduleLabel(1440)).toBe("every day");
    expect(scheduleLabel(60)).toBe("every hour");
  });
});

describe("retrieval provenance and dashboard", () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: "s1", source: "test-board", sourceType: "ATS", sourceUrl: "https://jobs.example.com/1", applicationUrl: null, externalId: "1",
    requisitionId: null, rawTitle: "Customer Success Manager", rawCompany: "Acme", rawLocation: null, rawDescription: "x", rawSalaryText: null,
    rawEmploymentType: null, rawPostingDate: null, sourceMetadata: { sourceName: "Test Board", attribution: "via Test Board" }, rawPayload: null,
    retrievalType: "OFFICIAL_PUBLIC_API_FEED" as const, sourceCategory: "ATS" as const, retrievalSourceId: sourceId,
    retrievalSourceName: "Acme careers", retrievalRunId: "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f", previousSourceRecordId: null,
    discoveredAt: new Date("2026-10-18T09:00:00Z"), lastObservedAt: new Date("2026-10-18T09:00:00Z"), normalizedAt: null,
    createdAt: new Date("2026-10-18T09:00:00Z"), updatedAt: new Date("2026-10-18T09:00:00Z"),
    ...overrides,
  });

  it("shows where a retrieved listing was found and that it changed since first seen", () => {
    const html = renderToStaticMarkup(
      <OpportunityProvenance
        opportunity={{ source: "test-board", sourceType: "ATS", firstSeenAt: new Date(), lastSeenAt: new Date(), sourceUpdatedAt: null }}
        sourceRecords={[record(), record({ id: "s2", previousSourceRecordId: "s1", discoveredAt: new Date("2026-10-19T09:30:00Z") })]}
      />,
    );
    expect(html).toContain('Test Board (employer ATS · official API or feed) · <a href="https://jobs.example.com/1" target="_blank" rel="noopener noreferrer">via Test Board</a>');
    expect(html).toContain("Listing changed since first seen</strong> (latest change found 2026-10-19 09:30 UTC)");
    expect(html).toContain("Retrieved by your source “Acme careers” in run <code>7c1d4e2f</code>");
    expect(html).toContain("A changed version of this listing, found 2026-10-19 09:30 UTC. The earlier version is kept");
    // Core TDD §51 (v1.15): current facts are the latest version; history and evaluations are kept.
    expect(html).toContain("The opportunity shows the latest version of the listing it was found from; every earlier version is kept below.");
    expect(html).toContain("An earlier evaluation stays as it was and may describe an earlier version; reevaluating is up to you.");
  });

  it("hints that the latest evaluation used an earlier listing version, and shows nothing otherwise", () => {
    const html = renderToStaticMarkup(
      <ListingVersionHint hint={{ evaluatedAt: new Date("2026-10-19T12:00:00Z"), evaluatedVersionSeenAt: new Date("2026-10-18T09:00:00Z"), currentVersionSeenAt: new Date("2026-10-21T09:30:00Z") }} />,
    );
    expect(html).toContain('role="note"');
    expect(html).toContain("The latest evaluation was made using the listing version first seen on 2026-10-18. The listing has changed since then (latest version seen on 2026-10-21). Reevaluate to evaluate the current version; the earlier evaluation is kept.");
    expect(renderToStaticMarkup(<ListingVersionHint hint={null} />)).toBe("");
  });

  it("does not show a change notice for manual records", () => {
    const html = renderToStaticMarkup(
      <OpportunityProvenance
        opportunity={{ source: "manual-input", sourceType: "MANUAL", firstSeenAt: new Date(), lastSeenAt: new Date(), sourceUpdatedAt: null }}
        sourceRecords={[record({ source: "manual-input", sourceType: "MANUAL", retrievalType: null, sourceCategory: null, retrievalSourceId: null, sourceMetadata: null })]}
      />,
    );
    expect(html).not.toContain("Listing changed");
    expect(html).not.toContain("Retrieved by");
  });

  it("shows Found via and Listing changed on dashboard rows", () => {
    const row = (id: string, foundVia: string | null, listingChanged: boolean) => ({
      id, domain: "customer-success", status: "NORMALIZED", source: "test-board", sourceType: "ATS", title: id, companyName: "Acme",
      location: null, salaryText: null, postingDate: null, createdAt: new Date("2026-10-18T00:00:00Z"), deferred: false,
      latestEvaluation: null, foundVia, listingChanged,
    });
    const html = renderToStaticMarkup(<OpportunityList opportunities={[row("one", "Test Board", true), row("two", null, false)]} />);
    expect(html).toContain("Found via Test Board");
    expect(html.match(/Listing changed/g)).toHaveLength(1);
    expect(html).toContain("Current facts show its latest version; earlier versions are kept, and an existing evaluation may describe an earlier one. Reevaluating is optional.");
    expect(html).toContain("Applicant tracking system");
    const gone = renderToStaticMarkup(<OpportunityList opportunities={[{ ...row("three", "Test Board", false), noLongerListed: true }, row("four", null, false)]} />);
    expect(gone.match(/No longer listed/g)).toHaveLength(1);
  });

  // Feature 13.
  describe("posting history", () => {
    const at = (iso: string) => new Date(iso);
    const tracked = (overrides: Partial<RetrievedListingRecord> = {}): RetrievedListingRecord => ({
      id: "l1", retrievalSourceId: sourceId, source: "greenhouse", externalId: "1", opportunityId: "o1", removalCapable: true,
      state: "LISTED", firstSeenAt: at("2026-10-01T09:00:00Z"), lastSeenAt: at("2026-10-19T09:00:00Z"), missingSince: null,
      missedCompleteRuns: 0, removedAt: null, reappearedAt: null, reappearances: 0, sourceExpiresAt: null, currentScope: true,
      retrievalSource: { name: "Acme Greenhouse", adapterKey: "greenhouse", sourceCategory: "ATS", scheduleMinutes: 720, enabled: true, archivedAt: null },
      ...overrides,
    });
    const now = at("2026-10-19T12:00:00Z");
    const render = (listings: RetrievedListingRecord[]) => renderToStaticMarkup(<PostingHistory listings={listings} sourceRecords={[]} now={now} />);

    it("words each listing's status conservatively and lists the observed facts without a risk label", () => {
      const html = render([
        tracked(),
        tracked({ id: "l2", state: "HISTORICAL", lastSeenAt: at("2026-10-10T09:00:00Z") }),
        tracked({ id: "l3", state: "MISSING", missingSince: at("2026-10-19T08:00:00Z"), lastSeenAt: at("2026-10-18T21:00:00Z") }),
        tracked({ id: "l4", state: "UNTRACKED", currentScope: false }),
        tracked({ id: "l5", removalCapable: false, retrievalSource: { name: "Remote OK", adapterKey: "remote-ok", sourceCategory: "JOB_BOARD", scheduleMinutes: 720, enabled: true, archivedAt: null }, sourceExpiresAt: at("2026-11-01T00:00:00Z") }),
      ]);
      expect(html).toContain("Posting history");
      expect(html).toContain("Still listed (seen 2026-10-19 09:00 UTC)");
      expect(html).toContain("Last observed 2026-10-10 09:00 UTC; current status unknown");
      expect(html).toContain("Not found in the latest complete check (since 2026-10-19 08:00 UTC)");
      expect(html).toContain("No longer tracked: the source&#x27;s settings changed");
      expect(html).toContain("This source shows a limited window, so it cannot confirm that a listing was removed.");
      expect(html).toContain("The source states it expires 2026-11-01");
      expect(html).toContain("Listed on the employer&#x27;s board");
      expect(html).not.toMatch(/Ghost|risk/i);
      expect(html).not.toContain("No longer listed</strong>");
    });

    it("shows No longer listed only when the badge rule holds, and nothing for a manual opportunity", () => {
      const removed = tracked({ state: "REMOVED", missingSince: at("2026-10-17T09:00:00Z"), removedAt: at("2026-10-18T10:00:00Z"), lastSeenAt: at("2026-10-17T08:00:00Z") });
      const html = render([removed]);
      expect(html).toContain("<strong>No longer listed</strong>");
      expect(html).toContain("No longer listed (not found since 2026-10-17 09:00 UTC; confirmed 2026-10-18 10:00 UTC)");
      expect(render([removed, tracked({ id: "l2", removalCapable: false, lastSeenAt: at("2026-10-19T09:00:00Z"), retrievalSource: { name: "Remote OK", adapterKey: "remote-ok", sourceCategory: "JOB_BOARD", scheduleMinutes: 720, enabled: true, archivedAt: null } })])).not.toContain("<strong>No longer listed</strong>");
      expect(render([])).toBe("");
    });
  });
});
