import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Feature 18: Company Intelligence from the main navigation over one seeded
// company with its own synthetic name (no provider, no network): two Company
// rows sharing a normalized name, a currently listed role you were screened
// for, a role listed again after removal, and a manual capture that closed
// with no response. It runs in its own project after every other spec.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-company-helper.ts");
const compiledHelper = path.resolve(`database/.e2e-company-helper-${process.env.TEST_WORKER_INDEX ?? "0"}.mjs`);
const token = randomUUID().slice(0, 8);
let seeded: { companyId: string; legacyId: string; screenedId: string };

const runHelper = async (...args: string[]) =>
  (await execFileAsync(process.execPath, [compiledHelper, ...args], { cwd: process.cwd(), env: process.env })).stdout;

test.beforeAll(async () => {
  await build({ entryPoints: [helper], outfile: compiledHelper, bundle: true, platform: "node", format: "esm", target: "node20", external: ["@prisma/*", "pg", "dotenv", "zod"], logLevel: "silent" });
  seeded = JSON.parse((await runHelper("seed", token)).trim().split("\n").at(-1)!);
});

test.afterAll(async () => {
  await runHelper("cleanup", token);
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

test("Companies is in the main navigation and lists a seeded company with its name variant", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Companies" }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
  await expect(page.getByText("Companies are grouped by exact normalized name.").first()).toBeVisible();

  const options = page.getByRole("form", { name: "Company options" });
  await options.getByLabel("Company name").fill(`Zenith Robotics ${token}`);
  await options.getByLabel("Has your applications").check();
  await options.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/applied=1/);
  const row = page.getByRole("row", { name: new RegExp(`Zenith Robotics ${token}`) });
  await expect(row).toContainText("+1 name variant");
  // Observed roles 3, currently listed 2, listed again 1, recurring groups 1, remote 2 of 3, applications 2, interviews 1, offers 0.
  await expect(row.getByRole("cell").nth(0)).toHaveText("3");
  await expect(row).toContainText("2 of 3");

  // A filter that excludes it, and an invalid query explained.
  await page.goto(`/companies?q=${encodeURIComponent(`Zenith Robotics ${token}`)}&arrangement=ONSITE`);
  await expect(page.getByText("No companies match these options.")).toBeVisible();
  await page.goto("/companies?sort=best");
  await expect(page.getByRole("alert").filter({ hasText: "sort must be one of" })).toBeVisible();
  expect((await page.request.get("/api/companies?window=7d")).status()).toBe(400);
});

test("a company page shows observed postings, recurring roles, arrangement, your history and posting-history signals", async ({ page }) => {
  await page.goto(`/companies?q=${encodeURIComponent(`Zenith Robotics ${token}`)}`);
  await page.getByRole("link", { name: `Zenith Robotics ${token}` }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${seeded.companyId}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Zenith Robotics ${token}` })).toBeVisible();
  for (const name of ["Overview", "Observed postings", "Recurring roles", "Work arrangement and hiring regions", "Your history with this company", "Posting-history signals"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("Observed roles3");
  await expect(overview).toContainText("Currently listed2");
  await expect(overview).toContainText("Status unknown1");
  await expect(page.getByRole("region", { name: "Recurring roles" }).getByRole("table", { name: "Roles by title group" })).toContainText("recurring");
  await expect(page.getByRole("region", { name: "Work arrangement and hiring regions" })).toContainText("2 of 3 observed roles that state an arrangement were Remote.");
  const history = page.getByRole("region", { name: "Your history with this company" });
  await expect(history).toContainText("No response (recorded outcome)");
  // Whole days in the budget's time zone: one application with a recorded screening, one closed.
  const timing = history.getByRole("table", { name: "Days from your application" });
  await expect(timing.getByRole("row", { name: /^To first progress recorded/ })).toContainText("(n = 1)");
  await expect(timing.getByRole("row", { name: /^To closed/ })).toContainText("30 days (n = 1)");
  await expect(history).toContainText("not when the company replied");
  await expect(page.getByRole("region", { name: "Posting-history signals" })).toContainText("1 of 3 observed roles (1 time in total)");
  await expect(page.getByRole("region", { name: "Posting-history signals" }).getByRole("table", { name: "Listings shown again after removal" })).toContainText(`Zenith board ${token}`);

  // The legacy row resolves to the same company; an unknown id is not found; the window is validated.
  expect((await page.request.get(`/api/companies/${seeded.legacyId}`)).status()).toBe(200);
  expect((await page.request.get(`/api/companies/${randomUUID()}`)).status()).toBe(404);
  expect((await page.request.get(`/api/companies/${seeded.companyId}?window=7d`)).status()).toBe(400);
  const missing = await page.goto(`/companies/${randomUUID()}`);
  expect(missing?.status()).toBe(404);

  // The opportunity page links its company.
  await page.goto(`/opportunities/${seeded.screenedId}`);
  await page.getByRole("link", { name: `Zenith Robotics ${token}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${seeded.companyId}$`));
});
