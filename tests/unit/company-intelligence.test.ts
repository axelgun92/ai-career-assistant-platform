// Feature 18: Company Intelligence pure rules (packages/core/src/company-intelligence.ts).
import { describe, expect, it } from "vitest";
import {
  applicationTimings,
  buildCompanyDetail,
  buildCompanyIndex,
  companyGroups,
  CompanyQueryError,
  parseCompanyIndexQuery,
  parseCompanyWindow,
  requisitionRelisted,
  roleListingState,
  roleSignals,
  type CiApplicationFact,
  type CiCompanyFact,
  type CiEvaluationFact,
  type CiFacts,
  type CiOpportunityFact,
  type CiRecordFact,
  type PostingHistoryListing,
} from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";

const terms = customerSuccessDiscoveryConfiguration.titleTerms;
const now = new Date("2026-11-01T12:00:00.000Z");
const ago = (days: number, hour = 12) => new Date(Date.UTC(2026, 10, 1 - days, hour));
const dayOf = (days: number) => new Date(Date.UTC(2026, 10, 1 - days));
const boardId = "11111111-1111-4111-8111-111111111111";
const acme = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const acmeLegacy = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const acmeUk = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const beta = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

let sequence = 0;
const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const company = (companyId: string, name: string, normalizedName: string | null, days: number): CiCompanyFact => ({ id: companyId, name, normalizedName, createdAt: ago(days) });
const companies = [
  company(acme, "Acme", "acme", 100),
  company(acmeLegacy, "ACME, Inc.", "acme", 50),
  company(acmeUk, "Acme UK Ltd", "acme uk", 40),
  company(beta, "Beta", "beta", 30),
];
const listing = (extra: Partial<PostingHistoryListing> = {}): PostingHistoryListing => ({
  sourceName: "Acme board",
  sourceCategory: "ATS",
  scheduleMinutes: 720,
  removalCapable: true,
  currentScope: true,
  state: "LISTED",
  firstSeenAt: ago(20),
  lastSeenAt: ago(0, 6),
  missingSince: null,
  removedAt: null,
  reappearedAt: null,
  reappearances: 0,
  sourceExpiresAt: null,
  ...extra,
});
const record = (extra: Partial<CiRecordFact> = {}): CiRecordFact => ({
  source: "greenhouse",
  sourceName: "Acme board",
  externalId: "gh-1",
  createdAt: ago(20),
  discoveredAt: ago(20),
  lastObservedAt: ago(1),
  retrieved: true,
  superseded: false,
  changed: false,
  matchedOn: [],
  ...extra,
});
const application = (stage: string, appliedOn: Date | null, extra: Partial<CiApplicationFact> = {}): CiApplicationFact => ({
  stage,
  outcome: null,
  appliedOn,
  closedOn: null,
  createdAt: appliedOn ?? ago(60),
  events: appliedOn ? [{ type: "SUBMITTED", toStage: "APPLIED", outcome: null, at: appliedOn, occurredOn: appliedOn, recordedAt: appliedOn }] : [],
  interviews: [],
  ...extra,
});
const stageChange = (toStage: string, recordedAt: Date) => ({ type: "STAGE_CHANGED", toStage, outcome: null, at: recordedAt, occurredOn: null, recordedAt });
const evaluation = (extra: Partial<CiEvaluationFact> = {}): CiEvaluationFact => ({
  id: `e-${++sequence}`,
  status: "COMPLETED",
  createdAt: ago(10),
  completedAt: ago(10),
  customerSegment: "SMB",
  customerType: "LIGHT_B2B",
  businessModel: "SAAS",
  ...extra,
});
const role = (extra: Partial<CiOpportunityFact> = {}): CiOpportunityFact => ({
  id: id(),
  companyId: acme,
  title: "Customer Success Manager",
  firstSeenAt: ago(20),
  lastSeenAt: ago(0, 6),
  postingDate: null,
  closingDate: null,
  salaryText: null,
  location: "Remote, US",
  remoteStatus: "REMOTE",
  workArrangements: ["REMOTE"],
  residencyRequirement: "US_REQUIRED",
  residencyRegions: ["US"],
  visaSponsorship: null,
  relocationSupport: null,
  employerOfRecordRegions: [],
  origin: { source: "greenhouse", sourceType: "ATS", retrievalSourceId: boardId, captureSite: null, externalId: "gh-1" },
  listings: [],
  records: [],
  evaluations: [],
  markedAppliedAt: null,
  application: null,
  ...extra,
});
const facts = (opportunities: CiOpportunityFact[], extra: Partial<CiFacts> = {}): CiFacts => ({
  companies,
  opportunities,
  probablePairs: [],
  sources: [{ id: boardId, name: "Acme board", adapterKey: "greenhouse", category: "ATS", enabled: true, archived: false }],
  withoutCompany: 0,
  ...extra,
});
const allTime = parseCompanyWindow({}, now);
const detail = (opportunities: CiOpportunityFact[], extra: Partial<CiFacts> = {}, companyId = acme, window = allTime) =>
  buildCompanyDetail({ facts: facts(opportunities, extra), titleTerms: terms, now, timeZone: "UTC", companyId, window })!;
