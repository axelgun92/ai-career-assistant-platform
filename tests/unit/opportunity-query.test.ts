import { describe, expect, it } from "vitest";
import {
  customerSegmentClassificationSchema,
  opportunityPriorityBandSchema,
  roleClassificationSchema,
} from "@ai-career/customer-success";
import { escapeLikePattern } from "@ai-career/database";
import {
  canonicalRedirect,
  clampPage,
  clearFilters,
  hasActiveFilters,
  normalizeSearch,
  opportunityHref,
  parseOpportunityQuery,
  priorityOptions,
  roleFamilyOptions,
  segmentOptions,
  serializeOpportunityQuery,
  sourceTypeOptions,
  toListFilters,
  withChanges,
} from "../../apps/web/src/server/opportunity-query";

const parse = (search: string) => parseOpportunityQuery(new URLSearchParams(search));
const companyId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";

describe("query parsing", () => {
  it("defaults to the active view, newest first, page 1, 25 per page, no filters", () => {
    expect(parse("")).toEqual({
      view: "active", q: "", rec: [], eval: [], priority: [], role: [], segment: [], sourceType: [],
      source: null, company: null, domain: null, title: null, location: null, salary: null, from: null, to: null,
      sort: "newest", page: 1, pageSize: 25,
    });
  });

  it("parses every parameter, including repeated and comma-separated multi values", () => {
    const query = parse(
      `view=archived&q=Acme%20CSM&rec=review&rec=apply&eval=deferred,none&priority=very-high&role=core-cs` +
        `&segment=not-evaluated&sourceType=manual&source=manual-input&company=${companyId}&domain=customer-success` +
        `&title=manager&location=remote&salary=stated&from=2026-09-01&to=2026-10-31&sort=priority&page=3&pageSize=10`,
    );
    expect(query).toMatchObject({
      view: "archived",
      q: "acme csm",
      rec: ["apply", "review"], // canonical option order
      eval: ["none", "deferred"],
      priority: ["very-high"],
      role: ["core-cs"],
      segment: ["not-evaluated"],
      sourceType: ["manual"],
      source: "manual-input",
      company: companyId,
      domain: "customer-success",
      title: "manager",
      location: "remote",
      salary: "stated",
      from: "2026-09-01",
      to: "2026-10-31",
      sort: "priority",
      page: 3,
      pageSize: 10,
    });
  });

  it.each([
    ["unknown view", "view=everything", { view: "active" }],
    ["unknown sort", "sort=salary", { sort: "newest" }],
    ["unknown enum values", "rec=maybe&eval=done&priority=extreme", { rec: [], eval: [], priority: [] }],
    ["bad company id", "company=not-a-uuid", { company: null }],
    ["impossible date", "from=2026-02-30", { from: null }],
    ["malformed date", "to=yesterday", { to: null }],
    ["reversed range drops both", "from=2026-10-31&to=2026-09-01", { from: null, to: null }],
    ["bad salary value", "salary=lots", { salary: null }],
    ["page zero or junk", "page=0", { page: 1 }],
    ["negative page", "page=-4", { page: 1 }],
    ["oversized page size", "pageSize=1000", { pageSize: 25 }],
    ["blank text", "title=%20%20&source=", { title: null, source: null }],
  ])("drops %s safely", (_name, search, expected) => {
    expect(() => parse(search)).not.toThrow();
    expect(parse(search)).toMatchObject(expected);
  });

  it("keeps the first value of a repeated single-value parameter and ignores unknown parameters", () => {
    expect(parse("sort=title&sort=company&unexpected=1")).toMatchObject({ sort: "title" });
  });

  it("accepts the Next.js searchParams object shape", () => {
    expect(parseOpportunityQuery({ rec: ["apply", "skip"], q: "  Acme  " })).toMatchObject({ rec: ["apply", "skip"], q: "acme" });
  });
});

describe("search normalization", () => {
  it("lowercases, trims, collapses whitespace, and splits into AND terms", () => {
    expect(normalizeSearch("  Customer   SUCCESS\tManager ")).toEqual({
      text: "customer success manager",
      terms: ["customer", "success", "manager"],
    });
  });

  it("is empty for missing or whitespace-only input", () => {
    expect(normalizeSearch(undefined)).toEqual({ text: "", terms: [] });
    expect(normalizeSearch("   ")).toEqual({ text: "", terms: [] });
  });

  it("caps the number and length of terms", () => {
    const many = Array.from({ length: 12 }, (_, index) => `t${index}`).join(" ");
    expect(normalizeSearch(many).terms).toHaveLength(8);
    expect(normalizeSearch("x".repeat(120)).terms[0]).toHaveLength(80);
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLikePattern("100%_off\\now")).toBe("100\\%\\_off\\\\now");
  });
});

