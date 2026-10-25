import type { CoreEvaluationContext } from "@ai-career/evaluation";
import type { EvidenceRecordDraft } from "@ai-career/evidence";
import { parseCompensation } from "@ai-career/normalization";
import type {
  CustomerSuccessDomainData,
} from "../evaluator";
import {
  deterministicRequirementCriterionId,
  type CustomerSuccessJdReconstruction,
} from "../schemas/maps";

type ExplicitFacts = Pick<
  CustomerSuccessJdReconstruction,
  "location" | "salary" | "travel"
> & {
  requirements: CustomerSuccessJdReconstruction["requirements"];
  evidence: EvidenceRecordDraft[];
};

function sourceContext(context: CoreEvaluationContext<CustomerSuccessDomainData>) {
  const source = context.rawSources[0];
  const descriptionProvenance = context.provenance.find(
    (item) => item.fieldName === "jobDescription",
  );
  return { source, descriptionProvenance };
}

function evidence(input: {
  context: CoreEvaluationContext<CustomerSuccessDomainData>;
  referenceId: string;
  criterionId: string;
  claim: string;
  sourceField: string;
  sourceText: string;
  provenanceFieldName?: string;
  provenance?: CoreEvaluationContext<CustomerSuccessDomainData>["provenance"][number] | null;
  origin?: EvidenceRecordDraft["origin"];
}): EvidenceRecordDraft {
  const { source, descriptionProvenance } = sourceContext(input.context);
  const fieldProvenance =
    input.provenance ??
    (input.provenanceFieldName
      ? input.context.provenance.find(
          (item) => item.fieldName === input.provenanceFieldName,
        )
      : null);
  return {
    referenceId: input.referenceId,
    criterionId: input.criterionId,
    claim: input.claim,
    sourceType: source?.sourceType ?? "MANUAL",
    sourceRecordId: fieldProvenance?.sourceRecordId ?? source?.id ?? null,
    provenanceId: fieldProvenance?.id ?? descriptionProvenance?.id ?? null,
    sourceField: fieldProvenance?.sourceField ?? input.sourceField,
    sourceReference:
      fieldProvenance?.sourceReference ??
      source?.sourceUrl ??
      "manual-submission",
    sourceText: fieldProvenance?.sourceText ?? input.sourceText,
    evidenceType: "EXPLICIT_JOB_FACT",
    origin: input.origin ?? "EXPLICIT",
    evidenceLevel: "CONFIRMED",
    collectedAt: null,
  };
}

