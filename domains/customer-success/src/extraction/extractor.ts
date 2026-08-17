import type { CoreEvaluationContext } from "@ai-career/evaluation";
import {
  customerSuccessJdReconstructionSchema,
  semanticReconstructionSchema,
  type CustomerSuccessJdReconstruction,
} from "../schemas/maps";
import type { CustomerSuccessDomainData } from "../evaluator";
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
