import type { CoreEvaluationContext } from "@ai-career/evaluation";
import {
  customerSuccessJdReconstructionSchema,
  semanticReconstructionSchema,
  type CustomerSuccessJdReconstruction,
} from "../schemas/maps";
import type { CustomerSuccessDomainData } from "../evaluator";
import type { CustomerSuccessPreferences } from "../config/preferences";
import type { CompanyAlignmentData } from "../schemas/company-alignment";
import type { JobEvaluationData } from "../schemas/results";
import type { OrganizationalMaturityData } from "../schemas/organizational-maturity";
import type { AlexFitData } from "../schemas/alex-fit";
import type { BurnoutRiskData } from "../schemas/burnout-risk";
import type { ResumeMatchData } from "../schemas/resume-match";
import type {
  ApplicationEffortAssessment,
  PostingTiming,
} from "../schemas/opportunity-priority";
import type { PostingHistoryFact } from "../schemas/ghost-job-risk";
import type { CustomerSuccessProfileContext } from "../profile/user-profile";
import { extractExplicitCustomerSuccessFacts } from "./explicit-facts";

export interface CustomerSuccessSemanticOperations {
  reconstructJobDescription(input: {
    untrustedJobDescription: string;
    normalizedTitle: string | null;
    companyName: string | null;
    sourceRecordId: string | null;
    provenanceId: string | null;
  }): Promise<unknown>;
  evaluateJob(input: {
    responsibilityMap: CustomerSuccessJdReconstruction["responsibilityMap"];
    ownershipMap: CustomerSuccessJdReconstruction["ownershipMap"];
    roleMetadata: CustomerSuccessJdReconstruction["roleMetadata"];
    companyData: {
      name: string | null;
      industry: string | null;
      size: string | null;
    };
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateCompanyAlignment(input: {
    responsibilityMap: CustomerSuccessJdReconstruction["responsibilityMap"];
    requirementMap: CustomerSuccessJdReconstruction["requirements"];
    ownershipMap: CustomerSuccessJdReconstruction["ownershipMap"];
    jobEvaluation: Extract<JobEvaluationData, { evaluated: true }>;
    companyData: {
      name: string | null;
      brand: string | null;
      parentCompany: string | null;
      industry: string | null;
      headquarters: string | null;
      size: string | null;
    };
    preferences: Pick<
      CustomerSuccessPreferences,
      | "companyPreferences"
      | "productPreferences"
      | "customerPreferences"
      | "careerStrategy"
    >;
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateOrganizationalMaturity(input: {
    responsibilityMap: CustomerSuccessJdReconstruction["responsibilityMap"];
    requirementMap: CustomerSuccessJdReconstruction["requirements"];
    ownershipMap: CustomerSuccessJdReconstruction["ownershipMap"];
    jobEvaluation: Extract<JobEvaluationData, { evaluated: true }>;
    companyAlignment: Extract<CompanyAlignmentData, { evaluated: true }>;
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateAlexFit(input: {
    responsibilityMap: CustomerSuccessJdReconstruction["responsibilityMap"];
    requirementMap: CustomerSuccessJdReconstruction["requirements"];
    ownershipMap: CustomerSuccessJdReconstruction["ownershipMap"];
    jobEvaluation: Extract<JobEvaluationData, { evaluated: true }>;
    companyAlignment: Extract<CompanyAlignmentData, { evaluated: true }>;
    organizationalMaturity: Extract<
      OrganizationalMaturityData,
      { evaluated: true }
    >;
    userProfile: CustomerSuccessProfileContext;
    preferences: Pick<
      CustomerSuccessPreferences,
      "fitPreferences" | "workStylePreferences" | "careerStrategy"
    >;
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateBurnoutRisk(input: {
    responsibilityMap: CustomerSuccessJdReconstruction["responsibilityMap"];
    ownershipMap: CustomerSuccessJdReconstruction["ownershipMap"];
    travel: CustomerSuccessJdReconstruction["travel"];
    jobEvaluation: Extract<JobEvaluationData, { evaluated: true }>;
    companyAlignment: Extract<CompanyAlignmentData, { evaluated: true }>;
    organizationalMaturity: Extract<
      OrganizationalMaturityData,
      { evaluated: true }
    >;
    alexFit: AlexFitData;
    preferences: Pick<
      CustomerSuccessPreferences,
      "workloadPreferences" | "workStylePreferences"
    >;
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateResumeMatch(input: {
    responsibilityMap: CustomerSuccessJdReconstruction["responsibilityMap"];
    requirementMap: CustomerSuccessJdReconstruction["requirements"];
    ownershipMap: CustomerSuccessJdReconstruction["ownershipMap"];
    roleMetadata: CustomerSuccessJdReconstruction["roleMetadata"];
    jobEvaluation: Extract<JobEvaluationData, { evaluated: true }>;
    companyAlignment: Extract<CompanyAlignmentData, { evaluated: true }>;
    organizationalMaturity: Extract<
      OrganizationalMaturityData,
      { evaluated: true }
    >;
    alexFit: Extract<AlexFitData, { evaluated: true }>;
    burnoutRisk: Extract<BurnoutRiskData, { evaluated: true }>;
    userProfile: CustomerSuccessProfileContext;
    preferences: Pick<
      CustomerSuccessPreferences,
      "fitPreferences" | "careerStrategy"
    >;
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateOpportunityPriority(input: {
    postingTiming: PostingTiming;
    salary: import("../schemas/results").HardFiltersData["salary"];
    strategicBridgeValue: Extract<
      JobEvaluationData,
      { evaluated: true }
    >["evaluation"]["strategicBridgeValue"];
    applicationEffort: ApplicationEffortAssessment;
    companyAlignment: Extract<CompanyAlignmentData, { evaluated: true }>;
    alexFit: Extract<AlexFitData, { evaluated: true }>;
    burnoutRisk: Extract<BurnoutRiskData, { evaluated: true }>;
    resumeMatch: Extract<ResumeMatchData, { evaluated: true }>;
    effectiveLevelFit: Extract<
      ResumeMatchData,
      { evaluated: true }
    >["match"]["effectiveSeniority"]["effectiveLevelFit"];
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
  evaluateGhostJobRisk(input: {
    objectiveFacts: PostingHistoryFact[];
    availableEvidence: CustomerSuccessJdReconstruction["evidence"];
  }): Promise<unknown>;
}

export async function reconstructCustomerSuccessJob(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
): Promise<CustomerSuccessJdReconstruction> {
  const rawJobDescription =
    context.opportunity.jobDescription ??
    context.rawSources.find((source) => source.rawDescription)?.rawDescription;
  if (!rawJobDescription) {
    throw new Error("Customer Success evaluation requires a job description");
  }
  const source = context.rawSources[0];
  const provenance = context.provenance.find(
    (item) => item.fieldName === "jobDescription",
  );
  const semantic = semanticReconstructionSchema.parse(
    await context.domainData.semanticOperations.reconstructJobDescription({
      untrustedJobDescription: rawJobDescription,
      normalizedTitle: context.opportunity.title,
      companyName: context.opportunity.companyName,
      sourceRecordId: source?.id ?? null,
      provenanceId: provenance?.id ?? null,
    }),
  );
  const explicit = extractExplicitCustomerSuccessFacts(
    context,
    rawJobDescription,
  );
  const evidenceByReference = new Map(
    [...semantic.evidence, ...explicit.evidence].map((item) => [
      item.referenceId,
      item,
    ]),
  );
  return customerSuccessJdReconstructionSchema.parse({
    ...semantic,
    requirements: [...semantic.requirements, ...explicit.requirements],
    evidence: [...evidenceByReference.values()],
    location: explicit.location,
    salary: explicit.salary,
    travel: explicit.travel,
  });
}
