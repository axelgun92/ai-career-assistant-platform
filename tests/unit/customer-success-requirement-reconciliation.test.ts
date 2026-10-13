import {
  reconcileRequirementMap,
  reconstructCustomerSuccessJob,
  responsibilityAreas,
  semanticReconstructionFromTransport,
  outdatedResumeMatchRequirementIndexes,
} from "@ai-career/customer-success";
import { describe, expect, it } from "vitest";

// Reconciliation of deterministically extracted requirement lines with JD
// Reconstruction source statements, through the production JD assembly.
// Identity is the quoted source span; covered lines are represented by their
// statement's qualifications; uncovered lines remain as the floor.

type Qualification = Record<string, unknown>;

function qualification(
  requirement: string,
  fields: Partial<{ category: string; strength: string; statedYears: number | null; statedYearsMaximum: number | null; level: string }> = {},
): Qualification {
  const category = fields.category ?? "EXPERIENCE";
  return {
    requirement,
    category,
    strengthAssessment: { strength: fields.strength ?? "REQUIRED" },
    statedYears: fields.statedYears ?? null,
    statedYearsMaximum: fields.statedYearsMaximum ?? null,
    statedYearsOpenEnded: false,
    experienceSpecificity: null,
    ...(category === "EXPERIENCE"
      ? { minimumExperienceSpecificity: fields.level ?? "DIRECT_CUSTOMER_SUCCESS", requiresStartupExperience: false }
      : {}),
    assessmentUnit: "INDEPENDENT_QUALIFICATION",
    compoundExplanation: null,
  };
}

function statement(quote: string, qualifications: Qualification[], index: number) {
  return {
    quote,
    evidenceReference: `statement-${index}`,
    statementStrengths: [...new Set(qualifications.map((item) => (item.strengthAssessment as { strength: string }).strength))],
    statementExperienceLevels: [...new Set(qualifications.flatMap((item) =>
      item.category === "EXPERIENCE" ? [item.minimumExperienceSpecificity as string] : []))],
    qualifications,
  };
}

function transport(statements: Array<ReturnType<typeof statement>>) {
  return {
    responsibilityMap: {
      areas: responsibilityAreas.map((area) => ({ area, prominence: "UNKNOWN", ownership: "UNKNOWN", evidenceReferences: [] })),
      other: [],
    },
    requirementStatements: statements.map(({ quote: _quote, ...item }) => item),
    ownershipMap: { functions: [] },
    roleMetadata: { actualRoleClassification: "CORE_CS", evidenceReferences: ["role"] },
    evidence: [
      { sourceIndex: 0, referenceId: "role", claim: "Customer Success role.", sourceField: null,
        sourceText: null, evidenceType: "role", origin: "INFERRED", evidenceLevel: "POSSIBLE" },
      ...statements.map((item) => ({
        sourceIndex: 0, referenceId: item.evidenceReference, claim: `The job states: ${item.quote}`,
        sourceField: "requirements", sourceText: item.quote, evidenceType: "requirement",
        origin: "EXPLICIT", evidenceLevel: "CONFIRMED",
      })),
    ],
    contradictions: [],
  };
}

async function assemble(jobDescription: string, statements: Array<ReturnType<typeof statement>>) {
  const source = {
    sourceIndex: 0, sourceType: "MANUAL", sourceRecordId: null, provenanceId: null,
    sourceReference: "manual-submission", collectedAt: null, sourceContent: jobDescription,
  };
  const restored = semanticReconstructionFromTransport(transport(statements), source);
  return reconstructCustomerSuccessJob({
    opportunity: {
      id: "reconciliation", jobDescription, title: null, companyName: null, sourceType: "MANUAL",
      salaryText: null, salaryMin: null, salaryMax: null, currency: null, location: null,
    },
    rawSources: [{ id: null, sourceType: "MANUAL", sourceUrl: null, rawDescription: jobDescription }],
    provenance: [],
    domainData: { semanticOperations: { reconstructJobDescription: async () => restored } },
  } as never);
}

