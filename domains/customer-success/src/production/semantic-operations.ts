import type { SemanticExecutor } from "@ai-career/evaluation";
import type { ZodType } from "zod";
import type { CustomerSuccessSemanticOperations } from "../extraction/extractor";
import {
  semanticAlexFitFromTransport,
  semanticAlexFitTransportSchema,
} from "../schemas/alex-fit";
import {
  semanticBurnoutRiskFromTransport,
  semanticBurnoutRiskTransportSchema,
} from "../schemas/burnout-risk";
import {
  semanticCompanyAlignmentFromTransport,
  semanticCompanyAlignmentTransportSchema,
} from "../schemas/company-alignment";
import {
  semanticGhostJobRiskFromTransport,
  semanticGhostJobRiskTransportSchema,
} from "../schemas/ghost-job-risk";
import {
  semanticReconstructionFromTransport,
  semanticReconstructionTransportSchema,
} from "../schemas/maps";
import {
  customerSuccessOpportunityPriorityPromptVersion,
  opportunityPriorityEvidenceCatalog,
  semanticOpportunityPriorityFromTransport,
  semanticOpportunityPriorityTransportSchema,
} from "../schemas/opportunity-priority";
import {
  createSemanticOrganizationalMaturityTransportSchema,
  customerSuccessOrganizationalMaturityPromptVersion,
  organizationalMaturitySemanticInstructions,
  organizationalMaturityRelationshipCatalog,
  semanticOrganizationalMaturityFromTransport,
} from "../schemas/organizational-maturity";
import {
  semanticResumeMatchFromTransport,
  semanticResumeMatchRequirementsForProvider,
  semanticResumeMatchTransportSchema,
} from "../schemas/resume-match";
import {
  semanticJobEvaluationFromTransport,
  semanticJobEvaluationTransportSchema,
} from "../schemas/results";

export const customerSuccessProductionPromptVersion = "cs-m9-prompts-v1";

export const customerSuccessSemanticOperationIds = [
  "customer-success.jd-reconstruction",
  "customer-success.job-evaluation",
  "customer-success.company-alignment",
  "customer-success.organizational-maturity",
  "customer-success.alex-fit",
  "customer-success.burnout-risk",
  "customer-success.resume-match",
  "customer-success.opportunity-priority",
  "customer-success.ghost-job-risk",
] as const;

export type CustomerSuccessSemanticOperationId =
  (typeof customerSuccessSemanticOperationIds)[number];

const systemRules = [
  "You are a bounded semantic-analysis component in the AI Career Platform.",
  "Use only supplied evidence. Preserve Unknown when evidence is insufficient.",
  "Distinguish explicit facts from cautious inferences and preserve contradictions.",
  "Every substantive conclusion must cite an available evidence reference.",
  "Do not calculate or choose the final Apply, Review, or Skip recommendation.",
].join(" ");

function operation<TContext, TOutput>(
  executor: SemanticExecutor,
  input: {
    operationId: string;
    promptVersion?: string;
    schema: ZodType<TOutput>;
    instructions: string;
    userConfiguration?: unknown;
    trustedContext: TContext;
    untrustedSourceContent?: string | null;
  },
) {
  return executor.execute({
    operationId: input.operationId,
    promptVersion: input.promptVersion ?? customerSuccessProductionPromptVersion,
    schema: input.schema,
    systemRules,
    domainInstructions: input.instructions,
    userConfiguration: input.userConfiguration ?? {},
    trustedContext: input.trustedContext,
    untrustedSourceContent: input.untrustedSourceContent,
  });
}

