import {
  businessModelClassificationSchema,
  companyAlignmentDataSchema,
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  customerOperatingModelSchema,
  customerSegmentClassificationSchema,
  customerTypeClassificationSchema,
  defineCustomerSuccessPreferences,
  existingCustomerSuccessFunctionSchema,
  organizationalMaturityDataSchema,
  productTypeClassificationSchema,
  semanticCompanyAlignmentSchema,
  semanticOrganizationalMaturitySchema,
  type CustomerSuccessSemanticOperations,
  type CustomerSuccessPreferences,
} from "@ai-career/customer-success";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
  type CompanyAlignmentFixtureOptions,
  type CustomerSuccessScenario,
  type OrganizationalMaturityFixtureOptions,
} from "../fixtures/customer-success";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

const richJobDescription = [
  "Remote - United States only. Salary $70,000-$90,000.",
  "We provide a subscription workflow platform to mid-market business customers.",
  "Join a team of six CSMs reporting to the VP of Customer Success.",
  "Own customer adoption, success plans, retention, and business reviews.",
  "Collaborate with Product to share customer feedback.",
  "Coordinate escalations with Support, which owns technical resolution.",
  "Use product analytics and collaborate with engineering on API integrations.",
].join(" ");

function createSubject(input?: {
  companyName?: string;
  rawText?: string;
}) {
  const subject = createNeutralEvaluationSubject();
  const rawText = input?.rawText ?? richJobDescription;
  subject.opportunity.domain = "customer-success";
  subject.opportunity.title = "Customer Success Manager";
  subject.opportunity.companyName = input?.companyName ?? "Example Technology";
  subject.opportunity.industry = "Software";
  subject.opportunity.jobDescription = rawText;
  subject.opportunity.salaryText = "$70,000-$90,000";
  subject.rawSources[0]!.rawDescription = rawText;
  subject.rawSources[0]!.rawPayload = { rawText };
  subject.provenance[0]!.normalizedValue = rawText;
  subject.provenance[0]!.sourceText = rawText;
  return subject;
}

async function run(input?: {
  scenario?: CustomerSuccessScenario;
  companyAlignment?: CompanyAlignmentFixtureOptions;
  organizationalMaturity?: OrganizationalMaturityFixtureOptions;
  operations?: CustomerSuccessSemanticOperations;
  failCompanyAlignmentOnce?: boolean;
  failOrganizationalMaturityOnce?: boolean;
  companyName?: string;
  preferences?: CustomerSuccessPreferences;
}) {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: input?.scenario ?? "strong",
    companyAlignment: input?.companyAlignment,
    organizationalMaturity: input?.organizationalMaturity,
    failCompanyAlignmentOnce: input?.failCompanyAlignmentOnce,
    failOrganizationalMaturityOnce: input?.failOrganizationalMaturityOnce,
  });
  const subject = createSubject({ companyName: input?.companyName });
  const repository = new InMemoryEvaluationRepository(subject);
  const executor = createEvaluationExecutor(repository);
  const evaluator = createCustomerSuccessEvaluator();
  const domainData = createCustomerSuccessDomainData({
    preferences: input?.preferences ?? customerSuccessTestPreferences,
    semanticOperations: input?.operations ?? fixture.semanticOperations,
  });
  const result = await executor.execute({
    opportunityId: subject.opportunity.id,
    evaluator,
    domainData,
  });
  return { result, fixture, executor, evaluator, domainData };
}

