import { z } from "zod";

const requiredText = z.string().trim().min(1);

export const semanticPricingConfigurationSchema = z
  .object({
    provider: requiredText,
    model: requiredText,
    version: requiredText,
    currency: requiredText.regex(/^[A-Z]{3}$/),
    inputCostPerMillionTokens: z.number().finite().nonnegative(),
    cachedInputCostPerMillionTokens: z.number().finite().nonnegative(),
    outputCostPerMillionTokens: z.number().finite().nonnegative(),
    longContextThresholdTokens: z.number().int().positive().nullable(),
    longContextInputMultiplier: z.number().finite().positive(),
    longContextOutputMultiplier: z.number().finite().positive(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullable(),
  })
  .strict();

export interface SemanticTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export function estimateSemanticOperationCost(input: {
  usage: SemanticTokenUsage;
  pricing: SemanticPricingConfiguration;
}): number | null {
  const { inputTokens, outputTokens, cachedInputTokens } = input.usage;
  if (
    inputTokens === null ||
    outputTokens === null ||
    cachedInputTokens === null ||
    cachedInputTokens > inputTokens
  ) {
    return null;
  }

  const longContext =
    input.pricing.longContextThresholdTokens !== null &&
    inputTokens > input.pricing.longContextThresholdTokens;
  const inputMultiplier = longContext
    ? input.pricing.longContextInputMultiplier
    : 1;
  const outputMultiplier = longContext
    ? input.pricing.longContextOutputMultiplier
    : 1;
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const cost =
    (uncachedInputTokens / 1_000_000) *
      input.pricing.inputCostPerMillionTokens *
      inputMultiplier +
    (cachedInputTokens / 1_000_000) *
      input.pricing.cachedInputCostPerMillionTokens *
      inputMultiplier +
    (outputTokens / 1_000_000) *
      input.pricing.outputCostPerMillionTokens *
      outputMultiplier;

  return Number(cost.toFixed(12));
}

function completeTokenTotal(
  attempts: SemanticUsageSummaryAttempt[],
  field: keyof SemanticTokenUsage,
): number | null {
  if (
    attempts.length === 0 ||
    attempts.some((attempt) => attempt[field] === null)
  ) {
    return null;
  }
  return attempts.reduce(
    (total, attempt) => total + (attempt[field] as number),
    0,
  );
}

export interface SemanticUsageSummaryAttempt extends SemanticTokenUsage {
  estimatedCost: number | null;
  pricingConfigurationVersion: string | null;
  pricingCurrency: string | null;
}

export function summarizeSemanticUsage(
  attempts: SemanticUsageSummaryAttempt[],
) {
  const versions = [
    ...new Set(
      attempts.flatMap((attempt) =>
        attempt.pricingConfigurationVersion
          ? [attempt.pricingConfigurationVersion]
          : [],
      ),
    ),
  ];
  const currencies = [
    ...new Set(
      attempts.flatMap((attempt) =>
        attempt.pricingCurrency ? [attempt.pricingCurrency] : [],
      ),
    ),
  ];
  const completeCost =
    attempts.length > 0 &&
    attempts.every((attempt) => attempt.estimatedCost !== null) &&
    currencies.length === 1;

  return {
    attemptCount: attempts.length,
    inputTokens: completeTokenTotal(attempts, "inputTokens"),
    outputTokens: completeTokenTotal(attempts, "outputTokens"),
    cachedInputTokens: completeTokenTotal(attempts, "cachedInputTokens"),
    reasoningTokens: completeTokenTotal(attempts, "reasoningTokens"),
    totalTokens: completeTokenTotal(attempts, "totalTokens"),
    estimatedCost: completeCost
      ? Number(
          attempts
            .reduce(
              (total, attempt) => total + (attempt.estimatedCost as number),
              0,
            )
            .toFixed(12),
        )
      : null,
    currency: completeCost ? currencies[0]! : null,
    pricingConfigurationVersions: versions,
  };
}

export type SemanticPricingConfiguration = z.infer<
  typeof semanticPricingConfigurationSchema
>;
