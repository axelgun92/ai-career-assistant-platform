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
  source: "location" | "rawText" | "basedRole" | "pageContext";
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
  // A statement that the remote role itself is based in a place ("This is
  // a U.S.-based, full-time remote role."): where the remote work is done.
  basedRole: "rawText:explicit-remote-base-statement",
  // A page's own labelled region or country ("Region: Anywhere in the
  // World"), read like a posting statement.
  pageContext: "pageContext:explicit-residency-statement",
} as const;

const residenceVerb =
  /\b(?:must|required to|requires? (?:you|candidates|applicants) to|needs? to|have to|has to)\s+(?:currently\s+)?(?:reside|live|be based|be located|be a resident of|be resident in|be residing)\s+(?:in|within|of)\s+/i;
const openTo =
  /\b(?:open|available)\s+(?:only\s+)?to\s+(?:candidates|applicants|residents|people|those)\s+(?:who\s+(?:reside|live|are based|are located)\s+)?(?:in|of|from|based in|located in|residing in)\s+/i;
const basedIn = /\b(?:candidates|applicants)\s+(?:must be\s+)?(?:based|located|residing)\s+in\s+/i;
// "the following states:", "one of these provinces:" before the list.
const listLeadIn =
  /^(?:(?:one|any)\s+of\s+)?(?:the|these)\s+(?:following\s+)?(?:u\.?s\.?\s+|canadian\s+)?(?:states|provinces|territories|provinces and territories|countries|locations|regions)(?:\s+listed\s+below)?\s*:?\s*/i;
const onlySuffix =
  /^\s*[- ]?\s*(?:only|residents only|resident only|based (?:candidates|applicants) only|(?:candidates|applicants) only)\b/i;
const worldwide =
  /\b(?:(?:work|working|live|reside)\s+from\s+anywhere\s+in\s+the\s+world|anywhere\s+in\s+the\s+world|(?:open\s+to|hiring|hire)\s+(?:candidates\s+|applicants\s+|talent\s+)?(?:worldwide|globally))\b/i;
// Preference, negation or conditions make a sentence unusable.
const qualifier =
  /\b(?:not|no|never|without|except|excluding|outside|preferred|preferably|prefer|ideally|ideal|bonus|plus|nice to have|may|might|can also|or similar)\b|n't\b/i;

// A lead-in that ends in a list ("…reside in one of the following states:")
// followed by one geography per line ("- Arizona", "• TX") reads as one
// statement: "…states: Arizona, TX".
const bullet = /^\s*(?:[-–—•*·▪◦]|\d{1,2}[.)])?\s*/;
function joinListLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const joined: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!/(?:[:：]|\b(?:following|below)(?:\s+\w+){0,2})\s*$/i.test(line.trim())) {
      joined.push(line);
      continue;
    }
    const items: string[] = [];
    let next = index + 1;
    while (next < lines.length) {
      const item = lines[next]!.replace(bullet, "").replace(/[,;.]\s*$/, "").trim();
      if (!item || !parseGeographyList(item)) break;
      items.push(item);
      next += 1;
    }
    if (items.length) {
      joined.push(`${line.trim().replace(/[:：]$/, "")}: ${items.join(", ")}`);
      index = next - 1;
    } else {
      joined.push(line);
    }
  }
  return joined.join("\n");
}

