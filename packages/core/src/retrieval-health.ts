// Source health and conservative retrieval (feature 12, Core TDD §51).
//
// Pure, deterministic rules over a source's run history. Nothing here makes
// a request or retries anything inside a run: after each run the worker
// records one gate, RetrievalSource.nextEligibleAt, and the scheduler and
// Run now respect it. Everything shown about a source's health (status,
// failure streak, last successful retrieval, freshness) is derived from its
// runs; only the gate and the source's own Retry-After are stored.

export type RetrievalRunStatusValue = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";

export interface HealthRun {
  status: RetrievalRunStatusValue;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  counts: { fetched: number } | null;
  // When the source asked us to wait until (Retry-After on a 429 or 503).
  retryAfterUntil: Date | null;
}

export const maxFailureBackoffMinutes = 7 * 24 * 60;
// Access refusals and contract changes rarely clear within one schedule
// interval, so they wait at least a day before the next attempt.
export const minimumAttentionBackoffMinutes = 24 * 60;

// Failures that come from the source, by how the next attempt is spaced.
const rateLimitedCodes = new Set(["RATE_LIMITED"]);
const transientCodes = new Set(["SERVER_ERROR", "NETWORK", "HTTP_STATUS"]);
const attentionCodes = new Set(["ACCESS_DENIED", "CONTRACT_MISMATCH", "CONFIG", "RESPONSE_TOO_LARGE"]);

export type FailureFamily = "rate_limited" | "transient" | "attention";

export function failureFamily(code: string | null | undefined): FailureFamily | null {
  if (!code) return null;
  if (rateLimitedCodes.has(code)) return "rate_limited";
  if (transientCodes.has(code)) return "transient";
  if (attentionCodes.has(code)) return "attention";
  return null;
}

// success: the source's retrieval completed (COMPLETED, or PARTIAL only
// because some listings could not be stored on our side).
// source_failure: the source refused, failed or changed, including a PARTIAL
// run stopped by one; it never counts as a successful retrieval.
// neutral: our side (internal errors, interrupted worker, disabled source,
// unavailable adapter, nothing stored at all): neither success nor a source
// failure, so it never moves health or backoff.
// active: queued or running.
export type RunOutcome = "success" | "source_failure" | "neutral" | "active";

export function classifyRunOutcome(run: Pick<HealthRun, "status" | "errorCode">): RunOutcome {
  if (run.status === "QUEUED" || run.status === "RUNNING") return "active";
  if (run.status === "COMPLETED") return "success";
  if (run.status === "PARTIAL" && run.errorCode === "LISTING_FAILURES") return "success";
  return failureFamily(run.errorCode) ? "source_failure" : "neutral";
}

// Consecutive source failures, newest first, until the last successful
// retrieval; neutral and active runs are skipped.
export function failureStreak(runsNewestFirst: readonly Pick<HealthRun, "status" | "errorCode">[]): number {
  let streak = 0;
  for (const run of runsNewestFirst) {
    const outcome = classifyRunOutcome(run);
    if (outcome === "success") break;
    if (outcome === "source_failure") streak += 1;
  }
  return streak;
}

const minutes = (value: number) => value * 60 * 1000;

function cappedDoubling(baseMinutes: number, streak: number): number {
  // 2^(streak-1) grows past the cap within a few steps; stop doubling there.
  let delay = baseMinutes;
  for (let step = 1; step < streak && delay < maxFailureBackoffMinutes; step += 1) delay *= 2;
  return Math.min(delay, maxFailureBackoffMinutes);
}

const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

