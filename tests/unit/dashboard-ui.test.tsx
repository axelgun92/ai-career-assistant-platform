import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardSummary, OpportunityListItem } from "@ai-career/database";
import { ActiveFilters } from "../../apps/web/src/components/dashboard/active-filters";
import {
  attentionLinks,
  NeedsAttention,
  PipelineOverview,
} from "../../apps/web/src/components/dashboard/dashboard-summary";
import {
  activeFilterChips,
  salaryExclusionNote,
  salarySortNote,
} from "../../apps/web/src/components/dashboard/labels";
import {
  fieldErrorsFromIssues,
  ManualOpportunityFields,
} from "../../apps/web/src/components/manual-opportunity-fields";
import {
  employmentTypeLabel,
  formatSalaryRange,
  seniorityLabel,
  workArrangementLabel,
} from "../../apps/web/src/components/opportunity-facts";
import { OpportunityFilters } from "../../apps/web/src/components/dashboard/opportunity-filters";
import { OpportunityList } from "../../apps/web/src/components/dashboard/opportunity-list";
import { Pagination } from "../../apps/web/src/components/dashboard/pagination";
import { parseOpportunityQuery } from "../../apps/web/src/server/opportunity-query";

const parse = (search: string) => parseOpportunityQuery(new URLSearchParams(search));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const decode = (markup: string) => markup.replaceAll("&amp;", "&");
const companyId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const at = new Date("2026-10-01T12:00:00.000Z");

function item(overrides: Partial<OpportunityListItem> = {}): OpportunityListItem {
  return {
    id: "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22",
    domain: "customer-success",
    status: "RECOMMENDED",
    source: "manual-input",
    sourceType: "MANUAL",
    title: "Customer Success Manager",
    companyName: "Acme",
    location: "Remote",
    salaryText: null,
    postingDate: null,
    createdAt: at,
    discoveredAt: at,
    updatedAt: at,
    applicationUrl: null,
    deferred: false,
    latestEvaluation: null,
    currentRecommendation: null,
    priorityBand: null,
    roleFamily: null,
    customerSegment: null,
    application: null,
    ...overrides,
  };
}

describe("active filters", () => {
  it("shows the result range, one removable chip per value, and clear-all", () => {
    const query = parse(`q=acme&rec=apply&rec=review&eval=deferred&company=${companyId}&salary=not-stated&from=2026-10-01&page=2`);
    const markup = decode(renderToStaticMarkup(
      <ActiveFilters query={query} total={63} page={2} pageSize={25} companyNames={{ [companyId]: "Acme" }} />,
    ));
    const visible = text(markup);
    expect(visible).toContain("Showing 26–50 of 63 opportunities");
    for (const label of [
      "Search: “acme”", "Recommendation: Apply", "Recommendation: Review", "Evaluation: Deferred for budget",
      "Company: Acme", "Salary: Not stated", "Discovered from: 2026-10-01",
    ]) {
      expect(visible).toContain(label);
    }
    // Removing one value keeps the others and returns to page 1.
    expect(markup).toContain(`aria-label="Remove filter Recommendation: Apply" href="/?q=acme&rec=review&eval=deferred&company=${companyId}&salary=not-stated&from=2026-10-01"`);
    expect(visible).toContain("Clear all filters");
    expect(markup).toMatch(/class="clear-filters" href="\/"/);
  });

  it("says when nothing is found and omits chips without filters", () => {
    const visible = text(renderToStaticMarkup(<ActiveFilters query={parse("")} total={0} page={1} pageSize={25} companyNames={{}} />));
    expect(visible).toBe("No opportunities found");
  });

  it("chip removal keeps the view and sort", () => {
    const chips = activeFilterChips(parse("view=saved&sort=title&location=remote"));
    expect(chips).toEqual([{ label: "Location contains: remote", removeHref: "/?view=saved&sort=title" }]);
  });
});

