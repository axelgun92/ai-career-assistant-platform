import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Features 1–10 Gap Closure: capture-time deduplication, duplicate notices,
// company grouping, the stated time-zone requirement and phone-width layout.

const opportunityIds: string[] = [];
const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
// One bundle per Playwright worker: this file's tests may be split across
// workers, and a shared bundle could be deleted by one worker's afterAll
// while another still uses it.
const compiledHelper = path.resolve(`database/.e2e-dedup-helper-${process.env.TEST_WORKER_INDEX ?? "0"}.mjs`);

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

test.afterEach(async () => {
  for (const opportunityId of new Set(opportunityIds.splice(0))) {
    await execFileAsync(process.execPath, [compiledHelper, "cleanup", opportunityId, ""], { cwd: process.cwd(), env: process.env });
  }
});

const idFrom = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

async function fillCapture(page: Page, input: { title: string; company: string; url?: string; timeZone?: string; text?: string }) {
  await page.goto("/opportunities/new");
  await page.getByLabel("Raw opportunity or job-description text").fill(
    input.text ?? `${input.title} at ${input.company}. Own onboarding, adoption, renewals and business reviews.`,
  );
  await page.getByLabel("Title (optional)").fill(input.title);
  await page.getByLabel("Company (optional)").fill(input.company);
  if (input.url) await page.getByLabel("Source URL (optional)").fill(input.url);
  if (input.timeZone) await page.getByLabel("Time-zone requirements").fill(input.timeZone);
  await page.getByRole("button", { name: "Save opportunity" }).click();
}

async function capture(page: Page, input: Parameters<typeof fillCapture>[1]) {
  await fillCapture(page, input);
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}(\?.*)?$/);
  opportunityIds.push(idFrom(page));
  return idFrom(page);
}

test("an exact re-capture is added to the saved opportunity; keeping it separate is reversible", async ({ page }) => {
  const token = randomUUID().slice(0, 8);
  const listing = { title: "Customer Success Manager", company: `Dedupe2E ${token}`, url: `https://boards.greenhouse.io/dedupe2e/jobs/${token}` };
  const original = await capture(page, listing);

  await fillCapture(page, { ...listing, url: `${listing.url}?utm_source=newsletter` });
  const panel = page.getByRole("alert").filter({ hasText: "This listing is already saved" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(`Customer Success Manager · Dedupe2E ${token}`);
  await panel.getByRole("button", { name: "Add as another source" }).click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${original}\\?capture=attached$`));
  await expect(page.getByText("This listing was already saved. Your capture was added to it as another source.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source records (2)" })).toBeVisible();
  await expect(page.getByText(/Added as another source on .*an exact duplicate of this opportunity \(same listing URL\)/)).toBeVisible();

  await fillCapture(page, listing);
  await page.getByRole("button", { name: "Save as a separate opportunity" }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  const separate = idFrom(page);
  opportunityIds.push(separate);
  expect(separate).not.toBe(original);
  const notices = page.getByRole("region", { name: "Duplicates" });
  await expect(notices).toContainText(`Marked as a different job from Customer Success Manager · Dedupe2E ${token}.`);

  await notices.getByRole("button", { name: "Undo" }).click();
  await expect(notices).toContainText("is the same listing (same listing URL)");
  await expect(notices.getByRole("button", { name: "Not the same job" })).toBeVisible();
  await page.goto(`/?view=all&q=${token}`);
  await expect(page.getByRole("list", { name: "Opportunities" }).getByText("Duplicate listing")).toHaveCount(2);
});

test("a possible duplicate is flagged on its page and on the dashboard", async ({ page }) => {
  const token = randomUUID().slice(0, 8);
  await capture(page, { title: "Customer Success Manager", company: `Probablee2e ${token}` });
  await capture(page, { title: "Senior Customer Success Manager", company: `Probablee2e ${token}` });
  await expect(page).toHaveURL(/\?capture=probable$/);
  await expect(page.getByRole("region", { name: "Duplicates" })).toContainText("is a possible duplicate (same company, similar title");
  await page.goto(`/?view=all&q=${token}`);
  await expect(page.getByRole("list", { name: "Opportunities" }).getByText("Possible duplicate")).toHaveCount(2);
});

test("the company filter treats spellings of one company as one company", async ({ page }) => {
  const token = randomUUID().slice(0, 8);
  await capture(page, { title: "Onboarding Specialist", company: `Groupco ${token}, Inc.`, text: `Onboarding ${token} for new customers.` });
  await capture(page, { title: "Renewals Manager", company: `GROUPCO ${token}`, text: `Renewals ${token} across the portfolio.` });
  await page.goto(`/?view=all&q=${token}`);
  const options = page.locator('select[name="company"] option', { hasText: `Groupco ${token}` });
  await expect(options).toHaveCount(1);
  await expect(options).toHaveText(`Groupco ${token}, Inc. (2)`);
  await page.goto(`/?view=all&q=${token}&company=${encodeURIComponent(`groupco ${token.toLowerCase()}`)}`);
  await expect(page.getByText("Showing 1–2 of 2 opportunities")).toBeVisible();
});

test("a stated time-zone requirement is kept, and long URLs fit a phone screen", async ({ page }) => {
  const token = randomUUID().slice(0, 8);
  await capture(page, {
    title: "Customer Success Manager",
    company: `Zonee2e ${token}`,
    url: `https://boards.greenhouse.io/averyveryverylongcompanynameforlayouttesting/jobs/${token}123456789?gh_src=abcdefghij`,
    timeZone: "US Eastern business hours",
  });
  await page.getByText("Normalized opportunity and source details").click();
  await expect(page.locator("details.source-details")).toContainText("US Eastern business hours");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Source and provenance" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
