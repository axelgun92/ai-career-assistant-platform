import { geographyName, readLocationGeography } from "./geography";
import type { NormalizedOpportunity } from "./opportunity";

// What a job's work-authorization facts mean for the user: an interpretation
// layer above normalization. Normalization stores what the posting states,
// for every job and country, and never depends on who the user is; this
// compares those facts with the user's own work eligibility (the countries
// the user is authorized to work in, and is a citizen of) to decide what is
// worth showing as needing attention. It never writes normalized data and is
// never part of evaluator input.

export interface UserWorkEligibility {
  // ISO 3166-1 alpha-2 country codes.
  authorizedRegions: readonly string[];
  citizenshipRegions: readonly string[];
}

export type WorkAuthorizationRelevanceStatus =
  // The user's eligibility is not recorded: the facts are shown as stated.
  | "NOT_CONFIGURED"
  // Every country the posting requires is one the user may work in (or is a
  // citizen of, for a citizenship requirement): nothing needs attention.
  | "SATISFIED"
  // The posting requires a right to work or citizenship the user does not
  // have, or rules out sponsorship for a job outside the user's countries.
  | "REVIEW"
  // A job outside the user's countries states sponsorship, relocation or an
  // employer of record that may make it possible.
  | "FAVORABLE"
  // A job outside the user's countries states nothing about work
  // authorization: the facts stay Unknown, and it is worth checking.
  | "UNKNOWN_CHECK"
  // Nothing to say: the job is within the user's countries and states no
  // requirement, or where the job is cannot be read.
  | "NOT_APPLICABLE";

export interface WorkAuthorizationRelevance {
  status: WorkAuthorizationRelevanceStatus;
  // The countries the job was taken to be in, if known.
  jobRegions: string[];
  // The stated facts, in plain words, for the eligibility note.
  statedFacts: string[];
}

type EligibilityFacts = Pick<
  NormalizedOpportunity,
  | "workAuthorizationRequirement"
  | "workAuthorizationRegions"
  | "visaSponsorship"
  | "relocationSupport"
  | "employerOfRecordRegions"
  | "residencyRegions"
  | "location"
>;

// "US-NY" is in the US; regions such as EU or EMEA are no single country.
const countryOf = (code: string) => code.split("-")[0]!;
const names = (codes: readonly string[]) => codes.map(geographyName).join(", ");

// Countries a location names ("London, United Kingdom", "Sunnyvale, CA,
// United States"); nothing when it stays ambiguous or names none.
function locationRegions(location: string | null): string[] {
  const reading = readLocationGeography(location);
  return reading.ambiguous ? [] : reading.codes;
}

export function describeWorkAuthorizationFacts(facts: EligibilityFacts): string[] {
  const stated: string[] = [];
  if (facts.workAuthorizationRequirement === "RIGHT_TO_WORK" && facts.workAuthorizationRegions.length) {
    stated.push(`${names(facts.workAuthorizationRegions)} work authorization required`);
  }
  if (facts.workAuthorizationRequirement === "CITIZENSHIP" && facts.workAuthorizationRegions.length) {
    stated.push(`${names(facts.workAuthorizationRegions)} citizenship required`);
  }
  if (facts.visaSponsorship === "AVAILABLE") stated.push("Visa sponsorship available");
  if (facts.visaSponsorship === "NOT_AVAILABLE") stated.push("Visa sponsorship not available");
  if (facts.relocationSupport === "AVAILABLE") stated.push("Relocation support available");
  if (facts.relocationSupport === "NOT_AVAILABLE") stated.push("Relocation support not available");
  if (facts.employerOfRecordRegions.length) stated.push(`Employer of record in ${names(facts.employerOfRecordRegions)}`);
  return stated;
}

export function workAuthorizationRelevance(facts: EligibilityFacts, eligibility: UserWorkEligibility | null): WorkAuthorizationRelevance {
  const statedFacts = describeWorkAuthorizationFacts(facts);
  const required = facts.workAuthorizationRegions;
  const jobRegions = required.length ? [...required] : facts.residencyRegions.length ? [...facts.residencyRegions] : locationRegions(facts.location);
  const result = (status: WorkAuthorizationRelevanceStatus): WorkAuthorizationRelevance => ({ status, jobRegions, statedFacts });
  if (!eligibility || (!eligibility.authorizedRegions.length && !eligibility.citizenshipRegions.length)) return result("NOT_CONFIGURED");

  const citizen = new Set(eligibility.citizenshipRegions);
  // A citizen may work in their own country.
  const authorized = new Set([...eligibility.authorizedRegions, ...eligibility.citizenshipRegions]);
  const outsideUser = jobRegions.some((code) => !authorized.has(countryOf(code)));
  const opening =
    facts.visaSponsorship === "AVAILABLE" ||
    facts.relocationSupport === "AVAILABLE" ||
    facts.employerOfRecordRegions.some((code) => authorized.has(countryOf(code)));

  if (facts.workAuthorizationRequirement && required.length) {
    const held = facts.workAuthorizationRequirement === "CITIZENSHIP" ? citizen : authorized;
    if (required.every((code) => held.has(countryOf(code)))) return result("SATISFIED");
    // A citizenship requirement cannot be met by sponsorship.
    if (facts.workAuthorizationRequirement === "RIGHT_TO_WORK" && opening) return result("FAVORABLE");
    return result("REVIEW");
  }
  if (!jobRegions.length || !outsideUser) return result("NOT_APPLICABLE");
  if (opening) return result("FAVORABLE");
  if (facts.visaSponsorship === "NOT_AVAILABLE") return result("REVIEW");
  return result("UNKNOWN_CHECK");
}