describe("filter form", () => {
  it("is a GET form with labelled controls reflecting the URL, and opens when filters are active", () => {
    const options = {
      sources: [{ value: "manual-input", count: 3 }],
      domains: [{ value: "customer-success", count: 3 }],
      companies: [{ id: companyId, name: "Acme", count: 2 }],
      departments: [],
      currencies: [],
    };
    const closed = renderToStaticMarkup(<OpportunityFilters query={parse("q=acme")} options={options} />);
    expect(closed).toContain('method="get"');
    expect(closed).toContain('role="search"');
    expect(closed).toContain('value="acme"');
    expect(closed).not.toMatch(/<details class="filter-panel" open/);
    const open = renderToStaticMarkup(<OpportunityFilters query={parse(`view=all&rec=apply&company=${companyId}&sort=priority`)} options={options} />);
    expect(open).toMatch(/<details class="filter-panel" open/);
    expect(open).toContain('<input type="checkbox" name="rec" checked="" value="apply"/>');
    expect(open).toContain('<input type="checkbox" name="rec" value="review"/>');
    expect(open).toContain('<input type="hidden" name="view" value="all"/>');
    expect(open).toMatch(new RegExp(`<option value="${companyId}" selected="">Acme \\(2\\)</option>`));
    expect(open).toMatch(/<option value="priority" selected="">Priority \(highest first\)<\/option>/);
    for (const legend of ["Recommendation", "Evaluation", "Priority", "Role family", "Customer segment", "Source type"]) {
      expect(open).toContain(`<legend>${legend}</legend>`);
    }
  });
});

describe("opportunity rows", () => {
  it("shows lifecycle, current recommendation, priority, evaluation state, deferral, and a safe application link", () => {
    const visible = text(renderToStaticMarkup(
      <OpportunityList
        opportunities={[
          item({
            salaryText: "$90,000",
            applicationUrl: "https://jobs.example.com/apply",
            latestEvaluation: { id: "e2", status: "FAILED", decision: null, createdAt: at, completedAt: null },
            currentRecommendation: { decision: "APPLY", evaluationId: "e1", isLatest: false },
            priorityBand: "VERY_HIGH",
            deferred: true,
          }),
        ]}
      />,
    ));
    expect(visible).toContain("Recommendation ready");
    expect(visible).toContain("Apply (last completed)");
    expect(visible).toContain("Very high priority");
    expect(visible).toContain("Evaluation failed");
    expect(visible).toContain("Evaluation deferred");
    expect(visible).toContain("Application page");
    expect(visible).toContain("$90,000");
    expect(visible).toContain("Acme · Remote");
  });

  it("shows the application stage or outcome and the next follow-up, without cluttering untracked rows", () => {
    const visible = text(renderToStaticMarkup(
      <OpportunityList
        opportunities={[
          item({ id: "a", status: "APPLIED", application: { stage: "SCREENING", outcome: null, nextFollowUpOn: "2026-10-01", nextFollowUpState: "OVERDUE" } }),
          item({ id: "b", status: "APPLIED", application: { stage: "CLOSED", outcome: "REJECTED", nextFollowUpOn: "2026-10-20", nextFollowUpState: "LATER" } }),
          item({ id: "c", status: "APPLIED" }),
          item({ id: "d", status: "SAVED" }),
        ]}
      />,
    ));
    expect(visible).toContain("Recruiter screen");
    expect(visible).toContain("Follow-up overdue · 2026-10-01");
    expect(visible).toContain("Rejected by employer");
    expect(visible).toContain("Next follow-up 2026-10-20");
    expect(visible.match(/Not tracked yet/g)).toHaveLength(1);
  });

  it("never links unsafe application URLs and says when salary is not stated", () => {
    const markup = renderToStaticMarkup(
      <OpportunityList opportunities={[item({ applicationUrl: "javascript:alert(1)" })]} />,
    );
    expect(markup).not.toContain("javascript:");
    expect(text(markup)).toContain("Salary not stated");
    expect(text(markup)).toContain("Not evaluated");
  });
});

describe("pagination", () => {
  it("links previous and next pages with the current filters", () => {
    const markup = decode(renderToStaticMarkup(<Pagination query={parse("rec=apply")} page={2} pageCount={3} />));
    expect(markup).toContain('href="/?rec=apply"');
    expect(markup).toContain('href="/?rec=apply&page=3"');
    expect(text(markup)).toContain("Page 2 of 3");
  });

  it("renders nothing for a single page", () => {
    expect(renderToStaticMarkup(<Pagination query={parse("")} page={1} pageCount={1} />)).toBe("");
  });
});

