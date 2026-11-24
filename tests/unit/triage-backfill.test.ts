// The triage-only backfill's recheck and failure handling (November 24, 2026),
// with fakes: a job gone, the active profile changed, an assessment written
// in the meantime, a refused job and a failure are each recorded, and the run
// goes on; the dry run calls neither the assessment nor the recheck.
import { describe, expect, it, vi } from "vitest";
import { EvaluationApiError } from "../../apps/web/src/server/evaluation-errors";
import type { TriageAssessment } from "../../apps/web/src/server/evaluation-service";
import { formatTriageBackfillReport, runTriageBackfill, type TriageBackfillSnapshot } from "../../apps/web/src/server/triage-backfill";
import type { TriageCoverageRow } from "../../apps/web/src/server/triage-coverage-audit";

const profile = { id: "p", version: 1 };
const row = (id: string, overrides: Partial<TriageCoverageRow> = {}): TriageCoverageRow => ({
  id, status: "NORMALIZED", domain: "customer-success", title: "Customer Success Manager", sourceType: "API", captureMethod: null,
  automaticOutcome: null, manualDecision: null, triageProfileId: null, triageProfileVersion: null, completedEvaluations: 0, activeEvaluations: 0,
  failedEvaluations: 0, openAdmissions: 0, openDeferrals: 0, paidAttempts: 0, handoffOutcome: null, captureItems: 0, hasApplication: false, duplicateDecision: null,
  ...overrides,
});
const assessed = (outcome: "EVALUATE" | "NEEDS_REVIEW" | "REJECT"): TriageAssessment => ({
  status: "ASSESSED",
  triage: { id: "t", opportunityId: "o", outcome, automaticOutcome: outcome, reasons: [], manualDecision: null, manuallyDecidedAt: null, userProfileId: "p", userProfileVersion: 1, assessedAt: new Date() },
});

describe("the triage-only backfill", () => {
  const start: TriageBackfillSnapshot = {
    rows: ["a", "gone", "moved", "raced", "refused", "broken", "b"].map((id) => row(id)).concat(row("off", { title: "Payroll Support Representative" })),
    activeProfile: profile,
    titlePolicy: null,
  };

  it("a dry run lists the candidates and calls neither the recheck nor the assessment", async () => {
    const read = vi.fn(async () => start);
    const assess = vi.fn();
    const existing = vi.fn();
    const report = await runTriageBackfill({ read, assess, existing }, { apply: false });
    expect(report.candidates.map((candidate) => candidate.id)).toEqual(["a", "gone", "moved", "raced", "refused", "broken", "b"]);
    expect(report.classes).toEqual({ CANDIDATE: 7, OUTSIDE_TARGET_TITLES: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(assess).not.toHaveBeenCalled();
    expect(existing).not.toHaveBeenCalled();
    expect(formatTriageBackfillReport(report)).toContain("To apply: add --apply --expect 7");
  });

  it("rechecks each candidate, records every skip and failure, and goes on", async () => {
    let profileNow = profile;
    const read = vi.fn(async (id?: string): Promise<TriageBackfillSnapshot> => {
      if (!id) return start;
      if (id === "gone") return { ...start, rows: [] };
      if (id === "raced") profileNow = { id: "p", version: 1 };
      if (id === "b") profileNow = { id: "p", version: 2 };
      return { ...start, activeProfile: profileNow, rows: [row(id, id === "moved" ? { status: "ARCHIVED" } : {})] };
    });
    const existing = vi.fn(async (id: string) => (id === "raced" ? { outcome: "EVALUATE" } : null));
    const assess = vi.fn(async (id: string): Promise<TriageAssessment> => {
      if (id === "refused") throw new EvaluationApiError("OPPORTUNITY_NOT_EVALUABLE", "Restore it first", 409);
      if (id === "broken") throw new Error("connection lost");
      return assessed("REJECT");
    });
    const seen: string[] = [];
    const report = await runTriageBackfill({ read, assess, existing }, { apply: true, expectedCandidates: 7, onResult: (entry) => seen.push(entry.id) });
    expect(Object.fromEntries(report.results.map((entry) => [entry.id, entry.result]))).toEqual({
      a: "REJECT",
      gone: "SKIPPED:NOT_FOUND",
      moved: "SKIPPED:USER_ACTED",
      raced: "SKIPPED:ALREADY_ASSESSED",
      refused: "UNAVAILABLE:OPPORTUNITY_NOT_EVALUABLE",
      broken: "FAILED",
      b: "SKIPPED:PROFILE_CHANGED",
    });
    expect(seen).toEqual(["a", "gone", "moved", "raced", "refused", "broken", "b"]);
    expect(assess.mock.calls.map(([id]) => id)).toEqual(["a", "refused", "broken"]);
    expect(formatTriageBackfillReport(report)).toContain("FAILED: 1");
  });

  it("refuses with no active profile, or without the reviewed candidate count", async () => {
    const assess = vi.fn();
    const none = await runTriageBackfill({ read: async () => ({ ...start, activeProfile: null }), assess, existing: vi.fn() }, { apply: true, expectedCandidates: 7 });
    expect(none.refused).toBe("NO_ACTIVE_PROFILE");
    expect(formatTriageBackfillReport(none)).toContain("Refused: no active User Profile");
    const wrong = await runTriageBackfill({ read: async () => start, assess, existing: vi.fn() }, { apply: true, expectedCandidates: 6 });
    expect(wrong.refused).toBe("CANDIDATE_COUNT_CHANGED");
    expect(formatTriageBackfillReport(wrong)).toContain("Refused: --apply needs --expect 7");
    expect(assess).not.toHaveBeenCalled();
  });
});