function parseSalary(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  text: string,
): Pick<ExplicitFacts, "salary" | "evidence"> {
  const supplied = context.opportunity.salaryText;
  const candidate = supplied ?? text;
  const competitive = /\bcompetitive (?:salary|compensation|pay)\b/i.test(candidate);
  const fallback =
    context.opportunity.salaryMin === null &&
    context.opportunity.salaryMax === null &&
    context.opportunity.currency === null
      ? parseCompensation(supplied, null)
      : null;
  const minimum = context.opportunity.salaryMin ?? fallback?.minimum ?? null;
  const maximum = context.opportunity.salaryMax ?? fallback?.maximum ?? null;
  const currency = context.opportunity.currency ?? fallback?.currency ?? null;
  if (minimum === null && maximum === null && competitive) {
    const item = evidence({
      context,
      referenceId: "salary-competitive",
      criterionId: "salary",
      claim: "The job describes compensation only as competitive.",
      sourceField: supplied ? "salaryText" : "jobDescription",
      sourceText: supplied ?? "Competitive salary",
    });
    return {
      salary: {
        minimum: null,
        maximum: null,
        currency: null,
        disclosure: "COMPETITIVE",
        evidenceReferences: [item.referenceId],
      },
      evidence: [item],
    };
  }
  if (minimum === null && maximum === null) {
    return {
      salary: {
        minimum: null,
        maximum: null,
        currency: null,
        disclosure: "UNDISCLOSED",
        evidenceReferences: [],
      },
      evidence: [],
    };
  }
  const sourceText = supplied ?? candidate;
  const item = evidence({
    context,
    referenceId: "salary-disclosed",
    criterionId: "salary",
    claim: `The normalized annual salary is ${minimum ?? "Unknown"} to ${maximum ?? "Unknown"} ${currency ?? "with Unknown currency"}.`,
    sourceField: supplied ? "salaryText" : "jobDescription",
    sourceText,
    provenanceFieldName:
      minimum !== null ? "salaryMin" : maximum !== null ? "salaryMax" : undefined,
    origin: "DERIVED",
  });
  const currencyProvenance = context.provenance.find(
    (provenance) => provenance.fieldName === "currency",
  );
  const currencyEvidence =
    currency !== null && currencyProvenance
      ? evidence({
          context,
          referenceId: "salary-currency-normalized",
          criterionId: "salary",
          claim: `The normalized salary currency is ${currency}.`,
          sourceField: currencyProvenance.sourceField,
          sourceText: currencyProvenance.sourceText ?? currency,
          provenance: currencyProvenance,
          origin:
            currencyProvenance.kind === "DIRECT" ? "EXPLICIT" : "DERIVED",
        })
      : null;
  const basis = context.opportunity.compensationBasis;
  const basisProvenance = context.provenance.find(
    (provenance) => provenance.fieldName === "compensationBasis",
  );
  const basisEvidence =
    basis !== null
      ? evidence({
          context,
          referenceId: "salary-compensation-basis",
          criterionId: "salary",
          claim: `The normalized compensation basis is ${basis}.`,
          sourceField: basisProvenance?.sourceField ?? "compensationBasis",
          sourceText: basisProvenance?.sourceText ?? supplied ?? sourceText,
          provenance: basisProvenance,
          origin:
            basisProvenance?.kind === "DIRECT" ? "EXPLICIT" : "DERIVED",
        })
      : null;
  const evidenceRecords = [item, currencyEvidence, basisEvidence].filter(
    (record): record is EvidenceRecordDraft => record !== null,
  );
  return {
    salary: {
      minimum,
      maximum,
      currency,
      disclosure: "DISCLOSED",
      evidenceReferences: evidenceRecords.map((record) => record.referenceId),
    },
    evidence: evidenceRecords,
  };
}

function residencyEvidence(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
): EvidenceRecordDraft[] {
  const requirement = context.opportunity.residencyRequirement;
  if (requirement === null) return [];
  const provenance = context.provenance.filter((item) =>
    ["residencyRequirement", "residencyRegions"].includes(item.fieldName),
  );
  const candidates = provenance.length > 0 ? provenance : [null];
  return candidates.map((item, index) =>
    evidence({
      context,
      referenceId: `residency-normalized-${index + 1}`,
      criterionId: "residency",
      claim: `The normalized residency policy is ${requirement}; eligible regions are ${context.opportunity.residencyRegions.join(", ") || "not stated"}.`,
      sourceField: item?.sourceField ?? "residencyRequirement",
      sourceText:
        item?.sourceText ??
        context.opportunity.location ??
        context.opportunity.jobDescription ??
        requirement,
      provenance: item,
      origin: item?.kind === "DIRECT" ? "EXPLICIT" : "DERIVED",
    }),
  );
}

function matchingSentence(text: string, pattern: RegExp): string | null {
  return (
    text
      .split(/(?<=[.!?])\s+|\r?\n/)
      .map((part) => part.trim())
      .find((part) => pattern.test(part)) ?? null
  );
}

