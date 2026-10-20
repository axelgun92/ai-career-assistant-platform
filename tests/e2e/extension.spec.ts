import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { extractJobPosting, type PageExtraction } from "../../apps/extension/src/extract";
import { jsonLdPage, linkedInDecoys, linkedInLoggedInPage } from "../support/extension-pages";

// Feature 14B end to end: the built, unpacked extension loaded into Chromium
// (a fresh profile) with its service worker, paired through the app's
// Extension page, reading synthetic job pages served from 127.0.0.1 (an
// unrecognized host the extension may read without a toolbar click, which
// Playwright cannot make), the editable preview, saving, a possible
// duplicate, requesting an evaluation and its queued, running, completed and
// failed states (the deterministic helper worker completes it with the
// fixture provider transport), a repeat capture, a page with no job, and
// revocation. The page reader also runs in Chromium on LinkedIn and Welcome
// to the Jungle fixture pages answered by Playwright itself. Chromium's DNS
// resolves only 127.0.0.1 and localhost: nothing can reach the network.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const appUrl = "http://127.0.0.1:3000";
const extensionDir = path.resolve("apps/extension/dist");
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-extension-helper.mjs");
const pairingLabel = `E2E browser ${Date.now()}`;
const token = `X${Date.now()}`;
const jobTitle = `Customer Success Manager ${token}`;
const leadTitle = `Customer Success Lead ${token}`;
const paths = {
  job: `/jobs/customer-success-${token}`,
  first: `/roles/lead-${token}-a`,
  second: `/roles/lead-${token}-b`,
  empty: `/careers-${token}`,
};

let context: BrowserContext;
let userDataDir = "";
let jobServer: Server;
let jobOrigin = "";
const jobRequests: string[] = [];
let extensionId = "";
let profileId = "";
let previousActiveId = "";
let budgetSnapshot = "";
let credential = "";
const opportunityIds: string[] = [];

async function runHelper(...args: string[]) {
  const result = await execFileAsync(process.execPath, [compiledHelper, ...args], { cwd: process.cwd(), env: process.env });
  return result.stdout.trim();
}

