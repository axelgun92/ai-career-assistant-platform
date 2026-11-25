import type { PreEvaluatorTriageReason } from "@ai-career/core";

// Customer Success position hard requirements (November 25, 2026): the
// seniority and employment type a Customer Success role (and its approved
// adjacent roles: onboarding, customer education and adoption,
// customer-facing implementation) must have. Customer Success only: other
// domains are never filtered by these rules.
//
// Seniority: Entry, Associate, Junior and Mid-level pass; Senior, Lead,
// Principal, Director, Head, VP, Executive and Chief roles are rejected.
// "Customer Success Manager" is an individual-contributor title and passes;
// a "Manager, Customer Success" title is judged by the normalized seniority
// and the stated people-management duties, and genuine ambiguity is sent
// to review. Years of experience are never read as seniority.
//
// Employment type: full-time passes; part-time, internship, stage,
// alternance and apprenticeship are rejected; a contract or temporary role
// passes only with a stated full-time schedule, and is otherwise reviewed;
// an unknown employment type is reviewed.

export interface PositionRequirementInput {
  title: string | null;
  // Normalized: ENTRY, MID, SENIOR, LEAD, PRINCIPAL, DIRECTOR, EXECUTIVE.
  seniority: string | null;
  // The seniority label as the source states it ("Mid-Senior level").
  seniorityLabel: string | null;
  // Normalized: FULL_TIME, PART_TIME, CONTRACT, TEMPORARY, INTERNSHIP,
  // APPRENTICESHIP.
  employmentType: string | null;
  // Explicit statements in the listing's own text (readPositionEvidence).
  evidence: {
    peopleManagement: { sourceText: string } | null;
    fullTimeSchedule: { sourceText: string } | null;
  };
}

const aboveMidLevels = new Set(["SENIOR", "LEAD", "PRINCIPAL", "DIRECTOR", "EXECUTIVE"]);
const allowedLevels = new Set(["ENTRY", "MID"]);

// Level words in a title that state a level above mid-level.
const aboveMidTitle: Array<[string, RegExp]> = [
  ["Senior", /\b(?:senior|sr)\b\.?/i],
  ["Lead", /\b(?:lead|team\s+lead|tech\s+lead)\b(?!\s+(?:generation|gen)\b)/i],
  ["Principal", /\bprincipal\b/i],
  ["Director", /\b(?:director|directeur|directrice)\b/i],
  ["Head", /\bhead\s+of\b/i],
  ["VP", /\b(?:vice[- ]president|s?vp|evp)\b/i],
  ["Chief", /\b(?:chief|c[a-z]o)\b/i],
];
// Allowed level words (never a reason on their own).
const allowedTitleLevel = /\b(?:entry[- ]level|associate|junior|jr|mid[- ]level|intermediate)\b/i;
// "Executive" as a title noun ("Customer Success Executive") names an
// individual-contributor role in some markets and a senior one in others.
const executiveNoun = /\bexecutive\b/i;
// A manager-of title ("Manager, Customer Success", "Customer Success Team
// Manager", "Manager of Onboarding"), unlike the individual-contributor
// "Customer Success Manager".
const managerOf = /^\s*manager\b|\bmanager\s*(?:,|-|–|—|of\b|for\b|\|)|\bteam\s+manager\b|\bgroup\s+manager\b/i;
// Employment types a title states outright.
const titleEmployment: Array<[string, RegExp]> = [
  ["internship", /\b(?:intern|internship|stagiaire)\b|\bstage\b(?!\s*\d)/i],
  ["alternance", /\b(?:alternance|alternant|alternante)\b/i],
  ["apprenticeship", /\b(?:apprentice|apprenticeship|apprentissage)\b/i],
  ["part-time", /\bpart[- ]?time\b/i],
];

const seniorityFields = ["title", "seniority", "seniorityLabel"];
const employmentFields = ["employmentType", "title"];

