import { StageExecutionError } from "@ai-career/evaluation";
import type { EvidenceRecordDraft } from "@ai-career/evidence";
import { z } from "zod";

export type AvailableSemanticEvidence = Pick<
  EvidenceRecordDraft,
  "referenceId" | "sourceType"
>;

export function semanticContractViolation(
  code: string,
  message: string,
): never {
  throw new StageExecutionError({ code, message, retryable: false });
}

export function parseSemanticDomainResult<T>(input: {
  schema: z.ZodType<T>;
  value: unknown;
  code: string;
  message: string;
}): T {
  const parsed = input.schema.safeParse(input.value);
  if (!parsed.success) {
    semanticContractViolation(input.code, input.message);
  }
  return parsed.data;
}

export function assertSemanticEvidenceReferences(input: {
  references: Iterable<string>;
  availableEvidence: AvailableSemanticEvidence[];
  code: string;
  message: string;
}) {
  const known = new Set(
    input.availableEvidence.map((evidence) => evidence.referenceId),
  );
  for (const reference of input.references) {
    if (!known.has(reference)) {
      semanticContractViolation(input.code, input.message);
    }
  }
}