// The gate after a run, from when it finished. streak counts this run.
// - success: no gate (the normal schedule applies);
// - neutral: the gate is left as it was;
// - rate limited: min(S·2^(n−1), 7 days);
// - transient (server error, network, other HTTP): the normal schedule the
//   first time, then min(S·2^(n−1), 7 days);
// - needs attention (access refused, contract or settings problem,
//   oversized response): min(max(S, 1 day)·2^(n−1), 7 days).
// A valid Retry-After the source sent is honoured in full, however long:
// the gate is the later of it and the computed backoff.
export function computeNextEligibleAt(input: {
  outcome: Pick<HealthRun, "status" | "errorCode">;
  streak: number;
  scheduleMinutes: number;
  finishedAt: Date;
  retryAfterUntil: Date | null;
  current: Date | null;
}): Date | null {
  const outcome = classifyRunOutcome(input.outcome);
  if (outcome === "success") return null;
  if (outcome !== "source_failure") return input.current;
  const family = failureFamily(input.outcome.errorCode)!;
  const streak = Math.max(1, input.streak);
  const schedule = Math.max(1, input.scheduleMinutes);
  let delay: number | null;
  if (family === "rate_limited") delay = cappedDoubling(schedule, streak);
  else if (family === "transient") delay = streak === 1 ? null : cappedDoubling(schedule, streak);
  else delay = cappedDoubling(Math.max(schedule, minimumAttentionBackoffMinutes), streak);
  const backoff = delay === null ? null : new Date(input.finishedAt.getTime() + minutes(delay));
  return later(backoff, input.retryAfterUntil);
}

// What an active gate is. A rate limit (429) and a wait the source asked for
// with Retry-After on another response (503) are both set by the source and
// can never be overridden or cleared by a settings change; backoff after
// other failures is ours and can be, once, with an explicit "Run now anyway",
// and a settings change clears it. When our backoff outlasts the source's
// Retry-After, the gate is a provider wait until that date and our backoff
// after it. The backoff after a 429 is itself rate-limit backoff.
export type GateKind = "rate_limited" | "provider_wait" | "backoff";

export function latestDecisiveRun<Run extends Pick<HealthRun, "status" | "errorCode">>(runsNewestFirst: readonly Run[]): Run | null {
  return runsNewestFirst.find((run) => {
    const outcome = classifyRunOutcome(run);
    return outcome === "success" || outcome === "source_failure";
  }) ?? null;
}

// The active gate, if any: its kind and until when that kind lasts (for a
// provider wait, the source's own date; the overall gate may run longer).
export function activeGate(input: {
  nextEligibleAt: Date | null;
  runsNewestFirst: readonly Pick<HealthRun, "status" | "errorCode" | "retryAfterUntil">[];
  now: Date;
}): { kind: GateKind; until: Date } | null {
  const gate = input.nextEligibleAt;
  if (!gate || gate <= input.now) return null;
  const latest = latestDecisiveRun(input.runsNewestFirst);
  if (latest?.errorCode === "RATE_LIMITED") return { kind: "rate_limited", until: gate };
  const wait = latest?.retryAfterUntil;
  if (wait && wait > input.now) return { kind: "provider_wait", until: wait < gate ? wait : gate };
  return { kind: "backoff", until: gate };
}

export function gateKind(input: Parameters<typeof activeGate>[0]): GateKind | null {
  return activeGate(input)?.kind ?? null;
}

export type SourceHealthStatus =
  | "archived"
  | "disabled"
  | "blocked"
  | "queued"
  | "running"
  | "not_run"
  | "rate_limited"
  | "provider_wait"
  | "needs_attention"
  | "failing"
  | "degraded"
  | "healthy";

export const sourceHealthLabels: Record<SourceHealthStatus, string> = {
  archived: "Archived",
  disabled: "Disabled",
  blocked: "Cannot run",
  queued: "Queued",
  running: "Running",
  not_run: "Not yet run",
  rate_limited: "Rate limited",
  provider_wait: "Waiting (requested by the source)",
  needs_attention: "Needs attention",
  failing: "Failing",
  degraded: "Degraded",
  healthy: "Healthy",
};

