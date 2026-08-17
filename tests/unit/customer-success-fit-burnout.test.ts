import {
  alexFitClassificationSchema,
  alexFitDataSchema,
  burnoutRiskBand,
  burnoutRiskDataSchema,
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  customerSuccessUserProfileDataSchema,
  semanticAlexFitSchema,
  semanticBurnoutRiskSchema,
  type CustomerSuccessSemanticOperations,
  type CustomerSuccessPreferences,
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
  type OrganizationalMaturityFixtureOptions,
} from "../fixtures/customer-success";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

function createProfile() {
  return {
    id: randomUUID(),
    version: 3,
    data: {
      label: "Alex Customer Success profile",
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
      locationPreferences: null,
      compensationPreferences: null,
      workPreferences: [
        { id: "work-1", statement: "Prefers strategic, asynchronous work." },
      ],
      companyPreferences: null,
      domainPreferences: null,
    },
  };
}

async function run(input?: {
  alexFit?: AlexFitFixtureOptions;
  burnoutRisk?: BurnoutRiskFixtureOptions;
  failAlexFitOnce?: boolean;
  failBurnoutRiskOnce?: boolean;
  operations?: CustomerSuccessSemanticOperations;
  withProfile?: boolean;
  scenario?: CustomerSuccessScenario;
  organizationalMaturity?: OrganizationalMaturityFixtureOptions;
  preferences?: CustomerSuccessPreferences;
}) {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: input?.scenario ?? "strong",
    organizationalMaturity: input?.organizationalMaturity,
    alexFit: input?.alexFit,
    burnoutRisk: input?.burnoutRisk,
    failAlexFitOnce: input?.failAlexFitOnce,
    failBurnoutRiskOnce: input?.failBurnoutRiskOnce,
  });
  const subject = createNeutralEvaluationSubject();
  subject.opportunity.domain = "customer-success";
  subject.opportunity.title = "Customer Success Manager";
  subject.opportunity.companyName = "Example Technology";
  subject.opportunity.industry = "Software";
  subject.opportunity.salaryText = "$70,000-$90,000";
  subject.opportunity.jobDescription = [
    "Remote - United States only. Salary $70,000-$90,000.",
    "Own onboarding, adoption, education, retention, and business reviews.",
    "Collaborate with Product and hand technical escalations to Support.",
  ].join(" ");
  subject.rawSources[0]!.rawDescription = subject.opportunity.jobDescription;
  subject.rawSources[0]!.rawPayload = {
    rawText: subject.opportunity.jobDescription,
  };
  subject.provenance[0]!.normalizedValue = subject.opportunity.jobDescription;
  subject.provenance[0]!.sourceText = subject.opportunity.jobDescription;
  if (input?.withProfile !== false) subject.userProfile = createProfile();

  const repository = new InMemoryEvaluationRepository(subject);
  const executor = createEvaluationExecutor(repository);
  const evaluator = createCustomerSuccessEvaluator();
  const domainData = createCustomerSuccessDomainData({
    preferences: input?.preferences ?? customerSuccessTestPreferences,
    semanticOperations: input?.operations ?? fixture.semanticOperations,
  });
  const result = await executor.execute({
    opportunityId: subject.opportunity.id,
    userProfileId: subject.userProfile?.id,
    evaluator,
    domainData,
  });
  return { result, fixture, executor, evaluator, domainData };
}

