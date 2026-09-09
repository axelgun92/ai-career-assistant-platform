import {
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  createSemanticResumeMatchTransportSchema,
  effectiveLevelFitSchema,
  requirementMatchClassificationSchema,
  resumeMatchBand,
  semanticResumeMatchFromTransport,
  semanticResumeMatchRequirementsForProvider,
  semanticResumeMatchSchema,
  type CustomerSuccessSemanticOperations,
  type SemanticResumeMatch,
} from "@ai-career/customer-success";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
  toResumeMatchProviderTransport,
  type CustomerSuccessScenario,
  type ResumeMatchFixtureOptions,
} from "../fixtures/customer-success";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

const defaultJobDescription = [
  "Remote - United States only. Salary $70,000-$90,000.",
  "Own customer onboarding, adoption, education, retention, and business reviews.",
  "Collaborate with Product and hand technical escalations to Support.",
  "3-5 years of Customer Success experience required.",
  "Salesforce experience preferred.",
  "Customer education and enablement required.",
].join(" ");

function createProfile(input?: { directStatement?: string }) {
  return {
    id: randomUUID(),
    version: 4,
    data: {
      label: "Alex Customer Success resume profile",
      careerGoals: [
        { id: "career-1", statement: "Build a strategic SaaS career." },
      ],
      experience: [
        {
          id: "experience-1",
          statement:
            input?.directStatement ??
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
            "International teaching, facilitation, cross-cultural communication, and relationship management.",
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
  resumeMatch?: ResumeMatchFixtureOptions;
  failResumeMatchOnce?: boolean;
  operations?: CustomerSuccessSemanticOperations;
  scenario?: CustomerSuccessScenario;
  rawText?: string;
  title?: string;
  withProfile?: boolean;
  directStatement?: string;
}) {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: input?.scenario ?? "strong",
    resumeMatch: input?.resumeMatch,
    failResumeMatchOnce: input?.failResumeMatchOnce,
  });
  const subject = createNeutralEvaluationSubject();
  subject.opportunity.domain = "customer-success";
  subject.opportunity.title = input?.title ?? "Customer Success Manager";
  subject.opportunity.companyName = "Example Technology";
  subject.opportunity.industry = "Software";
  subject.opportunity.salaryText = "$70,000-$90,000";
  subject.opportunity.jobDescription = input?.rawText ?? defaultJobDescription;
  subject.rawSources[0]!.rawDescription = subject.opportunity.jobDescription;
  subject.rawSources[0]!.rawPayload = {
    rawText: subject.opportunity.jobDescription,
  };
  subject.provenance[0]!.normalizedValue = subject.opportunity.jobDescription;
  subject.provenance[0]!.sourceText = subject.opportunity.jobDescription;
  if (input?.withProfile !== false) {
    subject.userProfile = createProfile({
      directStatement: input?.directStatement,
    });
  }

  const repository = new InMemoryEvaluationRepository(subject);
  const executor = createEvaluationExecutor(repository);
  const evaluator = createCustomerSuccessEvaluator();
  const domainData = createCustomerSuccessDomainData({
    preferences: customerSuccessTestPreferences,
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

async function runWithResumeMatchMutation(input: {
  mutate(value: SemanticResumeMatch): SemanticResumeMatch;
  rawText?: string;
}) {
  const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
  const operations: CustomerSuccessSemanticOperations = {
    ...fixture.semanticOperations,
    async evaluateResumeMatch(context) {
      const valid = semanticResumeMatchSchema.parse(
        await fixture.semanticOperations.evaluateResumeMatch(context),
      );
      return input.mutate(structuredClone(valid));
    },
  };
  const execution = await run({ operations, rawText: input.rawText });
  return { ...execution, semanticFixture: fixture };
}

describe("Customer Success Resume Match pipeline", () => {
  it("registers Resume Match as Stage 7 with Effective Seniority inside it", async () => {
    const { result } = await run();
    expect(
      createCustomerSuccessEvaluator().stages.map((stage) => stage.id),
    ).toEqual([
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
        (stage) => stage.stageId === "effective-seniority",
      ),
    ).toBe(false);
    const resumeMatch = result.domainResult!.resumeMatch;
    expect(resumeMatch.evaluated && resumeMatch.match.effectiveSeniority)
      .toBeDefined();
  });

  it("reuses the maps, versioned profile, prior results, and one reconstruction", async () => {
    const { result, fixture } = await run();
    expect(result.evaluation.userProfileVersion).toBe(4);
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.resumeMatchReceivedMapsProfileAndPriorResults).toBe(
      true,
    );
  });

  it("executes provider transport conversion through the complete stage and unchanged downstream contracts", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    let authoritativeRequirements: Array<{
      requirement: string;
      category: string;
      strength: string;
    }> = [];
    const operations: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        authoritativeRequirements = input.requirementMap;
        const providerRequirements =
          semanticResumeMatchRequirementsForProvider(input.requirementMap);
        const domain = await fixture.semanticOperations.evaluateResumeMatch({
          ...input,
          requirementMap: providerRequirements.map(
            ({ requirementIndex: _requirementIndex, ...requirement }) =>
              requirement,
          ),
        });
        const legacyTransport = toResumeMatchProviderTransport(
          domain,
          providerRequirements,
          input.availableEvidence,
        );
        const transport = {
          ...legacyTransport,
          requirementAssessments: legacyTransport.requirementAssessments.map((assessment) => {
            if ("decisionImpactEvidence" in assessment && assessment.decisionImpactEvidence) {
              const { decisionImpactEvidence, ...fields } = assessment;
              return { ...fields, decisionImpactEvidence: {
                jdEvidenceIndexes: decisionImpactEvidence.jdEvidenceReferences.map((reference) => assessment.jdEvidenceReferences.indexOf(reference)),
                profileEvidenceIndexes: decisionImpactEvidence.profileEvidenceReferences.map((reference) => assessment.profileEvidenceReferences.indexOf(reference)),
              } };
            }
            const { decisionImpactEvidenceReferences, ...fields } = assessment;
            const localEvidence = [...assessment.jdEvidenceReferences, ...assessment.profileEvidenceReferences];
            return { ...fields, decisionImpactEvidenceIndexes: (decisionImpactEvidenceReferences ?? []).map((reference) => localEvidence.indexOf(reference)) };
          }),
        };
        expect(createSemanticResumeMatchTransportSchema(input.availableEvidence, input.requirementMap).safeParse(transport).success).toBe(true);
        return semanticResumeMatchFromTransport(
          transport,
          input.requirementMap,
          input.availableEvidence,
        );
      },
    };

    const { result } = await run({
      operations,
      rawText: `3 years of experience. ${defaultJobDescription}`,
    });
    const resumeMatch = result.domainResult!.resumeMatch;

    expect(result.evaluation.stageResults[6]?.status).toBe("COMPLETED");
    expect(resumeMatch.evaluated).toBe(true);
    if (!resumeMatch.evaluated) throw new Error("Resume Match was not evaluated");
    expect(
      resumeMatch.match.requirementAssessments.map((assessment) => ({
        requirement: assessment.requirementText,
        category: assessment.category,
        strength: assessment.strength,
      })),
    ).toEqual(
      authoritativeRequirements.map((requirement) => ({
        requirement: requirement.requirement,
        category: requirement.category,
        strength: requirement.strength,
      })),
    );
    expect(resumeMatch.match.requirementAssessments[0]).toMatchObject({
      classification: "UNKNOWN",
      matchedExperienceSpecificity: "UNKNOWN",
      isAmbiguous: true,
      profileEvidenceReferences: [],
    });
    expect(
      resumeMatch.match.requirementAssessments.some(
        (assessment) =>
          !assessment.isAmbiguous && assessment.classification !== "UNKNOWN",
      ),
    ).toBe(true);
    expect(result.evaluation.stageResults[7]?.status).toBe("COMPLETED");
    expect(result.domainResult!.opportunityPriority.evaluated).toBe(true);
    expect(result.recommendation).not.toBeNull();
  });

  it("returns valid NOT_EVALUATED after a hard-filter failure", async () => {
    const { result, fixture } = await run({ scenario: "unrelated" });
    expect(result.domainResult!.resumeMatch).toEqual({
      evaluated: false,
      reason:
        "Resume Match was not performed because substantive evaluation did not continue.",
    });
    expect(fixture.stats.resumeMatchCalls).toBe(0);
  });

  it("does not evaluate without a versioned profile", async () => {
    const { result, fixture } = await run({ withProfile: false });
    expect(result.domainResult!.resumeMatch.evaluated).toBe(false);
    expect(fixture.stats.resumeMatchCalls).toBe(0);
  });

  it("preserves explicit stated-years ranges and open-ended requirements", async () => {
    const range = await run({
      rawText: `${defaultJobDescription} 7-10+ years of customer-facing experience preferred.`,
    });
    expect(range.result.domainResult!.hardFilters.reconstruction.requirements)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statedYears: 3,
            statedYearsMaximum: 5,
            statedYearsOpenEnded: false,
          }),
          expect.objectContaining({
            statedYears: 7,
            statedYearsMaximum: 10,
            statedYearsOpenEnded: true,
          }),
        ]),
      );
  });
});