const index = (opportunities: CiOpportunityFact[], query: Record<string, string> = {}, extra: Partial<CiFacts> = {}) =>
  buildCompanyIndex({ facts: facts(opportunities, extra), titleTerms: terms, now, timeZone: "UTC", query: parseCompanyIndexQuery(query, now, terms) });

describe("company identity", () => {
  it("groups rows sharing a normalized name under the oldest row and keeps other names apart", () => {
    const groups = companyGroups(companies);
    const acmeGroup = groups.find((group) => group.key === "acme")!;
    expect(acmeGroup).toMatchObject({ id: acme, name: "Acme", names: ["Acme", "ACME, Inc."], memberIds: [acme, acmeLegacy] });
    expect(groups.find((group) => group.key === "acme uk")!.memberIds).toEqual([acmeUk]);
  });

  it("keeps a row without a normalized name on its own", () => {
    const groups = companyGroups([...companies, company("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Acme", null, 10)]);
    expect(groups.filter((group) => group.name === "Acme")).toHaveLength(2);
  });

  it("resolves any member id to the group; an unknown id has no detail", () => {
    const one = role({ companyId: acmeLegacy });
    expect(detail([one], {}, acmeLegacy).company.id).toBe(acme);
    expect(detail([one], {}, acme).overview.observedRoles).toBe(1);
    expect(buildCompanyDetail({ facts: facts([one]), titleTerms: terms, now, timeZone: "UTC", companyId: id(), window: allTime })).toBeNull();
  });
});

describe("query parsing", () => {
  it("adds one year to Feature 17's windows and rejects 7 days", () => {
    expect(parseCompanyWindow({ window: "365d" }, now).from).toEqual(new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000));
    expect(parseCompanyWindow({}, now).key).toBe("all");
    expect(() => parseCompanyWindow({ window: "7d" }, now)).toThrow(CompanyQueryError);
    expect(() => parseCompanyWindow({ window: "custom", from: "2026-10-10", to: "2026-10-01" }, now)).toThrow(CompanyQueryError);
  });

  it("validates flags, sort, page, title group and arrangement", () => {
    expect(parseCompanyIndexQuery({ listed: "1", sort: "name", page: "2" }, now, terms)).toMatchObject({ sort: "name", page: 2, filters: { listed: true } });
    for (const bad of [{ listed: "yes" }, { sort: "best" }, { page: "0" }, { titleGroup: "Rocket scientist" }, { arrangement: "MOON" }]) {
      expect(() => parseCompanyIndexQuery(bad, now, terms)).toThrow(CompanyQueryError);
    }
  });
});