describe("Customer Success Alex Fit", () => {
  it("uses the documented categorical vocabulary and no numerical fit score", async () => {
    expect(alexFitClassificationSchema.options).toEqual([
      "STRONG",
      "GOOD",
      "MIXED",
      "LOW",
    ]);
    const { result } = await run({ alexFit: { classification: "GOOD" } });
    expect(result.domainResult?.alexFit).toEqual(
      expect.objectContaining({
        evaluated: true,
        fit: expect.objectContaining({ classification: "GOOD" }),
      }),
    );
    expect(JSON.stringify(result.domainResult?.alexFit)).not.toMatch(
      /overallScore|overallMatch|fitScore/,
    );
  });

  it.each(["STRONG", "GOOD", "MIXED", "LOW"] as const)(
    "accepts the evidence-backed %s fit category",
    async (classification) => {
      const { result } = await run({ alexFit: { classification } });
      const fit = result.domainResult!.alexFit;
      expect(fit.evaluated && fit.fit.classification).toBe(classification);
      expect(fit.evaluated && fit.fit.evidenceReferences.length).toBeGreaterThan(
        0,
      );
    },
  );

  it("supports Strong fit with prominent preferred responsibility evidence", async () => {
    const { result } = await run({ alexFit: { classification: "STRONG" } });
    expect(
      result.domainResult!.hardFilters.reconstruction.responsibilityMap.areas
        .adoption.prominence,
    ).toBe("PRIMARY");
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.classification).toBe("STRONG");
  });

  it("does not turn one occasional preferred term into Strong fit", async () => {
    const { result } = await run({ alexFit: { preferredKeywordOnly: true } });
    expect(
      result.domainResult!.hardFilters.reconstruction.responsibilityMap.areas
        .adoption.prominence,
    ).toBe("OCCASIONAL");
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.classification).toBe("MIXED");
  });

  it("preserves a Mixed fit with both strengths and supported concerns", async () => {
    const { result } = await run({
      alexFit: { classification: "MIXED", workingStyleConcern: true },
    });
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.strongestMatches.length).toBeGreaterThan(0);
    expect(fit.evaluated && fit.fit.concerns.length).toBeGreaterThan(0);
  });

  it("supports Low fit when reactive support dominates and the concern is evidenced", async () => {
    const { result } = await run({
      scenario: "support-heavy",
      alexFit: { classification: "LOW", workingStyleConcern: true },
    });
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.classification).toBe("LOW");
    expect(fit.evaluated && fit.fit.concerns[0]?.evidenceReferences).toContain(
      "workload-risk",
    );
  });

  it.each(["DIRECT", "RELATED", "TRANSFERABLE"] as const)(
    "preserves the %s experience relationship",
    async (relationship) => {
      const { result } = await run({
        alexFit: { experienceRelationship: relationship },
      });
      const alexFit = result.domainResult!.alexFit;
      expect(
        alexFit.evaluated && alexFit.fit.experienceAlignment.relationship,
      ).toBe(relationship);
    },
  );

  it("uses the versioned profile, prior results, and reconstructed maps once", async () => {
    const { result, fixture } = await run();
    expect(result.evaluation.userProfileVersion).toBe(3);
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.alexFitReceivedProfileAndPriorResults).toBe(true);
    expect(
      result.evaluation.evidenceRecords.some(
        (item) =>
          item.sourceType === "USER_PROFILE" &&
          item.sourceReference?.endsWith(":v3"),
      ),
    ).toBe(true);
  });

  it("keeps missing working-style information Unknown", async () => {
    const { result } = await run({
      alexFit: { missingWorkingStyleInformation: true },
    });
    const alexFit = result.domainResult!.alexFit;
    expect(alexFit.evaluated && alexFit.fit.workingStyleAlignment[0]).toEqual(
      expect.objectContaining({ alignment: "UNKNOWN", evidenceReferences: [] }),
    );
    expect(alexFit.evaluated && alexFit.fit.unknowns[0]?.code).toBe(
      "meeting-cadence-unknown",
    );
  });

  it("does not infer asynchronous work merely from a remote arrangement", async () => {
    const { result } = await run({
      alexFit: { missingWorkingStyleInformation: true },
    });
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.workingStyleAlignment).toEqual([
      expect.objectContaining({ alignment: "UNKNOWN" }),
    ]);
  });

  it("does not treat moderate commercial or analytical CS work as automatic low fit", async () => {
    const { result } = await run({
      scenario: "sales-heavy",
      alexFit: { classification: "GOOD" },
    });
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.classification).toBe("GOOD");
    expect(fit.evaluated && fit.fit.concerns).toHaveLength(0);
  });

  it("does not infer a call-center environment from ordinary customer communication", async () => {
    const { result } = await run({
      alexFit: { classification: "GOOD", customerCallsOnly: true },
    });
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.concerns).toHaveLength(0);
    expect(fit.evaluated && fit.fit.summary).not.toContain("call-center");
  });

  it("lets typed preferences change semantic fit interpretation without evaluator changes", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const preferenceAware: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateAlexFit(input) {
        const value = (await fixture.semanticOperations.evaluateAlexFit(
          input,
        )) as Record<string, unknown>;
        return {
          ...value,
          classification: input.preferences.fitPreferences.preferredAreas.includes(
            "ADOPTION",
          )
            ? "STRONG"
            : "MIXED",
        };
      },
    };
    const changedPreferences: CustomerSuccessPreferences = {
      ...customerSuccessTestPreferences,
      fitPreferences: {
        ...customerSuccessTestPreferences.fitPreferences,
        preferredAreas:
          customerSuccessTestPreferences.fitPreferences.preferredAreas.filter(
            (area) => area !== "ADOPTION",
          ),
      },
    };
    const { result } = await run({
      operations: preferenceAware,
      preferences: changedPreferences,
    });
    const fit = result.domainResult!.alexFit;
    expect(fit.evaluated && fit.fit.classification).toBe("MIXED");
  });

  it("does not evaluate personalized fit without a user profile", async () => {
    const { result, fixture } = await run({ withProfile: false });
    expect(result.domainResult?.alexFit).toEqual({
      evaluated: false,
      reason:
        "Alex Fit was not performed because no versioned user profile was supplied.",
    });
    expect(fixture.stats.alexFitCalls).toBe(0);
    expect(result.domainResult?.burnoutRisk.evaluated).toBe(true);
  });

  it("validates the structured user profile rather than inventing missing fields", () => {
    expect(() =>
      customerSuccessUserProfileDataSchema.parse({ label: "Incomplete" }),
    ).toThrow();
  });

  it("rejects nonexistent evidence references", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateAlexFit(input) {
        const value = (await fixture.semanticOperations.evaluateAlexFit(
          input,
        )) as Record<string, unknown>;
        return { ...value, evidenceReferences: ["not-real"] };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "FAILED",
      "PENDING",
    ]);
  });

  it("retries a transient Alex Fit failure and preserves four earlier stages", async () => {
    const initial = await run({ failAlexFitOnce: true });
    expect(initial.result.evaluation.stageResults.map((stage) => stage.status))
      .toEqual([
        "COMPLETED",
        "COMPLETED",
        "COMPLETED",
        "COMPLETED",
        "FAILED",
        "PENDING",
      ]);
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "alex-fit",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults[4]?.attempt).toBe(2);
    expect(initial.fixture.stats.alexFitCalls).toBe(2);
  });

  it("preserves contradictory fit evidence", async () => {
    const { result } = await run({
      alexFit: { contradictoryFitEvidence: true },
    });
    expect(
      result.evaluation.contradictions.some(
        (item) => item.relevantField === "workingStyle",
      ),
    ).toBe(true);
  });
});

