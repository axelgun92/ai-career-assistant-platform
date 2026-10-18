import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Feature 11A: a Greenhouse source added and run from /sources. The
// retrieval worker iteration runs in a helper with the fixture transport
// (the committed Greenhouse fixture); nothing reaches the network. Both
// tests use the same fixture listings, so they run in order.
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
