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
import { e2ePageFor } from "../support/page-capture-e2e";
import { capturedBefore, continuousSearchUrl, eligible } from "../support/continuous-e2e";

// Continuous capture (Mode B, November 15, 2026) end to end: the built
// extension in Chromium, started once from the side panel on a synthetic
// search, works through it in successive batches of at most 25 jobs not
// captured before, loading more results the way the site offers them (its
// "See more jobs" button, or its numbered pages), while the real retrieval
// worker pass (run by the helper between batches) reads each job's page and
// ingests it. Every run here goes on without any further click: the search
// tab is in the background the whole time (the panel's page is in front),
// one run has its service worker stopped mid-run, and one is stopped and
// resumed. The synthetic sites are on reserved .invalid hosts answered by
// Playwright; nothing reaches a real site, no evaluator worker runs and no
// provider is called.
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const execFileAsync = promisify(execFile);
const appUrl = "http://127.0.0.1:3000";
const run = randomUUID().replace(/-/g, "").slice(0, 10);
// Chrome's DevTools port for this browser, used only to stop the extension's
// service worker the way Chrome documents testing it (closing its target).
const debuggingPort = 9300 + Math.floor(Math.random() * 500);
const pairingLabel = `E2E continuous capture ${run}`;
const pageCaptureHelper = path.resolve("tests/support/e2e-page-capture-helper.ts");
const compiledPageCaptureHelper = path.resolve("database/.e2e-continuous-capture-helper.mjs");
const evaluationHelper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledEvaluationHelper = path.resolve("database/.e2e-continuous-evaluation-helper.mjs");

let context: BrowserContext;
let userDataDir = "";
let extensionDir = "";
let extensionId = "";
let profileId = "";
let previousActiveId = "";

interface RunState {
  runId: string;
  status: string;
  reason: string | null;
  batchNumber: number;
  buffer: unknown[];
  inFlight: unknown;
  totals: { captured: number; skipped: number; failures: number };
  workerStarts: number;
}

const helper = async (...args: string[]) =>
  (await execFileAsync(process.execPath, [compiledPageCaptureHelper, ...args], { cwd: process.cwd(), env: { ...process.env, ...e2eEnvironment() }, timeout: 120_000 })).stdout.trim();
const evaluation = async (...args: string[]) => (await execFileAsync(process.execPath, [compiledEvaluationHelper, ...args], { cwd: process.cwd(), env: process.env })).stdout.trim();

function unpackedExtensionId(directory: string) {
  const pathBytes = Buffer.from(realpathSync(directory), process.platform === "win32" ? "utf16le" : "utf8");
  const hex = createHash("sha256").update(pathBytes).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}
const extensionPage = (page: string) => `chrome-extension://${extensionId}/${page}`;
type ChromeForTests = {
  tabs: { query(filter: object): Promise<Array<{ id?: number; url?: string }>> };
  runtime: { sendMessage(message: unknown): Promise<{ state: RunState | null }> };
};

test.beforeAll(async () => {
  await execFileAsync(process.execPath, [path.resolve("apps/extension/build.mjs")]);
  extensionDir = await mkdtemp(path.join(tmpdir(), "aija-continuous-extension-"));
  await cp(path.resolve("apps/extension/dist"), extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { host_permissions: string[] };
  manifest.host_permissions.push("https://jobs.e2e.invalid/*", "https://pages.e2e.invalid/*");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  for (const [entry, outfile] of [
    [pageCaptureHelper, compiledPageCaptureHelper],
    [evaluationHelper, compiledEvaluationHelper],
  ] as const) {
    await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "esm", target: "node20", external: ["@prisma/*", "pg", "dotenv", "zod", "jsdom"], logLevel: "silent" });
  }
  [profileId = "", previousActiveId = ""] = (await evaluation("create-profile")).split(" ");
  userDataDir = await mkdtemp(path.join(tmpdir(), "aija-continuous-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      `--remote-debugging-port=${debuggingPort}`,
    ],
  });
  for (const site of ["https://jobs.e2e.invalid/**", "https://pages.e2e.invalid/**"]) {
    await context.route(site, async (route) => {
      const html = e2ePageFor(run, route.request().url());
      await route.fulfill({ status: html ? 200 : 404, contentType: html ? "text/html; charset=utf-8" : "text/plain", body: html ?? "Not found" });
    });
  }
  extensionId = unpackedExtensionId(extensionDir);

  // Pair the extension.
  const app = await context.newPage();
  await app.goto(`${appUrl}/extension`);
  await app.getByLabel("Name (optional)").fill(pairingLabel);
  await app.getByRole("button", { name: "Create pairing" }).click();
  const credential = (await app.getByTestId("pairing-credential").textContent())?.trim() ?? "";
  await app.getByRole("button", { name: "I've saved it in the extension" }).click();
  await app.close();
  const options = await context.newPage();
  await options.goto(extensionPage("options.html"));
  await options.getByLabel("AI Job Assistant address").fill(appUrl);
  await options.getByLabel("Pairing credential").fill(credential);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByRole("status")).toHaveText(`Connected to AI Job Assistant as "${pairingLabel}".`);
  await options.close();
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
  if (extensionDir) await rm(extensionDir, { recursive: true, force: true });
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  // The opportunities the runs added (in one pass), then the staged jobs,
  // pairing and profile.
  await attempt(() => helper("cleanup-opportunities", run));
  await attempt(() => evaluation("cleanup-extension-pairings", pairingLabel));
  await attempt(() => helper("cleanup-items", run));
  await attempt(() => evaluation("cleanup", "", profileId, previousActiveId));
  for (const compiled of [compiledPageCaptureHelper, compiledEvaluationHelper]) {
    await unlink(compiled).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") failures.push(error);
    });
  }
  if (failures.length) throw failures[0];
});

