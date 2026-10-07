import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BudgetCard } from "../../apps/web/src/components/budget/budget-card";
import { DeferralReason } from "../../apps/web/src/components/budget/deferral-reason";
import { formatPeriodLabel, formatResetDate } from "../../apps/web/src/components/budget/budget-format";
import type { BudgetSnapshotView, BudgetStatusView, DeferralView } from "../../apps/web/src/components/budget/types";
import { BudgetServiceError, createBudgetApiHandlers, type BudgetService } from "../../apps/web/src/server/budget-service";
import { createEvaluationApiHandlers } from "../../apps/web/src/server/evaluation-api";
import type { EvaluationService } from "../../apps/web/src/server/evaluation-service";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { DeferredBacklog } = await import("../../apps/web/src/components/budget/deferred-backlog");
const { suggestedReserve } = await import("../../apps/web/src/components/budget/budget-settings-form");

const configured: Extract<BudgetStatusView, { configured: true }> = {
  configured: true,
  openDeferrals: 2,
  settings: { amount: 5, currency: "USD", timeZone: "America/New_York", enforced: true, reservePerEvaluation: 0.6, periodType: "CALENDAR_MONTH" },
  period: { label: "2026-10", start: "2026-10-01T04:00:00.000Z", end: "2026-11-01T04:00:00.000Z", timeZone: "America/New_York" },
  knownSpent: 0.42,
  held: 0.4,
  heldEvaluations: 1,
  remaining: 4.18,
  unknownAttempts: 0,
  otherCurrencyAttempts: 0,
  recentCosts: null,
};

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("budget display helpers", () => {
  it("formats the period and the local reset date", () => {
    expect(formatPeriodLabel("2026-10")).toBe("October 2026");
    expect(formatResetDate("2026-11-01T04:00:00.000Z", "America/New_York")).toBe("1 Nov 2026 (America/New_York)");
  });

  it("suggests a reserve rounded up to a cent", () => {
    expect(suggestedReserve(0.0412)).toBe(0.05);
    expect(suggestedReserve(0)).toBe(0.01);
  });
});

describe("dashboard budget card", () => {
  it("says evaluations are not limited when no budget is set", () => {
    const markup = text(renderToStaticMarkup(<BudgetCard status={{ configured: false, openDeferrals: 0 }} />));
    expect(markup).toContain("No budget set — evaluations are not limited.");
    expect(markup).toContain("Set a budget");
    expect(markup).not.toContain("deferred");
  });

  it("shows budget, known spend, reserved, remaining, enforcement, reset, and the deferred count", () => {
    const markup = text(renderToStaticMarkup(<BudgetCard status={configured} />));
    expect(markup).toContain("October 2026 AI budget");
    expect(markup).toContain("Enforced");
    expect(markup).toContain("Budget $5.00");
    expect(markup).toContain("Known spend $0.42");
    expect(markup).toContain("Reserved $0.40");
    expect(markup).toContain("Remaining (known) $4.18");
    expect(markup).toContain("Resets 1 Nov 2026 (America/New_York)");
    expect(markup).toContain("2 evaluations deferred");
    expect(markup).not.toContain("no recorded cost");
  });

  it("warns about unknown and other-currency cost and never shows them as $0 spend", () => {
    const markup = text(renderToStaticMarkup(
      <BudgetCard status={{ ...configured, unknownAttempts: 2, otherCurrencyAttempts: 1, settings: { ...configured.settings, enforced: false } }} />,
    ));
    expect(markup).toContain("Not enforced");
    expect(markup).toContain("2 AI attempts this period have no recorded cost. They are not counted as $0.00");
    expect(markup).toContain("1 AI attempt this period was priced in another currency");
  });
});

const snapshot: BudgetSnapshotView = {
  period: "2026-10",
  periodStart: "2026-10-01T00:00:00.000Z",
  periodEnd: "2026-11-01T00:00:00.000Z",
  timeZone: "UTC",
  amount: 1,
  currency: "USD",
  enforced: true,
  knownSpent: 0.1,
  held: 0.6,
  available: 0.3,
  reserve: 0.6,
  unknownAttempts: 1,
  otherCurrencyAttempts: 0,
  checkedAt: "2026-10-07T12:00:00.000Z",
};

