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

// Category movement (November 25, 2026): every working category in turn, a
// move to the category a job is already in reported as a skip (never a
// failure), each result keyed by the opportunity (two listings share a title
// and a reason here), and a bulk move followed by a refresh with no console
// error.
test("category movement: every category, skips for the current one, results per opportunity, and no console error", async ({ page, request }) => {
  const problems: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(error.message));
  const token = `C${Date.now()}`;
  const title = `Customer Success Manager ${token}`;
  const ids = [await createOpportunity(request, title, `Twinco ${token}`), await createOpportunity(request, title, `Twinco ${token}`)];
  const third = await createOpportunity(request, `Onboarding Specialist ${token}`, `Movco ${token}`);

  const move = async (view: string, destination: string, label: string, expected: string) => {
    await page.goto(`/?view=${view}&q=${token}`);
    await toolbar(page).getByRole("button", { name: "Select all on this page" }).click();
    if (destination !== "RESTORE") await toolbar(page).getByLabel("Move selected to").selectOption(destination);
    await toolbar(page).getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await expect(toolbar(page).getByText(expected)).toBeVisible();
  };
  // Active → Saved → Archived → Active → Dismissed. (The Active view also
  // lists Saved jobs.)
  await move("active", "SAVED", "Move 3 selected", "3 moved to Saved.");
  await page.goto(`/?view=saved&q=${token}`);
  await expect(rows(page)).toHaveCount(3);
  await move("saved", "ARCHIVED", "Move 3 selected", "3 moved to Archived.");
  await page.goto(`/?view=archived&q=${token}`);
  await expect(rows(page)).toHaveCount(3);
  await move("archived", "ACTIVE", "Move 3 selected", "3 moved to Active.");
  await page.goto(`/?view=active&q=${token}`);
  await expect(rows(page)).toHaveCount(3);

  // Two of three dismissed, then all three selected in All: the two already
  // in Dismissed are skipped, by opportunity, with the same title and reason.
  for (const id of ids) expect((await request.post(`/api/opportunities/${id}/move`, { data: { destination: "DISMISSED" } })).status()).toBe(200);
  await move("all", "DISMISSED", "Move 3 selected", "1 moved to Dismissed; 2 skipped (already there).");
  const skipped = toolbar(page).locator("li[data-outcome=skipped]");
  await expect(skipped).toHaveCount(2);
  await expect(skipped).toHaveText([`${title}: Already in Dismissed`, `${title}: Already in Dismissed`]);
  // The Dismissed view holds all three; Active none.
  await page.goto(`/?view=dismissed&q=${token}`);
  await expect(rows(page)).toHaveCount(3);
  await page.goto(`/?view=active&q=${token}`);
  await expect(rows(page)).toHaveCount(0);
  // The API reports the skip as a success with its reason.
  const again = await request.post(`/api/opportunities/${third}/move`, { data: { destination: "DISMISSED" } });
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ result: "ALREADY_THERE" });

  // A bulk move, then a refresh: no console error.
  await move("dismissed", "RESTORE", "Restore 3 selected", "3 moved to Restore");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(problems).toEqual([]);
});

