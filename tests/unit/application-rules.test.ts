import { describe, expect, it, vi } from "vitest";
import {
  additiveApplicationCommands,
  addDays,
  applicationCommandSchema,
  applicationCreationModes,
  applicationOutcomeSchema,
  applicationShapeIsValid,
  applicationStageSchema,
  appliedOnRequired,
  canChangeStage,
  canClose,
  createApplicationSchema,
  creationRefusal,
  effectiveAppliedAction,
  followUpState,
  isIsoDate,
  isSubmitted,
  lifecycleActionGuard,
  opportunityLifecycleStateSchema,
  pendingUserActions,
  reopenRefusal,
  reopenTarget,
  restoreTarget,
  toIsoDate,
  versionedApplicationCommands,
  type ApplicationOutcome,
  type ApplicationStage,
  type OpportunityLifecycleState,
  type OpportunityUserAction,
  type UserActionHistoryEntry,
} from "@ai-career/core";
import { ApplicationError } from "@ai-career/database";
import { createApplicationApiHandlers, type ApplicationStore } from "../../apps/web/src/server/application-service";

const uuid = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const entry = (action: OpportunityUserAction, fromStatus: OpportunityLifecycleState, toStatus: OpportunityLifecycleState, at: string) =>
  ({ action, fromStatus, toStatus, createdAt: new Date(at) });

describe("stage and outcome rules", () => {
  it("moves freely between submitted stages but never back to planning", () => {
    expect(canChangeStage("APPLIED", "INTERVIEWING").allowed).toBe(true);
    expect(canChangeStage("FINAL_ROUND", "SCREENING").allowed).toBe(true);
    expect(canChangeStage("SCREENING", "PLANNED")).toMatchObject({ allowed: false, reason: expect.stringContaining("cannot return") });
    expect(canChangeStage("PLANNED", "APPLIED").allowed).toBe(false); // submit only
    expect(canChangeStage("CLOSED", "APPLIED").allowed).toBe(false); // reopen first
    expect(canChangeStage("OFFER", "CLOSED").allowed).toBe(false); // close with an outcome
    expect(canChangeStage("OFFER", "OFFER").allowed).toBe(false);
  });

  it("allows offer outcomes only from OFFER and NOT_SUBMITTED only from PLANNED", () => {
    expect(canClose("OFFER", "OFFER_ACCEPTED").allowed).toBe(true);
    expect(canClose("INTERVIEWING", "OFFER_DECLINED").allowed).toBe(false);
    expect(canClose("PLANNED", "NOT_SUBMITTED").allowed).toBe(true);
    for (const outcome of ["REJECTED", "WITHDRAWN", "NO_RESPONSE", "OFFER_ACCEPTED"] as const) {
      expect(canClose("PLANNED", outcome).allowed).toBe(false);
    }
    for (const stage of ["APPLIED", "SCREENING", "INTERVIEWING", "FINAL_ROUND", "OFFER"] as const) {
      expect(canClose(stage, "REJECTED").allowed).toBe(true);
      expect(canClose(stage, "NOT_SUBMITTED").allowed).toBe(false);
    }
    expect(canClose("CLOSED", "REJECTED").allowed).toBe(false);
  });

  it("reopens to the stage held when last closed", () => {
    expect(reopenTarget([
      { type: "CLOSED", fromStage: "SCREENING", sequence: 4 },
      { type: "REOPENED", fromStage: "CLOSED", sequence: 5 },
      { type: "CLOSED", fromStage: "OFFER", sequence: 7 },
    ])).toBe("OFFER");
    expect(reopenTarget([])).toBeNull();
  });
});