describe("Customer Success Burnout Risk", () => {
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
  ] as const)("maps holistic score %i to %s", async (score, classification) => {
    expect(burnoutRiskBand(score)).toBe(classification);
    const { result } = await run({ burnoutRisk: { score } });
    expect(result.domainResult?.burnoutRisk).toEqual(
      expect.objectContaining({ evaluated: true, classification }),
    );
  });

  it.each([-1, 101, 20.5])("rejects invalid burnout score %s", (score) => {
    expect(() =>
      semanticBurnoutRiskSchema.parse({
        score,
        scoreExplanation: "Holistic assessment.",
        scoreEvidenceReferences: ["evidence"],
        summary: "Summary.",
        majorContributors: [],
        positiveIndicators: [],
        unknowns: [],
        evidenceReferences: ["evidence"],
        contradictions: [],
      }),
    ).toThrow();
  });

  it("does not penalize a coherent combination of complementary CS work", async () => {
    const { result } = await run({
      burnoutRisk: { complementaryCustomerSuccessScope: true, score: 18 },
    });
    const burnout = result.domainResult!.burnoutRisk;
    expect(burnout.evaluated && burnout.classification).toBe("VERY_LOW");
    expect(burnout.evaluated && burnout.risk.majorContributors).toHaveLength(0);
    expect(burnout.evaluated && burnout.risk.positiveIndicators[0]?.finding)
      .toContain("coherent Customer Success workload");
  });

  it("uses collaboration and supported handoffs as workload context, not ownership", async () => {
    const { result } = await run({ burnoutRisk: { score: 18 } });
    const reconstruction = result.domainResult!.hardFilters.reconstruction;
    expect(reconstruction.ownershipMap.functions.product?.relationship).toBe(
      "COLLABORATES",
    );
    const maturity = result.domainResult!.organizationalMaturity;
    expect(
      maturity.evaluated &&
        maturity.maturity.ownershipAndCrossFunctionalDesign.handoffs.conclusion,
    ).toContain("Support handoff");
    expect(result.domainResult!.burnoutRisk).toEqual(
      expect.objectContaining({ classification: "VERY_LOW" }),
    );
  });

  it("raises risk only when evidence supports substantial distinct-function ownership", async () => {
    const { result } = await run({
      burnoutRisk: {
        substantialDistinctFunctionOwnership: true,
        score: 82,
      },
    });
    const burnout = result.domainResult!.burnoutRisk;
    expect(burnout.evaluated && burnout.classification).toBe("VERY_HIGH");
    expect(burnout.evaluated && burnout.risk.majorContributors[0]?.finding)
      .toContain("multiple distinct functions");
  });

  it("does not treat generic fast-paced language as independent risk evidence", async () => {
    const { result } = await run({
      burnoutRisk: { genericPhrasesOnly: true, score: 25 },
    });
    const burnout = result.domainResult!.burnoutRisk;
    expect(burnout.evaluated && burnout.risk.majorContributors).toHaveLength(0);
    expect(burnout.evaluated && burnout.risk.unknowns[0]?.code).toBe(
      "workload-details-unknown",
    );
  });

  it.each([
    ["EMERGING", 30],
    ["BUILDING_FROM_SCRATCH", 35],
  ] as const)(
    "does not mechanically convert %s maturity into high burnout risk",
    async (existingFunction, score) => {
      const { result } = await run({
        organizationalMaturity: { existingFunction, score: 34 },
        burnoutRisk: { score },
      });
      const burnout = result.domainResult!.burnoutRisk;
      expect(burnout.evaluated && burnout.classification).toBe("LOW");
    },
  );

  it("keeps unstated workload dimensions Unknown instead of converting them to zero", async () => {
    const { result } = await run({
      burnoutRisk: { genericPhrasesOnly: true, score: 25 },
    });
    const burnout = result.domainResult!.burnoutRisk;
    expect(burnout.evaluated && burnout.risk.score).toBe(25);
    expect(burnout.evaluated && burnout.risk.unknowns).not.toHaveLength(0);
  });

  it("receives maps and earlier validated results without another reconstruction", async () => {
    const { fixture } = await run();
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.burnoutRiskReceivedMapsAndPriorResults).toBe(true);
  });

  it("rejects nonexistent burnout evidence while keeping five earlier stages", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateBurnoutRisk(input) {
        const value = (await fixture.semanticOperations.evaluateBurnoutRisk(
          input,
        )) as Record<string, unknown>;
        return { ...value, evidenceReferences: ["not-real"] };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "FAILED",
    ]);
  });

  it("rejects an invalid semantic score through the stage validation boundary", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateBurnoutRisk(input) {
        const value = (await fixture.semanticOperations.evaluateBurnoutRisk(
          input,
        )) as Record<string, unknown>;
        return { ...value, score: 101 };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "FAILED",
    ]);
  });

  it("retries a transient Burnout Risk failure without corrupting prior results", async () => {
    const initial = await run({ failBurnoutRiskOnce: true });
    expect(initial.result.evaluation.stageResults[5]?.status).toBe("FAILED");
    expect(
      initial.result.evaluation.stageResults
        .slice(0, 5)
        .every((stage) => stage.status === "COMPLETED"),
    ).toBe(true);
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "burnout-risk",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults[5]?.attempt).toBe(2);
  });

  it("preserves contradictory workload evidence", async () => {
    const { result } = await run({
      burnoutRisk: { contradictoryWorkloadEvidence: true },
    });
    expect(
      result.evaluation.contradictions.some(
        (item) => item.relevantField === "workloadScope",
      ),
    ).toBe(true);
  });

  it("rejects missing required result fields and unsupported classifications", () => {
    expect(() => semanticAlexFitSchema.parse({ classification: "STRONG" }))
      .toThrow();
    expect(() =>
      alexFitDataSchema.parse({
        evaluated: true,
        fit: { classification: "EXCELLENT" },
      }),
    ).toThrow();
    expect(() =>
      burnoutRiskDataSchema.parse({
        evaluated: true,
        classification: "EXTREME",
        risk: {},
      }),
    ).toThrow();
  });

  it("contains no unsupported culture or employee-satisfaction conclusion", async () => {
    const { result } = await run();
    expect(JSON.stringify(result.domainResult!.burnoutRisk)).not.toMatch(
      /culture|employee satisfaction|management quality|personal resilience/i,
    );
  });
});
