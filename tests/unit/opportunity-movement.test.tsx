// @vitest-environment jsdom
// Lifecycle movement (November 25, 2026): a move to where a job already is
// is a skip, never a failure; a mixed selection is processed one listing at
// a time; bulk results are keyed by opportunity ID, so two listings with the
// same title and message render without a duplicate-key warning.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveDestinationReached, opportunityMoveOptions, type OpportunityLifecycleState, type OpportunityMoveDestination, type OpportunityUserAction } from "@ai-career/core";
import type { GuardedUserActionResult } from "@ai-career/database";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { createOpportunityMoveHandlers, createOpportunityMoveService } = await import("../../apps/web/src/server/opportunity-move-service");
const { OpportunitySelectionProvider, SelectionToolbar, summarizeBulkResults } = await import("../../apps/web/src/components/dashboard/selection/opportunity-selection");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
const statuses: OpportunityLifecycleState[] = ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED", "APPLIED", "REJECTED_BY_USER", "ARCHIVED", "CLOSED"];
const destinations: OpportunityMoveDestination[] = ["ACTIVE", "SAVED", "DISMISSED", "ARCHIVED", "RESTORE"];

describe("where a job already is", () => {
  it("never offers a move to the state a job is already in", () => {
    for (const status of statuses) {
      for (const destination of opportunityMoveOptions({ status, application: null })) {
        expect(moveDestinationReached(status, destination), `${status} offers ${destination}`).toBe(false);
      }
    }
  });

  it("knows each destination's own states", () => {
    expect(destinations.filter((destination) => moveDestinationReached("REJECTED_BY_USER", destination))).toEqual(["DISMISSED"]);
    expect(destinations.filter((destination) => moveDestinationReached("SAVED", destination))).toEqual(["SAVED", "RESTORE"]);
    expect(destinations.filter((destination) => moveDestinationReached("NORMALIZED", destination))).toEqual(["ACTIVE", "RESTORE"]);
    expect(destinations.filter((destination) => moveDestinationReached("ARCHIVED", destination))).toEqual(["ARCHIVED"]);
    expect(destinations.filter((destination) => moveDestinationReached("APPLIED", destination))).toEqual([]);
  });
});

// A fake guarded writer over in-memory states and the real lifecycle rules'
// refusal for a move to the current state.
function store(initial: Record<string, OpportunityLifecycleState>, blocked: Set<string> = new Set()) {
  const state = { ...initial };
  const targets: Partial<Record<OpportunityUserAction, OpportunityLifecycleState>> = { DISMISS: "REJECTED_BY_USER", SAVE: "SAVED", ARCHIVE: "ARCHIVED", REACTIVATE: "NORMALIZED" };
  return {
    state,
    applyUserAction: vi.fn(async ({ opportunityId, action }: { opportunityId: string; action: OpportunityUserAction }): Promise<GuardedUserActionResult> => {
      const from = state[opportunityId];
      if (!from) return { status: "NOT_FOUND" };
      if (blocked.has(opportunityId)) return { status: "BLOCKED_BY_APPLICATION", reason: "Close the application first" };
      const to = targets[action];
      if (!to || to === from) return { status: "NOT_ALLOWED", reason: `${action} is not allowed from ${from}` };
      state[opportunityId] = to;
      return { status: "APPLIED", from, to };
    }),
    currentStatus: vi.fn(async (opportunityId: string) => state[opportunityId] ?? null),
  };
}

