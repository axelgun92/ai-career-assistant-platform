import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Feature 17: Personal Job-Search Analytics from the main navigation over a
// seeded history applied in March 2025, a window no other spec writes to (no
// provider, no network). Its evaluations record no profile, so the spec reads
// them with profile=none and never touches the active profile. It runs in its
// own project after every other spec.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-personal-helper.ts");
const compiledHelper = path.resolve(`database/.e2e-personal-helper-${process.env.TEST_WORKER_INDEX ?? "0"}.mjs`);
const token = randomUUID().slice(0, 8);
const cohort = "/my-search?window=custom&from=2025-03-01&to=2025-03-31&profile=none";

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

test("My search is in the main navigation and shows every section with its disclosure", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My search" }).click();
  await expect(page).toHaveURL(/\/my-search$/);
  await expect(page.getByRole("heading", { level: 1, name: "My search" })).toBeVisible();
  for (const name of ["Overview", "Application funnel", "Roles", "Recurring Genuine Gaps", "Sources", "Where applications are not progressing", "Company type"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText("These tables show what happened after each stored evaluation or recommendation. They do not measure evaluator accuracy.").first()).toBeVisible();
});

test("a seeded history shows funnels, timing, gaps, sources and groups not progressing", async ({ page }) => {
  await page.goto(cohort);
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("Applied8");
  await expect(overview).toContainText("In process1");
  // Offers ÷ resolved: the interviewing application is excluded (5 mature no-progress + rejected + offer).
  await expect(overview).toContainText("14% (1 of 7)");

  const funnel = page.getByRole("region", { name: "Application funnel" });
  await expect(funnel.getByRole("table", { name: "All applications" })).toContainText("Recruiter screen2");
  await expect(funnel.getByRole("table", { name: "All applications" })).toContainText("Offer accepted1");
  const atApplication = funnel.getByRole("table", { name: "Applications by recommendation at application" });
  await expect(atApplication.getByRole("row", { name: /^Same-day order unknown/ })).toContainText("1");
  await expect(atApplication.getByRole("row", { name: /^Apply/ })).toBeVisible();
  await expect(atApplication.getByRole("row", { name: /^Not evaluated/ })).toContainText("6");

  const gaps = page.getByRole("region", { name: "Recurring Genuine Gaps" });
  await expect(gaps).toContainText("evaluations without a recorded profile");
  await expect(gaps.getByRole("table", { name: "Most repeated gap requirements, as written" })).toContainText("Salesforce");

  const sources = page.getByRole("region", { name: "Sources" });
  await expect(sources.getByRole("link", { name: "Source insights" })).toHaveAttribute("href", "/sources/insights");
  await expect(sources.getByRole("table", { name: "Collected by you" })).toContainText("Manual entry");

  await expect(page.getByRole("region", { name: "Where applications are not progressing" })).toContainText("Title group: Implementation — 5 mature applications, no interviews yet");
  await expect(page.getByRole("region", { name: "Company type" }).getByRole("table", { name: /customer segment/ })).toContainText("SMB");

  // Filters: recommendation at application narrows application figures.
  const options = page.getByRole("form", { name: "My search options" });
  await options.getByLabel("Recommendation at application").selectOption("SAME_DAY_UNKNOWN");
  await options.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/recommendation=SAME_DAY_UNKNOWN/);
  await expect(page.getByRole("region", { name: "Overview" })).toContainText("Applied1");

  // An invalid window is explained; the API answers 400.
  await page.goto("/my-search?window=custom&from=2025-03-10&to=2025-03-01");
  await expect(page.getByRole("alert").filter({ hasText: "from date must be on or before its to date" })).toBeVisible();
  expect((await page.request.get("/api/my-search?window=7d")).status()).toBe(400);
});
