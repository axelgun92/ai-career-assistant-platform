import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { opportunityMoveOptions, platformMetadata, type OpportunityLifecycleState } from "@ai-career/core";
import {
  PrismaOpportunityDashboardRepository,
  PrismaUsageSummaryRepository,
  PrismaTitlePolicyRepository,
  PrismaUserEligibilityRepository,
  type DashboardFilterOptions,
  type DashboardSummary,
  type OpportunityListPage,
  type UsageTotals as UsageTotalsData,
} from "@ai-career/database";
import { OpportunityList } from "@/components/dashboard/opportunity-list";
import { OpportunitySelectionProvider, SelectionToolbar } from "@/components/dashboard/selection/opportunity-selection";
import { applicationMoveState } from "@/server/opportunity-move-service";
import { outsideTargetTitles } from "@/server/title-policy-service";
import { UsageTotals } from "@/components/dashboard/usage-totals";
import { ActiveFilters } from "@/components/dashboard/active-filters";
import { NeedsAttention, PipelineOverview, TriageSummary } from "@/components/dashboard/dashboard-summary";
import { getPreEvaluatorTriageService } from "@/server/pre-evaluator-triage-service";
import { OpportunityFilters } from "@/components/dashboard/opportunity-filters";
import { Pagination } from "@/components/dashboard/pagination";
import { viewTabs } from "@/components/dashboard/labels";
import { BudgetCard } from "@/components/budget/budget-card";
import type { BudgetStatusView } from "@/components/budget/types";
import { getBudgetService } from "@/server/budget-service";
import { getOpportunityListReader } from "@/server/opportunity-list-service";
import {
  clearFilters,
  hasActiveFilters,
  opportunityHref,
  canonicalRedirect,
  parseOpportunityQuery,
  toListFilters,
  opportunityViews,
  withChanges,
  type OpportunityView,
  type SearchParamsInput,
  type TriageFilter,
} from "@/server/opportunity-query";

export const metadata = { title: "Dashboard" };

const triageFilterLabels: Record<TriageFilter, string> = { evaluate: "Evaluate", review: "Needs Review", reject: "Rejected" };

// Each tab's count, from the same summary the views match.
function viewCount(summary: DashboardSummary, view: OpportunityView): number {
  switch (view) {
    case "active": return summary.active;
    case "triage": return summary.toTriage;
    case "saved": return summary.saved;
    case "applied": return summary.applied;
    case "dismissed": return summary.dismissed;
    case "archived": return summary.archived;
    case "all": return summary.total;
  }
}