export interface SourceHealth {
  status: SourceHealthStatus;
  // Consecutive source failures since the last successful retrieval.
  streak: number;
  lastAttemptAt: Date | null;
  // The last run whose retrieval completed (COMPLETED, or PARTIAL only
  // because of listing failures on our side).
  lastSuccessAt: Date | null;
  lastFailure: { at: Date; code: string; message: string | null } | null;
  // The active gate; for a provider wait, until is the source's own date
  // (any backoff of ours after it is overridable).
  gate: { kind: GateKind; until: Date } | null;
  // When the next run can start (null when none is due: disabled, archived,
  // blocked, or a run is already queued or running).
  nextRunAt: Date | null;
  // An enabled source whose last successful retrieval is older than two
  // schedule intervals (it has missed at least one cycle).
  stale: boolean;
  // It has run but never retrieved successfully.
  neverSucceeded: boolean;
  // The last successful retrieval returned no listings at all (an empty
  // board, or a source that changed): informational, never a failure.
  emptyResult: boolean;
}

export function deriveSourceHealth(input: {
  enabled: boolean;
  archivedAt: Date | null;
  blockedReason: string | null;
  scheduleMinutes: number;
  lastRunAt: Date | null;
  nextEligibleAt: Date | null;
  // Recent runs, newest first (enough to cover the failure streak).
  runsNewestFirst: readonly HealthRun[];
  // The last successful retrieval, which may be older than those runs.
  lastSuccess: HealthRun | null;
  now: Date;
}): SourceHealth {
  const runs = input.runsNewestFirst;
  const active = runs.find((run) => classifyRunOutcome(run) === "active") ?? null;
  const decisive = latestDecisiveRun(runs);
  const streak = failureStreak(runs);
  const failure = runs.find((run) => run.finishedAt && run.errorCode && run.errorCode !== "SOURCE_DISABLED" && classifyRunOutcome(run) !== "success")
    ?? (decisive?.status === "PARTIAL" ? decisive : null);
  const gate = activeGate({ nextEligibleAt: input.nextEligibleAt, runsNewestFirst: runs, now: input.now });
  const lastSuccessAt = input.lastSuccess?.finishedAt ?? null;
  const scheduleMs = minutes(Math.max(1, input.scheduleMinutes));
  const running = input.enabled && !input.archivedAt && !input.blockedReason;
  const stale = running && lastSuccessAt !== null && input.now.getTime() - lastSuccessAt.getTime() > 2 * scheduleMs;
  const neverSucceeded = lastSuccessAt === null && runs.some((run) => classifyRunOutcome(run) === "source_failure");
  const emptyResult = input.lastSuccess?.counts?.fetched === 0;
  let nextRunAt: Date | null = null;
  if (running && !active) {
    const scheduled = input.lastRunAt ? new Date(input.lastRunAt.getTime() + scheduleMs) : input.now;
    nextRunAt = later(scheduled, gate ? input.nextEligibleAt : null);
  }

  let status: SourceHealthStatus;
  if (input.archivedAt) status = "archived";
  else if (!input.enabled) status = "disabled";
  else if (input.blockedReason) status = "blocked";
  else if (active) status = active.status === "RUNNING" ? "running" : "queued";
  else if (!decisive) status = "not_run";
  else if (gate?.kind === "rate_limited") status = "rate_limited";
  else if (gate?.kind === "provider_wait") status = "provider_wait";
  else if (classifyRunOutcome(decisive) === "source_failure") {
    status = failureFamily(decisive.errorCode) === "attention" ? "needs_attention" : streak >= 2 ? "failing" : "degraded";
  } else status = decisive.status === "COMPLETED" ? "healthy" : "degraded";

  return {
    status,
    streak,
    lastAttemptAt: input.lastRunAt,
    lastSuccessAt,
    lastFailure: failure?.finishedAt && failure.errorCode ? { at: failure.finishedAt, code: failure.errorCode, message: failure.errorMessage } : null,
    gate,
    nextRunAt,
    stale,
    neverSucceeded,
    emptyResult,
  };
}
