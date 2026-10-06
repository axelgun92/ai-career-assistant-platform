import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationTask } from "@ai-career/evaluation";
import { withOpportunityLifecycleSync } from "../../apps/web/src/server/opportunity-lifecycle-sync";
import { createOpportunityActionHandler } from "../../apps/web/src/server/opportunity-action-service";
import {
  createOpportunityListHandler,
  opportunityListViews,
} from "../../apps/web/src/server/opportunity-list-service";
import { formatLifecycle } from "../../apps/web/src/components/dashboard/format";
import { OpportunityList } from "../../apps/web/src/components/dashboard/opportunity-list";

const task = { id: "task-1", evaluationId: "evaluation-1" } as EvaluationTask;
const opportunityId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";

describe("lifecycle sync wrapper", () => {
  it("syncs only after the wrapped processor succeeds", async () => {
    const order: string[] = [];
    const wrapped = withOpportunityLifecycleSync(
      { process: async () => { order.push("process"); } },
      { syncSystemLifecycleForEvaluation: async (id) => { order.push(`sync:${id}`); } },
    );
    await wrapped.process(task);
    expect(order).toEqual(["process", "sync:evaluation-1"]);
  });

  it("does not sync when processing fails and propagates the failure", async () => {
    const sync = vi.fn();
    const wrapped = withOpportunityLifecycleSync(
      { process: async () => { throw new Error("evaluation failed"); } },
      { syncSystemLifecycleForEvaluation: sync },
    );
    await expect(wrapped.process(task)).rejects.toThrow("evaluation failed");
    expect(sync).not.toHaveBeenCalled();
  });

  it("never fails a completed task when the sync itself fails", async () => {
    const log = vi.fn();
    const wrapped = withOpportunityLifecycleSync(
      { process: async () => undefined },
      { syncSystemLifecycleForEvaluation: async () => { throw new TypeError("db down: secret-host"); } },
      log,
    );
    await expect(wrapped.process(task)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("lifecycle sync failed"), {
      evaluationId: "evaluation-1",
      errorName: "TypeError",
    });
  });
});

describe("POST /api/opportunities/[id]/action handler", () => {
  const post = (body: string, writer: Parameters<typeof createOpportunityActionHandler>[0], id = opportunityId) =>
    createOpportunityActionHandler(writer)(
      new Request("http://localhost/action", { method: "POST", body }),
      id,
    );

  it("applies a valid action", async () => {
    const applyUserAction = vi.fn().mockResolvedValue({ status: "APPLIED", from: "RECOMMENDED", to: "SAVED" });
    const response = await post('{"action":"SAVE"}', { applyUserAction });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ opportunityId, action: "SAVE", from: "RECOMMENDED", status: "SAVED" });
    expect(applyUserAction).toHaveBeenCalledWith({ opportunityId, action: "SAVE" });
  });

  it.each([
    ["not json", 400],
    ['{"action":"DELETE"}', 400],
    ['{"action":"SAVE","extra":true}', 400],
    ["{}", 400],
  ])("rejects an invalid body %s", async (body, status) => {
    const applyUserAction = vi.fn();
    expect((await post(body, { applyUserAction })).status).toBe(status);
    expect(applyUserAction).not.toHaveBeenCalled();
  });

  it("maps repository outcomes to safe responses", async () => {
    const respond = async (result: unknown) =>
      post('{"action":"RESTORE"}', { applyUserAction: vi.fn().mockResolvedValue(result) });
    expect((await respond({ status: "NOT_FOUND" })).status).toBe(404);
    const notAllowed = await respond({ status: "NOT_ALLOWED", reason: "RESTORE is not allowed" });
    expect(notAllowed.status).toBe(409);
    expect(await notAllowed.json()).toMatchObject({ code: "OPPORTUNITY_ACTION_NOT_ALLOWED" });
    const conflict = await respond({ status: "CONFLICT" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "OPPORTUNITY_ACTION_CONFLICT" });
    expect((await post('{"action":"SAVE"}', { applyUserAction: vi.fn() }, "not-a-uuid")).status).toBe(404);
  });

  it("does not leak internal errors", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await post('{"action":"SAVE"}', {
      applyUserAction: vi.fn().mockRejectedValue(new Error("connection to secret-host refused")),
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-host");
    errorLog.mockRestore();
  });
});

describe("dashboard lifecycle presentation", () => {
  it("labels lifecycle states neutrally", () => {
    expect(formatLifecycle("RECOMMENDED")).toBe("Recommendation ready");
    expect(formatLifecycle("REJECTED_BY_USER")).toBe("Dismissed");
    expect(formatLifecycle("NORMALIZED")).toBe("New");
    expect(formatLifecycle("")).toBe("Unknown");
    expect(formatLifecycle(null)).toBe("Unknown");
  });

  it("shows the lifecycle label on each dashboard row", () => {
    const html = renderToStaticMarkup(
      <OpportunityList
        opportunities={[{
          id: opportunityId,
          domain: "customer-success",
          status: "SAVED",
          title: "Customer Success Manager",
          companyName: "Example",
          location: null,
          salaryText: null,
          postingDate: null,
          createdAt: new Date("2026-10-01T00:00:00.000Z"),
          latestEvaluation: null,
        }]}
      />,
    );
    expect(html).toContain("Saved");
  });

  it("maps list views to lifecycle statuses and passes them to the reader", async () => {
    expect(opportunityListViews.active.statuses).toEqual(["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"]);
    expect(opportunityListViews.archived.statuses).toEqual(["ARCHIVED", "CLOSED"]);
    expect(opportunityListViews.all.statuses).toBeUndefined();
    const listOpportunities = vi.fn().mockResolvedValue([]);
    const handler = createOpportunityListHandler({ listOpportunities });
    expect((await handler(new Request("http://localhost/api/opportunities?view=dismissed"))).status).toBe(200);
    expect(listOpportunities).toHaveBeenCalledWith({ limit: undefined, statuses: ["REJECTED_BY_USER"] });
    expect((await handler(new Request("http://localhost/api/opportunities?view=unknown"))).status).toBe(400);
  });
});