// The search in its own tab; the panel in another, in front (the search tab
// stays in the background for the whole run).
async function openSearch(scenario: string): Promise<{ search: Page; panel: Page; tabId: number }> {
  const url = continuousSearchUrl(scenario, run);
  const search = await context.newPage();
  await search.goto(url);
  const panel = await context.newPage();
  await panel.goto(extensionPage("options.html"));
  const tabId = await panel.evaluate(async (target) => {
    const chrome = (globalThis as unknown as { chrome: ChromeForTests }).chrome;
    return (await chrome.tabs.query({})).find((tab) => tab.url === target)?.id ?? null;
  }, url);
  expect(tabId).toEqual(expect.any(Number));
  await panel.goto(`${extensionPage("popup.html")}?tabId=${tabId}`);
  await panel.bringToFront();
  return { search, panel, tabId: tabId! };
}

const instanceOf = (panel: Page) =>
  panel.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<{ instance?: string }> } } }).chrome;
    return (await chrome.runtime.sendMessage({ type: "continuous:state" })).instance;
  });

const stateOf = (panel: Page) =>
  panel.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ChromeForTests }).chrome;
    return (await chrome.runtime.sendMessage({ type: "continuous:state" })).state;
  });

// The retrieval worker's passes between batches, until the run ends (or
// `until` holds).
async function workUntilEnd(panel: Page, until: (state: RunState) => boolean = () => false, limitMs = 240_000): Promise<RunState> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    await helper("acquire", run);
    const state = (await stateOf(panel))!;
    if (!["RUNNING", "STOPPING"].includes(state.status) || until(state)) return state;
    if (Date.now() > deadline) throw new Error(`The run did not end: ${JSON.stringify(state)}`);
    await panel.waitForTimeout(1_500);
  }
}

async function startRun(scenario: string) {
  const before = capturedBefore(scenario, run);
  if (before.length) await helper("seed", run, ...before);
  const opened = await openSearch(scenario);
  await expect(opened.panel.getByRole("button", { name: "Start continuous capture" })).toBeVisible();
  await opened.panel.getByRole("button", { name: "Start continuous capture" }).click();
  await expect(opened.panel.locator("#continuous-badge")).toContainText(/Running|Finishing|Completed/);
  return opened;
}

// Stops the extension's service worker as Chrome documents for testing it:
// its DevTools target is closed, and the worker is started again by Chrome on
// the next event (the alarm, or the panel's next message).
// Stops the extension's service worker the way DevTools' "Stop" does
// (ServiceWorker.stopAllWorkers), from a page of the extension.
async function stopServiceWorker(panel: Page) {
  const session = await context.newCDPSession(panel);
  await session.send("ServiceWorker.enable");
  await session.send("ServiceWorker.stopAllWorkers");
  await session.detach();
}

const batchesOf = async (runId: string) => JSON.parse(await helper("sessions", run, runId)) as Array<{ batch: number; urls: string[]; statuses: string[] }>;

test("'See more jobs': 60 jobs with 10 captured before are exactly two batches of 25, and the run completes on the site's end marker", async () => {
  const { panel, search } = await startRun("a");
  const state = await workUntilEnd(panel);
  expect(state.status).toBe("COMPLETED");
  const batches = await batchesOf(state.runId);
  expect(batches.map((batch) => batch.urls.length)).toEqual([25, 25]);
  const submitted = batches.flatMap((batch) => batch.urls);
  expect(new Set(submitted)).toEqual(new Set(eligible("a", run)));
  for (const url of capturedBefore("a", run)) expect(submitted).not.toContain(url);
  expect(batches.flatMap((batch) => batch.statuses).every((status) => status === "INGESTED")).toBe(true);
  await expect(panel.locator("#continuous-badge")).toHaveText("Completed");
  await expect(panel.locator("#continuous-reason")).toHaveText("All results captured");
  await search.close();
  await panel.close();
});