describe("deferral explanation and backlog", () => {
  it("explains the reason from the recorded snapshot", () => {
    const markup = text(renderToStaticMarkup(<DeferralReason snapshot={snapshot} />));
    expect(markup).toContain("The October 2026 AI budget is $1.00");
    expect(markup).toContain("$0.10 had been spent and $0.60 was reserved");
    expect(markup).toContain("leaving $0.30");
    expect(markup).toContain("Each evaluation reserves $0.60");
    expect(markup).toContain("no AI cost was incurred");
    expect(markup).toContain("1 AI attempt this period had no recorded cost");
  });

  it("lists deferred requests with reason, reserve, pinned profile, and actions", () => {
    const deferral: DeferralView = {
      id: "def-1",
      opportunityId: "opp-1",
      opportunityTitle: "Customer Success Manager",
      companyName: "Acme",
      opportunityStatus: "SAVED",
      status: "DEFERRED",
      reasonCode: "BUDGET_UNAVAILABLE",
      snapshot,
      userProfileId: "profile-3",
      userProfileVersion: 3,
      createdAt: "2026-10-07T12:00:00.000Z",
      lastCheckedAt: "2026-10-07T13:00:00.000Z",
      resumedAt: null,
      cancelledAt: null,
      resumedEvaluationId: null,
    };
    const markup = renderToStaticMarkup(
      <DeferredBacklog deferrals={[deferral]} activeProfile={{ id: "profile-4", version: 4 }} />,
    );
    const visible = text(markup);
    expect(visible).toContain("Customer Success Manager");
    expect(visible).toContain("Acme · Saved");
    expect(visible).toContain("Budget unavailable");
    expect(visible).toContain("$0.60");
    expect(visible).toContain("v3 (active profile is v4)");
    expect(visible).toContain("Resume");
    expect(visible).toContain("Cancel…");
    expect(markup).toContain('href="/opportunities/opp-1"');
  });

  it("shows an empty state when nothing is deferred", () => {
    expect(text(renderToStaticMarkup(<DeferredBacklog deferrals={[]} activeProfile={null} />))).toContain(
      "No evaluations are waiting for budget.",
    );
  });
});

describe("budget API handlers", () => {
  const request = (body: string) => new Request("http://localhost/api/budget", { method: "PUT", body });

  it("returns 400 for invalid JSON and field issues for invalid settings", async () => {
    const service = {
      updateSettings: vi.fn().mockRejectedValue(
        new BudgetServiceError("BUDGET_INVALID", "The budget settings are invalid", 400, [{ path: "amount", message: "The amount cannot be negative" }]),
      ),
    } as unknown as BudgetService;
    const handlers = createBudgetApiHandlers(service);
    expect((await handlers.put(request("{bad"))).status).toBe(400);
    const response = await handlers.put(request(JSON.stringify({ amount: -1 })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BUDGET_INVALID", issues: [{ path: "amount" }] });
  });

  it("never leaks internal errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handlers = createBudgetApiHandlers({ status: vi.fn().mockRejectedValue(new Error("db secret-host")) } as unknown as BudgetService);
    const response = await handlers.get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
    error.mockRestore();
  });

  it("rejects an unknown deferred status filter", async () => {
    const handlers = createBudgetApiHandlers({ listDeferred: vi.fn() } as unknown as BudgetService);
    expect((await handlers.listDeferred(new Request("http://localhost/api/evaluations/deferred?status=LOST"))).status).toBe(400);
  });
});

describe("evaluation API outcomes", () => {
  const opportunityId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
  const post = () => new Request("http://localhost/evaluate", { method: "POST", body: "{}" });

  it("returns 202 for a queued evaluation and 200 for a deferred one", async () => {
    const queued = createEvaluationApiHandlers({
      requestEvaluation: vi.fn().mockResolvedValue({ outcome: "QUEUED", evaluationId: "e", taskId: "t" }),
    } as unknown as EvaluationService);
    expect((await queued.post(post(), opportunityId)).status).toBe(202);

    const deferred = createEvaluationApiHandlers({
      requestEvaluation: vi.fn().mockResolvedValue({ outcome: "DEFERRED", deferredEvaluationId: "d", reason: "BUDGET_UNAVAILABLE" }),
    } as unknown as EvaluationService);
    const response = await deferred.post(post(), opportunityId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "DEFERRED", reason: "BUDGET_UNAVAILABLE" });
  });

  it("resume returns 202 when queued and 200 when still deferred; cancel returns the new status", async () => {
    const handlers = createEvaluationApiHandlers({
      resumeDeferred: vi.fn()
        .mockResolvedValueOnce({ outcome: "QUEUED" })
        .mockResolvedValueOnce({ outcome: "DEFERRED" }),
      cancelDeferred: vi.fn().mockResolvedValue({ deferredEvaluationId: "d", status: "CANCELLED" }),
    } as unknown as EvaluationService);
    expect((await handlers.resume("d")).status).toBe(202);
    expect((await handlers.resume("d")).status).toBe(200);
    expect(await (await handlers.cancel("d")).json()).toEqual({ deferredEvaluationId: "d", status: "CANCELLED" });
  });
});
