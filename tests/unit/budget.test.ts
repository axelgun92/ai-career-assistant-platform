import { describe, expect, it } from "vitest";
import {
  budgetDecision,
  budgetPeriod,
  budgetSettingsSchema,
  holdState,
  type ReservationForHold,
} from "@ai-career/core";

describe("budget period (calendar month in a time zone)", () => {
  it("uses UTC month boundaries", () => {
    const period = budgetPeriod(new Date("2026-10-15T12:00:00Z"), "UTC");
    expect(period).toMatchObject({ label: "2026-10", type: "CALENDAR_MONTH" });
    expect(period.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("rolls over the year", () => {
    const period = budgetPeriod(new Date("2026-12-31T23:59:59Z"), "UTC");
    expect(period.label).toBe("2026-12");
    expect(period.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(budgetPeriod(new Date("2027-01-01T00:00:00Z"), "UTC").label).toBe("2027-01");
  });

  it("follows local midnight across DST in America/New_York", () => {
    // 1 Nov 2026 local midnight is still EDT (UTC-4); DST ends that day.
    const october = budgetPeriod(new Date("2026-10-20T12:00:00Z"), "America/New_York");
    expect(october.start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(october.end.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // 1 Dec is EST (UTC-5).
    const november = budgetPeriod(new Date("2026-11-20T12:00:00Z"), "America/New_York");
    expect(november.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(november.end.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    // 1 Apr follows the March DST start (EDT again).
    const march = budgetPeriod(new Date("2027-03-20T12:00:00Z"), "America/New_York");
    expect(march.start.toISOString()).toBe("2027-03-01T05:00:00.000Z");
    expect(march.end.toISOString()).toBe("2027-04-01T04:00:00.000Z");
  });

  it("puts an instant in the local month, not the UTC month (Asia/Tokyo)", () => {
    // 31 Oct 16:00 UTC is already 1 Nov 01:00 in Tokyo.
    const period = budgetPeriod(new Date("2026-10-31T16:00:00Z"), "Asia/Tokyo");
    expect(period.label).toBe("2026-11");
    expect(period.start.toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-30T15:00:00.000Z");
  });

  it("is half-open: the reset instant belongs to the next period", () => {
    const period = budgetPeriod(new Date("2026-10-31T23:59:59.999Z"), "UTC");
    expect(budgetPeriod(period.end, "UTC").label).toBe("2026-11");
  });
});

const reservation = (overrides: Partial<ReservationForHold>): ReservationForHold => ({
  amount: 0.6,
  admission: "CONSUMED",
  taskStatus: "COMPLETED",
  knownCost: 0,
  unknownAttemptsInPeriod: 0,
  ...overrides,
});

describe("hold state", () => {
  it("holds the full reserve for a live admission and the remainder while running", () => {
    expect(holdState(reservation({ admission: "LIVE", taskStatus: null }))).toEqual({ kind: "ACTIVE", remaining: 0.6 });
    expect(holdState(reservation({ taskStatus: "PENDING" }))).toEqual({ kind: "ACTIVE", remaining: 0.6 });
    expect(holdState(reservation({ taskStatus: "RUNNING", knownCost: 0.25 }))).toEqual({ kind: "ACTIVE", remaining: 0.35 });
    expect(holdState(reservation({ taskStatus: "RUNNING", knownCost: 0.9 }))).toEqual({ kind: "ACTIVE", remaining: 0 });
  });

  it("releases a finished evaluation whose costs are all known", () => {
    expect(holdState(reservation({ taskStatus: "COMPLETED", knownCost: 0.04 }))).toEqual({ kind: "NOT_HELD", remaining: 0 });
    expect(holdState(reservation({ taskStatus: "FAILED", knownCost: 0 }))).toEqual({ kind: "NOT_HELD", remaining: 0 });
  });

  it("keeps holding a finished evaluation with unknown cost in that period, never as $0", () => {
    expect(holdState(reservation({ knownCost: 0.07, unknownAttemptsInPeriod: 1 }))).toEqual({
      kind: "UNKNOWN_IN_PERIOD",
      remaining: 0.53,
    });
  });

  it("never holds an abandoned admission", () => {
    expect(holdState(reservation({ admission: "ABANDONED", taskStatus: null }))).toEqual({ kind: "NOT_HELD", remaining: 0 });
  });
});

describe("budget decision", () => {
  it("allows when the known remaining budget covers the reserve, inclusive", () => {
    expect(budgetDecision({ amount: 1, knownSpent: 0.2, held: 0.2, reserve: 0.6, enforced: true })).toEqual({
      allowed: true,
      available: 0.6,
    });
    expect(budgetDecision({ amount: 1, knownSpent: 0.2, held: 0.21, reserve: 0.6, enforced: true }).allowed).toBe(false);
  });

  it("handles floating-point sums without spurious deferral", () => {
    expect(budgetDecision({ amount: 0.3, knownSpent: 0.1, held: 0.1, reserve: 0.1, enforced: true }).allowed).toBe(true);
  });

  it("always allows when enforcement is off, and still reports what is available", () => {
    expect(budgetDecision({ amount: 1, knownSpent: 2, held: 0, reserve: 0.6, enforced: false })).toEqual({
      allowed: true,
      available: -1,
    });
  });
});

describe("budget settings validation", () => {
  const valid = { amount: 5, currency: "USD", timeZone: "America/New_York", reservePerEvaluation: 0.5, enforced: true };

  it("accepts valid settings and defaults the period type", () => {
    expect(budgetSettingsSchema.parse(valid)).toEqual({ ...valid, periodType: "CALENDAR_MONTH" });
  });

  it.each([
    [{ amount: -1 }, "amount"],
    [{ currency: "usd" }, "currency"],
    [{ currency: "DOLLARS" }, "currency"],
    [{ timeZone: "Mars/Olympus" }, "timeZone"],
    [{ reservePerEvaluation: 0 }, "reservePerEvaluation"],
  ])("rejects %o at %s", (patch, path) => {
    const result = budgetSettingsSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(path);
  });

  it("allows a zero reserve while enforcement is off, and rejects unknown keys", () => {
    expect(budgetSettingsSchema.safeParse({ ...valid, enforced: false, reservePerEvaluation: 0 }).success).toBe(true);
    expect(budgetSettingsSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});
