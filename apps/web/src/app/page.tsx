import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { platformMetadata } from "@ai-career/core";
import {
  PrismaOpportunityDashboardRepository,
  PrismaUsageSummaryRepository,
  type DashboardFilterOptions,
  type DashboardSummary,
  type OpportunityListPage,
  type UsageTotals as UsageTotalsData,
} from "@ai-career/database";
import { OpportunityList } from "@/components/dashboard/opportunity-list";
import { UsageTotals } from "@/components/dashboard/usage-totals";
import { ActiveFilters } from "@/components/dashboard/active-filters";
import { NeedsAttention, PipelineOverview } from "@/components/dashboard/dashboard-summary";
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
  withChanges,
  type SearchParamsInput,
} from "@/server/opportunity-query";

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

  let result: OpportunityListPage | null = null;
  try {
    result = await getOpportunityListReader().listPage({
      filters: toListFilters(query),
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

  const [summary, filterOptions, usageTotals, budgetStatus] = await Promise.all([
    new PrismaOpportunityDashboardRepository().summarize().catch((error: unknown): DashboardSummary | null => {
      logFailure("Opportunity dashboard could not load the summary", error);
      return null;
    }),
    new PrismaOpportunityDashboardRepository().filterOptions().catch((error: unknown): DashboardFilterOptions => {
      logFailure("Opportunity dashboard could not load filter options", error);
      return { sources: [], domains: [], companies: [] };
    }),
    new PrismaUsageSummaryRepository().summarizeAllUsage().catch((error: unknown): UsageTotalsData | null => {
      logFailure("Opportunity dashboard could not load AI usage totals", error);
      return null;
    }),
    getBudgetService().status().catch((error: unknown): BudgetStatusView | null => {
      logFailure("Opportunity dashboard could not load the AI budget", error);
      return null;
    }),
  ]);
  const companyNames = Object.fromEntries(filterOptions.companies.map((company) => [company.id, company.name]));
  const filtered = hasActiveFilters(query);

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>{platformMetadata.name}</h1>
          <p>Search, filter, and prioritize the opportunities you are tracking.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link href="/profile" className="button-link button-link-secondary">
            Profile &amp; preferences
          </Link>
          <Link href="/budget" className="button-link button-link-secondary">
            Budget
          </Link>
          <Link href="/opportunities/new" className="button-link">
            New opportunity
          </Link>
        </div>
      </div>

      {summary ? <NeedsAttention summary={summary} /> : null}

      <section aria-labelledby="opportunities-title">
        <h2 id="opportunities-title">Opportunities</h2>
        <nav className="view-tabs" aria-label="Opportunity views">
          {viewTabs.map((tab) => (
            <Link
              key={tab.key}
              href={opportunityHref(withChanges(query, { view: tab.key }))}
              aria-current={tab.key === query.view ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <OpportunityFilters query={query} options={filterOptions} />
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
            />
            {result.total === 0 && (filtered || (summary?.total ?? 0) > 0) ? (
              // Something exists, but not here: distinguish "no matches" from
              // the first-run "no opportunities yet" state.
              <div className="empty-state" role="status">
                <p>{filtered ? "No opportunities match these filters." : "No opportunities in this view."}</p>
                {filtered ? <Link href={opportunityHref(clearFilters(query))}>Clear all filters</Link> : null}
              </div>
            ) : (
              <OpportunityList opportunities={result.items} />
            )}
            <Pagination query={query} page={result.page} pageCount={result.pageCount} />
          </>
        )}
      </section>

      {summary ? <PipelineOverview summary={summary} /> : null}
      {budgetStatus ? <BudgetCard status={budgetStatus} /> : null}
      {usageTotals ? <UsageTotals totals={usageTotals} /> : null}
    </main>
  );
}