function logFailure(message: string, error: unknown) {
  console.error(message, { errorName: error instanceof Error ? error.name : "UnknownError" });
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const query = parseOpportunityQuery(params as SearchParamsInput);
  // The user's own work eligibility, for the "Check work eligibility" badge.
  const eligibility = await new PrismaUserEligibilityRepository().get().catch(() => null);

  let result: OpportunityListPage | null = null;
  // Saved jobs whose titles are outside the current target job titles: the
  // triage summary's count and, with titles=outside, the list (November 22
  // and 25, 2026). Null when the titles could not be read.
  const outsideTitles = await outsideTargetTitles(new PrismaTitlePolicyRepository()).catch((error: unknown) => {
    logFailure("Opportunity dashboard could not read the target job titles", error);
    return null;
  });
  try {
    if (query.titles === "outside" && !outsideTitles) throw new Error("target job titles unavailable");
    result = await getOpportunityListReader().listPage({
      filters: { ...toListFilters(query), ...(query.titles === "outside" && outsideTitles ? { idIn: outsideTitles.ids } : {}) },
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    logFailure("Opportunity dashboard could not load opportunities", error);
  }

  // Canonical URL: invalid or empty parameters are dropped, and a page past
  // the end (or any page with no results) becomes the last valid page.
  if (result) {
    const target = canonicalRedirect(params as SearchParamsInput, query, result.page);
    if (target) redirect(target);
  }

  const [summary, filterOptions, usageTotals, budgetStatus, needsReview] = await Promise.all([
    new PrismaOpportunityDashboardRepository().summarize().catch((error: unknown): DashboardSummary | null => {
      logFailure("Opportunity dashboard could not load the summary", error);
      return null;
    }),
    new PrismaOpportunityDashboardRepository().filterOptions().catch((error: unknown): DashboardFilterOptions => {
      logFailure("Opportunity dashboard could not load filter options", error);
      return { sources: [], domains: [], companies: [], departments: [], currencies: [] };
    }),
    new PrismaUsageSummaryRepository().summarizeAllUsage().catch((error: unknown): UsageTotalsData | null => {
      logFailure("Opportunity dashboard could not load AI usage totals", error);
      return null;
    }),
    getBudgetService().status().catch((error: unknown): BudgetStatusView | null => {
      logFailure("Opportunity dashboard could not load the AI budget", error);
      return null;
    }),
    // Jobs the pre-evaluator triage holds for a decision (its own queue,
    // distinct from the "Pre-Evaluation Review" lifecycle view).
    getPreEvaluatorTriageService()
      .listNeedsReview()
      .then((items) => items.length)
      .catch((error: unknown): number | undefined => {
        logFailure("Opportunity dashboard could not load the Needs Review queue", error);
        return undefined;
      }),
  ]);
  const companyNames = Object.fromEntries(
    filterOptions.companies.flatMap((company) => [
      [company.value, company.name],
      ...company.companyIds.map((id) => [id, company.name]),
    ]),
  );
  const filtered = hasActiveFilters(query);

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>{platformMetadata.name}</h1>
          <p>Search, filter, and prioritize the opportunities you are tracking.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link href="/opportunities/new" className="button-link">
            Add an opportunity
          </Link>
        </div>
      </div>

      {summary ? (
        <TriageSummary
          summary={summary}
          outsideTitles={outsideTitles ? { total: outsideTitles.ids.length, dismissed: outsideTitles.dismissed } : null}
        />
      ) : null}

      <section aria-labelledby="opportunities-title">
        <h2 id="opportunities-title">Opportunities</h2>
        {summary ? (
          // The total is every saved job; Active is one lifecycle view of it.
          <p className="opportunity-totals">
            <strong>{summary.total}</strong> {summary.total === 1 ? "opportunity" : "opportunities"} in total · Active {summary.active} ·{" "}
            <Link href="/?view=dismissed">Dismissed {summary.dismissed}</Link> ·{" "}
            <Link href="/duplicates">Possible duplicates</Link>
          </p>
        ) : null}
        <nav className="view-tabs" aria-label="Opportunity views">
          {viewTabs.map((tab) => {
            const count = summary ? viewCount(summary, tab.key) : null;
            return (
              <Link
                key={tab.key}
                href={opportunityHref(withChanges(query, { view: tab.key }))}
                aria-current={tab.key === query.view ? "page" : undefined}
              >
                {tab.label}
                {count === null ? null : <span className="view-tab-count"> {count}</span>}
              </Link>
            );
          })}
        </nav>
        <OpportunityFilters query={query} options={filterOptions} />
        {query.triage ? (
          <div className="title-cleanup-banner" role="status">
            <p>Showing the opportunities whose triage result is {triageFilterLabels[query.triage]}, in {opportunityViews[query.view].label === "All" ? "every view" : `the ${opportunityViews[query.view].label} view`}.</p>
            <Link href={opportunityHref(withChanges(query, { triage: undefined }))}>Show every triage result</Link>
          </div>
        ) : null}
        {query.titles === "outside" ? (
          <div className="title-cleanup-banner" role="status">
            <p>
              Showing the opportunities whose titles are outside your target job titles
              {outsideTitles ? ` (${outsideTitles.ids.length} in all views, ${outsideTitles.dismissed} in Dismissed)` : ""}. New automatic
              captures with such titles go to Dismissed by themselves; you can restore any of them, or move these ones yourself.
            </p>
            <Link href={opportunityHref(withChanges(query, { titles: undefined }))}>Show all titles</Link>
          </div>
        ) : null}
        {result === null ? (
          <p className="error-message" role="alert">
            Opportunities could not be loaded. Check the database connection and try again.
          </p>
        ) : (
          <>
            <ActiveFilters
              query={query}
              total={result.total}
              page={result.page}
              pageSize={result.pageSize}
              companyNames={companyNames}
              salaryExclusions={result.salaryExclusions}
            />
            {result.total === 0 && (filtered || (summary?.total ?? 0) > 0) ? (
              // Something exists, but not here: distinguish "no matches" from
              // the first-run "no opportunities yet" state.
              <div className="empty-state" role="status">
                <p>{filtered ? "No opportunities match these filters." : "No opportunities in this view."}</p>
                {filtered ? <Link href={opportunityHref(clearFilters(query))}>Clear all filters</Link> : null}
              </div>
            ) : (
              <OpportunitySelectionProvider
                key={opportunityHref(query)}
                rows={result.items.map((item) => ({ id: item.id, title: item.title ?? "Untitled opportunity" }))}
              >
                <SelectionToolbar dismissedView={query.view === "dismissed"} dismissedTotal={summary?.dismissed ?? 0} />
                <OpportunityList
                  opportunities={result.items}
                  eligibility={eligibility}
                  moveOptions={Object.fromEntries(
                    result.items.map((item) => [
                      item.id,
                      opportunityMoveOptions({ status: item.status as OpportunityLifecycleState, application: applicationMoveState(item.application) }),
                    ]),
                  )}
                />
              </OpportunitySelectionProvider>
            )}
            <Pagination query={query} page={result.page} pageCount={result.pageCount} />
          </>
        )}
      </section>

      {summary ? <NeedsAttention summary={summary} needsReview={needsReview} /> : null}
      {summary ? <PipelineOverview summary={summary} /> : null}
      {budgetStatus ? <BudgetCard status={budgetStatus} /> : null}
      {usageTotals ? <UsageTotals totals={usageTotals} /> : null}
    </main>
  );
}
