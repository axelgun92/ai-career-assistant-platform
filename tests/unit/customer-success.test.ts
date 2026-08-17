import {
  createCustomerSuccessDomainData,
  createCustomerSuccessEvaluator,
  customerSuccessDomain,
  type CustomerSuccessSemanticOperations,
} from "@ai-career/customer-success";
import { createEvaluationExecutor } from "@ai-career/evaluation";
import { describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
  type CustomerSuccessScenario,
} from "../fixtures/customer-success";
import {
  createNeutralEvaluationSubject,
  InMemoryEvaluationRepository,
} from "../support/in-memory-evaluation-repository";

function createSubject(input: {
  rawText: string;
  title?: string;
  salaryText?: string | null;
}) {
  const subject = createNeutralEvaluationSubject();
  subject.opportunity.domain = "customer-success";
  subject.opportunity.title = input.title ?? "Customer Success Manager";
  subject.opportunity.companyName = "Example Technology";
  subject.opportunity.jobDescription = input.rawText;
  subject.opportunity.salaryText = input.salaryText ?? null;
  subject.rawSources[0]!.rawDescription = input.rawText;
  subject.rawSources[0]!.rawPayload = { rawText: input.rawText };
  subject.provenance[0]!.normalizedValue = input.rawText;
  subject.provenance[0]!.sourceText = input.rawText;
  return subject;
}

async function run(input: {
  scenario?: CustomerSuccessScenario;
  rawText?: string;
  title?: string;
  salaryText?: string | null;
  operations?: CustomerSuccessSemanticOperations;
}) {
  const fixture = createCustomerSuccessFixtureOperations({
    scenario: input.scenario ?? "strong",
  });
  const subject = createSubject({
    rawText:
      input.rawText ??
      "Remote - United States only. $70,000-$90,000. 3+ years of Customer Success experience required. Salesforce preferred.",
    title: input.title,
    salaryText: input.salaryText,
  });
  const repository = new InMemoryEvaluationRepository(subject);
  const executor = createEvaluationExecutor(repository);
  const result = await executor.execute({
    opportunityId: subject.opportunity.id,
    evaluator: createCustomerSuccessEvaluator(),
    domainData: createCustomerSuccessDomainData({
      preferences: customerSuccessTestPreferences,
      semanticOperations: input.operations ?? fixture.semanticOperations,
    }),
  });
  return { result, fixture, subject, executor };
}

