// Automatic pre-evaluator triage after ingestion (November 23, 2026), with
// fakes: which ingestion outcomes are triaged, the existing assessment kept,
// no active profile, a safe refusal and a failure that never throws, the run
// counts, and the configured-source retrieval worker calling the step once
// per stored listing without ever starting an evaluation.
import { describe, expect, it, vi } from "vitest";
import { emptyRetrievalRunCounts, type RetrievedListingOutcome } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import type { RetrievalRunRecord, RetrievalSourceRecord } from "@ai-career/database";
import { createAdapterRegistry, createFixtureTransport } from "@ai-career/discovery";
import { countAutomaticTriage, createAutomaticTriage, type AutomaticTriageResult } from "../../apps/web/src/server/automatic-triage";
import { EvaluationApiError } from "../../apps/web/src/server/evaluation-errors";
import type { TriageAssessment } from "../../apps/web/src/server/evaluation-service";
import { createRetrievalWorker, type RetrievalRunStore } from "../../apps/web/src/server/retrieval-worker";
import { createTestAdapter, jsonResponse, testBoardUrl } from "../support/retrieval-test-adapter";

const assessed = (outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT"): TriageAssessment => ({
  status: "ASSESSED",
  triage: {
    id: "t", opportunityId: "o", outcome, automaticOutcome: outcome, reasons: [], manualDecision: null,
    manuallyDecidedAt: null, userProfileId: "p", userProfileVersion: 1, assessedAt: new Date(),
  },
});

function fakes(assessment: TriageAssessment | (() => Promise<TriageAssessment>), existing: unknown = null) {
  const assess = vi.fn(typeof assessment === "function" ? assessment : async () => assessment);
  const lookup = vi.fn(async () => existing);
  const log = { warn: vi.fn() };
  return { assess, lookup, log, triage: createAutomaticTriage({ assess, existing: lookup, log }) };
}

