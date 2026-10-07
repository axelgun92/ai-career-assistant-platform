import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDatabaseClient,
  PrismaOpportunityDashboardRepository,
  PrismaOpportunityListRepository,
  type DashboardSummary,
  type OpportunityListSort,
} from "@ai-career/database";
import {
  parseOpportunityQuery,
  toListFilters,
} from "../../apps/web/src/server/opportunity-query";

// Seeded, deterministic dashboard data. Every query is scoped by a unique
// run token in the search text, so other rows in the database never affect
// results; summary counts are asserted as deltas over a baseline.

const database = getDatabaseClient();
const repository = new PrismaOpportunityListRepository();
const dashboard = new PrismaOpportunityDashboardRepository();
const token = `dq${randomUUID().slice(0, 8)}`;
const opportunityIds: string[] = [];
const companyIds: Record<string, string> = {};
let baseline: DashboardSummary;
const ids: Record<string, string> = {};

type Seed = {
  key: string;
  title: string | null;
  company?: string;
  location?: string | null;
  salaryText?: string | null;
  source?: string;
  sourceType?: "MANUAL" | "ATS" | "PUBLIC_SEARCH";
  domain?: string;
  status?: string;
  discoveredAt: string;
  evaluations?: Array<{
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    decision?: "APPLY" | "REVIEW" | "SKIP";
    band?: string;
    role?: string;
    segment?: string;
    at: string;
  }>;
  deferred?: boolean;
};

async function company(name: string) {
  companyIds[name] ??= (await database.company.create({ data: { name: `${name} ${token}` } })).id;
  return companyIds[name]!;
}

async function seed(item: Seed) {
  const opportunity = await database.opportunity.create({
    data: {
      title: item.title === null ? null : `${item.title} ${token}`,
      companyId: item.company ? await company(item.company) : null,
      location: item.location ?? null,
      salaryText: item.salaryText ?? null,
      source: item.source ?? "manual-input",
      originalSource: item.source ?? "manual-input",
      sourceType: item.sourceType ?? "MANUAL",
      domain: item.domain ?? "customer-success",
      status: (item.status ?? "NORMALIZED") as never,
      jobDescription: `Hidden description phrase ${token}-desc`,
      discoveredAt: new Date(item.discoveredAt),
      firstSeenAt: new Date(item.discoveredAt),
      lastSeenAt: new Date(item.discoveredAt),
    },
  });
  opportunityIds.push(opportunity.id);
  ids[item.key] = opportunity.id;
  for (const evaluation of item.evaluations ?? []) {
    const domainResult = {
      opportunityPriority: evaluation.band ? { evaluated: true, band: evaluation.band } : { evaluated: false, reason: "n/a" },
      hardFilters: evaluation.role ? { role: { classification: evaluation.role } } : undefined,
      companyAlignment: evaluation.segment
        ? { evaluated: true, alignment: { customerSegment: { classification: evaluation.segment } } }
        : { evaluated: false, reason: "n/a" },
    };
    const created = await database.evaluation.create({
      data: {
        opportunityId: opportunity.id,
        domain: "customer-success",
        status: evaluation.status,
        evaluationVersion: "dashboard-test",
        domainVersion: "dashboard-test",
        ruleVersion: "dashboard-test",
        domainResult: evaluation.status === "COMPLETED" ? (domainResult as never) : undefined,
        createdAt: new Date(evaluation.at),
        completedAt: evaluation.status === "COMPLETED" ? new Date(evaluation.at) : null,
        task: { create: { status: evaluation.status, maxAttempts: 1 } },
      },
    });
    if (evaluation.decision) {
      await database.recommendation.create({
        data: {
          opportunityId: opportunity.id,
          evaluationId: created.id,
          decision: evaluation.decision,
          explanation: "dashboard test",
          evaluationVersion: "dashboard-test",
          evidenceReferences: [],
          createdAt: new Date(evaluation.at),
        },
      });
    }
  }
  if (item.deferred) {
    await database.deferredEvaluation.create({
      data: {
        opportunityId: opportunity.id,
        domain: "customer-success",
        reasonCode: "BUDGET_UNAVAILABLE",
        reasonSnapshot: {},
        lastCheckedAt: new Date(item.discoveredAt),
      },
    });
  }
}

