import type { EvidenceRecordDraft } from "@ai-career/evidence";
import {
  deterministicRequirementCriterionId,
  normalizeSourceSpan,
  type CustomerSuccessJdReconstruction,
} from "../schemas/maps";

type Requirement = CustomerSuccessJdReconstruction["requirements"][number];

// Characters that carry content; separators between quoted spans do not.
const contentCharacter = /[\p{L}\p{N}]/u;

// A deterministic line is covered when the quoted spans of JD Reconstruction
// source statements cover all of its content: one quote containing it, or
// quotes inside it that together span every content character. A line only
// partly covered stays as the deterministic floor.
function isCovered(line: string, quotes: readonly string[]) {
  const covered = new Array<boolean>(line.length).fill(false);
  for (const quote of quotes) {
    if (quote.includes(line)) return true;
    for (
      let start = line.indexOf(quote);
      start >= 0;
      start = line.indexOf(quote, start + 1)
    ) {
      covered.fill(true, start, start + quote.length);
    }
  }
  return [...line].every(
    (character, index) => covered[index] || !contentCharacter.test(character),
  );
}

/**
 * Reconciles deterministically extracted requirement lines with JD
 * Reconstruction source statements by source-span identity. A covered line is
 * represented by the statement's qualifications, which control its fields; an
 * uncovered line remains as the source-grounded floor. Pure and idempotent.
 */
export function reconcileRequirementMap(input: {
  requirements: readonly Requirement[];
  evidence: readonly EvidenceRecordDraft[];
}): { requirements: Requirement[]; evidence: EvidenceRecordDraft[] } {
  const evidenceByReference = new Map(
    input.evidence.map((item) => [item.referenceId, item]),
  );
  const statementQuotes = [
    ...new Set(
      input.requirements
        .filter((requirement) => requirement.sourceStatement !== undefined)
        .flatMap((requirement) => requirement.evidenceReferences)
        .flatMap((reference) => {
          const sourceText = evidenceByReference.get(reference)?.sourceText;
          return sourceText ? [normalizeSourceSpan(sourceText)] : [];
        }),
    ),
  ];
  const isDeterministicEvidence = (reference: string) =>
    evidenceByReference.get(reference)?.criterionId ===
    deterministicRequirementCriterionId;
  const coveredReferences = new Set<string>();
  const requirements = input.requirements.filter((requirement) => {
    if (
      requirement.sourceStatement !== undefined ||
      !requirement.evidenceReferences.every(isDeterministicEvidence)
    ) {
      return true;
    }
    const lines = requirement.evidenceReferences.map((reference) =>
      normalizeSourceSpan(evidenceByReference.get(reference)!.sourceText ?? ""),
    );
    if (lines.some((line) => line.length === 0 || !isCovered(line, statementQuotes))) {
      return true;
    }
    for (const reference of requirement.evidenceReferences) {
      coveredReferences.add(reference);
    }
    return false;
  });
  const retainedReferences = new Set(
    requirements.flatMap((requirement) => requirement.evidenceReferences),
  );
  return {
    requirements,
    evidence: input.evidence.filter(
      (item) =>
        !coveredReferences.has(item.referenceId) ||
        retainedReferences.has(item.referenceId),
    ),
  };
}
