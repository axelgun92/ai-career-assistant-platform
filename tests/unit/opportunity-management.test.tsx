// Opportunity management (November 22, 2026), with fakes: the Move to
// destinations each state offers, the shared move service (Restore, bulk
// moves reported one by one), the Dismissed deletion handlers (explicit IDs,
// a confirmed count for Empty Dismissed), and the dashboard's controls.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { opportunityMoveOptions, type OpportunityLifecycleState, type OpportunityUserAction } from "@ai-career/core";
import type { GuardedUserActionResult } from "@ai-career/database";

vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { createOpportunityMoveHandlers, createOpportunityMoveService, moveChoices } = await import("../../apps/web/src/server/opportunity-move-service");
const { createOpportunityDeletionHandlers } = await import("../../apps/web/src/server/opportunity-deletion-service");
const { OpportunityList } = await import("../../apps/web/src/components/dashboard/opportunity-list");
const { OpportunitySelectionProvider, SelectionToolbar } = await import("../../apps/web/src/components/dashboard/selection/opportunity-selection");

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

describe("Move to destinations", () => {
  it.each<[OpportunityLifecycleState, { submitted: boolean; active: boolean } | null, string[]]>([
    ["NORMALIZED", null, ["SAVED", "DISMISSED", "ARCHIVED"]],
    ["RECOMMENDED", { submitted: false, active: true }, ["SAVED", "ARCHIVED"]],
    ["SAVED", null, ["ACTIVE", "DISMISSED", "ARCHIVED"]],
    ["APPLIED", { submitted: true, active: true }, ["ARCHIVED"]],
    ["APPLIED", null, ["ACTIVE", "ARCHIVED"]],
    ["REJECTED_BY_USER", null, ["RESTORE", "ACTIVE", "SAVED", "ARCHIVED"]],
    ["ARCHIVED", null, ["RESTORE", "ACTIVE", "SAVED", "DISMISSED"]],
    ["ARCHIVED", { submitted: true, active: false }, ["RESTORE", "DISMISSED"]],
    ["CLOSED", null, ["ARCHIVED"]],
    ["DISCOVERED", null, []],
  ])("%s (application %j) offers %j; Applied, Pre-Evaluation Review and All never", (status, application, expected) => {
    expect(opportunityMoveOptions({ status, application })).toEqual(expected);
  });

  it("the opportunity page shows blocked moves with the application's reason", () => {
    const choices = moveChoices({
      status: "SAVED",
      history: [{ action: "SAVE", fromStatus: "RECOMMENDED", toStatus: "SAVED" }],
      systemState: "RECOMMENDED",
      application: { stage: "PLANNED", outcome: null },
    });
    expect(choices.available).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(choices.blocked).toEqual([{ destination: "DISMISSED", reason: expect.stringContaining("Close the application first") }]);
  });
});

function writer(results: Record<string, GuardedUserActionResult | ((action: OpportunityUserAction) => GuardedUserActionResult)>) {
  const calls: Array<{ opportunityId: string; action: OpportunityUserAction }> = [];
  return {
    calls,
    applyUserAction: vi.fn(async (input: { opportunityId: string; action: OpportunityUserAction }) => {
      calls.push(input);
      const result = results[input.opportunityId] ?? { status: "NOT_FOUND" as const };
      return typeof result === "function" ? result(input.action) : result;
    }),
  };
}

describe("the shared move service", () => {
  it("Restore undoes the dismissal when the history says how, otherwise moves to Active", async () => {
    const fake = writer({
      [ids[0]!]: (action) => (action === "RESTORE" ? { status: "APPLIED", from: "REJECTED_BY_USER", to: "SAVED" } : { status: "NOT_FOUND" }),
      [ids[1]!]: (action) =>
        action === "RESTORE" ? { status: "NOT_ALLOWED", reason: "The action history does not identify a state to restore" } : { status: "APPLIED", from: "REJECTED_BY_USER", to: "EVALUATED" },
    });
    const service = createOpportunityMoveService(fake);
    expect(await service.move(ids[0]!, "RESTORE")).toMatchObject({ result: "MOVED", action: "RESTORE", status: "SAVED" });
    expect(await service.move(ids[1]!, "RESTORE")).toMatchObject({ result: "MOVED", action: "REACTIVATE", status: "EVALUATED" });
  });

  it("a bulk move acts on the stated IDs only, one by one, and reports every partial failure with its reason", async () => {
    const fake = writer({
      [ids[0]!]: { status: "APPLIED", from: "SAVED", to: "REJECTED_BY_USER" },
      [ids[1]!]: { status: "BLOCKED_BY_APPLICATION", reason: "Close the application first" },
      [ids[2]!]: { status: "CONFLICT" },
    });
    const handlers = createOpportunityMoveHandlers(createOpportunityMoveService(fake));
    const response = await handlers.moveMany(
      new Request("http://test/api/opportunities/bulk/move", { method: "POST", body: JSON.stringify({ destination: "DISMISSED", opportunityIds: ids }) }),
    );
    const body = (await response.json()) as { requested: number; moved: number; failed: number; results: Array<{ result: string; reason?: string }> };
    expect(body).toMatchObject({ requested: 3, moved: 1, failed: 2 });
    expect(body.results.map((item) => item.result)).toEqual(["MOVED", "BLOCKED_BY_APPLICATION", "CONFLICT"]);
    expect(body.results[1]!.reason).toBe("Close the application first");
    expect(fake.calls.map((call) => [call.opportunityId, call.action])).toEqual(ids.map((id) => [id, "DISMISS"]));
  });

  it("refuses a bulk request without explicit IDs, with too many, or with an invalid destination", async () => {
    const handlers = createOpportunityMoveHandlers(createOpportunityMoveService(writer({})));
    const post = (body: unknown) => handlers.moveMany(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));
    expect((await post({ destination: "SAVED", opportunityIds: [] })).status).toBe(400);
    expect((await post({ destination: "SAVED", opportunityIds: Array.from({ length: 51 }, () => ids[0]) })).status).toBe(400);
    expect((await post({ destination: "APPLIED", opportunityIds: [ids[0]] })).status).toBe(400);
    expect((await post({ destination: "ALL", opportunityIds: [ids[0]] })).status).toBe(400);
    expect((await post({ destination: "SAVED", query: { view: "active" } })).status).toBe(400);
  });

  it("a single move answers 409 with the reason when the lifecycle refuses it", async () => {
    const handlers = createOpportunityMoveHandlers(
      createOpportunityMoveService(writer({ [ids[0]!]: { status: "NOT_ALLOWED", reason: "SAVE is not allowed from APPLIED" } })),
    );
    const response = await handlers.move(new Request("http://test", { method: "POST", body: JSON.stringify({ destination: "SAVED" }) }), ids[0]!);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ result: "NOT_ALLOWED", error: "SAVE is not allowed from APPLIED" });
  });
});