const seeds: Seed[] = [
  {
    key: "applyHigh", title: "Customer Success Manager", company: "Acme", location: "Remote - United States",
    salaryText: "$90,000-$110,000", discoveredAt: "2026-10-05T10:00:00Z", status: "RECOMMENDED",
    evaluations: [{ status: "COMPLETED", decision: "APPLY", band: "VERY_HIGH", role: "CORE_CS", segment: "SMB", at: "2026-10-05T11:00:00Z" }],
  },
  {
    key: "reviewMid", title: "Onboarding Specialist", company: "Beta Corp", location: "Austin, TX",
    salaryText: null, source: "linkedin-import", sourceType: "PUBLIC_SEARCH", discoveredAt: "2026-09-20T10:00:00Z", status: "SAVED",
    evaluations: [{ status: "COMPLETED", decision: "REVIEW", band: "MIXED_MODERATE", role: "CS_ADJACENT", segment: "MID_MARKET", at: "2026-09-21T10:00:00Z" }],
  },
  {
    key: "skipLow", title: "Support Engineer", company: "Gamma", location: "London, UK",
    salaryText: "£40,000", source: "greenhouse", sourceType: "ATS", discoveredAt: "2026-08-15T10:00:00Z", status: "REJECTED_BY_USER",
    evaluations: [{ status: "COMPLETED", decision: "SKIP", band: "LOW", role: "SUPPORT_HEAVY", segment: "UNKNOWN", at: "2026-08-16T10:00:00Z" }],
  },
  {
    key: "reevalQueued", title: "Customer Success Lead", company: "Acme", location: "Remote - Canada",
    salaryText: "Competitive", discoveredAt: "2026-10-01T10:00:00Z", status: "RECOMMENDED",
    evaluations: [
      { status: "COMPLETED", decision: "APPLY", band: "HIGH", role: "CORE_CS", segment: "ENTERPRISE", at: "2026-10-02T10:00:00Z" },
      { status: "PENDING", at: "2026-10-06T10:00:00Z" },
    ],
  },
  {
    key: "reevalFailed", title: "Renewals Manager", company: "Delta", location: null,
    salaryText: null, discoveredAt: "2026-09-10T10:00:00Z", status: "RECOMMENDED",
    evaluations: [
      { status: "COMPLETED", decision: "REVIEW", band: "LOW", role: "SALES_HEAVY", segment: "COMMERCIAL", at: "2026-09-11T10:00:00Z" },
      { status: "FAILED", at: "2026-09-12T10:00:00Z" },
    ],
  },
  { key: "running", title: "Adoption Manager", company: "Epsilon", discoveredAt: "2026-10-03T10:00:00Z", evaluations: [{ status: "RUNNING", at: "2026-10-03T11:00:00Z" }] },
  { key: "failedOnly", title: "Implementation Consultant", company: "Zeta", discoveredAt: "2026-07-01T10:00:00Z", evaluations: [{ status: "FAILED", at: "2026-07-02T10:00:00Z" }] },
  { key: "deferredNew", title: "Customer Education Lead", company: "Eta", discoveredAt: "2026-10-04T10:00:00Z", deferred: true },
  {
    key: "deferredArchived", title: "Customer Success Associate", company: "Theta", discoveredAt: "2026-06-01T10:00:00Z",
    status: "ARCHIVED", deferred: true,
  },
  { key: "untitled", title: null, company: "Mu", location: "Remote", discoveredAt: "2026-10-06T10:00:00Z" },
  { key: "noCompany", title: "Customer Advocate", company: undefined, location: null, discoveredAt: "2026-03-01T10:00:00Z" },
  { key: "applied", title: "Account Manager", company: "Iota", discoveredAt: "2026-05-01T10:00:00Z", status: "APPLIED", domain: "account-management" },
  { key: "searchWildcard", title: "Manager 100%_remote", company: "Kappa", discoveredAt: "2026-04-01T10:00:00Z", source: "100%_source" },
];

const list = (search: string, sort: OpportunityListSort = "newest", page = 1, pageSize = 25) => {
  const query = parseOpportunityQuery(new URLSearchParams(search));
  const filters = toListFilters(query);
  return repository.listPage({
    filters: { ...filters, searchTerms: [...filters.searchTerms, token] },
    sort: query.sort === "newest" ? sort : query.sort,
    page: query.page === 1 ? page : query.page,
    pageSize: query.pageSize === 25 ? pageSize : query.pageSize,
  });
};
const keysOf = (result: Awaited<ReturnType<typeof list>>) =>
  result.items.map((item) => Object.entries(ids).find(([, id]) => id === item.id)?.[0]);

beforeAll(async () => {
  baseline = await dashboard.summarize(new Date("2026-10-07T12:00:00Z"));
  for (const item of seeds) await seed(item);
});

