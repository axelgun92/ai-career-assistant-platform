import { connection } from "next/server";
import { SourceInsightsWindowError } from "@ai-career/core";
import {
  InsightsControls,
  InsightsSummary,
  RowNotes,
  SourceComparisonTable,
  SourcesSectionNav,
  windowDescription,
} from "@/components/sources/source-insights";
import { getSourceInsightsService, type SourceInsightsOverview } from "@/server/source-intelligence-service";

export const metadata = { title: "Source insights" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// Source Intelligence (feature 15): what each source contributes, from the
// recorded history. Evidence only; source decisions stay with you.
export default async function SourceInsightsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  let overview: SourceInsightsOverview;
  try {
    overview = await getSourceInsightsService().overview({
      window: one(params.window),
      from: one(params.from),
      to: one(params.to),
      groupBy: one(params.groupBy),
      archived: one(params.archived),
      sort: one(params.sort),
    });
  } catch (error) {
    const invalid = error instanceof SourceInsightsWindowError;
    if (!invalid) console.error("Source insights could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Source insights</h1>
        <SourcesSectionNav current="insights" />
        <p className="error-message" role="alert">
          {invalid ? `${error.message}. ` : "Source insights could not be loaded. Check the database connection and try again. "}
          <a href="/sources/insights">Show the last 30 days</a>
        </p>
      </main>
    );
  }
  const automatedRows = overview.automated;
  return (
    <main className="sources-page">
      <h1>Source insights</h1>
      <SourcesSectionNav current="insights" />
      <p>
        What each source has contributed, from what actually happened: listings found, new jobs, duplicates, evaluations, applications, interviews, offers
        and evaluation cost. Each job is credited to the source that found it first; other sources that also listed it show as presence and are never
        added to the totals. Jobs waiting on the AI budget or a usage limit, not yet evaluated, or not evaluated because of a failure never count against a
        source. These figures are evidence only: nothing here changes, ranks or disables a source.
      </p>
      <InsightsControls overview={overview} />
      {overview.historyStartsAt && overview.window.from && overview.window.from < overview.historyStartsAt ? (
        <p className="muted">Automated retrieval history starts {overview.historyStartsAt.toISOString().slice(0, 10)}; earlier figures come from manual entries only.</p>
      ) : null}
      <InsightsSummary overview={overview} />

      <section aria-labelledby="automated-heading">
        <h2 id="automated-heading">Automated sources ({automatedRows.length})</h2>
        <p className="muted">
          Rates show their counts. Under 5 is labelled insufficient sample and is never used to order sources; 5 to 19 is a small sample.
        </p>
        {automatedRows.length ? (
          <SourceComparisonTable rows={automatedRows} overview={overview} caption={`Automated sources, ${windowDescription(overview.window).toLowerCase()}`} />
        ) : (
          <p>No automated sources yet. Add one on Manage sources.</p>
        )}
        {automatedRows.some((row) => row.notes.length) ? (
          <details className="source-details">
            <summary>Notes on these sources</summary>
            {automatedRows
              .filter((row) => row.notes.length)
              .map((row) => (
                <div key={row.key}>
                  <h3>{row.name}</h3>
                  <RowNotes row={row} />
                </div>
              ))}
          </details>
        ) : null}
      </section>

      <section aria-labelledby="user-collected-heading">
        <h2 id="user-collected-heading">User-collected ({overview.userCollected.length})</h2>
        <p className="muted">
          Jobs you saved with the browser extension or entered yourself. You chose them, so they are shown separately and never compared with or ranked
          against automated sources.
        </p>
        {overview.userCollected.length ? (
          <SourceComparisonTable rows={overview.userCollected} overview={overview} caption={`User-collected, ${windowDescription(overview.window).toLowerCase()}`} />
        ) : (
          <p>No user-collected jobs in this window.</p>
        )}
      </section>
    </main>
  );
}