function parseLocation(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  text: string,
): Pick<ExplicitFacts, "location" | "evidence"> {
  const combined = `${context.opportunity.location ?? ""}\n${text}`;
  const sourceText = matchingSentence(
    combined,
    /remote|hybrid|on[- ]site|resid|country|time\s*zone|visa|relocat|employer of record|\bEOR\b|Deel|Oyster/i,
  );
  const remoteStatus = /\bhybrid\b/i.test(combined)
    ? "HYBRID"
    : /\b(?:on[- ]site|in[- ]office)\b/i.test(combined)
      ? "ONSITE"
      : /\bremote\b/i.test(combined)
        ? "REMOTE"
        : "UNKNOWN";
  const usOnly = /(?:us|u\.s\.|united states)[ -]only|must (?:reside|be based) in (?:the )?(?:us|u\.s\.|united states)/i.test(
    combined,
  );
  const worldwide = /worldwide|anywhere in the world|international candidates (?:are )?(?:welcome|eligible)/i.test(
    combined,
  );
  const countryMatch = combined.match(
    /(?:may reside in|must reside in|must be based in|candidates? (?:located|based) in)\s+([A-Z][A-Za-z ]{2,30})/,
  );
  const timeZones = [
    ...combined.matchAll(/\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT|UTC[+-]\d{1,2})\b/g),
  ].map((match) => match[0]);
  const item = sourceText
    ? evidence({
        context,
        referenceId: "location-facts",
        criterionId: "location",
        claim: "The job states location or work-arrangement information.",
        sourceField: "jobDescription",
        sourceText,
      })
    : null;
  return {
    location: {
      countryRestrictions: usOnly
        ? ["United States"]
        : countryMatch?.[1]
          ? [countryMatch[1].trim()]
          : [],
      remoteStatus,
      timeZoneRequirements: [...new Set(timeZones)],
      internationalEligibility: worldwide
        ? "EXPLICITLY_ALLOWED"
        : usOnly
          ? "EXPLICITLY_NOT_ALLOWED"
          : "UNKNOWN",
      visaSponsorship: /visa sponsorship (?:is )?(?:available|provided)/i.test(combined)
        ? "AVAILABLE"
        : /no visa sponsorship|unable to sponsor/i.test(combined)
          ? "NOT_AVAILABLE"
          : "UNKNOWN",
      relocation: /relocation (?:is )?(?:available|provided)/i.test(combined)
        ? "AVAILABLE"
        : /relocation required/i.test(combined)
          ? "REQUIRED"
          : /no relocation/i.test(combined)
            ? "NOT_AVAILABLE"
            : "UNKNOWN",
      eor: /employer of record|\bEOR\b|\bDeel\b|\bOyster\b/i.test(combined)
        ? "AVAILABLE"
        : "UNKNOWN",
      evidenceReferences: item ? [item.referenceId] : [],
    },
    evidence: item ? [item] : [],
  };
}

function parseTravel(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  text: string,
): Pick<ExplicitFacts, "travel" | "evidence"> {
  const sourceText = matchingSentence(text, /travel|on[- ]site|onsite|conference|retreat|kickoff/i);
  if (!sourceText) {
    return {
      travel: {
        statedPercentage: null,
        frequency: null,
        mandatory: null,
        scope: "UNKNOWN",
        purpose: "UNKNOWN",
        evidenceReferences: [],
      },
      evidence: [],
    };
  }
  const percentage = sourceText.match(/(\d{1,3})\s*%/);
  const purpose = /\b(?:no travel|travel (?:is )?not required|zero travel)\b/i.test(
    sourceText,
  )
    ? "NONE"
    : /field travel|territory travel/i.test(sourceText)
      ? "FIELD_TRAVEL"
      : /customer|client/i.test(sourceText)
        ? "CUSTOMER_ONSITE"
        : /retreat|kickoff|team gathering|company meeting/i.test(sourceText)
          ? "COMPANY_EVENT"
          : /conference/i.test(sourceText)
            ? "CONFERENCE"
            : "OTHER";
  const frequency = sourceText.match(
    /\b(weekly|monthly|quarterly|annually|annual|occasionally|occasional|rare|infrequent|frequent|recurring)\b/i,
  )?.[1] ?? null;
  const item = evidence({
    context,
    referenceId: "travel-facts",
    criterionId: "travel",
    claim: "The job states a travel expectation.",
    sourceField: "jobDescription",
    sourceText,
  });
  return {
    travel: {
      statedPercentage: percentage?.[1] ? Number(percentage[1]) : null,
      frequency,
      mandatory:
        purpose === "NONE"
          ? false
          : /required|must|will travel|travel is expected/i.test(sourceText)
            ? true
            : /optional/i.test(sourceText)
              ? false
              : null,
      scope: /domestic and international|international and domestic/i.test(sourceText)
        ? "BOTH"
        : /international/i.test(sourceText)
          ? "INTERNATIONAL"
          : /domestic/i.test(sourceText)
            ? "DOMESTIC"
            : "UNKNOWN",
      purpose,
      evidenceReferences: [item.referenceId],
    },
    evidence: [item],
  };
}