test("'See more jobs' that first repeats shown jobs and then adds cards rendered late: the run neither stops early nor completes with unread jobs (25 + 25, Completed)", async () => {
  const { panel, search } = await startRun("late");
  const state = await workUntilEnd(panel);
  expect(state.status).toBe("COMPLETED");
  const batches = await batchesOf(state.runId);
  expect(batches.map((batch) => batch.urls.length)).toEqual([25, 25]);
  expect(new Set(batches.flatMap((batch) => batch.urls))).toEqual(new Set(eligible("late", run)));
  expect(state.diagnostics.map((entry) => entry.event)).not.toContain("NO_MORE_RESULTS");
  await search.close();
  await panel.close();
});

test("63 jobs with 10 captured before: 25 + 25 + a final 3, and the run continues after its service worker is stopped mid-run", async () => {
  const { panel, search } = await startRun("b");
  // After the first batch is sent, Chrome stops the extension's service worker.
  await workUntilEnd(panel, (state) => state.batchNumber >= 1);
  const before = await instanceOf(panel);
  await stopServiceWorker(panel);
  // The stopped worker is gone: a new instance answers the panel.
  await expect.poll(() => instanceOf(panel), { timeout: 10_000 }).not.toBe(before);
  const state = await workUntilEnd(panel);
  expect(state.status).toBe("COMPLETED");
  expect(state.workerStarts, JSON.stringify(state.diagnostics)).toBeGreaterThanOrEqual(2);
  const batches = await batchesOf(state.runId);
  expect(batches.map((batch) => batch.urls.length)).toEqual([25, 25, 3]);
  const submitted = batches.flatMap((batch) => batch.urls);
  expect(submitted).toHaveLength(53);
  expect(new Set(submitted)).toEqual(new Set(eligible("b", run)));
  await search.close();
  await panel.close();
});

test("numbered pages: 67 jobs with 5 captured before are 25 + 25 + 12, batch boundaries fall inside pages, and the run completes on the last page's own pagination", async () => {
  const { panel, search } = await startRun("pages");
  const state = await workUntilEnd(panel);
  expect(state.status).toBe("COMPLETED");
  const batches = await batchesOf(state.runId);
  expect(batches.map((batch) => batch.urls.length)).toEqual([25, 25, 12]);
  // In page order, each job once: nothing missed or repeated at a boundary.
  expect(batches.flatMap((batch) => batch.urls)).toEqual(eligible("pages", run));
  // The search tab moved through the pages itself.
  expect(search.url()).toMatch(/page=7$/);
  await search.close();
  await panel.close();
});

test("Stop, then Resume: nothing is lost or captured twice", async () => {
  const { panel, search } = await startRun("stop");
  await workUntilEnd(panel, (state) => state.batchNumber >= 1);
  await panel.getByRole("button", { name: "Stop capture" }).click();
  await expect(panel.locator("#continuous-badge")).toHaveText(/Stopped · can be resumed/);
  const stopped = (await stateOf(panel))!;
  expect(stopped.status).toBe("STOPPED_BY_USER");
  await panel.getByRole("button", { name: "Resume" }).click();
  const state = await workUntilEnd(panel);
  expect(state.status).toBe("COMPLETED");
  const submitted = (await batchesOf(state.runId)).flatMap((batch) => batch.urls);
  expect(new Set(submitted)).toEqual(new Set(eligible("stop", run)));
  expect(submitted).toHaveLength(40);
  await search.close();
  await panel.close();
});

test("numbered pages without a pagination the reader recognizes: the discovered jobs are captured and the run stops with the end not confirmed", async () => {
  const { panel, search } = await startRun("nopages");
  const state = await workUntilEnd(panel, () => false, 280_000);
  expect(state.status).toBe("STOPPED_UNCONFIRMED");
  expect(state.reason).toMatch(/end of the search was not confirmed/);
  const batches = await batchesOf(state.runId);
  expect(batches.flatMap((batch) => batch.urls)).toEqual(eligible("nopages", run));
  await expect(panel.locator("#continuous-badge")).toHaveText(/Stopped: end not confirmed/);
  // Progress is kept for Resume, and nothing more is read without one.
  expect((await stateOf(panel))!.status).toBe("STOPPED_UNCONFIRMED");
  await panel.getByRole("button", { name: "Discard and start new" }).click({ trial: true });
  await search.close();
  await panel.close();
});