describe("appliedOn invariant", () => {
  const stages = applicationStageSchema.options;
  const outcomes: Array<ApplicationOutcome | null> = [null, ...applicationOutcomeSchema.options];

  it("requires a date exactly for submitted stages and submitted outcomes", () => {
    expect(appliedOnRequired("PLANNED", null)).toBe(false);
    for (const stage of ["APPLIED", "SCREENING", "INTERVIEWING", "FINAL_ROUND", "OFFER"] as const) {
      expect(appliedOnRequired(stage, null)).toBe(true);
    }
    expect(appliedOnRequired("CLOSED", "NOT_SUBMITTED")).toBe(false);
    for (const outcome of ["OFFER_ACCEPTED", "OFFER_DECLINED", "REJECTED", "WITHDRAWN", "NO_RESPONSE"] as const) {
      expect(appliedOnRequired("CLOSED", outcome)).toBe(true);
    }
  });

  it("the shape validator rejects every contradictory combination and accepts the four valid shapes", () => {
    const date = "2026-10-01";
    expect(applicationShapeIsValid({ stage: "PLANNED", outcome: null, appliedOn: date, closedOn: null })).toBe(false);
    expect(applicationShapeIsValid({ stage: "SCREENING", outcome: null, appliedOn: null, closedOn: null })).toBe(false);
    expect(applicationShapeIsValid({ stage: "CLOSED", outcome: "REJECTED", appliedOn: null, closedOn: date })).toBe(false);
    expect(applicationShapeIsValid({ stage: "CLOSED", outcome: "NOT_SUBMITTED", appliedOn: date, closedOn: date })).toBe(false);
    expect(applicationShapeIsValid({ stage: "PLANNED", outcome: null, appliedOn: null, closedOn: null })).toBe(true);
    expect(applicationShapeIsValid({ stage: "OFFER", outcome: null, appliedOn: date, closedOn: null })).toBe(true);
    expect(applicationShapeIsValid({ stage: "CLOSED", outcome: "NOT_SUBMITTED", appliedOn: null, closedOn: date })).toBe(true);
    expect(applicationShapeIsValid({ stage: "CLOSED", outcome: "WITHDRAWN", appliedOn: date, closedOn: date })).toBe(true);
    // Exhaustive: valid exactly when outcome/closedOn match CLOSED and the date matches submission.
    for (const stage of stages) {
      for (const outcome of outcomes) {
        for (const appliedOn of [null, date]) {
          const closed = stage === "CLOSED";
          const expected = closed === (outcome !== null)
            && (appliedOn !== null) === isSubmitted(stage as ApplicationStage, outcome);
          expect(applicationShapeIsValid({ stage, outcome, appliedOn, closedOn: closed ? date : null })).toBe(expected);
        }
      }
    }
  });
});

describe("lifecycle interaction", () => {
  it("offers creation modes by lifecycle status", () => {
    for (const status of ["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"] as const) {
      expect(applicationCreationModes(status)).toEqual(["plan", "submitted"]);
    }
    expect(applicationCreationModes("APPLIED")).toEqual(["submitted"]);
    for (const status of ["REJECTED_BY_USER", "ARCHIVED", "CLOSED", "DISCOVERED"] as const) {
      expect(applicationCreationModes(status)).toEqual([]);
    }
    expect(creationRefusal("APPLIED", "plan")).toBe("APPLICATION_ALREADY_SUBMITTED");
    expect(creationRefusal("APPLIED", "submitted")).toBeNull();
    expect(creationRefusal("ARCHIVED", "submitted")).toBe("OPPORTUNITY_NOT_TRACKABLE");
  });

  it("reopens to PLANNED only when the lifecycle permits a plan", () => {
    expect(reopenRefusal("PLANNED", "SAVED")).toBeNull();
    expect(reopenRefusal("PLANNED", "RECOMMENDED")).toBeNull();
    expect(reopenRefusal("PLANNED", "APPLIED")).toBe("APPLICATION_ALREADY_SUBMITTED");
    expect(reopenRefusal("PLANNED", "REJECTED_BY_USER")).toBe("OPPORTUNITY_NOT_TRACKABLE");
    expect(reopenRefusal("SCREENING", "APPLIED")).toBeNull();
  });

  it("guards lifecycle actions that would contradict the application", () => {
    const planned = { stage: "PLANNED" as const, outcome: null };
    const notSubmitted = { stage: "CLOSED" as const, outcome: "NOT_SUBMITTED" as const };
    const screening = { stage: "SCREENING" as const, outcome: null };
    const rejected = { stage: "CLOSED" as const, outcome: "REJECTED" as const };
    expect(lifecycleActionGuard("MARK_APPLIED", "SAVED", planned).allowed).toBe(false);
    expect(lifecycleActionGuard("MARK_APPLIED", "SAVED", notSubmitted).allowed).toBe(false);
    expect(lifecycleActionGuard("MARK_APPLIED", "SAVED", null).allowed).toBe(true);
    expect(lifecycleActionGuard("RESTORE", "APPLIED", screening).allowed).toBe(false);
    expect(lifecycleActionGuard("RESTORE", "APPLIED", rejected).allowed).toBe(false);
    expect(lifecycleActionGuard("RESTORE", "ARCHIVED", rejected).allowed).toBe(true);
    expect(lifecycleActionGuard("RESTORE", "SAVED", planned).allowed).toBe(true);
    expect(lifecycleActionGuard("DISMISS", "SAVED", planned).allowed).toBe(false);
    expect(lifecycleActionGuard("DISMISS", "SAVED", notSubmitted).allowed).toBe(true);
    expect(lifecycleActionGuard("ARCHIVE", "APPLIED", screening).allowed).toBe(true);
    expect(lifecycleActionGuard("SAVE", "RECOMMENDED", planned).allowed).toBe(true);
  });
});

