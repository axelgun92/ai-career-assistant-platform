import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Feature 15: Source Intelligence from /sources to the comparison page and a
// source's drill-down, over a seeded synthetic history (no provider, no
// network). It runs in its own project after every other spec, so its
// seeded rows never mix with another spec's.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-insights-helper.ts");
const compiledHelper = path.resolve(`database/.e2e-insights-helper-${process.env.TEST_WORKER_INDEX ?? "0"}.mjs`);
const token = randomUUID().slice(0, 8);
let seeded: { board: string; ats: string; shared: string };

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

test("a source card's value strip leads to its drill-down, with credit and presence kept apart", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.getByRole("navigation", { name: "Sources sections" }).getByRole("link", { name: "Source insights" })).toBeVisible();
  const card = page.getByRole("region", { name: `Insights board ${token}` });
  const strip = card.getByRole("link", { name: /^Last 30 days: 2 found · 2 new · 1 useful of 1 evaluated \(insufficient sample\) · \$0\.42 per useful job$/ });
  await expect(strip).toBeVisible();
  await strip.click();
  await expect(page).toHaveURL(new RegExp(`/sources/${seeded.board}/insights$`));
  await expect(page.getByRole("heading", { level: 1, name: `Insights board ${token}` })).toBeVisible();
  await expect(page.getByRole("table", { name: "Discovery to outcome" })).toContainText("Useful rate (Apply or Review ÷ evaluated)100% (1 of 1) · Insufficient sample");
  await expect(page.getByRole("table", { name: /Evaluation state/ })).toContainText("Waiting: AI budget1");
  await expect(page.getByRole("table", { name: /Newest first/ })).toContainText("Discovered here first");

  // The employer ATS listed the same job later: presence, not credit.
  await page.goto(`/sources/${seeded.ats}/insights`);
  const rows = page.getByRole("table", { name: /Newest first/ });
  await expect(rows).toContainText(`Also listed; discovered by Insights board ${token}`);
  await expect(page.getByRole("table", { name: "Discovery to outcome" })).toContainText("1 applications, 1 interviews, 0 offers");
});

test("the comparison page keeps user-collected jobs apart and responds to window and grouping", async ({ page }) => {
  await page.goto("/sources/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Source insights" })).toBeVisible();
  const automated = page.getByRole("table", { name: /^Automated sources, last 30 days$/ });
  const boardRow = automated.getByRole("row", { name: new RegExp(`Insights board ${token}`) });
  await expect(boardRow).toContainText("Insufficient sample");
  const atsRow = automated.getByRole("row", { name: new RegExp(`Insights ATS ${token}`) });
  await expect(atsRow.getByRole("cell").nth(2)).toHaveText("1");
  await expect(page.getByRole("table", { name: /^User-collected, last 30 days$/ })).toContainText("Manual entry");

  // All time brings in the older ATS listing.
  const options = page.getByRole("form", { name: "Source insights options" });
  await options.getByLabel("Window").selectOption("all");
  await options.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/window=all/);
  const allTime = page.getByRole("table", { name: /^Automated sources, all time$/ });
  await expect(allTime.getByRole("row", { name: new RegExp(`Insights ATS ${token}`) }).getByRole("cell").nth(2)).toHaveText("2");

  // Grouping by adapter is a secondary view.
  await options.getByLabel("Group by").selectOption("adapter");
  await options.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/groupBy=adapter/);
  await expect(page.getByRole("table", { name: /^Automated sources, all time$/ }).getByRole("row", { name: /^Greenhouse/ })).toBeVisible();

  // An invalid custom window is explained, not guessed.
  await page.goto("/sources/insights?window=custom&from=2026-10-10&to=2026-10-01");
  // (Next.js's route announcer is also an alert, so match the page's own message.)
  await expect(page.getByRole("alert").filter({ hasText: "from date must be on or before its to date" })).toBeVisible();

  // An unknown source is not found.
  const missing = await page.goto("/sources/adapter--/insights");
  expect(missing?.status()).toBe(404);
});