export function createProductionCustomerSuccessSemanticOperations(
  executor: SemanticExecutor,
): CustomerSuccessSemanticOperations {
  return {
    async reconstructJobDescription(input) {
      const { untrustedJobDescription, ...trustedContext } = input;
      return semanticReconstructionFromTransport(
        await operation(executor, {
          operationId: "customer-success.jd-reconstruction",
          schema: semanticReconstructionTransportSchema,
          instructions:
            "Reconstruct actual Customer Success work into the Responsibility, Requirement, Ownership, and role-metadata maps. Do not treat isolated titles or buzzwords as proof. Create evidence records only from the supplied job description and retain source/provenance identifiers.",
          trustedContext,
          untrustedSourceContent: untrustedJobDescription,
        }),
      );
    },
    async evaluateJob(input) {
      const { availableEvidence, ...trustedContext } = input;
      return semanticJobEvaluationFromTransport(
        await operation(executor, {
          operationId: "customer-success.job-evaluation",
          schema: semanticJobEvaluationTransportSchema,
          instructions:
            "Explain the practical work using the validated Responsibility and Ownership maps. Assess lifecycle, ownership, strategy, technical and commercial exposure, cross-functional work, business impact, and Strategic Bridge Value without rereading the raw JD.",
          trustedContext,
        }),
        availableEvidence,
      );
    },
    async evaluateCompanyAlignment(input) {
      const { preferences, ...trustedContext } = input;
      return semanticCompanyAlignmentFromTransport(
        await operation(executor, {
          operationId: "customer-success.company-alignment",
          schema: semanticCompanyAlignmentTransportSchema,
          instructions:
            "Classify business model, customer type, product type, and customer segment from evidence. Evaluate contextual alignment with the supplied preferences without numerical scoring or unsupported company assumptions.",
          userConfiguration: preferences,
          trustedContext,
        }),
        input.availableEvidence,
      );
    },
    async evaluateOrganizationalMaturity(input) {
      const crossFunctionalRelationshipCatalog =
        organizationalMaturityRelationshipCatalog(
          input.ownershipMap,
          input.availableEvidence,
        );
      return semanticOrganizationalMaturityFromTransport(
        await operation(executor, {
          operationId: "customer-success.organizational-maturity",
          promptVersion: customerSuccessOrganizationalMaturityPromptVersion,
          schema: createSemanticOrganizationalMaturityTransportSchema(
            input.responsibilityMap,
            crossFunctionalRelationshipCatalog,
          ),
          instructions: organizationalMaturitySemanticInstructions,
          trustedContext: { ...input, crossFunctionalRelationshipCatalog },
        }),
        input.availableEvidence,
        input.responsibilityMap,
        crossFunctionalRelationshipCatalog,
      );
    },
    async evaluateAlexFit(input) {
      const { preferences, ...trustedContext } = input;
      return semanticAlexFitFromTransport(
        await operation(executor, {
          operationId: "customer-success.alex-fit",
          schema: semanticAlexFitTransportSchema,
          instructions:
            "Assess categorical fit against the supplied versioned candidate profile and preferences. Distinguish direct, related, and transferable experience and do not invent candidate facts.",
          userConfiguration: preferences,
          trustedContext,
        }),
        input.availableEvidence,
      );
    },
    async evaluateBurnoutRisk(input) {
      const { preferences, ...trustedContext } = input;
      return semanticBurnoutRiskFromTransport(
        await operation(executor, {
          operationId: "customer-success.burnout-risk",
          schema: semanticBurnoutRiskTransportSchema,
          instructions:
            "Assess workload and burnout risk from evidenced role design, ownership, travel, and prior validated results. Broad collaboration alone is not scope creep, and missing information is not negative evidence.",
          userConfiguration: preferences,
          trustedContext,
        }),
        input.availableEvidence,
      );
    },
    async evaluateResumeMatch(input) {
      const { preferences, requirementMap, ...trustedContext } = input;
      return semanticResumeMatchFromTransport(
        await operation(executor, {
          operationId: "customer-success.resume-match",
          schema: semanticResumeMatchTransportSchema,
          instructions:
            "Compare every supplied Requirement Map entry to separately identified JD and candidate-profile evidence. Preserve requirement metadata and order. Distinguish direct, partial, transferable, and genuine gaps. A required gap is decisive only with JD and profile evidence proving it is a true must-have disqualifier; ambiguity must remain material uncertainty.",
          userConfiguration: preferences,
          trustedContext: {
            ...trustedContext,
            requirementMap:
              semanticResumeMatchRequirementsForProvider(requirementMap),
          },
        }),
        requirementMap,
        input.availableEvidence,
      );
    },
    async evaluateOpportunityPriority(input) {
      const { availableEvidence, ...validatedFactors } = input;
      return semanticOpportunityPriorityFromTransport(
        await operation(executor, {
          operationId: "customer-success.opportunity-priority",
          promptVersion: customerSuccessOpportunityPriorityPromptVersion,
          schema: semanticOpportunityPriorityTransportSchema,
          instructions:
            "Assess application timing and strategic attention from the supplied validated factors. Every provider evidenceIndexes field must contain only zero-based evidenceIndex values from availableEvidenceCatalog. Upstream field names and stage/result names are context labels, not evidence indexes. Cite the underlying catalog evidence supporting an upstream conclusion. Do not consume or predict the final recommendation, and do not use a weighted formula.",
          trustedContext: {
            ...validatedFactors,
            availableEvidenceCatalog:
              opportunityPriorityEvidenceCatalog(availableEvidence),
          },
        }),
        {
          availableEvidence,
          postingTimingEvidenceReferences:
            input.postingTiming.evidenceReferences,
        },
      );
    },
    async evaluateGhostJobRisk(input) {
      return semanticGhostJobRiskFromTransport(
        await operation(executor, {
          operationId: "customer-success.ghost-job-risk",
          schema: semanticGhostJobRiskTransportSchema,
          instructions:
            "Assess categorical Ghost Job Risk only from supplied objective posting-history facts. Do not invent history; insufficient evidence must remain UNKNOWN.",
          trustedContext: input,
        }),
        input,
      );
    },
  };
}
