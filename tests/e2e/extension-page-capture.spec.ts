import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { e2eEnvironment } from "../support/e2e-environment";
import { e2eBatchJobs, e2ePageFor, e2eResultsUrl } from "../support/page-capture-e2e";

// Mode B ("Save jobs on this page") end to end: the built extension in
// Chromium reads the loaded cards of a synthetic results page, the preview
// lets a job be left out, the batch is staged, and the real automatic detail
// acquisition (run by the helper as the retrieval worker runs it, with a
// fixture browser) reads each job's own page, ingests it through the normal
// path and hands it to the existing triage-gated evaluation request. The
// jobs reach Evaluate, Needs Review (decided in the triage panel) and Reject
// without any of them being opened one by one, an unread job waits with
// Retry and Dismiss, and the single-job capture (Mode A) still works on a
// batch job, re-observing the same opportunity. No evaluator worker runs and
// no provider is called.
//
// The synthetic site is on the reserved jobs.e2e.invalid host, answered by
// Playwright itself; Chromium resolves no other host but 127.0.0.1. The test
// build adds that host to the extension's host permissions, standing in for
// the activeTab grant a toolbar click gives (Playwright cannot click the
// toolbar); the shipped manifest is unchanged.
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const execFileAsync = promisify(execFile);
const appUrl = "http://127.0.0.1:3000";
const run = randomUUID().replace(/-/g, "").slice(0, 10);
const jobs = Object.fromEntries(e2eBatchJobs(run).map((job) => [job.name, job])) as Record<"evaluate" | "review" | "reject" | "later", ReturnType<typeof e2eBatchJobs>[number]>;
const pairingLabel = `E2E results pages ${run}`;
const evaluationHelper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledEvaluationHelper = path.resolve("database/.e2e-page-capture-evaluation-helper.mjs");
const pageCaptureHelper = path.resolve("tests/support/e2e-page-capture-helper.ts");
const compiledPageCaptureHelper = path.resolve("database/.e2e-page-capture-helper.mjs");

let context: BrowserContext;
let userDataDir = "";
let extensionDir = "";
let extensionId = "";
let profileId = "";
let previousActiveId = "";
const siteRequests: string[] = [];

async function runEvaluationHelper(...args: string[]) {
  return (await execFileAsync(process.execPath, [compiledEvaluationHelper, ...args], { cwd: process.cwd(), env: process.env })).stdout.trim();
}

async function runPageCaptureHelper(...args: string[]) {
  // The same deterministic AI settings the web server runs with (no live
  // key), so the evaluation request it hands jobs to is configured alike.
  const env = { ...process.env, ...e2eEnvironment() };
  return (await execFileAsync(process.execPath, [compiledPageCaptureHelper, ...args], { cwd: process.cwd(), env, timeout: 120_000 })).stdout.trim();
}

interface StagedItem {
  id: string;
  title: string;
  status: string;
  lastReason: string | null;
  opportunityId: string | null;
  handoffOutcome: string | null;
}

async function stagedItems(): Promise<Record<string, StagedItem>> {
  const items = JSON.parse(await runPageCaptureHelper("items", run)) as StagedItem[];
  return Object.fromEntries(items.map((item) => [Object.values(jobs).find((job) => job.title === item.title)?.name ?? item.title, item]));
}

function unpackedExtensionId(directory: string) {
  const pathBytes = Buffer.from(realpathSync(directory), process.platform === "win32" ? "utf16le" : "utf8");
  const hex = createHash("sha256").update(pathBytes).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

const extensionPage = (page: string) => `chrome-extension://${extensionId}/${page}`;

type ChromeForTests = { tabs: { query(filter: object): Promise<Array<{ id?: number; url?: string }>> } };

test.beforeAll(async () => {
  await execFileAsync(process.execPath, [path.resolve("apps/extension/build.mjs")]);
  extensionDir = await mkdtemp(path.join(tmpdir(), "aija-page-capture-extension-"));
  await cp(path.resolve("apps/extension/dist"), extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { host_permissions: string[] };
  manifest.host_permissions.push("https://jobs.e2e.invalid/*");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  for (const [entry, outfile] of [
    [evaluationHelper, compiledEvaluationHelper],
    [pageCaptureHelper, compiledPageCaptureHelper],
  ] as const) {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      external: ["@prisma/*", "pg", "dotenv", "zod", "jsdom"],
      logLevel: "silent",
    });
  }
  [profileId = "", previousActiveId = ""] = (await runEvaluationHelper("create-profile")).split(" ");

  userDataDir = await mkdtemp(path.join(tmpdir(), "aija-page-capture-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    ],
  });
  await context.route("https://jobs.e2e.invalid/**", async (route) => {
    siteRequests.push(route.request().url());
    const html = e2ePageFor(run, route.request().url());
    await route.fulfill({ status: html ? 200 : 404, contentType: html ? "text/html; charset=utf-8" : "text/plain", body: html ?? "Not found" });
  });
  extensionId = unpackedExtensionId(extensionDir);
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
  if (extensionDir) await rm(extensionDir, { recursive: true, force: true });
  // Every cleanup step runs even if an earlier one fails, so a failed run
  // leaves nothing behind in the test database; the first failure is
  // reported at the end.
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  let items: Record<string, StagedItem> = {};
  await attempt(async () => (items = await stagedItems()));
  for (const item of Object.values(items)) if (item.opportunityId) await attempt(() => runEvaluationHelper("cleanup", item.opportunityId!, ""));
  await attempt(() => runEvaluationHelper("cleanup-extension-pairings", pairingLabel));
  await attempt(() => runPageCaptureHelper("cleanup-items", run));
  await attempt(() => runEvaluationHelper("cleanup", "", profileId, previousActiveId));
  for (const compiled of [compiledEvaluationHelper, compiledPageCaptureHelper]) {
    await unlink(compiled).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") failures.push(error);
    });
  }
  if (failures.length) throw failures[0];
});

