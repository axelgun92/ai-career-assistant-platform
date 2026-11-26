// Mode A's "Request evaluation" after the pre-evaluator triage (the extension
// contract in Codex's triage handoff): the popup words all four outcomes of
// the existing evaluation request as the server decided them, follows only a
// queued evaluation, and the extension's request route stays a thin wrapper
// that passes the production gate's answer through unchanged.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { ExtensionPairingRecord } from "@ai-career/database";
import { evaluationRequestMessage } from "../../apps/extension/src/popup-view";
import { createExtensionApiHandlers, type ExtensionPairingManager } from "../../apps/web/src/server/extension-api";
import { generatePairingCredential } from "../../apps/web/src/server/extension-auth";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";

describe("the popup's evaluation request outcomes", () => {
  it("words QUEUED, DEFERRED, NEEDS_REVIEW and REJECT, saying nothing was spent unless queued", () => {
    expect(evaluationRequestMessage({ ok: true, status: 202, body: { outcome: "QUEUED" } })).toBe("Evaluation requested and queued.");
    expect(evaluationRequestMessage({ ok: true, status: 200, body: { outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED" } })).toMatch(/Nothing was spent/);
    const review = evaluationRequestMessage({ ok: true, status: 200, body: { outcome: "NEEDS_REVIEW" } });
    expect(review).toMatch(/^Held for review before evaluation/);
    expect(review).toMatch(/Nothing was spent/);
    expect(review).toMatch(/choose Evaluate or Reject/);
    const rejected = evaluationRequestMessage({ ok: true, status: 200, body: { outcome: "REJECT" } });
    expect(rejected).toMatch(/^Rejected before evaluation/);
    expect(rejected).toMatch(/Nothing was spent/);
  });

  it("starts following the evaluation only when it was queued, and offers no triage decision in the extension", () => {
    const source = readFileSync("apps/extension/src/popup.ts", "utf8");
    const request = source.slice(source.indexOf("async function requestEvaluation()"), source.indexOf("function openInApp()"));
    expect(request).toContain('if (result.body.outcome === "QUEUED") {');
    expect(request.match(/startPolling\(\)/g)).toHaveLength(1);
    expect(request.indexOf("startPolling()")).toBeGreaterThan(request.indexOf('outcome === "QUEUED"'));
    expect(request.indexOf("startPolling()")).toBeLessThan(request.indexOf('outcome === "NEEDS_REVIEW"'));
    const popupHtml = readFileSync("apps/extension/static/popup.html", "utf8");
    expect(popupHtml).not.toMatch(/>\s*(Evaluate|Reject)\s*</);
  });
});

describe("the extension's evaluation request route", () => {
  it("passes the production gate's triage outcome through unchanged", async () => {
    const { credential, tokenHash, tokenHint } = generatePairingCredential();
    const pairing: ExtensionPairingRecord = { id: "00000000-0000-4000-8000-0000000000p1", label: "Chrome", tokenHint, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
    const store: ExtensionPairingManager = {
      findByHash: async (hash) => (hash === tokenHash ? { ...pairing, tokenHash } : null),
      markUsed: async () => undefined,
      create: async () => pairing,
      list: async () => [pairing],
      revoke: async () => pairing,
    };
    const production = vi.fn(async () => new Response(JSON.stringify({ outcome: "NEEDS_REVIEW", triage: { outcome: "NEEDS_REVIEW" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const handlers = createExtensionApiHandlers({
      pairings: store,
      captures: createExtensionCaptureService({
        ingestion: { ingest: vi.fn() },
        lookup: { findCapturedPage: vi.fn(async () => null) },
        latestEvaluation: vi.fn(async () => null),
        discovery: customerSuccessDiscoveryConfiguration,
      }),
      evaluation: { request: production, status: vi.fn() },
    });
    const opportunityId = "00000000-0000-4000-8000-0000000000a1";
    const response = await handlers.requestEvaluation(
      new Request(`http://127.0.0.1:3000/api/extension/opportunities/${opportunityId}/evaluation-requests`, {
        method: "POST",
        body: "{}",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      }),
      opportunityId,
    );
    expect(production).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "NEEDS_REVIEW", triage: { outcome: "NEEDS_REVIEW" } });
  });
});
