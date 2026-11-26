import { JSDOM } from "jsdom";
import { pageCaptureMaxCards, pageCaptureSiteByKey } from "../../packages/core/src/page-capture";
import { readResultCards, type ResultCardsReading } from "../../apps/extension/src/results";

// Mode B (results-page capture): synthetic results pages for the reader, and
// a runner that executes the reader the way Chrome does: its source text,
// serialized and evaluated inside the page (a jsdom window) with the site's
// spec as its only argument. The pages are modelled on the general shape of
// the sites' results lists; none is a captured response, and nothing reaches
// the network. Real-markup fixtures come from the F0 export step.

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function runResultsReader(html: string, url: string, siteKey: string): ResultCardsReading & { calls: string[] } {
  const site = pageCaptureSiteByKey(siteKey);
  if (!site) throw new Error(`Unknown site ${siteKey}`);
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const window = dom.window;
  // Spies: the reader must never scroll, click, open windows or navigate.
  window.eval(`
    window.__calls = [];
    const record = (name) => function () { window.__calls.push(name); };
    window.scrollTo = record("scrollTo");
    window.scrollBy = record("scrollBy");
    window.open = record("open");
    HTMLElement.prototype.click = record("click");
    Element.prototype.scrollIntoView = record("scrollIntoView");
    window.fetch = record("fetch");
  `);
  const input = { ...site.reader, maxCards: pageCaptureMaxCards };
  const result = window.eval(`(${readResultCards.toString()})(${JSON.stringify(input)})`) as ResultCardsReading;
  const calls = [...(window.eval("window.__calls") as string[])];
  return { ...(JSON.parse(JSON.stringify(result)) as ResultCardsReading), calls };
}

export interface CardSpec {
  id: string;
  title?: string;
  company?: string;
  location?: string;
  posted?: string;
  // An empty placeholder the page has not rendered yet.
  unloaded?: boolean;
  hidden?: boolean;
}

// A logged-in LinkedIn jobs search page: the account header, a list of job
// cards (some not yet rendered), the selected job's detail pane, and a
// recommendations module, with decoys that must never be read.
export function linkedInResultsPage(cards: CardSpec[], options: { detailId?: string } = {}): string {
  const items = cards
    .map((card) => {
      if (card.unloaded) return `<li class="jobs-search-results__list-item" data-occludable-job-id="${card.id}"></li>`;
      return `<li class="jobs-search-results__list-item" data-occludable-job-id="${card.id}"${card.hidden ? ' style="display:none"' : ""}>
  <div class="job-card-container" data-job-id="${card.id}">
    <a class="job-card-list__title" href="/jobs/view/${card.id}/?refId=abc&trackingId=xyz">${escape(card.title ?? `Customer Success Manager ${card.id}`)}</a>
    <div class="artdeco-entity-lockup__subtitle">${escape(card.company ?? "Acme")}</div>
    <ul><li class="job-card-container__metadata-item">${escape(card.location ?? "United States (Remote)")}</li></ul>
    <ul class="job-card-list__footer-wrapper"><li>Viewed</li><li><time datetime="2026-11-01">${escape(card.posted ?? "2 days ago")}</time></li></ul>
  </div>
</li>`;
    })
    .join("\n");
  return `<!doctype html><html><head><title>Customer Success jobs | LinkedIn</title></head><body>
<header class="global-nav"><nav><a href="/feed/">Home</a><a href="/jobs/view/9999999999/">Nav job link</a></nav><div class="global-nav__me">Alex Example — Customer Success Lead</div></header>
<main class="scaffold-layout__main">
  <div class="scaffold-layout__list"><ul class="scaffold-layout__list-container">${items}</ul></div>
  <div class="jobs-search__job-details--container">
    <a href="/jobs/view/${options.detailId ?? "8888888888"}/">Selected job title in the detail pane</a>
    <div class="jobs-description">Private detail text</div>
  </div>
  <section class="jobs-home-recommendations"><h2>Jobs you may be interested in</h2>
    <a href="/jobs/view/7777777777/">Recommended job</a></section>
</main>
<aside class="msg-overlay-container"><a href="/jobs/view/6666666666/">Message mentioning a job</a></aside>
</body></html>`;
}

// A Welcome to the Jungle search page: job cards linking to company job
// pages, and a "Similar jobs" block that is not part of the results.
export function wttjResultsPage(cards: CardSpec[]): string {
  const items = cards
    .map(
      (card) => `<li data-testid="search-results-list-item-wrapper">
  <a href="/en/companies/acme-${card.id}/jobs/customer-success-manager_paris-${card.id}?q=abc&o=1"><h4>${escape(card.title ?? `Customer Success Manager ${card.id}`)}</h4></a>
  <span>${escape(card.company ?? "Acme")}</span>
</li>`,
    )
    .join("\n");
  return `<!doctype html><html><head><title>Customer success jobs | Welcome to the Jungle</title></head><body>
<header><nav><a href="/en/companies/nav-co/jobs/nav-job_paris">Nav job</a></nav></header>
<main><ol>${items}</ol>
  <section><h2>Similar jobs</h2><a href="/en/companies/other/jobs/similar-role_lyon">Similar role</a></section>
</main></body></html>`;
}

// The synthetic end-to-end test site (jobs.e2e.invalid).
export function testSiteResultsPage(cards: CardSpec[]): string {
  const items = cards
    .map((card) =>
      card.unloaded
        ? `<li class="card" data-job-id="${card.id}"></li>`
        : `<li class="card" data-job-id="${card.id}"><a class="card-title" href="https://jobs.e2e.invalid/jobs/${card.id}">${escape(card.title ?? `Customer Success Manager ${card.id}`)}</a>
<span class="card-company">${escape(card.company ?? "Northwind")}</span><span class="card-location">${escape(card.location ?? "Remote, United States")}</span><span class="card-posted">${escape(card.posted ?? "1 day ago")}</span></li>`,
    )
    .join("\n");
  return `<!doctype html><html><head><title>Test results</title></head><body><main><ul class="results">${items}</ul>
<div class="detail-pane"><a href="https://jobs.e2e.invalid/jobs/detail-only">Detail pane job</a></div></main></body></html>`;
}

// A job detail page the single-job reader can read (schema.org JobPosting).
export function testSiteJobPage(input: { id: string; title?: string; company?: string; description?: string; salary?: { min: number; max: number; currency: string } | null; remote?: boolean }): string {
  const title = input.title ?? `Customer Success Manager ${input.id}`;
  const posting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title,
    description:
      input.description ??
      "<p>Own a portfolio of B2B SaaS customers from onboarding through renewal.</p><ul><li>Drive adoption and value realization</li><li>Run quarterly business reviews</li><li>Partner with Sales and Support on expansion</li></ul><p>Full-time.</p>",
    hiringOrganization: { "@type": "Organization", name: input.company ?? "Northwind" },
    employmentType: "FULL_TIME",
    datePosted: "2026-11-01",
    ...(input.remote === false
      ? { jobLocation: { "@type": "Place", address: { addressLocality: "Paris", addressCountry: "FR" } } }
      : { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "United States" } }),
    ...(input.salary
      ? { baseSalary: { "@type": "MonetaryAmount", currency: input.salary.currency, value: { "@type": "QuantitativeValue", minValue: input.salary.min, maxValue: input.salary.max, unitText: "YEAR" } } }
      : {}),
  };
  return `<!doctype html><html><head><title>${escape(title)}</title><script type="application/ld+json">${JSON.stringify(posting).replace(/</g, "\\u003c")}</script></head>
<body><main><h1>${escape(title)}</h1></main></body></html>`;
}
