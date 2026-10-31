import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getDatabaseClient } from "../../database/src/index";

// Deterministic E2E helper for Feature 15 (Source Intelligence). "seed
// <token>" writes a small synthetic history directly (no provider, no
// network): a job board that discovered two jobs, an employer ATS that later
// listed one of them, an older ATS job outside the 30-day window, a completed
// evaluation with a recorded cost, a budget-deferred job, an application with
// an interview, and a manual entry. It prints the ids as JSON. "cleanup
// <token>" removes everything the seed wrote. Only the isolated test database
// is ever used (Playwright points DATABASE_URL at it and refuses any other).

const database = getDatabaseClient();
const [command, token] = process.argv.slice(2);
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day);

async function seed(tag: string) {
  const source = (adapterKey: string, category: "ATS" | "JOB_BOARD", name: string) =>
    database.retrievalSource.create({
      data: { adapterKey, name: `${name} ${tag}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: category, enabled: false, config: { e2eInsights: tag }, trackingScopeKey: `scope-${randomUUID()}` },
    });
  const board = await source("remote-ok", "JOB_BOARD", "Insights board");
  const ats = await source("greenhouse", "ATS", "Insights ATS");
  const opportunity = (title: string, extra: Record<string, unknown> = {}) =>
    database.opportunity.create({ data: { title: `${title} ${tag}`, domain: `e2e-insights-${tag}`, status: "ARCHIVED", ...extra } });
  const record = (opportunityId: string, from: typeof board | null, at: Date, extra: Record<string, unknown> = {}) =>
    database.sourceRecord.create({
      data: from
        ? { opportunityId, source: from.adapterKey, sourceType: from.sourceCategory === "ATS" ? "ATS" : "API", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: from.sourceCategory, retrievalSourceId: from.id, externalId: `${tag}-${randomUUID()}`, createdAt: at, discoveredAt: at, sourceMetadata: { e2eInsights: tag }, ...extra }
        : { opportunityId, source: "manual-input", sourceType: "MANUAL", createdAt: at, discoveredAt: at, sourceMetadata: { e2eInsights: tag }, ...extra },
    });

  // Found first on the board, listed later on the employer ATS; evaluated Apply; applied with an interview.
  const shared = await opportunity("Customer Success Manager", { location: "Toronto, Ontario, Canada" });
  await record(shared.id, board, ago(12));
  await record(shared.id, ats, ago(10), { duplicateDecision: "MATCH" });
  const pricing = await database.aiModelPricingConfiguration.create({
    data: { provider: "openai", model: "e2e-insights", version: `e2e-insights-${tag}`, currency: "USD", inputCostPerMillionTokens: 1, cachedInputCostPerMillionTokens: 1, outputCostPerMillionTokens: 1, longContextInputMultiplier: 1, longContextOutputMultiplier: 1, effectiveFrom: ago(400) },
  });
  // Recorded 120 days ago, outside the current budget period.
  const evaluation = await database.evaluation.create({
    data: { opportunityId: shared.id, domain: `e2e-insights-${tag}`, status: "COMPLETED", evaluationVersion: "e2e", domainVersion: "e2e", ruleVersion: "e2e", createdAt: ago(120), completedAt: ago(120) },
  });
  await database.recommendation.create({ data: { opportunityId: shared.id, evaluationId: evaluation.id, decision: "APPLY", explanation: "seeded", evaluationVersion: "e2e" } });
  await database.semanticOperationAttempt.create({
    data: { evaluationId: evaluation.id, opportunityId: shared.id, domain: `e2e-insights-${tag}`, operationId: "op", promptVersion: "e2e", attempt: 1, provider: "openai", model: "e2e-insights", status: "SUCCESS", durationMs: 1, estimatedCost: 0.42, pricingConfigurationId: pricing.id, createdAt: ago(120) },
  });
  const application = await database.application.create({ data: { opportunityId: shared.id, stage: "INTERVIEWING", appliedOn: ago(9) } });
  await database.applicationEvent.create({ data: { applicationId: application.id, sequence: 1, type: "SUBMITTED", occurredOn: ago(9) } });
  await database.applicationEvent.create({ data: { applicationId: application.id, sequence: 2, type: "STAGE_CHANGED", toStage: "INTERVIEWING", occurredOn: ago(5) } });

  // A second board job waiting on the AI budget.
  const waiting = await opportunity("Customer Success Lead");
  await record(waiting.id, board, ago(6));
  await database.deferredEvaluation.create({ data: { opportunityId: waiting.id, domain: `e2e-insights-${tag}`, reasonCode: "AI_BUDGET_LIMIT", reasonSnapshot: {}, lastCheckedAt: ago(1) } });

  // An older ATS job, outside the default 30-day window.
  const older = await opportunity("Renewals Manager");
  await record(older.id, ats, ago(60));

  // A manual entry (user-collected).
  const manual = await opportunity("Customer Success Director");
  await record(manual.id, null, ago(3));

  console.log(JSON.stringify({ board: board.id, ats: ats.id, shared: shared.id }));
}

async function cleanup(tag: string) {
  const sources = await database.retrievalSource.findMany({ where: { config: { path: ["e2eInsights"], equals: tag } }, select: { id: true } });
  const opportunities = await database.opportunity.findMany({ where: { domain: `e2e-insights-${tag}` }, select: { id: true } });
  await database.sourceRecord.deleteMany({ where: { sourceMetadata: { path: ["e2eInsights"], equals: tag } } });
  await database.opportunity.deleteMany({ where: { id: { in: opportunities.map((item) => item.id) } } });
  await database.retrievalSource.deleteMany({ where: { id: { in: sources.map((item) => item.id) } } });
  await database.aiModelPricingConfiguration.deleteMany({ where: { version: `e2e-insights-${tag}` } });
}

if (!token) throw new Error("usage: e2e-insights-helper <seed|cleanup> <token>");
if (command === "seed") await seed(token);
else if (command === "cleanup") await cleanup(token);
else throw new Error(`unknown command ${command}`);
await database.$disconnect();
