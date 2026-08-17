import type { SemanticExecutor } from "@ai-career/evaluation";
import type { CustomerSuccessSemanticOperations } from "../extraction/extractor";
import { semanticAlexFitSchema } from "../schemas/alex-fit";
import { semanticBurnoutRiskSchema } from "../schemas/burnout-risk";
import { semanticCompanyAlignmentSchema } from "../schemas/company-alignment";
import { semanticGhostJobRiskSchema } from "../schemas/ghost-job-risk";
import { semanticReconstructionSchema } from "../schemas/maps";
import { semanticOpportunityPrioritySchema } from "../schemas/opportunity-priority";
import { semanticOrganizationalMaturitySchema } from "../schemas/organizational-maturity";
import { semanticResumeMatchSchema } from "../schemas/resume-match";
import { semanticJobEvaluationSchema } from "../schemas/results";

export const customerSuccessProductionPromptVersion = "cs-m9-prompts-v1";

const systemRules = [
  "You are a bounded semantic-analysis component in the AI Career Platform.",
  "Use only supplied evidence. Preserve Unknown when evidence is insufficient.",
  "Distinguish explicit facts from cautious inferences and preserve contradictions.",
  "Every substantive conclusion must cite an available evidence reference.",
  "Do not calculate or choose the final Apply, Review, or Skip recommendation.",
].join(" ");

function operation<T>(
  executor: SemanticExecutor,
  input: {
    operationId: string;
    schema: Parameters<SemanticExecutor["execute"]>[0]["schema"];
    instructions: string;
    userConfiguration?: unknown;
    trustedContext: T;
    untrustedSourceContent?: string | null;
  },
) {
  return executor.execute({
    operationId: input.operationId,
    promptVersion: customerSuccessProductionPromptVersion,
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
    reconstructJobDescription(input) {
      const { untrustedJobDescription, ...trustedContext } = input;
      return operation(executor, {
        operationId: "customer-success.jd-reconstruction",
        schema: semanticReconstructionSchema,
        instructions:
          "Reconstruct actual Customer Success work into the Responsibility, Requirement, Ownership, and role-metadata maps. Do not treat isolated titles or buzzwords as proof. Create evidence records only from the supplied job description and retain source/provenance identifiers.",
        trustedContext,
        untrustedSourceContent: untrustedJobDescription,
      });
    },
    evaluateJob(input) {
      return operation(executor, {
        operationId: "customer-success.job-evaluation",
        schema: semanticJobEvaluationSchema,
        instructions:
          "Explain the practical work using the validated Responsibility and Ownership maps. Assess lifecycle, ownership, strategy, technical and commercial exposure, cross-functional work, business impact, and Strategic Bridge Value without rereading the raw JD.",
        trustedContext: input,
      });
    },
    evaluateCompanyAlignment(input) {
      const { preferences, ...trustedContext } = input;
      return operation(executor, {
        operationId: "customer-success.company-alignment",
        schema: semanticCompanyAlignmentSchema,
        instructions:
          "Classify business model, customer type, product type, and customer segment from evidence. Evaluate contextual alignment with the supplied preferences without numerical scoring or unsupported company assumptions.",
        userConfiguration: preferences,
        trustedContext,
      });
    },
    evaluateOrganizationalMaturity(input) {
      return operation(executor, {
        operationId: "customer-success.organizational-maturity",
        schema: semanticOrganizationalMaturitySchema,
        instructions:
          "Assess the existing CS function, customer operating model, and ownership design from the validated maps and earlier results. Produce the bounded holistic maturity assessment without weights, keyword points, prestige, culture, or management assumptions.",
        trustedContext: input,
      });
    },
    evaluateAlexFit(input) {
      const { preferences, ...trustedContext } = input;
      return operation(executor, {
        operationId: "customer-success.alex-fit",
        schema: semanticAlexFitSchema,
        instructions:
          "Assess categorical fit against the supplied versioned candidate profile and preferences. Distinguish direct, related, and transferable experience and do not invent candidate facts.",
        userConfiguration: preferences,
        trustedContext,
      });
    },
    evaluateBurnoutRisk(input) {
      const { preferences, ...trustedContext } = input;
      return operation(executor, {
        operationId: "customer-success.burnout-risk",
        schema: semanticBurnoutRiskSchema,
        instructions:
          "Assess workload and burnout risk from evidenced role design, ownership, travel, and prior validated results. Broad collaboration alone is not scope creep, and missing information is not negative evidence.",
        userConfiguration: preferences,
        trustedContext,
      });
    },
    evaluateResumeMatch(input) {
      const { preferences, ...trustedContext } = input;
      return operation(executor, {
        operationId: "customer-success.resume-match",
        schema: semanticResumeMatchSchema,
        instructions:
          "Compare every supplied Requirement Map entry to separately identified JD and candidate-profile evidence. Preserve requirement metadata and order. Distinguish direct, partial, transferable, and genuine gaps. A required gap is decisive only with JD and profile evidence proving it is a true must-have disqualifier; ambiguity must remain material uncertainty.",
        userConfiguration: preferences,
        trustedContext,
      });
    },
    evaluateOpportunityPriority(input) {
      return operation(executor, {
        operationId: "customer-success.opportunity-priority",
        schema: semanticOpportunityPrioritySchema,
        instructions:
          "Assess application timing and strategic attention from the supplied validated factors. Do not consume or predict the final recommendation, and do not use a weighted formula.",
        trustedContext: input,
      });
    },
    evaluateGhostJobRisk(input) {
      return operation(executor, {
        operationId: "customer-success.ghost-job-risk",
        schema: semanticGhostJobRiskSchema,
        instructions:
          "Assess categorical Ghost Job Risk only from supplied objective posting-history facts. Do not invent history; insufficient evidence must remain UNKNOWN.",
        trustedContext: input,
      });
    },
  };
}
