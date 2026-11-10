import { describe, expect, it } from "vitest";
import {
  canRequestEvaluation,
  isNormalizedLifecycleState,
  opportunityLifecycleStateSchema,
  resolveUserAction,
  restoreTarget,
  systemLifecycleState,
  type OpportunityLifecycleState,
  type OpportunityUserAction,
  type SystemLifecycleState,
  type UserActionHistoryEntry,
} from "@ai-career/core";

// Applies actions the way the repository does: resolve, then append history.
function simulate(start: OpportunityLifecycleState, systemState: SystemLifecycleState = "RECOMMENDED") {
  let status = start;
  const history: UserActionHistoryEntry[] = [];
  let currentSystemState = systemState;
  return {
    get status() {
      return status;
    },
    history,
    setSystemState(next: SystemLifecycleState) {
      currentSystemState = next;
    },
    act(action: OpportunityUserAction) {
      const resolution = resolveUserAction({ action, currentStatus: status, history, currentSystemState });
      if (!resolution.allowed) throw new Error(resolution.reason);
      history.push({ action, fromStatus: status, toStatus: resolution.to });
      status = resolution.to;
      return status;
    },
  };
}

describe("lifecycle predicates", () => {
  it("treats every state after DISCOVERED as normalized", () => {
    for (const status of opportunityLifecycleStateSchema.options) {
      expect(isNormalizedLifecycleState(status)).toBe(status !== "DISCOVERED");
    }
  });

  it("allows evaluation requests except before normalization or when archived/closed", () => {
    const blocked = ["DISCOVERED", "ARCHIVED", "CLOSED"];
    for (const status of opportunityLifecycleStateSchema.options) {
      expect(canRequestEvaluation(status)).toBe(!blocked.includes(status));
    }
  });

  it("derives the system state from persisted evaluations", () => {
    expect(systemLifecycleState({ hasCompletedEvaluation: false, hasRecommendation: false })).toBe("NORMALIZED");
    expect(systemLifecycleState({ hasCompletedEvaluation: true, hasRecommendation: false })).toBe("EVALUATED");
    expect(systemLifecycleState({ hasCompletedEvaluation: true, hasRecommendation: true })).toBe("RECOMMENDED");
  });
});

describe("forward user actions", () => {
  const allowed: Record<Exclude<OpportunityUserAction, "RESTORE">, OpportunityLifecycleState[]> = {
    SAVE: ["NORMALIZED", "EVALUATED", "RECOMMENDED"],
    MARK_APPLIED: ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"],
    DISMISS: ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"],
    ARCHIVE: ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED", "APPLIED", "REJECTED_BY_USER", "CLOSED"],
  };
  const targets = { SAVE: "SAVED", MARK_APPLIED: "APPLIED", DISMISS: "REJECTED_BY_USER", ARCHIVE: "ARCHIVED" };

  for (const [action, from] of Object.entries(allowed) as Array<[keyof typeof allowed, OpportunityLifecycleState[]]>) {
    it(`${action} is allowed exactly from ${from.join(", ")}`, () => {
      for (const status of opportunityLifecycleStateSchema.options) {
        const resolution = resolveUserAction({
          action,
          currentStatus: status,
          history: [],
          currentSystemState: "RECOMMENDED",
        });
        if (from.includes(status)) expect(resolution).toEqual({ allowed: true, to: targets[action] });
        else expect(resolution.allowed).toBe(false);
      }
    });
  }
});

