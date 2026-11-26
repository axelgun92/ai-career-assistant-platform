// Task 8 completion pass: date rules, actionable applications, refusal
// messages, follow-up updates, view normalization, and HTTP mapping.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applicationCommandSchema,
  applicationDatesRefusal,
  isActionableApplication,
  opportunityLifecycleStateSchema,
  toIsoDate,
  trackingRefusalMessage,
  utcToday,
} from "@ai-career/core";
import { ApplicationError, PrismaApplicationRepository } from "@ai-career/database";
import { createApplicationApiHandlers, type ApplicationStore } from "../../apps/web/src/server/application-service";
import {
  createOpportunityActionHandler,
  getOpportunityActionWriter,
} from "../../apps/web/src/server/opportunity-action-service";
import {
  applicationCanonicalRedirect,
  parseApplicationQuery,
  toApplicationListFilters,
} from "../../apps/web/src/server/application-query";

const uuid = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const parse = (search: string) => parseApplicationQuery(new URLSearchParams(search));

describe("application calendar dates", () => {
  const today = "2026-10-15";

  it("refuses future applied and closed dates with no day of tolerance", () => {
    expect(applicationDatesRefusal({ appliedOn: today, closedOn: null }, today)).toBeNull();
    expect(applicationDatesRefusal({ appliedOn: "2026-10-16", closedOn: null }, today)).toContain("applied date cannot be in the future");
    expect(applicationDatesRefusal({ appliedOn: "2026-10-01", closedOn: today }, today)).toBeNull();
    expect(applicationDatesRefusal({ appliedOn: "2026-10-01", closedOn: "2026-10-16" }, today)).toContain("closed date cannot be in the future");
    expect(applicationDatesRefusal({ appliedOn: null, closedOn: "2026-10-16" }, today)).toContain("closed date cannot be in the future");
  });

  it("refuses a closed date before the applied date and allows the same day", () => {
    expect(applicationDatesRefusal({ appliedOn: "2026-10-10", closedOn: "2026-10-09" }, today)).toContain("earlier than the applied date");
    expect(applicationDatesRefusal({ appliedOn: "2026-10-10", closedOn: "2026-10-10" }, today)).toBeNull();
    // A never-submitted plan has no applied date to order against.
    expect(applicationDatesRefusal({ appliedOn: null, closedOn: "2026-10-01" }, today)).toBeNull();
  });

  it("compares across month and year boundaries as calendar dates", () => {
    expect(applicationDatesRefusal({ appliedOn: "2026-12-31", closedOn: "2027-01-01" }, "2027-01-01")).toBeNull();
    expect(applicationDatesRefusal({ appliedOn: "2027-01-01", closedOn: null }, "2026-12-31")).not.toBeNull();
  });

  describe("whatever the process time zone", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"])(
      "keeps a stored date-only value as the same calendar date in %s",
      (zone) => {
        process.env.TZ = zone;
        // The database round trip: an ISO date is stored as UTC midnight and
        // read back with toIsoDate.
        for (const date of ["2026-10-15", "2026-01-01", "2026-12-31", "2028-02-29"]) {
          expect(toIsoDate(new Date(`${date}T00:00:00.000Z`))).toBe(date);
        }
        // "Today" is the UTC calendar date of the instant.
        expect(utcToday(new Date("2026-10-15T23:30:00.000-08:00"))).toBe("2026-10-16");
        expect(utcToday(new Date("2026-10-16T00:30:00.000+10:00"))).toBe("2026-10-15");
      },
    );
  });
});

describe("actionable applications", () => {
  it("are open and not archived", () => {
    expect(isActionableApplication("APPLIED", "APPLIED")).toBe(true);
    expect(isActionableApplication("PLANNED", "SAVED")).toBe(true);
    expect(isActionableApplication("CLOSED", "APPLIED")).toBe(false);
    expect(isActionableApplication("INTERVIEWING", "ARCHIVED")).toBe(false);
    expect(isActionableApplication("CLOSED", "ARCHIVED")).toBe(false);
  });
});

describe("tracking refusal messages", () => {
  it("name what the user can do for each lifecycle state", () => {
    expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", "REJECTED_BY_USER")).toContain("dismissed. Restore it");
    expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", "ARCHIVED")).toContain("archived. Restore it");
    expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", "CLOSED")).toContain("posting is closed");
    expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", "CLOSED")).not.toContain("Restore");
    expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", "DISCOVERED")).toContain("not been processed");
    expect(trackingRefusalMessage("APPLICATION_ALREADY_SUBMITTED", "APPLIED")).toContain("tracked as a submitted application");
    expect(trackingRefusalMessage("APPLICATION_ALREADY_SUBMITTED", "APPLIED", "reopen")).toContain("cannot be reopened");
    expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", "REJECTED_BY_USER", "reopen")).toContain("before reopening this plan");
    for (const status of opportunityLifecycleStateSchema.options) {
      expect(trackingRefusalMessage("OPPORTUNITY_NOT_TRACKABLE", status).length).toBeGreaterThan(10);
    }
  });
});

