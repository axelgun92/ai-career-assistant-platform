import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

const opportunityIds: string[] = [];
const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
// Separate bundle name so this spec never races the evaluation spec's helper file.
const compiledHelper = path.resolve("database/.e2e-dashboard-helper.mjs");

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
  for (const opportunityId of opportunityIds.splice(0)) {
    await execFileAsync(process.execPath, [compiledHelper, "cleanup", opportunityId, ""], {
      cwd: process.cwd(),
      env: process.env,
    });
  }
});

test("dashboard lists a manually entered opportunity with the domain preset", async ({ page }) => {
  const title = `Dashboard E2E Customer Success Manager ${Date.now()}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  await page.getByRole("link", { name: "New opportunity" }).click();

  await expect(page).toHaveURL(/\/opportunities\/new$/);
  await expect(page.getByLabel("Domain")).toHaveValue("customer-success");
  await page
    .getByLabel("Raw opportunity or job-description text")
    .fill("Customer Success Manager. Remote. Own onboarding and adoption.");
  await page.getByLabel("Title (optional)").fill(title);
  await page.getByRole("button", { name: "Save and normalize" }).click();

  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  opportunityIds.push(page.url().split("/").pop() ?? "");
  await expect(page.getByRole("button", { name: "Evaluate Customer Success fit" })).toBeVisible();

  await page.getByRole("link", { name: "← All opportunities" }).click();
  await expect(page).toHaveURL(/\/$/);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("Not evaluated");
  await expect(row).toContainText("Customer Success");

  await row.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${opportunityIds[0]}$`));
});
