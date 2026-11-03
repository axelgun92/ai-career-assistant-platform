// @vitest-environment jsdom
// Mode B progress page (/extension/jobs): each saved job's state as stored,
// the pre-evaluator triage outcome shown read-only with Codex's wording
// (decided on the opportunity page, never here), links to the added
// opportunity and the job's own page, and the per-job Retry, Dismiss and
// Restore actions.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageCaptureRowView } from "../../apps/web/src/components/extension/page-capture-list";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { PageCaptureActions, PageCaptureTable, addedStateText, statusText } = await import("../../apps/web/src/components/extension/page-capture-list");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (overrides: Partial<PageCaptureRowView> = {}): PageCaptureRowView => ({
  id: "00000000-0000-4000-8000-000000000001",
  site: "linkedin",
  siteName: "LinkedIn",
  title: "Customer Success Manager",
  company: "Northwind",
  location: "Remote",
  postedText: "3 days ago",
  sourceUrl: "https://www.linkedin.com/jobs/view/4100000001",
  firstSeenAt: "2026-11-03T09:00:00.000Z",
  status: "QUEUED",
  lastReason: null,
  resolvedOpportunityId: null,
  opportunityTitle: null,
  triageOutcome: null,
  triageManualDecision: null,
  evaluationStatus: null,
  recommendation: null,
  handoffOutcome: null,
  ...overrides,
});

describe("page-capture progress text", () => {
  it("names each stored state, never presenting a staged job as evaluable", () => {
    expect(statusText(row({ status: "QUEUED" }))).toBe("Getting details");
    expect(statusText(row({ status: "ACQUIRING" }))).toBe("Getting details");
    expect(statusText(row({ status: "ALREADY_SAVED" }))).toBe("Already in AI Job Assistant");
    expect(statusText(row({ status: "UNAVAILABLE" }))).toBe("No longer available");
    expect(statusText(row({ status: "DISMISSED" }))).toBe("Dismissed");
    expect(statusText(row({ status: "AWAITING_DETAILS", lastReason: "NOT_SUPPORTED" }))).toBe("Awaiting details: Automatic details are not available for this site yet");
    expect(statusText(row({ status: "AWAITING_DETAILS", lastReason: "RATE_LIMITED" }))).toContain("at least a day");
    expect(statusText(row({ status: "AWAITING_DETAILS", lastReason: null }))).toBe("Awaiting details: not read yet");
  });

  it("shows an added job's triage and evaluation state read-only, with the triage's own wording", () => {
    const added = { triageOutcome: null, triageManualDecision: null, evaluationStatus: null, recommendation: null, handoffOutcome: null };
    expect(addedStateText({ ...added, triageOutcome: "NEEDS_REVIEW", handoffOutcome: "NEEDS_REVIEW" })).toBe("Needs Review before evaluation");
    expect(addedStateText({ ...added, triageOutcome: "REJECT", handoffOutcome: "REJECT" })).toBe("Rejected before evaluation");
    // Alex's manual decision on a Needs Review job wins over the automatic outcome.
    expect(addedStateText({ ...added, triageOutcome: "NEEDS_REVIEW", triageManualDecision: "REJECT" })).toBe("Rejected before evaluation");
    expect(addedStateText({ ...added, triageOutcome: "EVALUATE", handoffOutcome: "QUEUED" })).toBe("Queued for evaluation");
    expect(addedStateText({ ...added, triageOutcome: "EVALUATE", handoffOutcome: "DEFERRED" })).toBe("Waiting: AI budget");
    expect(addedStateText({ ...added, triageOutcome: "EVALUATE", evaluationStatus: "PENDING" })).toBe("Queued for evaluation");
    expect(addedStateText({ ...added, evaluationStatus: "RUNNING" })).toBe("Evaluation in progress");
    expect(addedStateText({ ...added, evaluationStatus: "FAILED" })).toBe("Evaluation failed");
    expect(addedStateText({ ...added, evaluationStatus: "COMPLETED", recommendation: "APPLY" })).toBe("Evaluated: APPLY");
    expect(addedStateText({ ...added, handoffOutcome: "FAILED:PROFILE_NOT_READY" })).toBe("Added; the evaluation request was not accepted");
    expect(addedStateText(added)).toBe("Added");
  });
});

describe("page-capture progress table", () => {
  it("links an added job to its opportunity and every job to its own page, with no triage decision control", () => {
    const html = renderToStaticMarkup(
      <PageCaptureTable
        rows={[
          row({ status: "INGESTED", resolvedOpportunityId: "00000000-0000-4000-8000-0000000000aa", opportunityTitle: "CSM (Northwind)", triageOutcome: "NEEDS_REVIEW", handoffOutcome: "NEEDS_REVIEW" }),
          row({ id: "00000000-0000-4000-8000-000000000002", title: "<b>Hostile</b>", company: null, location: null, postedText: null }),
        ]}
      />,
    );
    expect(html).toContain('href="/opportunities/00000000-0000-4000-8000-0000000000aa"');
    expect(html).toContain("CSM (Northwind)");
    expect(html).toContain("Needs Review before evaluation");
    expect(html).toContain('href="https://www.linkedin.com/jobs/view/4100000001"');
    expect(html).toContain("&lt;b&gt;Hostile&lt;/b&gt;");
    expect(html).not.toContain(">Evaluate<");
    expect(html).not.toContain(">Reject<");
    expect(html).toContain('class="table-scroll"');
  });

  it("says when there are no jobs", () => {
    expect(renderToStaticMarkup(<PageCaptureTable rows={[]} />)).toContain("No jobs here yet.");
  });
});

describe("page-capture actions", () => {
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

  const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);
  const render = async (props: Parameters<typeof PageCaptureActions>[0]["row"]) => {
    await act(async () => root.render(<PageCaptureActions row={props} />));
  };

  it("offers only the actions each state allows", async () => {
    await render({ id: "a", status: "AWAITING_DETAILS", resolvedOpportunityId: null });
    expect(buttons()).toEqual(["Retry", "Dismiss"]);
    await render({ id: "a", status: "QUEUED", resolvedOpportunityId: null });
    expect(buttons()).toEqual(["Dismiss"]);
    await render({ id: "a", status: "DISMISSED", resolvedOpportunityId: null });
    expect(buttons()).toEqual(["Restore"]);
    await render({ id: "a", status: "INGESTED", resolvedOpportunityId: "x" });
    expect(buttons()).toEqual([]);
    await render({ id: "a", status: "ALREADY_SAVED", resolvedOpportunityId: "x" });
    expect(buttons()).toEqual([]);
  });

  it("posts the action for the job and refreshes, or shows the server's error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await render({ id: "00000000-0000-4000-8000-000000000001", status: "AWAITING_DETAILS", resolvedOpportunityId: null });
    await act(async () => container.querySelector("button")!.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/page-captures/00000000-0000-4000-8000-000000000001", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "retry" }) }));
    expect(router.refresh).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "This job cannot be retried." }), { status: 409 }));
    await act(async () => container.querySelector("button")!.click());
    for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[role=alert]")?.textContent).toBe("This job cannot be retried.");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