export function seniorityReasons(input: PositionRequirementInput): PreEvaluatorTriageReason[] {
  const title = input.title ?? "";
  const titleLevel = aboveMidTitle.find(([, pattern]) => pattern.test(title));
  if (titleLevel) {
    return [{
      code: "seniority-above-mid-level",
      fields: seniorityFields,
      disposition: "REJECT",
      message: `The title states a level above mid-level (${titleLevel[0]}: "${title}"); Customer Success roles must be entry to mid-level.`,
    }];
  }
  if (input.seniority && aboveMidLevels.has(input.seniority)) {
    return [{
      code: "seniority-above-mid-level",
      fields: seniorityFields,
      disposition: "REJECT",
      message: `The normalized seniority is ${input.seniority.toLowerCase()}${input.seniorityLabel ? ` ("${input.seniorityLabel}")` : ""}; Customer Success roles must be entry to mid-level.`,
    }];
  }
  const allowed = (input.seniority !== null && allowedLevels.has(input.seniority)) || allowedTitleLevel.test(title);
  if (managerOf.test(title)) {
    if (input.evidence.peopleManagement) {
      return [{
        code: "seniority-people-manager",
        fields: [...seniorityFields, "jobDescription"],
        disposition: "REJECT",
        message: `A manager-of title with stated people-management duties ("${input.evidence.peopleManagement.sourceText}"); Customer Success roles must be individual contributors up to mid-level.`,
      }];
    }
    if (!allowed) {
      return [{
        code: "seniority-manager-title-ambiguous",
        fields: [...seniorityFields, "jobDescription"],
        disposition: "NEEDS_REVIEW",
        message: `"${title}" may be a people-manager role; neither the normalized seniority nor the description settles it.`,
      }];
    }
  }
  if (executiveNoun.test(title) && !allowed) {
    return [{
      code: "seniority-executive-title-ambiguous",
      fields: seniorityFields,
      disposition: "NEEDS_REVIEW",
      message: `"${title}" uses "Executive", which names an individual-contributor role in some markets and a senior one in others; the seniority is not stated.`,
    }];
  }
  return [];
}

export function employmentReasons(input: PositionRequirementInput): PreEvaluatorTriageReason[] {
  const title = input.title ?? "";
  const stated = titleEmployment.find(([, pattern]) => pattern.test(title));
  if (stated) {
    return [{
      code: "employment-type-not-full-time",
      fields: employmentFields,
      disposition: "REJECT",
      message: `The title states ${stated[0]} ("${title}"); Customer Success roles must be full-time.`,
    }];
  }
  switch (input.employmentType) {
    case "FULL_TIME":
      return [];
    case "PART_TIME":
    case "INTERNSHIP":
    case "APPRENTICESHIP":
      return [{
        code: "employment-type-not-full-time",
        fields: employmentFields,
        disposition: "REJECT",
        message: `The employment type is ${input.employmentType.toLowerCase().replace("_", "-")}; Customer Success roles must be full-time.`,
      }];
    case "CONTRACT":
    case "TEMPORARY":
      if (input.evidence.fullTimeSchedule) return [];
      return [{
        code: "employment-type-contract-schedule-unknown",
        fields: [...employmentFields, "jobDescription"],
        disposition: "NEEDS_REVIEW",
        message: `The role is ${input.employmentType === "CONTRACT" ? "a contract" : "temporary"} and does not state a full-time schedule.`,
      }];
    default:
      // No stated type, but the listing's own text explicitly states a
      // full-time schedule (never with a part-time one, which cancels it):
      // the type is known to be full-time.
      if (!input.employmentType && input.evidence.fullTimeSchedule) return [];
      return [{
        code: "employment-type-unknown",
        fields: employmentFields,
        disposition: "NEEDS_REVIEW",
        message: input.employmentType ? `The employment type "${input.employmentType}" is not recognized.` : "Employment type is Unknown.",
      }];
  }
}

// What a title alone clearly rules out for Customer Success (a level above
// mid-level, or an internship, stage, alternance, apprenticeship or
// part-time role), for automatic discovery to skip before any job page is
// read. Null when the title does not settle it; triage still decides every
// job that is captured.
export function clearlyDisallowedCustomerSuccessTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const level = aboveMidTitle.find(([, pattern]) => pattern.test(title));
  if (level) return `${level[0]} level`;
  const employment = titleEmployment.find(([, pattern]) => pattern.test(title));
  return employment ? employment[0] : null;
}