describe("moving a mixed selection", () => {
  it("skips listings already in Dismissed, moves the rest, and keeps application protections", async () => {
    const fake = store(
      { [ids[0]!]: "NORMALIZED", [ids[1]!]: "REJECTED_BY_USER", [ids[2]!]: "SAVED", [ids[3]!]: "SAVED" },
      new Set([ids[3]!]),
    );
    const handlers = createOpportunityMoveHandlers(createOpportunityMoveService(fake));
    const response = await handlers.moveMany(
      new Request("http://test/api/opportunities/bulk/move", { method: "POST", body: JSON.stringify({ destination: "DISMISSED", opportunityIds: ids }) }),
    );
    const body = (await response.json()) as { moved: number; skipped: number; failed: number; results: Array<{ opportunityId: string; result: string; reason?: string }> };
    expect(body).toMatchObject({ moved: 2, skipped: 1, failed: 1 });
    expect(body.results.map((item) => [item.opportunityId, item.result, item.reason ?? null])).toEqual([
      [ids[0], "MOVED", null],
      [ids[1], "ALREADY_THERE", "Already in Dismissed"],
      [ids[2], "MOVED", null],
      [ids[3], "BLOCKED_BY_APPLICATION", "Close the application first"],
    ]);
    expect(fake.state).toEqual({ [ids[0]!]: "REJECTED_BY_USER", [ids[1]!]: "REJECTED_BY_USER", [ids[2]!]: "REJECTED_BY_USER", [ids[3]!]: "SAVED" });
  });

  it("answers a stale single move with 200 and the skip, not a failure", async () => {
    const handlers = createOpportunityMoveHandlers(createOpportunityMoveService(store({ [ids[0]!]: "REJECTED_BY_USER" })));
    const response = await handlers.move(new Request("http://test", { method: "POST", body: JSON.stringify({ destination: "DISMISSED" }) }), ids[0]!);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: "ALREADY_THERE", status: "REJECTED_BY_USER", reason: "Already in Dismissed" });
  });

  it("still reports a genuine refusal as a failure", async () => {
    const fake = store({ [ids[0]!]: "CLOSED" });
    fake.applyUserAction.mockResolvedValueOnce({ status: "NOT_ALLOWED", reason: "SAVE is not allowed from CLOSED" });
    expect(await createOpportunityMoveService(fake).move(ids[0]!, "SAVED")).toMatchObject({ result: "NOT_ALLOWED" });
  });
});

describe("bulk results", () => {
  const rows = [
    { id: ids[0]!, title: "Customer Success Manager" },
    { id: ids[1]!, title: "Customer Success Manager" },
    { id: ids[2]!, title: "Onboarding Specialist" },
  ];

  it("summarizes moved, skipped and failed listings, each with its own ID", () => {
    const message = summarizeBulkResults(
      [
        { opportunityId: ids[0]!, result: "BLOCKED_BY_APPLICATION", reason: "Close the application first" },
        { opportunityId: ids[1]!, result: "BLOCKED_BY_APPLICATION", reason: "Close the application first" },
        { opportunityId: ids[2]!, result: "ALREADY_THERE", reason: "Already in Dismissed" },
      ],
      rows,
      "moved to Dismissed",
    );
    expect(message.text).toBe("0 moved to Dismissed; 1 skipped (already there); 2 could not be.");
    expect(message.items.map((item) => item.opportunityId)).toEqual(ids.slice(0, 3));
    expect(summarizeBulkResults([{ opportunityId: ids[2]!, result: "ALREADY_THERE", reason: "Already in Dismissed" }], rows, "moved").kind).toBe("success");
  });

  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders two listings with the same title and message without a duplicate-key warning", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [
        { opportunityId: ids[0], result: "BLOCKED_BY_APPLICATION", reason: "Close the application first" },
        { opportunityId: ids[1], result: "BLOCKED_BY_APPLICATION", reason: "Close the application first" },
      ],
    }), { status: 200 })));
    act(() => root.render(
      <OpportunitySelectionProvider rows={rows.slice(0, 2).map((row) => ({ ...row, destinations: ["DISMISSED", "ARCHIVED"] }))}>
        <SelectionToolbar dismissedView={false} dismissedTotal={0} />
      </OpportunitySelectionProvider>,
    ));
    const button = (name: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name)!;
    await act(async () => button("Select all on this page").click());
    // Only destinations valid for the selection are offered.
    expect([...container.querySelectorAll("#bulk-move-to option")].map((option) => option.getAttribute("value"))).toEqual(["DISMISSED", "ARCHIVED"]);
    await act(async () => button("Move 2 selected").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const items = [...container.querySelectorAll('[role="alert"] li')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Customer Success Manager: Close the application first",
      "Customer Success Manager: Close the application first",
    ]);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
  });
});