// Chrome's ID for an unpacked extension: the SHA-256 of its directory path,
// first 32 hex digits written with the letters a–p.
function unpackedExtensionId(directory: string) {
  const hex = createHash("sha256").update(realpathSync(directory)).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

const description = [
  `Customer Success Manager at Extensionco ${token}, a SaaS workflow platform.`,
  "Remote. Applicants must reside in the United States. Salary $72,000-$88,000. No travel required.",
  "Own onboarding, adoption, education, retention, and business reviews. 3 years of Customer Success experience required.",
];

const pages: Record<string, () => string> = {
  [paths.job]: () => `<!doctype html><html><head><title>${jobTitle} - Careers</title></head><body>
<header><nav>Home Careers Contact</nav></header>
<main><h1>${jobTitle}</h1>${description.map((line) => `<p>${line}</p>`).join("")}</main>
<footer>© Extensionco</footer></body></html>`,
  // Two postings of one job on different pages; the first's structured
  // title is corrected in the preview to what the second states.
  [paths.first]: () =>
    jsonLdPage({ title: leadTitle, company: `Leadco ${token}`, descriptionHtml: description.map((line) => `<p>${line}</p>`).join(""), extra: { jobLocationType: "TELECOMMUTE" } }),
  [paths.second]: () =>
    jsonLdPage({ title: `${leadTitle} (Remote)`, company: `Leadco ${token}`, descriptionHtml: description.map((line) => `<p>${line}</p>`).join(""), extra: { jobLocationType: "TELECOMMUTE" } }),
  [paths.empty]: () => `<!doctype html><html><head><title>Careers</title></head><body><div>Join us! See our open roles.</div></body></html>`,
};

test.beforeAll(async () => {
  await execFileAsync(process.execPath, [path.resolve("apps/extension/build.mjs")]);
  await build({
    entryPoints: [helper],
    outfile: compiledHelper,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["@prisma/*", "pg", "dotenv", "zod"],
    logLevel: "silent",
  });
  jobServer = createServer((request, response) => {
    jobRequests.push(request.url ?? "/");
    const page = pages[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": page ? "text/html; charset=utf-8" : "text/plain" });
    response.end(page ? page() : "Not found");
  });
  await new Promise<void>((resolve) => jobServer.listen(0, "127.0.0.1", resolve));
  jobOrigin = `http://127.0.0.1:${(jobServer.address() as AddressInfo).port}`;

  budgetSnapshot = await runHelper("budget-snapshot");
  await runHelper("budget-restore", "");
  [profileId = "", previousActiveId = ""] = (await runHelper("create-profile")).split(" ");

  userDataDir = await mkdtemp(path.join(tmpdir(), "aija-extension-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      // No host but the local app and fixture server can be resolved.
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    ],
  });
  extensionId = unpackedExtensionId(extensionDir);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) => (jobServer ? jobServer.close(() => resolve()) : resolve()));
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
  for (const id of opportunityIds) await runHelper("cleanup", id, "");
  await runHelper("cleanup", "", profileId, previousActiveId);
  await runHelper("budget-restore", budgetSnapshot);
  await runHelper("cleanup-extension-pairings", pairingLabel);
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

const extensionPage = (page: string) => `chrome-extension://${extensionId}/${page}`;

type ChromeForTests = {
  tabs: { query(filter: object): Promise<Array<{ id?: number; url?: string }>> };
  scripting: { executeScript(injection: { target: { tabId: number }; func: () => unknown }): Promise<Array<{ result?: unknown }>> };
  storage: { local: { get(keys: null): Promise<unknown> } };
};

async function openJobTab(jobPath: string): Promise<{ page: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(`${jobOrigin}${jobPath}`);
  const options = await context.newPage();
  await options.goto(extensionPage("options.html"));
  const tabId = await options.evaluate(async (url) => {
    const chrome = (globalThis as unknown as { chrome: ChromeForTests }).chrome;
    return (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id ?? null;
  }, `${jobOrigin}${jobPath}`);
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

async function save(popup: Page) {
  const [response] = await Promise.all([
    popup.waitForResponse((candidate) => candidate.url().endsWith("/api/extension/captures")),
    popup.getByRole("button", { name: "Save to AI Job Assistant" }).click(),
  ]);
  const body = (await response.json()) as { opportunityId?: string };
  if (body.opportunityId && !opportunityIds.includes(body.opportunityId)) opportunityIds.push(body.opportunityId);
  return body;
}

test("the unpacked extension loads, its service worker starts, and its storage is closed to page scripts", async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(worker.url()).toBe(extensionPage("service-worker.js"));

  // A script run in a web page (as the page reader runs) cannot read the
  // extension's storage, where the pairing credential is kept.
  const { tabId } = await openJobTab(paths.job);
  const options = await context.newPage();
  await options.goto(extensionPage("options.html"));
  const fromPage = await options.evaluate(async (target) => {
    const chrome = (globalThis as unknown as { chrome: ChromeForTests }).chrome;
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: target },
      func: () => {
        const extension = (globalThis as unknown as { chrome?: { storage?: { local?: { get(keys: null): Promise<unknown> } } } }).chrome;
        if (!extension?.storage?.local) return "unavailable";
        return extension.storage.local.get(null).then(
          () => "readable",
          () => "refused",
        );
      },
    });
    return injection?.result;
  }, tabId);
  expect(["unavailable", "refused"]).toContain(fromPage);
  // The extension's own pages still can.
  expect(await options.evaluate(async () => typeof (await (globalThis as unknown as { chrome: ChromeForTests }).chrome.storage.local.get(null)))).toBe("object");
  await options.close();
});

