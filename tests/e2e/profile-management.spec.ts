import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Every test here changes the active profile version, so they run one at a
// time (and, via the Playwright project config, after all other specs).
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-profile-helper.mjs");
const passLabel = "Salary that passes";
let label = "";
let previousActiveId = "";
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
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

async function runHelper(...args: string[]) {
  const result = await execFileAsync(process.execPath, [compiledHelper, ...args], {
    cwd: process.cwd(),
    env: process.env,
  });
  return result.stdout.trim();
}

test.beforeEach(async () => {
  previousActiveId = await runHelper("active-profile");
  label = `E2E profile ${randomUUID()}`;
});

test.afterEach(async () => {
  for (const opportunityId of opportunityIds.splice(0)) await runHelper("cleanup", opportunityId, "");
  await runHelper("cleanup-profiles", label, previousActiveId);
});

async function createActiveV1() {
  return runHelper("create-profile-version", label);
}

function versionIdFromUrl(page: Page) {
  return new URL(page.url()).searchParams.get("version") ?? "";
}

test("save a structured change as a new version, then make it active", async ({ page }) => {
  const v1 = await createActiveV1();
  await page.goto("/");
  await page.getByRole("link", { name: "Profile & preferences" }).click();
  await expect(page.getByRole("heading", { name: "Profile & preferences" })).toBeVisible();
  await expect(page.getByTestId("active-profile")).toContainText("version 1");
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeDisabled();

  await page.getByLabel(passLabel).fill("65000");
  await expect(page.getByText("Unsaved changes in the form.")).toBeVisible();
  await page.getByRole("button", { name: "Save as new version" }).click();

  await expect(page).toHaveURL(/saved=created$/);
  const v2 = versionIdFromUrl(page);
  expect(v2).not.toBe(v1);
  await expect(page.getByText("Saved as a new version. It is not active")).toBeVisible();
  await expect(page.getByTestId("active-profile")).toContainText("version 1");
  await expect(page.getByText("You are viewing version 2")).toBeVisible();
  await expect(page.getByLabel(passLabel)).toHaveValue("65000");
  expect(await runHelper("count-profile-versions", label)).toBe("2");
  expect(await runHelper("active-profile")).toBe(v1);

  const row = page.locator(`tr[data-version-id="${v2}"]`);
  await row.getByRole("button", { name: "Make v2 active" }).click();
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("active-profile")).toContainText("version 2");
  await expect(row).toContainText("Active");
  expect(await runHelper("active-profile")).toBe(v2);

  // Old versions stay viewable.
  await page.locator(`tr[data-version-id="${v1}"]`).getByRole("button", { name: "View v1" }).click();
  await expect(page).toHaveURL(new RegExp(`version=${v1}`));
  await expect(page.getByLabel(passLabel)).toHaveValue("60000");
});

test("form changes carry into the JSON editor; unsaved JSON is never discarded without confirmation", async ({ page }) => {
  await createActiveV1();
  await page.goto("/profile");

  await page.getByLabel(passLabel).fill("66000");
  await page.getByRole("tab", { name: "Advanced JSON" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const json = page.getByLabel("Profile JSON");
  await expect(json).toHaveValue(/"passMinimum": 66000/);
  await expect(page.getByText("Unsaved changes in the JSON editor.")).toBeVisible();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page).toHaveURL(/saved=created$/);
  expect(await runHelper("count-profile-versions", label)).toBe("2");

  // A JSON-only edit cannot be shown in the form: leaving asks first.
  await page.getByRole("tab", { name: "Advanced JSON" }).click();
  const edited = (await json.inputValue()).replace('"locationPreferences": null', '"locationPreferences": { "note": "kept" }');
  await json.fill(edited);
  await page.getByRole("tab", { name: "Form" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("can only be edited in JSON: locationPreferences");
  await dialog.getByRole("button", { name: "Keep editing JSON" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(json).toHaveValue(edited);

  await page.getByRole("tab", { name: "Form" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard JSON changes" }).click();
  await expect(page.getByLabel(passLabel)).toHaveValue("66000");
  await expect(page.getByText("No unsaved changes.")).toBeVisible();
  expect(await runHelper("count-profile-versions", label)).toBe("2");
});

test("invalid JSON and schema errors are shown at their location without saving", async ({ page }) => {
  await createActiveV1();
  await page.goto("/profile");
  await page.getByRole("tab", { name: "Advanced JSON" }).click();
  const json = page.getByLabel("Profile JSON");
  const original = await json.inputValue();

  await json.fill(original.replace('"label":', "label:"));
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/Line 2, column 3/)).toBeVisible();

  await json.fill(original.replace('"passMinimum": 60000', '"passMinimum": 1000'));
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.locator("#profile-json-errors")).toContainText("domainPreferences.customerSuccess.salary");
  await expect(page.locator("#profile-json-errors")).toContainText("must exceed the review threshold");
  await expect(json).toHaveAttribute("aria-invalid", "true");
  expect(await runHelper("count-profile-versions", label)).toBe("1");
});

test("an opportunity evaluated under an older version shows a reevaluation hint", async ({ page, request }) => {
  const v1 = await createActiveV1();
  const created = await request.post("/api/opportunities", {
    data: {
      title: "Customer Success Manager",
      company: "Deterministic SaaS",
      location: "Remote - United States",
      compensationText: "$72,000-$88,000",
      domain: "customer-success",
      rawText: [
        "Customer Success Manager at a SaaS workflow platform.",
        "Remote. Applicants must reside in the United States.",
        "Salary $72,000-$88,000. No travel required.",
        "Own onboarding, adoption, education, retention, and business reviews.",
      ].join("\n"),
    },
  });
  expect(created.status()).toBe(201);
  const { opportunity } = (await created.json()) as { opportunity: { id: string } };
  opportunityIds.push(opportunity.id);
  expect((await request.post(`/api/opportunities/${opportunity.id}/evaluate`, { data: {} })).status()).toBe(202);
  await runHelper("run-worker");

  await page.goto(`/opportunities/${opportunity.id}`);
  await expect(page.getByRole("note").filter({ hasText: "last evaluated with profile version" })).toHaveCount(0);

  const saved = await request.post("/api/profile/structured", {
    data: { baseVersionId: v1, changes: { "domainPreferences.customerSuccess.salary.passMinimum": 65000 }, activate: true },
  });
  expect(saved.status()).toBe(201);
  await page.reload();
  await expect(page.getByRole("note").filter({ hasText: "last evaluated with profile version" })).toContainText(
    "last evaluated with profile version 1; new evaluations use version 2",
  );
});
