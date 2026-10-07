import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// The budget is global, so these run one at a time and (via the Playwright
// project config) after every other spec.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-budget-helper.mjs");
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

async function createOpportunity(request: APIRequestContext, title: string) {
  const response = await request.post("/api/opportunities", {
    data: {
      title,
      company: "Deterministic SaaS",
      location: "Remote - United States",
      compensationText: "$72,000-$88,000",
      domain: "customer-success",
      rawText: [
        "Customer Success Manager at a SaaS workflow platform.",
        "Remote. Applicants must reside in the United States.",
        "Salary $72,000-$88,000. No travel required.",
        "Own onboarding, adoption, education, retention, and business reviews.",
      ].join("\n"),
    },
  });
  expect(response.status()).toBe(201);
  const { opportunity } = (await response.json()) as { opportunity: { id: string } };
  opportunityIds.push(opportunity.id);
  return opportunity.id;
}

async function setBudget(page: Page, input: { amount: string; reserve: string; enforced: boolean }) {
  await page.goto("/budget");
  await page.getByLabel("Monthly budget").fill(input.amount);
  await page.getByLabel("Currency").fill("USD");
  await page.getByLabel("Time zone").fill("UTC");
  await page.getByLabel("Reserve per evaluation").fill(input.reserve);
  const enforce = page.getByLabel(/Enforce the budget/);
  if ((await enforce.isChecked()) !== input.enforced) await enforce.click();
  await page.getByRole("button", { name: /^(Set|Save) budget$/ }).click();
  await expect(page.getByText("Budget saved.")).toBeVisible();
}

test("an evaluation that does not fit is deferred, listed, and resumed when budget frees up", async ({ page, request }) => {
  const suffix = Date.now();
  const fitsTitle = `Budget fits ${suffix}`;
  const deferredTitle = `Budget deferred ${suffix}`;
  const fits = await createOpportunity(request, fitsTitle);
  const deferred = await createOpportunity(request, deferredTitle);

  await setBudget(page, { amount: "1", reserve: "0.6", enforced: true });
  await expect(page.locator(".budget-card")).toContainText(/Remaining \(known\)\s*\$1\.00/);

  await page.goto(`/opportunities/${fits}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByText("Evaluation accepted and queued")).toBeVisible();

  await page.goto(`/opportunities/${deferred}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByText("Evaluation deferred: the budget does not have room right now")).toBeVisible();
  const notice = page.getByRole("region", { name: "Waiting for AI budget" });
  await expect(notice).toContainText("$0.60 was reserved for unfinished evaluations, leaving $0.40");
  await expect(notice).toContainText("no AI cost was incurred");
  await expect(page.getByRole("heading", { name: "Deferred — waiting for budget" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator(".budget-card")).toContainText("1 evaluation deferred");
  await expect(page.locator(".budget-card")).toContainText(/Reserved\s*\$0\.60/);
  await expect(page.locator(`li:has(a[href="/opportunities/${deferred}"])`)).toContainText("Evaluation deferred");

  await page.goto("/budget");
  const row = page.locator("tr", { hasText: deferredTitle });
  await expect(row).toContainText("Budget unavailable");
  await row.getByRole("button", { name: "Resume" }).click();
  await expect(row).toContainText("Still deferred");

  await runHelper("run-worker"); // the first evaluation completes; its hold is released
  await row.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Queued — the evaluation will run shortly.")).toBeVisible();
  await expect(page.getByText("No evaluations are waiting for budget.")).toBeVisible();

  await runHelper("run-worker");
  await page.goto(`/opportunities/${deferred}`);
  await expect(page.getByRole("heading", { name: "Completed" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting for AI budget" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator(".budget-card")).not.toContainText(/\d+ evaluations? deferred/);
  // Actual recorded cost replaced the reservation.
  await expect(page.locator(".budget-card")).toContainText(/Known spend\s*\$0\.\d*[1-9]/);
  await expect(page.locator(".budget-card")).toContainText(/Reserved\s*\$0\.00/);
});

test("disabling enforcement lets a deferred evaluation be resumed from the opportunity", async ({ page, request }) => {
  const title = `Budget enforcement ${Date.now()}`;
  const opportunityId = await createOpportunity(request, title);
  await setBudget(page, { amount: "0.1", reserve: "0.6", enforced: true });

  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByRole("region", { name: "Waiting for AI budget" })).toBeVisible();

  await setBudget(page, { amount: "0.1", reserve: "0.6", enforced: false });
  await expect(page.locator(".budget-card")).toContainText("Not enforced");

  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Resume deferred evaluation" }).click();
  await expect(page.getByText("Evaluation accepted and queued")).toBeVisible();
  await runHelper("run-worker");
  await expect(page.getByRole("heading", { name: "Completed" })).toBeVisible({ timeout: 15_000 });
});

test("a deferred request can be cancelled from the opportunity", async ({ page, request }) => {
  const opportunityId = await createOpportunity(request, `Budget cancel ${Date.now()}`);
  await setBudget(page, { amount: "0.1", reserve: "0.6", enforced: true });
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  const notice = page.getByRole("region", { name: "Waiting for AI budget" });
  await notice.getByRole("button", { name: "Cancel request…" }).click();
  await notice.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByRole("region", { name: "Waiting for AI budget" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible();
});
