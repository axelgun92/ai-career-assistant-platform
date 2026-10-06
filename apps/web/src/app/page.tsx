import Link from "next/link";
import { connection } from "next/server";
import { platformMetadata } from "@ai-career/core";
import {
  PrismaUsageSummaryRepository,
  type OpportunityListItem,
  type UsageTotals as UsageTotalsData,
} from "@ai-career/database";
import { OpportunityList } from "@/components/dashboard/opportunity-list";
import { UsageTotals } from "@/components/dashboard/usage-totals";
import {
  defaultOpportunityListView,
  getOpportunityListReader,
  opportunityListViews,
  opportunityListViewSchema,
  type OpportunityListView,
} from "@/server/opportunity-list-service";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  await connection();
  const requested = (await searchParams).view;
  const parsedView = opportunityListViewSchema.safeParse(
    Array.isArray(requested) ? requested[0] : requested,
  );
  const view: OpportunityListView = parsedView.success
    ? parsedView.data
    : defaultOpportunityListView;

  let opportunities: OpportunityListItem[] | null = null;
  try {
    opportunities = await getOpportunityListReader().listOpportunities({
      statuses: opportunityListViews[view].statuses,
    });
  } catch (error) {
    console.error("Opportunity dashboard could not load opportunities", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  let usageTotals: UsageTotalsData | null = null;
  try {
    usageTotals = await new PrismaUsageSummaryRepository().summarizeAllUsage();
  } catch (error) {
    console.error("Opportunity dashboard could not load AI usage totals", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>{platformMetadata.name}</h1>
          <p>Opportunities you have added, newest first, with their latest persisted evaluation.</p>
        </div>
        <Link href="/opportunities/new" className="button-link">
          New opportunity
        </Link>
      </div>

      <section aria-labelledby="opportunities-title">
        <h2 id="opportunities-title">Opportunities</h2>
        <nav className="view-tabs" aria-label="Opportunity views">
          {(Object.keys(opportunityListViews) as OpportunityListView[]).map((key) => (
            <Link
              key={key}
              href={key === defaultOpportunityListView ? "/" : `/?view=${key}`}
              aria-current={key === view ? "page" : undefined}
            >
              {opportunityListViews[key].label}
            </Link>
          ))}
        </nav>
        {opportunities === null ? (
          <p className="error-message" role="alert">
            Opportunities could not be loaded. Check the database connection and try again.
          </p>
        ) : view !== defaultOpportunityListView && opportunities.length === 0 ? (
          <p className="empty-state">No opportunities in this view.</p>
        ) : (
          <OpportunityList opportunities={opportunities} />
        )}
      </section>

      {usageTotals ? <UsageTotals totals={usageTotals} /> : null}
    </main>
  );
}
