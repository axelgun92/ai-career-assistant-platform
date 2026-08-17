import type { CoreEvaluationContext } from "@ai-career/evaluation";
import type { EvidenceRecordDraft } from "@ai-career/evidence";
import type {
  CustomerSuccessDomainData,
} from "../evaluator";
import type {
  CustomerSuccessJdReconstruction,
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
}): EvidenceRecordDraft {
  const { source, descriptionProvenance } = sourceContext(input.context);
  return {
    referenceId: input.referenceId,
    criterionId: input.criterionId,
    claim: input.claim,
    sourceType: source?.sourceType ?? "MANUAL",
    sourceRecordId: source?.id ?? null,
    provenanceId: descriptionProvenance?.id ?? null,
    sourceField: input.sourceField,
    sourceReference: source?.sourceUrl ?? "manual-submission",
    sourceText: input.sourceText,
    evidenceType: "EXPLICIT_JOB_FACT",
    origin: "EXPLICIT",
    evidenceLevel: "CONFIRMED",
    collectedAt: null,
  };
}

function parseMoney(value: string): number | null {
  const match = value.match(/\$\s*([0-9]{2,3}(?:,[0-9]{3})?|[0-9]{2,3})\s*(k)?/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replaceAll(",", ""));
  return match[2] ? parsed * 1_000 : parsed;
}

function parseSalary(
  context: CoreEvaluationContext<CustomerSuccessDomainData>,
  text: string,
): Pick<ExplicitFacts, "salary" | "evidence"> {
  const supplied = context.opportunity.salaryText;
  const candidate = supplied ?? text;
  const competitive = /\bcompetitive (?:salary|compensation|pay)\b/i.test(candidate);
  const range = candidate.match(
    /\$\s*([0-9]{2,3}(?:,[0-9]{3})?|[0-9]{2,3})\s*(k)?\s*(?:-|–|—|to)\s*\$?\s*([0-9]{2,3}(?:,[0-9]{3})?|[0-9]{2,3})\s*(k)?/i,
  );
  const normalize = (amount: string, thousands: string | undefined) =>
    Number(amount.replaceAll(",", "")) * (thousands ? 1_000 : 1);
  const minimum =
    context.opportunity.salaryMin ??
    (range?.[1] ? normalize(range[1], range[2]) : parseMoney(candidate));
  const maximum =
    context.opportunity.salaryMax ??
    (range?.[3] ? normalize(range[3], range[4]) : minimum);
  if (minimum === null && competitive) {
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
  if (minimum === null) {
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
  const sourceText = supplied ?? range?.[0] ?? `$${minimum}`;
  const item = evidence({
    context,
    referenceId: "salary-disclosed",
    criterionId: "salary",
    claim: `The disclosed salary range begins at ${minimum}.`,
    sourceField: supplied ? "salaryText" : "jobDescription",
    sourceText,
  });
  return {
    salary: {
      minimum,
      maximum,
      currency: context.opportunity.currency ?? "USD",
      disclosure: "DISCLOSED",
      evidenceReferences: [item.referenceId],
    },
    evidence: [item],
  };
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
      criterionId: "candidate-requirement",
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
      ...location.evidence,
      ...travel.evidence,
      ...requirements.evidence,
    ],
  };
}
