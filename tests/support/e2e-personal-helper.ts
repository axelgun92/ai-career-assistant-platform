import "dotenv/config";
import { getDatabaseClient } from "../../database/src/index";

// Deterministic E2E helper for Feature 17 (Personal Job-Search Analytics).
// "seed <token>" writes a small synthetic application history directly (no
// provider, no network), applied in March 2025 — a window no other spec writes
// to — with evaluations that record no profile (so the spec selects
// profile=none and never depends on, or changes, the active profile):
// five mature Implementation applications without an interview, an Apply
// evaluation followed by an application still interviewing, a same-day
// evaluation and application later rejected, and a manual entry that reached
// an accepted offer. "cleanup <token>" removes everything the seed wrote. Only
// the isolated test database is ever used.

const database = getDatabaseClient();
const [command, token] = process.argv.slice(2);
const at = (day: number, hour = 12) => new Date(Date.UTC(2025, 2, day, hour));
const date = (day: number) => new Date(Date.UTC(2025, 2, day));

async function seed(tag: string) {
  const domain = `e2e-personal-${tag}`;
  const job = async (title: string, origin: "ats" | "manual") => {
    const opportunity = await database.opportunity.create({ data: { title: `${title} ${tag}`, domain, status: "APPLIED", firstSeenAt: at(1), discoveredAt: at(1) } });
    await database.sourceRecord.create({
      data: {
        opportunityId: opportunity.id,
        ...(origin === "manual" ? { source: "manual-input", sourceType: "MANUAL" as const } : { source: "greenhouse", sourceType: "ATS" as const, externalId: `${tag}-${opportunity.id}` }),
        createdAt: at(1),
        discoveredAt: at(1),
        sourceMetadata: { e2ePersonal: tag },
      },
    });
    return opportunity.id;
  };
  const apply = async (opportunityId: string, stage: "APPLIED" | "INTERVIEWING" | "CLOSED", day: number, extra: { outcome?: "REJECTED" | "OFFER_ACCEPTED"; reached?: string[]; screen?: boolean } = {}) => {
    const application = await database.application.create({
      data: { opportunityId, stage, outcome: extra.outcome ?? null, appliedOn: date(day), closedOn: stage === "CLOSED" ? date(day + 10) : null },
    });
    let sequence = 0;
    await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "SUBMITTED", occurredOn: date(day) } });
    for (const toStage of extra.reached ?? []) {
      await database.applicationEvent.create({ data: { applicationId: application.id, sequence: ++sequence, type: "STAGE_CHANGED", toStage: toStage as never, occurredOn: date(day + 3) } });
    }
    if (extra.screen) await database.applicationInterview.create({ data: { applicationId: application.id, kind: "RECRUITER_SCREEN", status: "COMPLETED", scheduledAt: at(day + 3) } });
  };
  const evaluate = async (opportunityId: string, decision: string, completedAt: Date, gaps: Array<[string, string]> = []) => {
    const evaluation = await database.evaluation.create({
      data: {
        opportunityId, domain, status: "COMPLETED", evaluationVersion: "e2e", domainVersion: "e2e", ruleVersion: "e2e", createdAt: completedAt, completedAt,
        domainResult: {
          hardFilters: { role: { classification: "CORE_CS" } },
          companyAlignment: { alignment: { customerSegment: { classification: "SMB" }, customerType: { classification: "B2C" } } },
          alexFit: { evaluated: true, fit: { classification: "GOOD" } },
          resumeMatch: {
            evaluated: true,
            band: "GOOD_HIGH",
            match: { requirementAssessments: gaps.map(([category, requirementText]) => ({ category, requirementText, strength: "REQUIRED", classification: "GENUINE_GAP", decisionImpact: "MATERIAL_UNCERTAINTY" })) },
          },
        },
      },
    });
    await database.recommendation.create({ data: { opportunityId, evaluationId: evaluation.id, decision, explanation: "seeded", evaluationVersion: "e2e" } });
    await database.semanticOperationAttempt.create({
      data: { evaluationId: evaluation.id, opportunityId, domain, operationId: "customer-success.resume-match", promptVersion: "cs-resume-match-v2", attempt: 1, provider: "openai", model: "e2e-personal", status: "SUCCESS", durationMs: 1, createdAt: completedAt },
    });
  };

  for (let index = 0; index < 5; index += 1) await apply(await job("Implementation Consultant", "ats"), "APPLIED", 3 + index);
  const interviewing = await job("Customer Success Manager", "ats");
  await evaluate(interviewing, "APPLY", at(2), [["TOOL", "Salesforce"]]);
  await apply(interviewing, "INTERVIEWING", 5, { reached: ["SCREENING", "INTERVIEWING"], screen: true });
  const sameDay = await job("Customer Success Manager", "ats");
  await evaluate(sameDay, "REVIEW", at(10, 15), [["TOOL", "Salesforce"]]);
  await apply(sameDay, "CLOSED", 10, { outcome: "REJECTED" });
  const offer = await job("Customer Success Lead", "manual");
  await apply(offer, "CLOSED", 12, { outcome: "OFFER_ACCEPTED", reached: ["SCREENING", "INTERVIEWING", "FINAL_ROUND", "OFFER"] });
  console.log(JSON.stringify({ domain }));
}

async function cleanup(tag: string) {
  await database.sourceRecord.deleteMany({ where: { sourceMetadata: { path: ["e2ePersonal"], equals: tag } } });
  await database.opportunity.deleteMany({ where: { domain: `e2e-personal-${tag}` } });
}

if (!token) throw new Error("usage: e2e-personal-helper <seed|cleanup> <token>");
if (command === "seed") await seed(token);
else if (command === "cleanup") await cleanup(token);
else throw new Error(`unknown command ${command}`);
await database.$disconnect();