describe("Customer Success Company Alignment", () => {
  it("supports the complete documented classification vocabularies", () => {
    expect(businessModelClassificationSchema.options).toEqual([
      "SAAS",
      "SOFTWARE",
      "TECHNOLOGY",
      "EDTECH",
      "MARKETPLACE",
      "SUBSCRIPTION",
      "OTHER",
      "UNKNOWN",
    ]);
    expect(customerTypeClassificationSchema.options).toEqual([
      "B2C",
      "B2B2C",
      "LIGHT_B2B",
      "ENTERPRISE_HEAVY_B2B",
      "MIXED",
      "UNKNOWN",
    ]);
    expect(productTypeClassificationSchema.options).toEqual([
      "WORKFLOW",
      "PRODUCTIVITY",
      "COLLABORATION",
      "LEARNING",
      "AUTOMATION",
      "NO_CODE",
      "LOW_CODE",
      "MODERATELY_TECHNICAL",
      "DEVELOPER_FOCUSED",
      "OTHER",
      "UNKNOWN",
    ]);
    expect(customerSegmentClassificationSchema.options).toEqual([
      "SMB",
      "MID_MARKET",
      "COMMERCIAL",
      "ENTERPRISE",
      "MIXED",
      "UNKNOWN",
    ]);
  });

  it("receives the existing maps, prior Job Evaluation, and typed preferences", async () => {
    const { result, fixture } = await run();
    expect(result.domainResult?.companyAlignment.evaluated).toBe(true);
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.companyAlignmentReceivedMaps).toBe(true);
    expect(fixture.stats.companyAlignmentReceivedPreferences).toBe(true);
    expect(fixture.stats.organizationalMaturityReceivedPriorResults).toBe(true);
  });

  it("uses typed configuration for deterministic preference lookup", async () => {
    const preferences = defineCustomerSuccessPreferences({
      ...customerSuccessTestPreferences,
      companyPreferences: {
        preferredBusinessModels: ["EDTECH"],
        alsoAlignedBusinessModels: [],
      },
    });
    const { result } = await run({ preferences });
    const stage = result.evaluation.stageResults.find(
      (item) => item.stageId === "company-alignment",
    );
    expect(stage?.result?.findings).toContain(
      "SAAS is not listed as a preferred or also-aligned business model.",
    );
  });

  it("keeps enterprise contextual rather than automatically negative", async () => {
    const neutral = await run({
      companyAlignment: {
        customerType: "ENTERPRISE_HEAVY_B2B",
        customerSegment: "ENTERPRISE",
      },
    });
    const neutralAlignment = neutral.result.domainResult!.companyAlignment;
    expect(
      neutralAlignment.evaluated &&
        neutralAlignment.alignment.potentialConcerns,
    ).toEqual([]);

    const supportedConcern = await run({
      companyAlignment: {
        customerType: "ENTERPRISE_HEAVY_B2B",
        customerSegment: "ENTERPRISE",
        enterpriseConcernSupported: true,
      },
    });
    const concernAlignment =
      supportedConcern.result.domainResult!.companyAlignment;
    expect(
      concernAlignment.evaluated &&
        concernAlignment.alignment.potentialConcerns[0]?.evidenceReferences,
    ).toEqual(["customer-context", "actual-work"]);
  });

  it("keeps moderately technical guidance work aligned and requires evidence for developer concern", async () => {
    const moderate = await run({
      companyAlignment: { productType: "MODERATELY_TECHNICAL" },
    });
    const moderateResult = moderate.result.domainResult!.companyAlignment;
    expect(
      moderateResult.evaluated && moderateResult.alignment.potentialConcerns,
    ).toEqual([]);

    const terminologyOnly = await run({
      companyAlignment: { productType: "DEVELOPER_FOCUSED" },
    });
    const terminologyResult =
      terminologyOnly.result.domainResult!.companyAlignment;
    expect(
      terminologyResult.evaluated &&
        terminologyResult.alignment.potentialConcerns,
    ).toEqual([]);

    const deepEngineering = await run({
      companyAlignment: {
        productType: "DEVELOPER_FOCUSED",
        developerConcernSupported: true,
      },
    });
    const deepEngineeringResult =
      deepEngineering.result.domainResult!.companyAlignment;
    expect(
      deepEngineeringResult.evaluated &&
        deepEngineeringResult.alignment.potentialConcerns,
    ).toHaveLength(1);
  });

  it("does not classify ordinary software use as a software company or product", async () => {
    const { result } = await run({ scenario: "software-only" });
    const companyAlignment = result.domainResult!.companyAlignment;
    expect(companyAlignment.evaluated && companyAlignment.alignment.businessModel)
      .toEqual(expect.objectContaining({
        classification: "UNKNOWN",
        evidenceReferences: [],
      }));
    expect(companyAlignment.evaluated && companyAlignment.alignment.productType)
      .toEqual(expect.objectContaining({
        classification: "UNKNOWN",
        evidenceReferences: [],
      }));
    expect(
      companyAlignment.evaluated && companyAlignment.alignment.unknowns.length,
    ).toBeGreaterThan(0);
  });

  it("preserves every missing company dimension as Unknown", async () => {
    const { result } = await run({
      companyAlignment: {
        businessModel: "UNKNOWN",
        customerType: "UNKNOWN",
        productType: "UNKNOWN",
        customerSegment: "UNKNOWN",
      },
    });
    const companyAlignment = result.domainResult!.companyAlignment;
    expect(companyAlignment.evaluated).toBe(true);
    if (!companyAlignment.evaluated) return;
    expect([
      companyAlignment.alignment.businessModel.classification,
      companyAlignment.alignment.customerType.classification,
      companyAlignment.alignment.productType.classification,
      companyAlignment.alignment.customerSegment.classification,
    ]).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    expect(companyAlignment.alignment.strategicAdvantages).toEqual([]);
    expect(companyAlignment.alignment.potentialConcerns).toEqual([]);
    expect(companyAlignment.alignment.unknowns).toHaveLength(4);
  });

  it("persists only resolvable evidence references", async () => {
    const { result } = await run();
    const stage = result.evaluation.stageResults.find(
      (item) => item.stageId === "company-alignment",
    )!;
    expect(stage.result?.evidenceRecordIds.length).toBeGreaterThan(0);
    expect(
      stage.result?.evidenceRecordIds.every((id) =>
        result.evaluation.evidenceRecords.some((record) => record.id === id),
      ),
    ).toBe(true);
  });

  it("preserves contradictory company evidence", async () => {
    const { result } = await run({
      companyAlignment: { contradictoryCompanyEvidence: true },
    });
    expect(
      result.evaluation.contradictions.some(
        (item) =>
          item.stageId === "company-alignment" &&
          item.relevantField === "businessModel" &&
          item.resolutionStatus === "UNRESOLVED",
      ),
    ).toBe(true);
  });

  it("rejects missing fields and unsupported Company Alignment classifications", () => {
    expect(semanticCompanyAlignmentSchema.safeParse({}).success).toBe(false);
    const valid = companyAlignmentDataSchema.safeParse({
      evaluated: true,
      alignment: {
        businessModel: {
          classification: "BANKING",
          explanation: "Unsupported classification.",
          evidenceReferences: ["company-model"],
        },
      },
    });
    expect(valid.success).toBe(false);
  });

  it("rejects unknown Company Alignment evidence and isolates earlier stages", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateCompanyAlignment(input) {
        const value = (await fixture.semanticOperations.evaluateCompanyAlignment(
          input,
        )) as Record<string, unknown>;
        return { ...value, evidenceReferences: ["missing-company-evidence"] };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.status).toBe("FAILED");
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "FAILED",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
    expect(result.evaluation.stageResults[2]).toEqual(
      expect.objectContaining({
        retryable: true,
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("rejects a known Company Alignment classification without evidence", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateCompanyAlignment(input) {
        const value = (await fixture.semanticOperations.evaluateCompanyAlignment(
          input,
        )) as Record<string, unknown>;
        return {
          ...value,
          businessModel: {
            ...((value.businessModel as object) ?? {}),
            evidenceReferences: [],
          },
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults[2]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("retries Company Alignment and then continues to Organizational Maturity", async () => {
    const initial = await run({ failCompanyAlignmentOnce: true });
    expect(initial.result.evaluation.stageResults.map((stage) => stage.status))
      .toEqual([
        "COMPLETED",
        "COMPLETED",
        "FAILED",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
      ]);
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "company-alignment",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(recovered.evaluation.stageResults[2]?.attempt).toBe(2);
  });
});

describe("Customer Success Organizational Maturity", () => {
  it("supports every documented function and operating-model classification", () => {
    expect(existingCustomerSuccessFunctionSchema.options).toEqual([
      "ESTABLISHED",
      "PARTIALLY_ESTABLISHED",
      "EMERGING",
      "BUILDING_FROM_SCRATCH",
      "UNKNOWN",
    ]);
    expect(customerOperatingModelSchema.options).toEqual([
      "STRATEGIC_CS",
      "ADOPTION_FOCUSED",
      "EDUCATION_FOCUSED",
      "ENABLEMENT_FOCUSED",
      "COMMERCIAL_CS",
      "RENEWAL_FOCUSED",
      "EXPANSION_FOCUSED",
      "IMPLEMENTATION_HEAVY",
      "TECHNICAL_CS",
      "SUPPORT_HEAVY",
      "HYBRID",
      "UNKNOWN",
    ]);
  });

  it.each([
    "ESTABLISHED",
    "PARTIALLY_ESTABLISHED",
    "EMERGING",
    "BUILDING_FROM_SCRATCH",
    "UNKNOWN",
  ] as const)("preserves %s CS-function maturity", async (classification) => {
    const { result } = await run({
      organizationalMaturity: { existingFunction: classification },
    });
    const maturity = result.domainResult!.organizationalMaturity;
    expect(
      maturity.evaluated &&
        maturity.maturity.existingCustomerSuccessFunction.classification,
    ).toBe(classification);
  });

  it.each([
    ["strong", "ADOPTION_FOCUSED"],
    ["support-heavy", "SUPPORT_HEAVY"],
    ["implementation-heavy", "IMPLEMENTATION_HEAVY"],
    ["technical-cs", "TECHNICAL_CS"],
    ["sales-heavy", "EXPANSION_FOCUSED"],
  ] as const)(
    "reconstructs %s work as %s from responsibility patterns",
    async (scenario, expected) => {
      const { result } = await run({ scenario });
      const maturity = result.domainResult!.organizationalMaturity;
      expect(
        maturity.evaluated &&
          maturity.maturity.customerOperatingModel.classification,
      ).toBe(expected);
    },
  );

  it("supports Hybrid when multiple substantial work patterns are evidenced", async () => {
    const { result } = await run({
      organizationalMaturity: { operatingModel: "HYBRID" },
    });
    const maturity = result.domainResult!.organizationalMaturity;
    expect(
      maturity.evaluated && maturity.maturity.customerOperatingModel.classification,
    ).toBe("HYBRID");
    expect(
      maturity.evaluated &&
        maturity.maturity.customerOperatingModel.substantialPatterns,
    ).toEqual(["ADOPTION_FOCUSED", "EDUCATION_FOCUSED"]);
  });

  it("distinguishes collaboration and handoffs from ownership or poor maturity", async () => {
    const { result } = await run();
    const maturity = result.domainResult!.organizationalMaturity;
    expect(maturity.evaluated).toBe(true);
    if (!maturity.evaluated) return;
    const design = maturity.maturity.ownershipAndCrossFunctionalDesign;
    expect(design.sharedOwnership.conclusion).toContain(
      "does not transfer Product ownership",
    );
    expect(design.handoffs.conclusion).toContain("Support handoff");
    expect(design.scopeCreep.conclusion).toContain(
      "does not establish scope creep",
    );
    expect(maturity.maturity.weakSignals).toEqual([]);
  });

  it("requires evidence before reporting scope creep or multiple jobs", async () => {
    const { result } = await run({
      organizationalMaturity: {
        scopeCreepSupported: true,
        multipleJobsSupported: true,
        unrealisticOwnershipSupported: true,
      },
    });
    const maturity = result.domainResult!.organizationalMaturity;
    expect(maturity.evaluated).toBe(true);
    if (!maturity.evaluated) return;
    expect(maturity.maturity.weakSignals[0]?.evidenceReferences).toEqual([
      "scope-creep",
    ]);
    expect(
      maturity.maturity.ownershipAndCrossFunctionalDesign.scopeCreep
        .evidenceReferences,
    ).toEqual(["scope-creep"]);
  });

  it.each([0, 100])("accepts the bounded maturity score %s", async (score) => {
    const { result } = await run({ organizationalMaturity: { score } });
    const maturity = result.domainResult!.organizationalMaturity;
    expect(maturity.evaluated && maturity.maturity.score).toBe(score);
  });

  it.each([-1, 101])("rejects the out-of-range maturity score %s", async (score) => {
    const { result } = await run({ organizationalMaturity: { score } });
    expect(result.evaluation.status).toBe("FAILED");
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "FAILED",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
    expect(result.evaluation.stageResults[3]).toEqual(
      expect.objectContaining({
        retryable: true,
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("rejects decimal maturity scores to avoid false precision", async () => {
    const { result } = await run({ organizationalMaturity: { score: 62.5 } });
    expect(result.evaluation.stageResults[3]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("does not convert an Unknown CS function to a zero score", async () => {
    const { result } = await run({
      organizationalMaturity: {
        existingFunction: "UNKNOWN",
        score: 55,
      },
    });
    const maturity = result.domainResult!.organizationalMaturity;
    expect(maturity.evaluated).toBe(true);
    if (!maturity.evaluated) return;
    expect(maturity.maturity.score).toBe(55);
    expect(maturity.maturity.existingCustomerSuccessFunction).toEqual(
      expect.objectContaining({
        classification: "UNKNOWN",
        evidenceReferences: [],
      }),
    );
    expect(maturity.maturity.unknowns).toHaveLength(1);
  });

  it("keeps the score and explanation tied to valid source evidence", async () => {
    const { result } = await run();
    const hardFilters = result.domainResult!.hardFilters;
    const maturity = result.domainResult!.organizationalMaturity;
    expect(maturity.evaluated).toBe(true);
    if (!maturity.evaluated) return;
    const known = new Set(
      hardFilters.reconstruction.evidence.map((item) => item.referenceId),
    );
    expect(
      maturity.maturity.scoreEvidenceReferences.every((reference) =>
        known.has(reference),
      ),
    ).toBe(true);
    const stage = result.evaluation.stageResults[3]!;
    expect(stage.result?.evidenceRecordIds.length).toBeGreaterThan(0);
  });

  it("does not let company prestige affect the maturity assessment", async () => {
    const famous = await run({ companyName: "Globally Famous Brand" });
    const unknown = await run({ companyName: "Unknown Company" });
    const famousMaturity = famous.result.domainResult!.organizationalMaturity;
    const unknownMaturity = unknown.result.domainResult!.organizationalMaturity;
    expect(famousMaturity.evaluated && famousMaturity.maturity.score).toBe(
      unknownMaturity.evaluated && unknownMaturity.maturity.score,
    );
  });

  it("preserves contradictory organizational evidence", async () => {
    const { result } = await run({
      organizationalMaturity: { contradictoryOrganizationEvidence: true },
    });
    expect(
      result.evaluation.contradictions.some(
        (item) =>
          item.stageId === "organizational-maturity" &&
          item.relevantField === "existingCustomerSuccessFunction" &&
          item.resolutionStatus === "UNRESOLVED",
      ),
    ).toBe(true);
  });

  it("rejects missing fields and unsupported maturity classifications", () => {
    expect(semanticOrganizationalMaturitySchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      organizationalMaturityDataSchema.safeParse({
        evaluated: true,
        maturity: {
          existingCustomerSuccessFunction: { classification: "PRESTIGIOUS" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown maturity evidence while preserving three valid earlier stages", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateOrganizationalMaturity(input) {
        const value = (await fixture.semanticOperations.evaluateOrganizationalMaturity(
          input,
        )) as Record<string, unknown>;
        return {
          ...value,
          scoreEvidenceReferences: ["missing-maturity-evidence"],
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.status).toBe("FAILED");
    expect(result.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "FAILED",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("rejects a known operating model without supporting evidence", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async evaluateOrganizationalMaturity(input) {
        const value = (await fixture.semanticOperations.evaluateOrganizationalMaturity(
          input,
        )) as Record<string, unknown>;
        return {
          ...value,
          customerOperatingModel: {
            ...((value.customerOperatingModel as object) ?? {}),
            evidenceReferences: [],
          },
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.stageResults[3]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("retries Organizational Maturity without corrupting earlier results", async () => {
    const initial = await run({ failOrganizationalMaturityOnce: true });
    expect(initial.result.evaluation.stageResults.map((stage) => stage.status))
      .toEqual([
        "COMPLETED",
        "COMPLETED",
        "COMPLETED",
        "FAILED",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
      ]);
    const recovered = await initial.executor.retryStage({
      evaluationId: initial.result.evaluation.id,
      stageId: "organizational-maturity",
      evaluator: initial.evaluator,
      domainData: initial.domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(recovered.evaluation.stageResults[3]?.attempt).toBe(2);
  });
});
