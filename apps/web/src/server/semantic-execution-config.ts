import {
  customerSuccessSemanticOperationIds,
  type CustomerSuccessSemanticOperationId,
} from "@ai-career/customer-success";
import {
  defineSemanticExecutionPolicy,
  semanticOperationExecutionPolicySchema,
  validateSemanticExecutionPolicyPricing,
  type SemanticExecutorConfig,
  type SemanticOperationExecutionPolicy,
} from "@ai-career/evaluation";
import {
  readSemanticEnvironment,
  gpt56LunaPricingConfiguration,
  semanticPricingConfigurationsFromEnvironment,
  semanticPricingFromEnvironment,
  type SemanticEnvironment,
} from "@ai-career/shared";
import { z } from "zod";

const operationOverrideSchema = semanticOperationExecutionPolicySchema.partial();
const operationOverridesSchema = z.record(
  z.string().trim().min(1),
  operationOverrideSchema,
);

const approvedProductionOperationOverrides: Partial<
  Record<
    CustomerSuccessSemanticOperationId,
    Partial<SemanticOperationExecutionPolicy>
  >
> = {
  "customer-success.organizational-maturity": {
    model: gpt56LunaPricingConfiguration.model,
    pricingVersion: gpt56LunaPricingConfiguration.version,
  },
};

function readOperationOverrides(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AI operation execution overrides must be valid JSON");
  }
  const overrides = operationOverridesSchema.parse(parsed);
  const knownOperations = new Set<string>(customerSuccessSemanticOperationIds);
  if (Object.keys(overrides).some((operationId) => !knownOperations.has(operationId))) {
    throw new Error("AI operation execution overrides contain an unknown operation");
  }
  return overrides;
}

export function semanticExecutorConfigFromEnvironment(
  environment: SemanticEnvironment = readSemanticEnvironment(),
): SemanticExecutorConfig {
  const pricing = semanticPricingFromEnvironment(environment);
  const pricingConfigurations =
    semanticPricingConfigurationsFromEnvironment(environment);
  const overrides = readOperationOverrides(
    environment.AI_OPERATION_EXECUTION_OVERRIDES_JSON,
  );
  const defaultRoute: SemanticOperationExecutionPolicy = {
    provider: "openai",
    model: environment.AI_MODEL,
    pricingVersion: environment.AI_PRICING_VERSION,
    reasoningEffort: environment.AI_DEFAULT_REASONING_EFFORT,
    maximumOutputTokens: environment.AI_MAX_OUTPUT_TOKENS,
    timeoutMs: environment.AI_REQUEST_TIMEOUT_MS,
    semanticRetryLimit: environment.AI_RETRY_LIMIT,
  };
  const executionPolicy = defineSemanticExecutionPolicy({
    version: environment.AI_EXECUTION_POLICY_VERSION,
    operations: Object.fromEntries(
      customerSuccessSemanticOperationIds.map((operationId) => [
        operationId,
        {
          ...defaultRoute,
          ...approvedProductionOperationOverrides[operationId],
          ...overrides[operationId],
        },
      ]),
    ),
  });
  validateSemanticExecutionPolicyPricing({
    policy: executionPolicy,
    pricingConfigurations,
  });

  return {
    apiKey: environment.OPENAI_API_KEY,
    model: environment.AI_MODEL,
    maxOutputTokens: environment.AI_MAX_OUTPUT_TOKENS,
    retryLimit: environment.AI_RETRY_LIMIT,
    callBudget: environment.AI_CALL_BUDGET,
    timeoutMs: environment.AI_REQUEST_TIMEOUT_MS,
    pricing,
    executionPolicy,
    pricingConfigurations,
  };
}
