import {
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  customerSuccessMilestoneEightResultSchema,
  customerSuccessRecommendationSchema,
  ghostJobRiskClassificationSchema,
  opportunityPriorityBand,
  opportunityPriorityBandSchema,
  postingAgePriority,
  postingTimingSchema,
  semanticGhostJobRiskSchema,
  semanticOpportunityPrioritySchema,
  type CustomerSuccessSemanticOperations,
} from "@ai-career/customer-success";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
  type AlexFitFixtureOptions,
  type BurnoutRiskFixtureOptions,
  type CustomerSuccessScenario,
  type GhostJobRiskFixtureOptions,
  type OpportunityPriorityFixtureOptions,
  type ResumeMatchFixtureOptions,
} from "../fixtures/customer-success";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

const evaluationDate = new Date("2026-08-17T12:00:00.000Z");
const defaultJobDescription = [
  "Remote - United States only. Salary $70,000-$90,000. No travel required.",
  "Own customer onboarding, adoption, education, retention, and business reviews.",
  "Collaborate with Product and hand technical escalations to Support.",
  "3-5 years of Customer Success experience required.",
  "Salesforce experience preferred.",
  "Customer education and enablement required.",
].join(" ");

type HistoryFact = {
  type:
    | "REPOSTED"
    | "UNCHANGED_OVER_TIME"
    | "EVERGREEN_LANGUAGE"
    | "FARMING_INDICATOR"
    | "CLOSED_ATS_VISIBLE_ELSEWHERE"
    | "RECURRING_IDENTICAL_REQUISITION"
    | "AGGREGATOR_VISIBILITY"
    | "ACTIVE_ATS"
    | "CURRENT_POSTING";
  description: string;
  occurredAt?: string | null;
};

function createProfile() {
  return {
    id: randomUUID(),
    version: 8,
    data: {
      label: "Alex Customer Success profile",
      careerGoals: [
        { id: "career-1", statement: "Build a strategic SaaS career." },
      ],
      experience: [
        {
          id: "experience-1",
          statement:
            "Owned customer onboarding, adoption, education, and retention.",
          relationship: "DIRECT",
        },
      ],
      skills: [
        { id: "skill-1", statement: "I do not have Salesforce experience." },
      ],
      transferableSkills: [
        {
          id: "transfer-1",
          statement:
            "International teaching, facilitation, and relationship management.",
        },
      ],
      locationPreferences: null,
      compensationPreferences: null,
      workPreferences: [
        { id: "work-1", statement: "Prefers strategic documented work." },
      ],
      companyPreferences: null,
      domainPreferences: null,
    },
  };
}

