import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pageCaptureSiteByKey, pageCaptureSiteForUrl } from "@ai-career/core";
import { AdapterError, createBrowserSession } from "@ai-career/discovery";
import { JSDOM } from "jsdom";
import { readJobPage } from "./page-capture-acquisition";

// pnpm page-capture:verify <site> <job URL> [<job URL> …] [--raw-dir <dir>]
//
// The bounded P1 verification experiment for Mode B (results-page capture):
// can this site's public job pages be read in a fresh, logged-out headless
// browser (RETRIEVAL_BROWSER_EXECUTABLE), the same access model as
// browser-assisted retrieval, so that batch-captured jobs get their details
// without anyone opening them? Run it only with Alex's authorization, from
// the local runtime, with at most 5 job URLs taken from that site's results
// page. It reads the pages one at a time, at least the site's interval
// apart, and the first refusal, sign-in wall, challenge or rate limit stops
// it with no further request and no retry. Each page is read by the accepted
// single-job reader. No database is read or written; nothing is ingested.
//
// The verdict is VIABLE only when every page loaded without friction and
// gave a readable posting (title and description). Otherwise the path is NOT
// VIABLE: stop, report it, and investigate no further unless Alex
// explicitly authorizes more.

const maxUrls = 5;

function fail(message: string): never {
  console.error(`[page-capture:verify] ${message}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const rawIndex = args.indexOf("--raw-dir");
  const rawDir = rawIndex >= 0 ? args[rawIndex + 1] : null;
  const positional = args.filter((_, index) => index !== rawIndex && index !== rawIndex + 1);
  const [siteKey, ...urls] = positional;
  const site = pageCaptureSiteByKey(siteKey);
  if (!site || site.testOnly) fail("Name a page-capture site: linkedin or welcome-to-the-jungle");
  if (!urls.length || urls.length > maxUrls) fail(`Give 1 to ${maxUrls} job URLs from the site's results page`);
  for (const url of urls) if (pageCaptureSiteForUrl(url)?.key !== site.key) fail(`Not a ${site.name} URL: ${url}`);
  if (rawDir && path.resolve(rawDir).startsWith(path.resolve(process.cwd()))) fail("--raw-dir must be outside the repository");
  const executablePath = process.env.RETRIEVAL_BROWSER_EXECUTABLE;
  if (!executablePath) fail("Set RETRIEVAL_BROWSER_EXECUTABLE to a Chromium or Chrome binary");

  const { launchBrowserDriver } = await import("@ai-career/browser-retrieval");
  const driver = await launchBrowserDriver({ executablePath });
  let lastHtml = "";
  const session = createBrowserSession(
    {
      async navigate(url, options) {
        const result = await driver.navigate(url, options);
        lastHtml = result.html;
        return result;
      },
      close: () => driver.close(),
    },
    {
      minIntervalMs: site.detail.minIntervalMs,
      maxNavigations: urls.length,
      authCookieNames: site.detail.authCookieNames,
      parse: (html, url) => new JSDOM(html, { url, runScripts: "outside-only" }).window.document,
    },
  );
  let readable = 0;
  let stopped: string | null = null;
  try {
    for (const [index, url] of urls.entries()) {
      try {
        const page = await session.open(url);
        if (rawDir) {
          mkdirSync(rawDir, { recursive: true });
          writeFileSync(path.join(rawDir, `${site.key}-${index + 1}.html`), lastHtml);
        }
        const extraction = readJobPage(page.document);
        const posting = extraction?.posting;
        const ok = Boolean(posting?.title && posting.description && posting.description.length >= 200);
        if (ok) readable += 1;
        console.info(
          `[page-capture:verify] ${index + 1}/${urls.length} HTTP ${page.status} ${ok ? "READABLE" : "NOT READABLE"} ` +
            `title=${posting?.title ? JSON.stringify(posting.title.slice(0, 80)) : "-"} descriptionChars=${posting?.description?.length ?? 0} ` +
            `reader=${extraction?.extractor ?? "-"} problem=${extraction?.problem ?? "-"}`,
        );
        if (!ok) break;
      } catch (error) {
        stopped = error instanceof AdapterError ? `${error.code}: ${error.message}` : "the page could not be loaded";
        console.info(`[page-capture:verify] ${index + 1}/${urls.length} STOPPED (${stopped}); no further request`);
        break;
      }
    }
  } finally {
    await driver.close().catch(() => undefined);
  }
  const viable = !stopped && readable === urls.length;
  console.info(
    `[page-capture:verify] ${site.name}: ${readable}/${urls.length} readable. Verdict: ${viable ? "VIABLE" : "NOT VIABLE — stop and report; no further investigation without authorization"}`,
  );
  process.exitCode = viable ? 0 : 2;
}

void main();
