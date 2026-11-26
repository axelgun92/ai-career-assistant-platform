import { JSDOM } from "jsdom";
import { extractJobPosting, type PageExtraction } from "../../apps/extension/src/extract";

// Feature 14B: synthetic job pages for the extension's page reader, and a
// runner that executes the reader the way Chrome does: its source text,
// serialized and evaluated inside the page (here a jsdom window), with no
// arguments. The pages are modelled on the public layouts the reader
// targets; none is a captured response, and nothing reaches the network.

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function runExtractor(html: string, url: string, options: { select?: string } = {}): PageExtraction & { pageMarkers: string[] } {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const window = dom.window;
  // Markers a hostile page could set if the reader ran or inserted its HTML.
  window.eval("window.__markers = [];");
  if (options.select) {
    const target = window.document.querySelector(options.select);
    if (!target) throw new Error(`No element matches ${options.select}`);
    const range = window.document.createRange();
    range.selectNodeContents(target);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  }
  const result = window.eval(`(${extractJobPosting.toString()})()`) as PageExtraction;
  const pageMarkers = [...(window.eval("window.__markers") as string[])];
  // Plain data crosses back, as through chrome.scripting.
  return { ...(JSON.parse(JSON.stringify(result)) as PageExtraction), pageMarkers };
}

export function jsonLdPage(options: {
  title: string;
  descriptionHtml: string;
  company?: string;
  extra?: Record<string, unknown>;
  bodyHtml?: string;
  rawJsonLd?: string;
}): string {
  const posting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: options.title,
    description: options.descriptionHtml,
    hiringOrganization: { "@type": "Organization", name: options.company ?? "Acme" },
    ...options.extra,
  };
  const script = options.rawJsonLd ?? JSON.stringify(posting).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><title>${escape(options.title)}</title>
<script type="application/ld+json">${script}</script></head>
<body>${options.bodyHtml ?? `<main><h1>${escape(options.title)}</h1></main>`}</body></html>`;
}

// Text that must never appear in what the reader returns from a LinkedIn
// page: account, profile, messaging and feed content around the job.
export const linkedInDecoys = {
  profile: "Alex Example — Customer Success Lead at Previous Co",
  message: "Private message: are you free for a call on Friday?",
  feed: "Feed post: Congratulations on the new role!",
  nav: "My Network Notifications Me",
  cookie: "li_at=secret-session-cookie",
};

export function linkedInLoggedInPage(options: {
  id: string;
  title?: string;
  company?: string;
  location?: string;
  descriptionHtml?: string;
  // Older or renamed class names, as after a LinkedIn redesign.
  renamed?: boolean;
  emptyDescription?: boolean;
}): string {
  const title = options.title ?? "Senior Customer Success Manager";
  const description = options.descriptionHtml ?? "<p>Own a book of enterprise customers.</p><ul><li>Drive adoption</li><li>Lead renewals</li></ul>";
  const prefix = options.renamed ? "jobs-redesigned-card" : "job-details-jobs-unified-top-card";
  return `<!doctype html><html><head><title>(3) ${escape(title)} | ${escape(options.company ?? "Acme")} | LinkedIn</title></head><body>
<header class="global-nav"><nav><a>${linkedInDecoys.nav}</a></nav><div class="global-nav__me">${linkedInDecoys.profile}</div></header>
<main class="scaffold-layout__main">
  <div class="scaffold-layout__list"><div class="feed-shared-update-v2">${linkedInDecoys.feed}</div></div>
  <div class="jobs-search__job-details--container">
    <div class="${prefix}__container--two-pane">
      <div class="${prefix}__job-title"><h1 class="t-24 t-bold">${escape(title)}</h1></div>
      <div class="${prefix}__company-name"><a href="https://www.linkedin.com/company/acme/">${escape(options.company ?? "Acme")}</a></div>
      <div class="${prefix}__tertiary-description-container"><span class="tvm__text">${escape(options.location ?? "Denver, CO")}</span><span class="tvm__text"> · 2 days ago</span></div>
    </div>
    <div class="${options.renamed ? "jobs-redesigned-description" : "jobs-description__content"}">
      <div id="${options.renamed ? "job-details-renamed" : "job-details"}">${options.emptyDescription ? "" : description}</div>
    </div>
  </div>
</main>
<aside class="msg-overlay-list-bubble"><div class="msg-s-event-listitem__body">${linkedInDecoys.message}</div></aside>
<script>document.cookie = "${linkedInDecoys.cookie}";</script>
</body></html>`;
}
