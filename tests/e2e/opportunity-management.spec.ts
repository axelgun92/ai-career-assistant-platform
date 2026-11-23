import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Opportunity management and target job titles (November 22, 2026) end to
// end: dashboard selection, row and bulk Move to, Dismissed restore,
// permanent deletion and Empty Dismissed, the titles cleanup filter, the
// opportunity page's Move to, and the Profile's Target Job Titles with Test a
// title. Its own project, last: Empty Dismissed acts on every dismissed
// opportunity of the test database.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-opportunity-management-helper.mjs");
const opportunityIds: string[] = [];

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
  for (const opportunityId of opportunityIds.splice(0)) {
    await execFileAsync(process.execPath, [compiledHelper, "cleanup", opportunityId, ""], { cwd: process.cwd(), env: process.env });
  }
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

async function createOpportunity(request: APIRequestContext, title: string, company: string) {
  const response = await request.post("/api/opportunities", {
    data: { title, company, location: "Remote - United States", domain: "customer-success", rawText: `${title} at ${company}. Remote.` },
  });
  expect(response.status()).toBe(201);
  const { opportunity } = (await response.json()) as { opportunity: { id: string } };
  opportunityIds.push(opportunity.id);
  return opportunity.id;
}

const rows = (page: Page) => page.locator(".opportunity-row");
const row = (page: Page, title: string) => rows(page).filter({ has: page.getByRole("link", { name: title }) });
const toolbar = (page: Page) => page.getByRole("region", { name: "Selection" });