test("pair, read, edit nothing, save, open in the app, request an evaluation, and capture again", async () => {
  // Pair through the app's Extension page; the credential is shown once.
  const app = await context.newPage();
  await app.goto(`${appUrl}/extension`);
  await expect(app.getByRole("heading", { level: 1, name: "Browser extension" })).toBeVisible();
  await app.getByLabel("Name (optional)").fill(pairingLabel);
  await app.getByRole("button", { name: "Create pairing" }).click();
  credential = (await app.getByTestId("pairing-credential").textContent())?.trim() ?? "";
  expect(credential).toMatch(/^aija_[A-Za-z0-9_-]{43}$/);
  await expect(app.getByRole("region", { name: /Paired browsers/ })).toContainText(pairingLabel);
  await app.getByRole("button", { name: "I've saved it in the extension" }).click();
  await expect(app.getByTestId("pairing-credential")).toHaveCount(0);
  await app.close();

  // Save it in the extension's options; it is never shown again.
  const options = await context.newPage();
  await options.goto(extensionPage("options.html"));
  await options.getByLabel("AI Job Assistant address").fill(appUrl);
  await options.getByLabel("Pairing credential").fill(credential);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByRole("status")).toHaveText(`Connected to AI Job Assistant as "${pairingLabel}".`);
  await expect(options.getByText(`A pairing credential ending …${credential.slice(-4)} is saved in this browser.`)).toBeVisible();
  await expect(options.getByLabel("Pairing credential")).toHaveValue("");
  await options.close();

  // The job page; the extension reads nothing until asked.
  const { page: job, tabId } = await openJobTab(paths.job);
  let { popup, requests } = await openPopup(tabId);
  await expect(popup.getByText(`Connected to AI Job Assistant (${pairingLabel}).`)).toBeVisible();
  await expect(popup.locator("#page-site")).toHaveText("127.0.0.1: an unrecognised site, saved as a lower-priority source");
  await expect(popup.locator("#preview")).toBeHidden();
  expect(await job.evaluate(() => document.documentElement.outerHTML)).not.toContain("aija_");

  // Read this page → editable preview; nothing is sent before Save.
  await popup.getByRole("button", { name: "Read this page" }).click();
  await expect(popup.getByLabel("Title")).toHaveValue(jobTitle);
  await expect(popup.getByLabel("Company")).toHaveValue("");
  await expect(popup.getByLabel("Company")).toHaveAttribute("placeholder", "Unknown");
  await expect(popup.locator("#preview-source")).toHaveText("Read from the page's main content");
  await expect(popup.getByLabel("Description")).toHaveValue(/Own onboarding, adoption, education/);
  await expect(popup.getByLabel("Description")).not.toHaveValue(/Home Careers Contact|© Extensionco/);
  await expect(popup.getByLabel("Title")).toBeEditable();
  // Before Save the popup has only asked whether it is paired and whether
  // the page is already saved.
  expect(requests.filter((entry) => entry.includes("/api/"))).toEqual(["GET /api/extension/status", "GET /api/extension/lookup"]);

  const saved = await save(popup);
  expect(requests.filter((entry) => entry === "POST /api/extension/captures")).toHaveLength(1);
  expect(saved).toMatchObject({ outcome: "CREATED", sourceCategory: "AGGREGATOR", evaluation: null });
  await expect(popup.locator("#result-message")).toHaveText(
    "Saved as a new opportunity. It came from an unrecognised site, so it is kept as a lower-priority source.",
  );
  await expect(popup.locator("#evaluation-state")).toHaveText("Not evaluated yet.");

  // Open in AI Job Assistant: the saved job, browser-extension provenance, unevaluated.
  const [opened] = await Promise.all([context.waitForEvent("page"), popup.getByRole("button", { name: "Open in AI Job Assistant" }).click()]);
  await opened.waitForURL(new RegExp(`/opportunities/${saved.opportunityId}$`));
  await expect(opened.getByRole("heading", { level: 1, name: jobTitle })).toBeVisible();
  await expect(opened.getByText(/127\.0\.0\.1 \(browser extension\)/).first()).toBeVisible();
  await expect(opened.getByRole("heading", { name: "Not evaluated" })).toBeVisible({ timeout: 15_000 });
  await opened.close();

  // Request evaluation: the existing path queues it, the helper worker
  // completes it, and the popup shows the persisted result read-only.
  await popup.getByRole("button", { name: "Request evaluation" }).click();
  await expect(popup.locator("#evaluation-request")).toHaveText("Evaluation requested and queued.");
  await expect(popup.locator("#evaluation-state")).toHaveText(/Evaluation (queued|running)/);
  await expect(popup.getByRole("button", { name: "Request evaluation" })).toBeHidden();
  await runHelper("run-worker");
  await expect(popup.locator("#evaluation-state")).toHaveText(/^Evaluation completed\. Recommendation: \w[\w ]*\.$/, { timeout: 15_000 });

  // Capture again: already saved, its recommendation shown; nothing changed.
  await popup.close();
  ({ popup, requests } = await openPopup(tabId));
  await expect(popup.locator("#saved-message")).toHaveText(`Already saved: ${jobTitle}.`);
  await expect(popup.locator("#evaluation-state")).toHaveText(/^Evaluation completed\. Recommendation:/);
  await popup.getByRole("button", { name: "Read this page" }).click();
  expect(await save(popup)).toMatchObject({ outcome: "UNCHANGED", opportunityId: saved.opportunityId });
  await expect(popup.locator("#result-message")).toHaveText(/^Already saved\. Nothing changed\./);
  await popup.close();
  await job.close();
});

