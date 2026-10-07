import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { e2eEnvironment } from "./tests/support/e2e-environment";

// Opt-in: run E2E (web server and helpers) against a separate database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Opt-in: use a preinstalled Chromium build instead of Playwright's own.
const chromium = {
  ...devices["Desktop Chrome"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
    : {}),
};

export default defineConfig({
  testDir: "./tests/e2e",
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
      testIgnore: [/profile-management\.spec\.ts$/, /\/budget\.spec\.ts$/, /\/dashboard\.spec\.ts$/, /\/golden-path\.spec\.ts$/],
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
