import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Feature 16: Job-Market Analytics from the main navigation over a seeded
// cohort first seen in early March 2025, a window no other spec writes to (no
// provider, no network). It runs in its own project after every other spec.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-market-helper.ts");
const compiledHelper = path.resolve(`database/.e2e-market-helper-${process.env.TEST_WORKER_INDEX ?? "0"}.mjs`);
const token = randomUUID().slice(0, 8);
const cohort = "/market?window=custom&from=2025-03-03&to=2025-03-09";

const runHelper = async (...args: string[]) =>
  (await execFileAsync(process.execPath, [compiledHelper, ...args], { cwd: process.cwd(), env: process.env })).stdout;

test.beforeAll(async () => {
  await build({ entryPoints: [helper], outfile: compiledHelper, bundle: true, platform: "node", format: "esm", target: "node20", external: ["@prisma/*", "pg", "dotenv", "zod"], logLevel: "silent" });
  await runHelper("seed", token);
});

test.afterAll(async () => {
  await runHelper("cleanup", token);
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

test("Market is in the main navigation and shows every section with its disclosures", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Market" }).click();
  await expect(page).toHaveURL(/\/market$/);
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
  for (const name of ["Overview", "Salary", "Roles and titles", "Location and work arrangement", "Seniority", "Requirements", "Customer segment — evaluated jobs only", "Recommendations"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText("Evaluations are jobs you chose to evaluate. These results describe evaluated opportunities, not the entire collected market.").first()).toBeVisible();
});

test("a seeded cohort keeps currencies, bases and tiers apart and responds to filters", async ({ page }) => {
  await page.goto(cohort);
  const overview = page.getByRole("region", { name: "Overview" });
  // Automated only by default: the manual entry is not in the cohort.
  await expect(overview).toContainText("Jobs in cohort4");
  await expect(page.getByText(/Automated retrieval began on October 18, 2026/)).toBeVisible();

  const salary = page.getByRole("region", { name: "Salary" });
  await expect(salary.getByRole("table", { name: "Salary statistics, USD, base salary" })).toContainText("Median midpoint (both bounds stated)$110,000 (n = 1) · Insufficient sample");
  await expect(salary.getByRole("table", { name: "Jobs stating pay, by currency" })).toContainText("CAD10");
  await expect(salary.getByRole("table", { name: "Tiered pay as stated" })).toContainText("Zone B");

  const location = page.getByRole("region", { name: "Location and work arrangement" });
  await expect(location.getByRole("table", { name: "Work arrangement" }).getByRole("row", { name: /^Several options/ })).toContainText("1");
  await expect(location.getByRole("table", { name: "Job location region" }).getByRole("row", { name: /^United Kingdom/ })).toContainText("1");

  const requirements = page.getByRole("region", { name: "Requirements" });
  await expect(requirements.getByRole("table", { name: "Requirement data by JD Reconstruction version" })).toContainText("cs-jd-reconstruction-v31Yes");
  await expect(requirements).toContainText("Gainsight");

  const recommendations = page.getByRole("region", { name: "Recommendations" });
  await expect(recommendations.getByRole("table", { name: "Evaluation state" })).toContainText("Waiting: AI budget1");
  await expect(recommendations.getByRole("link", { name: /^100% \(1 of 1\)/ })).toHaveAttribute("href", /rec=apply/);
  // The first-seen week's distribution: shares of its completed evaluations, with n and coverage.
  const week = recommendations.getByRole("table", { name: "Recommendations by first-seen week" }).getByRole("row", { name: /^2025-03-03/ });
  await expect(week).toContainText("25% (1 of 4)");
  await expect(week).toContainText("100% (1 of 1) · Insufficient sample");

  // Another currency is a separate set of statistics, never combined.
  const options = page.getByRole("form", { name: "Market options" });
  await options.getByLabel("Salary currency").selectOption("CAD");
  await options.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/currency=CAD/);
  await expect(page.getByRole("table", { name: "Salary statistics, CAD, base salary" })).toContainText("CA$85,000 (n = 1)");
  await expect(page.getByRole("table", { name: "Salary statistics, USD, base salary" })).toHaveCount(0);

  // All collected adds the manual entry, with the selection-bias note.
  await page.getByRole("form", { name: "Market options" }).getByLabel("Collected by").selectOption("all");
  await page.getByRole("form", { name: "Market options" }).getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/collected=all/);
  await expect(page.getByRole("region", { name: "Overview" })).toContainText("Jobs in cohort5");
  await expect(page.getByText(/These are user-selected captures and may introduce selection bias\./)).toBeVisible();

  // An invalid window is explained, not guessed; the API answers 400.
  await page.goto("/market?window=custom&from=2025-03-10&to=2025-03-01");
  await expect(page.getByRole("alert").filter({ hasText: "from date must be on or before its to date" })).toBeVisible();
  const response = await page.request.get("/api/market?window=year");
  expect(response.status()).toBe(400);
});
