// @vitest-environment jsdom
// Bulk evaluation in the Evaluate section (November 26, 2026): selection of
// single jobs and of the current page only, "Evaluate selected" unavailable
// with nothing selected, a preflight before any submit (opening the
// confirmation never submits), every limit reason with the Budget link,
// unavailable jobs listed and deselectable, the confirmed submit of exactly
// the checked jobs, and the API's validation and status codes.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { OpportunitySelectionProvider, RowSelect, SelectionToolbar } = await import("../../apps/web/src/components/dashboard/selection/opportunity-selection");
const { BulkEvaluation } = await import("../../apps/web/src/components/dashboard/selection/bulk-evaluation");
const { queuedText } = await import("../../apps/web/src/components/dashboard/selection/bulk-evaluation-text");
const { createBulkEvaluationHandlers } = await import("../../apps/web/src/server/bulk-evaluation-api");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
// The current page: two jobs. A third job exists on another page.
const rows = [
  { id: ids[0]!, title: "Customer Success Manager" },
  { id: ids[1]!, title: "Customer Success Manager" },
];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  consoleError = vi.spyOn(console, "error");
  router.refresh.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  // No React key, act or rendering warnings.
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const button = (text: string | RegExp) =>
  [...container.querySelectorAll("button")].find((item) => (typeof text === "string" ? item.textContent === text : text.test(item.textContent ?? "")))!;
const click = (element: Element) => act(async () => (element as HTMLElement).click());
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

async function render() {
  await act(async () =>
    root.render(
      <OpportunitySelectionProvider rows={rows}>
        <SelectionToolbar dismissedView={false} dismissedTotal={0} />
        <BulkEvaluation />
        {rows.map((row) => <RowSelect key={row.id} id={row.id} title={row.title} />)}
      </OpportunitySelectionProvider>,
    ),
  );
}

