import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pageCaptureDetailPageScripts, pageCaptureSiteByKey } from "@ai-career/core";
import { pageCaptureVerifyApplyEvidence, pageCaptureVerifyMaxUrls, pageCaptureVerifyTargets, runPageCaptureVerification, type PageCaptureVerdict } from "./page-capture-verify";

// pnpm page-capture:verify <site> <job URL> [<job URL> …] [--raw-dir <dir>]
//
// The bounded P1 verification experiment for Mode B (results-page capture);
// the rules and verdicts are in page-capture-verify.ts. Run it only with
// Alex's authorization, from the local runtime, with at most 5 job URLs taken
// from that site's F0 results-page cards. It needs RETRIEVAL_BROWSER_EXECUTABLE
// (a Chromium or Chrome binary) and starts that browser fresh, logged out,
// with no profile, cookies or stored state. No database is read or written;
// nothing is ingested or evaluated.
//
// Exit code: 0 PASS, 2 FAIL, 3 BLOCKED, 1 usage or setup error.
// --raw-dir (outside the repository) keeps each page's raw HTML and a
// p1-<site>-summary.json with the verdict and per-page results (no cookies
// or headers).
//
// The browser reads pages exactly as the retrieval worker does (November 18,
// 2026): the site's page-scripts setting (LinkedIn: scripts off, the
// registry's value, or PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS as for the worker).
// With --raw-dir it also keeps, per page, the document exactly as the site
// sent it (p1-<site>-<n>.served.html) and the application-link evidence the
// worker records (p1-<site>-<n>.apply.json).

const exitCodes: Record<PageCaptureVerdict, number> = { PASS: 0, FAIL: 2, BLOCKED: 3 };

function fail(message: string): never {
  console.error(`[page-capture:verify] ${message}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const rawIndex = args.indexOf("--raw-dir");
  const rawDir = rawIndex >= 0 ? args[rawIndex + 1] : null;
  if (rawIndex >= 0 && !rawDir) fail("--raw-dir needs a directory");
  const positional = args.filter((_, index) => rawIndex < 0 || (index !== rawIndex && index !== rawIndex + 1));
  const [siteKey, ...urls] = positional;
  const site = pageCaptureSiteByKey(siteKey);
  if (!site || site.testOnly) fail("Name a page-capture site: linkedin or welcome-to-the-jungle");
  if (!urls.length || urls.length > pageCaptureVerifyMaxUrls) fail(`Give 1 to ${pageCaptureVerifyMaxUrls} job URLs from the site's F0 results-page cards`);
  let targets;
  try {
    targets = pageCaptureVerifyTargets(site, urls);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid job URLs");
  }
  if (rawDir) {
    const resolved = path.resolve(rawDir);
    const repository = path.resolve(process.cwd());
    if (resolved === repository || resolved.startsWith(`${repository}${path.sep}`)) fail("--raw-dir must be outside the repository");
  }
  const executablePath = process.env.RETRIEVAL_BROWSER_EXECUTABLE;
  if (!executablePath) fail("Set RETRIEVAL_BROWSER_EXECUTABLE to a Chromium or Chrome binary");

  console.info(
    `[page-capture:verify] ${site.name}: ${targets.length} job page(s), one at a time, at least ${site.detail.minIntervalMs / 1000} s apart, ` +
      "fresh logged-out browser; the first access restriction or unreadable page stops it with no further request.",
  );
  const pageScripts = pageCaptureDetailPageScripts(site, process.env);
  console.info(`[page-capture:verify] page scripts: ${pageScripts.mode} (${pageScripts.source === "setting" ? "server setting" : "the worker's default"})`);
  const { launchBrowserDriver } = await import("@ai-career/browser-retrieval");
  const driver = await launchBrowserDriver({ executablePath, pageScripts: pageScripts.mode });
  if (rawDir) mkdirSync(rawDir, { recursive: true });
  let result;
  try {
    result = await runPageCaptureVerification({
      site,
      urls,
      driver,
      onPage: (page, html, servedHtml) => {
        if (rawDir && html !== null) writeFileSync(path.join(rawDir, `p1-${site.key}-${page.index}.html`), html);
        if (rawDir && servedHtml !== null) writeFileSync(path.join(rawDir, `p1-${site.key}-${page.index}.served.html`), servedHtml);
        const apply = pageCaptureVerifyApplyEvidence(html, servedHtml, page.finalUrl ?? page.openedUrl);
        if (rawDir) writeFileSync(path.join(rawDir, `p1-${site.key}-${page.index}.apply.json`), `${JSON.stringify(apply, null, 2)}\n`);
        console.info(
          `[page-capture:verify] ${page.index} apply evidence: served=${servedHtml === null ? "unavailable" : `${servedHtml.length} chars`}` +
            ` code#applyUrl=${apply.served?.codeApplyUrl.present ?? apply.rendered?.codeApplyUrl.present ?? false}` +
            ` url=${apply.served?.codeApplyUrl.url ?? apply.rendered?.codeApplyUrl.url ?? "-"}` +
            ` markers=${JSON.stringify(apply.markers)}`,
        );
        console.info(
          `[page-capture:verify] ${page.index}/${targets.length} ${page.result} HTTP ${page.status ?? "-"} opened=${page.openedUrl}` +
            `${page.finalUrl && page.finalUrl !== page.openedUrl ? ` final=${page.finalUrl}` : ""}` +
            ` title=${page.title ? JSON.stringify(page.title.slice(0, 80)) : "-"} descriptionChars=${page.descriptionChars}` +
            ` reader=${page.extractor ?? "-"}${page.reason ? ` reason=${JSON.stringify(page.reason)}` : ""}`,
        );
      },
    });
  } finally {
    await driver.close().catch(() => undefined);
  }
  if (rawDir) {
    writeFileSync(
      path.join(rawDir, `p1-${site.key}-summary.json`),
      `${JSON.stringify({ ...result, siteName: site.name, ranAt: new Date().toISOString(), minIntervalMs: site.detail.minIntervalMs }, null, 2)}\n`,
    );
  }
  console.info(`[page-capture:verify] ${site.name}: ${result.readable}/${result.requested} readable. VERDICT: ${result.verdict} (${result.reason})`);
  if (result.verdict !== "PASS") {
    console.info("[page-capture:verify] P1 is not viable for this site as observed: stop and report; no further investigation without authorization.");
  }
  process.exitCode = exitCodes[result.verdict];
}

void main();