describe("canonical serialization", () => {
  it("omits defaults and round-trips", () => {
    expect(serializeOpportunityQuery(parse(""))).toBe("");
    expect(opportunityHref(parse(""))).toBe("/");
    const search = `view=all&q=acme&rec=apply&rec=review&company=${companyId}&sort=title&page=2`;
    const query = parse(search);
    expect(parse(serializeOpportunityQuery(query))).toEqual(query);
    expect(serializeOpportunityQuery(query)).toBe(search);
  });

  it("normalizes order and spelling to one canonical form", () => {
    expect(serializeOpportunityQuery(parse("rec=REVIEW&rec=apply&sort=TITLE"))).toBe("rec=apply&rec=review&sort=title");
  });

  it("any change of filter, search, sort, or view returns to page 1; clearing keeps the view and sort", () => {
    const query = parse("view=saved&rec=apply&sort=company&page=4");
    expect(withChanges(query, { rec: [] }).page).toBe(1);
    expect(withChanges(query, { page: 3 }).page).toBe(3);
    const cleared = clearFilters(query);
    expect(serializeOpportunityQuery(cleared)).toBe("view=saved&sort=company");
    expect(hasActiveFilters(cleared)).toBe(false);
    expect(hasActiveFilters(query)).toBe(true);
  });
});

describe("pagination clamping and the canonical redirect", () => {
  it.each([
    [99, 63, 25, 3],
    [3, 75, 25, 3],
    [4, 75, 25, 3],
    [2, 0, 25, 1],
    [1, 0, 25, 1],
    [0, 63, 25, 1],
    [Number.NaN, 63, 25, 1],
    [2, 26, 25, 2],
  ])("clampPage(%s, %s, %s) → %s", (requested, total, pageSize, expected) => {
    expect(clampPage(requested, total, pageSize)).toBe(expected);
  });

  it("redirects a clamped page to the canonical URL, and page 1 to no page parameter", () => {
    const params = new URLSearchParams("rec=apply&page=99");
    expect(canonicalRedirect(params, parseOpportunityQuery(params), 3)).toBe("/?rec=apply&page=3");
    const empty = new URLSearchParams("q=nothing&page=5");
    expect(canonicalRedirect(empty, parseOpportunityQuery(empty), 1)).toBe("/?q=nothing");
  });

  it("redirects away from invalid or empty parameters, and not at all when already canonical", () => {
    const messy = new URLSearchParams("title=&sort=&rec=bogus&company=");
    expect(canonicalRedirect(messy, parseOpportunityQuery(messy), 1)).toBe("/");
    const canonical = new URLSearchParams("rec=apply&page=2");
    expect(canonicalRedirect(canonical, parseOpportunityQuery(canonical), 2)).toBeNull();
    expect(canonicalRedirect({}, parseOpportunityQuery({}), 1)).toBeNull();
  });
});

describe("repository filter mapping", () => {
  it("maps URL values to stored contract values and inclusive UTC dates", () => {
    const filters = toListFilters(
      parse("view=triage&q=Acme&rec=none&eval=deferred&priority=unknown&role=core-cs&segment=mid-market&sourceType=manual&salary=not-stated&from=2026-10-01&to=2026-10-31"),
    );
    expect(filters).toMatchObject({
      statuses: ["NORMALIZED", "EVALUATED", "RECOMMENDED"],
      searchTerms: ["acme"],
      recommendations: ["NONE"],
      evaluationStates: ["DEFERRED"],
      priorityBands: ["UNKNOWN"],
      roleFamilies: ["CORE_CS"],
      segments: ["MID_MARKET"],
      sourceTypes: ["MANUAL"],
      salaryStated: false,
    });
    expect(filters.discoveredFrom?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(filters.discoveredBefore?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(toListFilters(parse("view=all")).statuses).toBeUndefined();
  });

  it("offers exactly the persisted Customer Success contract values", () => {
    const stored = (map: Record<string, string>, extra: string) => Object.values(map).filter((value) => value !== extra);
    expect(new Set(stored(priorityOptions, "UNKNOWN"))).toEqual(new Set(opportunityPriorityBandSchema.options));
    expect(new Set(stored(roleFamilyOptions, "UNKNOWN"))).toEqual(new Set(roleClassificationSchema.options));
    expect(new Set(stored(segmentOptions, "NOT_EVALUATED"))).toEqual(new Set(customerSegmentClassificationSchema.options));
    expect(Object.values(sourceTypeOptions)).toEqual(
      ["MANUAL", "BROWSER_EXTENSION", "PUBLIC_SEARCH", "ATS", "API", "COMPANY_WATCHLIST", "OTHER"],
    );
  });
});
