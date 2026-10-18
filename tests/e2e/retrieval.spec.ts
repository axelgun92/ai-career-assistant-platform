import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Features 11A, 11B and 12: Greenhouse, Workday, Workable and Wellfound sources added and
// run from /sources, and a rate-limited source's health and Run now gate. The retrieval worker iteration runs in a helper with
// the fixture transport (the committed fixtures); nothing reaches the
// network. The tests share fixture listings, so they run in order.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-retrieval-helper.ts");
const compiledHelper = path.resolve(`database/.e2e-retrieval-helper-${process.env.TEST_WORKER_INDEX ?? "0"}.mjs`);
const sourceIds: string[] = [];

const runHelper = async (...args: string[]) =>
  (await execFileAsync(process.execPath, [compiledHelper, ...args], { cwd: process.cwd(), env: process.env })).stdout;

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
  await runHelper("reset-fixture-listings");
});

test.afterAll(async () => {
  for (const id of sourceIds.splice(0)) await runHelper("cleanup-source", id);
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

async function addGreenhouseSource(page: Page, name: string) {
  await page.goto("/sources");
  const form = page.getByRole("form", { name: "Add a source" });
  await form.getByLabel("Source type").selectOption("greenhouse");
  await form.getByLabel(/Board name/).fill("gitlab");
  await form.getByLabel("Name (optional)").fill(name);
  await form.getByRole("button", { name: "Add source" }).click();
  const card = page.getByRole("region", { name });
  await expect(card).toBeVisible();
  const { sources } = (await (await page.request.get("/api/sources")).json()) as { sources: Array<{ id: string; name: string }> };
  sourceIds.push(sources.find((source) => source.name === name)!.id);
  return card;
}

test("a Greenhouse source is added disabled, enabled, run, and its listing shows where it was found", async ({ page }) => {
  const name = `GitLab E2E ${randomUUID().slice(0, 8)}`;
  const card = await addGreenhouseSource(page, name);
  await expect(card).toContainText("Disabled");
  await expect(card).toContainText("Greenhouse (employer ATS · official API or feed) · Board name: gitlab");
  await expect(card).toContainText("Runs every 12 hours when enabled");
  await expect(card.getByRole("button", { name: "Run now" })).toBeDisabled();

  await card.getByRole("button", { name: "Enable" }).click();
  await expect(card).toContainText("Enabled");
  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByRole("status")).toHaveText("Run queued. The retrieval worker will pick it up.");

  const outcome = JSON.parse(await runHelper("run-retrieval")) as { status: string; counts: Record<string, number> };
  expect(outcome).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 1, created: 1 } });
  await page.reload();
  await card.getByText("Run history (1)").click();
  await expect(card).toContainText("Completed · Run now");
  await expect(card).toContainText("3 fetched, 1 matched the role terms: 1 new, 0 added to existing, 0 changed, 0 unchanged");

  // Retrieved jobs arrive unevaluated and show their source on the dashboard.
  await page.goto("/?view=all&q=Customer%20Success%20Architect");
  const row = page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: "Customer Success Architect" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Found via Greenhouse");
  await expect(row).toContainText("GitLab");
  await expect(row).not.toContainText("Listing changed");
  await row.getByRole("link", { name: "Customer Success Architect" }).click();
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible();
  const provenance = page.getByRole("region", { name: "Source and provenance" });
  await expect(provenance).toContainText("Greenhouse (employer ATS · official API or feed)");
  await expect(provenance).toContainText(`Retrieved by your source “${name}”`);
  await expect(provenance).not.toContainText("Listing changed since first seen");
});

test("a changed listing is kept as a linked observation and flagged; a source with history is archived", async ({ page }) => {
  const name = `GitLab E2E ${randomUUID().slice(0, 8)}`;
  const card = await addGreenhouseSource(page, name);
  await card.getByRole("button", { name: "Enable" }).click();
  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  const first = JSON.parse(await runHelper("run-retrieval")) as { counts: Record<string, number> };
  // The first test's listing is already stored from the same source key, so
  // this run sees it again unchanged.
  expect(first.counts.created + first.counts.unchanged).toBe(1);

  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  expect(JSON.parse(await runHelper("run-retrieval", "changed"))).toMatchObject({ counts: { changed: 1, created: 0 } });

  await page.goto("/?view=all&q=Customer%20Success%20Architect");
  const row = page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: "Customer Success Architect" });
  await expect(row).toContainText("Listing changed");
  await row.getByRole("link", { name: "Customer Success Architect" }).click();
  const provenance = page.getByRole("region", { name: "Source and provenance" });
  await expect(provenance).toContainText("Listing changed since first seen");
  await expect(provenance).toContainText("A changed version of this listing");
  await expect(provenance.getByRole("heading", { name: /Source records \(2\)/ })).toBeVisible();

  await page.goto("/sources");
  const again = page.getByRole("region", { name });
  await again.getByRole("button", { name: "Remove" }).click();
  await expect(again).toContainText("This source has run before, so it will be archived");
  await again.getByRole("button", { name: "Confirm remove" }).click();
  await page.getByText(/^Archived sources \(\d+\)$/).click();
  await expect(page.getByRole("region", { name })).toContainText("Archived");

  // Adzuna is listed but cannot be enabled until verified and configured.
  await expect(page.getByRole("form", { name: "Add a source" }).getByLabel("Source type")).toContainText("Adzuna (awaiting verification)");
});

