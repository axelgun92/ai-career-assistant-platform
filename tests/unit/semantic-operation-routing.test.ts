import {
  createCustomerSuccessEvaluator,
  customerSuccessOrganizationalMaturityPromptVersion,
  customerSuccessSemanticOperationIds,
  type CustomerSuccessSemanticOperationId,
} from "@ai-career/customer-success";
import {
  StageExecutionError,
  createSemanticExecutor,
  defineSemanticExecutionPolicy,
  type SemanticOperationAttempt,
  type SemanticOperationExecutionPolicy,
} from "@ai-career/evaluation";
import {
  customerSuccessProductionSemanticPolicyVersion,
  readSemanticEnvironment,
} from "@ai-career/shared";
import { semanticExecutorConfigFromEnvironment } from "../../apps/web/src/server/semantic-execution-config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  testLunaSemanticPricing,
  testSemanticPricing,
} from "../fixtures/semantic-pricing";

const operationSchema = z.object({ ok: z.boolean() }).strict();

const productionLunaOperationIds = [
  "customer-success.job-evaluation",
  "customer-success.company-alignment",
  "customer-success.organizational-maturity",
  "customer-success.alex-fit",
  "customer-success.burnout-risk",
  "customer-success.opportunity-priority",
] as const satisfies readonly CustomerSuccessSemanticOperationId[];

const productionTerraOperationIds = [
  "customer-success.jd-reconstruction",
  "customer-success.resume-match",
  // The no-history Ghost Job Risk branch is deterministic. Its unchanged
  // evidence-backed semantic branch retains the default Terra route.
  "customer-success.ghost-job-risk",
] as const satisfies readonly CustomerSuccessSemanticOperationId[];

function operation(operationId: string) {
  return {
    operationId,
    promptVersion: "test-prompt-v1",
    schema: operationSchema,
    systemRules: "Rules",
    domainInstructions: "Instructions",
    userConfiguration: {},
    trustedContext: {},
  };
}

function route(
  model: string,
  pricingVersion: string,
  overrides: Partial<SemanticOperationExecutionPolicy> = {},
): SemanticOperationExecutionPolicy {
  return {
    provider: "openai",
    model,
    pricingVersion,
    reasoningEffort: "medium",
    maximumOutputTokens: 900,
    timeoutMs: 5_000,
    semanticRetryLimit: 0,
    ...overrides,
  };
}

function routedConfig(input: {
  operations: Record<string, SemanticOperationExecutionPolicy>;
  callBudget?: number;
}) {
  return {
    apiKey: "test-key-not-a-secret",
    model: testSemanticPricing.model,
    maxOutputTokens: 900,
    retryLimit: 0,
    callBudget: input.callBudget ?? 10,
    timeoutMs: 5_000,
    pricing: testSemanticPricing,
    executionPolicy: defineSemanticExecutionPolicy({
      version: "test-mixed-policy-v1",
      operations: input.operations,
    }),
    pricingConfigurations: [testSemanticPricing, testLunaSemanticPricing],
  };
}

function productionEnvironment(overrides: Record<string, string> = {}) {
  return readSemanticEnvironment({
    OPENAI_API_KEY: "test-key-not-a-secret",
    AI_MODEL: "gpt-5.6-terra",
    AI_MAX_OUTPUT_TOKENS: "12000",
    AI_RETRY_LIMIT: "1",
    AI_CALL_BUDGET: "16",
    AI_REQUEST_TIMEOUT_MS: "120000",
    ...overrides,
  });
}

