// Mode B end-to-end fixtures, shared by the Playwright spec (which answers
// the synthetic results and job pages in Chromium) and the acquisition helper
// (whose fixture browser answers the same job pages to the server-side
// reader). Every page is on the reserved jobs.e2e.invalid host, so nothing
// can reach a real site.
import { testSiteJobPage, testSiteResultsPage } from "./page-capture-pages";

export const e2eResultsUrl = "https://jobs.e2e.invalid/search";

export type E2eBatchJobName = "evaluate" | "review" | "reject" | "later";

export interface E2eBatchJob {
  name: E2eBatchJobName;
  id: string;
  url: string;
  title: string;
  company: string;
}

const salaries: Record<E2eBatchJobName, string | null> = {
  // A definite compatible salary: the triage lets it through to admission.
  evaluate: "$72,000-$88,000",
  // No salary stated: a hard-constraint fact is Unknown, so Needs Review.
  review: null,
  // A definite ceiling below the profile's hard minimum: Reject.
  reject: "$45,000-$50,000",
  later: "$72,000-$88,000",
};

export function e2eBatchJobs(run: string): E2eBatchJob[] {
  return (["evaluate", "review", "reject", "later"] as const).map((name) => {
    const id = `${name}-${run}`;
    return { name, id, url: `https://jobs.e2e.invalid/jobs/${id}`, title: `Customer Success Manager ${name} ${run}`, company: `Batch ${name} ${run}` };
  });
}

export function e2eJobPage(job: E2eBatchJob): string {
  const salary = salaries[job.name];
  return testSiteJobPage({
    id: job.id,
    title: job.title,
    company: job.company,
    description: [
      "<p>Customer Success Manager for a workflow SaaS platform.</p>",
      "<p>This is a fully remote role. Applicants must reside in the United States.</p>",
      salary ? `<p>Base salary ${salary}.</p>` : "<p>Compensation is not stated.</p>",
      "<p>Own onboarding, adoption, education, and retention for a portfolio of B2B customers.</p>",
    ].join(""),
  });
}

// The results page: the four jobs, plus one card the page has not rendered
// yet (skipped and counted) and a detail pane that is not a result.
export function e2eResultsPage(run: string): string {
  return testSiteResultsPage([
    ...e2eBatchJobs(run).map((job) => ({ id: job.id, title: job.title, company: job.company, location: "Remote, United States", posted: "1 day ago" })),
    { id: `placeholder-${run}`, unloaded: true },
  ]);
}

// The page a URL on the test host answers with, or null (404).
export function e2ePageFor(run: string, url: string): string | null {
  const clean = url.split(/[?#]/)[0]!.replace(/\/+$/, "");
  if (clean === e2eResultsUrl) return e2eResultsPage(run);
  const job = e2eBatchJobs(run).find((candidate) => candidate.url === clean);
  return job ? e2eJobPage(job) : null;
}