test("a corrected preview, a possible duplicate, running and failed states, and a page with no job", async () => {
  // First posting: correct the structured title in the preview, then save.
  const first = await openJobTab(paths.first);
  const { popup: firstPopup } = await openPopup(first.tabId);
  await firstPopup.getByRole("button", { name: "Read this page" }).click();
  await expect(firstPopup.locator("#preview-source")).toHaveText("Read from the page's structured job data");
  await expect(firstPopup.getByLabel("Title")).toHaveValue(leadTitle);
  await expect(firstPopup.getByLabel("Company")).toHaveValue(`Leadco ${token}`);
  await firstPopup.getByLabel("Title").fill(`${leadTitle} (Remote)`);
  const firstSaved = await save(firstPopup);
  expect(firstSaved).toMatchObject({ outcome: "CREATED" });

  // Second posting of the same job elsewhere: a possible duplicate.
  const second = await openJobTab(paths.second);
  const { popup: secondPopup } = await openPopup(second.tabId);
  await secondPopup.getByRole("button", { name: "Read this page" }).click();
  await expect(secondPopup.getByLabel("Title")).toHaveValue(`${leadTitle} (Remote)`);
  expect(await save(secondPopup)).toMatchObject({ outcome: "CREATED", probableDuplicate: true });
  await expect(secondPopup.locator("#result-message")).toContainText("It may duplicate an opportunity you already have");
  await secondPopup.close();

  // The corrected title is what was saved.
  const app = await context.newPage();
  await app.goto(`${appUrl}/opportunities/${firstSaved.opportunityId}`);
  await expect(app.getByRole("heading", { level: 1, name: `${leadTitle} (Remote)` })).toBeVisible();
  await app.close();

  // Request evaluation on the first, then the persisted running and failed
  // states (test stand-ins for a worker's outcomes) reach the popup.
  await firstPopup.getByRole("button", { name: "Request evaluation" }).click();
  await expect(firstPopup.locator("#evaluation-request")).toHaveText("Evaluation requested and queued.");
  await runHelper("expire-lease", firstSaved.opportunityId!);
  await expect(firstPopup.locator("#evaluation-state")).toHaveText("Evaluation running.", { timeout: 15_000 });
  await runHelper("fail-latest", firstSaved.opportunityId!);
  await expect(firstPopup.locator("#evaluation-state")).toHaveText("The last evaluation failed.", { timeout: 15_000 });
  await expect(firstPopup.getByRole("button", { name: "Request evaluation" })).toBeVisible();
  await expect(firstPopup.locator("body")).not.toContainText("E2E-INTERNAL-DETAIL-MUST-NOT-RENDER");
  await firstPopup.close();

  // A page with no job posting: nothing to save.
  const empty = await openJobTab(paths.empty);
  const { popup: emptyPopup, requests } = await openPopup(empty.tabId);
  await emptyPopup.getByRole("button", { name: "Read this page" }).click();
  await expect(emptyPopup.getByRole("alert")).toHaveText(
    "No job posting was found. Select the job description text on the page and press Read this page again.",
  );
  await expect(emptyPopup.locator("#preview")).toBeHidden();
  expect(requests.some((entry) => entry.includes("/captures"))).toBe(false);
  await emptyPopup.close();

  // The job site received only the user's own page loads.
  expect(jobRequests.filter((url) => url !== "/favicon.ico").every((url) => Object.values(paths).includes(url))).toBe(true);
});

