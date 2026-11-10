import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { e2eDeterministicOpenAiKey, e2eEnvironment } from "./tests/support/e2e-environment";
import { assertIsolatedTestDatabase } from "./tests/support/test-database-guard";

// E2E never uses a real provider credential: replace whatever .env loaded, so
// the test runner, its workers, helper processes and the web server all see
// only the deterministic, non-live key.
process.env.OPENAI_API_KEY = e2eDeterministicOpenAiKey;

// Run E2E (web server and helpers) against a separate database
// (TEST_DATABASE_URL), and refuse any target that is not an isolated test
// database. Listing the tests (--list) touches no database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!process.argv.includes("--list")) assertIsolatedTestDatabase(process.env.DATABASE_URL, "E2E tests");

// Opt-in: use a preinstalled Chromium build instead of Playwright's own.
const chromium = {
  ...devices["Desktop Chrome"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
    : {}),
};

export default defineConfig({
  testDir: "./tests/e2e",
  // The Windows integration worktree can be a slow filesystem; keep exact
  // state assertions while allowing server-action refreshes to settle.
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: chromium,
      testIgnore: [/profile-management\.spec\.ts$/, /\/budget\.spec\.ts$/, /\/dashboard\.spec\.ts$/, /\/golden-path\.spec\.ts$/, /\/extension\.spec\.ts$/, /\/source-insights\.spec\.ts$/, /\/market\.spec\.ts$/, /\/my-search\.spec\.ts$/, /\/companies\.spec\.ts$/, /\/pre-evaluator-triage\.spec\.ts$/, /\/extension-page-capture\.spec\.ts$/],
    },
    {
      // Profile specs change which profile version is active, which every
      // UI-requested evaluation reads, so they run only after the other
      // specs have finished.
      name: "profile-management",
      use: chromium,
      testMatch: /profile-management\.spec\.ts/,
      dependencies: ["chromium"],
    },
    {
      // The budget is global and gates every UI-requested evaluation, so the
      // budget spec runs last, after every other spec has finished.
      name: "budget",
      use: chromium,
      testMatch: /\/budget\.spec\.ts$/,
      dependencies: ["profile-management"],
    },
    {
      // The dashboard spec sets a budget (to create a deferral) and an active
      // profile, so it runs alone after the budget project.
      name: "dashboard",
      use: chromium,
      testMatch: /\/dashboard\.spec\.ts$/,
      dependencies: ["budget"],
    },
    {
      // Whole-product acceptance: the golden path and recovery, run alone
      // after every other project (it activates a profile and evaluates).
      name: "acceptance",
      use: chromium,
      testMatch: /\/golden-path\.spec\.ts$/,
      dependencies: ["dashboard"],
    },
    {
      // Feature 14B: the built extension in its own persistent Chromium
      // profile. It activates a profile and evaluates, so it runs last.
      name: "extension",
      use: chromium,
      testMatch: /\/extension\.spec\.ts$/,
      dependencies: ["acceptance"],
    },
    {
      // Feature 15: Source Intelligence over a seeded history. Platform
      // totals span every source, so it runs alone, after everything else.
      name: "source-insights",
      use: chromium,
      testMatch: /\/source-insights\.spec\.ts$/,
      dependencies: ["extension"],
    },
    {
      // Feature 16: Job-Market Analytics over a seeded cohort in its own past
      // first-seen window, after every other project.
      name: "market",
      use: chromium,
      testMatch: /\/market\.spec\.ts$/,
      dependencies: ["source-insights"],
    },
    {
      // Feature 17: Personal Job-Search Analytics over a seeded history in its
      // own past application window, after every other project.
      name: "my-search",
      use: chromium,
      testMatch: /\/my-search\.spec\.ts$/,
      dependencies: ["market"],
    },
    {
      // Feature 18: Company Intelligence over seeded companies with their own
      // synthetic names, after every other project.
      name: "companies",
      use: chromium,
      testMatch: /\/companies\.spec\.ts$/,
      dependencies: ["my-search"],
    },
    {
      // Post-45d5fff pre-evaluator triage changes the global active profile
      // and queues test evaluations, so it runs alone after the existing E2E
      // sequence and uses only the isolated test database.
      name: "pre-evaluator-triage",
      use: chromium,
      testMatch: /\/pre-evaluator-triage\.spec\.ts$/,
      dependencies: ["companies"],
    },
    {
      // Extension Mode B (results-page capture): its own extension build and
      // persistent profile; it activates a profile and hands jobs to the
      // triage-gated evaluation request, so it runs after everything else.
      name: "page-capture",
      use: chromium,
      testMatch: /\/extension-page-capture\.spec\.ts$/,
      dependencies: ["pre-evaluator-triage"],
    },
  ],
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1",
    cwd: "apps/web",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    env: e2eEnvironment(),
  },
});
