import { summarizeSemanticUsage } from "@ai-career/evaluation";
import { getDatabaseClient } from "./client";

export interface UsageTotals {
  evaluationCount: number;
  // Attempts whose estimated cost was not recorded. Any such attempt makes
  // the total estimated cost Unknown (summarizeSemanticUsage behaviour).
  attemptsWithoutCost: number;
  usage: ReturnType<typeof summarizeSemanticUsage>;
}

// Read-only totals over persisted semantic-operation attempts. Usage and cost
// are summarized with the existing summarizeSemanticUsage(); nothing here
// recalculates or estimates cost.
export class PrismaUsageSummaryRepository {
  private readonly database = getDatabaseClient();

  async summarizeAllUsage(): Promise<UsageTotals> {
    const attempts = await this.database.semanticOperationAttempt.findMany({
      select: {
        evaluationId: true,
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
        reasoningTokens: true,
        totalTokens: true,
        estimatedCost: true,
        pricingConfiguration: { select: { version: true, currency: true } },
      },
    });
    const summaryAttempts = attempts.map((attempt) => ({
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      cachedInputTokens: attempt.cachedInputTokens,
      reasoningTokens: attempt.reasoningTokens,
      totalTokens: attempt.totalTokens,
      estimatedCost: attempt.estimatedCost?.toNumber() ?? null,
      pricingConfigurationVersion: attempt.pricingConfiguration?.version ?? null,
      pricingCurrency: attempt.pricingConfiguration?.currency ?? null,
    }));
    return {
      evaluationCount: new Set(attempts.map((attempt) => attempt.evaluationId)).size,
      attemptsWithoutCost: summaryAttempts.filter((attempt) => attempt.estimatedCost === null).length,
      usage: summarizeSemanticUsage(summaryAttempts),
    };
  }
}
