import Link from "next/link";
import { connection } from "next/server";
import { pageCaptureSites } from "@ai-career/core";
import { formatDateTime } from "@/components/budget/budget-format";
import { ExtensionNav } from "@/components/extension/extension-nav";
import { PageCaptureTable } from "@/components/extension/page-capture-list";
import {
  capturedJobs,
  pageCaptureFilters,
  pageCapturePageSize,
  type CaptureMethodFilter,
  type CaptureSessionView,
  type PageCaptureFilter,
} from "@/server/page-capture-progress";

export const metadata = { title: "Captured Jobs" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const filterLabels: Record<PageCaptureFilter, string> = {
  waiting: "Waiting",
  added: "Added",
  unavailable: "No longer available",
  dismissed: "Dismissed",
  all: "All",
};

const methodLabels: Record<CaptureMethodFilter, string> = {
  all: "All captures",
  single: "Single job",
  batch: "Results pages",
};

function sessionCounts(session: CaptureSessionView) {
  const parts = [`${session.added} added`];
  if (session.pending) parts.push(`${session.pending} getting details`);
  if (session.awaiting) parts.push(`${session.awaiting} awaiting details`);
  if (session.unavailable) parts.push(`${session.unavailable} no longer available`);
  if (session.dismissed) parts.push(`${session.dismissed} dismissed`);
  return `${session.jobs} job${session.jobs === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

// Captured Jobs: every job the browser extension captured, whether saved
// alone (Single Job) or from a results page (Batch Capture), one row per
// job, with its current state. Capture history is here too: each results-page
// save can be opened with its own jobs. Pre-evaluator triage decisions are
// made on a job's own page; nothing is decided here.
export default async function CapturedJobsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const requested = one(params.status);
  const filter: PageCaptureFilter = requested && (requested === "all" || requested in pageCaptureFilters) ? (requested as PageCaptureFilter) : "all";
  const methodParam = one(params.method);
  const method: CaptureMethodFilter = methodParam === "single" || methodParam === "batch" ? methodParam : "all";
  const siteParam = one(params.site);
  const site = siteParam && pageCaptureSites.some((spec) => spec.key === siteParam) ? siteParam : null;
  const sessionParam = one(params.session);
  const sessionId = sessionParam && uuidPattern.test(sessionParam) ? sessionParam : null;
  const page = Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1);
  let view;
  try {
    view = await capturedJobs({ method, filter, site, sessionId, page });
  } catch (error) {
    console.error("Captured jobs could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <p className="eyebrow">Browser extension</p>
        <h1>Captured Jobs</h1>
        <ExtensionNav current="jobs" />
        <p className="error-message" role="alert">
          The jobs could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }
  const pages = Math.max(1, Math.ceil(view.total / pageCapturePageSize));
  const href = (overrides: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const values = { method, status: filter, site, session: sessionId, page: String(page), ...overrides };
    for (const [key, value] of Object.entries(values)) {
      if (!value || (key === "page" && value === "1") || (key === "status" && value === "all") || (key === "method" && value === "all")) continue;
      query.set(key, value);
    }
    const text = query.toString();
    return `/extension/jobs${text ? `?${text}` : ""}`;
  };
  const links = <K extends string>(labels: Record<K, string>, current: K, key: string, name: string) => (
    <nav className="filter-links" aria-label={name}>
      {(Object.keys(labels) as K[]).map((value) =>
        value === current ? (
          <strong key={value}>{labels[value]}</strong>
        ) : (
          <Link key={value} href={href({ [key]: value, page: "1" })}>
            {labels[value]}
          </Link>
        ),
      )}
    </nav>
  );
  const realSites = pageCaptureSites.filter((spec) => !spec.testOnly);

  return (
    <main className="sources-page">
      <p className="eyebrow">Browser extension</p>
      <h1>Captured Jobs</h1>
      <ExtensionNav current="jobs" />
      <p>
        Every job you saved with the browser extension: one at a time with <strong>Single Job</strong>, or from a results page with{" "}
        <strong>Batch Capture</strong>. A results-page job&apos;s full posting is read automatically where that is enabled for its site; every added
        job then goes through the same steps as any other. A job that needs review before evaluation waits for your decision on its page.
      </p>

      {view.session ? (
        <section className="capture-session" aria-labelledby="session-heading">
          <h2 id="session-heading">
            Capture from {view.session.siteName}, {formatDateTime(view.session.receivedAt)}
          </h2>
          <p className="muted">
            {view.session.pageTitle ? `${view.session.pageTitle} · ` : ""}
            <a href={view.session.pageUrl} rel="noreferrer noopener" target="_blank">
              Results page ↗
            </a>{" "}
            · <Link href="/extension/jobs">All captured jobs</Link>
          </p>
        </section>
      ) : (
        <>
          {links(methodLabels, method, "method", "Capture method")}
          <nav className="filter-links" aria-label="Site">
            {site === null ? <strong>All sites</strong> : <Link href={href({ site: null, page: "1" })}>All sites</Link>}
            {realSites.map((spec) =>
              spec.key === site ? (
                <strong key={spec.key}>{spec.name}</strong>
              ) : (
                <Link key={spec.key} href={href({ site: spec.key, page: "1" })}>
                  {spec.name}
                </Link>
              ),
            )}
          </nav>
        </>
      )}
      {links(filterLabels, filter, "status", "Filter jobs")}
      <PageCaptureTable rows={view.rows} />
      {pages > 1 ? (
        <p>
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : null} Page {page} of {pages}{" "}
          {page < pages ? <Link href={href({ page: String(page + 1) })}>Next</Link> : null}
        </p>
      ) : null}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Capture history</h2>
        {view.sessions.length ? (
          <ul className="capture-history">
            {view.sessions.map((session) => (
              <li key={session.id}>
                <Link href={`/extension/jobs?session=${session.id}`} aria-current={session.id === sessionId ? "page" : undefined}>
                  {session.siteName}, {formatDateTime(session.receivedAt)}
                </Link>{" "}
                <span className="muted">
                  · {sessionCounts(session)}
                  {session.inProgress ? " · in progress" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No results-page captures yet. Single-job captures are listed above.</p>
        )}
        {view.sessionsTotal > view.sessions.length ? (
          <p className="muted">The {view.sessions.length} most recent captures are shown.</p>
        ) : null}
      </section>
    </main>
  );
}
