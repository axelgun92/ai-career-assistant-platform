import type { SemanticPricingConfiguration } from "@ai-career/evaluation";

export const testSemanticPricing = {
  provider: "openai",
  model: "gpt-5.6-terra",
  version: "test-openai-gpt-5.6-terra-utc-v2",
  currency: "USD",
  inputCostPerMillionTokens: 2,
  cachedInputCostPerMillionTokens: 0.2,
  outputCostPerMillionTokens: 12,
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
  effectiveFrom: new Date("2026-07-30T00:00:00.000Z"),
  effectiveTo: null,
} satisfies SemanticPricingConfiguration;

export const testLunaSemanticPricing = {
  provider: "openai",
  model: "gpt-5.6-luna",
  version: "test-openai-gpt-5.6-luna-utc-v1",
  currency: "USD",
  inputCostPerMillionTokens: 0.2,
  cachedInputCostPerMillionTokens: 0.02,
  outputCostPerMillionTokens: 1.2,
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
  effectiveFrom: new Date("2026-08-26T00:00:00.000Z"),
  effectiveTo: null,
} satisfies SemanticPricingConfiguration;