async function addSource(page: Page, adapterKey: string, name: string, fields: Record<string, string> = {}) {
  await page.goto("/sources");
  const form = page.getByRole("form", { name: "Add a source" });
  await form.getByLabel("Source type").selectOption(adapterKey);
  for (const [label, value] of Object.entries(fields)) await form.getByLabel(new RegExp(label)).fill(value);
  // Exact: Workday also has a "Company name (optional)" field.
  await form.getByRole("textbox", { name: "Name (optional)", exact: true }).fill(name);
  await form.getByRole("button", { name: "Add source" }).click();
  const card = page.getByRole("region", { name });
  await expect(card).toBeVisible();
  const { sources } = (await (await page.request.get("/api/sources")).json()) as { sources: Array<{ id: string; name: string }> };
  sourceIds.push(sources.find((source) => source.name === name)!.id);
  return card;
}

async function enableAndRun(card: ReturnType<Page["getByRole"]>) {
  await card.getByRole("button", { name: "Enable" }).click();
  await expect(card).toContainText("Enabled");
  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  return JSON.parse(await runHelper("run-retrieval")) as { status: string; counts: Record<string, number> };
}

test("Workday, Workable and Wellfound sources run from /sources; Welcome to the Jungle cannot be enabled", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const workday = await addSource(page, "workday", `Workday E2E ${suffix}`, { "Career site address": "https://workday.wd5.myworkdayjobs.com/Workday" });
  await expect(workday).toContainText("Workday (employer ATS · public guest endpoint) · Career site address: https://workday.wd5.myworkdayjobs.com/Workday");
  expect(await enableAndRun(workday)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 1, created: 1 } });

  const workable = await addSource(page, "workable", `Workable E2E ${suffix}`);
  await expect(workable).toContainText("Workable (job board · public guest endpoint)");
  expect(await enableAndRun(workable)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 2, created: 2 } });

  const wellfound = await addSource(page, "wellfound", `Wellfound E2E ${suffix}`);
  await expect(wellfound).toContainText("Wellfound (marketplace · public page)");
  expect(await enableAndRun(wellfound)).toMatchObject({ status: "COMPLETED", counts: { fetched: 3, keptByTerms: 2, created: 2 } });

  await page.goto("/?view=all&q=Revenue%20Operations%20Director");
  const workdayRow = page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: "Revenue Operations Director" });
  await expect(workdayRow).toContainText("Found via Workday");
  await expect(workdayRow).toContainText("Workday, Inc.");
  await page.goto("/?view=all&q=VP%20of%20Sales%20and%20Customer%20Success");
  await expect(page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: "VP of Sales and Customer Success" })).toContainText("Found via Workable");
  await page.goto("/?view=all&q=Head%20of%20Customer%20Success");
  const wellfoundRow = page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: "Head of Customer Success" });
  await expect(wellfoundRow).toContainText("Found via Wellfound");
  await wellfoundRow.getByRole("link", { name: "Head of Customer Success" }).click();
  await expect(page.getByRole("heading", { name: "Not evaluated" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Source and provenance" })).toContainText("Wellfound (marketplace · public page)");

  const jungle = await addSource(page, "welcome-to-the-jungle", `WTTJ E2E ${suffix}`);
  await expect(jungle).toContainText("Cannot be enabled");
  await expect(jungle.getByRole("button", { name: "Enable" })).toBeDisabled();
});

test("a rate-limited source shows when it may run again, Run now waits, and a later success is healthy", async ({ page }) => {
  const name = `GitLab limited E2E ${randomUUID().slice(0, 8)}`;
  const card = await addGreenhouseSource(page, name);
  await card.getByRole("button", { name: "Enable" }).click();
  await expect(card).toContainText("Not yet run");
  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  expect(JSON.parse(await runHelper("run-retrieval", "rate-limited"))).toMatchObject({ status: "FAILED", errorCode: "RATE_LIMITED" });

  await page.reload();
  await expect(card.getByLabel("Health: Rate limited")).toBeVisible();
  await expect(card).toContainText(/Rate limited until \d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC/);
  await expect(card).toContainText("(the source rate limited retrieval)");
  await expect(card).toContainText("Latest failure:");
  await expect(card.getByRole("button", { name: "Run now" })).toBeDisabled();
  // The API refuses too, even with an override.
  const id = sourceIds[sourceIds.length - 1]!;
  const refused = await page.request.post(`/api/sources/${id}/runs`, { data: { override: true } });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "SOURCE_RATE_LIMITED", until: expect.any(String) });

  await runHelper("expire-gate", id);
  await page.reload();
  await expect(card.getByLabel("Health: Degraded")).toBeVisible();
  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByRole("status")).toHaveText("Run queued. The retrieval worker will pick it up.");
  expect(JSON.parse(await runHelper("run-retrieval"))).toMatchObject({ status: "COMPLETED" });
  await page.reload();
  await expect(card.getByLabel("Health: Healthy")).toBeVisible();
  await expect(card).not.toContainText("Rate limited until");
  await expect(card).not.toContainText("Latest failure:");
});