const summary: DashboardSummary = {
  total: 20,
  active: 12,
  toTriage: 9,
  saved: 3,
  applied: 2,
  dismissed: 4,
  archived: 2,
  activeNotEvaluated: 5,
  activeFailed: 1,
  triageRecommendedApply: 2,
  evaluated: 13,
  notEvaluated: 7,
  queued: 1,
  running: 1,
  deferred: 2,
  recommendations: { APPLY: 4, REVIEW: 5, SKIP: 3, NONE: 8 },
  discoveredLast7Days: 6,
  discoveredLast30Days: 15,
  bySourceType: [{ sourceType: "MANUAL", count: 18 }, { sourceType: null, count: 2 }],
  byPriorityBand: [{ band: "VERY_HIGH", count: 2 }, { band: "LOW", count: 6 }, { band: null, count: 4 }],
  followUpsDue: 3,
};

describe("dashboard summary", () => {
  it("links each attention count to the view it counts", () => {
    const markup = decode(renderToStaticMarkup(<NeedsAttention summary={summary} />));
    expect(markup).toContain(`aria-label="Not evaluated: 5" href="${attentionLinks.notEvaluated}"`);
    expect(markup).toContain(`aria-label="Recommended to apply: 2" href="${attentionLinks.recommendedApply}"`);
    expect(markup).toContain(`aria-label="Deferred for budget: 2" href="${attentionLinks.deferred}"`);
    expect(markup).toContain(`aria-label="Evaluation failed: 1" href="${attentionLinks.failed}"`);
    expect(markup).toContain(`aria-label="In progress: 2" href="${attentionLinks.inProgress}"`);
    expect(markup).toContain(`aria-label="Follow-ups due: 3" href="${attentionLinks.followUpsDue}"`);
    expect(attentionLinks).toEqual({
      notEvaluated: "/?eval=none",
      deferred: "/?view=all&eval=deferred",
      failed: "/?eval=failed",
      recommendedApply: "/?view=triage&rec=apply",
      inProgress: "/?view=all&eval=queued&eval=running",
      followUpsDue: "/applications?followUp=due",
    });
  });

  it("shows counts and distributions without inventing scores", () => {
    const visible = text(renderToStaticMarkup(<PipelineOverview summary={summary} />));
    expect(visible).toContain("Active 12");
    expect(visible).toContain("Discovered in the last 7 days 6");
    expect(visible).toContain("Apply 4");
    expect(visible).toContain("No recommendation yet 8");
    expect(visible).toContain("Very high priority 2");
    expect(visible).toContain("Priority not evaluated 4");
    expect(visible).toContain("Manual entry 18");
    expect(visible).toContain("Unknown 2");
    expect(visible).not.toMatch(/score|average|median/i);
  });

  it("renders no overview when there are no opportunities", () => {
    expect(renderToStaticMarkup(<PipelineOverview summary={{ ...summary, total: 0 }} />)).toBe("");
  });
});

