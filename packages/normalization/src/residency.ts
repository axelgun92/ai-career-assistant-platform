import {
  parseGeographyList,
  readGeographyList,
  residencyRequirementFor,
  type ResidencyRequirement,
} from "@ai-career/core";

// Deterministic reading of explicit residency / geographic-eligibility
// statements. Only clear statements count:
//   "Applicants must reside in the United States", "US only",
//   "EU residents only", "must be based in Spain", "open to candidates in
//   the US or Canada", "anywhere in the world", or a location field such as
//   "Remote - United States" / "Remote (Spain)".
// Never read: a bare "Remote", a city or country on its own (an office
// location is not a residency rule), currency, company headquarters,
// nationality or citizenship, work authorization, time zones, and anything
// preferred, negated, conditional or conflicting. Those stay Unknown.

export interface ResidencyStatement {
  source: "location" | "rawText";
  sentence: string;
  regions: string[];
}

export interface ParsedResidency {
  requirement: ResidencyRequirement | null;
  regions: string[];
  statements: ResidencyStatement[];
  unknownReason: "CONFLICTING_STATEMENTS" | "QUALIFIED_STATEMENT" | null;
}

// Provenance markers for deterministically read residency facts.
export const residencySourceFields = {
  location: "location:explicit-eligible-geography",
  rawText: "rawText:explicit-residency-statement",
} as const;

const residenceVerb =
  /\b(?:must|required to|requires? (?:you|candidates|applicants) to|needs? to|have to|has to)\s+(?:currently\s+)?(?:reside|live|be based|be located|be a resident of|be resident in|be residing)\s+(?:in|within|of)\s+/i;
const openTo =
  /\b(?:open|available)\s+(?:only\s+)?to\s+(?:candidates|applicants|residents|people|those)\s+(?:who\s+(?:reside|live|are based|are located)\s+)?(?:in|from|based in|located in|residing in)\s+/i;
const basedIn = /\b(?:candidates|applicants)\s+(?:must be\s+)?(?:based|located|residing)\s+in\s+/i;
const onlySuffix =
  /^\s*[- ]?\s*(?:only|residents only|resident only|based (?:candidates|applicants) only|(?:candidates|applicants) only)\b/i;
const worldwide =
  /\b(?:(?:work|working|live|reside)\s+from\s+anywhere\s+in\s+the\s+world|anywhere\s+in\s+the\s+world|(?:open\s+to|hiring|hire)\s+(?:candidates\s+|applicants\s+|talent\s+)?(?:worldwide|globally))\b/i;
// Preference, negation or conditions make a sentence unusable.
const qualifier =
  /\b(?:not|no|never|without|except|excluding|outside|preferred|preferably|prefer|ideally|ideal|bonus|plus|nice to have|may|might|can also|or similar)\b|n't\b/i;

function sentences(text: string): string[] {
  // Keep "U.S." / "U.K." abbreviations inside their sentence.
  return text
    .split(/(?<=[.!?])(?<!\bU\.S\.)(?<!\bU\.K\.)(?<!\bU\.S\.A\.)\s+|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

type SentenceResult = { regions: string[] } | "QUALIFIED" | null;

function readSentence(sentence: string): SentenceResult {
  const found: string[][] = [];
  for (const pattern of [residenceVerb, openTo, basedIn]) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    const { codes } = readGeographyList(sentence.slice(match.index + match[0].length));
    if (codes.length) found.push(codes);
  }
  // "<geography> only" / "<geography> residents only".
  for (let index = 0; index < sentence.length; index += 1) {
    if (index > 0 && /[A-Za-z]/.test(sentence[index - 1]!)) continue;
    const { codes, consumed } = readGeographyList(sentence.slice(index));
    if (codes.length && onlySuffix.test(sentence.slice(index + consumed))) {
      found.push(codes);
      break;
    }
  }
  if (worldwide.test(sentence)) found.push(["WORLDWIDE"]);
  if (!found.length) return null;
  if (qualifier.test(sentence)) return "QUALIFIED";
  return { regions: [...new Set(found.flat())] };
}

// "Remote - United States", "Remote (US or Canada)", "US Remote",
// "Remote - Worldwide". Requires the word "remote" plus nothing but
// geography; "Boston, MA (Remote)" or "Berlin, Germany" are not read.
function readLocation(location: string): string[] | null {
  if (!/\bremote\b/i.test(location)) return null;
  const rest = location.replace(/\b(?:fully\s+)?remote\b/gi, " ").replace(/\b(?:in|within)\b/gi, " ");
  if (/^[\s()[\],.;:–—/-]*(?:worldwide|anywhere|global(?:ly)?)[\s()[\],.;:–—-]*$/i.test(rest)) return ["WORLDWIDE"];
  return parseGeographyList(rest);
}

export function parseResidency(input: { location: string | null; rawText: string | null }): ParsedResidency {
  const statements: ResidencyStatement[] = [];
  let qualified = false;
  if (input.location) {
    const regions = readLocation(input.location);
    if (regions) statements.push({ source: "location", sentence: input.location, regions });
  }
  for (const sentence of sentences(input.rawText ?? "")) {
    const result = readSentence(sentence);
    if (result === "QUALIFIED") qualified = true;
    else if (result) statements.push({ source: "rawText", sentence, regions: result.regions });
  }
  const unknown = (reason: ParsedResidency["unknownReason"]): ParsedResidency => ({
    requirement: null,
    regions: [],
    statements,
    unknownReason: reason,
  });
  if (qualified) return unknown("QUALIFIED_STATEMENT");
  if (!statements.length) return unknown(null);
  const requirements = new Set(statements.map((statement) => residencyRequirementFor(statement.regions)));
  if (requirements.size > 1) return unknown("CONFLICTING_STATEMENTS");
  const regions = [...new Set(statements.flatMap((statement) => statement.regions))];
  return { requirement: residencyRequirementFor(regions), regions, statements, unknownReason: null };
}
