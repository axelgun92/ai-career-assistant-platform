import { isResumable, type ContinuousRunState, type ContinuousStatus } from "./continuous-capture";

// The side panel's view of a continuous capture (November 15, 2026), in the
// product's own words. Pure: the panel sets every line as text.

const badges: Record<ContinuousStatus, string> = {
  RUNNING: "Running",
  STOPPING: "Finishing",
  PAUSED: "Paused",
  STOPPED_BY_USER: "Stopped",
  STOPPED_NO_MORE_RESULTS: "Stopped: end not confirmed",
  STOPPED_UNCONFIRMED: "Stopped: end not confirmed",
  STOPPED_RESTRICTED: "Stopped: access restricted",
  FAILED: "Stopped: error",
  COMPLETED: "Completed",
};

const pauses: Record<string, string> = {
  TAB_CLOSED: "The search tab was closed.",
  TAB_NAVIGATED: "The search tab left this search.",
  BROWSER_RESTARTED: "Chrome restarted.",
  PERMISSION_MISSING: "The permission to read the site's pages was removed.",
};

export interface ContinuousView {
  badge: string;
  // Whether the run can be resumed now, and why not when it cannot yet.
  resumable: boolean;
  resumeNote: string | null;
  heading: string;
  activity: string | null;
  totals: string[];
  reason: string | null;
  buttons: { start: boolean; stop: boolean; resume: boolean; discard: boolean };
  diagnostics: string[];
}

export function continuousView(state: ContinuousRunState | null, now: number, offeredHere: boolean): ContinuousView | null {
  if (!state) {
    return offeredHere
      ? {
          badge: "",
          resumable: false,
          resumeNote: null,
          heading: "",
          activity: null,
          totals: [],
          reason: null,
          buttons: { start: true, stop: false, resume: false, discard: false },
          diagnostics: [],
        }
      : null;
  }
  const active = state.status === "RUNNING" || state.status === "STOPPING";
  const resumable = isResumable(state, now);
  const restrictedUntil = state.status === "STOPPED_RESTRICTED" && state.stoppedUntil && Date.parse(state.stoppedUntil) > now ? state.stoppedUntil : null;
  const buffered = state.buffer.length;
  const inFlight = state.inFlight ? state.inFlight.cards.length : 0;
  const totals = [
    `Batch ${state.batchNumber || 0}${state.inFlight ? " (in progress)" : ""}`,
    `Captured: ${state.totals.captured}`,
    `Skipped (captured before): ${state.totals.skipped}`,
    ...(state.totals.outsideTitles ? [`Skipped (outside target titles): ${state.totals.outsideTitles}`] : []),
    `Awaiting retrieval: ${state.totals.awaiting || (state.inFlight ? inFlight : 0)}`,
    `Failures: ${state.totals.failures}`,
    ...(state.totals.refreshed ? [`Read again: ${state.totals.refreshed}`] : []),
    `Discovered, not yet submitted: ${buffered}`,
  ];
  const reason =
    state.status === "PAUSED" ? (pauses[state.reason ?? ""] ?? state.reason) : state.status === "RUNNING" || state.status === "STOPPING" ? null : state.reason;
  return {
    badge: `${badges[state.status]}${resumable ? " · can be resumed" : ""}`,
    resumable,
    resumeNote: restrictedUntil ? `Resume is available after ${new Date(restrictedUntil).toLocaleString()}.` : null,
    heading: `${state.siteName}: ${state.pageTitle ?? state.searchUrl}${state.kind === "pages" && state.page ? ` (page ${state.page})` : ""}`,
    activity: active ? state.activity || "Working" : null,
    totals,
    reason,
    buttons: {
      start: !active && !resumable && offeredHere,
      stop: active,
      resume: resumable,
      // A run that can be resumed is discarded only on request, saying how
      // many discovered jobs were not submitted.
      discard: !active && (resumable || state.status === "COMPLETED"),
    },
    diagnostics: state.diagnostics.slice(-8).map((entry) => `${new Date(entry.at).toLocaleTimeString()} ${entry.event}${entry.detail ? `: ${entry.detail}` : ""}`),
  };
}

export function discardQuestion(state: ContinuousRunState): string {
  const pending = state.buffer.length + (state.inFlight && !state.inFlight.submitted ? state.inFlight.cards.length : 0);
  return pending
    ? `Discard this capture? ${pending} discovered job${pending === 1 ? " was" : "s were"} not submitted and will not be captured. Jobs already captured stay in AI Job Assistant.`
    : "Discard this capture? Jobs already captured stay in AI Job Assistant.";
}
