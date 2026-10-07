import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Whole-product acceptance, run alone in the final "acceptance" project. The
// deterministic helper worker uses the fixture provider transport, so no
// paid provider call is possible.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-golden-path-helper.mjs");
const opportunityIds: string[] = [];
let profileId = "";
let previousActiveId = "";
let budgetSnapshot = "";

test.beforeAll(async () => {
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
});

test.afterAll(async () => {
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

async function runHelper(...args: string[]) {
  const result = await execFileAsync(process.execPath, [compiledHelper, ...args], { cwd: process.cwd(), env: process.env });
  return result.stdout.trim();
}

test.beforeEach(async () => {
  budgetSnapshot = await runHelper("budget-snapshot");
  await runHelper("budget-restore", "");
  [profileId = "", previousActiveId = ""] = (await runHelper("create-profile")).split(" ");
});

test.afterEach(async () => {
  for (const opportunityId of opportunityIds.splice(0)) await runHelper("cleanup", opportunityId, "");
  await runHelper("cleanup", "", profileId, previousActiveId);
  await runHelper("budget-restore", budgetSnapshot);
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const panel = (page: Page) => page.getByRole("region", { name: "Application" });
const utcToday = () => new Date().toISOString().slice(0, 10);

async function captureThroughUi(page: Page, token: string) {
  const title = `Golden Path Customer Success Manager ${token}`;
  await page.goto("/");
  await nav(page).getByRole("link", { name: "New opportunity" }).click();
  await expect(page).toHaveTitle(/New opportunity · AI Career Platform/);
  await page.getByLabel("Raw opportunity or job-description text").fill([
    `${title} at Goldenco ${token}, a SaaS workflow platform.`,
    "Remote. Applicants must reside in the United States.",
    "Salary $72,000-$88,000. No travel required.",
    "Own onboarding, adoption, education, retention, and business reviews.",
    "3 years of Customer Success experience required.",
  ].join("\n"));
  await page.getByLabel("Title (optional)").fill(title);
  await page.getByLabel("Company (optional)").fill(`Goldenco ${token}`);
  await page.getByLabel("Compensation text (optional)").fill("$72,000-$88,000");
  await page.getByLabel("Where you found it (optional, e.g. LinkedIn)").fill("A recruiter email");
  await page.getByRole("button", { name: "Save opportunity" }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  opportunityIds.push(page.url().split("/").pop()!);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return { title, opportunityId: opportunityIds.at(-1)! };
}

test("golden path: capture, evaluate, decide, apply, track", async ({ page }) => {
  const token = `G${Date.now()}`;
  const { title, opportunityId } = await captureThroughUi(page, token);
  await expect(page.getByText("Found via")).toBeVisible();

  // Find it on the dashboard.
  await nav(page).getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("searchbox", { name: "Search opportunities" }).fill(token);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const row = page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("Not evaluated");
  await row.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${opportunityId}$`));

  // Evaluate: queued → worker → persisted recommendation with evidence and history.
  // "Not evaluated" is rendered by the client after its first status check,
  // so the page is interactive before the button is clicked.
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await expect(page.getByText(/Evaluation is queued, waiting for the evaluation worker/)).toBeVisible();
  await runHelper("run-worker");
  await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Evaluation history (1)")).toBeVisible();
  await expect(page.locator("#opportunity-status-title")).toHaveText("Recommendation ready", { timeout: 15_000 });

  // Back on the dashboard, the row shows the result.
  await page.getByRole("link", { name: "← Back to dashboard" }).click();
  await page.goto(`/?q=${token}`);
  await expect(row).toContainText("Recommendation ready");
  await expect(row).toContainText("Apply");

  // Decide and apply, then track the application.
  await row.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#opportunity-status-title")).toHaveText("Saved");
  await panel(page).getByRole("button", { name: "Planning to apply" }).click();
  await expect(panel(page).locator(".application-summary .status-label-application")).toHaveText("Planning to apply");
  const submit = panel(page).getByRole("form", { name: "Record submission" });
  await submit.getByLabel("Applied on (UTC date)").fill(utcToday());
  await submit.getByRole("button", { name: "I've applied" }).click();
  await expect(page.locator("#opportunity-status-title")).toHaveText("Applied");
  const followUp = panel(page).getByRole("form", { name: "Add follow-up" });
  await followUp.getByLabel("Next action").fill("Check in with the recruiter");
  await followUp.getByLabel("Due (UTC date)").fill(utcToday());
  await followUp.getByRole("button", { name: "Add follow-up" }).click();
  await expect(panel(page).getByText(/Next action: Check in with the recruiter/)).toBeVisible();

  // Dashboard and tracker agree.
  await page.goto(`/?view=applied&q=${token}`);
  await expect(row).toContainText("Application: Applied");
  await expect(row).toContainText(`Next follow-up ${utcToday()}`);
  await nav(page).getByRole("link", { name: "Applications" }).click();
  await expect(page).toHaveTitle(/Applications · AI Career Platform/);
  const tracked = page.getByRole("table", { name: "Applications" }).getByRole("row").filter({ hasText: title });
  await expect(tracked).toContainText("Due today");
  await page.getByRole("link", { name: /^Due today: [1-9]\d*$/ }).click();
  await expect(page).toHaveURL(/\/applications\?followUp=today$/);
  await expect(page.getByRole("table", { name: "Applications" })).toContainText(title);

  // Profile and budget remain reachable from anywhere.
  await nav(page).getByRole("link", { name: "Profile & preferences" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Profile & preferences" })).toBeVisible();
  await nav(page).getByRole("link", { name: "Budget" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Budget & deferred evaluations" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Budget" })).toHaveAttribute("aria-current", "page");
});

test("recovery: polling survives refresh; a stale lease is reported honestly and recovered by the worker", async ({ page }) => {
  const token = `R${Date.now()}`;
  const { opportunityId } = await captureThroughUi(page, token);

  // "Not evaluated" is rendered by the client after its first status check,
  // so the page is interactive before the button is clicked.
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Evaluation is queued, waiting for the evaluation worker/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluation in progress" })).toBeDisabled();

  // A worker died during the final attempt: the lease expired. The page does
  // not claim the worker stopped; it says the run may still be in progress.
  await runHelper("expire-lease", opportunityId);
  const stale = page.getByText(/This evaluation has run longer than its worker lease/);
  await expect(stale).toBeVisible({ timeout: 15_000 });
  await expect(stale).toContainText("may still be in progress, or the worker may have stopped");

  // The worker's own recovery (under the single-worker lock) fails it safely.
  expect(await runHelper("run-recovery")).toBe("1");
  const alert = page.getByRole("alert").filter({ hasText: "could not complete safely" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText("EVALUATION_LEASE_EXPIRED");
  await expect(alert).toContainText("The evaluation worker stopped before this evaluation finished");
  await expect(page.getByRole("button", { name: "Reevaluate opportunity" })).toBeEnabled();

  // Unknown pages offer a way back.
  await page.goto("/opportunities/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to the dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/opportunities/not-an-id");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