describe("selection in the Evaluate section", () => {
  it("selects and deselects single jobs; select all takes the current page only; evaluate is unavailable with nothing selected", async () => {
    await render();
    const evaluate = () => button(/^Evaluate \d+ selected…$/);
    expect(evaluate().disabled).toBe(true);
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    await click(boxes[0]!);
    expect(container.textContent).toContain("1 selected");
    expect(evaluate().textContent).toBe("Evaluate 1 selected…");
    expect(evaluate().disabled).toBe(false);
    await click(boxes[0]!);
    expect(container.textContent).toContain("0 selected");
    expect(evaluate().disabled).toBe(true);
    await click(button("Select all on this page"));
    // Both jobs on this page, never the job on another page.
    expect(evaluate().textContent).toBe("Evaluate 2 selected…");
    // Move stays separate from evaluation.
    expect(button("Move 2 selected")).toBeTruthy();
    expect(container.querySelector('[role="region"][aria-label="Paid evaluation"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("evaluate selected", () => {
  it("checks first, opens the confirmation without submitting, and on confirm submits exactly the checked jobs once", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/preflight")
        ? json(200, { status: "READY", count: 2, reservation: { perEvaluation: 0.5, total: 1, currency: "USD" } })
        : json(202, { status: "QUEUED", queued: rows.map((row, index) => ({ opportunityId: row.id, evaluationId: `e${index}` })) }),
    );
    await render();
    await click(button("Select all on this page"));
    await click(button("Evaluate 2 selected…"));
    await settle();
    const dialog = container.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Evaluate 2 selected jobs? They will be added to the evaluation queue and will use your configured AI budget.");
    expect(dialog.textContent).toContain("Up to $1.00 will be reserved ($0.50 per evaluation).");
    // Opening the confirmation never submits.
    expect(urls()).toEqual(["/api/opportunities/bulk/evaluate/preflight"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ opportunityIds: [ids[0], ids[1]] });
    await click(button("Evaluate 2 jobs"));
    await settle();
    expect(urls()).toEqual(["/api/opportunities/bulk/evaluate/preflight", "/api/opportunities/bulk/evaluate"]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({ opportunityIds: [ids[0], ids[1]] });
    expect(container.querySelector('[role="status"]')!.textContent).toBe("2 evaluations queued. They will run one at a time. Refresh the page to see their latest statuses.");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("0 selected");
  });

  it("the queued message never promises live updates: the dashboard does not poll", () => {
    expect(queuedText(1)).toBe("1 evaluation queued. Refresh the page to see its latest status.");
    expect(queuedText(3)).toBe("3 evaluations queued. They will run one at a time. Refresh the page to see their latest statuses.");
    expect(queuedText(3)).not.toMatch(/updates? as/);
  });

  it("cancel submits nothing, and a selection changed after the check must be checked again", async () => {
    fetchMock.mockResolvedValue(json(200, { status: "READY", count: 2, reservation: null }));
    await render();
    await click(button("Select all on this page"));
    await click(button("Evaluate 2 selected…"));
    await settle();
    await click(container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]!);
    expect(container.textContent).toContain("Your selection changed.");
    expect(button("Evaluate 2 jobs").disabled).toBe(true);
    await click(button("Cancel"));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(urls()).toEqual(["/api/opportunities/bulk/evaluate/preflight"]);
  });

  it("explains every limit the selection exceeds, links to Budget settings, and submits nothing", async () => {
    fetchMock.mockResolvedValue(json(200, {
      status: "LIMITS_EXCEEDED",
      selected: 12,
      shortfalls: [{ limit: "WEEKLY_EVALUATIONS", remaining: 7 }, { limit: "BUDGET", remaining: 5 }, { limit: "MONTHLY_OUTPUT_TOKENS", remaining: 3 }],
    }));
    await render();
    await click(button("Select all on this page"));
    await click(button("Evaluate 2 selected…"));
    await settle();
    const alert = container.querySelector('.bulk-evaluation [role="alert"]')!;
    expect([...alert.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "You selected 12 jobs, but your remaining weekly limit allows 7 evaluations.",
      "You selected 12 jobs, but your remaining AI budget can reserve 5 evaluations.",
      "You selected 12 jobs, but your remaining monthly output-token allowance can cover 3 evaluations.",
    ]);
    expect(alert.textContent).toContain("Nothing was submitted.");
    expect(alert.querySelector("a")!.getAttribute("href")).toBe("/budget#budget-settings-title");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(urls()).toEqual(["/api/opportunities/bulk/evaluate/preflight"]);
  });

  it("lists the jobs no longer available (keyed by opportunity, same titles allowed) and deselects them on request", async () => {
    fetchMock.mockResolvedValue(json(200, {
      status: "INELIGIBLE",
      items: [{ opportunityId: ids[0], title: "Customer Success Manager", reason: "ALREADY_EVALUATED" }, { opportunityId: ids[1], title: "Customer Success Manager", reason: "ALREADY_ACTIVE" }],
    }));
    await render();
    await click(button("Select all on this page"));
    await click(button("Evaluate 2 selected…"));
    await settle();
    const alert = container.querySelector('.bulk-evaluation [role="alert"]')!;
    expect(alert.textContent).toContain("nothing was submitted");
    expect([...alert.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Customer Success Manager: Already evaluated (re-evaluate it from its page)",
      "Customer Success Manager: Already queued or running",
    ]);
    await click(button("Deselect these jobs"));
    expect(container.textContent).toContain("0 selected");
  });

  it("a refusal at submit (capacity used meanwhile) is shown instead of a success", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/preflight")
        ? json(200, { status: "READY", count: 2, reservation: null })
        : json(200, { status: "LIMITS_EXCEEDED", selected: 2, shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 1 }] }),
    );
    await render();
    await click(button("Select all on this page"));
    await click(button("Evaluate 2 selected…"));
    await settle();
    await click(button("Evaluate 2 jobs"));
    await settle();
    expect(container.querySelector('.bulk-evaluation [role="alert"]')!.textContent).toContain("your remaining daily limit allows 1 evaluation.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("the bulk evaluation API", () => {
  const service = { requestEvaluationBatch: vi.fn() };
  const handlers = createBulkEvaluationHandlers({ service, titles: async (list) => new Map(list.map((id) => [id, `Job ${id.slice(0, 1)}`])) });
  const post = (body: unknown, raw?: string) => new Request("http://test", { method: "POST", body: raw ?? JSON.stringify(body) });

  it("refuses an invalid selection and duplicate IDs without calling the service", async () => {
    for (const body of [{ opportunityIds: [] }, { opportunityIds: Array.from({ length: 51 }, () => ids[0]) }, { opportunityIds: ["not-a-uuid"] }, { query: "triage=evaluate" }, { opportunityIds: ids, extra: 1 }]) {
      const response = await handlers.preflight(post(body));
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await handlers.submit(post(null, "{not json"))).status).toBe(400);
    const duplicate = await handlers.submit(post({ opportunityIds: [ids[0], ids[0]] }));
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ code: "DUPLICATE_OPPORTUNITY_ID" });
    expect(service.requestEvaluationBatch).not.toHaveBeenCalled();
  });

  it("maps each result to its status code, with titles for unavailable jobs", async () => {
    service.requestEvaluationBatch.mockResolvedValueOnce({ outcome: "READY", count: 2, reservation: null });
    expect((await handlers.preflight(post({ opportunityIds: ids.slice(0, 2) }))).status).toBe(200);
    expect(service.requestEvaluationBatch).toHaveBeenLastCalledWith(ids.slice(0, 2), { mode: "PREFLIGHT" });
    service.requestEvaluationBatch.mockResolvedValueOnce({ outcome: "QUEUED", queued: [{ opportunityId: ids[0], evaluationId: "e", taskId: "t" }] });
    const queued = await handlers.submit(post({ opportunityIds: [ids[0]] }));
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ status: "QUEUED", queued: [{ opportunityId: ids[0], evaluationId: "e" }] });
    expect(service.requestEvaluationBatch).toHaveBeenLastCalledWith([ids[0]], { mode: "SUBMIT" });
    service.requestEvaluationBatch.mockResolvedValueOnce({ outcome: "LIMITS_EXCEEDED", shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 1 }] });
    const limits = await handlers.submit(post({ opportunityIds: ids }));
    expect(limits.status).toBe(200);
    expect(await limits.json()).toEqual({ status: "LIMITS_EXCEEDED", selected: 3, shortfalls: [{ limit: "DAILY_EVALUATIONS", remaining: 1 }] });
    service.requestEvaluationBatch.mockResolvedValueOnce({ outcome: "INELIGIBLE", items: [{ opportunityId: ids[1], reason: "DEFERRED" }] });
    const ineligible = await handlers.preflight(post({ opportunityIds: ids }));
    expect(ineligible.status).toBe(200);
    expect(await ineligible.json()).toEqual({ status: "INELIGIBLE", items: [{ opportunityId: ids[1], title: "Job 2", reason: "DEFERRED" }] });
    // An unexpected failure is reported safely.
    consoleError.mockImplementationOnce(() => undefined);
    service.requestEvaluationBatch.mockRejectedValueOnce(new Error("connection details postgresql://user:secret@host/db"));
    const failed = await handlers.submit(post({ opportunityIds: ids }));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toMatch(/secret|postgresql/);
    // The log names the error only, never its message.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toMatch(/secret|postgresql/);
    consoleError.mockClear();
  });
});