afterAll(async () => {
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  await database.company.deleteMany({ where: { id: { in: Object.values(companyIds) } } });
  await database.$disconnect();
});

describe("filters", () => {
  it("lifecycle views: archived only in Archived/All; deferred stays discoverable", async () => {
    expect(keysOf(await list(""))).toEqual([
      "untitled", "applyHigh", "deferredNew", "running", "reevalQueued", "reviewMid", "reevalFailed", "failedOnly", "searchWildcard",
      "noCompany",
    ]);
    const active = keysOf(await list(""));
    expect(active).not.toContain("deferredArchived");
    expect(active).not.toContain("skipLow");
    expect(active).not.toContain("applied");
    expect(keysOf(await list("view=archived"))).toEqual(["deferredArchived"]);
    expect(keysOf(await list("view=all")).length).toBe(seeds.length);
    expect(keysOf(await list("view=all&eval=deferred")).sort()).toEqual(["deferredArchived", "deferredNew"]);
    expect(keysOf(await list("eval=deferred"))).toEqual(["deferredNew"]);
    expect(keysOf(await list("view=triage"))).not.toContain("reviewMid"); // saved
    expect(keysOf(await list("view=triage"))).toContain("applyHigh");
  });

  it("recommendation uses the latest completed evaluation, even while a reevaluation is queued or failed", async () => {
    expect(keysOf(await list("view=all&rec=apply")).sort()).toEqual(["applyHigh", "reevalQueued"]);
    expect(keysOf(await list("view=all&rec=review")).sort()).toEqual(["reevalFailed", "reviewMid"]);
    expect(keysOf(await list("view=all&rec=skip"))).toEqual(["skipLow"]);
    const none = keysOf(await list("view=all&rec=none")).sort();
    expect(none).toEqual(["applied", "deferredArchived", "deferredNew", "failedOnly", "noCompany", "running", "searchWildcard", "untitled"].sort());
    const queued = (await list("view=all&rec=apply")).items.find((item) => item.id === ids.reevalQueued)!;
    expect(queued.currentRecommendation).toMatchObject({ decision: "APPLY", isLatest: false });
    expect(queued.latestEvaluation).toMatchObject({ status: "PENDING", decision: null });
  });

  it("evaluation state", async () => {
    expect(keysOf(await list("view=all&eval=queued"))).toEqual(["reevalQueued"]);
    expect(keysOf(await list("view=all&eval=running"))).toEqual(["running"]);
    expect(keysOf(await list("view=all&eval=failed")).sort()).toEqual(["failedOnly", "reevalFailed"]);
    expect(keysOf(await list("view=all&eval=completed")).sort()).toEqual(["applyHigh", "reviewMid", "skipLow"]);
    expect(keysOf(await list("view=all&eval=none")).sort()).toEqual(
      ["applied", "deferredArchived", "deferredNew", "noCompany", "searchWildcard", "untitled"].sort(),
    );
  });

  it("priority, role family, and segment come from the persisted result; missing values are never inferred", async () => {
    expect(keysOf(await list("view=all&priority=very-high&priority=high")).sort()).toEqual(["applyHigh", "reevalQueued"]);
    expect(keysOf(await list("view=all&priority=low")).sort()).toEqual(["reevalFailed", "skipLow"]);
    expect(keysOf(await list("view=all&priority=unknown"))).not.toContain("applyHigh");
    expect(keysOf(await list("view=all&priority=unknown"))).toContain("running");
    expect(keysOf(await list("view=all&role=core-cs")).sort()).toEqual(["applyHigh", "reevalQueued"]);
    expect(keysOf(await list("view=all&segment=unknown"))).toEqual(["skipLow"]);
    expect(keysOf(await list("view=all&segment=not-evaluated"))).toContain("untitled");
    expect(keysOf(await list("view=all&segment=mid-market"))).toEqual(["reviewMid"]);
  });

  it("source, source type, company, domain, title, location, salary, and discovered dates", async () => {
    expect(keysOf(await list("view=all&sourceType=ats"))).toEqual(["skipLow"]);
    expect(keysOf(await list("view=all&source=linkedin-import"))).toEqual(["reviewMid"]);
    expect(keysOf(await list(`view=all&company=${companyIds.Acme}`)).sort()).toEqual(["applyHigh", "reevalQueued"]);
    expect(keysOf(await list("view=all&domain=account-management"))).toEqual(["applied"]);
    expect(keysOf(await list("view=all&title=CUSTOMER SUCCESS")).sort()).toEqual(
      ["applyHigh", "deferredArchived", "reevalQueued"].sort(),
    );
    expect(keysOf(await list("view=all&location=remote")).sort()).toEqual(["applyHigh", "reevalQueued", "untitled"]);
    expect(keysOf(await list("view=all&salary=stated")).sort()).toEqual(["applyHigh", "reevalQueued", "skipLow"]);
    expect(keysOf(await list("view=all&salary=not-stated"))).toContain("reviewMid");
    expect(keysOf(await list("view=all&from=2026-10-01&to=2026-10-04")).sort()).toEqual(
      ["deferredNew", "reevalQueued", "running"].sort(),
    );
  });

  it("combines filters with AND and values within a filter with OR", async () => {
    expect(keysOf(await list("view=all&rec=apply&rec=review&eval=failed"))).toEqual(["reevalFailed"]);
    expect(keysOf(await list(`view=all&company=${companyIds.Acme}&eval=queued`))).toEqual(["reevalQueued"]);
    expect(keysOf(await list("rec=apply&location=canada"))).toEqual(["reevalQueued"]);
  });
});

