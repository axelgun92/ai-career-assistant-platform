// Triage-to-lifecycle routing (November 25, 2026), with fakes: the one rule,
// the run counts, the guard's order, and the historical cleanup's arguments.
import { describe, expect, it, vi } from "vitest";
import { emptyRetrievalRunCounts } from "@ai-career/core";
import { automaticDismissalSkipFromFacts } from "@ai-career/database";
import { countAutomaticTriage, createAutomaticTriage } from "../../apps/web/src/server/automatic-triage";
import type { TriageAssessment } from "../../apps/web/src/server/evaluation-service";
import { parseHistoricalRoutingArguments } from "../../apps/web/src/server/triage-routing-cleanup";
import { automaticDismissalReason } from "../../apps/web/src/server/triage-routing";

describe("where a triaged job lands", () => {
  it("keeps EVALUATE and NEEDS_REVIEW Active and dismisses REJECT and off-title jobs, REJECT first", () => {
    expect(automaticDismissalReason({ triageOutcome: "EVALUATE", titleAccepted: true })).toBeNull();
    expect(automaticDismissalReason({ triageOutcome: "NEEDS_REVIEW", titleAccepted: true })).toBeNull();
    expect(automaticDismissalReason({ triageOutcome: null, titleAccepted: true })).toBeNull();
    expect(automaticDismissalReason({ triageOutcome: "REJECT", titleAccepted: true })).toBe("TRIAGE_REJECT");
    expect(automaticDismissalReason({ triageOutcome: "REJECT", titleAccepted: false })).toBe("TRIAGE_REJECT");
    expect(automaticDismissalReason({ triageOutcome: "NEEDS_REVIEW", titleAccepted: false })).toBe("OUTSIDE_TARGET_TITLES");
    expect(automaticDismissalReason({ triageOutcome: null, titleAccepted: false })).toBe("OUTSIDE_TARGET_TITLES");
  });

  it("never moves a job the user decided about or one with work in flight", () => {
    const facts = { status: "NORMALIZED", application: false, userAction: false, manualTriage: false, inFlight: false };
    expect(automaticDismissalSkipFromFacts(facts)).toBeNull();
    expect(automaticDismissalSkipFromFacts(null)).toBe("NOT_FOUND");
    expect(automaticDismissalSkipFromFacts({ ...facts, status: "REJECTED_BY_USER" })).toBe("ALREADY_DISMISSED");
    for (const status of ["SAVED", "APPLIED", "ARCHIVED", "CLOSED", "DISCOVERED"]) expect(automaticDismissalSkipFromFacts({ ...facts, status })).toBe("NOT_A_SYSTEM_STATE");
    expect(automaticDismissalSkipFromFacts({ ...facts, application: true, userAction: true })).toBe("APPLICATION_HISTORY");
    expect(automaticDismissalSkipFromFacts({ ...facts, userAction: true })).toBe("USER_LIFECYCLE_DECISION");
    expect(automaticDismissalSkipFromFacts({ ...facts, manualTriage: true })).toBe("MANUAL_TRIAGE_DECISION");
    expect(automaticDismissalSkipFromFacts({ ...facts, inFlight: true })).toBe("EVALUATION_IN_PROGRESS");
  });

  it("routes after automatic triage and counts what moved", async () => {
    const assessment: TriageAssessment = {
      status: "ASSESSED",
      triage: { id: "t", opportunityId: "o", outcome: "REJECT", automaticOutcome: "REJECT", reasons: [], manualDecision: null, manuallyDecidedAt: null, userProfileId: "p", userProfileVersion: 1, assessedAt: new Date() },
    } as never;
    const route = vi.fn(async () => ({ status: "DISMISSED" as const, reason: "TRIAGE_REJECT" as const, from: "NORMALIZED" }));
    const triage = createAutomaticTriage({ assess: async () => assessment, existing: async () => null, route });
    const result = await triage({ outcome: "CREATED", opportunityId: "o" });
    expect(result).toEqual({ status: "ASSESSED", outcome: "REJECT", dismissed: "TRIAGE_REJECT" });
    const counts = emptyRetrievalRunCounts();
    countAutomaticTriage(counts, result);
    expect(counts.triage).toEqual({ REJECT: 1, dismissedReject: 1 });
    // A re-observation is neither triaged nor routed.
    await triage({ outcome: "UNCHANGED", opportunityId: "o" });
    expect(route).toHaveBeenCalledTimes(1);
  });
});

describe("pnpm triage:route-historical arguments", () => {
  const environment = { DATABASE_URL: "postgresql://user:secret@localhost:5432/ai_career_assistant_acceptance" };
  const parse = (...args: string[]) => parseHistoricalRoutingArguments(args, environment);

  it("is a dry run unless --apply names the expected count and a manifest", () => {
    expect(parse("--database", "ai_career_assistant_acceptance")).toEqual({ ok: true, database: "ai_career_assistant_acceptance", mode: "dry-run", list: false });
    expect(parse("--database", "ai_career_assistant_acceptance", "--apply")).toMatchObject({ ok: false });
    expect(parse("--database", "ai_career_assistant_acceptance", "--apply", "--expect", "135")).toMatchObject({ ok: false });
    expect(parse("--database", "ai_career_assistant_acceptance", "--apply", "--expect", "135", "--manifest", "moved.json")).toEqual({
      ok: true, database: "ai_career_assistant_acceptance", mode: "apply", expect: 135, manifest: "moved.json",
    });
    expect(parse("--database", "ai_career_assistant_acceptance", "--expect", "135")).toMatchObject({ ok: false });
    expect(parse("--database", "ai_career_assistant_acceptance", "--restore", "moved.json")).toMatchObject({ ok: false });
    expect(parse("--database", "ai_career_assistant_acceptance", "--verify", "moved.json")).toMatchObject({ ok: true, mode: "verify" });
    expect(parse("--database", "ai_career_assistant_acceptance", "--apply", "--verify", "x", "--expect", "1", "--manifest", "m")).toMatchObject({ ok: false });
  });

  it("requires the database DATABASE_URL names and never echoes the URL", () => {
    const wrong = parse("--database", "other");
    expect(wrong).toMatchObject({ ok: false });
    expect(JSON.stringify(wrong)).not.toContain("secret");
    expect(parse("--database", "ai_career_assistant_acceptance", "--bogus")).toEqual({ ok: false, problem: "Unknown option --bogus" });
  });
});