test("the page reader in Chromium: LinkedIn job details only, no whole-page fallback; Welcome to the Jungle through the generic path", async () => {
  // Playwright answers these addresses itself; nothing is requested from
  // LinkedIn or Welcome to the Jungle.
  const answered: Record<string, string> = {
    "https://www.linkedin.com/jobs/search/?currentJobId=4012345678": linkedInLoggedInPage({ id: "4012345678" }),
    "https://www.linkedin.com/jobs/view/4012345679/": linkedInLoggedInPage({ id: "4012345679", renamed: true }),
    "https://www.linkedin.com/feed/": linkedInLoggedInPage({ id: "4012345678" }),
    "https://www.welcometothejungle.com/fr/companies/acme/jobs/csm": `<!doctype html><html><head><title>CSM - Acme</title></head><body>
      <header><nav>Jobs Companies Media</nav></header><main><h1>Customer Success Manager</h1>
      <p>${"Accompagner nos clients dans l'adoption de la plateforme. ".repeat(4)}</p><aside>Similar jobs</aside></main>
      <footer>Welcome to the Jungle</footer></body></html>`,
  };
  const page = await context.newPage();
  await page.route(/^https:\/\/www\.(linkedin|welcometothejungle)\.com\//, (route) => {
    const body = answered[route.request().url()];
    return body ? route.fulfill({ status: 200, contentType: "text/html", body }) : route.abort();
  });
  const read = async (url: string, select?: string) => {
    await page.goto(url);
    if (select) {
      await page.evaluate((selector) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(selector)!);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      }, select);
    }
    return (await page.evaluate(`(${extractJobPosting.toString()})()`)) as PageExtraction;
  };

  const linkedIn = await read("https://www.linkedin.com/jobs/search/?currentJobId=4012345678");
  expect(linkedIn).toMatchObject({ extractor: "site:linkedin", posting: { title: "Senior Customer Success Manager", company: "Acme", siteJobId: "4012345678" } });
  for (const decoy of Object.values(linkedInDecoys)) expect(JSON.stringify(linkedIn)).not.toContain(decoy);

  // Renamed job areas: nothing, unless the user selects the description.
  expect(await read("https://www.linkedin.com/jobs/view/4012345679/")).toMatchObject({ problem: "NO_JOB_CONTENT", posting: null });
  const selected = await read("https://www.linkedin.com/jobs/view/4012345679/", "#job-details-renamed");
  expect(selected).toMatchObject({ extractor: "selection", posting: { title: "Senior Customer Success Manager", siteJobId: "4012345679" } });
  expect(selected.posting?.description).toContain("Own a book of enterprise customers.");
  for (const decoy of Object.values(linkedInDecoys)) expect(JSON.stringify(selected)).not.toContain(decoy);

  // Not a job page: nothing is read, even a selection.
  expect(await read("https://www.linkedin.com/feed/", ".msg-s-event-listitem__body")).toMatchObject({ problem: "LINKEDIN_NOT_JOB_PAGE", selection: null });

  const jungle = await read("https://www.welcometothejungle.com/fr/companies/acme/jobs/csm");
  expect(jungle).toMatchObject({ extractor: "main-content", posting: { title: "Customer Success Manager", company: null } });
  for (const text of ["Jobs Companies Media", "Similar jobs", "Welcome to the Jungle"]) expect(jungle.posting?.description).not.toContain(text);
  await page.close();
});

test("revoking the pairing stops the extension at once", async () => {
  const app = await context.newPage();
  await app.goto(`${appUrl}/extension`);
  await app.getByRole("region", { name: pairingLabel }).getByRole("button", { name: "Revoke…" }).click();
  await app.getByRole("region", { name: pairingLabel }).getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(app.getByRole("region", { name: /Paired browsers/ })).not.toContainText(pairingLabel);
  const { tabId } = await openJobTab(paths.job);
  const { popup } = await openPopup(tabId);
  await expect(popup.getByText("The pairing is no longer valid. Pair this browser again in Options.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Read this page" })).toBeHidden();
});

test("the extension's routes refuse web pages and missing pairings, and pairing management refuses other origins", async ({ request }) => {
  const capture = await request.post(`${appUrl}/api/extension/captures`, { data: {}, headers: { "content-type": "application/json" } });
  expect(capture.status()).toBe(401);
  const fromWeb = await request.post(`${appUrl}/api/extension/captures`, {
    data: {},
    headers: { origin: "https://evil.example", authorization: `Bearer ${credential || `aija_${"A".repeat(43)}`}`, "content-type": "application/json" },
  });
  expect(fromWeb.status()).toBe(403);
  expect((await request.fetch(`${appUrl}/api/extension/captures`, { method: "OPTIONS" })).status()).toBe(405);
  const pairing = await request.post(`${appUrl}/api/extension/pairings`, { data: {}, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
  expect(pairing.status()).toBe(403);
  const withCredential = await request.post(`${appUrl}/api/extension/pairings`, {
    data: {},
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", "sec-fetch-site": "same-origin" },
  });
  expect(withCredential.status()).toBe(403);
});