describe("roles and listings", () => {
  it("counts a role on several sources once", () => {
    const one = role({ records: [record(), record({ source: "remote-ok", sourceName: "Remote OK", externalId: "r-1", matchedOn: ["url"] })] });
    expect(detail([one]).overview.observedRoles).toBe(1);
    expect(index([one]).rows[0]!.observedRoles).toBe(1);
  });

  it("reuses Feature 13's listing state: listed, no longer listed, unknown", () => {
    expect(roleListingState(role({ listings: [listing()] }), now)).toBe("listed");
    expect(roleListingState(role({ listings: [listing({ state: "REMOVED", removedAt: ago(2), lastSeenAt: ago(5) })] }), now)).toBe("no_longer_listed");
    // A bounded source not seen recently, and a manual capture without a ledger.
    expect(roleListingState(role({ listings: [listing({ removalCapable: false, lastSeenAt: ago(9) })] }), now)).toBe("unknown");
    expect(roleListingState(role({ listings: [] }), now)).toBe("unknown");
  });

  it("measures observed listing duration only from confirmed removals; listed roles are a lower bound", () => {
    const removed = (days: number) => role({ listings: [listing({ state: "REMOVED", firstSeenAt: ago(days + 5), lastSeenAt: ago(6), removedAt: ago(5) })] });
    const view = detail([removed(10), removed(20), role({ listings: [listing({ firstSeenAt: ago(30) })] })]);
    expect(view.postings.duration.confirmed).toMatchObject({ n: 2, values: [10, 20], median: null, sample: "insufficient" });
    expect(view.postings.duration.stillListed[0]).toMatchObject({ atLeastDays: 30, sourceName: "Acme board" });
    const many = detail([4, 6, 8, 10, 12].map(removed));
    expect(many.postings.duration.confirmed).toMatchObject({ n: 5, values: [], median: 8, sample: "small" });
  });

  it("never combines one listing's first sighting with another listing's removal", () => {
    // Listing A (first seen 40 days ago) is still listed; listing B (first seen 12 days ago) was removed 2 days ago.
    const mixed = role({
      listings: [
        listing({ sourceName: "Board A", firstSeenAt: ago(40) }),
        listing({ sourceName: "Board B", state: "REMOVED", firstSeenAt: ago(12), lastSeenAt: ago(3), removedAt: ago(2) }),
      ],
    });
    const view = detail([mixed]);
    // Only B's own 10 days are a confirmed duration; A is a lower bound of 40 days, not part of the median.
    expect(view.postings.duration.confirmed).toMatchObject({ n: 1, values: [10] });
    expect(view.postings.duration.stillListed).toEqual([{ opportunityId: mixed.id, title: mixed.title, sourceName: "Board A", atLeastDays: 40 }]);
  });

  it("counts observed postings per local month and changed postings", () => {
    const view = detail([
      role({ firstSeenAt: new Date("2026-09-30T23:30:00.000Z") }),
      role({ firstSeenAt: ago(5), records: [record({ changed: true })] }),
    ]);
    expect(view.postings.months).toEqual([
      { month: "2026-09", roles: 1 },
      { month: "2026-10", roles: 1 },
    ]);
    expect(view.postings.changedRoles).toBe(1);
    const tokyo = buildCompanyDetail({ facts: facts([role({ firstSeenAt: new Date("2026-09-30T23:30:00.000Z") })]), titleTerms: terms, now, timeZone: "Asia/Tokyo", companyId: acme, window: allTime })!;
    expect(tokyo.postings.months).toEqual([{ month: "2026-10", roles: 1 }]);
  });

  it("discloses unresolved probable duplicates inside the company without subtracting them", () => {
    const a = role();
    const b = role();
    const other = role({ companyId: beta });
    const view = detail([a, b, other], { probablePairs: [[a.id, b.id], [b.id, a.id], [a.id, other.id]] });
    expect(view.postings.probableDuplicatePairs).toBe(1);
    expect(view.overview.observedRoles).toBe(2);
  });
});

