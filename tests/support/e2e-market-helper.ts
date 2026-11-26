import "dotenv/config";
import { getDatabaseClient } from "../../database/src/index";

// Deterministic E2E helper for Feature 16 (Job-Market Analytics). "seed
// <token>" writes a small synthetic cohort directly (no provider, no network),
// first seen in the week of March 3, 2025, a window no other spec writes to:
// a USD base-salary job evaluated Apply, a CAD job offering several
// arrangements, a tiered-pay job, a budget-deferred job, and a manual entry.
// "cleanup <token>" removes everything the seed wrote. Only the isolated test
// database is ever used (Playwright points DATABASE_URL at it and refuses any
// other).

const database = getDatabaseClient();
const [command, token] = process.argv.slice(2);
const at = (day: number) => new Date(Date.UTC(2025, 2, day, 12));

async function seed(tag: string) {
  const domain = `e2e-market-${tag}`;
  const job = async (title: string, day: number, kind: "automated" | "manual", extra: Record<string, unknown> = {}) => {
    const opportunity = await database.opportunity.create({
      data: { title: `${title} ${tag}`, domain, status: "NORMALIZED", firstSeenAt: at(day), discoveredAt: at(day), ...extra },
    });
    await database.sourceRecord.create({
      data: {
        opportunityId: opportunity.id,
        ...(kind === "manual" ? { source: "manual-input", sourceType: "MANUAL" as const } : { source: "greenhouse", sourceType: "ATS" as const, externalId: `${tag}-${opportunity.id}` }),
        createdAt: at(day),
        discoveredAt: at(day),
        sourceMetadata: { e2eMarket: tag },
      },
    });
    return opportunity.id;
  };

  const usd = await job("Customer Success Manager", 4, "automated", {
    salaryMin: 100_000, salaryMax: 120_000, currency: "USD", compensationBasis: "BASE", seniority: "SENIOR",
    location: "London, United Kingdom", remoteStatus: "REMOTE", workArrangements: ["REMOTE"],
  });
  const evaluation = await database.evaluation.create({
    data: {
      opportunityId: usd, domain, status: "COMPLETED", evaluationVersion: "e2e", domainVersion: "e2e", ruleVersion: "e2e", createdAt: at(5), completedAt: at(5),
      domainResult: {
        hardFilters: {
          role: { classification: "CORE_CS" },
          reconstruction: {
            requirements: [
              { requirement: "Gainsight", category: "TOOL", strength: "REQUIRED", statedYears: null, statedYearsMaximum: null, statedYearsOpenEnded: false },
              { requirement: "4+ years in Customer Success", category: "EXPERIENCE", strength: "REQUIRED", statedYears: 4, statedYearsMaximum: null, statedYearsOpenEnded: true },
            ],
          },
        },
        companyAlignment: { alignment: { customerSegment: { classification: "MID_MARKET" } } },
      },
    },
  });
  await database.recommendation.create({ data: { opportunityId: usd, evaluationId: evaluation.id, decision: "APPLY", explanation: "seeded", evaluationVersion: "e2e" } });
  await database.semanticOperationAttempt.create({
    data: {
      evaluationId: evaluation.id, opportunityId: usd, domain, operationId: "customer-success.jd-reconstruction", promptVersion: "cs-jd-reconstruction-v3",
      attempt: 1, provider: "openai", model: "e2e-market", status: "SUCCESS", durationMs: 1, createdAt: at(5),
    },
  });

  await job("Onboarding Specialist", 5, "automated", { salaryMin: 80_000, salaryMax: 90_000, currency: "CAD", compensationBasis: "BASE", workArrangements: ["REMOTE", "HYBRID"] });
  await job("Customer Success Manager", 6, "automated", {
    compensationBasis: "BASE",
    compensationTiers: [
      { label: "Zone A", minimum: 130_000, maximum: 150_000, currency: "USD" },
      { label: "Zone B", minimum: 110_000, maximum: 130_000, currency: "USD" },
    ],
  });
  const waiting = await job("Customer Success Lead", 7, "automated");
  await database.deferredEvaluation.create({ data: { opportunityId: waiting, domain, reasonCode: "AI_BUDGET_LIMIT", reasonSnapshot: {}, lastCheckedAt: at(8) } });
  await job("Client Success Lead", 8, "manual");
  console.log(JSON.stringify({ domain }));
}

async function cleanup(tag: string) {
  await database.sourceRecord.deleteMany({ where: { sourceMetadata: { path: ["e2eMarket"], equals: tag } } });
  await database.opportunity.deleteMany({ where: { domain: `e2e-market-${tag}` } });
}

if (!token) throw new Error("usage: e2e-market-helper <seed|cleanup> <token>");
if (command === "seed") await seed(token);
else if (command === "cleanup") await cleanup(token);
else throw new Error(`unknown command ${command}`);
await database.$disconnect();