const summary = (reconstruction: Awaited<ReturnType<typeof assemble>>) =>
  reconstruction.requirements.map((requirement) => ({
    requirement: requirement.requirement,
    category: requirement.category,
    strength: requirement.strength,
    statedYears: requirement.statedYears,
    statedYearsMaximum: requirement.statedYearsMaximum,
    level: requirement.minimumExperienceSpecificity ?? null,
    origin: requirement.sourceStatement === undefined ? "deterministic" : "statement",
  }));

const job = [
  "Remote United States. Salary $90,000-$110,000. Quarterly travel to customer sites is required.",
  "Required",
  "3-5 years of Customer Success experience required",
  "Salesforce administration experience preferred",
  "Nice to Have",
  "Preferred Qualifications:",
  "Ideally 2+ years of SaaS onboarding experience, nonprofit experience preferred",
].join("\n");

describe("requirement reconciliation by source span", () => {
  it("represents a covered line by its statement, whose qualifications control the fields", async () => {
    const reconstruction = await assemble(job, [
      statement("3-5 years of Customer Success experience required", [
        qualification("3-5 years of Customer Success experience", { statedYears: 3, statedYearsMaximum: 5 }),
      ], 0),
    ]);
    expect(summary(reconstruction)).toEqual([
      { requirement: "3-5 years of Customer Success experience", category: "EXPERIENCE", strength: "REQUIRED",
        statedYears: 3, statedYearsMaximum: 5, level: "DIRECT_CUSTOMER_SUCCESS", origin: "statement" },
      // The travel sentence is its own deterministic TRAVEL line.
      { requirement: "Quarterly travel to customer sites is required.", category: "TRAVEL", strength: "REQUIRED",
        statedYears: null, statedYearsMaximum: null, level: null, origin: "deterministic" },
      // Uncovered lines stay as the deterministic floor; headings are dropped.
      { requirement: "Salesforce administration experience preferred", category: "TOOL", strength: "PREFERRED",
        statedYears: null, statedYearsMaximum: null, level: null, origin: "deterministic" },
      { requirement: "Ideally 2+ years of SaaS onboarding experience, nonprofit experience preferred", category: "INDUSTRY",
        strength: "PREFERRED", statedYears: 2, statedYearsMaximum: null, level: null, origin: "deterministic" },
    ]);
    expect(outdatedResumeMatchRequirementIndexes(reconstruction)).toEqual([]);
  });

  it("keeps the deterministic floor, strength and stated years when the provider omits a statement", async () => {
    const reconstruction = await assemble(job, []);
    expect(summary(reconstruction)).toEqual([
      { requirement: "Quarterly travel to customer sites is required.", category: "TRAVEL", strength: "REQUIRED",
        statedYears: null, statedYearsMaximum: null, level: null, origin: "deterministic" },
      { requirement: "3-5 years of Customer Success experience required", category: "EXPERIENCE", strength: "REQUIRED",
        statedYears: 3, statedYearsMaximum: 5, level: null, origin: "deterministic" },
      { requirement: "Salesforce administration experience preferred", category: "TOOL", strength: "PREFERRED",
        statedYears: null, statedYearsMaximum: null, level: null, origin: "deterministic" },
      { requirement: "Ideally 2+ years of SaaS onboarding experience, nonprofit experience preferred", category: "INDUSTRY",
        strength: "PREFERRED", statedYears: 2, statedYearsMaximum: null, level: null, origin: "deterministic" },
    ]);
    // Deterministic requirements carry no JD Reconstruction semantics, so a
    // new execution accepts them; the REQUIRED floor stays assessable.
    expect(outdatedResumeMatchRequirementIndexes(reconstruction)).toEqual([]);
    expect(reconstruction.requirements.filter((requirement) => requirement.strength === "REQUIRED")).toHaveLength(2);
  });

  it("drops only closed-set label lines", async () => {
    const reconstruction = await assemble(
      ["Required", "Nice to Have", "Preferred Qualifications:", "Must have:", "Required: Zendesk experience", "Bonus: Ideally fluent Spanish"].join("\n"),
      [],
    );
    expect(reconstruction.requirements.map((requirement) => requirement.requirement)).toEqual([
      "Required: Zendesk experience",
      "Bonus: Ideally fluent Spanish",
    ]);
  });

  it("covers a line by a containing quote, or by contained quotes that span all of its content", async () => {
    // One quote containing two deterministic sentences.
    const containing = await assemble(
      "Customer Success experience required. Salesforce experience preferred.",
      [statement("Customer Success experience required. Salesforce experience preferred.", [
        qualification("Customer Success experience"),
        qualification("Salesforce experience", { category: "TOOL", strength: "PREFERRED" }),
      ], 0)],
    );
    expect(summary(containing).map((item) => item.origin)).toEqual(["statement", "statement"]);
    // Two quotes that together cover one deterministic line.
    const line = "Ideally 2+ years of SaaS onboarding experience, nonprofit experience preferred";
    const together = await assemble(line, [
      statement("Ideally 2+ years of SaaS onboarding experience", [
        qualification("2+ years of SaaS onboarding experience", { strength: "IDEAL", statedYears: 2, level: "DIRECT_SAAS_CUSTOMER_SUCCESS" }),
      ], 0),
      statement("nonprofit experience preferred", [
        qualification("Nonprofit experience", { category: "INDUSTRY", strength: "PREFERRED" }),
      ], 1),
    ]);
    expect(summary(together).map((item) => [item.requirement, item.origin])).toEqual([
      ["2+ years of SaaS onboarding experience", "statement"],
      ["Nonprofit experience", "statement"],
    ]);
    // A contained quote that leaves content uncovered keeps the line as the
    // floor: an omitted part of a line is never silently dropped.
    const partial = await assemble(line, [
      statement("Ideally 2+ years of SaaS onboarding experience", [
        qualification("2+ years of SaaS onboarding experience", { strength: "IDEAL", statedYears: 2, level: "DIRECT_SAAS_CUSTOMER_SUCCESS" }),
      ], 0),
    ]);
    expect(summary(partial).map((item) => [item.requirement, item.origin])).toEqual([
      ["2+ years of SaaS onboarding experience", "statement"],
      [line, "deterministic"],
    ]);
  });

  it("reconciles duplicate deterministic spans and is case- and whitespace-insensitive", async () => {
    const reconstruction = await assemble(
      "Salesforce experience required\nSALESFORCE   experience required",
      [statement("salesforce experience required", [qualification("Salesforce experience", { category: "TOOL" })], 0)],
    );
    expect(summary(reconstruction).map((item) => [item.requirement, item.origin])).toEqual([["Salesforce experience", "statement"]]);
  });

  it("is pure and idempotent and leaves explicit job facts untouched", async () => {
    const statements = [statement("3-5 years of Customer Success experience required", [
      qualification("3-5 years of Customer Success experience", { statedYears: 3, statedYearsMaximum: 5 }),
    ], 0)];
    const reconciled = await assemble(job, statements);
    const floor = await assemble(job, []);
    expect(reconcileRequirementMap(reconciled)).toEqual({ requirements: reconciled.requirements, evidence: reconciled.evidence });
    // Reconciling the unreconciled union once or twice gives the same map.
    const union = Object.freeze({
      requirements: Object.freeze([...reconciled.requirements.slice(0, 1), ...floor.requirements]),
      evidence: Object.freeze([...reconciled.evidence, ...floor.evidence.filter((item) =>
        !reconciled.evidence.some((existing) => existing.referenceId === item.referenceId))]),
    });
    const once = reconcileRequirementMap(union as never);
    expect(reconcileRequirementMap(once)).toEqual(once);
    expect(once.requirements.map((requirement) => requirement.requirement)).toEqual(
      reconciled.requirements.map((requirement) => requirement.requirement));
    expect(union.requirements).toHaveLength(5);
    // Salary, location, travel and their evidence are identical either way.
    for (const key of ["salary", "location", "travel"] as const) {
      expect(reconciled[key]).toEqual(floor[key]);
    }
    expect(reconciled.salary).toMatchObject({ minimum: 90_000, maximum: 110_000, disclosure: "DISCLOSED" });
    expect(reconciled.travel).toMatchObject({ frequency: "Quarterly", purpose: "CUSTOMER_ONSITE", mandatory: true });
    expect(reconciled.location.remoteStatus).toBe("REMOTE");
  });
});