describe("normalized facts on the dashboard (Task 7 completion)", () => {
  it("chips name each new filter; removing the currency also removes its amounts", () => {
    const chips = activeFilterChips(parse("arrangement=remote&seniority=unknown&department=Support&currency=EUR&salaryMin=60000"));
    expect(chips.map((chip) => chip.label)).toEqual([
      "Work arrangement: Remote",
      "Seniority: Unknown (not stated)",
      "Department: Support",
      "Salary currency: EUR",
      "Salary at least: 60,000 EUR",
    ]);
    expect(chips.find((chip) => chip.label.startsWith("Salary currency"))!.removeHref).toBe(
      "/?arrangement=remote&seniority=unknown&department=Support",
    );
    expect(chips.find((chip) => chip.label.startsWith("Salary at least"))!.removeHref).toBe(
      "/?arrangement=remote&seniority=unknown&department=Support&currency=EUR",
    );
  });

  it("explains what a salary filter left out and how salary sorts treat currencies", () => {
    const visible = text(renderToStaticMarkup(
      <ActiveFilters
        query={parse("salaryMin=90000&sort=salary-high")}
        total={2}
        page={1}
        pageSize={25}
        companyNames={{}}
        salaryExclusions={{ currency: "USD", withoutAmount: 3, unknownCurrency: 1, otherCurrency: 2 }}
      />,
    ));
    expect(visible).toContain(
      "Salary filter compares USD amounts only. Not included: 3 opportunities without a stated salary amount; " +
        "2 opportunities with a salary in another currency; 1 opportunity with an unknown salary currency.",
    );
    expect(visible).not.toContain("sorted within each currency"); // one currency is selected
    expect(salarySortNote(parse("sort=salary-low"))).toContain("sorted within each currency");
    expect(salarySortNote(parse("sort=title"))).toBeNull();
    expect(salaryExclusionNote({ currency: "USD", withoutAmount: 0, unknownCurrency: 0, otherCurrency: 0 })).toBeNull();
  });

  it("the filter form offers the new groups, the active sort, and keeps selections", () => {
    const options = {
      sources: [], domains: [], companies: [],
      departments: [{ value: "Customer Success", count: 2 }],
      currencies: [{ value: "GBP", count: 1 }],
    };
    const markup = renderToStaticMarkup(
      <OpportunityFilters query={parse("arrangement=hybrid&department=Support&currency=GBP&salaryMin=50000&sort=salary-high")} options={options} />,
    );
    for (const legend of ["Work arrangement", "Seniority (as stated)", "Salary range"]) {
      expect(markup).toContain(`<legend>${legend}</legend>`);
    }
    expect(markup).toContain('<input type="checkbox" name="arrangement" checked="" value="hybrid"/>');
    expect(markup).toMatch(/<option value="Support" selected="">Support<\/option>/);
    expect(markup).toMatch(/<option value="Customer Success">Customer Success \(2\)<\/option>/);
    expect(markup).toMatch(/<option value="GBP" selected="">GBP<\/option>/);
    expect(markup).toContain('<option value="USD">USD</option>');
    expect(markup).toContain('name="salaryMin" value="50000"');
    expect(markup).toMatch(/<option value="salary-high" selected="">Salary, highest first \(per currency\)<\/option>/);
    expect(text(markup)).toContain("there is no currency conversion");
  });

  it("rows show the work arrangement, Unknown when not stated", () => {
    const visible = text(renderToStaticMarkup(
      <OpportunityList opportunities={[item({ remoteStatus: "HYBRID" }), item({ id: "other", remoteStatus: null })]} />,
    ));
    expect(visible).toContain("Work arrangement Hybrid");
    expect(visible).toContain("Work arrangement Unknown");
  });

  it("formats salary ranges without assuming a currency", () => {
    expect(formatSalaryRange(72000, 88000, "USD")).toBe("72,000–88,000 USD");
    expect(formatSalaryRange(80000, 80000, "GBP")).toBe("80,000 GBP");
    expect(formatSalaryRange(70000, null, "USD")).toBe("At least 70,000 USD");
    expect(formatSalaryRange(null, 90000, null)).toBe("Up to 90,000 (currency unknown)");
    expect(formatSalaryRange(null, null, "USD")).toBeNull();
    expect(workArrangementLabel(null)).toBe("Unknown");
    expect(seniorityLabel("EXECUTIVE")).toBe("VP / executive");
    expect(employmentTypeLabel("FULL_TIME")).toBe("Full-time");
  });

  it("the manual form offers the optional details, blank by default", () => {
    const markup = renderToStaticMarkup(<ManualOpportunityFields fieldErrors={{ department: "Too long" }} />);
    expect(markup).toContain("<legend>Additional details (optional)</legend>");
    for (const name of ["workArrangement", "seniority", "employmentType", "compensationCurrency"]) {
      expect(markup).toMatch(new RegExp(`<select name="${name}"[^>]*><option value="" selected="">Not stated</option>`));
    }
    expect(markup).toContain('<input type="date" name="closingDate"/>');
    expect(markup).toContain('aria-describedby="department-error"');
    expect(fieldErrorsFromIssues([{ path: "seniority", message: "Invalid option" }]).fieldErrors).toEqual({ seniority: "Invalid option" });
  });
});
