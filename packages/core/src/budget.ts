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
  const wallClock = Date.UTC(year, month - 1, 1);
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
    type: "CALENDAR_MONTH",
    timeZone,
    label: `${year}-${String(month).padStart(2, "0")}`,
    start: zonedMonthStart(year, month, timeZone),
    end: zonedMonthStart(nextYear, nextMonth, timeZone),
  };
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
  });

export type BudgetSettingsInput = z.input<typeof budgetSettingsSchema>;
export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;