describe("Customer Success domain foundation", () => {
  it("registers the domain and executes Hard Filters before Job Evaluation", async () => {
    const { result, fixture } = await run({ scenario: "strong" });

    expect(customerSuccessDomain.id).toBe("customer-success");
    expect(customerSuccessDomain.createEvaluator().stages.map((stage) => stage.id))
      .toEqual(["hard-filters", "job-evaluation"]);
    expect(result.evaluation.stageResults.map((stage) => stage.stageId)).toEqual([
      "hard-filters",
      "job-evaluation",
    ]);
    expect(result.evaluation.status).toBe("COMPLETED");
    expect(fixture.stats.reconstructionCalls).toBe(1);
    expect(fixture.stats.jobEvaluationCalls).toBe(1);
  });

  it("preserves the three maps, requirement strength, collaboration, and evidence origin", async () => {
    const { result } = await run({ scenario: "strong" });
    const hardFilters = result.domainResult!.hardFilters;

    expect(hardFilters.reconstruction.responsibilityMap.areas.adoption).toEqual({
      prominence: "PRIMARY",
      ownership: "OWNS",
      evidenceReferences: ["actual-work"],
    });
    expect(hardFilters.reconstruction.ownershipMap.functions.product).toEqual({
      relationship: "COLLABORATES",
      evidenceReferences: ["product-collaboration"],
    });
    expect(
      hardFilters.reconstruction.requirements.map((item) => item.strength),
    ).toEqual(expect.arrayContaining(["REQUIRED", "PREFERRED"]));
    expect(result.evaluation.evidenceRecords.map((item) => item.origin)).toEqual(
      expect.arrayContaining(["EXPLICIT", "INFERRED"]),
    );
    expect(
      result.evaluation.stageResults[0]?.result?.evidenceRecordIds.every((id) =>
        result.evaluation.evidenceRecords.some((record) => record.id === id),
      ),
    ).toBe(true);
  });

  it.each([
    ["$60,000", "PASS"],
    ["$59,999", "REVIEW"],
    ["$55,000", "REVIEW"],
    ["$54,999", "FAIL"],
  ] as const)("applies the salary boundary %s as %s", async (salary, expected) => {
    const { result } = await run({
      salaryText: salary,
      rawText: `Remote - United States only. Salary ${salary}.`,
    });
    expect(result.domainResult!.hardFilters.salary.result).toBe(expected);
  });

  it("allows sub-threshold evaluation only for explicitly permitted lower-cost residence", async () => {
    const { result } = await run({
      salaryText: "$50,000",
      rawText: "Remote. Candidates may reside in Mexico. Salary $50,000.",
    });
    expect(result.domainResult!.hardFilters.salary.result).toBe("PASS");
  });

  it.each([
    ["Competitive salary", "COMPETITIVE"],
    [null, "UNDISCLOSED"],
  ] as const)("keeps %s salary Unknown", async (salaryText, disclosure) => {
    const { result } = await run({
      salaryText,
      rawText: `Remote - United States only. ${salaryText ?? "Compensation is not stated."}`,
    });
    expect(result.domainResult!.hardFilters.salary.result).toBe("UNKNOWN");
    expect(result.domainResult!.hardFilters.reconstruction.salary.disclosure).toBe(
      disclosure,
    );
  });

  it("displays time-zone requirements without rejecting an otherwise eligible location", async () => {
    const { result } = await run({
      salaryText: "$70,000",
      rawText:
        "Remote - United States only. Candidates must work PST hours. Salary $70,000.",
    });
    const hardFilters = result.domainResult!.hardFilters;
    expect(hardFilters.location.result).toBe("PASS");
    expect(hardFilters.reconstruction.location.timeZoneRequirements).toEqual([
      "PST",
    ]);
  });

  it("keeps unstated travel Unknown and fails recurring customer on-site travel", async () => {
    const unknown = await run({
      salaryText: "$70,000",
      rawText: "Remote - United States only. Salary $70,000.",
    });
    expect(unknown.result.domainResult!.hardFilters.travel.result).toBe("UNKNOWN");

    const recurring = await run({
      salaryText: "$70,000",
      rawText:
        "Remote - United States only. Salary $70,000. Monthly travel to customer onsite locations is required.",
    });
    expect(recurring.result.domainResult!.hardFilters.travel.result).toBe("FAIL");
  });

  it.each([
    "support-heavy",
    "sales-heavy",
    "implementation-heavy",
    "technical-cs",
  ] as const)("continues %s roles into Job Evaluation", async (scenario) => {
    const { result, fixture } = await run({ scenario });
    expect(result.domainResult!.hardFilters.role.result).toBe("PASS");
    expect(result.domainResult!.jobEvaluation.evaluated).toBe(true);
    expect(fixture.stats.jobEvaluationCalls).toBe(1);
  });

  it("fails an unrelated role and does not perform substantive Job Evaluation", async () => {
    const { result, fixture } = await run({ scenario: "unrelated" });
    expect(result.domainResult!.hardFilters.role.result).toBe("FAIL");
    expect(result.domainResult!.jobEvaluation).toEqual({
      evaluated: false,
      reason: "Job Evaluation was not performed because a hard filter failed.",
    });
    expect(fixture.stats.jobEvaluationCalls).toBe(0);
  });

  it("uses reconstructed work instead of a misleading title", async () => {
    const { result } = await run({
      scenario: "misleading-title",
      title: "Customer Support Manager",
    });
    expect(result.domainResult!.hardFilters.role.classification).toBe("CORE_CS");
    const jobEvaluation = result.domainResult!.jobEvaluation;
    expect(jobEvaluation.evaluated && jobEvaluation.evaluation.practicalSummary)
      .toContain("Despite the support-oriented title");
  });

  it("does not infer Strategic Bridge Value from ordinary software use", async () => {
    const { result } = await run({ scenario: "software-only" });
    const jobEvaluation = result.domainResult!.jobEvaluation;
    expect(
      jobEvaluation.evaluated &&
        jobEvaluation.evaluation.strategicBridgeValue.classification,
    ).toBe("LOW");
  });

  it("rejects nonexistent extraction evidence references", async () => {
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const invalid: CustomerSuccessSemanticOperations = {
      ...fixture.semanticOperations,
      async reconstructJobDescription(input) {
        const value = (await fixture.semanticOperations.reconstructJobDescription(
          input,
        )) as Record<string, unknown>;
        return {
          ...value,
          roleMetadata: {
            ...(value.roleMetadata as object),
            evidenceReferences: ["does-not-exist"],
          },
        };
      },
    };
    const { result } = await run({ operations: invalid });
    expect(result.evaluation.status).toBe("FAILED");
    expect(result.evaluation.stageResults[0]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        retryable: true,
        failureCode: "STRUCTURED_OUTPUT_INVALID",
      }),
    );
  });

  it("preserves contradictory job-description evidence", async () => {
    const { result } = await run({ scenario: "contradictory" });
    expect(result.evaluation.contradictions).toHaveLength(1);
    expect(result.evaluation.contradictions[0]).toEqual(
      expect.objectContaining({
        relevantField: "workArrangement",
        resolutionStatus: "UNRESOLVED",
      }),
    );
  });

  it("retries a transient reconstruction failure without corrupting the evaluation", async () => {
    const fixture = createCustomerSuccessFixtureOperations({
      scenario: "strong",
      failReconstructionOnce: true,
    });
    const subject = createSubject({
      rawText: "Remote - United States only. Salary $70,000.",
      salaryText: "$70,000",
    });
    const executor = createEvaluationExecutor(
      new InMemoryEvaluationRepository(subject),
    );
    const evaluator = createCustomerSuccessEvaluator();
    const domainData = createCustomerSuccessDomainData({
      preferences: customerSuccessTestPreferences,
      semanticOperations: fixture.semanticOperations,
    });
    const failed = await executor.execute({
      opportunityId: subject.opportunity.id,
      evaluator,
      domainData,
    });
    expect(failed.evaluation.stageResults[0]?.status).toBe("FAILED");

    const recovered = await executor.retryStage({
      evaluationId: failed.evaluation.id,
      stageId: "hard-filters",
      evaluator,
      domainData,
    });
    expect(recovered.evaluation.status).toBe("COMPLETED");
    expect(recovered.evaluation.stageResults.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(recovered.evaluation.stageResults[0]?.attempt).toBe(2);
  });
});