async function openTab(url: string): Promise<{ page: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(url);
  const options = await context.newPage();
  await options.goto(extensionPage("options.html"));
  const tabId = await options.evaluate(async (target) => {
    const chrome = (globalThis as unknown as { chrome: ChromeForTests }).chrome;
    return (await chrome.tabs.query({})).find((tab) => tab.url === target)?.id ?? null;
  }, url);
  await options.close();
  expect(tabId).toEqual(expect.any(Number));
  return { page, tabId: tabId! };
}

async function openPopup(tabId: number): Promise<{ popup: Page; requests: string[] }> {
  const popup = await context.newPage();
  const requests: string[] = [];
  popup.on("request", (request) => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
  await popup.goto(`${extensionPage("popup.html")}?tabId=${tabId}`);
  return { popup, requests };
}

async function readAndSave(popup: Page, leaveOut: string[]) {
  await popup.getByRole("button", { name: "Save jobs on this page" }).click();
  await expect(popup.locator("#jobs-list input[type=checkbox]")).toHaveCount(4);
  for (const title of leaveOut) await popup.getByRole("checkbox", { name: new RegExp(title) }).uncheck();
  const [response] = await Promise.all([
    popup.waitForResponse((candidate) => candidate.url().endsWith("/api/extension/page-captures")),
    popup.getByRole("button", { name: "Save selected jobs" }).click(),
  ]);
  expect(response.status()).toBe(200);
  return (await response.json()) as { counts: Record<string, number> };
}

const rowOf = (page: Page, title: string) => page.getByRole("row").filter({ hasText: title });

test("pair, read the loaded cards of a results page, leave one out, and stage the rest without creating anything", async () => {
  const app = await context.newPage();
  await app.goto(`${appUrl}/extension`);
  await app.getByLabel("Name (optional)").fill(pairingLabel);
  await app.getByRole("button", { name: "Create pairing" }).click();
  const credential = (await app.getByTestId("pairing-credential").textContent())?.trim() ?? "";
  expect(credential).toMatch(/^aija_[A-Za-z0-9_-]{43}$/);
  await app.getByRole("button", { name: "I've saved it in the extension" }).click();
  await app.close();
  const options = await context.newPage();
  await options.goto(extensionPage("options.html"));
  await options.getByLabel("AI Job Assistant address").fill(appUrl);
  await options.getByLabel("Pairing credential").fill(credential);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByRole("status")).toHaveText(`Connected to AI Job Assistant as "${pairingLabel}".`);
  await options.close();

  const { tabId } = await openTab(e2eResultsUrl);
  const { popup, requests } = await openPopup(tabId);
  await expect(popup.getByText(`Connected to AI Job Assistant (${pairingLabel}).`)).toBeVisible();
  await expect(popup.getByRole("button", { name: "Save jobs on this page" })).toBeVisible();
  // Nothing is read until asked.
  await expect(popup.locator("#jobs-preview")).toBeHidden();

  await popup.getByRole("button", { name: "Save jobs on this page" }).click();
  await expect(popup.locator("#jobs-summary")).toHaveText("4 jobs read from this page. 1 not loaded yet was skipped. Scroll the page and save again for more.");
  await expect(popup.locator("#jobs-list")).toContainText(`${jobs.evaluate.title} · ${jobs.evaluate.company} · Remote, United States · 1 day ago`);
  await expect(popup.locator("#jobs-list")).not.toContainText("Detail pane job");
  // Reading the cards made no request: the only page the site was asked for
  // is the results page the tab opened.
  expect(siteRequests).toEqual([e2eResultsUrl]);
  await popup.close();

  const { popup: savePopup, requests: saveRequests } = await openPopup(tabId);
  const saved = await readAndSave(savePopup, [jobs.reject.title]);
  expect(saved.counts).toEqual({ queued: 3, seenAgain: 0, alreadySaved: 0, rejected: 0 });
  await expect(savePopup.locator("#jobs-result-message")).toHaveText("3 queued to get their details.");
  expect(saveRequests.filter((entry) => entry === "POST /api/extension/page-captures")).toHaveLength(1);
  expect(requests.filter((entry) => entry.startsWith("POST"))).toEqual([]);

  // Staged only: no opportunity yet, and nothing left out was saved.
  const items = await stagedItems();
  expect(Object.keys(items).sort()).toEqual(["evaluate", "later", "review"]);
  for (const item of Object.values(items)) expect(item).toMatchObject({ status: "QUEUED", opportunityId: null });

  const [progress] = await Promise.all([context.waitForEvent("page"), savePopup.getByRole("button", { name: "Open progress in AI Job Assistant" }).click()]);
  await progress.waitForURL(/\/extension\/jobs$/);
  await expect(progress.getByRole("heading", { level: 1, name: "Captured Jobs" })).toBeVisible();
  await expect(rowOf(progress, jobs.evaluate.title)).toContainText("Getting details");
  await progress.close();
  await savePopup.close();
});

