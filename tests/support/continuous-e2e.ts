// Continuous capture end-to-end fixtures (November 15, 2026), shared by the
// Playwright spec (which answers the synthetic search pages in Chromium) and
// the Mode B helper (whose fixture browser answers the same job pages to the
// server-side reader). Every page is on a reserved .invalid host.
//
// Two synthetic searches, one per kind of continuation:
// - "See more jobs" on jobs.e2e.invalid/search?scenario=<s>&run=<run>: the
//   first 25 cards, the site's own "See more jobs" button appending 25 more
//   (the page's script), and its end marker shown only once every card is
//   loaded, as LinkedIn's public search does;
// - numbered pages on pages.e2e.invalid/search?scenario=<s>&run=<run>&page=N,
//   with the site's own pagination (or, for the "nopages" scenario, none).
import { testSiteJobPage } from "./page-capture-pages";

export interface ContinuousScenario {
  kind: "show-more" | "pages";
  total: number;
  // 1-based positions of the jobs already captured before the run.
  captured: number[];
  // Numbered pages: jobs per page.
  pageSize?: number;
  pagination?: boolean;
  // "See more jobs" behaviours (November 18, 2026): the first presses add
  // only links to jobs already shown, and the cards each later press adds
  // get their titles only after a delay (rendered late).
  repeatLoads?: number;
  lateTitlesMs?: number;
  // 1-based positions of jobs whose titles are outside the target job
  // titles (November 22, 2026): never batched, read or saved.
  outsideTitles?: number[];
}

export const continuousScenarios: Record<string, ContinuousScenario> = {
  // 60 jobs, 10 captured before: 50 eligible, exactly two batches.
  a: { kind: "show-more", total: 60, captured: [1, 2, 3, 4, 5, 26, 27, 28, 29, 30] },
  // 63 jobs, 10 captured before: 53 eligible, 25 + 25 + a final 3.
  b: { kind: "show-more", total: 63, captured: [3, 6, 9, 12, 15, 18, 21, 24, 40, 50] },
  // 6 pages of 10 and one of 7, 5 captured before: 62 eligible, 25 + 25 + 12.
  pages: { kind: "pages", total: 67, pageSize: 10, captured: [2, 13, 24, 35, 46], pagination: true },
  // Two pages and no pagination the reader recognizes: the end is never confirmed.
  nopages: { kind: "pages", total: 20, pageSize: 10, captured: [], pagination: false },
  // Stop and Resume.
  stop: { kind: "show-more", total: 40, captured: [] },
  // 50 jobs: four presses that only repeat shown jobs (the old rule stopped
  // after three), then cards whose titles render 6 s late: 25 + 25.
  late: { kind: "show-more", total: 50, captured: [], repeatLoads: 4, lateTitlesMs: 6_000 },
  // 70 jobs, 20 of them outside the target job titles (every other job of
  // the first 40): 50 eligible, 25 + 25, and the outside ones take no slot.
  titles: { kind: "show-more", total: 70, captured: [], outsideTitles: Array.from({ length: 20 }, (_unused, index) => index * 2 + 1) },
};

const host = (kind: ContinuousScenario["kind"]) => (kind === "show-more" ? "jobs.e2e.invalid" : "pages.e2e.invalid");
export const continuousJobId = (scenario: string, run: string, index: number) => `cc-${scenario}-${run}-${index}`;
export const continuousJobUrl = (scenario: string, run: string, index: number) =>
  `https://${host(continuousScenarios[scenario]!.kind)}/jobs/${continuousJobId(scenario, run, index)}`;
export const continuousSearchUrl = (scenario: string, run: string) =>
  `https://${host(continuousScenarios[scenario]!.kind)}/search?scenario=${scenario}&run=${run}${continuousScenarios[scenario]!.kind === "pages" ? "&page=1" : ""}`;
export const capturedBefore = (scenario: string, run: string) => continuousScenarios[scenario]!.captured.map((index) => continuousJobUrl(scenario, run, index));
export const eligible = (scenario: string, run: string) => {
  const spec = continuousScenarios[scenario]!;
  return Array.from({ length: spec.total }, (_unused, index) => index + 1)
    .filter((index) => !spec.captured.includes(index) && !(spec.outsideTitles ?? []).includes(index))
    .map((index) => continuousJobUrl(scenario, run, index));
};

