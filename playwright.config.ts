import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

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
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "deterministic-e2e-key",
      AI_MODEL: process.env.AI_MODEL ?? "gpt-5.6-terra",
      AI_MAX_OUTPUT_TOKENS: process.env.AI_MAX_OUTPUT_TOKENS ?? "12000",
      AI_RETRY_LIMIT: process.env.AI_RETRY_LIMIT ?? "1",
      AI_CALL_BUDGET: process.env.AI_CALL_BUDGET ?? "16",
      AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS ?? "120000",
      EVALUATION_JOB_MAX_ATTEMPTS:
        process.env.EVALUATION_JOB_MAX_ATTEMPTS ?? "3",
      EVALUATION_JOB_LEASE_SECONDS:
        process.env.EVALUATION_JOB_LEASE_SECONDS ?? "300",
      EVALUATION_WORKER_POLL_MS:
        process.env.EVALUATION_WORKER_POLL_MS ?? "1000",
    },
  },
});