describe("reposts versus recurring roles", () => {
  it("reads Feature 13 repost facts per role", () => {
    const relisted = role({ listings: [listing({ reappearedAt: ago(3), reappearances: 2, removedAt: ago(10) })] });
    const signals = roleSignals(relisted, now);
    expect(signals).toMatchObject({ removalTracked: true, listedAgain: true, reappearances: 2, requisitionRelisted: false });
    const view = detail([relisted, role()]);
    expect(view.signals).toMatchObject({ removalTracked: 1, listedAgain: 1, reappearances: 2 });
    expect(view.signals.relistings[0]).toMatchObject({ days: 7, reappearances: 2 });
    // Two roles in one title group are a recurring group, not a repost.
    expect(view.recurring.recurringGroups).toBe(1);
  });

  it("detects a new-listing-ID relisting with the same requisition from stored MATCH evidence only", () => {
    const same = role({ records: [record({ externalId: "gh-1" }), record({ externalId: "gh-2", createdAt: ago(5), matchedOn: ["requisitionId", "company"] })] });
    expect(requisitionRelisted(same)).toBe(true);
    // Another source matching on the requisition is a cross-source duplicate, not a relisting.
    expect(requisitionRelisted(role({ records: [record(), record({ source: "lever", externalId: "lv-1", createdAt: ago(5), matchedOn: ["requisitionId"] })] }))).toBe(false);
    // A URL match on a new ID is not requisition evidence.
    expect(requisitionRelisted(role({ records: [record(), record({ externalId: "gh-2", createdAt: ago(5), matchedOn: ["url"] })] }))).toBe(false);
    // The index column is Feature 13 only: a same-requisition relisting does not count there…
    expect(index([same]).rows[0]!.listedAgain).toBe(0);
    // …and stays its own detail signal.
    expect(detail([same]).signals).toMatchObject({ requisitionRelisted: 1, listedAgain: 0 });
  });

  it("counts only Feature 13 reappearance in 'listed again after removal', once per role", () => {
    const reappeared = role({ listings: [listing({ reappearedAt: ago(3), reappearances: 1, removedAt: ago(10) })] });
    const both = role({
      listings: [listing({ reappearedAt: ago(2), reappearances: 2, removedAt: ago(8) })],
      records: [record({ externalId: "gh-1" }), record({ externalId: "gh-9", createdAt: ago(5), matchedOn: ["requisitionId"] })],
    });
    const requisitionOnly = role({ records: [record({ externalId: "gh-1" }), record({ externalId: "gh-7", createdAt: ago(5), matchedOn: ["requisitionId"] })] });
    expect(index([reappeared]).rows[0]!.listedAgain).toBe(1);
    expect(index([requisitionOnly]).rows[0]!.listedAgain).toBe(0);
    expect(index([both]).rows[0]!.listedAgain).toBe(1);
    expect(index([reappeared, both, requisitionOnly]).rows[0]!.listedAgain).toBe(2);
    expect(detail([reappeared, both, requisitionOnly]).signals).toMatchObject({ listedAgain: 2, requisitionRelisted: 2, reappearances: 3 });
    // The broad signals filter still accepts a same-requisition relisting alone.
    expect(index([requisitionOnly], { signals: "1" }).rows).toHaveLength(1);
  });

  it("treats closed-on-board-but-seen-elsewhere and long-unchanged content as separate facts", () => {
    const elsewhere = role({
      listings: [
        listing({ state: "REMOVED", removedAt: ago(5), lastSeenAt: ago(6) }),
        listing({ sourceName: "Aggregator", sourceCategory: "AGGREGATOR", removalCapable: false, lastSeenAt: ago(0, 6) }),
      ],
      records: [record({ discoveredAt: ago(60), lastObservedAt: ago(1) })],
    });
    expect(roleSignals(elsewhere, now)).toMatchObject({ closedElsewhere: true, unchanged: true, listedAgain: false });
  });

  it("never calls Other title recurring and lists exact titles by most frequent written form", () => {
    const view = detail([
      role({ title: "Customer Success Manager" }),
      role({ title: "customer  success manager" }),
      role({ title: "Customer Success Manager" }),
      role({ title: "Accountant" }),
      role({ title: "Bookkeeper" }),
    ]);
    const csm = view.recurring.groups.find((group) => group.recurring)!;
    expect(csm.titles).toEqual([{ title: "Customer Success Manager", count: 3 }]);
    expect(view.recurring.groups.find((group) => group.key === "OTHER")).toMatchObject({ roles: 2, recurring: false });
  });
});

describe("work arrangement and hiring regions", () => {
  it("shows arrangement and hiring geography as separate distributions with Unknown", () => {
    const view = detail([
      role(),
      role({ remoteStatus: "HYBRID", workArrangements: ["HYBRID"], residencyRequirement: null, residencyRegions: ["GB"], location: "London" }),
      role({ remoteStatus: null, workArrangements: [], residencyRequirement: null, residencyRegions: [], location: null, visaSponsorship: "AVAILABLE", employerOfRecordRegions: ["ES", "PT"] }),
    ]);
    expect(view.arrangement.arrangement.rows.map((row) => [row.key, row.count])).toEqual([["REMOTE", 1], ["HYBRID", 1], ["UNKNOWN", 1]]);
    expect(view.arrangement).toMatchObject({ remote: 1, arrangementKnown: 2 });
    expect(view.arrangement.hiringRegions.rows.map((row) => row.key)).toEqual(["UNITED_STATES", "UNITED_KINGDOM", "UNKNOWN"]);
    expect(view.arrangement.visaSponsorship).toEqual({ AVAILABLE: 1, NOT_AVAILABLE: 0, UNKNOWN: 2 });
    expect(view.arrangement.employerOfRecordRegions).toEqual([{ code: "ES", roles: 1 }, { code: "PT", roles: 1 }]);
  });
});

