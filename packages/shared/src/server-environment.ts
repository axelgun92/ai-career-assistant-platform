import { z } from "zod";

export const customerSuccessProductionSemanticPolicyVersion =
  "customer-success-semantic-policy-v3-mixed-terra-luna";

const postgresConnectionString = z.string().min(1).refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgresql:" || protocol === "postgres:";
    } catch {
      return false;
    }
  },
  { message: "DATABASE_URL must be a PostgreSQL connection string" },
);

export const serverEnvironmentSchema = z.object({
  DATABASE_URL: postgresConnectionString,
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}

export const semanticEnvironmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  AI_MODEL: z.string().trim().min(1),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(100_000),
  AI_RETRY_LIMIT: z.coerce.number().int().min(0).max(5),
  AI_CALL_BUDGET: z.coerce.number().int().positive().max(100),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000),
  AI_DEFAULT_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("medium"),
  AI_EXECUTION_POLICY_VERSION: z
    .string()
    .trim()
    .min(1)
    .default(customerSuccessProductionSemanticPolicyVersion),
  AI_OPERATION_EXECUTION_OVERRIDES_JSON: z.string().default("{}"),
  AI_PRICING_PROVIDER: z.string().trim().min(1).default("openai"),
  AI_PRICING_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  AI_PRICING_VERSION: z
    .string()
    .trim()
    .min(1)
    .default("openai-gpt-5.6-terra-standard-2026-07-30"),
  AI_PRICING_CURRENCY: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  AI_INPUT_COST_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(2),
  AI_CACHED_INPUT_COST_PER_MILLION_TOKENS: z.coerce
    .number()
    .nonnegative()
    .default(0.2),
  AI_OUTPUT_COST_PER_MILLION_TOKENS: z.coerce
    .number()
    .nonnegative()
    .default(12),
  AI_LONG_CONTEXT_THRESHOLD_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(272_000),
  AI_LONG_CONTEXT_INPUT_MULTIPLIER: z.coerce
    .number()
    .positive()
    .default(2),
  AI_LONG_CONTEXT_OUTPUT_MULTIPLIER: z.coerce
    .number()
    .positive()
    .default(1.5),
  AI_PRICING_EFFECTIVE_FROM: z
    .string()
    .datetime({ offset: true })
    .default("2026-07-30T00:00:00.000Z"),
}).superRefine((value, context) => {
  if (value.AI_PRICING_PROVIDER !== "openai") {
    context.addIssue({
      code: "custom",
      path: ["AI_PRICING_PROVIDER"],
      message: "The configured semantic provider is openai",
    });
  }
  if (value.AI_PRICING_MODEL !== value.AI_MODEL) {
    context.addIssue({
      code: "custom",
      path: ["AI_PRICING_MODEL"],
      message: "AI_PRICING_MODEL must match AI_MODEL",
    });
  }
});

export const evaluationWorkerEnvironmentSchema = z.object({
  EVALUATION_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10),
  EVALUATION_JOB_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600),
  EVALUATION_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000),
});

export type SemanticEnvironment = z.infer<typeof semanticEnvironmentSchema>;
export type EvaluationWorkerEnvironment = z.infer<
  typeof evaluationWorkerEnvironmentSchema
>;

export function readSemanticEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): SemanticEnvironment {
  return semanticEnvironmentSchema.parse(environment);
}

export function semanticPricingFromEnvironment(
  environment: SemanticEnvironment,
) {
  return {
    provider: environment.AI_PRICING_PROVIDER,
    model: environment.AI_PRICING_MODEL,
    version: environment.AI_PRICING_VERSION,
    currency: environment.AI_PRICING_CURRENCY,
    inputCostPerMillionTokens:
      environment.AI_INPUT_COST_PER_MILLION_TOKENS,
    cachedInputCostPerMillionTokens:
      environment.AI_CACHED_INPUT_COST_PER_MILLION_TOKENS,
    outputCostPerMillionTokens:
      environment.AI_OUTPUT_COST_PER_MILLION_TOKENS,
    longContextThresholdTokens:
      environment.AI_LONG_CONTEXT_THRESHOLD_TOKENS,
    longContextInputMultiplier:
      environment.AI_LONG_CONTEXT_INPUT_MULTIPLIER,
    longContextOutputMultiplier:
      environment.AI_LONG_CONTEXT_OUTPUT_MULTIPLIER,
    effectiveFrom: new Date(environment.AI_PRICING_EFFECTIVE_FROM),
    effectiveTo: null,
  };
}

export const gpt56LunaPricingConfiguration = {
  provider: "openai",
  model: "gpt-5.6-luna",
  version: "openai-gpt-5.6-luna-standard-2026-08-26",
  currency: "USD",
  inputCostPerMillionTokens: 0.2,
  cachedInputCostPerMillionTokens: 0.02,
  outputCostPerMillionTokens: 1.2,
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
  effectiveFrom: new Date("2026-08-26T00:00:00.000Z"),
  effectiveTo: null,
} as const;

export function semanticPricingConfigurationsFromEnvironment(
  environment: SemanticEnvironment,
) {
  return [
    semanticPricingFromEnvironment(environment),
    gpt56LunaPricingConfiguration,
  ];
}

export function readEvaluationWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): EvaluationWorkerEnvironment {
  return evaluationWorkerEnvironmentSchema.parse(environment);
}