describe("permanent deletion from Dismissed", () => {
  function store(outcomes: Record<string, "DELETED" | "NOT_DISMISSED" | "HAS_APPLICATION" | "EVALUATION_IN_PROGRESS">, dismissed = Object.keys(outcomes)) {
    return {
      dismissedCount: vi.fn(async () => dismissed.length),
      dismissedIds: vi.fn(async () => dismissed),
      deleteDismissed: vi.fn(async (id: string) => ({ opportunityId: id, outcome: outcomes[id] ?? ("NOT_FOUND" as const) })),
    };
  }

  it("deletes the selected IDs only and reports each opportunity kept, with its reason", async () => {
    const fake = store({ [ids[0]!]: "DELETED", [ids[1]!]: "HAS_APPLICATION", [ids[2]!]: "NOT_DISMISSED" });
    const response = await createOpportunityDeletionHandlers(fake).deleteSelected(
      new Request("http://test", { method: "POST", body: JSON.stringify({ opportunityIds: [ids[0], ids[1], ids[2]] }) }),
    );
    const body = (await response.json()) as { deleted: number; kept: number; results: Array<{ result: string; reason?: string }> };
    expect(body).toMatchObject({ deleted: 1, kept: 2 });
    expect(body.results[1]!.reason).toMatch(/application history/);
    expect(body.results[2]!.reason).toMatch(/Not in Dismissed/);
    expect(fake.dismissedIds).not.toHaveBeenCalled();
  });

  it("Empty Dismissed deletes everything in Dismissed only when the confirmed count is still current", async () => {
    const fake = store({ [ids[0]!]: "DELETED", [ids[1]!]: "DELETED" });
    const handlers = createOpportunityDeletionHandlers(fake);
    const stale = await handlers.empty(new Request("http://test", { method: "POST", body: JSON.stringify({ expectedCount: 3 }) }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "DISMISSED_COUNT_CHANGED", current: 2 });
    expect(fake.deleteDismissed).not.toHaveBeenCalled();
    const confirmed = await handlers.empty(new Request("http://test", { method: "POST", body: JSON.stringify({ expectedCount: 2 }) }));
    expect(await confirmed.json()).toMatchObject({ requested: 2, deleted: 2, kept: 0 });
  });
});

describe("dashboard controls", () => {
  const row = {
    id: ids[0]!,
    title: "Customer Success Manager",
    companyName: "Acme",
    location: null,
    status: "SAVED",
    domain: "customer-success",
    sourceType: "MANUAL",
    createdAt: new Date("2026-11-20T10:00:00Z"),
    latestEvaluation: null,
    deferred: false,
  };

  it("rows show a checkbox and a Move to menu with only their valid destinations; without selection they show neither", () => {
    const markup = renderToStaticMarkup(
      <OpportunitySelectionProvider rows={[{ id: row.id, title: row.title }]}>
        <SelectionToolbar dismissedView={false} dismissedTotal={0} />
        <OpportunityList opportunities={[row as never]} moveOptions={{ [row.id]: ["ACTIVE", "DISMISSED", "ARCHIVED"] }} />
      </OpportunitySelectionProvider>,
    );
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("Select Customer Success Manager");
    expect(markup).toContain("Actions for Customer Success Manager");
    expect(markup).toContain(">Dismissed<");
    expect(markup).not.toContain(">Saved</button>");
    expect(markup).toContain("Select all on this page");
    expect(markup).toContain("0 selected");
    expect(markup).not.toContain("Empty Dismissed");
    const plain = renderToStaticMarkup(<OpportunityList opportunities={[row as never]} />);
    expect(plain).not.toContain('type="checkbox"');
    expect(plain).not.toContain("Actions for");
  });

  it("in Dismissed the toolbar offers Empty Dismissed with the exact count", () => {
    const markup = renderToStaticMarkup(
      <OpportunitySelectionProvider rows={[]}>
        <SelectionToolbar dismissedView dismissedTotal={7} />
      </OpportunitySelectionProvider>,
    );
    expect(markup).toContain("Empty Dismissed (7)…");
  });
});