async function run(input?: {
  scenario?: CustomerSuccessScenario;
  rawText?: string;
  salaryText?: string;
  postingDate?: Date | null;
  history?: HistoryFact[];
  sourceName?: string;
  opportunityPriority?: OpportunityPriorityFixtureOptions;
  ghostJobRisk?: GhostJobRiskFixtureOptions;
  alexFit?: AlexFitFixtureOptions;
  burnoutRisk?: BurnoutRiskFixtureOptions;
  resumeMatch?: ResumeMatchFixtureOptions;
  failOpportunityPriorityOnce?: boolean;
  failGhostJobRiskOnce?: boolean;
  transformOperations?: (
    operations: CustomerSuccessSemanticOperations,
  ) => CustomerSuccessSemanticOperations;
}) {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: input?.scenario ?? "strong",
    opportunityPriority: input?.opportunityPriority,
    ghostJobRisk: input?.ghostJobRisk,
    alexFit: input?.alexFit,
    burnoutRisk: input?.burnoutRisk,
    resumeMatch: input?.resumeMatch,
    failOpportunityPriorityOnce: input?.failOpportunityPriorityOnce,
    failGhostJobRiskOnce: input?.failGhostJobRiskOnce,
  });
  const subject = createNeutralEvaluationSubject();
  subject.opportunity.domain = "customer-success";
  subject.opportunity.title = "Customer Success Manager";
  subject.opportunity.companyName = "Example Technology";
  subject.opportunity.industry = "Software";
  subject.opportunity.salaryText = input?.salaryText ?? "$70,000-$90,000";
  subject.opportunity.jobDescription = input?.rawText ?? defaultJobDescription;
  subject.opportunity.postingDate = input?.postingDate ?? null;
  subject.rawSources[0]!.source = input?.sourceName ?? "manual-input";
  subject.rawSources[0]!.rawDescription = subject.opportunity.jobDescription;
  subject.rawSources[0]!.rawPayload = {
    rawText: subject.opportunity.jobDescription,
    ...(input?.history ? { postingHistory: input.history } : {}),
  };
  subject.provenance[0]!.normalizedValue = subject.opportunity.jobDescription;
  subject.provenance[0]!.sourceText = subject.opportunity.jobDescription;
  if (subject.opportunity.postingDate) {
    subject.provenance.push({
      id: randomUUID(),
      sourceRecordId: subject.rawSources[0]!.id,
      fieldName: "postingDate",
      sourceField: "postingDate",
      kind: "DIRECT",
      normalizedValue: subject.opportunity.postingDate.toISOString(),
      sourceReference: subject.rawSources[0]!.sourceUrl,
      sourceText: subject.opportunity.postingDate.toISOString().slice(0, 10),
    });
  }
  subject.userProfile = createProfile();

  const repository = new InMemoryEvaluationRepository(subject);
  const executor = createEvaluationExecutor(repository);
  const evaluator = createCustomerSuccessEvaluator();
  const operations = input?.transformOperations
    ? input.transformOperations(fixture.semanticOperations)
    : fixture.semanticOperations;
  const domainData = createCustomerSuccessDomainData({
    preferences: customerSuccessTestPreferences,
    semanticOperations: operations,
    evaluationDate,
  });
  const result = await executor.execute({
    opportunityId: subject.opportunity.id,
    userProfileId: subject.userProfile.id,
    evaluator,
    domainData,
  });
  return { result, fixture, executor, evaluator, domainData };
}

describe("Customer Success Milestone 8 pipeline", () => {
  it("registers nine ordered stages and keeps final recommendation outside the stage list", async () => {
    const { result } = await run();
    expect(createCustomerSuccessEvaluator().stages.map((stage) => stage.id))
      .toEqual([
        "hard-filters",
        "job-evaluation",
        "company-alignment",
        "organizational-maturity",
        "alex-fit",
        "burnout-risk",
        "resume-match",
        "opportunity-priority",
        "ghost-job-risk",
      ]);
    expect(result.evaluation.stageResults).toHaveLength(9);
    expect(
      result.evaluation.stageResults.some(
        (stage) => stage.stageId === "final-recommendation",
      ),
    ).toBe(false);
    expect(result.domainResult?.recommendation).toBeDefined();
  });

  it("reuses prior validated assessments and does not create a second reconstruction", async () => {
    const { fixture } = await run();
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.opportunityPriorityReceivedValidatedInputs).toBe(true);
  });

  it("returns valid NOT_EVALUATED stages after a hard-filter failure", async () => {
    const { result, fixture } = await run({ scenario: "unrelated" });
    expect(result.domainResult!.opportunityPriority.evaluated).toBe(false);
    expect(result.domainResult!.ghostJobRisk.evaluated).toBe(false);
    expect(fixture.stats.opportunityPriorityCalls).toBe(0);
    expect(fixture.stats.ghostJobRiskCalls).toBe(0);
    expect(result.domainResult!.recommendation.recommendation).toBe("SKIP");
  });
});

