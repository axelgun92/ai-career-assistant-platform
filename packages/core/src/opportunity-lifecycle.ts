import { z } from "zod";
import {
  isNormalizedLifecycleState,
  type OpportunityLifecycleState,
} from "./opportunity";

// Domain-neutral Opportunity lifecycle rules. System states follow persisted
// evaluations; user states change only through explicit user actions.

export const systemLifecycleStates = [
  "NORMALIZED",
  "EVALUATED",
  "RECOMMENDED",
] as const satisfies readonly OpportunityLifecycleState[];

export const userLifecycleStates = [
  "SAVED",
  "APPLIED",
  "REJECTED_BY_USER",
  "ARCHIVED",
] as const satisfies readonly OpportunityLifecycleState[];

export type SystemLifecycleState = (typeof systemLifecycleStates)[number];

export function isSystemLifecycleState(
  status: OpportunityLifecycleState,
): status is SystemLifecycleState {
  return (systemLifecycleStates as readonly string[]).includes(status);
}

export const opportunityUserActionSchema = z.enum([
  "SAVE",
  "MARK_APPLIED",
  "DISMISS",
  "ARCHIVE",
  "RESTORE",
  // Move to Active (November 22, 2026): back to the system state the
  // opportunity's evaluations give.
  "REACTIVATE",
]);
export type OpportunityUserAction = z.infer<typeof opportunityUserActionSchema>;

type ForwardAction = Exclude<OpportunityUserAction, "RESTORE" | "REACTIVATE">;

const forwardTransitions: Record<
  ForwardAction,
  { from: readonly OpportunityLifecycleState[]; to: OpportunityLifecycleState }
> = {
  // November 22, 2026 (Move to): a dismissed or archived opportunity can be
  // saved, and an archived one dismissed, directly.
  SAVE: { from: [...systemLifecycleStates, "REJECTED_BY_USER", "ARCHIVED"], to: "SAVED" },
  MARK_APPLIED: { from: [...systemLifecycleStates, "SAVED"], to: "APPLIED" },
  DISMISS: { from: [...systemLifecycleStates, "SAVED", "ARCHIVED"], to: "REJECTED_BY_USER" },
  ARCHIVE: {
    from: [...systemLifecycleStates, "SAVED", "APPLIED", "REJECTED_BY_USER", "CLOSED"],
    to: "ARCHIVED",
  },
};

const restorableStates: readonly OpportunityLifecycleState[] = userLifecycleStates;

// The system state an Opportunity should hold given its persisted evaluations.
// A completed evaluation with a recommendation wins over one without, and a
// later failed evaluation never downgrades it.
export function systemLifecycleState(evaluations: {
  hasCompletedEvaluation: boolean;
  hasRecommendation: boolean;
}): SystemLifecycleState {
  if (evaluations.hasRecommendation) return "RECOMMENDED";
  if (evaluations.hasCompletedEvaluation) return "EVALUATED";
  return "NORMALIZED";
}

// Product rule for *requesting* an evaluation. Core separately guarantees only
// that the Opportunity has been normalized.
export function canRequestEvaluation(status: OpportunityLifecycleState): boolean {
  return isNormalizedLifecycleState(status) && status !== "ARCHIVED" && status !== "CLOSED";
}

export interface UserActionHistoryEntry {
  action: OpportunityUserAction;
  fromStatus: OpportunityLifecycleState;
  toStatus: OpportunityLifecycleState;
}

export type UserActionResolution =
  | { allowed: true; to: OpportunityLifecycleState }
  | { allowed: false; reason: string };

// RESTORE is an undo stack over the action history: every non-RESTORE action
// pushes, every RESTORE pops. The entry left on top is the newest action that
// has not been undone, i.e. the one that put the Opportunity into its current
// restorable state. RESTORE rows are never targets, so restores cannot bounce.
export function pendingUserActions<Entry extends UserActionHistoryEntry>(
  history: readonly Entry[],
): Entry[] {
  const stack: Entry[] = [];
  for (const entry of history) {
    if (entry.action === "RESTORE") stack.pop();
    else stack.push(entry);
  }
  return stack;
}

export function restoreTarget(input: {
  history: readonly UserActionHistoryEntry[];
  currentStatus: OpportunityLifecycleState;
  currentSystemState: SystemLifecycleState;
}): UserActionResolution {
  if (!restorableStates.includes(input.currentStatus)) {
    return { allowed: false, reason: "Only a saved, applied, dismissed, or archived opportunity can be restored" };
  }
  const top = pendingUserActions(input.history).at(-1);
  if (!top || top.toStatus !== input.currentStatus) {
    return { allowed: false, reason: "The action history does not identify a state to restore" };
  }
  // System targets are re-derived so evaluations completed in the meantime
  // are reflected instead of a stale stored state.
  return {
    allowed: true,
    to: isSystemLifecycleState(top.fromStatus) ? input.currentSystemState : top.fromStatus,
  };
}

