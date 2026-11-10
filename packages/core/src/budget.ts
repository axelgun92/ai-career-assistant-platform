import { z } from "zod";

// Domain-neutral budget rules: the budget period, how much of a reservation
// is still held, and whether a new evaluation may start. Spend itself always
// comes from persisted per-attempt costs; nothing here estimates provider
// cost or treats an unknown cost as zero.

export const budgetPeriodTypes = ["CALENDAR_MONTH"] as const;
export type BudgetPeriodType = (typeof budgetPeriodTypes)[number];

// Money is compared at the precision costs are persisted with.
export function roundMoney(value: number): number {
  return Number(value.toFixed(12));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

// Milliseconds the zone is ahead of UTC at the given instant.
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// The UTC instant of local midnight on the 1st of a month in the zone.
function zonedMonthStart(year: number, month: number, timeZone: string): Date {
  return zonedDateStart(year, month, 1, timeZone);
}

// The UTC instant of local midnight on a calendar date in the zone. Day and
// month overflow normalize (day 32 of January is February 1st).
function zonedDateStart(year: number, month: number, day: number, timeZone: string): Date {
  const wallClock = Date.UTC(year, month - 1, day);
  const firstGuess = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  // Re-check the offset at the result in case a DST change lies between.
  return new Date(wallClock - zoneOffsetMs(new Date(firstGuess), timeZone));
}

export interface BudgetPeriod {
  type: BudgetPeriodType;
  timeZone: string;
  // Calendar month the period covers, e.g. "2026-10".
  label: string;
  start: Date;
  // Exclusive: the instant the next period starts (the reset time).
  end: Date;
}

// Calendar month in the configured IANA time zone: [local 1st 00:00, next
// local 1st 00:00). Spend is always computed over this window, so the budget
// "resets" without any scheduled job.
export function budgetPeriod(now: Date, timeZone: string): BudgetPeriod {
  const { year, month } = zonedParts(now, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    type: "CALENDAR_MONTH" as const,
    timeZone,
    label: `${year}-${String(month).padStart(2, "0")}`,
    start: zonedMonthStart(year, month, timeZone),
    end: zonedMonthStart(nextYear, nextMonth, timeZone),
  };
}

export interface VolumeWindow {
  // Local calendar date the window starts on, e.g. "2026-10-12".
  label: string;
  start: Date;
  // Exclusive; the reset time.
  end: Date;
}

const isoDate = (instant: Date) => instant.toISOString().slice(0, 10);

// The local day and ISO week (Monday start) containing `now`, in the budget
// time zone. Volume limits count admissions inside these windows, so they
// reset without any scheduled job.
export function volumeWindows(now: Date, timeZone: string): { day: VolumeWindow; week: VolumeWindow } {
  const { year, month, day } = zonedParts(now, timeZone);
  const mondayOffset = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return {
    day: {
      label: isoDate(new Date(Date.UTC(year, month - 1, day))),
      start: zonedDateStart(year, month, day, timeZone),
      end: zonedDateStart(year, month, day + 1, timeZone),
    },
    week: {
      label: isoDate(new Date(Date.UTC(year, month - 1, day - mondayOffset))),
      start: zonedDateStart(year, month, day - mondayOffset, timeZone),
      end: zonedDateStart(year, month, day - mondayOffset + 7, timeZone),
    },
  };
}

export interface WarningState {
  // Share of the budget committed: known spend plus reserved holds. Null when
  // the budget amount is zero.
  usedPercent: number | null;
  // The highest configured threshold reached, if any.
  reached: number | null;
  thresholds: number[];
}

// Warnings are derived from configured thresholds only; with none
// configured there is never a warning.
export function warningState(input: {
  amount: number;
  knownSpent: number;
  held: number;
  thresholds: readonly number[];
}): WarningState {
  const thresholds = [...input.thresholds].sort((left, right) => left - right);
  const usedPercent = input.amount > 0 ? roundMoney(((input.knownSpent + input.held) / input.amount) * 100) : null;
  const reached = usedPercent === null
    ? null
    : thresholds.filter((threshold) => usedPercent >= threshold).at(-1) ?? null;
  return { usedPercent, reached, thresholds };
}

export type UsageLimit = "BUDGET" | "DAILY_EVALUATIONS" | "WEEKLY_EVALUATIONS" | "MONTHLY_OUTPUT_TOKENS";

export interface ThroughputUsage {
  dailyEvaluations: number;
  weeklyEvaluations: number;
  // Provider-reported output tokens in the budget period. Attempts that did
  // not report output tokens are not counted here and never treated as zero.
  outputTokens: number;
}

// Throughput limits reached for one more evaluation. A null limit is off.
export function throughputLimitsReached(
  limits: {
    dailyEvaluationLimit: number | null;
    weeklyEvaluationLimit: number | null;
    monthlyOutputTokenLimit: number | null;
  },
  usage: ThroughputUsage,
): UsageLimit[] {
  const reached: UsageLimit[] = [];
  if (limits.dailyEvaluationLimit !== null && usage.dailyEvaluations >= limits.dailyEvaluationLimit) {
    reached.push("DAILY_EVALUATIONS");
  }
  if (limits.weeklyEvaluationLimit !== null && usage.weeklyEvaluations >= limits.weeklyEvaluationLimit) {
    reached.push("WEEKLY_EVALUATIONS");
  }
  if (limits.monthlyOutputTokenLimit !== null && usage.outputTokens >= limits.monthlyOutputTokenLimit) {
    reached.push("MONTHLY_OUTPUT_TOKENS");
  }
  return reached;
}

export interface CapacityEstimate {
  // Average recorded cost of recent completed evaluations; null (Unknown)
  // without any such evaluation.
  averageEvaluationCost: number | null;
  basisEvaluations: number;
  // Evaluations the remaining budget can cover at that average.
  byBudget: number | null;
  // Evaluations the volume limits still allow today / this week.
  byDailyLimit: number | null;
  byWeeklyLimit: number | null;
  // The smallest of the known constraints; null when none is known.
  remaining: number | null;
  deferredBacklogCost: number | null;
  eligibleBacklogCost: number | null;
}

// Estimates, never guarantees: costs come from persisted attempts of recent
// evaluations, and anything that cannot be estimated stays null (Unknown).
export function capacityEstimate(input: {
  recentEvaluationCosts: readonly number[];
  remainingBudget: number | null;
  dailyEvaluationLimit: number | null;
  weeklyEvaluationLimit: number | null;
  usage: Pick<ThroughputUsage, "dailyEvaluations" | "weeklyEvaluations">;
  deferredCount: number;
  eligibleCount: number;
}): CapacityEstimate {
  const costs = input.recentEvaluationCosts;
  const average = costs.length ? roundMoney(costs.reduce((total, cost) => total + cost, 0) / costs.length) : null;
  const byBudget = average !== null && average > 0 && input.remainingBudget !== null
    ? Math.max(0, Math.floor(roundMoney(input.remainingBudget / average)))
    : null;
  const byDailyLimit = input.dailyEvaluationLimit === null
    ? null
    : Math.max(0, input.dailyEvaluationLimit - input.usage.dailyEvaluations);
  const byWeeklyLimit = input.weeklyEvaluationLimit === null
    ? null
    : Math.max(0, input.weeklyEvaluationLimit - input.usage.weeklyEvaluations);
  const known = [byBudget, byDailyLimit, byWeeklyLimit].filter((value): value is number => value !== null);
  // With a budget set but no cost basis, budget capacity is Unknown, so the
  // overall capacity is too (a volume limit alone could overstate it).
  const budgetUnknown = input.remainingBudget !== null && byBudget === null;
  return {
    averageEvaluationCost: average,
    basisEvaluations: costs.length,
    byBudget,
    byDailyLimit,
    byWeeklyLimit,
    remaining: budgetUnknown || !known.length ? null : Math.min(...known),
    deferredBacklogCost: average === null ? null : roundMoney(average * input.deferredCount),
    eligibleBacklogCost: average === null ? null : roundMoney(average * input.eligibleCount),
  };
}

// Why an evaluation was deferred. An operational queue state, never an
// evaluation result. AI_BUDGET_LIMIT (Core TDD v1.4) is the monthly AI
// dollar budget; USAGE_LIMIT_REACHED is any non-dollar limit (daily or weekly
// evaluations, monthly output tokens).
export const aiBudgetLimitReason = "AI_BUDGET_LIMIT";
export const usageLimitReachedReason = "USAGE_LIMIT_REACHED";
// Rows written before the TDD name was adopted. Never rewritten in place;
// read as AI_BUDGET_LIMIT.
export const legacyBudgetUnavailableReason = "BUDGET_UNAVAILABLE";

export function normalizeDeferralReason(code: string): string {
  return code === legacyBudgetUnavailableReason ? aiBudgetLimitReason : code;
}

export type AdmissionState = "LIVE" | "CONSUMED" | "ABANDONED";
export type EvaluationTaskState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface ReservationForHold {
  amount: number;
  admission: AdmissionState;
  // Status of the evaluation's task once the admission was consumed.
  taskStatus: EvaluationTaskState | null;
  // Known cost of the evaluation's attempts in the budget currency, across
  // every period.
  knownCost: number;
  // Attempts in the period being calculated whose cost is unknown in the
  // budget currency (no recorded cost, or priced in another currency).
  unknownAttemptsInPeriod: number;
}

export type HoldKind = "ACTIVE" | "UNKNOWN_IN_PERIOD" | "NOT_HELD";

export interface HoldState {
  kind: HoldKind;
  remaining: number;
}

// How much of a reservation still protects the budget in a period.
// - Active work (a live admission, or a queued/running evaluation) is held in
//   whichever period is current, regardless of when it was admitted.
// - A finished evaluation with unknown cost stays held in the period where
//   that unknown spend happened, never as $0.
// - A finished evaluation with every cost known holds nothing: its actual
//   cost is already counted as spend.
export function holdState(reservation: ReservationForHold): HoldState {
  const remaining = roundMoney(Math.max(0, reservation.amount - reservation.knownCost));
  if (reservation.admission === "ABANDONED") return { kind: "NOT_HELD", remaining: 0 };
  if (
    reservation.admission === "LIVE" ||
    reservation.taskStatus === "PENDING" ||
    reservation.taskStatus === "RUNNING"
  ) {
    return { kind: "ACTIVE", remaining };
  }
  if (reservation.unknownAttemptsInPeriod > 0) return { kind: "UNKNOWN_IN_PERIOD", remaining };
  return { kind: "NOT_HELD", remaining: 0 };
}

export interface BudgetDecision {
  allowed: boolean;
  available: number;
}

// Whether a new evaluation may start. `available` is the known remaining
// budget after holds; unknown cost never frees budget.
export function budgetDecision(input: {
  amount: number;
  knownSpent: number;
  held: number;
  reserve: number;
  enforced: boolean;
}): BudgetDecision {
  const available = roundMoney(input.amount - input.knownSpent - input.held);
  return {
    allowed: !input.enforced || available >= roundMoney(input.reserve),
    available,
  };
}

const money = z
  .number({ error: "Enter an amount" })
  .finite("Enter an amount")
  .nonnegative("The amount cannot be negative")
  .max(1_000_000_000, "The amount is too large");

const optionalLimit = z
  .number({ error: "Enter a whole number" })
  .int("Enter a whole number")
  .positive("The limit must be at least 1")
  .max(2_000_000_000, "The limit is too large")
  .nullable()
  .default(null);

export const budgetSettingsSchema = z
  .object({
    amount: money,
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as USD"),
    timeZone: z
      .string()
      .trim()
      .min(1, "Choose a time zone")
      .refine(isValidTimeZone, "Choose a valid time zone, such as UTC or America/New_York"),
    reservePerEvaluation: money,
    enforced: z.boolean(),
    periodType: z.enum(budgetPeriodTypes).default("CALENDAR_MONTH"),
    warningThresholds: z
      .array(
        z.number().int("Use whole percentages").min(1, "Use a percentage from 1 to 100").max(100, "Use a percentage from 1 to 100"),
      )
      .max(5, "Use at most five warning thresholds")
      .refine((values) => new Set(values).size === values.length, "Each warning threshold must be different")
      .transform((values) => [...values].sort((left, right) => left - right))
      .default([]),
    dailyEvaluationLimit: optionalLimit,
    weeklyEvaluationLimit: optionalLimit,
    monthlyOutputTokenLimit: optionalLimit,
    // Bounded by the platform (deployment maximum and the evaluator's minimum)
    // in the budget service, where those bounds are known.
    evaluationCallLimit: optionalLimit,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enforced && value.reservePerEvaluation <= 0) {
      context.addIssue({
        code: "custom",
        path: ["reservePerEvaluation"],
        message: "Set an amount to reserve for each evaluation while the budget is enforced",
      });
    }
    if (
      value.dailyEvaluationLimit !== null &&
      value.weeklyEvaluationLimit !== null &&
      value.weeklyEvaluationLimit < value.dailyEvaluationLimit
    ) {
      context.addIssue({
        code: "custom",
        path: ["weeklyEvaluationLimit"],
        message: "The weekly limit cannot be lower than the daily limit",
      });
    }
  });

export type BudgetSettingsInput = z.input<typeof budgetSettingsSchema>;
export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;