describe("which stored listings are triaged", () => {
  it("triages a new opportunity and records its outcome", async () => {
    for (const outcome of ["EVALUATE", "NEEDS_REVIEW", "REJECT"] as const) {
      const { triage, assess } = fakes(assessed(outcome));
      expect(await triage({ outcome: "CREATED", opportunityId: "o" })).toEqual({ status: "ASSESSED", outcome });
      expect(assess).toHaveBeenCalledWith("o");
    }
  });

  it("never triages an exact duplicate attached to an existing opportunity or an unchanged re-observation", async () => {
    for (const outcome of ["ATTACHED", "UNCHANGED"] as const) {
      const { triage, assess, lookup } = fakes(assessed("EVALUATE"));
      expect(await triage({ outcome, opportunityId: "o" })).toEqual({ status: "SKIPPED", reason: outcome });
      expect(assess).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("a changed listing is triaged only when its opportunity has no assessment yet; an existing (or manual) one is kept", async () => {
    const kept = fakes(assessed("REJECT"), { manualDecision: "EVALUATE" });
    expect(await kept.triage({ outcome: "CHANGED", opportunityId: "o" })).toEqual({ status: "SKIPPED", reason: "ALREADY_ASSESSED" });
    expect(kept.assess).not.toHaveBeenCalled();
    const fresh = fakes(assessed("NEEDS_REVIEW"));
    expect(await fresh.triage({ outcome: "CHANGED", opportunityId: "o" })).toEqual({ status: "ASSESSED", outcome: "NEEDS_REVIEW" });
  });

  it("no active profile, a safe refusal and a failure each return a result and never throw", async () => {
    expect(await fakes({ status: "NO_PROFILE" }).triage({ outcome: "CREATED", opportunityId: "o" })).toEqual({ status: "NO_PROFILE" });
    expect(await fakes({ status: "UNAVAILABLE", reason: "DOMAIN_UNSUPPORTED" }).triage({ outcome: "CREATED", opportunityId: "o" }))
      .toEqual({ status: "UNAVAILABLE", reason: "DOMAIN_UNSUPPORTED" });
    const refused = fakes(async () => { throw new EvaluationApiError("OPPORTUNITY_NOT_EVALUABLE", "Restore it", 409); });
    expect(await refused.triage({ outcome: "CHANGED", opportunityId: "o" })).toEqual({ status: "UNAVAILABLE", reason: "OPPORTUNITY_NOT_EVALUABLE" });
    const failed = fakes(async () => { throw new Error("connection lost"); });
    expect(await failed.triage({ outcome: "CREATED", opportunityId: "o" })).toEqual({ status: "FAILED" });
    expect(failed.log.warn).toHaveBeenCalledWith(expect.stringContaining("automatic triage of opportunity o failed (Error)"));
    // The message carries no error text (which could hold job content).
    expect(failed.log.warn.mock.calls[0]![0]).not.toContain("connection lost");
  });

  it("counts outcomes and problems, and nothing for skipped listings", () => {
    const counts = emptyRetrievalRunCounts();
    const results: AutomaticTriageResult[] = [
      { status: "SKIPPED", reason: "UNCHANGED" },
      { status: "ASSESSED", outcome: "EVALUATE" },
      { status: "ASSESSED", outcome: "EVALUATE" },
      { status: "ASSESSED", outcome: "REJECT" },
      { status: "NO_PROFILE" },
      { status: "UNAVAILABLE", reason: "X" },
      { status: "FAILED" },
    ];
    countAutomaticTriage(counts, results[0]!);
    expect(counts.triage).toBeUndefined();
    for (const result of results.slice(1)) countAutomaticTriage(counts, result);
    expect(counts.triage).toEqual({ EVALUATE: 2, REJECT: 1, noProfile: 1, unavailable: 1, failed: 1 });
  });
});

describe("configured-source retrieval", () => {
  const now = new Date("2026-11-23T09:00:00.000Z");
  const source = {
    id: "5b0c3f0e-6a2f-4c55-9d7e-1f2a3b4c5d6e", adapterKey: "test-board", name: "Acme board", domain: "customer-success",
    retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", enabled: true, config: { board: "acme" }, scheduleMinutes: 720,
    lastRunAt: null, nextEligibleAt: null, trackingScopeKey: "scope-1", archivedAt: null, createdAt: now, updatedAt: now,
  } as RetrievalSourceRecord;
  const run = {
    id: "7c1d4e2f-8b3a-4d66-ae8f-2a3b4c5d6e7f", retrievalSourceId: source.id, trigger: "SCHEDULED", status: "RUNNING", leaseExpiresAt: null,
    startedAt: now, finishedAt: null, counts: null, errorCode: null, errorMessage: null, retryAfterUntil: null, listingCoverageComplete: null, createdAt: now,
  } as RetrievalRunRecord;
  const jobs = ["1", "2", "3", "4", "5"].map((id) => ({ id, title: "Customer Success Manager", html: `<p>Job ${id}.</p>`, url: `https://jobs.example.com/${id}` }));
  // The ingestion outcome of each listing, by external ID; "5" fails to store.
  const outcomes: Record<string, RetrievedListingOutcome> = { "1": "CREATED", "2": "ATTACHED", "3": "UNCHANGED", "4": "CHANGED" };

  function worker(triage: ReturnType<typeof createAutomaticTriage>) {
    const finished: Array<Parameters<RetrievalRunStore["finishRun"]>[1]> = [];
    const store: RetrievalRunStore = {
      enqueueDueRuns: vi.fn(async () => 0),
      claimNextRun: vi.fn(async () => ({ run, source })),
      finishRun: vi.fn(async (_id, input) => (finished.push(input), { ...run, status: input.status })),
      failInterruptedRuns: vi.fn(async () => 0),
      recordListingObservations: vi.fn(async () => ({ applied: false, observed: 0, missing: 0, removed: 0, reappeared: 0 })),
    };
    const instance = createRetrievalWorker({
      store,
      ingestion: {
        ingest: async (raw) => {
          const outcome = outcomes[raw.externalId!];
          if (!outcome) throw new Error("store failed");
          return { outcome, opportunityId: `opportunity-${raw.externalId}`, sourceRecordId: "s", decision: outcome === "CREATED" ? "NO_MATCH" : null };
        },
      },
      registry: createAdapterRegistry([createTestAdapter()]),
      transport: () => createFixtureTransport({ [testBoardUrl("test-board", "acme", 1)]: jsonResponse({ jobs }) }),
      discovery: customerSuccessDiscoveryConfiguration,
      triage,
      env: () => ({}),
      now: () => now,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    return { instance, finished };
  }

  it("triages each new opportunity (and a changed one never assessed) once, records the outcomes and requests no evaluation", async () => {
    const { triage, assess, lookup } = fakes(assessed("EVALUATE"));
    const { instance, finished } = worker(triage);
    await instance.runOnce();
    expect(assess.mock.calls.map(([id]) => id)).toEqual(["opportunity-1", "opportunity-4"]);
    expect(lookup.mock.calls.map(([id]) => id)).toEqual(["opportunity-1", "opportunity-4"]);
    expect(finished[0]!).toMatchObject({
      status: "PARTIAL",
      errorCode: "LISTING_FAILURES",
      counts: { created: 1, attached: 1, unchanged: 1, changed: 1, failed: 1, triage: { EVALUATE: 2 } },
    });
  });

  it("no active profile or a triage failure never fails the run or loses a stored listing", async () => {
    for (const assessment of [{ status: "NO_PROFILE" } as const, async () => { throw new Error("down"); }]) {
      const { triage } = fakes(assessment);
      const { instance, finished } = worker(triage);
      await instance.runOnce();
      const counts = finished[0]!.counts;
      // The run's own failure is only listing "5", which failed to store.
      expect(counts).toMatchObject({ created: 1, attached: 1, unchanged: 1, changed: 1, failed: 1 });
      expect(counts.triage).toEqual(typeof assessment === "function" ? { failed: 2 } : { noProfile: 2 });
    }
  });
});