function sentences(text: string): string[] {
  // Keep "U.S." / "U.K." / "D.C." abbreviations inside their sentence.
  return joinListLines(text)
    .split(/(?<=[.!?])(?<!\bU\.S\.)(?<!\bU\.K\.)(?<!\bU\.S\.A\.)(?<!\bD\.C\.)\s+|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

type SentenceResult = { regions: string[] } | "QUALIFIED" | null;

// "This is a U.S.-based, full-time remote role.": a role statement naming
// where the role is based, for a remote role (the statement says remote, or
// the role's arrangement is remote). For an on-site role the same words name
// an office, and are not read. Preferred, negated or conditional wording is
// not read.
const basedPlace = /(?:^|[\s,(])((?:[A-Z][\w.]*\s){0,2}[A-Z][\w.]*)-based\b/;
const roleNoun = /\b(?:role|position|job|opportunity)\b/i;
function readBasedRole(sentence: string, remote: boolean): string[] | null {
  const match = basedPlace.exec(sentence);
  if (!match || !roleNoun.test(sentence) || qualifier.test(sentence)) return null;
  if (!remote && !/\bremote\b/i.test(sentence)) return null;
  return parseGeographyList(match[1]!);
}

function readSentence(sentence: string): SentenceResult {
  const found: string[][] = [];
  let ambiguous = false;
  for (const pattern of [residenceVerb, openTo, basedIn]) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    const after = sentence.slice(match.index + match[0].length);
    const reading = readGeographyList(after.replace(listLeadIn, ""));
    if (reading.ambiguous) ambiguous = true;
    else if (reading.codes.length) found.push(reading.codes);
  }
  // "<geography> only" / "<geography> residents only". A bare "only" after
  // a two-letter abbreviation ("OK only", "IN only") is ordinary English.
  for (let index = 0; index < sentence.length; index += 1) {
    if (index > 0 && /[A-Za-z]/.test(sentence[index - 1]!)) continue;
    const reading = readGeographyList(sentence.slice(index));
    const suffix = onlySuffix.exec(sentence.slice(index + reading.consumed));
    if (!reading.codes.length || !suffix) continue;
    if (reading.abbreviated && /^\s*[- ]?\s*only\b/i.test(suffix[0])) continue;
    if (reading.ambiguous) ambiguous = true;
    else found.push(reading.codes);
    break;
  }
  if (ambiguous) return "QUALIFIED";
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
  // "Chicago Office or Remote, North America (US & Canada)": the remote
  // option's geography is where the role may be done; the other options are
  // offices.
  const options = location.split(/\s*(?:;|\bor\b)\s*/i).filter(Boolean);
  const remote = options.filter((option) => /\bremote\b/i.test(option));
  if (remote.length !== 1) return null;
  if (options.length > 1 && !options.every((option) => option === remote[0] || /\b(?:office|offices|hq|headquarters|on-?site|in[- ]office)\b/i.test(option))) return null;
  const rest = remote[0]!.replace(/\b(?:fully\s+)?remote\b/gi, " ").replace(/\b(?:in|within)\b/gi, " ");
  if (/^[\s()[\],.;:–—/-]*(?:worldwide|anywhere|global(?:ly)?)[\s()[\],.;:–—-]*$/i.test(rest)) return ["WORLDWIDE"];
  // A region named with the countries it means ("North America (US &
  // Canada)") reads as those countries.
  const named = /^(.*?)\(([^()]+)\)\s*[,.;]?\s*$/.exec(rest);
  if (named) {
    const inner = parseGeographyList(named[2]!);
    const outer = named[1]!.replace(/^[\s,.;:–—/-]+|[\s,.;:–—/-]+$/g, "");
    if (inner && (!outer || parseGeographyList(outer))) return inner;
  }
  return parseGeographyList(rest);
}

export function parseResidency(input: { location: string | null; rawText: string | null; remote?: boolean; pageStatements?: readonly string[] }): ParsedResidency {
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
    else {
      const based = readBasedRole(sentence, input.remote ?? false);
      if (based) statements.push({ source: "basedRole", sentence, regions: based });
    }
  }
  for (const sentence of input.pageStatements ?? []) {
    const result = readSentence(sentence);
    if (result === "QUALIFIED") qualified = true;
    else if (result) statements.push({ source: "pageContext", sentence, regions: result.regions });
  }
  const unknown = (reason: ParsedResidency["unknownReason"]): ParsedResidency => ({
    requirement: null,
    regions: [],
    statements,
    unknownReason: reason,
  });
  if (qualified) return unknown("QUALIFIED_STATEMENT");
  // Where the role is based is the broadest reading: an explicit statement
  // of where candidates may be (the eligible states, a "Remote - …"
  // location) says more, and replaces it.
  if (statements.some((statement) => statement.source !== "basedRole")) {
    for (let index = statements.length - 1; index >= 0; index -= 1) if (statements[index]!.source === "basedRole") statements.splice(index, 1);
  }
  if (!statements.length) return unknown(null);
  const requirements = new Set(statements.map((statement) => residencyRequirementFor(statement.regions)));
  if (requirements.size > 1) return unknown("CONFLICTING_STATEMENTS");
  const regions = [...new Set(statements.flatMap((statement) => statement.regions))];
  return { requirement: residencyRequirementFor(regions), regions, statements, unknownReason: null };
}
