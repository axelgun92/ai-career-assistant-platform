import type {
  EvaluationPresentation,
  OpportunityPresentation,
} from "../../apps/web/src/components/evaluation/types";

const evaluationId = "10000000-0000-4000-8000-000000000001";
const opportunityId = "20000000-0000-4000-8000-000000000002";
const jdEvidenceId = "30000000-0000-4000-8000-000000000003";
const profileEvidenceId = "40000000-0000-4000-8000-000000000004";

const supported = [{ finding: "Strong adoption ownership", evidenceReferences: ["jd-work"] }];
const unknown = [{ code: "portfolio-size", description: "Portfolio size is not stated.", materiality: "Review workload expectations.", evidenceReferences: [] }];
const criterion = { conclusion: "The role owns the customer outcome.", unknown: false, evidenceReferences: ["jd-work"] };

export const uiOpportunity: OpportunityPresentation = {
  id: opportunityId,
  title: "Customer Success Manager",
  company: "Example SaaS",
  salary: "$72,000–$88,000",
  location: "Remote — United States",
  workArrangement: "Remote",
  timeZoneRequirements: "Central or Eastern time",
};

export function createUiEvaluation(
  decision: "APPLY" | "REVIEW" | "SKIP" = "APPLY",
): EvaluationPresentation {
  return {
    opportunityId,
    evaluationId,
    isLatest: true,
    domain: "customer-success",
    status: "COMPLETED",
    evaluationStatus: "COMPLETED",
    task: { id: "50000000-0000-4000-8000-000000000005", status: "COMPLETED", attempt: 1, maxAttempts: 3, errorCode: null, errorMessage: null },
    versions: { evaluation: "cs-evaluation-v1.1-m9", domain: "customer-success-v1.1", rules: "cs-rules-v1.1", prompt: "cs-m9-prompts-v1", userProfile: 7 },
    startedAt: "2026-08-17T12:00:00.000Z",
    completedAt: "2026-08-17T12:02:00.000Z",
    stages: [],
    evidence: [
      {
        id: jdEvidenceId,
        referenceId: "jd-work",
        stageId: "hard-filters",
        criterionId: "actual-work",
        claim: "The role owns adoption and retention.",
        sourceType: "MANUAL",
        sourceField: "jobDescription",
        sourceReference: "manual-submission",
        sourceText: '<img src=x onerror="alert(1)"> Own adoption and retention.',
        evidenceType: "JD_RECONSTRUCTION",
        origin: "EXPLICIT",
        evidenceLevel: "CONFIRMED",
      },
      {
        id: profileEvidenceId,
        referenceId: "profile-work",
        stageId: "alex-fit",
        criterionId: "experience",
        claim: "The candidate has related customer education experience.",
        sourceType: "USER_PROFILE",
        sourceField: "experience",
        sourceReference: "profile-v7",
        sourceText: "Led customer education and onboarding.",
        evidenceType: "PROFILE_EXPERIENCE",
        origin: "EXPLICIT",
        evidenceLevel: "CONFIRMED",
      },
    ],
    contradictions: [{
      id: "60000000-0000-4000-8000-000000000006",
      stageId: "resume-match",
      claimA: "The title suggests a mid-level role.",
      claimB: "The responsibilities describe senior ownership.",
      interpretation: "Responsibility scope may exceed the advertised title.",
      significance: "This affects Effective Level confidence.",
      evidenceIdsA: [jdEvidenceId],
      evidenceIdsB: [jdEvidenceId],
      resolutionStatus: "UNRESOLVED",
      resolutionNote: null,
    }],
    result: {
      hardFilters: {
        overall: "PASS",
        role: { classification: "CORE_CS", result: "PASS", explanation: "Actual work is core Customer Success.", evidenceReferences: ["jd-work"] },
        salary: { result: "PASS", explanation: "Salary exceeds the configured threshold.", evidenceReferences: ["jd-work"] },
        location: { result: "PASS", explanation: "The configured location is allowed.", evidenceReferences: ["jd-work"] },
        workArrangement: { result: "PASS", explanation: "The role is remote.", evidenceReferences: ["jd-work"] },
        travel: { result: "UNKNOWN", explanation: "Travel frequency is not stated.", evidenceReferences: [] },
        reconstruction: {
          location: { timeZoneRequirements: ["Central or Eastern time"] },
          salary: { disclosure: "DISCLOSED" },
          travel: { statedPercentage: null, frequency: null, mandatory: null, scope: "UNKNOWN", purpose: "UNKNOWN", evidenceReferences: [] },
        },
      },
      jobEvaluation: {
        evaluated: true,
        evaluation: {
          practicalSummary: "Own onboarding, adoption, retention, and strategic customer relationships.",
          primaryWork: ["Customer adoption", "Retention planning"],
          customerLifecycleInvolvement: criterion,
          customerOwnership: criterion,
          strategicResponsibility: criterion,
          technicalExposure: { ...criterion, conclusion: "Moderate product exposure." },
          commercialResponsibility: { ...criterion, conclusion: "Supports renewals without owning sales." },
          crossFunctionalInvolvement: criterion,
          businessImpact: criterion,
          strategicBridgeValue: { classification: "HIGH", explanation: "Meaningful product collaboration.", evidenceReferences: ["jd-work"] },
          unknowns: unknown,
        },
      },
      companyAlignment: {
        evaluated: true,
        alignment: {
          alignmentSummary: "The SaaS workflow product aligns with the configured strategy.",
          businessModel: { classification: "SAAS", explanation: "Subscription software product.", evidenceReferences: ["jd-work"] },
          customerType: { classification: "LIGHT_B2B", explanation: "Customer teams use the product.", evidenceReferences: ["jd-work"] },
          productType: { classification: "WORKFLOW", explanation: "The product supports workflows.", evidenceReferences: ["jd-work"] },
          customerSegment: { classification: "MID_MARKET", explanation: "Mid-market customers are described.", evidenceReferences: ["jd-work"] },
          strategicAdvantages: supported,
          potentialConcerns: [],
          unknowns: unknown,
        },
      },
      organizationalMaturity: {
        evaluated: true,
        maturity: {
          score: 72,
          scoreExplanation: "An existing CS team and clear handoffs support good maturity.",
          summary: "A generally established Customer Success function.",
          existingCustomerSuccessFunction: { classification: "ESTABLISHED", explanation: "The role joins an existing team.", evidenceReferences: ["jd-work"] },
          customerOperatingModel: { classification: "ADOPTION_FOCUSED", explanation: "Adoption is primary.", evidenceReferences: ["jd-work"] },
          ownershipAndCrossFunctionalDesign: { summary: "CS owns outcomes and collaborates with Product and Support." },
          positiveSignals: supported,
          weakSignals: [],
          unknowns: unknown,
        },
      },
      alexFit: {
        evaluated: true,
        fit: {
          classification: "STRONG",
          summary: "Strong direct and transferable alignment.",
          experienceAlignment: { classification: "DIRECT", explanation: "Direct onboarding work is documented.", evidenceReferences: ["profile-work"] },
          careerStrategyAlignment: { explanation: "Supports a SaaS career bridge.", evidenceReferences: ["profile-work"] },
          strongestMatches: supported,
          partialMatches: [],
          concerns: [],
          strategicValue: supported,
          workingStyleAlignment: [{ alignment: "SUPPORTED", explanation: "Documented strategic work." }],
          unknowns: unknown,
        },
      },
      burnoutRisk: {
        evaluated: true,
        classification: "LOW",
        risk: {
          score: 24,
          scoreExplanation: "Clear ownership and handoffs reduce overload risk.",
          summary: "Mostly healthy workload design.",
          majorContributors: [],
          positiveIndicators: supported,
          unknowns: unknown,
        },
      },
      resumeMatch: {
        evaluated: true,
        band: "GOOD_HIGH",
        match: {
          score: 78,
          scoreExplanation: "Most core requirements have direct or transferable support.",
          summary: "Strong match with one non-decisive preferred gap.",
          effectiveSeniority: {
            effectiveLevelFit: "TARGET_LEVEL",
            explanation: "The practical responsibility scope matches the target level.",
            actualResponsibilitySeniority: { classification: "MID_LEVEL", explanation: "Independent portfolio ownership.", evidenceReferences: ["jd-work"] },
            evidenceReferences: ["jd-work"],
          },
          strongStrengths: supported,
          partialMatches: [{ finding: "Teaching experience transfers to enablement.", evidenceReferences: ["profile-work"] }],
          genuineGaps: [{ finding: "Preferred Salesforce experience is unsupported but non-decisive.", evidenceReferences: ["jd-work", "profile-work"] }],
          unknowns: unknown,
          positioningRecommendations: [{ recommendation: "Lead with onboarding and education outcomes." }],
          requirementAssessments: [
            {
              requirementText: "Customer education experience",
              classification: "TRANSFERABLE_MATCH",
              strength: "REQUIRED",
              matchedExperienceSpecificity: "TRANSFERABLE",
              explanation: "Teaching experience is transferable, not direct CS experience.",
              decisionImpact: "NON_DECISIVE",
              decisionImpactExplanation: "The transferable evidence is sufficient for review.",
              jdEvidenceReferences: ["jd-work"],
              profileEvidenceReferences: ["profile-work"],
            },
            {
              requirementText: "Salesforce experience",
              classification: "GENUINE_GAP",
              strength: "PREFERRED",
              matchedExperienceSpecificity: "UNSUPPORTED",
              explanation: "No Salesforce experience is documented.",
              decisionImpact: "NON_DECISIVE",
              decisionImpactExplanation: "The qualification is preferred, not decisive.",
              jdEvidenceReferences: ["jd-work"],
              profileEvidenceReferences: ["profile-work"],
            },
          ],
        },
      },
      opportunityPriority: {
        evaluated: true,
        band: "HIGH",
        timing: { classification: "STRONG_PRIORITY", explanation: "Recently posted.", ageDays: 2 },
        priority: {
          score: 81,
          scoreExplanation: "Strong strategic value and reasonable effort.",
          strategicValueSummary: "Useful SaaS and product collaboration experience.",
          applicationEffort: { classification: "MODERATE", explanation: "Some tailoring is useful.", evidenceReferences: ["jd-work"] },
          reasonsForPrioritization: supported,
          reasonsForReducedPriority: [],
          unknowns: unknown,
        },
      },
      ghostJobRisk: {
        evaluated: true,
        risk: {
          classification: "UNKNOWN",
          assessment: "Posting history is unavailable.",
          interpretation: "A supported risk classification cannot be made.",
          evidenceReferences: [],
          unknowns: unknown,
        },
      },
    },
    recommendation: {
      decision,
      explanation: `${decision === "APPLY" ? "Apply" : humanizeDecision(decision)} based on the persisted evaluation evidence.`,
      strongestPositives: supported,
      strongestConcerns: decision === "SKIP" ? [{ finding: "A decisive condition is present." }] : [],
      reviewConditions: decision === "REVIEW" ? unknown : [],
      unknowns: unknown,
      contradictions: [],
      evidenceReferences: ["jd-work", "profile-work"],
    },
    error: null,
    history: [{
      evaluationId,
      isLatest: true,
      status: "COMPLETED",
      evaluationStatus: "COMPLETED",
      decision,
      evaluationVersion: "cs-evaluation-v1.1-m9",
      promptVersion: "cs-m9-prompts-v1",
      userProfileVersion: 7,
      createdAt: "2026-08-17T12:00:00.000Z",
      completedAt: "2026-08-17T12:02:00.000Z",
    }],
  };
}

function humanizeDecision(value: string) {
  return value[0] + value.slice(1).toLowerCase();
}