describe("effective MARK_APPLIED action", () => {
  it("finds the MARK_APPLIED behind the current APPLIED state using the RESTORE undo stack", () => {
    const single = [entry("MARK_APPLIED", "RECOMMENDED", "APPLIED", "2026-09-01T10:00:00Z")];
    expect(effectiveAppliedAction(single)?.createdAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    const saved = [entry("SAVE", "RECOMMENDED", "SAVED", "2026-09-01T10:00:00Z"), entry("MARK_APPLIED", "SAVED", "APPLIED", "2026-09-02T10:00:00Z")];
    expect(effectiveAppliedAction(saved)).toBe(saved[1]);
    const reapplied = [
      entry("MARK_APPLIED", "RECOMMENDED", "APPLIED", "2026-09-01T10:00:00Z"),
      entry("RESTORE", "APPLIED", "RECOMMENDED", "2026-09-02T10:00:00Z"),
      entry("MARK_APPLIED", "RECOMMENDED", "APPLIED", "2026-09-03T10:00:00Z"),
    ];
    expect(effectiveAppliedAction(reapplied)).toBe(reapplied[2]);
    const archivedAndRestored = [
      entry("MARK_APPLIED", "SAVED", "APPLIED", "2026-09-01T10:00:00Z"),
      entry("ARCHIVE", "APPLIED", "ARCHIVED", "2026-09-05T10:00:00Z"),
      entry("RESTORE", "ARCHIVED", "APPLIED", "2026-09-06T10:00:00Z"),
    ];
    expect(effectiveAppliedAction(archivedAndRestored)).toBe(archivedAndRestored[0]);
    expect(effectiveAppliedAction([])).toBeNull();
    expect(effectiveAppliedAction([entry("SAVE", "RECOMMENDED", "SAVED", "2026-09-01T10:00:00Z")])).toBeNull();
  });

  it("uses the UTC calendar date, also late in the UTC day", () => {
    expect(toIsoDate(new Date("2026-09-15T23:30:00Z"))).toBe("2026-09-15");
    expect(toIsoDate(new Date("2026-09-16T00:00:00Z"))).toBe("2026-09-16");
  });

  it("shares the undo stack with RESTORE without changing it", () => {
    const history: UserActionHistoryEntry[] = [
      { action: "SAVE", fromStatus: "RECOMMENDED", toStatus: "SAVED" },
      { action: "MARK_APPLIED", fromStatus: "SAVED", toStatus: "APPLIED" },
      { action: "RESTORE", fromStatus: "APPLIED", toStatus: "SAVED" },
    ];
    expect(pendingUserActions(history)).toEqual([history[0]]);
    expect(restoreTarget({ history, currentStatus: "SAVED", currentSystemState: "RECOMMENDED" })).toEqual({ allowed: true, to: "RECOMMENDED" });
    expect(opportunityLifecycleStateSchema.options).toContain("APPLIED");
  });
});

describe("follow-up state", () => {
  const today = "2026-10-07";
  it.each([
    ["2026-10-06", null, "OVERDUE"],
    ["2026-10-07", null, "DUE_TODAY"],
    ["2026-10-08", null, "UPCOMING"],
    ["2026-10-14", null, "UPCOMING"],
    ["2026-10-15", null, "LATER"],
    ["2026-10-01", new Date("2026-10-02T00:00:00Z"), "COMPLETED"],
  ] as const)("%s (completed %s) → %s", (dueOn, completedAt, state) => {
    expect(followUpState(dueOn, completedAt, today)).toBe(state);
  });

  it("does date arithmetic in UTC across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("input validation", () => {
  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("10/07/2026")).toBe(false);
  });

  it("plans never carry a date; submissions may omit it", () => {
    expect(createApplicationSchema.safeParse({ mode: "plan" }).success).toBe(true);
    expect(createApplicationSchema.safeParse({ mode: "plan", appliedOn: "2026-10-01" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ mode: "submitted" }).success).toBe(true);
    expect(createApplicationSchema.safeParse({ mode: "submitted", appliedOn: "2026-13-01" }).success).toBe(false);
  });

  it("every versioned command requires an integer expectedVersion; additive commands reject one", () => {
    const bodies: Record<string, Record<string, unknown>> = {
      submit: { appliedOn: "2026-10-01" },
      changeStage: { stage: "SCREENING" },
      close: { outcome: "REJECTED" },
      reopen: {},
      correctAppliedOn: { appliedOn: "2026-10-01" },
      editNote: { noteId: uuid, body: "Edited" },
      updateContact: { contactId: uuid, name: "Dana", role: "RECRUITER" },
      completeFollowUp: { followUpId: uuid },
      reopenFollowUp: { followUpId: uuid },
      updateInterview: { interviewId: uuid, kind: "PANEL", status: "COMPLETED" },
      addNote: { body: "Hello" },
      addContact: { name: "Dana", role: "RECRUITER" },
      addFollowUp: { description: "Ping", dueOn: "2026-10-09" },
      addInterview: { kind: "PANEL" },
    };
    expect(versionedApplicationCommands).toHaveLength(10);
    for (const command of versionedApplicationCommands) {
      const body = { command, ...bodies[command] };
      expect(applicationCommandSchema.safeParse(body).success, `${command} without version`).toBe(false);
      expect(applicationCommandSchema.safeParse({ ...body, expectedVersion: 1.5 }).success, `${command} fractional`).toBe(false);
      expect(applicationCommandSchema.safeParse({ ...body, expectedVersion: "1" }).success, `${command} string`).toBe(false);
      expect(applicationCommandSchema.safeParse({ ...body, expectedVersion: 1 }).success, `${command} valid`).toBe(true);
    }
    for (const command of additiveApplicationCommands) {
      const body = { command, ...bodies[command] };
      expect(applicationCommandSchema.safeParse(body).success, `${command} valid`).toBe(true);
      expect(applicationCommandSchema.safeParse({ ...body, expectedVersion: 1 }).success, `${command} with version`).toBe(false);
    }
  });

  it("submit and applied-date corrections require a real date", () => {
    expect(applicationCommandSchema.safeParse({ command: "submit", expectedVersion: 1 }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ command: "correctAppliedOn", expectedVersion: 1, appliedOn: null }).success).toBe(false);
  });

  it("validates notes, contacts and interviews", () => {
    expect(applicationCommandSchema.safeParse({ command: "addNote", body: "   " }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ command: "addNote", body: "x".repeat(10_001) }).success).toBe(false);
    const contact = (extra: Record<string, unknown>) =>
      applicationCommandSchema.safeParse({ command: "addContact", name: "Dana", role: "RECRUITER", ...extra });
    expect(contact({ email: "not-an-email" }).success).toBe(false);
    expect(contact({ profileUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(contact({ profileUrl: "ftp://example.com/x" }).success).toBe(false);
    const parsed = contact({ email: "", profileUrl: " https://www.linkedin.com/in/dana ", title: "" });
    expect(parsed.success && parsed.data).toMatchObject({ email: null, title: null, profileUrl: "https://www.linkedin.com/in/dana" });
    expect(contact({ name: " " }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ command: "addInterview", kind: "PANEL", scheduledAt: "tomorrow" }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ command: "addInterview", kind: "PANEL", contactId: "nope" }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ command: "addFollowUp", description: "", dueOn: "2026-10-09" }).success).toBe(false);
  });
});

