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
]);
export type OpportunityUserAction = z.infer<typeof opportunityUserActionSchema>;

type ForwardAction = Exclude<OpportunityUserAction, "RESTORE">;

const forwardTransitions: Record<
  ForwardAction,
  { from: readonly OpportunityLifecycleState[]; to: OpportunityLifecycleState }
> = {
  SAVE: { from: systemLifecycleStates, to: "SAVED" },
  MARK_APPLIED: { from: [...systemLifecycleStates, "SAVED"], to: "APPLIED" },
  DISMISS: { from: [...systemLifecycleStates, "SAVED"], to: "REJECTED_BY_USER" },
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