describe("updateFollowUp command", () => {
  const base = { command: "updateFollowUp", followUpId: uuid, expectedVersion: 2, description: "Email Dana", dueOn: "2026-10-20" };

  it("is versioned and validates the description and date", () => {
    expect(applicationCommandSchema.safeParse(base).success).toBe(true);
    const { expectedVersion: _version, ...unversioned } = base;
    expect(applicationCommandSchema.safeParse(unversioned).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ ...base, dueOn: "2026-02-30" }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ ...base, description: "  " }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ ...base, completedAt: "2026-10-01" }).success).toBe(false);
    expect(applicationCommandSchema.safeParse({ ...base, followUpId: "nope" }).success).toBe(false);
  });

  it("is dispatched with its version", async () => {
    const updateFollowUp = vi.fn().mockResolvedValue({ id: uuid });
    const store = new Proxy({ updateFollowUp } as unknown as ApplicationStore, {
      get: (target, key: string) => (key in target ? target[key as keyof ApplicationStore] : () => { throw new Error("unexpected"); }),
    });
    const handlers = createApplicationApiHandlers({ store, lister: { listPage: vi.fn() } });
    const response = await handlers.command(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(base) }), uuid);
    expect(response.status).toBe(200);
    expect(updateFollowUp).toHaveBeenCalledWith(uuid, { ...base, description: "Email Dana" });
  });

  it("maps an invalid application date to 400 with its message", async () => {
    const submit = vi.fn().mockRejectedValue(new ApplicationError("APPLICATION_DATE_INVALID", "The applied date cannot be in the future"));
    const store = { submit } as unknown as ApplicationStore;
    const handlers = createApplicationApiHandlers({ store, lister: { listPage: vi.fn() } });
    const response = await handlers.command(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ command: "submit", expectedVersion: 1, appliedOn: "2099-01-01" }) }),
      uuid,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "APPLICATION_DATE_INVALID", error: "The applied date cannot be in the future" });
  });
});

describe("/applications view normalization", () => {
  it("widens Active to All when an outcome or the Closed stage is chosen", () => {
    expect(parse("outcome=rejected").view).toBe("all");
    expect(parse("stage=closed").view).toBe("all");
    expect(parse("stage=applied&stage=closed").view).toBe("all");
    expect(toApplicationListFilters(parse("outcome=withdrawn"))).toMatchObject({ view: "all", outcomes: ["WITHDRAWN"] });
  });

  it("keeps explicit and compatible views", () => {
    expect(parse("stage=applied").view).toBe("active");
    expect(parse("followUp=overdue").view).toBe("active");
    expect(parse("view=closed&outcome=rejected").view).toBe("closed");
    expect(parse("view=all&outcome=rejected").view).toBe("all");
  });

  it("redirects to the canonical widened URL", () => {
    const params = new URLSearchParams("outcome=rejected");
    expect(applicationCanonicalRedirect(params, parseApplicationQuery(params), 1)).toBe("/applications?view=all&outcome=rejected");
    const canonical = new URLSearchParams("view=all&outcome=rejected");
    expect(applicationCanonicalRedirect(canonical, parseApplicationQuery(canonical), 1)).toBeNull();
  });
});

describe("guarded lifecycle actions over HTTP", () => {
  it("maps an action the application blocks to 409 APPLICATION_BLOCKS_ACTION with its reason", async () => {
    const applyUserAction = vi.fn().mockResolvedValue({
      status: "BLOCKED_BY_APPLICATION",
      reason: "Close the application first, for example as 'Decided not to apply'",
    });
    const response = await createOpportunityActionHandler({ applyUserAction })(
      new Request("http://localhost/action", { method: "POST", body: '{"action":"DISMISS"}' }),
      uuid,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Close the application first, for example as 'Decided not to apply'",
      code: "APPLICATION_BLOCKS_ACTION",
    });
    expect(applyUserAction).toHaveBeenCalledWith({ opportunityId: uuid, action: "DISMISS" });
  });

  it("the route's writer runs every action through the application guard", async () => {
    // The repository is never queried here; the dummy address only satisfies
    // client construction, which does not connect.
    vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:9/unused");
    const guarded = vi
      .spyOn(PrismaApplicationRepository.prototype, "applyLifecycleActionGuarded")
      .mockResolvedValue({ status: "BLOCKED_BY_APPLICATION", reason: "blocked" });
    try {
      const result = await getOpportunityActionWriter().applyUserAction({ opportunityId: uuid, action: "RESTORE" });
      expect(result).toEqual({ status: "BLOCKED_BY_APPLICATION", reason: "blocked" });
      expect(guarded).toHaveBeenCalledWith({ opportunityId: uuid, action: "RESTORE" });
    } finally {
      guarded.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
