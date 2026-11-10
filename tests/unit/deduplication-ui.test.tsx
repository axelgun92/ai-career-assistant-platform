// @vitest-environment jsdom
// Features 1–10 Gap Closure: capture-time duplicate confirmation, duplicate
// notices with the reversible "not the same job" decision, attached-source
// provenance and the dashboard badge.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { DuplicateNotices, duplicateSentence } = await import("../../apps/web/src/components/duplicate-notices");
const { ManualOpportunityForm, capturedDestination, matchLabel } = await import("../../apps/web/src/components/manual-opportunity-form");
const { OpportunityProvenance } = await import("../../apps/web/src/components/opportunity-provenance");
const { OpportunityList } = await import("../../apps/web/src/components/dashboard/opportunity-list");
const { describeMatchedOn, describeConflicts } = await import("../../apps/web/src/components/duplicate-labels");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const opportunityId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const otherId = "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  router.refresh.mockReset();
  router.push.mockReset();
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

function relationship(overrides: Record<string, unknown> = {}) {
  return {
    otherOpportunityId: otherId,
    otherTitle: "Customer Success Manager",
    otherCompanyName: "Acme Analytics",
    decision: "MATCH" as const,
    confidence: 1,
    matchedOn: ["url"],
    conflicts: [],
    resolution: null,
    ...overrides,
  };
}

describe("duplicate labels", () => {
  it("describes the engine evidence in plain words", () => {
    expect(describeMatchedOn(["listingId", "company"])).toBe("same source job ID and same company");
    expect(describeMatchedOn(["company", "title", "location", "description"])).toBe(
      "same company, similar title, similar location and similar description",
    );
    expect(describeConflicts(["title"])).toBe("the titles differ");
    expect(describeConflicts([])).toBeNull();
    expect(duplicateSentence(relationship({ decision: "PROBABLE_MATCH", confidence: 0.8234, matchedOn: ["url"], conflicts: ["title"] }))).toBe(
      "a possible duplicate (same listing URL, 82% similar; the titles differ).",
    );
  });

  it("opens the saved opportunity after an exact duplicate was attached", () => {
    expect(capturedDestination({ opportunity: { id: opportunityId }, deduplication: { outcome: "ATTACHED", decision: "MATCH" } })).toBe(
      `/opportunities/${opportunityId}?capture=attached`,
    );
    expect(capturedDestination({ opportunity: { id: opportunityId }, deduplication: { outcome: "CREATED", decision: "PROBABLE_MATCH" } })).toBe(
      `/opportunities/${opportunityId}?capture=probable`,
    );
    expect(capturedDestination({ opportunity: { id: opportunityId }, deduplication: { outcome: "CREATED", decision: "MATCH" } })).toBe(
      `/opportunities/${opportunityId}`,
    );
    expect(matchLabel({ title: null, companyName: "Acme" })).toBe("Untitled opportunity · Acme");
  });
});