describe("Customer Success Opportunity Priority", () => {
  it.each([
    [0, "HIGHEST_PRIORITY"],
    [3, "HIGHEST_PRIORITY"],
    [4, "STRONG_PRIORITY"],
    [7, "STRONG_PRIORITY"],
    [8, "GOOD_OPPORTUNITY"],
    [14, "GOOD_OPPORTUNITY"],
    [15, "REVIEW"],
    [21, "REVIEW"],
    [22, "CAUTION"],
    [90, "CAUTION"],
  ] as const)("maps posting age %i to %s", (age, expected) => {
    expect(postingAgePriority(age)).toBe(expected);
  });

  it.each([
    [0, "VERY_LOW"],
    [19, "VERY_LOW"],
    [20, "LOW"],
    [39, "LOW"],
    [40, "MIXED_MODERATE"],
    [59, "MIXED_MODERATE"],
    [60, "HIGH"],
    [79, "HIGH"],
    [80, "VERY_HIGH"],
    [100, "VERY_HIGH"],
  ] as const)("maps priority score %i to %s", (score, expected) => {
    expect(opportunityPriorityBand(score)).toBe(expected);
  });

  it.each([0, 3, 4, 7, 8, 14, 15, 21, 22])(
    "calculates the exact deterministic age boundary at %i days",
    async (ageDays) => {
      const postingDate = new Date(evaluationDate);
      postingDate.setUTCDate(postingDate.getUTCDate() - ageDays);
      const { result } = await run({ postingDate });
      const priority = result.domainResult!.opportunityPriority;
      expect(priority.evaluated && priority.timing.ageDays).toBe(ageDays);
      expect(priority.evaluated && priority.timing.classification).toBe(
        postingAgePriority(ageDays),
      );
    },
  );

  it("preserves missing and future posting dates as Unknown", async () => {
    const missing = await run();
    const future = await run({
      postingDate: new Date("2026-08-18T00:00:00.000Z"),
    });
    expect(
      missing.result.domainResult!.opportunityPriority.evaluated &&
        missing.result.domainResult!.opportunityPriority.timing,
    ).toEqual(expect.objectContaining({ ageDays: null, classification: "UNKNOWN" }));
    expect(
      future.result.domainResult!.opportunityPriority.evaluated &&
        future.result.domainResult!.opportunityPriority.timing,
    ).toEqual(expect.objectContaining({ ageDays: null, classification: "UNKNOWN" }));
    expect(
      missing.result.domainResult!.opportunityPriority.evaluated &&
        missing.result.domainResult!.opportunityPriority.priority.score,
    ).toBe(84);
  });

  it.each([0, 100])("accepts bounded priority score %i", async (score) => {
    const { result } = await run({ opportunityPriority: { score } });
    const priority = result.domainResult!.opportunityPriority;
    expect(priority.evaluated && priority.priority.score).toBe(score);
  });

  it("keeps application effort Unknown when the normalized source does not establish it", async () => {
    const { result } = await run();
    const priority = result.domainResult!.opportunityPriority;
    expect(
      priority.evaluated && priority.priority.applicationEffort.classification,
    ).toBe("UNKNOWN");
  });

  it.each([-1, 101, 72.5])("rejects invalid priority score %s", async (score) => {
    const { result } = await run({ opportunityPriority: { score } });
    expect(result.evaluation.stageResults[7]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("rejects priority supported by posting age alone", async () => {
    const { result } = await run({
      postingDate: new Date("2026-08-16T00:00:00.000Z"),
      transformOperations(base) {
        return {
          ...base,
          async evaluateOpportunityPriority(input) {
            const value = (await base.evaluateOpportunityPriority(input)) as Record<
              string,
              unknown
            >;
            return {
              ...value,
              scoreEvidenceReferences: ["opportunity-posting-date"],
            };
          },
        };
      },
    });
    expect(result.evaluation.stageResults[7]?.status).toBe("FAILED");
  });

  it("rejects nonexistent priority evidence", async () => {
    const { result } = await run({
      transformOperations(base) {
        return {
          ...base,
          async evaluateOpportunityPriority(input) {
            const value = (await base.evaluateOpportunityPriority(input)) as Record<
              string,
              unknown
            >;
            return { ...value, evidenceReferences: ["not-real"] };
          },
        };
      },
    });
    expect(result.evaluation.stageResults[7]?.status).toBe("FAILED");
  });

  it("requires score and strategic-value evidence", async () => {
    for (const field of [
      "scoreEvidenceReferences",
      "strategicValueEvidenceReferences",
    ] as const) {
      const { result } = await run({
        transformOperations(base) {
          return {
            ...base,
            async evaluateOpportunityPriority(input) {
              const value = (await base.evaluateOpportunityPriority(
                input,
              )) as Record<string, unknown>;
              return { ...value, [field]: [] };
            },
          };
        },
      });
      expect(result.evaluation.stageResults[7]?.status).toBe("FAILED");
      expect(result.domainResult).toBeNull();
    }
  });

  it("rejects unsupported timing classifications", () => {
    expect(
      postingTimingSchema.safeParse({
        postingDate: "2026-08-17",
        evaluationDate: "2026-08-17",
        ageDays: 0,
        classification: "FRESH",
        explanation: "Unsupported band.",
        evidenceReferences: ["posting"],
      }).success,
    ).toBe(false);
  });

  it("retries a temporary priority failure and preserves seven earlier stages", async () => {
    const initial = await run({ failOpportunityPriorityOnce: true });
    expect(
      initial.result.evaluation.stageResults
        .slice(0, 7)
        .every((stage) => stage.status === "COMPLETED"),
    ).toBe(true);
    expect(initial.result.evaluation.stageResults[7]?.status).toBe("FAILED");
    expect(initial.result.evaluation.stageResults[8]?.status).toBe("PENDING");
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "opportunity-priority",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults[7]?.attempt).toBe(2);
  });
});

describe("Customer Success Ghost Job Risk", () => {
  it("supports only the documented categorical values and no numeric risk score", () => {
    expect(ghostJobRiskClassificationSchema.options).toEqual([
      "LOW",
      "POSSIBLE",
      "ELEVATED",
      "HIGH",
      "UNKNOWN",
    ]);
    expect(semanticGhostJobRiskSchema.safeParse({ score: 50 }).success).toBe(
      false,
    );
  });

  it("returns Unknown without a semantic call when posting history is unavailable", async () => {
    const { result, fixture } = await run();
    const ghost = result.domainResult!.ghostJobRisk;
    expect(ghost.evaluated && ghost.risk.classification).toBe("UNKNOWN");
    expect(ghost.evaluated && ghost.objectiveFacts).toEqual([]);
    expect(fixture.stats.ghostJobRiskCalls).toBe(0);
  });

  it("does not treat an aggregator source or posting age alone as history evidence", async () => {
    const { result, fixture } = await run({
      sourceName: "public-aggregator",
      postingDate: new Date("2026-06-01T00:00:00.000Z"),
    });
    const ghost = result.domainResult!.ghostJobRisk;
    expect(ghost.evaluated && ghost.risk.classification).toBe("UNKNOWN");
    expect(fixture.stats.ghostJobRiskCalls).toBe(0);
  });

  it("does not treat aggregator visibility by itself as categorical risk", async () => {
    const { result } = await run({
      history: [
        {
          type: "AGGREGATOR_VISIBILITY",
          description: "The listing remains visible on an aggregator.",
        },
      ],
    });
    const ghost = result.domainResult!.ghostJobRisk;
    expect(ghost.evaluated && ghost.risk.classification).toBe("UNKNOWN");
  });

  it("supports Low only with explicit active or current status evidence", async () => {
    const { result } = await run({
      history: [
        {
          type: "ACTIVE_ATS",
          description: "The employer ATS reports the requisition as active.",
        },
      ],
    });
    const ghost = result.domainResult!.ghostJobRisk;
    expect(ghost.evaluated && ghost.risk.classification).toBe("LOW");
  });

  it("rejects one repost or evergreen phrase as sufficient categorical risk", async () => {
    for (const type of ["REPOSTED", "EVERGREEN_LANGUAGE"] as const) {
      const { result } = await run({
        history: [{ type, description: `Single ${type} observation.` }],
      });
      expect(result.evaluation.stageResults[8]).toEqual(
        expect.objectContaining({
          status: "FAILED",
          failureCode: "STRUCTURED_OUTPUT_INVALID",
        }),
      );
    }
  });

  it.each(["ELEVATED", "HIGH"] as const)(
    "rejects %s when only one repost exists",
    async (classification) => {
      const { result } = await run({
        history: [
          { type: "REPOSTED", description: "The listing was reposted once." },
        ],
        ghostJobRisk: { classification },
      });
      expect(result.evaluation.stageResults[8]?.status).toBe("FAILED");
      expect(result.domainResult).toBeNull();
    },
  );

  it.each(["POSSIBLE", "ELEVATED", "HIGH"] as const)(
    "supports %s only from multiple objective risk facts",
    async (classification) => {
      const { result } = await run({
        history: [
          { type: "REPOSTED", description: "The listing was reposted." },
          {
            type: "UNCHANGED_OVER_TIME",
            description: "The description remained unchanged for months.",
          },
        ],
        ghostJobRisk: { classification },
      });
      const ghost = result.domainResult!.ghostJobRisk;
      expect(ghost.evaluated && ghost.risk.classification).toBe(classification);
      expect(ghost.evaluated && ghost.objectiveFacts).toHaveLength(2);
      expect(
        ghost.evaluated && ghost.objectiveFacts[0]?.description,
      ).not.toBe(ghost.evaluated && ghost.risk.interpretation);
    },
  );

  it("recognizes a closed ATS listing still visible elsewhere as compound history evidence", async () => {
    const { result } = await run({
      history: [
        {
          type: "CLOSED_ATS_VISIBLE_ELSEWHERE",
          description:
            "The employer ATS reports the requisition closed while an aggregator still displays it.",
        },
      ],
      ghostJobRisk: { classification: "POSSIBLE" },
    });
    const ghost = result.domainResult!.ghostJobRisk;
    expect(ghost.evaluated && ghost.risk.classification).toBe("POSSIBLE");
  });

  it("preserves conflicting active and risk history", async () => {
    const { result } = await run({
      history: [
        { type: "REPOSTED", description: "The listing was reposted." },
        {
          type: "UNCHANGED_OVER_TIME",
          description: "The description was unchanged for months.",
        },
        {
          type: "ACTIVE_ATS",
          description: "The employer ATS currently reports the role as active.",
        },
      ],
      ghostJobRisk: {
        classification: "ELEVATED",
        contradictoryHistory: true,
      },
    });
    expect(
      result.evaluation.contradictions.some(
        (item) =>
          item.stageId === "ghost-job-risk" &&
          item.relevantField === "ghostJobRisk",
      ),
    ).toBe(true);
  });

  it("rejects nonexistent Ghost Job Risk evidence", async () => {
    const { result } = await run({
      history: [
        { type: "REPOSTED", description: "The listing was reposted." },
        {
          type: "UNCHANGED_OVER_TIME",
          description: "The description was unchanged for months.",
        },
      ],
      transformOperations(base) {
        return {
          ...base,
          async evaluateGhostJobRisk(input) {
            const value = (await base.evaluateGhostJobRisk(input)) as Record<
              string,
              unknown
            >;
            return { ...value, evidenceReferences: ["not-real"] };
          },
        };
      },
    });
    expect(result.evaluation.stageResults[8]?.status).toBe("FAILED");
  });

  it("retries a temporary Ghost Job Risk failure and preserves eight earlier stages", async () => {
    const initial = await run({
      history: [
        { type: "REPOSTED", description: "The listing was reposted." },
        {
          type: "UNCHANGED_OVER_TIME",
          description: "The description was unchanged for months.",
        },
      ],
      failGhostJobRiskOnce: true,
    });
    expect(
      initial.result.evaluation.stageResults
        .slice(0, 8)
        .every((stage) => stage.status === "COMPLETED"),
    ).toBe(true);
    expect(initial.result.evaluation.stageResults[8]?.status).toBe("FAILED");
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "ghost-job-risk",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults[8]?.attempt).toBe(2);
  });
});

describe("Customer Success final recommendation precedence", () => {
  it("recommends Apply for a strong eligible role even when Ghost Job Risk is Unknown", async () => {
    const { result } = await run();
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("does not let an old posting automatically prevent Apply", async () => {
    const { result } = await run({
      postingDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(
      result.domainResult!.opportunityPriority.evaluated &&
        result.domainResult!.opportunityPriority.timing.classification,
    ).toBe("CAUTION");
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("keeps a reasonable Stretch eligible for Apply", async () => {
    const { result } = await run({
      resumeMatch: { effectiveLevelFit: "STRETCH", score: 68 },
    });
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("applies hard-failure precedence even when the remaining fixture evidence is strong", async () => {
    const { result } = await run({ scenario: "unrelated" });
    expect(result.domainResult!.recommendation.recommendation).toBe("SKIP");
    expect(result.domainResult!.recommendation.precedenceReasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/hard filter/i)]),
    );
  });

  it("recommends Skip for Above Level, Very High burnout, or a decisive required Genuine Gap", async () => {
    const above = await run({
      resumeMatch: { effectiveLevelFit: "ABOVE_LEVEL" },
    });
    const burnout = await run({ burnoutRisk: { score: 90 } });
    const gap = await run({
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "UNKNOWN", "UNKNOWN"],
        decisionImpacts: [
          "DECISIVE_DISQUALIFIER",
          "NON_DECISIVE",
          "NON_DECISIVE",
        ],
      },
    });
    expect(above.result.domainResult!.recommendation.recommendation).toBe(
      "SKIP",
    );
    expect(burnout.result.domainResult!.recommendation.recommendation).toBe(
      "SKIP",
    );
    expect(gap.result.domainResult!.recommendation.recommendation).toBe("SKIP");
  });

  it("uses Review when a required Genuine Gap has unresolved material importance", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "UNKNOWN", "UNKNOWN"],
        decisionImpacts: [
          "MATERIAL_UNCERTAINTY",
          "NON_DECISIVE",
          "NON_DECISIVE",
        ],
      },
    });
    expect(result.domainResult!.recommendation.recommendation).toBe("REVIEW");
    expect(result.domainResult!.recommendation.precedenceReasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/materially unresolved/i)]),
    );
  });

  it("does not automatically Skip for a preferred Genuine Gap", async () => {
    const { result } = await run({
      rawText: defaultJobDescription.replace(
        "No travel required.",
        "Zero travel.",
      ),
      resumeMatch: {
        requirementClassifications: [
          "STRONG_MATCH",
          "GENUINE_GAP",
          "UNKNOWN",
        ],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated && resume.match.requirementAssessments[1],
    ).toEqual(
      expect.objectContaining({
        strength: "PREFERRED",
        classification: "GENUINE_GAP",
        decisionImpact: "NON_DECISIVE",
      }),
    );
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("does not treat a Transferable Match as a Genuine Gap", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: [
          "TRANSFERABLE_MATCH",
          "UNKNOWN",
          "UNKNOWN",
        ],
        matchedExperienceSpecificities: [
          "TRANSFERABLE",
          "UNKNOWN",
          "UNKNOWN",
        ],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated && resume.match.requirementAssessments[0],
    ).toEqual(
      expect.objectContaining({
        classification: "TRANSFERABLE_MATCH",
        matchedExperienceSpecificity: "TRANSFERABLE",
        decisionImpact: "NON_DECISIVE",
      }),
    );
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("does not let one non-decisive required Genuine Gap override the complete evaluation", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "UNKNOWN", "UNKNOWN"],
        decisionImpacts: [
          "NON_DECISIVE",
          "NON_DECISIVE",
          "NON_DECISIVE",
        ],
      },
    });
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("uses Review when contradiction evidence undermines an otherwise decisive gap", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: ["GENUINE_GAP", "UNKNOWN", "UNKNOWN"],
        decisionImpacts: [
          "DECISIVE_DISQUALIFIER",
          "NON_DECISIVE",
          "NON_DECISIVE",
        ],
        contradiction: "INFLATED_YEARS",
      },
    });
    expect(result.domainResult!.recommendation.recommendation).toBe("REVIEW");
  });

  it("uses Review for a borderline hard filter or supported posting-history concern", async () => {
    const salary = await run({
      salaryText: "$57,000-$59,000",
      rawText: defaultJobDescription.replace(
        "$70,000-$90,000",
        "$57,000-$59,000",
      ),
    });
    const ghost = await run({
      history: [
        { type: "REPOSTED", description: "The listing was reposted." },
        {
          type: "UNCHANGED_OVER_TIME",
          description: "The listing was unchanged for months.",
        },
      ],
      ghostJobRisk: { classification: "POSSIBLE" },
    });
    expect(salary.result.domainResult!.recommendation.recommendation).toBe(
      "REVIEW",
    );
    expect(ghost.result.domainResult!.recommendation.recommendation).toBe(
      "REVIEW",
    );
  });

  it("uses Review for ambiguous decisive location or material seniority contradiction", async () => {
    const location = await run({
      rawText: defaultJobDescription.replace(
        "Remote - United States only.",
        "Remote.",
      ),
    });
    const seniority = await run({
      resumeMatch: { contradiction: "INFLATED_YEARS" },
    });
    expect(location.result.domainResult!.recommendation.recommendation).toBe(
      "REVIEW",
    );
    expect(seniority.result.domainResult!.recommendation.recommendation).toBe(
      "REVIEW",
    );
  });

  it("uses Skip for deterministic salary and location failures", async () => {
    const salary = await run({
      salaryText: "$50,000",
      rawText: defaultJobDescription.replace(
        "$70,000-$90,000",
        "$50,000",
      ),
    });
    const location = await run({
      rawText: defaultJobDescription.replace(
        "Remote - United States only.",
        "Remote; candidates must reside in Canada.",
      ),
    });
    expect(salary.result.domainResult!.recommendation.recommendation).toBe(
      "SKIP",
    );
    expect(location.result.domainResult!.recommendation.recommendation).toBe(
      "SKIP",
    );
  });

  it("does not convert a controlled low-priority score into an automatic Skip", async () => {
    const { result } = await run({ opportunityPriority: { score: 0 } });
    expect(result.domainResult!.opportunityPriority).toEqual(
      expect.objectContaining({ evaluated: true, band: "VERY_LOW" }),
    );
    expect(result.domainResult!.recommendation.recommendation).toBe("APPLY");
  });

  it("does not turn one low soft preference into an automatic Skip", async () => {
    const { result } = await run({ alexFit: { classification: "LOW" } });
    expect(result.domainResult!.recommendation.recommendation).toBe("REVIEW");
    expect(result.domainResult!.recommendation.recommendation).not.toBe("SKIP");
  });

  it("produces evidence-backed aggregation without Overall Match or overallScore", async () => {
    const { result } = await run();
    const domainResult = result.domainResult!;
    expect(customerSuccessMilestoneEightResultSchema.parse(domainResult)).toEqual(
      domainResult,
    );
    expect(domainResult.strengths.length).toBeGreaterThan(0);
    expect(domainResult.unknowns.some((item) => item.code.includes("posting")))
      .toBe(true);
    expect(domainResult.evidenceReferences.length).toBeGreaterThan(0);
    expect("overallScore" in domainResult).toBe(false);
    expect("overallMatch" in domainResult).toBe(false);
    expect(opportunityPriorityBandSchema.safeParse("OVERALL_MATCH").success).toBe(
      false,
    );
  });

  it("rejects missing required semantic result fields and unsupported classifications", () => {
    expect(semanticOpportunityPrioritySchema.safeParse({ score: 80 }).success)
      .toBe(false);
    expect(
      semanticGhostJobRiskSchema.safeParse({
        classification: "SUSPICIOUS",
        assessment: "Unsupported",
      }).success,
    ).toBe(false);
    expect(
      customerSuccessRecommendationSchema.safeParse({
        recommendation: "MAYBE",
      }).success,
    ).toBe(false);
  });
});
