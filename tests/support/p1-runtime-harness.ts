// Runs the P1 reader path under tsx, the runtime and transform that
// `pnpm page-capture:verify` and `pnpm worker:retrieval` use, with a fake
// browser serving local pages: no network, browser or database. It prints one
// JSON line: whether the reader's serialized source carries tsx's `__name`
// helper calls (the condition that broke the first local P1 run), the
// experiment's result for two LinkedIn job pages, and the reader's output for
// each tests/support/p1-runtime-fixtures.ts page.
// Run by tests/unit/page-capture-verify-runtime.test.ts.
import { JSDOM } from "jsdom";
import { pageCaptureSiteByKey } from "../../packages/core/src/index";
import type { BrowserDriver } from "../../packages/discovery/src/index";
import { testSiteJobPage } from "./page-capture-pages";
import { p1RuntimeFixtures } from "./p1-runtime-fixtures";

// The apps/web and extension modules are CommonJS under tsx; take their
// exports from the namespace or its default.
const pick = <T>(module: Record<string, unknown>, name: string) =>
  (module[name] ?? (module.default as Record<string, unknown> | undefined)?.[name]) as T;
const verify = await import("../../apps/web/src/server/page-capture-verify");
const acquisition = await import("../../apps/web/src/server/page-capture-acquisition");
const extract = await import("../../apps/extension/src/extract");
const runPageCaptureVerification = pick<typeof import("../../apps/web/src/server/page-capture-verify").runPageCaptureVerification>(verify, "runPageCaptureVerification");
const readJobPage = pick<typeof import("../../apps/web/src/server/page-capture-acquisition").readJobPage>(acquisition, "readJobPage");
const extractJobPosting = pick<() => unknown>(extract, "extractJobPosting");

const description =
  "<p>Own a portfolio of B2B SaaS customers from onboarding through renewal and expansion.</p>" +
  "<ul><li>Drive adoption and measurable value realization across every account</li><li>Run quarterly business reviews with executive sponsors</li>" +
  "<li>Partner with Sales, Support and Product on renewals and expansion</li></ul><p>Full-time. Remote in the United States.</p>";

const driver: BrowserDriver = {
  async navigate(url) {
    const id = /(\d{5,20})$/.exec(url)?.[1] ?? "0";
    return { status: 200, finalUrl: url, html: testSiteJobPage({ id, title: `Customer Success Manager ${id}`, company: "Northwind", description }), cookieNames: [] };
  },
  close: async () => undefined,
};

const verification = await runPageCaptureVerification({
  site: pageCaptureSiteByKey("linkedin")!,
  urls: ["https://www.linkedin.com/jobs/view/customer-success-manager-at-planhat-4423511448", "https://www.linkedin.com/jobs/view/4486498409"],
  driver,
  sleep: async () => undefined,
});
const extractions = p1RuntimeFixtures.map((fixture) => ({
  name: fixture.name,
  extraction: readJobPage(new JSDOM(fixture.html, { url: fixture.url, runScripts: "outside-only" }).window.document),
}));
process.stdout.write(`${JSON.stringify({ readerHasNameHelper: extractJobPosting.toString().includes("__name("), verification, extractions })}\n`);
