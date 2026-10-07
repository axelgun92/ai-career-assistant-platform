import { describe, expect, it } from "vitest";
import { applicationOutcomeSchema, applicationStageSchema } from "@ai-career/core";
import {
  applicationCanonicalRedirect,
  applicationOutcomeOptions,
  applicationStageOptions,
  applicationsHref,
  clearApplicationFilters,
  hasApplicationFilters,
  parseApplicationQuery,
  serializeApplicationQuery,
  toApplicationListFilters,
  withApplicationChanges,
} from "../../apps/web/src/server/application-query";

const parse = (search: string) => parseApplicationQuery(new URLSearchParams(search));

describe("/applications query", () => {
  it("defaults to active applications ordered by next action", () => {
    expect(parse("")).toEqual({
      view: "active", q: "", stage: [], outcome: [], followUp: null, from: null, to: null, sort: "next-action", page: 1,
    });
    expect(applicationsHref(parse(""))).toBe("/applications");
  });

  it("parses every parameter, dropping invalid values", () => {
    expect(parse("view=closed&q=Acme%20%20CSM&stage=offer&stage=APPLIED&stage=bogus&outcome=rejected,nope&followUp=due&from=2026-09-01&to=2026-09-30&sort=company&page=2"))
      .toEqual({
        view: "closed", q: "acme csm", stage: ["applied", "offer"], outcome: ["rejected"], followUp: "due",
        from: "2026-09-01", to: "2026-09-30", sort: "company", page: 2,
      });
    expect(parse("view=everything&followUp=soon&sort=salary&page=-1&from=2026-02-30")).toMatchObject({
      view: "active", followUp: null, sort: "next-action", page: 1, from: null,
    });
    expect(parse("from=2026-10-31&to=2026-10-01")).toMatchObject({ from: null, to: null });
  });

  it("serializes canonically and round-trips", () => {
    const search = "view=all&q=acme&stage=applied&stage=offer&followUp=overdue&sort=updated&page=3";
    expect(serializeApplicationQuery(parse(search))).toBe(search);
    expect(parse(serializeApplicationQuery(parse(search)))).toEqual(parse(search));
    expect(withApplicationChanges(parse(search), { followUp: null }).page).toBe(1);
    expect(serializeApplicationQuery(clearApplicationFilters(parse(search)))).toBe("view=all&sort=updated");
    expect(hasApplicationFilters(parse("followUp=due"))).toBe(true);
    expect(hasApplicationFilters(parse("view=closed&sort=company"))).toBe(false);
  });

  it("redirects to the canonical URL and the clamped page", () => {
    const messy = new URLSearchParams("stage=bogus&followUp=due&page=9");
    expect(applicationCanonicalRedirect(messy, parseApplicationQuery(messy), 1)).toBe("/applications?followUp=due");
    const canonical = new URLSearchParams("followUp=due");
    expect(applicationCanonicalRedirect(canonical, parseApplicationQuery(canonical), 1)).toBeNull();
  });

  it("maps to stored values that match the core enums exactly", () => {
    expect(new Set(Object.values(applicationStageOptions))).toEqual(new Set(applicationStageSchema.options));
    expect(new Set(Object.values(applicationOutcomeOptions))).toEqual(new Set(applicationOutcomeSchema.options));
    expect(toApplicationListFilters(parse("view=all&stage=final-round&outcome=no-response&q=Acme&from=2026-09-01"))).toEqual({
      view: "all",
      stages: ["FINAL_ROUND"],
      outcomes: ["NO_RESPONSE"],
      followUp: null,
      searchTerms: ["acme"],
      appliedFrom: "2026-09-01",
      appliedTo: null,
    });
  });
});
