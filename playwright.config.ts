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
