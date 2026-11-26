// The Possible Duplicates review (November 25, 2026): connected groups, each
// pair listed once, stable from wherever a group is opened; the page's URL
// state; the plain-words comparison of a group's listings.
import { describe, expect, it } from "vitest";
import { buildDuplicateGroups, type DuplicateEdge, type DuplicateReviewMember } from "@ai-career/database";
import { compareDescriptions, differingFields, parseDuplicateReviewQuery } from "../../apps/web/src/server/duplicate-review";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let serial = 0;
function edge(from: number, to: number, state: DuplicateEdge["state"] = "UNRESOLVED", day = 1): DuplicateEdge {
  serial += 1;
  return {
    id: id(1000 + serial), opportunityId: id(from), relatedOpportunityId: id(to), decision: "PROBABLE_MATCH", confidence: 0.7,
    matchedOn: ["company", "title"], conflicts: [], state, createdAt: new Date(Date.UTC(2026, 10, day)),
  };
}

describe("grouping stored relationships", () => {
  it("joins linked listings into one group and lists every pair once", () => {
    const groups = buildDuplicateGroups([edge(2, 1), edge(3, 2), edge(3, 1, "DISTINCT"), edge(5, 4, "SAME_JOB", 3)]);
    expect(groups).toHaveLength(2);
    const [newest, older] = groups;
    expect(newest!.memberIds).toEqual([id(4), id(5)]);
    expect(newest!.unresolved).toBe(0);
    expect(older!.memberIds).toEqual([id(1), id(2), id(3)]);
    expect(older!.edges).toHaveLength(3);
    expect(older!.unresolved).toBe(2);
  });

  it("gives the same group whichever order the relationships come in", () => {
    const edges = [edge(2, 1), edge(3, 2), edge(9, 3), edge(7, 8)];
    const forward = buildDuplicateGroups(edges);
    const backward = buildDuplicateGroups([...edges].reverse());
    expect(backward).toEqual(forward);
    expect(forward.map((group) => group.memberIds.length).sort()).toEqual([2, 4]);
  });

  it("handles thousands of relationships without loading anything else", () => {
    const many: DuplicateEdge[] = [];
    for (let n = 1; n < 6000; n += 2) many.push(edge(n + 1, n));
    const groups = buildDuplicateGroups(many);
    expect(groups).toHaveLength(3000);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3000);
  });
});

describe("the review page", () => {
  it("defaults to the groups waiting for a decision and keeps a valid page", () => {
    expect(parseDuplicateReviewQuery({})).toEqual({ filter: "open", page: 1, group: null });
    expect(parseDuplicateReviewQuery({ show: "decided", page: "3" })).toEqual({ filter: "decided", page: 3, group: null });
    expect(parseDuplicateReviewQuery({ show: "bogus", page: "-2" })).toEqual({ filter: "open", page: 1, group: null });
    expect(parseDuplicateReviewQuery({ group: id(5).toUpperCase() }).group).toBe(id(5));
    expect(parseDuplicateReviewQuery({ group: "not-an-id" }).group).toBeNull();
  });

  const member = (overrides: Partial<DuplicateReviewMember>): DuplicateReviewMember => ({
    id: id(1), title: "Customer Success Manager", companyName: "Acme", location: "Remote - United States", workArrangements: ["REMOTE"],
    salaryMin: null, salaryMax: null, currency: null, source: "linkedin", originalSource: null, sourceType: "BROWSER_ASSISTED",
    canonicalUrl: null, applicationUrl: null, externalListingId: null, atsRequisitionId: null,
    description: "Own onboarding and renewals for mid-market customers across North America. Run quarterly business reviews with every account.",
    status: "NORMALIZED", triageOutcome: "EVALUATE", hasApplication: false, firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  });

  it("names the fields that differ and the sentences only one listing has", () => {
    const first = member({});
    const second = member({ id: id(2), location: "Chicago, IL", description: `${first.description} You will also lead the partner enablement programme this year.` });
    expect([...differingFields([first, second])]).toEqual(["location"]);
    const comparison = compareDescriptions(second, first);
    expect(comparison.onlyHere).toEqual(["You will also lead the partner enablement programme this year."]);
    expect(comparison.similarity).toBeGreaterThan(0.5);
    expect(compareDescriptions(first, first)).toEqual({ similarity: null, onlyHere: [], onlyHereCount: 0 });
  });
});