describe("deterministic RESTORE", () => {
  it("RECOMMENDED → SAVED → RESTORE returns to RECOMMENDED", () => {
    const opportunity = simulate("RECOMMENDED");
    opportunity.act("SAVE");
    expect(opportunity.act("RESTORE")).toBe("RECOMMENDED");
  });

  it("APPLIED → ARCHIVED → RESTORE returns to APPLIED", () => {
    const opportunity = simulate("RECOMMENDED");
    opportunity.act("MARK_APPLIED");
    opportunity.act("ARCHIVE");
    expect(opportunity.act("RESTORE")).toBe("APPLIED");
  });

  it("REJECTED_BY_USER → ARCHIVED → RESTORE returns to REJECTED_BY_USER", () => {
    const opportunity = simulate("RECOMMENDED");
    opportunity.act("DISMISS");
    opportunity.act("ARCHIVE");
    expect(opportunity.act("RESTORE")).toBe("REJECTED_BY_USER");
  });

  it("repeated RESTORE walks strictly backward and never bounces", () => {
    const opportunity = simulate("RECOMMENDED");
    opportunity.act("SAVE");
    opportunity.act("MARK_APPLIED");
    opportunity.act("ARCHIVE");
    expect(opportunity.act("RESTORE")).toBe("APPLIED");
    expect(opportunity.act("RESTORE")).toBe("SAVED");
    expect(opportunity.act("RESTORE")).toBe("RECOMMENDED");
    expect(() => opportunity.act("RESTORE")).toThrow(/Only a saved, applied, dismissed, or archived/);
    expect(opportunity.status).toBe("RECOMMENDED");
  });

  it("does not treat a prior RESTORE row as a target (no APPLIED → ARCHIVED bounce)", () => {
    const opportunity = simulate("RECOMMENDED");
    opportunity.act("MARK_APPLIED");
    opportunity.act("ARCHIVE");
    opportunity.act("RESTORE"); // ARCHIVED → APPLIED; this row has fromStatus ARCHIVED
    // The next RESTORE undoes MARK_APPLIED, not the RESTORE row.
    expect(opportunity.act("RESTORE")).toBe("RECOMMENDED");
  });

  it("targets correctly after an action is redone (SAVE, RESTORE, SAVE, RESTORE)", () => {
    const opportunity = simulate("RECOMMENDED");
    opportunity.act("SAVE");
    opportunity.act("RESTORE");
    opportunity.act("SAVE");
    expect(opportunity.act("RESTORE")).toBe("RECOMMENDED");
    opportunity.act("DISMISS");
    opportunity.act("ARCHIVE");
    expect(opportunity.act("RESTORE")).toBe("REJECTED_BY_USER");
    expect(opportunity.act("RESTORE")).toBe("RECOMMENDED");
  });

  it("re-derives a system-state target so evaluations in the meantime are not lost", () => {
    const opportunity = simulate("NORMALIZED", "NORMALIZED");
    opportunity.act("SAVE"); // saved before any evaluation completed
    opportunity.setSystemState("RECOMMENDED"); // an evaluation completed while SAVED
    expect(opportunity.act("RESTORE")).toBe("RECOMMENDED");
  });

  it("restores a user-state target exactly, regardless of later evaluations", () => {
    const opportunity = simulate("NORMALIZED", "NORMALIZED");
    opportunity.act("MARK_APPLIED");
    opportunity.act("ARCHIVE");
    opportunity.setSystemState("RECOMMENDED");
    expect(opportunity.act("RESTORE")).toBe("APPLIED");
  });

  it("rejects RESTORE when the history is empty or inconsistent with the current status", () => {
    expect(
      restoreTarget({ history: [], currentStatus: "SAVED", currentSystemState: "RECOMMENDED" }).allowed,
    ).toBe(false);
    expect(
      restoreTarget({
        history: [{ action: "SAVE", fromStatus: "RECOMMENDED", toStatus: "SAVED" }],
        currentStatus: "ARCHIVED",
        currentSystemState: "RECOMMENDED",
      }).allowed,
    ).toBe(false);
  });
});

describe("available user actions", () => {
  it("offers exactly the actions the API would accept", async () => {
    const { availableUserActions } = await import("@ai-career/core");
    expect(availableUserActions({ currentStatus: "RECOMMENDED", history: [], currentSystemState: "RECOMMENDED" }))
      .toEqual(["SAVE", "MARK_APPLIED", "DISMISS", "ARCHIVE"]);
    expect(availableUserActions({
      currentStatus: "SAVED",
      history: [{ action: "SAVE", fromStatus: "RECOMMENDED", toStatus: "SAVED" }],
      currentSystemState: "RECOMMENDED",
    })).toEqual(["MARK_APPLIED", "DISMISS", "ARCHIVE", "RESTORE"]);
    expect(availableUserActions({ currentStatus: "DISCOVERED", history: [], currentSystemState: "NORMALIZED" }))
      .toEqual([]);
  });
});
