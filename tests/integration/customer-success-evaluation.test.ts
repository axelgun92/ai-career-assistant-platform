import {
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
} from "@ai-career/customer-success";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";

const database = getDatabaseClient();
const opportunityIds: string[] = [];
const userProfileIds: string[] = [];

afterEach(async () => {
  for (const id of opportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({
      where: { id },
      select: { companyId: true },
    });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    await database.opportunity.deleteMany({ where: { id } });
    if (opportunity?.companyId) {
      await database.company.deleteMany({ where: { id: opportunity.companyId } });
    }
  }
  await database.userProfile.deleteMany({
    where: { id: { in: userProfileIds.splice(0) } },
  });
});

afterAll(async () => {
  await database.$disconnect();
});

describe("Customer Success evaluation PostgreSQL integration", () => {
  it("runs a normalized manual JD and versioned profile through all seven CS stages", async () => {
    const manualService = createManualOpportunityService({
      repository: new PrismaManualOpportunityRepository(),
      normalizer: createManualOpportunityNormalizer(),
      clock: () => new Date("2026-08-17T12:00:00.000Z"),
    });
    const detail = await manualService.submit({
      domain: "customer-success",
      title: "Customer Support Manager",
      company: "Example Technology",
      location: "United States",
      compensationText: "$70,000-$90,000",
      sourceUrl: "https://example.test/customer-success-integration",
      rawText: [
        "This is a remote United States-only role working PST hours.",
        "Own customer adoption, success plans, retention, and business reviews.",
        "Collaborate with Product to share customer feedback.",
        "Use product analytics and collaborate with engineering on API integrations.",
        "We provide a subscription workflow platform to mid-market business customers.",
        "Join a team of six CSMs reporting to the VP of Customer Success.",
        "Coordinate escalations with Support, which owns technical resolution.",
        "3+ years of Customer Success experience required.",
        "Salesforce experience preferred.",
      ].join("\n"),
    });
    opportunityIds.push(detail.opportunity.id);
    const userProfile = await database.userProfile.create({
      data: {
        label: "Alex Customer Success profile",
        version: 3,
        careerGoals: [
          { id: "career-1", statement: "Build a strategic SaaS career." },
        ],
        experience: [
          {
            id: "experience-1",
            statement: "Owned customer onboarding, adoption, and retention.",
            relationship: "DIRECT",
          },
        ],
        skills: [
          { id: "skill-1", statement: "Customer education and enablement" },
        ],
        transferableSkills: [
          { id: "transfer-1", statement: "Process documentation" },
        ],
        workPreferences: [
          { id: "work-1", statement: "Prefers strategic, asynchronous work." },
        ],
      },
    });
    userProfileIds.push(userProfile.id);

    const fixture = createCustomerSuccessFixtureOperations({
      scenario: "misleading-title",
    });
    const result = await createEvaluationExecutor(
      new PrismaEvaluationRepository(),
    ).execute({
      opportunityId: detail.opportunity.id,
      userProfileId: userProfile.id,
      evaluator: createCustomerSuccessEvaluator(),
      domainData: createCustomerSuccessDomainData({
        preferences: customerSuccessTestPreferences,
        semanticOperations: fixture.semanticOperations,
      }),
      executionMetadata: { trigger: "milestone-seven-integration-test" },
    });

    const persisted = await database.evaluation.findUniqueOrThrow({
      where: { id: result.evaluation.id },
      include: {
        opportunity: { select: { status: true } },
        stageResults: { orderBy: { position: "asc" } },
        evidenceRecords: true,
        contradictions: true,
      },
    });

    expect(persisted).toEqual(
      expect.objectContaining({
        domain: "customer-success",
        status: "COMPLETED",
        evaluationVersion: "cs-evaluation-v1.1-m7",
        domainVersion: "customer-success-v1.1",
        ruleVersion: "cs-rules-v1.1",
        promptVersion: "cs-m7-prompts-v1",
        userProfileVersion: 3,
        executionMetadata: { trigger: "milestone-seven-integration-test" },
      }),
    );
    expect(persisted.opportunity.status).toBe("NORMALIZED");
    expect(persisted.stageResults.map((stage) => stage.stageId)).toEqual([
      "hard-filters",
      "job-evaluation",
      "company-alignment",
      "organizational-maturity",
      "alex-fit",
      "burnout-risk",
      "resume-match",
    ]);
    expect(persisted.stageResults.every((stage) => stage.status === "COMPLETED"))
      .toBe(true);
    expect(persisted.stageResults[0]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          role: expect.objectContaining({ classification: "CORE_CS" }),
          reconstruction: expect.objectContaining({
            responsibilityMap: expect.any(Object),
            requirements: expect.arrayContaining([
              expect.objectContaining({ strength: "REQUIRED" }),
              expect.objectContaining({ strength: "PREFERRED" }),
            ]),
            ownershipMap: expect.any(Object),
          }),
        }),
      }),
    );
    expect(persisted.stageResults[1]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          roleClassification: "CORE_CS",
        }),
      }),
    );
    expect(persisted.stageResults[2]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          alignment: expect.objectContaining({
            businessModel: expect.objectContaining({ classification: "SAAS" }),
            productType: expect.objectContaining({ classification: "WORKFLOW" }),
          }),
        }),
      }),
    );
    expect(persisted.stageResults[3]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          maturity: expect.objectContaining({
            score: 84,
            existingCustomerSuccessFunction: expect.objectContaining({
              classification: "ESTABLISHED",
            }),
          }),
        }),
      }),
    );
    expect(persisted.stageResults[4]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          fit: expect.objectContaining({ classification: "STRONG" }),
        }),
      }),
    );
    expect(persisted.stageResults[5]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          classification: "VERY_LOW",
          risk: expect.objectContaining({ score: 18 }),
        }),
      }),
    );
    expect(persisted.stageResults[6]?.result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluated: true,
          band: "VERY_STRONG_VERY_HIGH",
          match: expect.objectContaining({
            score: 82,
            effectiveSeniority: expect.objectContaining({
              effectiveLevelFit: "TARGET_LEVEL",
            }),
          }),
        }),
      }),
    );
    expect(persisted.evidenceRecords.length).toBeGreaterThan(0);
    expect(
      persisted.evidenceRecords.every(
        (record) =>
          (record.sourceRecordId === detail.sourceRecords[0]?.id ||
            (record.sourceType === "USER_PROFILE" &&
              record.sourceReference === `user-profile:${userProfile.id}:v3`)) &&
          record.stageId !== null,
      ),
    ).toBe(true);
    expect(result.domainResult?.jobEvaluation.evaluated).toBe(true);
    expect(result.domainResult?.companyAlignment.evaluated).toBe(true);
    expect(result.domainResult?.organizationalMaturity.evaluated).toBe(true);
    expect(result.domainResult?.alexFit.evaluated).toBe(true);
    expect(result.domainResult?.burnoutRisk.evaluated).toBe(true);
    expect(result.domainResult?.resumeMatch.evaluated).toBe(true);
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.jobEvaluationCalls).toBe(1);
    expect(fixture.stats.companyAlignmentCalls).toBe(1);
    expect(fixture.stats.organizationalMaturityCalls).toBe(1);
    expect(fixture.stats.alexFitCalls).toBe(1);
    expect(fixture.stats.burnoutRiskCalls).toBe(1);
    expect(fixture.stats.resumeMatchCalls).toBe(1);
  });
});
