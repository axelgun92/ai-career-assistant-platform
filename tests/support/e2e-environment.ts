// Deterministic E2E environment shared by the Playwright web server and the
// E2E worker helper, so both build the same semantic execution policy. Values
// already set in the process environment take precedence, as before; an
// empty value or the old example placeholder counts as unset.
//
// The one exception is OPENAI_API_KEY: E2E always uses the deterministic,
// non-live key below, whatever .env or the shell provides. No E2E path calls
// a provider (the web server only queues, and the E2E worker uses the fixture
// transport), so a real credential is never needed and must not be inherited.
export const e2eDeterministicOpenAiKey = "deterministic-e2e-key";

export const e2eEnvironmentDefaults = {
  OPENAI_API_KEY: e2eDeterministicOpenAiKey,
  AI_MODEL: "gpt-5.6-terra",
  AI_MAX_OUTPUT_TOKENS: "12000",
  AI_RETRY_LIMIT: "1",
  AI_CALL_BUDGET: "16",
  AI_REQUEST_TIMEOUT_MS: "120000",
  EVALUATION_JOB_MAX_ATTEMPTS: "3",
  EVALUATION_JOB_LEASE_SECONDS: "300",
  EVALUATION_WORKER_POLL_MS: "1000",
} as const;

export function e2eEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Record<keyof typeof e2eEnvironmentDefaults, string> {
  return Object.fromEntries(
    Object.entries(e2eEnvironmentDefaults).map(([name, value]) => [
      name,
      name !== "OPENAI_API_KEY" && environment[name] && environment[name] !== "YOUR_OPENAI_API_KEY"
        ? environment[name]
        : value,
    ]),
  ) as Record<keyof typeof e2eEnvironmentDefaults, string>;
}