function requirementCategory(value: string) {
  if (/travel/i.test(value)) return "TRAVEL" as const;
  if (/location|reside|based in|time\s*zone/i.test(value)) return "LOCATION" as const;
  if (/degree|bachelor|master/i.test(value)) return "EDUCATION" as const;
  if (/certif/i.test(value)) return "CERTIFICATION" as const;
  if (/language|fluent|bilingual/i.test(value)) return "LANGUAGE" as const;
  if (/software|platform|tool|salesforce|gainsight|hubspot/i.test(value)) return "TOOL" as const;
  if (/technical|api|integration|data|analytics/i.test(value)) return "TECHNICAL_KNOWLEDGE" as const;
  if (/industry|saas|fintech|healthcare/i.test(value)) return "INDUSTRY" as const;
  if (/experience|years?/i.test(value)) return "EXPERIENCE" as const;
  return "CAPABILITY" as const;
}

// Section labels such as "Required" or "Nice to Have" match the candidate
// pattern but state no requirement. A line made only of these closed-set label
// words is a heading, not a requirement.
const requirementLabelWords = new Set([
  "required",
  "requirements",
  "preferred",
  "ideal",
  "ideally",
  "nice",
  "to",
  "have",
  "must",
  "qualifications",
  "bonus",
]);

function isRequirementLabel(value: string) {
  const words = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => requirementLabelWords.has(word));
}

function parseRequirements(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  text: string,
): Pick<ExplicitFacts, "requirements" | "evidence"> {
  const candidates = text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((value) => value.replace(/^[-*•]\s*/, "").trim())
    .filter(
      (value) =>
        value.length >= 8 &&
        !isRequirementLabel(value) &&
        /\brequired\b|\bmust have\b|\bpreferred\b|\bideal(?:ly)?\b|nice to have|\d+(?:\s*(?:-|–|—|to)\s*\d+)?\+?\s+years? of experience/i.test(
          value,
        ),
    );
  const requirements: ExplicitFacts["requirements"] = [];
  const evidenceItems: EvidenceRecordDraft[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const strength = /nice to have/i.test(candidate)
      ? "NICE_TO_HAVE"
      : /\bpreferred\b/i.test(candidate)
        ? "PREFERRED"
        : /\bideal(?:ly)?\b/i.test(candidate)
          ? "IDEAL"
          : /\brequired\b|\bmust have\b/i.test(candidate)
            ? "REQUIRED"
            : "AMBIGUOUS";
    const referenceId = `requirement-${index + 1}`;
    const item = evidence({
      context,
      referenceId,
      criterionId: deterministicRequirementCriterionId,
      claim: "The job states a candidate requirement.",
      sourceField: "jobDescription",
      sourceText: candidate,
    });
    evidenceItems.push(item);
    const yearsRange = candidate.match(
      /(\d+)\s*(?:-|–|—|to)\s*(\d+)(\+)?\s+years?/i,
    );
    const singleYears = candidate.match(/(\d+)(\+)?\s+years?/i);
    const minimumYears = yearsRange?.[1] ?? singleYears?.[1];
    const maximumYears = yearsRange?.[2] ?? null;
    const openEnded = Boolean(yearsRange?.[3] ?? singleYears?.[2]);
    requirements.push({
      requirement: candidate,
      category: requirementCategory(candidate),
      strength,
      statedYears: minimumYears ? Number(minimumYears) : null,
      statedYearsMaximum: maximumYears ? Number(maximumYears) : null,
      statedYearsOpenEnded: openEnded,
      experienceSpecificity: /customer success/i.test(candidate)
        ? "Customer Success"
        : /experience/i.test(candidate)
          ? "Experience area stated in source text"
          : null,
      // Deterministic extraction asserts no experience-level or startup
      // semantics.
      requiresStartupExperience: false,
      evidenceReferences: [referenceId],
      ambiguity: {
        isAmbiguous: strength === "AMBIGUOUS",
        explanation:
          strength === "AMBIGUOUS"
            ? "The source states experience but does not label its strength."
            : null,
      },
    });
  }
  return { requirements, evidence: evidenceItems };
}

export function extractExplicitCustomerSuccessFacts(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  text: string,
): ExplicitFacts {
  const salary = parseSalary(context, text);
  const residency = residencyEvidence(context);
  const location = parseLocation(context, text);
  const travel = parseTravel(context, text);
  const requirements = parseRequirements(context, text);
  return {
    salary: salary.salary,
    location: location.location,
    travel: travel.travel,
    requirements: requirements.requirements,
    evidence: [
      ...salary.evidence,
      ...residency,
      ...location.evidence,
      ...travel.evidence,
      ...requirements.evidence,
    ],
  };
}
