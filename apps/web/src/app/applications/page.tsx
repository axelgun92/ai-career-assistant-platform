import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { utcToday } from "@ai-career/core";
import {
  PrismaApplicationListRepository,
  type ApplicationListPage,
  type ApplicationTrackerSummary,
} from "@ai-career/database";
import { ApplicationFilters } from "@/components/application/application-filters";
import { ApplicationPagination, ApplicationTable, TrackerSummary } from "@/components/application/application-list";
import { getApplicationLister } from "@/server/application-service";
import {
  applicationCanonicalRedirect,
  applicationPageSize,
  applicationViews,
  applicationsHref,
  clearApplicationFilters,
  hasApplicationFilters,
  parseApplicationQuery,
  toApplicationListFilters,
  withApplicationChanges,
  type ApplicationView,
} from "@/server/application-query";
import type { SearchParamsInput } from "@/server/opportunity-query";

export const metadata = { title: "Applications" };

function logFailure(message: string, error: unknown) {
  console.error(message, { errorName: error instanceof Error ? error.name : "UnknownError" });
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = (await searchParams) as SearchParamsInput;
  const query = parseApplicationQuery(params);
  const today = utcToday();

  let result: ApplicationListPage | null = null;
  try {
    result = await getApplicationLister().listPage({
      filters: toApplicationListFilters(query),
      sort: query.sort,
      page: query.page,
      pageSize: applicationPageSize,
      today,
    });
  } catch (error) {
    logFailure("Applications could not be loaded", error);
  }
  if (result) {
    const target = applicationCanonicalRedirect(params, query, result.page);
    if (target) redirect(target);
  }
  const summary = await new PrismaApplicationListRepository()
    .summarize({ today })
    .catch((error: unknown): ApplicationTrackerSummary | null => {
      logFailure("Application summary could not be loaded", error);
      return null;
    });
  const filtered = hasApplicationFilters(query);

  return (
    <main className="dashboard applications-page">
      <div className="dashboard-header">
        <div>
          <h1>Applications</h1>
          <p>Every application you are tracking, with its stage and next action. Dates are UTC calendar dates.</p>
        </div>
      </div>
      {summary ? <TrackerSummary summary={summary} /> : null}
      <section aria-labelledby="applications-title">
        <h2 id="applications-title">Tracked applications</h2>
        <nav className="view-tabs" aria-label="Application views">
          {(Object.keys(applicationViews) as ApplicationView[]).map((view) => (
            <Link
              key={view}
              href={applicationsHref(withApplicationChanges(query, { view }))}
              aria-current={view === query.view ? "page" : undefined}
            >
              {applicationViews[view]}
            </Link>
          ))}
        </nav>
        <ApplicationFilters query={query} />
        {result === null ? (
          <p className="error-message" role="alert">
            Applications could not be loaded. Check the database connection and try again.
          </p>
        ) : result.total === 0 ? (
          <div className="empty-state" role="status">
            <p>
              {filtered
                ? "No applications match these filters."
                : "No applications in this view. Start tracking one from an opportunity's page."}
            </p>
            {filtered ? <Link href={applicationsHref(clearApplicationFilters(query))}>Clear all filters</Link> : null}
          </div>
        ) : (
          <>
            <p className="result-count" role="status">
              Showing {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.total)} of{" "}
              {result.total} applications
            </p>
            <ApplicationTable items={result.items} />
            <ApplicationPagination query={query} page={result.page} pageCount={result.pageCount} />
          </>
        )}
      </section>
    </main>
  );
}