describe("DuplicateNotices", () => {
  it("renders nothing without relationships or a capture notice", () => {
    render(<DuplicateNotices opportunityId={opportunityId} relationships={[]} capture={null} />);
    expect(container.textContent).toBe("");
  });

  it("explains an attached capture, exact and probable duplicates", () => {
    render(
      <DuplicateNotices
        opportunityId={opportunityId}
        capture="attached"
        relationships={[relationship(), relationship({ otherOpportunityId: "p", decision: "PROBABLE_MATCH", confidence: 0.7, matchedOn: ["company", "title", "location", "description"] })]}
      />,
    );
    expect(container.textContent).toContain("This listing was already saved. Your capture was added to it as another source.");
    expect(container.textContent).toContain("Customer Success Manager · Acme Analytics is the same listing (same listing URL). A paid evaluation is not repeated for a duplicate listing.");
    expect(container.textContent).toContain("a possible duplicate (same company, similar title, similar location and similar description, 70% similar)");
    expect(container.querySelector(`a[href="/opportunities/${otherId}"]`)).not.toBeNull();
  });

  it("marks a pair as different jobs and can undo it", async () => {
    fetchMock.mockReturnValue(json({ relationship: {} }));
    render(<DuplicateNotices opportunityId={opportunityId} relationships={[relationship()]} capture={null} />);
    await act(async () => button("Not the same job").click());
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`/api/opportunities/${opportunityId}/duplicates`, expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ otherOpportunityId: otherId, resolution: "DISTINCT" });
    expect(router.refresh).toHaveBeenCalled();

    render(<DuplicateNotices opportunityId={opportunityId} relationships={[relationship({ resolution: "DISTINCT" })]} capture={null} />);
    expect(container.textContent).toContain("Marked as a different job from Customer Success Manager · Acme Analytics.");
    await act(async () => button("Undo").click());
    await flush();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ otherOpportunityId: otherId, resolution: null });
  });

  it("shows a refusal without refreshing", async () => {
    fetchMock.mockReturnValue(json({ error: "These opportunities are not detected as duplicates" }, 409));
    render(<DuplicateNotices opportunityId={opportunityId} relationships={[relationship()]} capture={null} />);
    await act(async () => button("Not the same job").click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("These opportunities are not detected as duplicates");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("capture form", () => {
  function fill(name: string, value: string) {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
  }
  const calls = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url);
  const match = { opportunityId: otherId, decision: "MATCH", confidence: 1, matchedOn: ["url"], conflicts: [], title: "Customer Success Manager", companyName: "Acme" };

  it("asks before saving an exact duplicate and attaches it by choice", async () => {
    fetchMock.mockImplementation((url: string) =>
      url === "/api/opportunities/duplicate-check"
        ? json({ decision: "MATCH", canonicalOpportunityId: otherId, matches: [match] })
        : json({ opportunity: { id: otherId }, deduplication: { outcome: "ATTACHED", decision: "MATCH" } }),
    );
    render(<ManualOpportunityForm />);
    fill("rawText", "Customer Success Manager");
    fill("sourceUrl", "https://jobs.example.com/1");
    fill("timeZoneRequirements", "US Eastern hours");
    await submit();

    expect(calls("/api/opportunities")).toHaveLength(0);
    expect(container.textContent).toContain("This listing is already saved");
    expect(container.textContent).toContain("It matches Customer Success Manager · Acme (same listing URL)");

    await act(async () => button("Add as another source").click());
    await flush();
    const body = JSON.parse(calls("/api/opportunities")[0]![1].body);
    expect(body).toMatchObject({ rawText: "Customer Success Manager", duplicateResolution: "ATTACH", timeZoneRequirements: "US Eastern hours" });
    expect(router.push).toHaveBeenCalledWith(`/opportunities/${otherId}?capture=attached`);
  });

  it("saves a separate opportunity when the user says it is a different job", async () => {
    fetchMock.mockImplementation((url: string) =>
      url === "/api/opportunities/duplicate-check"
        ? json({ decision: "MATCH", canonicalOpportunityId: otherId, matches: [match] })
        : json({ opportunity: { id: opportunityId }, deduplication: { outcome: "CREATED", decision: "MATCH" } }, 201),
    );
    render(<ManualOpportunityForm />);
    fill("rawText", "Customer Success Manager");
    await submit();
    await act(async () => button("Save as a separate opportunity").click());
    await flush();
    expect(JSON.parse(calls("/api/opportunities")[0]![1].body)).toMatchObject({ duplicateResolution: "SEPARATE" });
    expect(router.push).toHaveBeenCalledWith(`/opportunities/${opportunityId}`);
  });

  it("saves directly when there is no exact duplicate or the check cannot run", async () => {
    for (const check of [json({ decision: "PROBABLE_MATCH", canonicalOpportunityId: null, matches: [] }), json({ error: "x" }, 500)]) {
      fetchMock.mockReset();
      router.push.mockReset();
      fetchMock.mockImplementation((url: string) =>
        url === "/api/opportunities/duplicate-check"
          ? check
          : json({ opportunity: { id: opportunityId }, deduplication: { outcome: "CREATED", decision: "PROBABLE_MATCH" } }, 201),
      );
      render(<ManualOpportunityForm />);
      fill("rawText", "Customer Success Manager");
      await submit();
      expect(calls("/api/opportunities")).toHaveLength(1);
      expect(JSON.parse(calls("/api/opportunities")[0]![1].body).duplicateResolution).toBeUndefined();
      expect(router.push).toHaveBeenCalledWith(`/opportunities/${opportunityId}?capture=probable`);
    }
  });
});

describe("provenance and dashboard", () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: "s1", source: "manual-input", sourceType: "MANUAL", sourceUrl: null, applicationUrl: null, externalId: null,
    requisitionId: null, rawTitle: null, rawCompany: null, rawLocation: null, rawDescription: "x", rawSalaryText: null,
    rawEmploymentType: null, rawPostingDate: null, sourceMetadata: null, rawPayload: null,
    discoveredAt: new Date("2026-10-17T10:00:00Z"), lastObservedAt: new Date("2026-10-17T10:00:00Z"), normalizedAt: null,
    createdAt: new Date("2026-10-17T10:00:00Z"), updatedAt: new Date("2026-10-17T10:00:00Z"),
    ...overrides,
  });

  it("labels a source record attached as an exact duplicate", () => {
    const html = renderToStaticMarkup(
      <OpportunityProvenance
        opportunity={{ source: "manual-input", sourceType: "MANUAL", firstSeenAt: new Date(), lastSeenAt: new Date(), sourceUpdatedAt: null }}
        sourceRecords={[record(), record({ id: "s2", duplicateDecision: "MATCH", duplicateEvidence: { matchedOn: ["listingId", "company"] } })]}
      />,
    );
    expect(html).toContain("Source records (2)");
    expect(html).toContain("Added as another source on 2026-10-17 10:00 UTC: an exact duplicate of this opportunity (same source job ID and same company).");
    expect(html.match(/Added as another source/g)).toHaveLength(1);
  });

  it("badges duplicate rows on the dashboard", () => {
    const row = (id: string, duplicate: "MATCH" | "PROBABLE_MATCH" | null) => ({
      id, domain: "customer-success", status: "NORMALIZED", source: "manual-input", sourceType: "MANUAL", title: id, companyName: "Acme",
      location: null, salaryText: null, postingDate: null, createdAt: new Date("2026-10-17T00:00:00Z"), deferred: false,
      latestEvaluation: null, duplicate,
    });
    const html = renderToStaticMarkup(<OpportunityList opportunities={[row("one", "MATCH"), row("two", "PROBABLE_MATCH"), row("three", null)]} />);
    expect(html).toContain("Duplicate listing");
    expect(html).toContain("Possible duplicate");
    expect(html.match(/status-label-duplicate/g)).toHaveLength(2);
  });
});
