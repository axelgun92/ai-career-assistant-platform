import { z } from "zod";
import { StageExecutionError } from "./errors";
import {
  semanticPricingConfigurationSchema,
  type SemanticPricingConfiguration,
} from "./semantic-pricing";

const requiredText = z.string().trim().min(1);

export const semanticProviderSchema = z.literal("openai");

export const semanticReasoningEffortSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const semanticOperationExecutionPolicySchema = z
  .object({
    provider: semanticProviderSchema,
    model: requiredText,
    pricingVersion: requiredText,
    reasoningEffort: semanticReasoningEffortSchema,
    maximumOutputTokens: z.number().int().positive().max(128_000),
    timeoutMs: z.number().int().min(1_000).max(600_000),
    semanticRetryLimit: z.number().int().min(0).max(5),
  })
  .strict();

export const semanticExecutionPolicySchema = z
  .object({
    version: requiredText,
    operations: z.record(requiredText, semanticOperationExecutionPolicySchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.operations).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "At least one semantic operation route is required",
      });
    }
  });

export type SemanticProvider = z.infer<typeof semanticProviderSchema>;
export type SemanticReasoningEffort = z.infer<
  typeof semanticReasoningEffortSchema
>;
export type SemanticOperationExecutionPolicy = z.infer<
  typeof semanticOperationExecutionPolicySchema
>;
export type SemanticExecutionPolicy = z.infer<
  typeof semanticExecutionPolicySchema
>;

function pricingKey(input: {
  provider: string;
  model: string;
  version: string;
}) {
  return `${input.provider}\u0000${input.model}\u0000${input.version}`;
}

function configurationFailure(): StageExecutionError {
  return new StageExecutionError({
    code: "SEMANTIC_EXECUTION_POLICY_INVALID",
    message: "Semantic execution policy configuration is invalid",
    retryable: false,
  });
}

export function defineSemanticExecutionPolicy(
  value: z.input<typeof semanticExecutionPolicySchema>,
): SemanticExecutionPolicy {
  return semanticExecutionPolicySchema.parse(value);
}

export function validateSemanticExecutionPolicyPricing(input: {
  policy: SemanticExecutionPolicy;
  pricingConfigurations: readonly SemanticPricingConfiguration[];
}) {
  try {
    const policy = semanticExecutionPolicySchema.parse(input.policy);
    const pricingConfigurations = input.pricingConfigurations.map((pricing) =>
      semanticPricingConfigurationSchema.parse(pricing),
    );
    const pricingByKey = new Map<string, SemanticPricingConfiguration>();
    for (const pricing of pricingConfigurations) {
      const key = pricingKey(pricing);
      if (pricingByKey.has(key)) throw configurationFailure();
      pricingByKey.set(key, pricing);
    }
    for (const route of Object.values(policy.operations)) {
      if (
        !pricingByKey.has(
          pricingKey({
            provider: route.provider,
            model: route.model,
            version: route.pricingVersion,
          }),
        )
      ) {
        throw configurationFailure();
      }
    }
    return { policy, pricingByKey };
  } catch (error) {
    if (error instanceof StageExecutionError) throw error;
    throw configurationFailure();
  }
}

export function resolveSemanticOperationExecution(input: {
  operationId: string;
  policy: SemanticExecutionPolicy;
  pricingByKey: ReadonlyMap<string, SemanticPricingConfiguration>;
}) {
  const route = input.policy.operations[input.operationId];
  if (!route) {
    throw new StageExecutionError({
      code: "SEMANTIC_OPERATION_POLICY_MISSING",
      message: "The semantic operation has no configured execution policy",
      retryable: false,
    });
  }
  const pricing = input.pricingByKey.get(
    pricingKey({
      provider: route.provider,
      model: route.model,
      version: route.pricingVersion,
    }),
  );
  if (!pricing) throw configurationFailure();
  return { route, pricing };
}