describe("Customer Success requirement matching", () => {
  it("supports all documented requirement classifications", () => {
    expect(requirementMatchClassificationSchema.options).toEqual([
      "STRONG_MATCH",
      "TRANSFERABLE_MATCH",
      "PARTIAL_MATCH",
      "GENUINE_GAP",
      "UNKNOWN",
    ]);
  });

  it("records a Strong Match with separate JD and direct profile evidence", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: ["STRONG_MATCH", "UNKNOWN", "UNKNOWN"],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    const assessment = resume.evaluated
      ? resume.match.requirementAssessments[0]
      : undefined;
    expect(assessment).toEqual(
      expect.objectContaining({
        classification: "STRONG_MATCH",
        matchedExperienceSpecificity: "DIRECT_CUSTOMER_SUCCESS",
      }),
    );
    expect(assessment?.jdEvidenceReferences[0]).toMatch(/^requirement-/);
    expect(assessment?.profileEvidenceReferences[0]).toMatch(
      /^cs-profile-experience-/,
    );
  });

  it("preserves Transferable Match without manufacturing direct SaaS or CS experience", async () => {
    const { result } = await run({
      rawText:
        "Remote - United States only. Salary $70,000. Direct SaaS Customer Success experience required.",
      resumeMatch: {
        requirementClassifications: ["TRANSFERABLE_MATCH"],
        matchedExperienceSpecificities: ["TRANSFERABLE"],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    const assessment = resume.evaluated
      ? resume.match.requirementAssessments[0]
      : undefined;
    expect(assessment).toEqual(
      expect.objectContaining({
        classification: "TRANSFERABLE_MATCH",
        matchedExperienceSpecificity: "TRANSFERABLE",
      }),
    );
    expect(assessment?.profileEvidenceReferences[0]).toMatch(
      /^cs-profile-transferable-skills-/,
    );
  });

  it("does not manufacture direct Customer Success experience from transferable evidence", async () => {
    const { result } = await run({
      rawText:
        "Remote - United States only. Salary $70,000. Direct Customer Success experience required.",
      resumeMatch: {
        requirementClassifications: ["TRANSFERABLE_MATCH"],
        matchedExperienceSpecificities: ["TRANSFERABLE"],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    const assessment = resume.evaluated
      ? resume.match.requirementAssessments[0]
      : undefined;
    expect(assessment?.matchedExperienceSpecificity).toBe("TRANSFERABLE");
    expect(assessment?.matchedExperienceSpecificity).not.toBe(
      "DIRECT_CUSTOMER_SUCCESS",
    );
  });

  it("requires both supported and unsupported portions for Partial Match", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: ["PARTIAL_MATCH", "UNKNOWN", "UNKNOWN"],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    const assessment = resume.evaluated
      ? resume.match.requirementAssessments[0]
      : undefined;
    expect(assessment).toEqual(
      expect.objectContaining({
        classification: "PARTIAL_MATCH",
        supportedPortion: expect.any(String),
        unsupportedPortion: expect.any(String),
      }),
    );
  });

  it("uses Genuine Gap only with explicit profile evidence and retains strength", async () => {
    const { result } = await run({
      resumeMatch: {
        requirementClassifications: [
          "STRONG_MATCH",
          "GENUINE_GAP",
          "UNKNOWN",
        ],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    const gap = resume.evaluated
      ? resume.match.requirementAssessments[1]
      : undefined;
    expect(gap).toEqual(
      expect.objectContaining({
        classification: "GENUINE_GAP",
        strength: "PREFERRED",
        matchedExperienceSpecificity: "UNSUPPORTED",
      }),
    );
    expect(gap?.profileEvidenceReferences[0]).toMatch(/^cs-profile-skills-/);
  });

  it("keeps insufficient profile evidence Unknown rather than a gap or zero", async () => {
    const { result } = await run({
      resumeMatch: {
        score: 68,
        requirementClassifications: ["UNKNOWN", "UNKNOWN", "UNKNOWN"],
      },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(resume.evaluated && resume.match.score).toBe(68);
    expect(
      resume.evaluated &&
        resume.match.requirementAssessments.every(
          (item) =>
            item.classification === "UNKNOWN" &&
            item.profileEvidenceReferences.length === 0,
        ),
    ).toBe(true);
    expect(resume.evaluated && resume.match.genuineGaps).toHaveLength(0);
  });

  it("keeps an ambiguous requirement Unknown rather than a Genuine Gap", async () => {
    const { result } = await run({
      rawText:
        "Remote - United States only. Salary $70,000. 3 years of experience.",
      resumeMatch: { requirementClassifications: ["UNKNOWN"] },
    });
    const resume = result.domainResult!.resumeMatch;
    const assessment = resume.evaluated
      ? resume.match.requirementAssessments[0]
      : undefined;
    expect(assessment).toEqual(
      expect.objectContaining({
        classification: "UNKNOWN",
        strength: "AMBIGUOUS",
        isAmbiguous: true,
      }),
    );
  });

  it("does not require literal title equivalence for direct work evidence", async () => {
    const { result } = await run({ title: "International Learning Advisor" });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated &&
        resume.match.requirementAssessments[0]?.classification,
    ).toBe("STRONG_MATCH");
  });

  it("does not turn a resume keyword alone into Strong Match", async () => {
    const { result } = await run({
      rawText:
        "Remote - United States only. Salary $70,000. Customer Success experience required.",
      directStatement: "Customer Success",
      resumeMatch: { requirementClassifications: ["UNKNOWN"] },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated &&
        resume.match.requirementAssessments[0]?.classification,
    ).toBe("UNKNOWN");
  });

  it("does not allow transferable evidence to be labeled a Strong Match", () => {
    const base = {
      requirementIndex: 0,
      requirementText: "Direct SaaS Customer Success experience required.",
      category: "EXPERIENCE",
      strength: "REQUIRED",
      statedYears: null,
      statedYearsMaximum: null,
      statedYearsOpenEnded: false,
      requestedExperienceSpecificity: "Customer Success",
      isAmbiguous: false,
      ambiguityExplanation: null,
      classification: "STRONG_MATCH",
      matchedExperienceSpecificity: "TRANSFERABLE",
      importanceExplanation: "Required requirement.",
      explanation: "Invalid relabeling.",
      supportedPortion: null,
      unsupportedPortion: null,
      jdEvidenceReferences: ["jd"],
      profileEvidenceReferences: ["profile"],
    };
    expect(() =>
      semanticResumeMatchSchema.shape.requirementAssessments.element.parse(base),
    ).toThrow();
  });

  it("allows profile changes to alter classification without evaluator changes", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const profileAware: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        const value = (await fixture.semanticOperations.evaluateResumeMatch(
          input,
        )) as Record<string, unknown>;
        const assessments = value.requirementAssessments as Record<
          string,
          unknown
        >[];
        const hasDirectRetention = input.userProfile.data.experience?.some(
          (item) => /retention/i.test(item.statement),
        );
        return {
          ...value,
          requirementAssessments: assessments.map((item, index) =>
            index === 0 && !hasDirectRetention
              ? {
                  ...item,
                  classification: "UNKNOWN",
                  matchedExperienceSpecificity: "UNKNOWN",
                  profileEvidenceReferences: [],
                }
              : item,
          ),
        };
      },
    };
    const { result } = await run({
      operations: profileAware,
      directStatement: "Provided general customer communication.",
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated &&
        resume.match.requirementAssessments[0]?.classification,
    ).toBe("UNKNOWN");
  });
});

describe("Customer Success Resume Match score and Effective Seniority", () => {
  it("rejects candidate-only evidence for Actual Responsibility Seniority", async () => {
    const execution = await runWithResumeMatchMutation({
      mutate(value) {
        const profileReference = value.requirementAssessments[0]!
          .profileEvidenceReferences[0]!;
        value.effectiveSeniority.actualResponsibilitySeniority = {
          classification: "MID_LEVEL",
          summary: "The candidate appears mid-level.",
          signals: [{
            signal: "AUTONOMY",
            assessment: "MODERATE",
            explanation: "The candidate independently managed prior work.",
            evidenceReferences: [profileReference],
          }],
          evidenceReferences: [profileReference],
        };
        return value;
      },
    });

    expect(execution.result.evaluation.stageResults[6]).toMatchObject({
      status: "FAILED",
      failureCode: "RESUME_MATCH_ROLE_SENIORITY_EVIDENCE_INVALID",
      retryable: false,
    });
    expect(execution.semanticFixture.stats.resumeMatchCalls).toBe(1);
  });

  it("rejects provider-generated Genuine Gaps that diverge from assessments", async () => {
    const execution = await runWithResumeMatchMutation({
      mutate(value) {
        value.genuineGaps = [];
        value.requirementAssessments[0] = {
          ...value.requirementAssessments[0]!,
          classification: "GENUINE_GAP",
          matchedExperienceSpecificity: "UNSUPPORTED",
          decisionImpact: "NON_DECISIVE",
        };
        return value;
      },
    });

    expect(execution.result.evaluation.stageResults[6]).toMatchObject({
      status: "FAILED",
      failureCode: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
      retryable: false,
    });
    expect(execution.semanticFixture.stats.resumeMatchCalls).toBe(1);
  });

  it.each([
    [0, "VERY_LOW"],
    [19, "VERY_LOW"],
    [20, "LOW"],
    [39, "LOW"],
    [40, "MIXED_MODERATE"],
    [59, "MIXED_MODERATE"],
    [60, "GOOD_HIGH"],
    [79, "GOOD_HIGH"],
    [80, "VERY_STRONG_VERY_HIGH"],
    [100, "VERY_STRONG_VERY_HIGH"],
  ] as const)("maps score %i to the higher-is-better band %s", async (score, band) => {
    expect(resumeMatchBand(score)).toBe(band);
    const { result } = await run({ resumeMatch: { score } });
    expect(result.domainResult!.resumeMatch).toEqual(
      expect.objectContaining({ evaluated: true, band }),
    );
  });

  it.each([-1, 101, 72.5])("rejects invalid score %s", async (score) => {
    const { result } = await run({ resumeMatch: { score } });
    expect(result.evaluation.stageResults[6]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("requires score evidence from both the JD and profile", async () => {
    const { result } = await run();
    const resume = result.domainResult!.resumeMatch;
    const refs = resume.evaluated ? resume.match.scoreEvidenceReferences : [];
    expect(refs).toEqual(
      expect.arrayContaining(["actual-work", "cs-profile-experience-0"]),
    );
  });

  it.each(["TARGET_LEVEL", "STRETCH", "ABOVE_LEVEL"] as const)(
    "supports %s inside Resume Match",
    async (effectiveLevelFit) => {
      expect(effectiveLevelFitSchema.options).toContain(effectiveLevelFit);
      const { result } = await run({ resumeMatch: { effectiveLevelFit } });
      const resume = result.domainResult!.resumeMatch;
      expect(
        resume.evaluated &&
          resume.match.effectiveSeniority.effectiveLevelFit,
      ).toBe(effectiveLevelFit);
    },
  );

  it("keeps Stretch distinct from failure", async () => {
    const { result } = await run({
      resumeMatch: { effectiveLevelFit: "STRETCH", score: 64 },
    });
    expect(result.evaluation.status).toBe("COMPLETED");
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated && resume.match.effectiveSeniority.effectiveLevelFit,
    ).toBe("STRETCH");
  });

  it("does not let five-plus years alone force Above Level", async () => {
    const { result } = await run({
      rawText:
        "Remote - United States only. Salary $70,000. 5+ years of Customer Success experience required. Guide onboarding and adoption.",
      resumeMatch: {
        effectiveLevelFit: "TARGET_LEVEL",
        actualResponsibilitySeniority: "EARLY_MID_LEVEL",
      },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated && resume.match.effectiveSeniority.effectiveLevelFit,
    ).toBe("TARGET_LEVEL");
  });

  it.each([
    "Enterprise Customer Success Manager",
    "Senior Customer Success Manager",
    "Executive Customer Success Partner",
  ])("does not let the isolated signal in %s force Above Level", async (title) => {
    const { result } = await run({
      title,
      resumeMatch: {
        effectiveLevelFit: "TARGET_LEVEL",
        actualResponsibilitySeniority: "MID_LEVEL",
      },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated && resume.match.effectiveSeniority.effectiveLevelFit,
    ).toBe("TARGET_LEVEL");
  });

  it("retains required and preferred years as different structured evidence", async () => {
    const { result } = await run({
      rawText: [
        "Remote - United States only. Salary $70,000.",
        "5+ years of Customer Success experience required.",
        "7+ years of SaaS experience preferred.",
      ].join(" "),
    });
    const strengths = result.domainResult!.hardFilters.reconstruction.requirements
      .map((item) => item.strength);
    expect(strengths).toEqual(["REQUIRED", "PREFERRED"]);
  });

  it("uses actual authority and ownership contextually for Above Level", async () => {
    const { result } = await run({
      resumeMatch: {
        effectiveLevelFit: "ABOVE_LEVEL",
        actualResponsibilitySeniority: "HIGHLY_SENIOR",
      },
    });
    const resume = result.domainResult!.resumeMatch;
    expect(
      resume.evaluated &&
        resume.match.effectiveSeniority.actualResponsibilitySeniority
          .classification,
    ).toBe("HIGHLY_SENIOR");
  });
});

describe("Customer Success seniority contradictions and failure isolation", () => {
  it.each([
    "INFLATED_YEARS",
    "LOW_YEARS_SENIOR_SCOPE",
    "SENIOR_TITLE_ROUTINE_SCOPE",
    "JUNIOR_TITLE_SENIOR_SCOPE",
  ] as const)("preserves the %s contradiction with evidence", async (contradiction) => {
    const { result } = await run({ resumeMatch: { contradiction } });
    expect(
      result.evaluation.contradictions.some(
        (item) =>
          item.relevantField === "effectiveSeniority" &&
          item.evidenceIdsA.length > 0 &&
          item.evidenceIdsB.length > 0,
      ),
    ).toBe(true);
    expect(result.evaluation.stageResults[6]?.result?.confidence).toBe(
      "CONFLICTING",
    );
  });

  it("rejects unsupported match and level classifications", () => {
    expect(() => requirementMatchClassificationSchema.parse("DIRECT_MATCH"))
      .toThrow();
    expect(() => effectiveLevelFitSchema.parse("SENIOR"))
      .toThrow();
  });

  it.each([
    {
      name: "nonexistent requirement identity",
      expected: "references nonexistent requirement index 999",
      code: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.requirementAssessments[0]!.requirementIndex = 999;
      },
    },
    {
      name: "duplicate requirement identity",
      expected: "repeats requirement index 0",
      code: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.requirementAssessments[1]!.requirementIndex = 0;
      },
    },
    {
      name: "decision evidence outside its assessment",
      expected: "decision impact references evidence outside its assessment",
      code: "STRUCTURED_OUTPUT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.requirementAssessments[0]!.decisionImpactEvidenceReferences = [
          "actual-work",
        ];
      },
    },
    {
      name: "decisive impact without both evidence sources",
      expected: "decisive impact requires both JD and profile evidence",
      code: "STRUCTURED_OUTPUT_INVALID",
      mutate(value: SemanticResumeMatch) {
        const assessment = value.requirementAssessments[0]!;
        Object.assign(assessment, {
          classification: "GENUINE_GAP",
          matchedExperienceSpecificity: "UNSUPPORTED",
          decisionImpact: "DECISIVE_DISQUALIFIER",
          decisionImpactEvidenceReferences: [assessment.jdEvidenceReferences[0]!],
        });
      },
    },
    {
      name: "nonexistent Effective Seniority requirement identity",
      expected: "Effective Seniority references a nonexistent requirement",
      code: "STRUCTURED_OUTPUT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.effectiveSeniority.requirementStrength.requirementIndexes = [999];
      },
    },
    {
      name: "unresolved aggregate evidence reference",
      expected: "Resume Match references unknown evidence: not-real",
      code: "STRUCTURED_OUTPUT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.evidenceReferences.push("not-real");
      },
    },
    {
      name: "Effective Seniority without both evidence sources",
      expected: "Effective Seniority requires both JD and user-profile evidence",
      code: "STRUCTURED_OUTPUT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.effectiveSeniority.evidenceReferences = ["actual-work"];
      },
    },
    {
      name: "positioning recommendation without both evidence sources",
      expected:
        "Resume-positioning recommendations require both JD and user-profile evidence",
      code: "STRUCTURED_OUTPUT_INVALID",
      mutate(value: SemanticResumeMatch) {
        value.positioningRecommendations[0]!.evidenceReferences = ["actual-work"];
      },
    },
  ])("reaches the $name safeguard", async ({ mutate, expected, code }) => {
    const { result } = await runWithResumeMatchMutation({
      mutate(value) {
        mutate(value);
        return value;
      },
    });
    expect(result.evaluation.stageResults[6]).toMatchObject({
      status: "FAILED",
      failureCode: code,
    });
    expect(result.evaluation.stageResults[6]?.errorMessage).toContain(expected);
  });

  it("treats an attempted ambiguous-requirement judgment as non-retryable", async () => {
    const execution = await runWithResumeMatchMutation({
      rawText: `3 years of experience. ${defaultJobDescription}`,
      mutate(value) {
        Object.assign(value.requirementAssessments[0]!, {
          classification: "STRONG_MATCH",
          matchedExperienceSpecificity: "DIRECT_CUSTOMER_SUCCESS",
          profileEvidenceReferences: ["cs-profile-experience-0"],
        });
        return value;
      },
    });
    expect(execution.result.evaluation.stageResults[6]).toMatchObject({
      status: "FAILED",
      failureCode: "RESUME_MATCH_AUTHORITATIVE_RESULT_INVALID",
      retryable: false,
    });
    expect(execution.result.evaluation.stageResults[6]?.errorMessage).toContain(
      "Ambiguous requirement 0 must remain Unknown",
    );
    expect(execution.semanticFixture.stats.resumeMatchCalls).toBe(1);
    await expect(
      execution.executor.retryStage({
        evaluationId: execution.result.evaluation.id,
        stageId: "resume-match",
        evaluator: execution.evaluator,
        domainData: execution.domainData,
      }),
    ).rejects.toThrow("Evaluation stage is not eligible for retry");
    expect(execution.semanticFixture.stats.resumeMatchCalls).toBe(1);
  });

  it("rejects invalid JD evidence references", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        const value = (await fixture.semanticOperations.evaluateResumeMatch(
          input,
        )) as Record<string, unknown>;
        const assessments = value.requirementAssessments as Record<
          string,
          unknown
        >[];
        return {
          ...value,
          requirementAssessments: assessments.map((item, index) =>
            index === 0
              ? { ...item, jdEvidenceReferences: ["not-real"] }
              : item,
          ),
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults[6]?.status).toBe("FAILED");
  });

  it("rejects omission of an explicit required requirement", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        const value = (await fixture.semanticOperations.evaluateResumeMatch(
          input,
        )) as Record<string, unknown>;
        const assessments = value.requirementAssessments as Record<
          string,
          unknown
        >[];
        return {
          ...value,
          requirementAssessments: assessments.filter(
            (item) => item.strength !== "REQUIRED",
          ),
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults[6]?.status).toBe("FAILED");
  });

  it("rejects semantic changes to structured requirement strength", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        const value = (await fixture.semanticOperations.evaluateResumeMatch(
          input,
        )) as Record<string, unknown>;
        const assessments = value.requirementAssessments as Record<
          string,
          unknown
        >[];
        return {
          ...value,
          requirementAssessments: assessments.map((item, index) =>
            index === 0 ? { ...item, strength: "PREFERRED" } : item,
          ),
        };
      },
    };
    const { result, executor, evaluator, domainData } = await run({
      operations: invalid,
    });
    expect(result.evaluation.stageResults[6]).toMatchObject({
      status: "FAILED",
      failureCode: "RESUME_MATCH_REQUIREMENT_FIDELITY_INVALID",
      retryable: false,
    });
    expect(fixture.stats.resumeMatchCalls).toBe(1);
    await expect(
      executor.retryStage({
        evaluationId: result.evaluation.id,
        stageId: "resume-match",
        evaluator,
        domainData,
      }),
    ).rejects.toThrow("Evaluation stage is not eligible for retry");
    expect(fixture.stats.resumeMatchCalls).toBe(1);
  });

  it("rejects profile evidence mislabeled as JD evidence", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        const value = (await fixture.semanticOperations.evaluateResumeMatch(
          input,
        )) as Record<string, unknown>;
        const assessments = value.requirementAssessments as Record<
          string,
          unknown
        >[];
        return {
          ...value,
          requirementAssessments: assessments.map((item, index) =>
            index === 0
              ? {
                  ...item,
                  jdEvidenceReferences: ["cs-profile-experience-0"],
                }
              : item,
          ),
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults[6]?.status).toBe("FAILED");
  });

  it("rejects JD evidence mislabeled as profile evidence", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateResumeMatch(input) {
        const value = (await fixture.semanticOperations.evaluateResumeMatch(
          input,
        )) as Record<string, unknown>;
        const assessments = value.requirementAssessments as Record<
          string,
          unknown
        >[];
        return {
          ...value,
          requirementAssessments: assessments.map((item, index) =>
            index === 0
              ? { ...item, profileEvidenceReferences: ["actual-work"] }
              : item,
          ),
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults[6]?.status).toBe("FAILED");
  });

  it("retries Resume Match and keeps six earlier stages intact", async () => {
    const initial = await run({ failResumeMatchOnce: true });
    expect(
      initial.result.evaluation.stageResults
        .slice(0, 6)
        .every((stage) => stage.status === "COMPLETED"),
    ).toBe(true);
    expect(initial.result.evaluation.stageResults[6]?.status).toBe("FAILED");
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "resume-match",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults[6]?.attempt).toBe(2);
  });

  it("rejects missing required Resume Match fields", () => {
    expect(() => semanticResumeMatchSchema.parse({ score: 80 })).toThrow();
  });
});
