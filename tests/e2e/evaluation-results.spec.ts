import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

test.describe.configure({ mode: "serial" });

const opportunityIds: string[] = [];
const profileIds: string[] = [];
const previousActiveIds: string[] = [];
const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-evaluation-helper.mjs");

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

test.afterEach(async () => {
  const opportunityId = opportunityIds.shift() ?? "";
  const profileId = profileIds.shift() ?? "";
  const previousActiveId = previousActiveIds.shift() ?? "";
  await runHelper("cleanup", opportunityId, profileId, previousActiveId);
});

async function createProfile() {
  const [profileId = "", previousActiveId = ""] = (await runHelper("create-profile")).split(" ");
  profileIds.push(profileId);
  previousActiveIds.push(previousActiveId);
}

async function createOpportunity(request: APIRequestContext) {
  const response = await request.post("/api/opportunities", {
    data: {
      title: "Customer Success Manager",
      company: "Deterministic SaaS",
      location: "Remote - United States",
      compensationText: "$72,000-$88,000",
      postingDate: "2026-08-16",
      domain: "customer-success",
      rawText: [
        "Customer Success Manager at a SaaS workflow platform.",
        "Remote. Applicants must reside in the United States. Central or Eastern time preferred.",
        "Salary $72,000-$88,000. No travel required.",
        "Own onboarding, adoption, education, retention, and business reviews.",
        "Collaborate with Product and hand technical escalations to Support.",
        "3 years of Customer Success experience required. Salesforce preferred.",
      ].join("\n"),
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { opportunity: { id: string } };
  opportunityIds.push(body.opportunity.id);
  return body.opportunity.id;
}

async function processEvaluation(mode: "apply" | "review" = "apply") {
  await runHelper("run-worker", mode);
}

test("manual opportunity reaches a persisted Apply result with evidence", async ({
  page,
  request,
}) => {
  await createProfile();
  const opportunityId = await createOpportunity(request);
  await page.goto(`/opportunities/${opportunityId}`);

  const evaluate = page.getByRole("button", {
    name: "Evaluate Customer Success fit",
  });
  await evaluate.click();
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluation in progress" })).toBeDisabled();
  await expect(page.getByText(/Evaluation is queued/)).toBeVisible();
  await expect(page.getByText("Final recommendation")).toHaveCount(0);

  await processEvaluation();

  await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Customer Success evaluation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ghost Job Risk", { exact: true })).toBeVisible();
  await expect(page.getByText(/Unknown does not mean Low Risk/)).toBeHidden();
  await page.getByText("Ghost Job Risk", { exact: true }).click();
  await expect(page.getByText(/Unknown does not mean Low Risk/)).toBeVisible();
  await page.getByText("Evidence library", { exact: true }).click();
  await expect(page.getByText("Job-description evidence").first()).toBeVisible();
  await expect(page.getByText("Candidate profile evidence").first()).toBeVisible();
  await expect(page.getByText(/Overall Match|overallScore/)).toHaveCount(0);

  // Persisted AI usage and estimated cost for this evaluation.
  const usage = page.locator("details.usage-summary");
  await expect(usage).toContainText(/\d+ provider attempts · \$\d/);
  await usage.locator("summary").first().click();
  await expect(usage.getByText("Total tokens")).toBeVisible();
  await expect(usage.locator("dt", { hasText: /^Estimated cost$/ })).toBeVisible();
  await usage.getByText(/Per-operation breakdown/).click();
  await expect(usage.getByRole("cell", { name: "customer-success.jd-reconstruction" }).first()).toBeVisible();
  await expect(usage.getByText(/fixture-customer-success/)).toHaveCount(0); // provider request IDs never shown
});

test("material ambiguity reaches a persisted Review result", async ({ page, request }) => {
  await createProfile();
  const opportunityId = await createOpportunity(request);
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  // Wait for the request to be queued before the worker looks for it.
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await processEvaluation("review");

  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible({ timeout: 15_000 });
  await page.getByText("Resume Match", { exact: true }).click();
  await expect(page.getByText("Material Uncertainty").first()).toBeVisible();
});

test("a failed reevaluation keeps the last completed result visible with a safe failure code", async ({
  page,
  request,
}) => {
  await createProfile();
  const opportunityId = await createOpportunity(request);
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  // Wait for the request to be queued before the worker looks for it.
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await processEvaluation();
  await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Reevaluate opportunity" }).click();
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await runHelper("fail-latest", opportunityId);

  const assertFailedWithFallback = async () => {
    const alert = page.getByRole("alert").filter({ hasText: "could not complete safely" });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("PROVIDER_TIMEOUT");
    await expect(alert).toContainText("The AI provider did not respond in time.");
    await expect(alert).toContainText("most recent completed evaluation");
    await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible();
    await expect(page.getByText("E2E-INTERNAL-DETAIL-MUST-NOT-RENDER")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reevaluate opportunity" })).toBeEnabled();
  };
  await assertFailedWithFallback();
  // The same presentation is restored on a fresh page load.
  await page.reload();
  await assertFailedWithFallback();
});

test("a task left queued points at the worker and polling can be resumed", async ({
  page,
  request,
}) => {
  await createProfile();
  const opportunityId = await createOpportunity(request);
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  await expect(page.getByText(/Evaluation is queued/)).toBeVisible();

  // No worker runs in this test; age the queued evaluation past the threshold.
  await runHelper("age-latest", opportunityId, "300");
  await expect(page.getByText(/worker may not be running/)).toBeVisible({ timeout: 15_000 });

  // A failed status refresh stops polling and offers to keep checking.
  const statusRequests = /\/api\/opportunities\/[^/]+\/evaluation(\?|$)/;
  await page.route(statusRequests, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"unavailable"}' }),
  );
  const keepChecking = page.getByRole("button", { name: "Keep checking" });
  await expect(keepChecking).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/could not be refreshed/)).toBeVisible();

  await page.unroute(statusRequests);
  await keepChecking.click();
  await expect(keepChecking).toBeHidden();
  await expect(page.getByText(/could not be refreshed/)).toHaveCount(0);
  await expect(page.getByText(/Evaluation is queued/)).toBeVisible();
  await expect(page.getByText(/worker may not be running/)).toBeVisible();
});

test("lifecycle actions, dashboard views, and reevaluation of a saved opportunity", async ({
  page,
  request,
}) => {
  await createProfile();
  const opportunityId = await createOpportunity(request);
  const statusHeading = (name: string) =>
    page.getByRole("heading", { name, exact: true }).and(page.locator("#opportunity-status-title"));
  const dashboardRow = () => page.locator(`li:has(a[href="/opportunities/${opportunityId}"])`);

  await page.goto(`/opportunities/${opportunityId}`);
  await expect(statusHeading("New")).toBeVisible();
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();
  // Wait for the request to be queued before the worker looks for it.
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await processEvaluation();
  await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible({ timeout: 15_000 });
  // The worker's lifecycle sync is reflected without a manual reload.
  await expect(statusHeading("Recommendation ready")).toBeVisible({ timeout: 15_000 });

  await page.goto("/");
  await expect(dashboardRow()).toContainText("Recommendation ready");
  await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
  await expect(page.locator(".usage-totals")).toContainText("Provider attempts");
  await expect(dashboardRow()).toContainText("Apply");

  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(statusHeading("Saved")).toBeVisible();

  // Reevaluation keeps the user's Saved state and adds evaluation history.
  await page.getByRole("button", { name: "Reevaluate opportunity" }).click();
  await expect(page.getByText(/Evaluation accepted and queued/)).toBeVisible();
  await processEvaluation();
  await expect(page.getByText("Evaluation history (2)")).toBeVisible({ timeout: 15_000 });
  await expect(statusHeading("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(statusHeading("Dismissed")).toBeVisible();
  await page.goto("/");
  await expect(dashboardRow()).toHaveCount(0);
  await page.goto("/?view=dismissed");
  await expect(dashboardRow()).toContainText("Dismissed");

  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(statusHeading("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(statusHeading("Archived")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reevaluate opportunity" })).toBeDisabled();
  await expect(page.getByText(/archived or closed. Restore it/)).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(statusHeading("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reevaluate opportunity" })).toBeEnabled();
});
