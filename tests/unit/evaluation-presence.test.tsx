// @vitest-environment jsdom
// An opportunity with no evaluation (November 25, 2026): the page renders its
// normal unevaluated state without asking the API for an evaluation that does
// not exist (a 404 the browser logs as a console error); nothing is requested
// or created automatically; a request the user makes starts status polling;
// and when presence is unknown, a genuine loading failure is still shown.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationQueryRepository } from "@ai-career/core";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { EvaluationExperience } = await import("../../apps/web/src/components/evaluation/evaluation-experience");
const { createEvaluationService } = await import("../../apps/web/src/server/evaluation-service");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const opportunity = {
  id: "11111111-1111-4111-8111-111111111111", title: "Customer Success Manager", company: "Acme", salary: "Unknown",
  location: "Remote", workArrangement: "Remote", timeZoneRequirements: "Unknown",
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const evaluationCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/evaluation") || String(url).includes("/evaluation?"));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("an opportunity with no evaluation", () => {
  it("renders the unevaluated state and requests nothing", async () => {
    await act(async () => root.render(<EvaluationExperience opportunity={opportunity} evaluationExists={false} />));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Not evaluated");
    expect(container.textContent).not.toContain("Checking evaluation");
    expect(container.textContent).toContain("Evaluate Customer Success fit");
  });

  it("starts checking the status once a requested evaluation is accepted", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/evaluate")) return new Response(JSON.stringify({ outcome: "QUEUED" }), { status: 202 });
      return new Response(JSON.stringify({ error: "down" }), { status: 503 });
    });
    await act(async () => root.render(<EvaluationExperience opportunity={opportunity} evaluationExists={false} />));
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Evaluate Customer Success fit")!;
    await act(async () => button.click());
    await settle();
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/evaluate$/);
    expect(evaluationCalls().length).toBeGreaterThanOrEqual(1);
  });

  it("still fetches, and reports a genuine loading failure, when presence is unknown", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Evaluation status is unavailable" }), { status: 500 }));
    await act(async () => root.render(<EvaluationExperience opportunity={opportunity} evaluationExists={null} />));
    await settle();
    expect(evaluationCalls()).toHaveLength(1);
    expect(container.textContent).toContain("Evaluation status could not be refreshed");
  });
});

describe("the evaluation service's presence check", () => {
  it("is true only when an evaluation exists, and never creates one", async () => {
    const queries = {
      findOpportunityForEvaluation: vi.fn(async (id: string) => (id === opportunity.id ? { id, domain: "customer-success" } : null)),
      listEvaluationHistory: vi.fn(async () => [] as unknown[]),
    };
    const service = createEvaluationService({ queries: queries as unknown as EvaluationQueryRepository } as Parameters<typeof createEvaluationService>[0]);
    expect(await service.hasEvaluation(opportunity.id)).toBe(false);
    queries.listEvaluationHistory.mockResolvedValueOnce([{ id: "e" }]);
    expect(await service.hasEvaluation(opportunity.id)).toBe(true);
    expect(await service.hasEvaluation("22222222-2222-4222-8222-222222222222")).toBe(false);
  });
});
