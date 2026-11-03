import Link from "next/link";
import { connection } from "next/server";
import { pageCaptureSites } from "@ai-career/core";
import { PageCaptureTable } from "@/components/extension/page-capture-list";
import { pageCaptureFilters, pageCapturePageSize, pageCaptureProgress, type PageCaptureFilter } from "@/server/page-capture-progress";

export const metadata = { title: "Jobs from results pages" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

const filterLabels: Record<PageCaptureFilter, string> = {
  waiting: "Waiting",
  added: "Added",
  unavailable: "No longer available",
  dismissed: "Dismissed",
  all: "All",
};

// Mode B progress: jobs the browser extension saved from a results page,
// from staging to added. Their details are read automatically where the
// site's detail reading is verified; each added job then goes through the
// pre-evaluator triage of the existing evaluation request.
export default async function PageCaptureJobsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const requested = one(params.status);
  const filter: PageCaptureFilter = requested && (requested === "all" || requested in pageCaptureFilters) ? (requested as PageCaptureFilter) : "all";
  const siteParam = one(params.site);
  const site = siteParam && pageCaptureSites.some((spec) => spec.key === siteParam) ? siteParam : null;
  const page = Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1);
  let progress;
  try {
    progress = await pageCaptureProgress({ filter, site, page });
  } catch (error) {
    console.error("Results-page jobs could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Jobs from results pages</h1>
        <p className="error-message" role="alert">
          The jobs could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }
  const pages = Math.max(1, Math.ceil(progress.total / pageCapturePageSize));
  const href = (overrides: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const values = { status: filter, site, page: String(page), ...overrides };
    for (const [key, value] of Object.entries(values)) if (value && !(key === "page" && value === "1") && !(key === "status" && value === "all")) query.set(key, value);
    const text = query.toString();
    return `/extension/jobs${text ? `?${text}` : ""}`;
  };
  return (
    <main className="sources-page">
      <p>
        <Link href="/extension">← Browser extension</Link>
      </p>
      <h1>Jobs from results pages</h1>
      <p>
        Jobs you saved with <strong>Save jobs on this page</strong>. Their full postings are read automatically where that is verified for the site;
        each job then goes through the same steps as any other: it is added, checked before evaluation, and evaluated within your budget. A job that
        needs review before evaluation waits for your decision on its page. You never have to open these jobs one by one; <strong>Open job</strong>{" "}
        and the extension&apos;s <strong>Read this page</strong> stay available for any of them.
      </p>
      <nav className="filter-links" aria-label="Filter jobs">
        {(Object.keys(filterLabels) as PageCaptureFilter[]).map((key) =>
          key === filter ? (
            <strong key={key}>{filterLabels[key]}</strong>
          ) : (
            <Link key={key} href={href({ status: key, page: "1" })}>
              {filterLabels[key]}
            </Link>
          ),
        )}
      </nav>
      <PageCaptureTable rows={progress.rows} />
      {pages > 1 ? (
        <p>
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : null} Page {page} of {pages}{" "}
          {page < pages ? <Link href={href({ page: String(page + 1) })}>Next</Link> : null}
        </p>
      ) : null}
    </main>
  );
}
