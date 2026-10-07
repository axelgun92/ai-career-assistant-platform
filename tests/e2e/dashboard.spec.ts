import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Runs in its own Playwright project (after the budget project): it sets a
// budget to create a deferral and activates its own profile. Every assertion
// is scoped by a unique token in titles and company names.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-dashboard-filters-helper.mjs");
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

async function createOpportunity(request: APIRequestContext, title: string, company: string) {
  const response = await request.post("/api/opportunities", {
    data: {
      title,
      company,
      location: "Remote - United States",
      compensationText: "$72,000-$88,000",
      domain: "customer-success",
      rawText: [
        `${title} at ${company}, a SaaS workflow platform.`,
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

async function evaluate(request: APIRequestContext, opportunityId: string, review = false) {
  expect((await request.post(`/api/opportunities/${opportunityId}/evaluate`, { data: {} })).status()).toBe(202);
  await runHelper("run-worker", ...(review ? ["review"] : []));
}

const rows = (page: Page) => page.getByRole("list", { name: "Opportunities" }).getByRole("listitem");

async function search(page: Page, text: string) {
  await page.getByRole("searchbox", { name: "Search opportunities" }).fill(text);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

test("search, filter, sort, and URL state survive refresh and back navigation", async ({ page, request }) => {
  const token = `T${Date.now()}`;
  const alpha = await createOpportunity(request, `Alpha Customer Success Manager ${token}`, `Alphaco ${token}`);
  const beta = await createOpportunity(request, `Beta Onboarding Lead ${token}`, `Betaco ${token}`);
  await createOpportunity(request, `Gamma Support Specialist ${token}`, `Gammaco ${token}`);
  await evaluate(request, alpha);
  await evaluate(request, beta, true);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await search(page, token);
  await expect(page.getByText("Showing 1–3 of 3 opportunities")).toBeVisible();

  await search(page, `betaco ${token}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Beta Onboarding Lead");

  await search(page, `alpha customer ${token}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Alpha Customer Success Manager");

  // Multiple filters: recommendation Apply or Review, evaluation completed.
  await search(page, token);
  await page.getByText("Filters", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Apply", exact: true }).check();
  await expect(page).toHaveURL(/rec=apply/);
  await page.getByRole("checkbox", { name: "Review", exact: true }).check();
  await expect(page).toHaveURL(/rec=apply&rec=review/);
  await page.getByRole("checkbox", { name: "Completed", exact: true }).check();
  await expect(page).toHaveURL(/eval=completed/);
  await expect(page.getByText("Showing 1–2 of 2 opportunities")).toBeVisible();

  await page.getByLabel("Sort").selectOption("title");
  await expect(page).toHaveURL(/sort=title/);
  await expect(rows(page).nth(0)).toContainText("Alpha Customer Success Manager");
  await expect(rows(page).nth(1)).toContainText("Beta Onboarding Lead");
  await expect(rows(page).nth(0)).toContainText("Apply");
  await expect(rows(page).nth(1)).toContainText("Review");

  // Refresh keeps the exact view.
  const filteredUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByText("Showing 1–2 of 2 opportunities")).toBeVisible();
  await expect(page.getByRole("link", { name: "Remove filter Recommendation: Review" })).toBeVisible();

  // Remove one chip.
  await page.getByRole("link", { name: "Remove filter Recommendation: Review" }).click();
  await expect(page).not.toHaveURL(/rec=review/);
  await expect(rows(page)).toHaveCount(1);
  const narrowedUrl = page.url();

  // Open a result, then come back to the same filtered view.
  await rows(page).first().getByRole("link", { name: /Alpha Customer Success Manager/ }).click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${alpha}$`));
  await page.goBack();
  await expect(page).toHaveURL(narrowedUrl);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Alpha Customer Success Manager");

  // Clear all keeps the sort but drops every filter.
  await page.getByRole("link", { name: "Clear all filters" }).first().click();
  await expect(page).toHaveURL(/\/\?sort=title$/);

  // No results.
  await search(page, `nomatch${token}`);
  await expect(page.getByText("No opportunities match these filters.")).toBeVisible();
  await expect(page.getByText("No opportunities found")).toBeVisible();
});

test("deferred and lifecycle badges, and a page past the end lands on the last page", async ({ page, request }) => {
  const token = `D${Date.now()}`;
  const saved = await createOpportunity(request, `Saved Renewals Manager ${token}`, `Savedco ${token}`);
  expect((await request.post(`/api/opportunities/${saved}/action`, { data: { action: "SAVE" } })).status()).toBe(200);
  const deferred = await createOpportunity(request, `Deferred Adoption Manager ${token}`, `Deferco ${token}`);
  const budget = await request.put("/api/budget", {
    data: { amount: 0.1, currency: "USD", timeZone: "UTC", reservePerEvaluation: 0.6, enforced: true },
  });
  expect(budget.status()).toBe(200);
  const outcome = await request.post(`/api/opportunities/${deferred}/evaluate`, { data: {} });
  expect(outcome.status()).toBe(200);

  await page.goto(`/?q=${token}`);
  const savedRow = rows(page).filter({ hasText: "Saved Renewals Manager" });
  await expect(savedRow).toContainText("Saved");
  await expect(savedRow).toContainText("Not evaluated");
  const deferredRow = rows(page).filter({ hasText: "Deferred Adoption Manager" });
  await expect(deferredRow).toContainText("Evaluation deferred");

  await page.goto(`/?view=all&q=${token}&eval=deferred`);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Remove filter Evaluation: Deferred for budget" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Deferred for budget: [1-9]/ })).toBeVisible();

  // A page beyond the end is replaced by the last valid page in the URL.
  await page.goto(`/?q=${token}&pageSize=10&page=99`);
  await expect(page).toHaveURL(new RegExp(`/\\?q=${token.toLowerCase()}&pageSize=10$`));
  await expect(page.getByText("Showing 1–2 of 2 opportunities")).toBeVisible();
});