describe("application API handlers", () => {
  function storeWith(overrides: Partial<ApplicationStore>): ApplicationStore {
    const unexpected = () => {
      throw new Error("unexpected call");
    };
    return new Proxy(overrides as ApplicationStore, {
      get: (target, key: string) => (key in target ? target[key as keyof ApplicationStore] : unexpected),
    });
  }
  const handlers = (store: ApplicationStore) =>
    createApplicationApiHandlers({ store, lister: { listPage: vi.fn() } });
  const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

  it.each([
    ["APPLICATION_ALREADY_SUBMITTED", 409],
    ["APPLICATION_CHANGED", 409],
    ["APPLICATION_EXISTS", 409],
    ["APPLIED_DATE_NOT_APPLICABLE", 409],
    ["OPPORTUNITY_NOT_TRACKABLE", 409],
    ["OPPORTUNITY_ARCHIVED", 409],
    ["APPLICATION_TRANSITION_NOT_ALLOWED", 409],
    ["APPLICATION_NOT_FOUND", 404],
    ["APPLICATION_ITEM_NOT_FOUND", 404],
    ["CONTACT_NOT_IN_APPLICATION", 400],
  ] as const)("maps %s to %i", async (code, status) => {
    const error = new ApplicationError(code, "Readable message", code === "APPLICATION_CHANGED" ? { entity: "note", id: uuid } : {});
    const response = await handlers(storeWith({ editNote: vi.fn().mockRejectedValue(error) })).command(
      post({ command: "editNote", noteId: uuid, expectedVersion: 1, body: "x" }),
      uuid,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, error: "Readable message" });
  });

  it("refuses a create that would plan an already-applied opportunity with a clear 409", async () => {
    const create = vi.fn().mockRejectedValue(new ApplicationError("APPLICATION_ALREADY_SUBMITTED", "Already applied"));
    const response = await handlers(storeWith({ create })).create(post({ mode: "plan" }), uuid);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "APPLICATION_ALREADY_SUBMITTED" });
    expect(create).toHaveBeenCalledWith(uuid, { mode: "plan" });
  });

  it("returns 400 without calling the store for invalid bodies, and never reaches an unversioned update", async () => {
    const store = storeWith({});
    const handler = handlers(store);
    for (const body of [
      { command: "changeStage", stage: "SCREENING" },
      { command: "addNote", body: "x", expectedVersion: 2 },
      { command: "launch" },
    ]) {
      const response = await handler.command(post(body), uuid);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect((await handler.create(post({ mode: "plan", appliedOn: "2026-10-01" }), uuid)).status).toBe(400);
    expect((await handler.command(new Request("http://localhost/x", { method: "POST", body: "{" }), uuid)).status).toBe(400);
    expect((await handler.command(post({ command: "reopen", expectedVersion: 1 }), "not-a-uuid")).status).toBe(404);
  });

  it("dispatches a valid command with its version and returns the application", async () => {
    const changeStage = vi.fn().mockResolvedValue({ id: uuid, stage: "SCREENING" });
    const response = await handlers(storeWith({ changeStage })).command(
      post({ command: "changeStage", expectedVersion: 3, stage: "SCREENING" }),
      uuid,
    );
    expect(response.status).toBe(200);
    expect(changeStage).toHaveBeenCalledWith(uuid, { command: "changeStage", expectedVersion: 3, stage: "SCREENING" });
  });

  it("does not leak unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handlers(storeWith({ addNote: vi.fn().mockRejectedValue(new Error("connect secret-host:5432")) })).command(
      post({ command: "addNote", body: "x" }),
      uuid,
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
    spy.mockRestore();
  });
});