test("a job whose details cannot be read waits with Retry and Dismiss, never as an opportunity", async () => {
  // No browser configured: every claimed job waits for its details.
  const result = JSON.parse(await runPageCaptureHelper("acquire", run, "no-browser")) as { passes: Array<{ awaitingDetails: number }>; navigated: string[] };
  expect(result.passes[0]).toMatchObject({ awaitingDetails: 3 });
  expect(result.navigated).toEqual([]);

  const app = await context.newPage();
  await app.goto(`${appUrl}/extension/jobs?status=waiting`);
  const later = rowOf(app, jobs.later.title);
  await expect(later).toContainText("Awaiting details: No browser is configured for reading job details");
  await expect(later.getByRole("link", { name: "Open job ↗" })).toHaveAttribute("href", jobs.later.url);
  await expect(later.getByRole("link", { name: jobs.later.title })).toHaveCount(0);

  await later.getByRole("button", { name: "Dismiss" }).click();
  await expect(rowOf(app, jobs.later.title)).toHaveCount(0, { timeout: 15_000 });
  await app.goto(`${appUrl}/extension/jobs?status=dismissed`);
  await rowOf(app, jobs.later.title).getByRole("button", { name: "Restore" }).click();
  await expect(rowOf(app, jobs.later.title)).toHaveCount(0, { timeout: 15_000 });

  // Retry two of them; the third stays waiting.
  await app.goto(`${appUrl}/extension/jobs?status=waiting`);
  for (const name of ["evaluate", "review"] as const) {
    await rowOf(app, jobs[name].title).getByRole("button", { name: "Retry" }).click();
    await expect(rowOf(app, jobs[name].title)).toContainText("Getting details");
  }
  await expect(rowOf(app, jobs.later.title)).toContainText("Awaiting details: The job could not be added");
  await app.close();

  const items = await stagedItems();
  expect(items.later).toMatchObject({ status: "AWAITING_DETAILS", opportunityId: null });
  expect(items.evaluate).toMatchObject({ status: "QUEUED", opportunityId: null });
});

