import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

test.describe.configure({ mode: "serial" });

const opportunityIds: string[] = [];
const profileIds: string[] = [];
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
  await runHelper("cleanup", opportunityId, profileId);
});

async function createProfile() {
  const profileId = await runHelper("create-profile");
  profileIds.push(profileId);
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
});

test("material ambiguity reaches a persisted Review result", async ({ page, request }) => {
  await createProfile();
  const opportunityId = await createOpportunity(request);
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole("button", { name: "Evaluate Customer Success fit" }).click();

  await processEvaluation("review");

  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible({ timeout: 15_000 });
  await page.getByText("Resume Match", { exact: true }).click();
  await expect(page.getByText("Material Uncertainty").first()).toBeVisible();
});