describe("per-semantic-operation execution routing", () => {
  it("uses the complete approved production Customer Success model map", () => {
    const config = semanticExecutorConfigFromEnvironment(
      productionEnvironment(),
    );

    expect(config.executionPolicy?.version).toBe(
      customerSuccessProductionSemanticPolicyVersion,
    );
    expect(customerSuccessProductionSemanticPolicyVersion).toBe(
      "customer-success-semantic-policy-v3-mixed-terra-luna",
    );
    expect(Object.keys(config.executionPolicy?.operations ?? {})).toEqual(
      customerSuccessSemanticOperationIds,
    );
    for (const operationId of productionLunaOperationIds) {
      expect(config.executionPolicy?.operations[operationId]).toEqual({
        provider: "openai",
        model: "gpt-5.6-luna",
        pricingVersion: "openai-gpt-5.6-luna-standard-2026-08-26",
        reasoningEffort: "medium",
        maximumOutputTokens: 12_000,
        timeoutMs: 120_000,
        semanticRetryLimit: 1,
      });
    }
    for (const operationId of productionTerraOperationIds) {
      expect(config.executionPolicy?.operations[operationId]).toEqual({
        provider: "openai",
        model: "gpt-5.6-terra",
        pricingVersion: "openai-gpt-5.6-terra-standard-2026-07-30",
        reasoningEffort: "medium",
        maximumOutputTokens: 12_000,
        timeoutMs: 120_000,
        semanticRetryLimit: 1,
      });
    }
    expect(
      config.pricingConfigurations?.find(
        (pricing) => pricing.model === "gpt-5.6-luna",
      ),
    ).toMatchObject({
      provider: "openai",
      version: "openai-gpt-5.6-luna-standard-2026-08-26",
      inputCostPerMillionTokens: 0.2,
      cachedInputCostPerMillionTokens: 0.02,
      outputCostPerMillionTokens: 1.2,
    });
  });

  it("uses the versioned Organizational Maturity renewal-contract prompt", () => {
    expect(customerSuccessOrganizationalMaturityPromptVersion).toBe(
      "cs-organizational-maturity-v5",
    );
    expect(
      createCustomerSuccessEvaluator().stages.find(
        (stage) => stage.id === "organizational-maturity",
      )?.promptVersion,
    ).toBe("cs-organizational-maturity-v5");
  });

  it.each(productionLunaOperationIds)(
    "records production %s retries only on Luna with Luna pricing",
    async (operationId) => {
      const attempts: SemanticOperationAttempt[] = [];
      const models: string[] = [];
      const config = semanticExecutorConfigFromEnvironment(
        productionEnvironment(),
      );
      const executor = createSemanticExecutor({
        config,
        transport: {
          async execute(request) {
            models.push(request.model);
            return {
              outputText: models.length === 1 ? "{}" : '{"ok":true}',
              providerRequestId: `req-${models.length}`,
              usage: {
                inputTokens: 1_000,
                cachedInputTokens: 100,
                reasoningTokens: 50,
                outputTokens: 500,
                totalTokens: 1_500,
              },
            };
          },
        },
        recorder: {
          async record(attempt) {
            attempts.push(attempt);
          },
        },
      });

      await expect(executor.execute(operation(operationId))).resolves.toEqual({
        ok: true,
      });
      expect(models).toEqual(["gpt-5.6-luna", "gpt-5.6-luna"]);
      expect(attempts).toHaveLength(2);
      expect(
        attempts.every(
          (attempt) =>
            attempt.model === "gpt-5.6-luna" &&
            attempt.pricingConfiguration.version ===
              "openai-gpt-5.6-luna-standard-2026-08-26" &&
            attempt.estimatedCost === 0.000782,
        ),
      ).toBe(true);
      expect(executor.usage()).toEqual({ callsUsed: 2, callBudget: 16 });
    },
  );

  it("allows one operation to be explicitly routed to Luna", async () => {
    const config = semanticExecutorConfigFromEnvironment(
      productionEnvironment({
        AI_OPERATION_EXECUTION_OVERRIDES_JSON: JSON.stringify({
          "customer-success.resume-match": {
            model: "gpt-5.6-luna",
            pricingVersion: "openai-gpt-5.6-luna-standard-2026-08-26",
            reasoningEffort: "high",
            maximumOutputTokens: 4_000,
            timeoutMs: 45_000,
            semanticRetryLimit: 0,
          },
        }),
      }),
    );
    const attempts: SemanticOperationAttempt[] = [];
    const requests: Array<{
      model: string;
      reasoningEffort: string;
      maximumOutputTokens: number;
    }> = [];
    const executor = createSemanticExecutor({
      config,
      transport: {
        async execute(request) {
          requests.push({
            model: request.model,
            reasoningEffort: request.reasoningEffort,
            maximumOutputTokens: request.maxOutputTokens,
          });
          return {
            outputText: '{"ok":true}',
            providerRequestId: "req-luna",
            usage: {
              inputTokens: 1_000,
              cachedInputTokens: 100,
              reasoningTokens: 50,
              outputTokens: 500,
              totalTokens: 1_500,
            },
          };
        },
      },
      recorder: { async record(attempt) { attempts.push(attempt); } },
    });

    await expect(
      executor.execute(operation("customer-success.resume-match")),
    ).resolves.toEqual({ ok: true });
    expect(requests).toEqual([
      {
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        maximumOutputTokens: 4_000,
      },
    ]);
    expect(attempts[0]).toMatchObject({
      model: "gpt-5.6-luna",
      pricingConfiguration: {
        model: "gpt-5.6-luna",
        version: "openai-gpt-5.6-luna-standard-2026-08-26",
      },
      estimatedCost: 0.000782,
    });
  });

  it("uses the selected Terra and Luna pricing for each attempt", async () => {
    const attempts: SemanticOperationAttempt[] = [];
    const executor = createSemanticExecutor({
      config: routedConfig({
        operations: {
          terra: route(testSemanticPricing.model, testSemanticPricing.version),
          luna: route(testLunaSemanticPricing.model, testLunaSemanticPricing.version),
        },
      }),
      transport: {
        async execute() {
          return {
            outputText: '{"ok":true}',
            providerRequestId: null,
            usage: {
              inputTokens: 1_000,
              cachedInputTokens: 100,
              reasoningTokens: 50,
              outputTokens: 500,
              totalTokens: 1_500,
            },
          };
        },
      },
      recorder: { async record(attempt) { attempts.push(attempt); } },
    });

    await executor.execute(operation("terra"));
    await executor.execute(operation("luna"));

    expect(attempts.map((attempt) => ({
      model: attempt.model,
      pricingVersion: attempt.pricingConfiguration.version,
      estimatedCost: attempt.estimatedCost,
    }))).toEqual([
      {
        model: "gpt-5.6-terra",
        pricingVersion: testSemanticPricing.version,
        estimatedCost: 0.00782,
      },
      {
        model: "gpt-5.6-luna",
        pricingVersion: testLunaSemanticPricing.version,
        estimatedCost: 0.000782,
      },
    ]);
  });

  it.each(["validation", "provider"] as const)(
    "never falls back from Luna to Terra after a Luna %s failure",
    async (failureKind) => {
      const models: string[] = [];
      const executor = createSemanticExecutor({
        config: routedConfig({
          operations: {
            luna: route(testLunaSemanticPricing.model, testLunaSemanticPricing.version),
          },
        }),
        transport: {
          async execute(request) {
            models.push(request.model);
            if (failureKind === "provider") throw new Error("provider unavailable");
            return {
              outputText: "{}",
              providerRequestId: null,
              usage: {
                inputTokens: null,
                cachedInputTokens: null,
                reasoningTokens: null,
                outputTokens: null,
                totalTokens: null,
              },
            };
          },
        },
        recorder: { async record() {} },
      });

      await expect(executor.execute(operation("luna"))).rejects.toBeInstanceOf(
        StageExecutionError,
      );
      expect(models).toEqual(["gpt-5.6-luna"]);
    },
  );

  it.each(["validation", "provider"] as const)(
    "never falls back from Terra to Luna after a Terra %s failure",
    async (failureKind) => {
      const models: string[] = [];
      const executor = createSemanticExecutor({
        config: routedConfig({
          operations: {
            terra: route(
              testSemanticPricing.model,
              testSemanticPricing.version,
            ),
          },
        }),
        transport: {
          async execute(request) {
            models.push(request.model);
            if (failureKind === "provider") {
              throw new Error("provider unavailable");
            }
            return {
              outputText: "{}",
              providerRequestId: null,
              usage: {
                inputTokens: null,
                cachedInputTokens: null,
                reasoningTokens: null,
                outputTokens: null,
                totalTokens: null,
              },
            };
          },
        },
        recorder: { async record() {} },
      });

      await expect(executor.execute(operation("terra"))).rejects.toBeInstanceOf(
        StageExecutionError,
      );
      expect(models).toEqual(["gpt-5.6-terra"]);
    },
  );

  it("fails before a provider request when route pricing is missing or mismatched", () => {
    let providerCalls = 0;
    const config = routedConfig({
      operations: {
        luna: route(testLunaSemanticPricing.model, "missing-pricing-version"),
      },
    });

    expect(() =>
      createSemanticExecutor({
        config,
        transport: {
          async execute() {
            providerCalls += 1;
            throw new Error("must not run");
          },
        },
        recorder: { async record() {} },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "SEMANTIC_EXECUTION_POLICY_INVALID" }),
    );
    expect(providerCalls).toBe(0);
  });

  it("keeps retries and the shared evaluation call budget bounded across models", async () => {
    const models: string[] = [];
    const executor = createSemanticExecutor({
      config: routedConfig({
        callBudget: 2,
        operations: {
          luna: route(testLunaSemanticPricing.model, testLunaSemanticPricing.version, {
            semanticRetryLimit: 1,
          }),
          terra: route(testSemanticPricing.model, testSemanticPricing.version),
        },
      }),
      transport: {
        async execute(request) {
          models.push(request.model);
          return {
            outputText: models.length === 1 ? "{}" : '{"ok":true}',
            providerRequestId: null,
            usage: {
              inputTokens: 1,
              cachedInputTokens: 0,
              reasoningTokens: 0,
              outputTokens: 1,
              totalTokens: 2,
            },
          };
        },
      },
      recorder: { async record() {} },
    });

    await expect(executor.execute(operation("luna"))).resolves.toEqual({ ok: true });
    await expect(executor.execute(operation("terra"))).rejects.toMatchObject({
      code: "SEMANTIC_CALL_BUDGET_EXHAUSTED",
      retryable: false,
    });
    expect(models).toEqual(["gpt-5.6-luna", "gpt-5.6-luna"]);
    expect(executor.usage()).toEqual({ callsUsed: 2, callBudget: 2 });
  });
});
