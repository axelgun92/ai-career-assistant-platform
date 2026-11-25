import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-triage-helper.mjs");
const opportunities: string[] = [];
let profileId = "";
let previousActiveId = "";

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
  [profileId = "", previousActiveId = ""] = (await runHelper("create-profile")).split(" ");
});

test.afterAll(async () => {
  for (const id of opportunities) await runHelper("cleanup", id, "", "");
  await runHelper("cleanup", "", profileId, previousActiveId);
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

async function createOpportunity(
  request: APIRequestContext,
  kind: "eligible" | "unknown" | "reject",
  suffix = "",
) {
  const compensationText = kind === "unknown" ? undefined : kind === "reject" ? "$45,000-$50,000" : "$72,000-$88,000";
  const response = await request.post("/api/opportunities", {
    data: {
      title: "Customer Success Manager",
      company: `E2E pre-evaluator ${kind}${suffix}`,
      location: "Remote - United States",
      ...(compensationText ? { compensationText } : {}),
      postingDate: "2026-11-01",
      domain: "customer-success",
      rawText: [
        "Customer Success Manager at a SaaS workflow platform.",
        // The employment type is a Customer Success hard requirement
        // (November 25, 2026): stated, so salary alone decides here.
        "This is a full-time, fully remote role. Applicants must reside in the United States.",
        compensationText ? `Base salary ${compensationText}.` : "Compensation is not stated.",
        "Own onboarding, adoption, education, and retention.",
      ].join("\n"),
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { opportunity: { id: string } };
  opportunities.push(body.opportunity.id);
  return body.opportunity.id;
}

async function expectNoEvaluation(request: APIRequestContext, opportunityId: string) {
  expect((await request.get(`/api/opportunities/${opportunityId}/evaluation`)).status()).toBe(404);
}

test("eligible, review-held, manually resolved, and rejected jobs stay on the correct side of evaluator admission", async ({ page, request }) => {
  const eligible = await createOpportunity(request, "eligible");
  await page.goto(`/opportunities/${eligible}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  expect((await request.get(`/api/opportunities/${eligible}/evaluation`)).status()).toBe(200);

  const reviewEvaluate = await createOpportunity(request, "unknown");
  await page.goto(`/opportunities/${reviewEvaluate}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByRole("heading", { name: "Needs Review before evaluation" })).toBeVisible();
  await expect(page.getByText(/Base salary is Unknown/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await expectNoEvaluation(request, reviewEvaluate);
  await page.getByRole("button", { name: "Evaluate", exact: true }).click();
  await expect(page.getByText(/released to the normal admission path/)).toBeVisible();
  expect((await request.get(`/api/opportunities/${reviewEvaluate}/evaluation`)).status()).toBe(200);

  const reviewReject = await createOpportunity(request, "unknown");
  await page.goto(`/opportunities/${reviewReject}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByRole("heading", { name: "Needs Review before evaluation" })).toBeVisible();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText(/Rejected before evaluation. No evaluator work was created/)).toBeVisible();
  await expectNoEvaluation(request, reviewReject);

  const rejected = await createOpportunity(request, "reject");
  await page.goto(`/opportunities/${rejected}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByRole("heading", { name: "Rejected before evaluation" })).toBeVisible();
  await expect(page.getByText(/definite base-salary ceiling is below/)).toBeVisible();
  await expectNoEvaluation(request, rejected);
});

// Add missing information (November 25, 2026): a fact the user confirms from
// the job description re-runs triage at once, moves the job to the right
// working category without starting an evaluation, persists, and can be
// edited and undone; the captured listing is unchanged.
test("Add missing information re-runs triage, moves the job's category, and can be edited and undone", async ({ page, request }) => {
  const token = `MI${Date.now()}`;
  const id = await createOpportunity(request, "unknown", ` ${token}`);
  await page.goto(`/opportunities/${id}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByRole("heading", { name: "Needs Review before evaluation" })).toBeVisible();
  await page.goto(`/?q=${token}&triage=review`);
  await expect(page.locator(".opportunity-row")).toHaveCount(1);

  await page.goto(`/opportunities/${id}`);
  const panel = page.getByRole("region", { name: "Information you confirmed" });
  await expect(panel.getByRole("note")).toContainText("some information is Unknown");
  // A click before the panel hydrates does nothing: retry until the form opens.
  await expect(async () => {
    await panel.getByRole("button", { name: "Add missing information" }).click({ timeout: 2_000 });
    await expect(panel.getByRole("button", { name: "Save and re-run triage" })).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await panel.getByRole("combobox", { name: "Information", exact: true }).selectOption("salaryRange");
  await panel.getByLabel("Minimum (base, per year)").fill("72000");
  await panel.getByLabel("Maximum (base, per year)").fill("88000");
  await panel.getByLabel("Quotation from the job description (optional)").fill("Base salary $72,000 - $88,000");
  await panel.getByRole("button", { name: "Save and re-run triage" }).click();
  await expect(panel.getByRole("status")).toContainText("Saved: Salary range.");
  // The currency is still Unknown: confirm it too.
  await panel.getByRole("button", { name: "Add missing information" }).click();
  await panel.getByRole("combobox", { name: "Information", exact: true }).selectOption("currency");
  await panel.getByRole("combobox", { name: "Currency", exact: true }).selectOption("USD");
  await panel.getByRole("button", { name: "Save and re-run triage" }).click();
  await expect(panel.getByRole("status")).toContainText("Saved: Salary currency. Triage now: Evaluate.");
  await expect(panel.locator("li[data-field=salaryRange]")).toContainText("Base salary $72,000 - $88,000");
  await expect(page.getByText("Triage history (3 assessments)")).toBeVisible();
  // No evaluation is started by a correction.
  await expectNoEvaluation(request, id);

  // Persisted, and in the Evaluate category now.
  await page.reload();
  await expect(page.getByRole("region", { name: "Information you confirmed" }).locator("li[data-field=currency]")).toBeVisible();
  await page.goto(`/?q=${token}&triage=evaluate`);
  await expect(page.locator(".opportunity-row")).toHaveCount(1);
  await page.goto(`/?q=${token}&triage=review`);
  await expect(page.locator(".opportunity-row")).toHaveCount(0);

  // Edit, then undo: the captured (Unknown) salary applies again.
  await page.goto(`/opportunities/${id}`);
  const salary = page.getByRole("region", { name: "Information you confirmed" }).locator("li[data-field=salaryRange]");
  await salary.getByRole("button", { name: "Edit" }).click();
  await panel.getByLabel("Maximum (base, per year)").fill("90000");
  await panel.getByRole("button", { name: "Save and re-run triage" }).click();
  await expect(panel.getByRole("status")).toContainText("Saved: Salary range. Triage now: Evaluate.");
  await expect(salary).toContainText("90,000");
  await salary.getByRole("button", { name: "Undo" }).click();
  await expect(panel.getByRole("status")).toContainText("Undone: Salary range. Triage now: Needs Review.");
  await expect(panel.locator("li[data-field=salaryRange]")).toHaveCount(0);
  const history = await (await request.get(`/api/opportunities/${id}/confirmed-facts`)).json() as { history: Array<{ fieldName: string; action: string }> };
  expect(history.history.filter((event) => event.fieldName === "salaryRange").map((event) => event.action).sort()).toEqual(["CONFIRMED", "EDITED", "UNDONE"]);
});