describe("search", () => {
  it("is case-insensitive partial matching with AND across terms", async () => {
    expect(keysOf(await list("view=all&q=ACME")).sort()).toEqual(["applyHigh", "reevalQueued"]);
    expect(keysOf(await list("view=all&q=success lead"))).toEqual(["reevalQueued"]);
    expect(keysOf(await list("view=all&q=succ manag")).sort()).toEqual(["applyHigh"]);
    expect(keysOf(await list("view=all&q=london"))).toEqual(["skipLow"]);
    expect(keysOf(await list("view=all&q=greenhouse"))).toEqual(["skipLow"]);
  });

  it("does not search descriptions and treats wildcards literally", async () => {
    expect((await list(`view=all&q=${token}-desc`)).total).toBe(0);
    expect(keysOf(await list("view=all&q=100%_remote"))).toEqual(["searchWildcard"]);
    // "_" would match the space in "Manager 100" if it were a wildcard.
    expect((await list("view=all&q=manager_100")).total).toBe(0);
  });
});

describe("sorting", () => {
  it("newest and oldest by discovered date", async () => {
    const newest = keysOf(await list("view=all"));
    expect(newest[0]).toBe("untitled");
    expect(newest.at(-1)).toBe("noCompany");
    expect(keysOf(await list("view=all&sort=oldest"))).toEqual([...newest].reverse());
  });

  it("priority highest first, unknown last", async () => {
    const order = keysOf(await list("view=all&sort=priority"));
    expect(order.slice(0, 5)).toEqual(["applyHigh", "reevalQueued", "reviewMid", "reevalFailed", "skipLow"]);
  });

  it("company and title A–Z with missing values last", async () => {
    const byCompany = keysOf(await list("view=all&sort=company"));
    expect(byCompany.slice(0, 2).sort()).toEqual(["applyHigh", "reevalQueued"]);
    expect(byCompany.at(-1)).toBe("noCompany");
    const byTitle = keysOf(await list("view=all&sort=title"));
    expect(byTitle[0]).toBe("applied");
    expect(byTitle.at(-1)).toBe("untitled");
  });
});