export function resolveUserAction(input: {
  action: OpportunityUserAction;
  currentStatus: OpportunityLifecycleState;
  history: readonly UserActionHistoryEntry[];
  currentSystemState: SystemLifecycleState;
}): UserActionResolution {
  if (input.action === "RESTORE") return restoreTarget(input);
  if (input.action === "REACTIVATE") {
    return (userLifecycleStates as readonly string[]).includes(input.currentStatus)
      ? { allowed: true, to: input.currentSystemState }
      : { allowed: false, reason: `REACTIVATE is not allowed from ${input.currentStatus}` };
  }
  const transition = forwardTransitions[input.action];
  return transition.from.includes(input.currentStatus)
    ? { allowed: true, to: transition.to }
    : { allowed: false, reason: `${input.action} is not allowed from ${input.currentStatus}` };
}

// Actions the user can take right now, using the same resolution as the API.
export function availableUserActions(input: {
  currentStatus: OpportunityLifecycleState;
  history: readonly UserActionHistoryEntry[];
  currentSystemState: SystemLifecycleState;
}): OpportunityUserAction[] {
  return opportunityUserActionSchema.options.filter(
    (action) => resolveUserAction({ ...input, action }).allowed,
  );
}

// ---- Move to (November 22, 2026) -------------------------------------------
// The destinations of the dashboard's and the opportunity page's Move to.
// Pre-Evaluation Review and All are views, never destinations; Applied is
// recorded through the Application Tracker, never by moving a card, so a
// move never creates application data. Each destination is one ordinary
// user action, recorded in the action history like any other.
export const opportunityMoveDestinationSchema = z.enum(["ACTIVE", "SAVED", "DISMISSED", "ARCHIVED", "RESTORE"]);
export type OpportunityMoveDestination = z.infer<typeof opportunityMoveDestinationSchema>;

export const opportunityMoveDestinationActions: Record<Exclude<OpportunityMoveDestination, "RESTORE">, OpportunityUserAction> = {
  ACTIVE: "REACTIVATE",
  SAVED: "SAVE",
  DISMISSED: "DISMISS",
  ARCHIVED: "ARCHIVE",
};

// The destinations offered for an opportunity in this state. RESTORE (back
// to the state before it was dismissed or archived, or Active when the
// history does not say) is offered for Dismissed and Archived. A submitted
// application keeps an Applied or archived-after-applying opportunity out of
// Active and Saved, and an active application keeps it out of Dismissed
// (lifecycleActionGuard decides the same on the server).
// Whether an opportunity in this state is already where the destination
// would put it (November 25, 2026): a move there is a no-op, reported as
// skipped, never as a failure. Restore has nothing to do for a job that is
// neither dismissed nor archived.
export function moveDestinationReached(status: OpportunityLifecycleState, destination: OpportunityMoveDestination): boolean {
  switch (destination) {
    case "DISMISSED":
      return status === "REJECTED_BY_USER";
    case "SAVED":
      return status === "SAVED";
    case "ARCHIVED":
      return status === "ARCHIVED";
    case "ACTIVE":
      return status === "NORMALIZED" || status === "EVALUATED" || status === "RECOMMENDED";
    case "RESTORE":
      return status === "NORMALIZED" || status === "EVALUATED" || status === "RECOMMENDED" || status === "SAVED";
  }
}

export function opportunityMoveOptions(input: {
  status: OpportunityLifecycleState;
  application: { submitted: boolean; active: boolean } | null;
}): OpportunityMoveDestination[] {
  const submitted = input.application?.submitted === true;
  const active = input.application?.active === true;
  switch (input.status) {
    case "NORMALIZED":
    case "EVALUATED":
    case "RECOMMENDED":
      return ["SAVED", ...(active ? [] : (["DISMISSED"] as const)), "ARCHIVED"];
    case "SAVED":
      return ["ACTIVE", ...(active ? [] : (["DISMISSED"] as const)), "ARCHIVED"];
    case "APPLIED":
      return [...(submitted ? [] : (["ACTIVE"] as const)), "ARCHIVED"];
    case "REJECTED_BY_USER":
      return ["RESTORE", "ACTIVE", "SAVED", "ARCHIVED"];
    case "ARCHIVED":
      return ["RESTORE", ...(submitted ? [] : (["ACTIVE", "SAVED"] as const)), ...(active ? [] : (["DISMISSED"] as const))];
    case "CLOSED":
      return ["ARCHIVED"];
    default:
      return [];
  }
}
