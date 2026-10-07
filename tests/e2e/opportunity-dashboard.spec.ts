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
  await page.getByRole("button", { name: "Save opportunity" }).click();

  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  opportunityIds.push(page.url().split("/").pop() ?? "");
  await expect(page.getByRole("button", { name: "Evaluate Customer Success fit" })).toBeVisible();

  await page.getByRole("link", { name: "← Back to dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("Not evaluated");
  await expect(row).toContainText("Customer Success");

  await row.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${opportunityIds[0]}$`));
});

test("manual entry shows server validation errors next to the field", async ({ page }) => {
  await page.goto("/opportunities/new");
  const rawText = page.getByLabel("Raw opportunity or job-description text");
  // Whitespace satisfies the browser's required check but not server validation.
  await rawText.fill("   ");
  await page.getByRole("button", { name: "Save opportunity" }).click();

  // Next.js also renders a route announcer with role="alert"; match ours by text.
  await expect(
    page.getByRole("alert").filter({ hasText: "Manual opportunity submission is invalid" }),
  ).toBeVisible();
  await expect(rawText).toHaveAttribute("aria-invalid", "true");
  await expect(rawText).toHaveAccessibleDescription(/visible text/);
  await expect(page).toHaveURL(/\/opportunities\/new$/);
});

test("source and application URLs are clickable on the opportunity page", async ({ page, request }) => {
  const response = await request.post("/api/opportunities", {
    data: {
      rawText: "Customer Success Manager. Remote.",
      title: "Link E2E Customer Success Manager",
      domain: "customer-success",
      sourceUrl: "https://example.com/jobs/123",
      applicationUrl: "https://example.com/jobs/123/apply",
    },
  });
  expect(response.status()).toBe(201);
  const { opportunity } = await response.json() as { opportunity: { id: string } };
  opportunityIds.push(opportunity.id);

  await page.goto(`/opportunities/${opportunity.id}`);
  const apply = page.getByRole("link", { name: "Open application page" });
  await expect(apply).toHaveAttribute("href", "https://example.com/jobs/123/apply");
  await expect(apply).toHaveAttribute("target", "_blank");
  await expect(apply).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("link", { name: "Open source posting" }))
    .toHaveAttribute("href", "https://example.com/jobs/123");

  await page.getByText("Normalized opportunity and source details").click();
  await expect(
    page.locator("details.source-details").getByRole("link", { name: "https://example.com/jobs/123/apply" }),
  ).toBeVisible();
});

test("manual entry preserves and shows source provenance", async ({ page }) => {
  const title = `Provenance E2E Customer Success Manager ${Date.now()}`;
  await page.goto("/opportunities/new");
  await page.getByLabel("Raw opportunity or job-description text").fill("Customer Success Manager. Remote.");
  await page.getByLabel("Title (optional)").fill(title);
  await page.getByLabel("Source URL (optional)").fill("https://www.linkedin.com/jobs/view/777");
  await page.getByLabel("Application URL (optional)").fill("https://jobs.example.com/apply/777");
  await page.getByLabel("Source job ID (optional)").fill("REQ-777");
  await page.getByLabel(/Where you found it/).fill("LinkedIn");
  await page.getByRole("button", { name: "Save opportunity" }).click();

  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  const opportunityId = page.url().split("/").pop() ?? "";
  opportunityIds.push(opportunityId);

  const provenance = page.locator("section.provenance");
  await expect(provenance.getByRole("heading", { name: "Source and provenance" })).toBeVisible();
  await expect(provenance).toContainText("Manual entry");
  await expect(provenance).toContainText("manual-input");
  await expect(provenance).toContainText("Reported by you: found on LinkedIn");
  await expect(provenance).toContainText("REQ-777");
  await expect(provenance.getByRole("link", { name: "https://jobs.example.com/apply/777" }))
    .toHaveAttribute("rel", "noopener noreferrer");
  await expect(provenance.getByRole("link", { name: "https://www.linkedin.com/jobs/view/777" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator(`li:has(a[href="/opportunities/${opportunityId}"])`)).toContainText("Manual entry");
});
