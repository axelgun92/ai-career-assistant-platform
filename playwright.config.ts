import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { e2eEnvironment } from "./tests/support/e2e-environment";

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
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/profile-management\.spec\.ts$/, /\/budget\.spec\.ts$/, /\/dashboard\.spec\.ts$/],
    },
    {
      // Profile specs change which profile version is active, which every
      // UI-requested evaluation reads, so they run only after the other
      // specs have finished.
      name: "profile-management",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /profile-management\.spec\.ts/,
      dependencies: ["chromium"],
    },
    {
      // The budget is global and gates every UI-requested evaluation, so the
      // budget spec runs last, after every other spec has finished.
      name: "budget",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /\/budget\.spec\.ts$/,
      dependencies: ["profile-management"],
    },
    {
      // The dashboard spec sets a budget (to create a deferral) and an active
      // profile, so it runs alone after the budget project.
      name: "dashboard",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /\/dashboard\.spec\.ts$/,
      dependencies: ["budget"],
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
