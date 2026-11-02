import {
  createCustomerSuccessDomainData,
  type CustomerSuccessDomainData,
} from "@ai-career/customer-success";
import type { CoreEvaluationContext } from "@ai-career/evaluation";
import { describe, expect, it } from "vitest";
import {
  createCustomerSuccessFixtureOperations,
  customerSuccessTestPreferences,
} from "../fixtures/customer-success";
import { createNeutralEvaluationSubject } from "../support/in-memory-evaluation-repository";
import { extractExplicitCustomerSuccessFacts } from "../../domains/customer-success/src/extraction/explicit-facts";

describe("Customer Success normalized salary and residency evidence", () => {
  it("preserves exact salary, currency, and each residency provenance row", () => {
    const subject = createNeutralEvaluationSubject();
    subject.opportunity.salaryText = "70,000 EUR";
    subject.opportunity.salaryMin = 70_000;
    subject.opportunity.salaryMax = 70_000;
    subject.opportunity.currency = "EUR";
    subject.opportunity.compensationBasis = "BASE";
    subject.opportunity.residencyRequirement = "NON_US";
    subject.opportunity.residencyRegions = ["ES", "PT"];
    subject.provenance.push(
      {
        id: "salary-min-provenance",
        sourceRecordId: subject.rawSources[0]!.id,
        fieldName: "salaryMin",
        sourceField: "compensationText",
        kind: "DETERMINISTIC",
        normalizedValue: 70_000,
        sourceReference: "manual-submission",
        sourceText: "70,000 EUR",
      },
      {
        id: "currency-provenance",
        sourceRecordId: subject.rawSources[0]!.id,
        fieldName: "currency",
        sourceField: "compensationText",
        kind: "DETERMINISTIC",
        normalizedValue: "EUR",
        sourceReference: "manual-submission",
        sourceText: "70,000 EUR",
      },
      {
        id: "compensation-basis-provenance",
        sourceRecordId: subject.rawSources[0]!.id,
        fieldName: "compensationBasis",
        sourceField: "compensationText",
        kind: "DETERMINISTIC",
        normalizedValue: "BASE",
        sourceReference: "manual-submission",
        sourceText: "Base salary 70,000 EUR",
      },
      {
        id: "spain-residency-provenance",
        sourceRecordId: subject.rawSources[0]!.id,
        fieldName: "residencyRequirement",
        sourceField: "rawText:explicit-residency-statement",
        kind: "DETERMINISTIC",
        normalizedValue: "NON_US",
        sourceReference: "manual-submission",
        sourceText: "Applicants must reside in Spain.",
      },
      {
        id: "portugal-residency-provenance",
        sourceRecordId: subject.rawSources[0]!.id,
        fieldName: "residencyRegions",
        sourceField: "rawText:explicit-residency-statement",
        kind: "DETERMINISTIC",
        normalizedValue: ["PT"],
        sourceReference: "manual-submission",
        sourceText: "Applicants may also reside in Portugal.",
      },
    );
    const fixture = createCustomerSuccessFixtureOperations({ scenario: "strong" });
    const domainData = createCustomerSuccessDomainData({
      preferences: customerSuccessTestPreferences,
      semanticOperations: fixture.semanticOperations,
    });
    const context: CoreEvaluationContext<CustomerSuccessDomainData> = {
      evaluationId: "evaluation",
      domain: "customer-success",
      evaluationVersion: "test",
      domainVersion: "test",
      ruleVersion: "test",
      promptVersion: null,
      opportunity: subject.opportunity,
      rawSources: subject.rawSources,
      provenance: subject.provenance,
      userProfile: null,
      previousStageResults: [],
      evidenceLedger: [],
      contradictions: [],
      unknowns: [],
      executionMetadata: {},
      domainData,
    };

    const facts = extractExplicitCustomerSuccessFacts(
      context,
      subject.opportunity.jobDescription ?? "",
    );

    expect(facts.salary.evidenceReferences).toEqual([
      "salary-disclosed",
      "salary-currency-normalized",
      "salary-compensation-basis",
    ]);
    expect(
      facts.evidence.find(
        (item) => item.referenceId === "salary-currency-normalized",
      )?.provenanceId,
    ).toBe("currency-provenance");
    expect(
      facts.evidence.find(
        (item) => item.referenceId === "salary-compensation-basis",
      )?.provenanceId,
    ).toBe("compensation-basis-provenance");
    expect(
      facts.evidence
        .filter((item) => item.criterionId === "residency")
        .map((item) => item.provenanceId),
    ).toEqual([
      "spain-residency-provenance",
      "portugal-residency-provenance",
    ]);
  });
});