test("dashboard: select, bulk Move to, row Move to, Restore, permanent deletion and the titles cleanup", async ({ page, request }) => {
  const token = `M${Date.now()}`;
  const titles = [`Customer Success Manager ${token}`, `Onboarding Specialist ${token}`, `Payroll Support Representative ${token}`];
  const ids = [];
  for (const title of titles) ids.push(await createOpportunity(request, title, `Moveco ${token}`));

  // Select all on this page, then move the selection to Saved.
  await page.goto(`/?q=${token}`);
  await expect(rows(page)).toHaveCount(3);
  await toolbar(page).getByRole("button", { name: "Select all on this page" }).click();
  await expect(toolbar(page).getByText("3 selected", { exact: true })).toBeVisible();
  await toolbar(page).getByLabel("Move selected to").selectOption("SAVED");
  await toolbar(page).getByRole("button", { name: "Move 3 selected" }).click();
  await expect(toolbar(page).getByText("3 moved to Saved.")).toBeVisible();
  await page.goto(`/?view=saved&q=${token}`);
  await expect(rows(page)).toHaveCount(3);

  // A row's own menu offers only its valid destinations.
  const payroll = row(page, titles[2]!);
  await payroll.locator("summary").click();
  await expect(payroll.getByRole("button", { name: "Saved" })).toHaveCount(0);
  await payroll.getByRole("button", { name: "Dismissed" }).click();
  await expect(rows(page)).toHaveCount(2);

  // A changed filter starts a new, empty selection.
  await toolbar(page).getByRole("button", { name: "Select all on this page" }).click();
  await expect(toolbar(page).getByText("2 selected", { exact: true })).toBeVisible();
  await page.goto(`/?view=saved&q=${encodeURIComponent(titles[0]!)}`);
  await expect(toolbar(page).getByText("0 selected", { exact: true })).toBeVisible();

  // The cleanup filter finds the title outside the target job titles.
  await page.goto(`/?view=all&q=${token}&titles=outside`);
  await expect(page.getByText(/Showing the opportunities whose titles are outside your target job titles/)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, titles[2]!)).toBeVisible();

  // Dismissed: restore, dismiss again, then delete permanently.
  await page.goto(`/?view=dismissed&q=${token}`);
  await expect(rows(page)).toHaveCount(1);
  await row(page, titles[2]!).getByRole("checkbox").check();
  await toolbar(page).getByRole("button", { name: "Restore 1 selected" }).click();
  await expect(toolbar(page).getByText(/1 moved to Restore/)).toBeVisible();
  await page.goto(`/?view=saved&q=${token}`);
  await expect(rows(page)).toHaveCount(3);
  const moved = await request.post(`/api/opportunities/${ids[2]}/move`, { data: { destination: "DISMISSED" } });
  expect(moved.status()).toBe(200);

  await page.goto(`/?view=dismissed&q=${token}`);
  await row(page, titles[2]!).getByRole("checkbox").check();
  await toolbar(page).getByRole("button", { name: "Delete 1 selected permanently…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Permanently delete 1 selected dismissed opportunity?");
  await expect(dialog).toContainText("This cannot be undone");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(rows(page)).toHaveCount(1);
  await toolbar(page).getByRole("button", { name: "Delete 1 selected permanently…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete 1 permanently" }).click();
  await expect(toolbar(page).getByText("1 permanently deleted.")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  expect((await request.get(`/api/opportunities/${ids[2]}`)).status()).toBe(404);
  // Ordinary Move to never deletes: there is no delete destination.
  expect((await request.post(`/api/opportunities/${ids[0]}/move`, { data: { destination: "DELETE" } })).status()).toBe(400);
});

test("Empty Dismissed deletes every dismissed opportunity after confirming the exact count", async ({ page, request }) => {
  const token = `E${Date.now()}`;
  for (const suffix of ["one", "two"]) {
    const id = await createOpportunity(request, `Customer Success Manager ${suffix} ${token}`, `Emptyco ${token}`);
    expect((await request.post(`/api/opportunities/${id}/move`, { data: { destination: "DISMISSED" } })).status()).toBe(200);
  }
  await page.goto("/?view=dismissed");
  const empty = toolbar(page).getByRole("button", { name: /Empty Dismissed \(\d+\)…/ });
  await expect(empty).toBeVisible();
  const count = Number(/\((\d+)\)/.exec((await empty.textContent()) ?? "")![1]);
  expect(count).toBeGreaterThanOrEqual(2);
  await empty.click();
  await expect(page.getByRole("alertdialog")).toContainText(`Permanently delete all ${count} dismissed`);
  await page.getByRole("alertdialog").getByRole("button", { name: `Delete all ${count} permanently` }).click();
  await expect(toolbar(page).getByText(/permanently deleted/)).toBeVisible();
  await page.goto(`/?view=dismissed&q=${token}`);
  await expect(rows(page)).toHaveCount(0);
});

test("opportunity page: Move to offers the valid destinations and restores from Dismissed", async ({ page, request }) => {
  const token = `P${Date.now()}`;
  const id = await createOpportunity(request, `Customer Education Specialist ${token}`, `Pageco ${token}`);
  await page.goto(`/opportunities/${id}`);
  const status = page.locator("#opportunity-status-title");
  const moveTo = page.getByLabel("Move to");
  await expect(moveTo.locator("option")).toHaveText(["Saved", "Dismissed", "Archived"]);
  await moveTo.selectOption("DISMISSED");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(status).toHaveText("Dismissed");
  await expect(moveTo.locator("option")).toHaveText(["Restore (previous state)", "Active", "Saved", "Archived"]);
  await moveTo.selectOption("RESTORE");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(status).toHaveText("New");
});

test("Profile: Target job titles with Test a title, saved and reset", async ({ page }) => {
  await page.goto("/profile");
  const section = page.getByRole("region", { name: "Target job titles (automatic capture)" });
  await expect(section.getByText("You are using the default target job titles.")).toBeVisible();
  const sample = section.getByLabel("Test a title");
  await sample.fill("Customer Education Specialist");
  await expect(section.getByText("Accepted: matches “Customer Education Specialist”.")).toBeVisible();
  await sample.fill("Payroll Support Representative");
  await expect(section.getByText("Skipped: no accepted pattern appears in this title.")).toBeVisible();
  // Add a pattern: the preview follows immediately, and it is saved.
  await section.getByLabel("Add a pattern").first().fill("Payroll Support");
  await section.getByRole("button", { name: "Add" }).first().click();
  await expect(section.getByText("Accepted: matches “Payroll Support”.")).toBeVisible();
  await section.getByRole("button", { name: "Save target job titles" }).click();
  await expect(section.getByText("Saved. The next automatic capture uses these titles.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Target job titles (automatic capture)" }).getByText("Payroll Support", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Target job titles (automatic capture)" }).getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByText("Reset to the default target job titles.")).toBeVisible();
});
