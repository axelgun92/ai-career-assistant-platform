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
) {
  const compensationText = kind === "unknown" ? undefined : kind === "reject" ? "$45,000-$50,000" : "$72,000-$88,000";
  const response = await request.post("/api/opportunities", {
    data: {
      title: "Customer Success Manager",
      company: `E2E pre-evaluator ${kind}`,
      location: "Remote - United States",
      ...(compensationText ? { compensationText } : {}),
      postingDate: "2026-11-01",
      domain: "customer-success",
      rawText: [
        "Customer Success Manager at a SaaS workflow platform.",
        "This is a fully remote role. Applicants must reside in the United States.",
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