describe("pagination", () => {
  const bulkToken = () => `${token}bulk`;

  async function seedBulk(count: number, label: string) {
    const companyId = await company(`Bulk ${label}`);
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      title: `Bulk ${label} ${bulkToken()} ${String(index).padStart(3, "0")}`,
      companyId,
      domain: "customer-success",
      source: "manual-input",
      sourceType: "MANUAL" as const,
      status: "NORMALIZED" as const,
      discoveredAt: new Date(Date.UTC(2025, 0, 1) + index * 60_000),
    }));
    await database.opportunity.createMany({ data: rows });
    opportunityIds.push(...rows.map((row) => row.id));
    return rows;
  }

  it("clamps a page beyond the end to the last page with exactly its rows", async () => {
    const rows = await seedBulk(63, "alpha");
    const result = await list(`view=all&q=bulk alpha&page=99`);
    expect(result).toMatchObject({ total: 63, page: 3, requestedPage: 99, pageCount: 3, pageSize: 25 });
    expect(result.items).toHaveLength(13);
    const newestFirst = [...rows].reverse().map((row) => row.id);
    expect(result.items.map((item) => item.id)).toEqual(newestFirst.slice(50, 63));
  });

  it("handles the exact final-page boundary", async () => {
    await seedBulk(75, "bravo");
    const third = await list("view=all&q=bulk bravo&page=3");
    expect(third).toMatchObject({ total: 75, page: 3, pageCount: 3 });
    expect(third.items).toHaveLength(25);
    const fourth = await list("view=all&q=bulk bravo&page=4");
    expect(fourth).toMatchObject({ page: 3, requestedPage: 4 });
    expect(fourth.items.map((item) => item.id)).toEqual(third.items.map((item) => item.id));
  });

  it("keeps zero results on page 1", async () => {
    const result = await list("view=all&q=nothing-matches-this&page=5");
    expect(result).toEqual({ items: [], total: 0, page: 1, requestedPage: 5, pageCount: 1, pageSize: 25 });
  });

  it("count and items always agree, with no duplicates or gaps across pages", async () => {
    for (const [search, sort] of [
      ["view=all&q=bulk", "newest"],
      ["view=all&q=bulk", "title"],
      ["view=all", "priority"],
      ["view=all", "company"],
      ["view=all&q=bulk bravo", "oldest"],
    ] as const) {
      const first = await list(search, sort, 1, 10);
      const seen: string[] = [];
      for (let page = 1; page <= first.pageCount; page += 1) {
        const result = await list(search, sort, page, 10);
        expect(result.total).toBe(first.total);
        seen.push(...result.items.map((item) => item.id));
      }
      expect(seen).toHaveLength(first.total);
      expect(new Set(seen).size).toBe(first.total);
    }
  });
});

describe("summary", () => {
  it("counts exactly the seeded data (as deltas) and matches the views it links to", async () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const summary = await dashboard.summarize(now);
    const delta = (key: keyof DashboardSummary) => (summary[key] as number) - (baseline[key] as number);
    expect(delta("active")).toBeGreaterThanOrEqual(8);
    expect(delta("saved")).toBeGreaterThanOrEqual(1);
    expect(delta("applied")).toBeGreaterThanOrEqual(1);
    expect(delta("dismissed")).toBe(1);
    expect(delta("archived")).toBe(1);
    expect(delta("deferred")).toBe(2);
    expect(delta("queued")).toBe(1);
    expect(delta("running")).toBe(1);
    expect(summary.recommendations.APPLY - baseline.recommendations.APPLY).toBe(2);
    expect(summary.recommendations.REVIEW - baseline.recommendations.REVIEW).toBe(2);
    expect(summary.recommendations.SKIP - baseline.recommendations.SKIP).toBe(1);
    // The "needs attention" counts equal the totals of the views they link to.
    const scoped = async (search: string) => (await repository.listPage({
      filters: toListFilters(parseOpportunityQuery(new URLSearchParams(search))),
      sort: "newest",
      page: 1,
      pageSize: 1,
    })).total;
    expect(await scoped("eval=none")).toBe(summary.activeNotEvaluated);
    expect(await scoped("view=all&eval=deferred")).toBe(summary.deferred);
    expect(await scoped("eval=failed")).toBe(summary.activeFailed);
    expect(await scoped("view=triage&rec=apply")).toBe(summary.triageRecommendedApply);
    expect(await scoped("view=all&eval=queued&eval=running")).toBe(summary.queued + summary.running);
  });

  it("offers distinct sources, domains, and companies for filtering", async () => {
    const options = await dashboard.filterOptions();
    expect(options.sources.map((item) => item.value)).toEqual(expect.arrayContaining(["greenhouse", "linkedin-import"]));
    expect(options.domains.map((item) => item.value)).toEqual(expect.arrayContaining(["account-management", "customer-success"]));
    expect(options.companies.find((item) => item.id === companyIds.Acme)).toMatchObject({ count: 2 });
  });
});

describe("read-only", () => {
  it("never changes any row and ignores invalid parameters safely", async () => {
    const snapshot = () => database.opportunity.findMany({ where: { id: { in: opportunityIds } }, orderBy: { id: "asc" } });
    const before = await snapshot();
    for (const search of [
      "view=all&sort=priority&page=2", "rec=bogus&eval=nope&from=2026-99-99&company=x&sort=sideways&page=-1",
      "view=all&q=%27%3B%20DROP%20TABLE%20%22Opportunity%22%3B--", "view=all&title=%25&location=_",
    ]) {
      await expect(list(search)).resolves.toBeDefined();
    }
    await dashboard.summarize();
    await dashboard.filterOptions();
    expect(await snapshot()).toEqual(before);
  });
});