// An opportunity with no evaluation (November 25, 2026): its page renders the
// normal unevaluated state with no failed request and no console error
// (collected from before navigation through hydration), and requests no
// evaluation by itself.
test("an unevaluated opportunity's page has no failed request and no console error", async ({ page, request }) => {
  const problems: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const token = `U${Date.now()}`;
  const id = await createOpportunity(request, `Customer Success Manager ${token}`, `Uneval ${token}`);
  await page.goto(`/opportunities/${id}`);
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluate Customer Success fit" })).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
  expect((await request.get(`/api/opportunities/${id}/evaluation`)).status()).toBe(404);
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

// Bulk evaluation in the Evaluate section (November 26, 2026): jobs triaged
// Evaluate are selected on the current page; a selection over an enabled
// limit is refused in full with the limit named and a Budget link, nothing
// queued; within the limits the confirmation queues every job (no worker
// runs here, so no provider call); a selection that is no longer available
// is listed and nothing is submitted. Desktop and phone width, with no
// console error, failed request or horizontal overflow.
test("bulk evaluation: limits checked first, all or nothing, confirmed, and unavailable jobs listed", async ({ page, request }) => {
  const runHelper = async (...args: string[]) =>
    (await execFileAsync(process.execPath, [compiledHelper, ...args], { cwd: process.cwd(), env: process.env })).stdout.trim();
  const problems: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()} (${message.location().url})`); });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  const [profileId = "", previousActiveId = ""] = (await runHelper("create-profile")).split(" ");
  const budgetSnapshot = await runHelper("budget-snapshot");
  const token = `B${Date.now()}`;
  const ids: string[] = [];
  try {
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const company = `${name} Bulkco ${token}`;
      const response = await request.post("/api/opportunities", {
        data: {
          title: `Customer Success Manager ${token}`,
          company,
          location: "Remote - United States",
          compensationText: "$72,000-$88,000",
          domain: "customer-success",
          rawText: [
            `Customer Success Manager at ${company}, a SaaS workflow platform.`,
            "Full-time. Remote. Applicants must reside in the United States.",
            "Salary $72,000-$88,000. No travel required.",
            "Own onboarding, adoption, education, retention, and business reviews.",
          ].join("\n"),
        },
      });
      expect(response.status()).toBe(201);
      const { opportunity } = (await response.json()) as { opportunity: { id: string } };
      ids.push(opportunity.id);
      opportunityIds.push(opportunity.id);
      expect(await runHelper("assess-triage", opportunity.id)).toBe("EVALUATE");
    }
    const budget = (patch: Record<string, unknown>) =>
      request.put("/api/budget", { data: { amount: 100, currency: "USD", timeZone: "UTC", reservePerEvaluation: 1, enforced: true, warningThresholds: [], ...patch } });
    expect((await budget({ dailyEvaluationLimit: 2 })).status()).toBe(200);

    const paid = page.getByRole("region", { name: "Paid evaluation" });
    const evaluateSection = `/?triage=evaluate&q=${token}`;
    await page.goto(evaluateSection);
    await expect(rows(page)).toHaveCount(3);
    await expect(paid.getByRole("button", { name: "Evaluate 0 selected…" })).toBeDisabled();
    await toolbar(page).getByRole("button", { name: "Select all on this page" }).click();
    await expect(toolbar(page).getByText("3 selected", { exact: true })).toBeVisible();

    // Over the daily limit: refused in full, the limit named, a Budget link.
    await paid.getByRole("button", { name: "Evaluate 3 selected…" }).click();
    const warning = paid.getByRole("alert");
    await expect(warning).toContainText("You selected 3 jobs, but your remaining daily limit allows 2 evaluations.");
    await expect(warning.getByRole("link", { name: "Budget settings" })).toHaveAttribute("href", "/budget#budget-settings-title");
    await expect(paid.getByRole("alertdialog")).toHaveCount(0);
    expect(await overflow()).toBe(false);
    for (const id of ids) expect((await request.get(`/api/opportunities/${id}/evaluation`)).status()).toBe(404);

    // The same warning at phone width, without horizontal overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await toolbar(page).getByRole("button", { name: "Select all on this page" }).click();
    await paid.getByRole("button", { name: "Evaluate 3 selected…" }).click();
    await expect(paid.getByRole("alert")).toContainText("remaining daily limit allows 2 evaluations");
    expect(await overflow()).toBe(false);

    // Within the limits: the confirmation, then every job queued.
    expect((await budget({ dailyEvaluationLimit: null })).status()).toBe(200);
    await paid.getByRole("button", { name: "Evaluate 3 selected…" }).click();
    const dialog = paid.getByRole("alertdialog");
    await expect(dialog).toContainText("Evaluate 3 selected jobs? They will be added to the evaluation queue and will use your configured AI budget.");
    await expect(dialog).toContainText("Up to $3.00 will be reserved ($1.00 per evaluation).");
    expect(await overflow()).toBe(false);
    // Opening the confirmation created nothing.
    for (const id of ids) expect((await request.get(`/api/opportunities/${id}/evaluation`)).status()).toBe(404);
    await dialog.getByRole("button", { name: "Evaluate 3 jobs" }).click();
    await expect(paid.getByRole("status")).toHaveText("3 evaluations queued. They will run one at a time. Refresh the page to see their latest statuses.");
    // The one refresh after queueing lands: each row shows its queued status.
    await expect(page.locator(".opportunity-row .status-label", { hasText: /^Evaluation queued$/ })).toHaveCount(3);
    await expect(page.locator(".opportunity-row .status-label", { hasText: /^Not evaluated$/ })).toHaveCount(0);
    for (const id of ids) {
      const evaluation = (await (await request.get(`/api/opportunities/${id}/evaluation`)).json()) as { status: string };
      expect(evaluation.status).toBe("PENDING");
    }

    // The same jobs again: no longer available, listed, nothing submitted.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(evaluateSection);
    await toolbar(page).getByRole("button", { name: "Select all on this page" }).click();
    await paid.getByRole("button", { name: "Evaluate 3 selected…" }).click();
    const unavailable = paid.getByRole("alert");
    await expect(unavailable).toContainText("nothing was submitted");
    await expect(unavailable.getByRole("listitem")).toHaveCount(3);
    await expect(unavailable.getByRole("listitem").first()).toContainText("Already queued or running");
    await unavailable.getByRole("button", { name: "Deselect these jobs" }).click();
    await expect(toolbar(page).getByText("0 selected", { exact: true })).toBeVisible();
    // One evaluation each: the second request created no duplicate work.
    for (const id of ids) {
      const evaluation = (await (await request.get(`/api/opportunities/${id}/evaluation`)).json()) as { history: unknown[] };
      expect(evaluation.history).toHaveLength(1);
    }
    expect(await overflow()).toBe(false);
    expect(problems).toEqual([]);
  } finally {
    await runHelper("budget-restore", budgetSnapshot);
    await runHelper("cleanup", "", profileId, previousActiveId);
  }
});