const card = (scenario: string, run: string, index: number) => {
  const id = continuousJobId(scenario, run, index);
  const url = continuousJobUrl(scenario, run, index);
  const title = (continuousScenarios[scenario]!.outsideTitles ?? []).includes(index) ? `Payroll Support Representative ${index}` : `Customer Success Manager ${index}`;
  return `<li class="card" data-job-id="${id}"><a class="card-title" href="${url}">${title}</a><span class="card-company">Continuous ${run}</span><span class="card-location">Remote, United States</span><span class="card-posted">1 day ago</span></li>`;
};

function showMorePage(scenario: string, run: string, spec: ContinuousScenario): string {
  const cards = Array.from({ length: spec.total }, (_unused, index) => card(scenario, run, index + 1));
  // The cards not loaded yet are kept in a template, as a page's script keeps
  // its next results; "See more jobs" moves 25 more into the list.
  return `<!doctype html><html><head><title>Continuous ${scenario}</title><style>.hidden{display:none}</style></head><body><main>
<ul class="results">${cards.slice(0, 25).join("\n")}</ul>
<template id="more">${cards.slice(25).join("\n")}</template>
<button class="show-more" type="button">See more jobs</button>
<div class="viewed-all hidden" role="alert">You've viewed all jobs for this search</div>
<script>
  let repeats = ${spec.repeatLoads ?? 0};
  const lateMs = ${spec.lateTitlesMs ?? 0};
  document.querySelector("button.show-more").addEventListener("click", () => {
    const more = document.getElementById("more");
    const list = document.querySelector("ul.results");
    if (repeats > 0) {
      // The site answers with jobs it already showed.
      repeats -= 1;
      for (const shown of [...list.children].slice(0, 5)) list.appendChild(shown.cloneNode(true));
      return;
    }
    const items = [...more.content.children].slice(0, 25);
    for (const item of items) {
      if (lateMs) {
        const title = item.querySelector(".card-title");
        const text = title.textContent;
        title.textContent = "";
        setTimeout(() => { title.textContent = text; }, lateMs);
      }
      list.appendChild(item);
    }
    if (!more.content.children.length) {
      document.querySelector("button.show-more").setAttribute("disabled", "");
      document.querySelector(".viewed-all").classList.remove("hidden");
    }
  });
</script></main></body></html>`;
}

function numberedPage(scenario: string, run: string, spec: ContinuousScenario, page: number): string {
  const size = spec.pageSize ?? 10;
  const last = Math.ceil(spec.total / size);
  const first = (page - 1) * size;
  const indexes = Array.from({ length: Math.max(0, Math.min(size, spec.total - first)) }, (_unused, offset) => first + offset + 1);
  const list = indexes.length ? `<ul class="results">${indexes.map((index) => card(scenario, run, index)).join("\n")}</ul>` : `<p class="no-results">No jobs match this search.</p>`;
  const link = (number: number) => `/search?scenario=${scenario}&run=${run}&page=${number}`;
  const nav = spec.pagination
    ? `<nav aria-label="Pagination">${Array.from({ length: last }, (_unused, index) => index + 1)
        .map((number) => `<a href="${link(number)}"${number === page ? ' aria-current="page"' : ""}>${number}</a>`)
        .join(" ")}${page < last ? ` <a rel="next" href="${link(page + 1)}">Next</a>` : ""}</nav>`
    : "";
  return `<!doctype html><html><head><title>Continuous ${scenario} page ${page}</title></head><body><main>${list}${nav}</main></body></html>`;
}

// The page a continuous-capture URL answers with, or null.
export function continuousPageFor(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.pathname.replace(/\/+$/, "") === "/search") {
    const scenario = parsed.searchParams.get("scenario") ?? "";
    const run = parsed.searchParams.get("run") ?? "";
    const spec = continuousScenarios[scenario];
    if (!spec || !run) return null;
    return spec.kind === "show-more" ? showMorePage(scenario, run, spec) : numberedPage(scenario, run, spec, Number(parsed.searchParams.get("page") ?? "1"));
  }
  const job = /^\/jobs\/(cc-([a-z]+)-([a-z0-9]+)-(\d+))\/?$/.exec(parsed.pathname);
  if (!job) return null;
  return testSiteJobPage({
    id: job[1]!,
    title: `Customer Success Manager ${job[4]}`,
    company: `Continuous ${job[3]}`,
    description: "<p>Own a portfolio of B2B SaaS customers from onboarding through renewal.</p><p>This is a fully remote role. Base salary $72,000-$88,000.</p>",
  });
}