describe("your history with the company", () => {
  it("reuses Feature 17 outcomes: awaiting response is not a non-response, and NO_RESPONSE is not 'nothing recorded'", () => {
    const view = detail([
      role({ application: application("APPLIED", dayOf(29)) }),
      role({ application: application("APPLIED", dayOf(30)) }),
      role({ application: application("CLOSED", dayOf(60), { outcome: "NO_RESPONSE", closedOn: dayOf(20) }) }),
      role({ application: application("INTERVIEWING", dayOf(40), { events: [stageChange("SCREENING", ago(35)), stageChange("INTERVIEWING", ago(30))] }) }),
      role({ application: application("CLOSED", dayOf(50), { outcome: "OFFER_ACCEPTED", closedOn: dayOf(10), events: [stageChange("OFFER", ago(15))] }) }),
    ]);
    expect(view.history).toMatchObject({
      applications: 5,
      awaitingResponse: 1,
      matureNothingRecorded: 1,
      inProcess: 1,
      recruiterScreens: 1,
      offers: 1,
      closed: { NO_RESPONSE: 1, OFFER_ACCEPTED: 1 },
    });
    // Offers ÷ resolved: the interviewing application is excluded.
    expect(view.history.offerRate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(view.history.interviewRate).toMatchObject({ numerator: 2, denominator: 4 });
  });

  it("times the process in whole days from the tracker's dates and excludes inconsistent ones", () => {
    const applied = dayOf(30);
    const timings = applicationTimings(
      role({
        application: application("CLOSED", applied, {
          outcome: "REJECTED",
          closedOn: dayOf(2),
          events: [stageChange("SCREENING", ago(21, 9)), { type: "CLOSED", toStage: "CLOSED", outcome: "REJECTED", at: dayOf(2), occurredOn: dayOf(2), recordedAt: ago(1) }],
          interviews: [
            { status: "COMPLETED", kind: "RECRUITER_SCREEN", at: ago(18), scheduledAt: ago(18), recordedAt: ago(25) },
            { status: "CANCELLED", kind: "PANEL", at: ago(29), scheduledAt: ago(29), recordedAt: ago(29) },
          ],
        }),
      }),
      applied,
      "UTC",
    );
    expect(timings).toEqual({ progress: 5, interview: 12, closed: 28, offer: null });
    const backwards = detail([role({ application: application("SCREENING", dayOf(10), { events: [stageChange("SCREENING", ago(12))] }) })]);
    expect(backwards.history.timings.progress).toMatchObject({ n: 0, inconsistent: 1 });
  });

  it("shows individual values below 5 and a median from 5", () => {
    const screened = (days: number) => role({ application: application("SCREENING", dayOf(40), { events: [stageChange("SCREENING", ago(40 - days))] }) });
    expect(detail([screened(3), screened(9)]).history.timings.progress).toMatchObject({ n: 2, values: [3, 9], median: null, sample: "insufficient" });
    expect(detail([1, 2, 3, 4, 10].map(screened)).history.timings.progress).toMatchObject({ n: 5, values: [], median: 3, sample: "small" });
  });

  it("windows applications by their application date and roles by first seen", () => {
    const older = role({ firstSeenAt: ago(200), application: application("APPLIED", dayOf(150)) });
    const recent = role({ firstSeenAt: ago(10) });
    const window = parseCompanyWindow({ window: "90d" }, now);
    const view = detail([older, recent], {}, acme, window);
    expect(view.overview.observedRoles).toBe(1);
    expect(view.history.applications).toBe(0);
    expect(detail([older, recent], {}, acme, parseCompanyWindow({ window: "365d" }, now)).history.applications).toBe(1);
  });
});

describe("company type", () => {
  it("counts each role's latest completed evaluation, never averaged, with coverage", () => {
    const view = detail([
      role({ evaluations: [evaluation({ customerSegment: "ENTERPRISE", completedAt: ago(20) }), evaluation({ customerSegment: "SMB", completedAt: ago(5) })] }),
      role({ evaluations: [evaluation({ customerSegment: null }), evaluation({ status: "FAILED", completedAt: null })] }),
      role(),
    ]);
    expect(view.overview.companyType).toMatchObject({ evaluatedRoles: 2, roles: 3 });
    expect(view.overview.companyType.customerSegment.rows.map((row) => [row.key, row.count])).toEqual([["SMB", 1], ["UNKNOWN", 1]]);
  });
});

describe("company index", () => {
  it("needs a role first observed in the window: an application alone does not add a company", () => {
    // Role first seen 6 months ago, applied 10 days ago: not in the 30-day index…
    const old = role({ firstSeenAt: ago(180), application: application("APPLIED", dayOf(10)) });
    expect(index([old], { window: "30d" }).rows).toEqual([]);
    expect(index([old], { window: "30d", applied: "1" }).rows).toEqual([]);
    // …but its company page still opens, with no observed role and the application counted by its own date.
    const view = detail([old], {}, acme, parseCompanyWindow({ window: "30d" }, now));
    expect(view.overview).toMatchObject({ observedRoles: 0, applications: 1 });
    // A company with a role in the window counts applications to its older roles by application date.
    const recent = role({ firstSeenAt: ago(5) });
    expect(index([old, recent], { window: "30d" }).rows[0]).toMatchObject({ observedRoles: 1, applications: 1 });
  });

  it("lists companies with roles observed in the window, sorted by observed roles, without scores", () => {
    const result = index([role(), role(), role({ companyId: acmeLegacy }), role({ companyId: beta, title: "Account Manager" }), role({ companyId: acmeUk, firstSeenAt: ago(400) })], { window: "365d" });
    expect(result.rows.map((row) => [row.name, row.observedRoles])).toEqual([["Acme", 3], ["Beta", 1]]);
    expect(result.rows[0]!.otherNames).toEqual(["ACME, Inc."]);
    for (const row of result.rows) {
      expect(Object.keys(row).some((key) => /score|rank|rating|hire|quality|ghost/i.test(key))).toBe(false);
    }
  });

  it("filters by name, listing, applications, signals, title group and arrangement", () => {
    const opportunities = [
      role({ listings: [listing()] }),
      role({ companyId: beta, listings: [], remoteStatus: "ONSITE", workArrangements: ["ONSITE"], application: application("APPLIED", dayOf(3)) }),
    ];
    expect(index(opportunities, { q: "acm" }).rows.map((row) => row.name)).toEqual(["Acme"]);
    expect(index(opportunities, { q: "ACME, inc" }).rows.map((row) => row.name)).toEqual(["Acme"]);
    expect(index(opportunities, { listed: "1" }).rows.map((row) => row.name)).toEqual(["Acme"]);
    expect(index(opportunities, { applied: "1" }).rows.map((row) => row.name)).toEqual(["Beta"]);
    expect(index(opportunities, { signals: "1" }).rows).toEqual([]);
    expect(index(opportunities, { arrangement: "ONSITE" }).rows.map((row) => row.name)).toEqual(["Beta"]);
    expect(index(opportunities, { titleGroup: "OTHER" }).rows).toEqual([]);
  });

  it("sorts by name, applications and recent activity, and pages by 50", () => {
    const opportunities = [role({ companyId: beta, application: application("APPLIED", dayOf(1)) }), role(), role()];
    expect(index(opportunities, { sort: "name" }).rows.map((row) => row.name)).toEqual(["Acme", "Beta"]);
    expect(index(opportunities, { sort: "applications" }).rows[0]!.name).toBe("Beta");
    const many: CiCompanyFact[] = Array.from({ length: 51 }, (_, n) => company(`dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`, `Company ${n}`, `company ${n}`, 5));
    const paged = index(many.map((entry) => role({ companyId: entry.id })), { page: "2" }, { companies: many });
    expect(paged).toMatchObject({ total: 51, pageCount: 2, page: 2 });
    expect(paged.rows).toHaveLength(1);
  });

  it("reports opportunities without a company as a count only", () => {
    expect(index([role()], {}, { withoutCompany: 4 }).withoutCompany).toBe(4);
  });
});