test("saving again adds the left-out job; details are read automatically and each job reaches the existing triage", async () => {
  const { tabId } = await openTab(e2eResultsUrl);
  const { popup } = await openPopup(tabId);
  const saved = await readAndSave(popup, []);
  expect(saved.counts).toEqual({ queued: 1, seenAgain: 3, alreadySaved: 0, rejected: 0 });
  await expect(popup.locator("#jobs-result-message")).toHaveText("1 queued to get their details · 3 already in progress.");
  await popup.close();

  // The acquisition pass reads each queued job's own page (the waiting job is
  // not read again until retried), with no one opening them.
  const result = JSON.parse(await runPageCaptureHelper("acquire", run)) as { passes: Array<{ ingested: number }>; navigated: string[] };
  expect(result.passes.reduce((total, pass) => total + pass.ingested, 0)).toBe(3);
  expect([...result.navigated].sort()).toEqual([jobs.evaluate.url, jobs.reject.url, jobs.review.url].sort());

  const items = await stagedItems();
  expect(items.evaluate).toMatchObject({ status: "INGESTED", handoffOutcome: "QUEUED" });
  expect(items.review).toMatchObject({ status: "INGESTED", handoffOutcome: "NEEDS_REVIEW" });
  expect(items.reject).toMatchObject({ status: "INGESTED", handoffOutcome: "REJECT" });
  expect(items.later).toMatchObject({ status: "AWAITING_DETAILS", opportunityId: null });

  const app = await context.newPage();
  await app.goto(`${appUrl}/extension/jobs?status=added`);
  await expect(rowOf(app, jobs.evaluate.title)).toContainText("Queued for evaluation");
  await expect(rowOf(app, jobs.review.title)).toContainText("Needs Review before evaluation");
  await expect(rowOf(app, jobs.reject.title)).toContainText("Rejected before evaluation");

  // EVALUATE reached the normal admission path; REJECT and NEEDS_REVIEW
  // created no evaluation.
  expect((await app.request.get(`${appUrl}/api/opportunities/${items.evaluate!.opportunityId}/evaluation`)).status()).toBe(200);
  expect((await app.request.get(`${appUrl}/api/opportunities/${items.reject!.opportunityId}/evaluation`)).status()).toBe(404);
  expect((await app.request.get(`${appUrl}/api/opportunities/${items.review!.opportunityId}/evaluation`)).status()).toBe(404);

  // The Needs Review job is decided in the existing triage panel on its page.
  await rowOf(app, jobs.review.title).getByRole("link", { name: jobs.review.title }).click();
  await app.waitForURL(new RegExp(`/opportunities/${items.review!.opportunityId}$`));
  await expect(app.getByRole("heading", { name: "Needs Review before evaluation" })).toBeVisible();
  await expect(app.getByText(/Base salary is Unknown/)).toBeVisible();
  await expect(app.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await app.getByRole("button", { name: "Evaluate", exact: true }).click();
  await expect(app.getByText(/released to the normal admission path/)).toBeVisible();
  expect((await app.request.get(`${appUrl}/api/opportunities/${items.review!.opportunityId}/evaluation`)).status()).toBe(200);

  await app.goto(`${appUrl}/opportunities/${items.reject!.opportunityId}`);
  await expect(app.getByRole("heading", { name: "Rejected before evaluation" })).toBeVisible();
  await app.goto(`${appUrl}/extension/jobs?status=added`);
  // Released by Alex's decision, it now waits in the normal queue.
  await expect(rowOf(app, jobs.review.title)).toContainText("Queued for evaluation");
  await app.close();
});

test("Mode A still works on its own, and on a batch job it re-observes the same opportunity", async () => {
  const items = await stagedItems();
  const { page, tabId } = await openTab(jobs.evaluate.url);
  const { popup } = await openPopup(tabId);
  // A job page is not a results page: only the single-job reader is offered.
  await expect(popup.getByRole("button", { name: "Read this page" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Save jobs on this page" })).toBeHidden();
  await expect(popup.locator("#saved-message")).toHaveText(`Already saved: ${jobs.evaluate.title} at ${jobs.evaluate.company}.`);
  await popup.getByRole("button", { name: "Read this page" }).click();
  await expect(popup.getByLabel("Title")).toHaveValue(jobs.evaluate.title);
  const [response] = await Promise.all([
    popup.waitForResponse((candidate) => candidate.url().endsWith("/api/extension/captures")),
    popup.getByRole("button", { name: "Save to AI Job Assistant" }).click(),
  ]);
  expect(await response.json()).toMatchObject({ outcome: "UNCHANGED", opportunityId: items.evaluate!.opportunityId });
  await popup.close();
  await page.close();

  // Requesting an evaluation from Mode A on a job the triage rejected: the
  // popup says so, nothing was spent, and nothing is followed or queued.
  const rejected = await openTab(jobs.reject.url);
  const { popup: rejectPopup, requests } = await openPopup(rejected.tabId);
  await expect(rejectPopup.locator("#saved-message")).toHaveText(`Already saved: ${jobs.reject.title} at ${jobs.reject.company}.`);
  await rejectPopup.getByRole("button", { name: "Request evaluation" }).click();
  await expect(rejectPopup.locator("#evaluation-request")).toHaveText("Rejected before evaluation: the posting does not meet a hard requirement. Nothing was spent.");
  await expect(rejectPopup.locator("#evaluation-state")).toHaveText("Rejected before evaluation.");
  await expect(rejectPopup.getByRole("button", { name: "Request evaluation" })).toBeHidden();
  await rejectPopup.waitForTimeout(2_500);
  expect(requests.filter((entry) => entry.endsWith("/evaluation"))).toEqual([]);
  expect((await rejectPopup.request.get(`${appUrl}/api/opportunities/${items.reject!.opportunityId}/evaluation`)).status()).toBe(404);
  await rejectPopup.close();
  await rejected.page.close();
});
