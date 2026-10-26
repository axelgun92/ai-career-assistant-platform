import {
  parseGeographyList,
  readGeographyList,
  readLocationGeography,
  scanGeography,
  type EmploymentType,
  type OfferAvailability,
  type Seniority,
  type WorkArrangement,
  type WorkAuthorizationRequirement,
} from "@ai-career/core";
import { parseCompensation, statedAmounts } from "./compensation";
import { standardizeEmploymentType } from "./position";

// Deterministic fallback reading of the job posting's own text (Core TDD
// §51, job-text fallback). Every source path supplies the description, and
// a page-based collector may add neutral page context (the page title, and
// the job's bounded page content around a structured description, read only
// through labels); this module is the only
// place job text is read for these facts, so manual capture, automated
// retrieval and the browser extension read it the same way. Adapters and the
// extension never interpret it themselves.
//
// The normalizers use a reading only where the source supplied no value for
// that fact: a user-stated or structured value always wins, and a reading
// never overwrites one. Only explicit, job-specific statements count:
// labelled lines ("Location: Boston, MA") and a few bounded constructions
// ("This position is based in New York.", "This is a full-time, NYC-Hybrid
// position."). Two statements that disagree make the fact Unknown, and
// nothing is guessed from word frequency, company prose, absence or
// location (a time zone, for example, is never inferred from a place).

export interface TextFact<T> {
  value: T;
  // Provenance marker: where in the text the value came from.
  sourceField: string;
  // The statement it was read from.
  sourceText: string;
}

export interface JobTextFacts {
  companyName: TextFact<string> | null;
  location: TextFact<string> | null;
  remoteStatus: TextFact<WorkArrangement> | null;
  // Several arrangements the posting offers for the role ("Office or
  // Remote", "a remote or hybrid role"), in the order it states them; null
  // when it states one (remoteStatus) or none, or when statements conflict.
  workArrangements: TextFact<WorkArrangement[]> | null;
  employmentType: TextFact<EmploymentType> | null;
  // The compensation statement, kept whole; the normalizer parses it as
  // salary text.
  compensation: TextFact<string> | null;
  // Several pay ranges stated for different places, zones or currencies
  // ("U.S.: USD 63,000–75,000" / "Canada: CAD 88,000–110,000"): no single
  // range is the role's, so no bounds are taken (from the text or from a
  // source field). The value is the tiers' statements, kept as salary text;
  // `currency` is their one currency, if they share one.
  compensationTiers: (TextFact<string> & { currency: string | null }) | null;
  postingDate: TextFact<Date> | null;
  closingDate: TextFact<Date> | null;
  timeZoneRequirements: TextFact<string> | null;
  seniority: TextFact<Seniority> | null;
  // A seniority label as stated ("Mid level", "Junior and Mid level",
  // "Mid-Senior level"), kept even when it names no single level.
  seniorityLabel: TextFact<string> | null;
  department: TextFact<string> | null;
  // A requisition ID the page or text labels as one ("Job Requisition ID:
  // JR115971").
  requisitionId: TextFact<string> | null;
  // A labelled location in the posting's own text that names the source's
  // location together with more places ("Location: Chicago Office or Remote,
  // North America (US & Canada)" beside a source location of "Canada"): the
  // fuller statement of the same fact.
  broaderLocation: TextFact<string> | null;
  // Explicit work-authorization facts, for any country (never residency):
  // a required right to work or citizenship and the countries named; visa
  // sponsorship and relocation support offered or not; the countries an
  // employer of record is stated for.
  workAuthorization: TextFact<{ requirement: WorkAuthorizationRequirement; regions: string[] }> | null;
  visaSponsorship: TextFact<OfferAvailability> | null;
  relocationSupport: TextFact<OfferAvailability> | null;
  employerOfRecord: TextFact<string[]> | null;
}

// Provenance markers. Facts read from the posting text are DETERMINISTIC,
// never DIRECT. Facts read from page context carry the same marker with the
// "pageContext:" prefix instead of "rawText:" (pageContextSourceFields), and
// a company read from the page title is pageContext:page-title-company.
export const jobTextSourceFields = {
  labelledCompany: "rawText:labelled-company",
  companyStatement: "rawText:explicit-company-statement",
  pageTitleCompany: "pageContext:page-title-company",
  labelledLocation: "rawText:labelled-location",
  locationStatement: "rawText:explicit-location-statement",
  labelledWorkArrangement: "rawText:labelled-work-arrangement",
  workArrangementStatement: "rawText:explicit-work-arrangement-statement",
  labelledEmploymentType: "rawText:labelled-employment-type",
  employmentTypeStatement: "rawText:explicit-employment-type-statement",
  compensationStatement: "rawText:explicit-compensation-statement",
  postingDateStatement: "rawText:explicit-posting-date-statement",
  closingDateStatement: "rawText:explicit-closing-date-statement",
  labelledTimeZone: "rawText:labelled-time-zone",
  timeZoneStatement: "rawText:explicit-time-zone-statement",
  labelledSeniority: "rawText:labelled-seniority",
  labelledDepartment: "rawText:labelled-department",
  teamStatement: "rawText:explicit-team-statement",
  workAuthorizationStatement: "rawText:explicit-work-authorization-statement",
  citizenshipStatement: "rawText:explicit-citizenship-statement",
  sponsorshipStatement: "rawText:explicit-sponsorship-statement",
  relocationStatement: "rawText:explicit-relocation-statement",
  employerOfRecordStatement: "rawText:explicit-employer-of-record-statement",
  labelledWorkAuthorization: "rawText:labelled-work-authorization",
  labelledSponsorship: "rawText:labelled-sponsorship",
  labelledRelocation: "rawText:labelled-relocation",
  timeZonePreference: "rawText:explicit-time-zone-preference",
  workArrangementCadence: "rawText:explicit-office-days-statement",
  compensationTiers: "rawText:compensation-tiers",
  labelledRequisitionId: "rawText:labelled-requisition-id",
} as const;

// The markers page context can produce: labelled values, and whole job
// metadata items (a line that is only a salary, an employment type, a work
// arrangement, a seniority label, a place or a posting age).
export const pageContextSourceFields = {
  labelledCompany: "pageContext:labelled-company",
  labelledLocation: "pageContext:labelled-location",
  labelledWorkArrangement: "pageContext:labelled-work-arrangement",
  labelledEmploymentType: "pageContext:labelled-employment-type",
  compensationStatement: "pageContext:explicit-compensation-statement",
  postingDateStatement: "pageContext:explicit-posting-date-statement",
  closingDateStatement: "pageContext:explicit-closing-date-statement",
  labelledTimeZone: "pageContext:labelled-time-zone",
  labelledSeniority: "pageContext:labelled-seniority",
  labelledDepartment: "pageContext:labelled-department",
  labelledWorkAuthorization: "pageContext:labelled-work-authorization",
  labelledSponsorship: "pageContext:labelled-sponsorship",
  labelledRelocation: "pageContext:labelled-relocation",
  statedSalary: "pageContext:stated-salary",
  statedEmploymentType: "pageContext:stated-employment-type",
  statedWorkArrangement: "pageContext:stated-work-arrangement",
  statedSeniority: "pageContext:stated-seniority",
  statedLocation: "pageContext:stated-location",
  relativePostedAge: "pageContext:relative-posted-age",
  labelledRequisitionId: "pageContext:labelled-requisition-id",
} as const;

// ---------------------------------------------------------------- text units

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

function textLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(collapse)
    .filter(Boolean);
}

// Parts of a line separated by " | ", " • " or " · " (a row of facts).
function segments(line: string): string[] {
  return line
    .split(/\s+[|•·]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// Sentences of a line; "U.S.", "U.K." and "D.C." stay inside their sentence.
function sentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])(?<!\bU\.S\.)(?<!\bU\.K\.)(?<!\bU\.S\.A\.)(?<!\bD\.C\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function allSentences(lines: string[]): string[] {
  return lines.flatMap(segments).flatMap(sentences);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameText = (a: string, b: string) => collapse(a).toLowerCase() === collapse(b).toLowerCase();
const trimEnd = (value: string) => value.replace(/(?<![A-Z]\.[A-Z])[.;,:!]+$/, "").trim();

interface Labelled {
  value: string;
  sourceText: string;
}

// Values written after one of `labels`: "Label: value" (also inside a row of
// facts), or a line holding only the label followed by a line holding the
// value.
function labelledValues(lines: string[], labels: readonly string[], options: { colonOptional?: boolean } = {}): Labelled[] {
  const alternatives = [...labels].sort((a, b) => b.length - a.length).map(escape).join("|");
  const inline = new RegExp(`^(?:${alternatives})\\s*${options.colonOptional ? "[:：]?" : "[:：]"}\\s*(\\S.*)$`, "i");
  const alone = new RegExp(`^(?:${alternatives})\\s*[:：]?$`, "i");
  const found: Labelled[] = [];
  lines.forEach((line, index) => {
    for (const segment of segments(line)) {
      const match = inline.exec(segment);
      if (match) found.push({ value: match[1]!.trim(), sourceText: segment });
    }
    const next = lines[index + 1];
    if (alone.test(line) && next) found.push({ value: next, sourceText: `${line}\n${next}` });
  });
  return found;
}

// One value when every candidate agrees (compared with `key`), otherwise
// null: disagreement makes the fact Unknown.
function agreed<T>(candidates: Array<TextFact<T>>, key: (value: T) => string = (value) => String(value).toLowerCase()): TextFact<T> | null {
  if (!candidates.length) return null;
  const keys = new Set(candidates.map((candidate) => key(candidate.value)));
  return keys.size === 1 ? candidates[0]! : null;
}

// --------------------------------------------------------------- vocabulary

// Hosting platforms and job sites: never read as the employer.
const platformNames = new Set(
  [
    "greenhouse", "greenhouse.io", "lever", "lever.co", "linkedin", "workday", "myworkdayjobs", "workable", "ashby",
    "ashbyhq", "smartrecruiters", "indeed", "glassdoor", "wellfound", "angellist", "angel.co", "otta",
    "welcome to the jungle", "welcometothejungle", "jobvite", "icims", "bamboohr", "breezy", "breezy hr", "recruitee",
    "personio", "teamtailor", "jazzhr", "jazz", "rippling", "gem", "dover", "ziprecruiter", "monster", "built in",
    "builtin", "himalayas", "remote ok", "remoteok", "we work remotely", "working nomads", "adzuna", "simplyhired",
    "careerbuilder", "dice", "hired", "job board", "job boards", "careers", "career", "jobs", "job", "job application",
    "apply", "home",
  ].map((name) => name.replace(/[^a-z0-9.]+/g, " ").trim()),
);
const platformKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
const isPlatformName = (value: string) =>
  platformNames.has(platformKey(value)) || /\b(?:greenhouse|lever\.co|linkedin|myworkdayjobs|ashbyhq|smartrecruiters)\b/i.test(value);

// Prose, not a name or a place: "We're hiring", "Acme is a leading ...".
const proseWords = /\b(?:we|we're|our|you|your|us|is|are|was|will|join|hiring)\b/i;

const companyPattern = /^[A-Z0-9][\w&.'’+-]*(?:\s+(?:[A-Z0-9&][\w&.'’+-]*|of|and|for|de|la))*/;

function plausibleCompany(value: string): string | null {
  const name = trimEnd(collapse(value));
  if (!name || name.length > 80 || name.split(" ").length > 6) return null;
  if (!/^[A-Z0-9]/.test(name) || /[.!?]\s/.test(name) || proseWords.test(name) || isPlatformName(name)) return null;
  return name;
}

const placeWord = "[A-Z][A-Za-z.'’-]*";
const placePattern = new RegExp(`^${placeWord}(?:\\s+${placeWord}){0,3}(?:,\\s*${placeWord}(?:\\s+${placeWord}){0,2})?`);
// Words that start a capitalized phrase but are not a place.
const notAPlace = /^(?:Our|The|A|An|This|That|These|Headquarters|HQ|Office|Offices|Remote|Hybrid|Home|We|You)\b/;

// A place name at the start of `text` ("New York", "Boston, MA"), or null
// when there is none or a second place follows ("New York or Boston").
function placeAt(text: string): string | null {
  const match = placePattern.exec(text);
  if (!match) return null;
  const place = trimEnd(match[0]);
  if (!place || notAPlace.test(place)) return null;
  const rest = text.slice(match[0].length);
  if (/^\s*(?:,\s*)?(?:or|and|\/|&)\s+[A-Z]/.test(rest)) return null;
  return place;
}

function plausibleLocation(value: string): string | null {
  const location = trimEnd(collapse(value));
  if (!location || location.length > 100 || location.split(" ").length > 12) return null;
  // "US" written in capitals is the country, not the word "us".
  if (/[.!?]\s/.test(location) || proseWords.test(location.replace(/\bU\.?S\.?(?:A\.?)?(?![a-z])/g, ""))) return null;
  return location;
}

// Work arrangement words, as whole tokens. "remote-friendly", "remote-first"
// or "flexible" are not stated arrangements.
const arrangementTokens: Record<string, WorkArrangement> = {
  remote: "REMOTE",
  hybrid: "HYBRID",
  onsite: "ONSITE",
  "on-site": "ONSITE",
  "in-office": "ONSITE",
  "in-person": "ONSITE",
};
const labelledArrangementValues: Record<string, WorkArrangement> = {
  remote: "REMOTE",
  "fully remote": "REMOTE",
  "100% remote": "REMOTE",
  "remote only": "REMOTE",
  hybrid: "HYBRID",
  onsite: "ONSITE",
  "on-site": "ONSITE",
  "on site": "ONSITE",
  "in-office": "ONSITE",
  "in office": "ONSITE",
  "in-person": "ONSITE",
  "in person": "ONSITE",
};
const employmentTokens = new Set(["full-time", "part-time", "contract", "temporary", "internship"]);
const fillerTokens = new Set(["a", "an", "fully", "100%", "completely", "and", "&", "or"]);
const roleNouns = /^(?:position|role|job|opportunity)$/i;
const negation = /\b(?:not|no|non|never)\b|n't\b/i;

function normalizedModifiers(text: string): string[] {
  return text
    .replace(/\bin[ -]office\b/gi, "in-office")
    .replace(/\bon[ -]site\b/gi, "on-site")
    .replace(/\bin[ -]person\b/gi, "in-person")
    .replace(/\bfull[ -]time\b/gi, "full-time")
    .replace(/\bpart[ -]time\b/gi, "part-time")
    .replace(/\s*\/\s*/g, " or ")
    .split(/[\s,]+/)
    .filter(Boolean);
}

interface ModifierReading {
  arrangement: WorkArrangement | null;
  // Arrangements offered as options ("remote or hybrid"), in stated order.
  arrangementOptions: WorkArrangement[] | null;
  employment: EmploymentType | null;
  place: string | null;
  // False when a token is not a recognized modifier or filler.
  onlyKnown: boolean;
  // Two different arrangements ("remote or hybrid"), employment types or
  // places in one statement.
  arrangementConflict: boolean;
  employmentConflict: boolean;
  placeConflict: boolean;
}

// Reads "full-time, NYC-Hybrid" or "fully remote" style modifiers.
function readModifiers(tokens: string[]): ModifierReading {
  const arrangements = new Set<WorkArrangement>();
  // Options only when joined by "or" ("remote or hybrid"); "remote and
  // hybrid" states no clear set of options.
  const offered = tokens.some((token) => token.toLowerCase() === "or") && !tokens.some((token) => /^(?:and|&)$/i.test(token));
  const employments = new Set<EmploymentType>();
  const places = new Set<string>();
  let onlyKnown = true;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const placed = /^([A-Z][A-Za-z.]{1,30})-(hybrid|based|on-?site|in-office)$/i.exec(token);
    if (arrangementTokens[lower]) arrangements.add(arrangementTokens[lower]!);
    else if (employmentTokens.has(lower)) employments.add(standardizeEmploymentType(lower)!);
    else if (placed && /^[A-Z]/.test(placed[1]!)) {
      places.add(placed[1]!);
      const kind = placed[2]!.toLowerCase();
      if (kind === "hybrid") arrangements.add("HYBRID");
      else if (kind !== "based") arrangements.add("ONSITE");
    } else if (!fillerTokens.has(lower) && !roleNouns.test(lower)) onlyKnown = false;
  }
  const options = arrangements.size > 1 && offered ? [...arrangements] : null;
  return {
    arrangement: arrangements.size === 1 ? [...arrangements][0]! : null,
    arrangementOptions: options,
    employment: employments.size === 1 ? [...employments][0]! : null,
    place: places.size === 1 ? [...places][0]! : null,
    onlyKnown,
    arrangementConflict: arrangements.size > 1 && !options,
    employmentConflict: employments.size > 1,
    placeConflict: places.size > 1,
  };
}

// ------------------------------------------------------------------ dates

const monthNumbers: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const monthName = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const weekday = "(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s+)?";
const dateEnd = "(?=$|[\\s.,;:)\\]])";
const isoDate = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})${dateEnd}`);
const monthFirst = new RegExp(`^${weekday}${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${dateEnd}`, "i");
const dayFirst = new RegExp(`^${weekday}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthName}\\.?,?\\s+(\\d{4})${dateEnd}`, "i");
const numericDate = new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})${dateEnd}`);

function calendarDate(year: number, month: number, day: number): Date | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

// A date stated without ambiguity at the start of `text`: ISO, a written
// month ("November 30, 2026", "30 Nov 2026"), or a numeric date whose
// order cannot be misread ("11/30/2026": 30 cannot be a month). Two-digit
// years, relative dates ("in two weeks") and "03/04/2026" stay Unknown.
export function parseUnambiguousDate(text: string): Date | null {
  const value = text.trim();
  let match = isoDate.exec(value);
  if (match) return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = monthFirst.exec(value);
  if (match) return calendarDate(Number(match[3]), monthNumbers[match[1]!.slice(0, 3).toLowerCase()] ?? 0, Number(match[2]));
  match = dayFirst.exec(value);
  if (match) return calendarDate(Number(match[3]), monthNumbers[match[2]!.slice(0, 3).toLowerCase()] ?? 0, Number(match[1]));
  match = numericDate.exec(value);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    if (first === second) return calendarDate(year, first, second);
    if (first > 12 && second <= 12) return calendarDate(year, second, first);
    if (second > 12 && first <= 12) return calendarDate(year, first, second);
  }
  return null;
}

// ------------------------------------------------------------------ readers

// A body of text the readers look at: the posting text itself, or bounded
// neutral job-page context (a page's job metadata outside its structured
// description). Page context is read only through labels, never as prose,
// and its facts carry "pageContext:" markers.
interface TextSource {
  prefix: "rawText" | "pageContext";
  lines: string[];
  sentences: string[];
  labelledOnly: boolean;
}

const marker = (source: TextSource, kind: string) => `${source.prefix}:${kind}`;

function textSource(text: string | null | undefined, prefix: TextSource["prefix"]): TextSource {
  const lines = textLines(text ?? "");
  return { prefix, lines, sentences: allSentences(lines), labelledOnly: prefix === "pageContext" };
}

const companyLabels = ["company", "company name", "employer", "hiring company"];

function collectCompany(source: TextSource, title: string | null): Array<TextFact<string>> {
  const candidates: Array<TextFact<string>> = [];
  for (const { value, sourceText } of labelledValues(source.lines, companyLabels)) {
    const name = plausibleCompany(value);
    if (name) candidates.push({ value: name, sourceField: marker(source, "labelled-company"), sourceText });
  }
  if (!title || source.labelledOnly) return candidates;
  const companyAfter = (text: string, prefix: string): string | null => {
    if (!collapse(text).toLowerCase().startsWith(prefix.toLowerCase())) return null;
    const rest = collapse(text).slice(prefix.length);
    const match = companyPattern.exec(rest);
    if (!match) return null;
    const name = match[0].replace(/(?:\s+(?:of|and|for|de|la))+$/, "");
    if (!/^\s*(?:$|[,.;:!?(|–—-])/.test(rest.slice(name.length))) return null;
    return plausibleCompany(name);
  };
  // A line that is exactly "<title> at <Company>", near the top.
  for (const line of source.lines.slice(0, 10)) {
    const name = companyAfter(line, `${title} at `);
    if (name) candidates.push({ value: name, sourceField: marker(source, "explicit-company-statement"), sourceText: line });
  }
  // "As a <title> at <Company>, ..." / "Join <Company> as a <title>".
  for (const sentence of source.sentences) {
    for (const article of ["a", "an", "the", "our"]) {
      const name = companyAfter(sentence, `As ${article} ${title} at `);
      if (name) candidates.push({ value: name, sourceField: marker(source, "explicit-company-statement"), sourceText: sentence });
    }
    const join = /^Join\s+(.+?)\s+as\s+(?:a|an|our)\s+(.+?)[.!,]?$/.exec(collapse(sentence));
    if (join && sameText(join[2]!, title)) {
      const name = plausibleCompany(join[1]!);
      if (name) candidates.push({ value: name, sourceField: marker(source, "explicit-company-statement"), sourceText: sentence });
    }
  }
  return candidates;
}

// Words that name a place, an arrangement, an employment type or a team
// rather than an employer, as page titles often add them after a dash.
const notAnEmployer =
  /\b(?:remote|hybrid|on-?site|in[- ]office|in[- ]person|worldwide|anywhere|global|full[- ]time|part[- ]time|contract|temporary|internship|freelance)\b/i;
const departmentNames = new Set([
  "customer success", "customer experience", "customer support", "support", "sales", "marketing", "engineering", "product",
  "design", "operations", "finance", "legal", "people", "hr", "human resources", "recruiting", "it", "data", "security",
  "account management", "professional services", "services", "partnerships", "business development", "go to market",
]);

// What a page-title part must not be to be read as the employer: a place
// (a supported geography, "City, ST", or the posting's own location), an
// arrangement or employment word, or a department.
function namesSomethingElse(name: string, knownPlaces: string[], text: string): boolean {
  const lower = name.toLowerCase();
  if (notAnEmployer.test(name) || departmentNames.has(lower.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim())) return true;
  if (parseGeographyList(name) !== null) return true;
  if (/,\s*(?!(?:inc|llc|ltd|limited|gmbh|co|corp|plc|s\.?a|b\.?v)\.?$)/i.test(name)) return true;
  const quoted = escape(name);
  const wholeWord = new RegExp(`(?<![\\w])${quoted}(?![\\w])`, "i");
  if (knownPlaces.some((place) => place && wholeWord.test(place))) return true;
  return new RegExp(`\\b(?:based|located|offices?)\\s+(?:in\\s+)?${quoted}\\b|\\bLocations?\\s*[:：]\\s*${quoted}\\b|\\b${quoted}\\s+(?:office|offices|HQ|headquarters|area|metro)\\b`, "i").test(text);
}

// "Job Application for <title> at <Company>", "<Company> - <title>",
// "<title> | <Company> | <platform>": the employer only when the rest of the
// page title is exactly the job title. Parts naming a place, an arrangement,
// an employment type or a team ("<title> - New York", "<title> - Remote") are
// never the employer, and a dash-separated name must also appear in the
// posting itself.
function companyFromPageTitle(pageTitle: string, title: string, knownPlaces: string[], text: string): string | null {
  const cleaned = collapse(pageTitle.replace(/^\(\d+\)\s*/, "").replace(/^Job Application for\s+/i, ""));
  const parts = cleaned
    .split(/\s+[|–—-]\s+|\s+·\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !isPlatformName(part));
  const titled = parts.findIndex((part) => sameText(part, title));
  if (titled === -1) {
    // A single "<title> at <Company>" part.
    if (parts.length !== 1) return null;
    const prefix = `${title} at `;
    if (!parts[0]!.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    const name = plausibleCompany(parts[0]!.slice(prefix.length).replace(/\s+(?:careers|jobs)$/i, ""));
    return name && !namesSomethingElse(name, knownPlaces, text) ? name : null;
  }
  // The other parts, less those that name a place, arrangement or team:
  // exactly one may remain.
  const others = parts
    .filter((_, index) => index !== titled)
    .map((part) => part.replace(/\s+(?:careers|jobs)$/i, ""))
    .filter((part) => !namesSomethingElse(part, knownPlaces, text));
  if (others.length !== 1) return null;
  const name = plausibleCompany(others[0]!);
  if (!name) return null;
  // Corroboration: the employer is named in the posting itself.
  return new RegExp(`(?<![\\w])${escape(name)}(?![\\w])`).test(text) ? name : null;
}

const locationLabels = ["location", "locations", "job location", "office location", "work location"];

function collectLocation(source: TextSource): { candidates: Array<TextFact<string>>; conflict: boolean } {
  const candidates: Array<TextFact<string>> = [];
  for (const { value, sourceText } of labelledValues(source.lines, locationLabels)) {
    const location = plausibleLocation(value);
    if (location) candidates.push({ value: location, sourceField: marker(source, "labelled-location"), sourceText });
  }
  if (source.labelledOnly) {
    // A page metadata item that is only a country or region list ("USA",
    // "United States", "US or Canada"); cities are not in the vocabulary.
    for (const line of source.lines) {
      if (line.length <= 60 && parseGeographyList(line)) candidates.push({ value: trimEnd(line), sourceField: marker(source, "stated-location"), sourceText: line });
    }
    return { candidates, conflict: false };
  }
  const based = /^(?:this|the)\b.*?\b(?:position|role|job|opportunity)\s+(?:is\s+)?(?:based|located)\s+(?:in|out of)\s+(?:our\s+|the\s+)?/i;
  const office = /\b(?:work|working|works)\s+(?:from|out of|in)\s+our\s+/i;
  for (const sentence of source.sentences) {
    const statement = (place: string | null) => {
      if (place) candidates.push({ value: place, sourceField: marker(source, "explicit-location-statement"), sourceText: sentence });
    };
    const basedMatch = based.exec(sentence);
    if (basedMatch && !negation.test(sentence.slice(0, basedMatch[0].length))) statement(placeAt(sentence.slice(basedMatch[0].length)));
    const officeMatch = office.exec(sentence);
    if (officeMatch) {
      const rest = sentence.slice(officeMatch.index + officeMatch[0].length);
      const place = placeAt(rest);
      if (place && new RegExp(`^${escape(place)}\\.?\\s+(?:office|offices|HQ|headquarters)\\b`, "i").test(rest)) statement(place);
    }
    const modifiers = modifierSentence(sentence);
    if (modifiers?.place) statement(modifiers.place);
    if (modifiers?.placeConflict) return { candidates, conflict: true };
  }
  return { candidates, conflict: false };
}

// "This is a full-time, NYC-Hybrid position." / "Fully remote role." /
// "This role is fully remote." The modifiers, or null when the sentence has
// none of these shapes or is negated.
function modifierSentence(sentence: string): ModifierReading | null {
  const text = collapse(sentence).replace(/[.!]$/, "");
  const thisIsA = /^this\s+is\s+(?:an?\s+)?(.{1,80}?)\s+(?:position|role|job|opportunity)\b/i.exec(text);
  if (thisIsA) {
    if (negation.test(thisIsA[1]!)) return null;
    return readModifiers(normalizedModifiers(thisIsA[1]!));
  }
  const roleIs = /^(?:this|the)\s+(?:position|role|job|opportunity)\s+is\s+(.{1,60}?)(?=$|[,;:]|\s+(?:with|in|within|for|based|located|out|from|and\s+(?:you|we|will)|reporting|starting)\b)/i.exec(text);
  if (roleIs) {
    if (negation.test(roleIs[1]!)) return null;
    const reading = readModifiers(normalizedModifiers(roleIs[1]!));
    return reading.onlyKnown ? reading : null;
  }
  const bare = /^(.{1,60}?)\s+(?:position|role|job|opportunity)$/i.exec(text);
  if (bare && !negation.test(bare[1]!)) {
    const reading = readModifiers(normalizedModifiers(bare[1]!));
    return reading.onlyKnown ? reading : null;
  }
  return null;
}

interface PositionCandidates {
  arrangements: Array<TextFact<WorkArrangement>>;
  arrangementOptions: Array<TextFact<WorkArrangement[]>>;
  employments: Array<TextFact<EmploymentType>>;
  arrangementConflict: boolean;
  employmentConflict: boolean;
}

// Days in the office each week ("1 day a week in the office", "in office two
// days per week"): one to four is hybrid. Indefinite wording ("up to", "may",
// "occasionally") states no arrangement.
const officeDays =
  /\b(?:(\d|one|two|three|four|five)\s+days?\s+(?:a|per|each)\s+week\s+(?:in|at)\s+(?:the\s+|our\s+|an\s+)?(?:office|hq|headquarters)|in[- ](?:the[- ])?office\s+(\d|one|two|three|four|five)\s+days?\s+(?:a|per|each)\s+week)\b/i;
const indefiniteDays = /\b(?:up to|may|might|occasional(?:ly)?|optional(?:ly)?|if needed|as needed|at most|no more than)\b/i;
const dayCounts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
function officeDaysArrangement(text: string): WorkArrangement | null {
  const match = officeDays.exec(text);
  if (!match || indefiniteDays.test(text) || negation.test(text)) return null;
  const word = (match[1] ?? match[2])!.toLowerCase();
  const days = dayCounts[word] ?? Number(word);
  return days >= 1 && days <= 4 ? "HYBRID" : days === 5 ? "ONSITE" : null;
}

// The arrangements a value offers as options, in its order: "Remote or
// Hybrid", "Hybrid / On-site", or a labelled location's alternatives
// ("Chicago Office or Remote, North America" → on-site, remote). Each option
// must name an arrangement (an office is on-site); otherwise, or with fewer
// than two, there are no options.
function offeredArrangements(value: string, { places = false } = {}): WorkArrangement[] | null {
  if (/\b(?:not|no|non)[- ](?:remote|hybrid)\b/i.test(value)) return null;
  const options = value.split(/\s*(?:\bor\b|\/)\s*/i).map((option) => option.trim()).filter(Boolean);
  if (options.length < 2) return null;
  const read = options.map((option) => {
    const key = trimEnd(collapse(option)).toLowerCase();
    if (labelledArrangementValues[key]) return labelledArrangementValues[key]!;
    if (!places) return null;
    if (/\bremote\b/i.test(option)) return "REMOTE" as const;
    if (/\bhybrid\b/i.test(option)) return "HYBRID" as const;
    if (/\b(?:office|offices|on-?site|in[- ]office|hq|headquarters)\b/i.test(option)) return "ONSITE" as const;
    return null;
  });
  if (read.some((arrangement) => arrangement === null)) return null;
  const distinct = [...new Set(read as WorkArrangement[])];
  return distinct.length > 1 ? distinct : null;
}

function collectArrangementAndEmployment(source: TextSource): PositionCandidates {
  const result: PositionCandidates = { arrangements: [], arrangementOptions: [], employments: [], arrangementConflict: false, employmentConflict: false };
  for (const { value, sourceText } of labelledValues(source.lines, ["remote type", "workplace type", "work arrangement", "location type", "work model", "work type", "workplace"])) {
    const arrangement = labelledArrangementValues[trimEnd(collapse(value)).toLowerCase()];
    if (arrangement) result.arrangements.push({ value: arrangement, sourceField: marker(source, "labelled-work-arrangement"), sourceText });
    const options = arrangement ? null : offeredArrangements(value);
    if (options) result.arrangementOptions.push({ value: options, sourceField: marker(source, "labelled-work-arrangement"), sourceText });
  }
  for (const { value, sourceText } of labelledValues(source.lines, locationLabels)) {
    const options = offeredArrangements(value, { places: true });
    if (options) result.arrangementOptions.push({ value: options, sourceField: marker(source, "labelled-work-arrangement"), sourceText });
  }
  for (const { value, sourceText } of labelledValues(source.lines, ["employment type", "job type", "position type", "employment"])) {
    const employment = standardizeEmploymentType(trimEnd(collapse(value)));
    if (employment) result.employments.push({ value: employment, sourceField: marker(source, "labelled-employment-type"), sourceText });
  }
  if (source.labelledOnly) {
    // Page metadata items that are only an arrangement, an office cadence or
    // an employment type ("Remote", "1 day a week in office", "Full-time").
    for (const line of source.lines) {
      if (line.length > 60) continue;
      const key = trimEnd(line).toLowerCase();
      const arrangement = labelledArrangementValues[key] ?? officeDaysArrangement(line);
      if (arrangement) result.arrangements.push({ value: arrangement, sourceField: marker(source, "stated-work-arrangement"), sourceText: line });
      const options = arrangement ? null : offeredArrangements(line);
      if (options) result.arrangementOptions.push({ value: options, sourceField: marker(source, "stated-work-arrangement"), sourceText: line });
      const employment = /^[A-Za-z][A-Za-z /,&-]{2,40}$/.test(line) ? standardizeEmploymentType(trimEnd(line)) : null;
      if (employment) result.employments.push({ value: employment, sourceField: marker(source, "stated-employment-type"), sourceText: line });
    }
    return result;
  }
  for (const sentence of source.sentences) {
    const cadence = sentence.length <= 200 ? officeDaysArrangement(sentence) : null;
    if (cadence) result.arrangements.push({ value: cadence, sourceField: marker(source, "explicit-office-days-statement"), sourceText: sentence });
    const reading = modifierSentence(sentence);
    if (!reading) continue;
    // "a remote or hybrid role" states no single arrangement.
    result.arrangementConflict ||= reading.arrangementConflict;
    result.employmentConflict ||= reading.employmentConflict;
    if (reading.arrangement) result.arrangements.push({ value: reading.arrangement, sourceField: marker(source, "explicit-work-arrangement-statement"), sourceText: sentence });
    if (reading.arrangementOptions) result.arrangementOptions.push({ value: reading.arrangementOptions, sourceField: marker(source, "explicit-work-arrangement-statement"), sourceText: sentence });
    if (reading.employment) result.employments.push({ value: reading.employment, sourceField: marker(source, "explicit-employment-type-statement"), sourceText: sentence });
  }
  return result;
}

// A compensation cue, required in the statement itself (or its heading).
const compensationCue =
  /\b(?:salary|salaries|base|pay|pays|compensation|wages?|OTE|on[- ]target(?: earnings)?|per (?:year|annum)|a year|annual(?:ly)?|hiring range)\b|\/\s*(?:yr|year)\b/i;
// Business metrics, and benefits or perks that are not the role's pay.
const notCompensation =
  /\b(?:ARR|MRR|revenue|book of business|portfolios?|quotas?|funding|funded|raised|investors?|series [A-F]|valuation|valued at|budgets?|spend(?:ing)?|contract values?|deal sizes?|ACV|TCV|GMV|AUM|assets under management|run[- ]rate|(?:customer|user|client|install(?:ed)?|knowledge)\s+base|stipends?|allowances?|reimburse(?:d|ment|ments)?|relocation|home office|equipment|tuition|learning|education|wellness|referral)\b/i;
// An amount of at least 10,000, written with a currency sign or code, or
// with a "k" suffix.
const salaryAmount =
  /(?:[$€£₹]|\b(?:USD|CAD|AUD|NZD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|INR|SGD|JPY|MXN|BRL|ZAR)\s?)\s?\d{2,3}(?:[,.]\d{3})+|(?:[$€£₹]\s?)?\b\d{2,3}(?:\.\d+)?\s?[kK]\b|\b\d{2,3}(?:,\d{3})+\s?(?:USD|CAD|AUD|NZD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|INR|SGD|JPY|MXN|BRL|ZAR)\b/;
const maxStatementLength = 300;
// Labels that introduce compensation in a row of job metadata.
const compensationLabels = [
  "salary", "salary range", "base salary", "annual salary", "pay", "pay range", "base pay", "compensation",
  "compensation range", "ote", "on-target earnings", "hiring range",
];

function collectCompensation(source: TextSource): Array<TextFact<string>> {
  const candidates: Array<TextFact<string>> = [];
  const usable = (text: string) => text.length <= maxStatementLength && salaryAmount.test(text) && !notCompensation.test(text);
  const field = marker(source, "explicit-compensation-statement");
  if (source.labelledOnly) {
    for (const { sourceText } of labelledValues(source.lines, compensationLabels)) {
      if (!sourceText.includes("\n") && usable(sourceText)) candidates.push({ value: sourceText, sourceField: field, sourceText });
    }
  } else {
    for (const sentence of source.sentences) {
      if (compensationCue.test(sentence) && usable(sentence)) candidates.push({ value: sentence, sourceField: field, sourceText: sentence });
    }
  }
  // A heading such as "Annual Salary Range" followed by the amounts: every
  // amount line under it (regional tiers are listed one per line).
  source.lines.forEach((line, index) => {
    if (line.length > 100 || !compensationCue.test(line) || salaryAmount.test(line)) return;
    for (let offset = 1; offset <= 6; offset += 1) {
      const next = source.lines[index + offset];
      if (!next || compensationCue.test(next) || !usable(next) || next.length > 80) break;
      const statement = /[:：]$/.test(line) ? `${line} ${next}` : `${line}: ${next}`;
      candidates.push({ value: statement, sourceField: field, sourceText: `${line}\n${next}` });
    }
  });
  // Page metadata: a line that is nothing but a salary ("$80K – $95K",
  // "$65k–$80k/year", "$100,000 or more USD").
  if (source.labelledOnly) {
    for (const line of source.lines) {
      if (line.length <= 60 && usable(line) && wholeSalary.test(line)) candidates.push({ value: line, sourceField: marker(source, "stated-salary"), sourceText: line });
    }
  }
  return candidates;
}

// A line made only of amounts, currency signs or codes, range separators and
// an annual period.
const wholeSalary =
  /^(?:[$€£₹]|\b(?:USD|CAD|AUD|NZD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|INR|SGD|JPY|MXN|BRL|ZAR|US\$|CA\$|C\$|A\$|AU\$)\b|\d[\d,.]*\s?[kKmM]?\b|\s|[-–—~]|\bto\b|\bor more\b|\band up\b|\+|\/\s*(?:yr|year)\b|\bper (?:year|annum)\b|\ba year\b|\bannual(?:ly)?\b|\byearly\b|[()])+$/i;

// Ranges stated for different places or zones, each with its own label.
const tierLabel = /\b(?:zones?|tiers?|bands?|regions?|areas?|markets?|metros?|locations?|geograph(?:y|ies|ic))\b/i;
const namesItsTier = (text: string) => tierLabel.test(text) || scanGeography(text).codes.length > 0;
// A tier as stated, with its own label: the amount line under a shared
// heading when that line names its place ("U.S.: USD 63,000 - 75,000"),
// otherwise the whole statement.
function tierStatement(candidate: TextFact<string>): string {
  const line = candidate.sourceText.split("\n").at(-1)!;
  return candidate.sourceText.includes("\n") && namesItsTier(line) ? line : candidate.value;
}

function compensationTiers(candidates: Array<TextFact<string>>): JobTextFacts["compensationTiers"] {
  const ranges = candidates
    .map((candidate) => ({ candidate, parsed: parseCompensation(candidate.value) }))
    .filter(({ parsed }) => parsed.amountsUnknownReason === null && parsed.minimum !== null && parsed.maximum !== null && parsed.minimum < parsed.maximum);
  const distinct = new Map<string, (typeof ranges)[number]>();
  for (const range of ranges) distinct.set(`${range.parsed.minimum}|${range.parsed.maximum}|${range.parsed.currency ?? ""}`, range);
  if (distinct.size < 2) return null;
  const tiers = [...distinct.values()];
  const currencies = new Set(tiers.map(({ parsed }) => parsed.currency));
  // Every tier must say which place or zone it is for: ranges that do not
  // are not tiers (they are conflicting evidence, and stay Unknown).
  if (!tiers.every(({ candidate }) => namesItsTier(tierStatement(candidate)))) return null;
  const text = tiers.map(({ candidate }) => tierStatement(candidate)).join(" / ");
  return {
    value: text,
    sourceField: tiers[0]!.candidate.sourceField.replace(/:[^:]+$/, ":compensation-tiers"),
    sourceText: tiers.map(({ candidate }) => candidate.sourceText).join("\n"),
    currency: currencies.size === 1 ? [...currencies][0] ?? null : null,
  };
}

// The compensation statements, read together. They agree when they say the
// same thing; they also agree when exactly one pay range is stated and the
// others only detail that same pay ("$65,000 - $75,000 a year" with "OTE =
// $75,000" and "$65,000 base + $10,000 variable"): a single amount within the
// range, or a breakdown none of whose amounts goes beyond it. Anything else
// (two ranges, a non-annual amount, another currency, an amount beyond the
// range) leaves compensation Unknown.
function agreedCompensation(candidates: Array<TextFact<string>>): TextFact<string> | null {
  const same = agreed(candidates, compensationReading);
  if (same || candidates.length < 2) return same;
  const readings = candidates.map((candidate) => ({ candidate, parsed: parseCompensation(candidate.value) }));
  const ranges = readings.filter(({ parsed }) => parsed.amountsUnknownReason === null && parsed.minimum !== null && parsed.maximum !== null && parsed.minimum < parsed.maximum);
  if (new Set(ranges.map(({ candidate }) => compensationReading(candidate.value))).size !== 1) return null;
  const range = ranges[0]!;
  const minimum = range.parsed.minimum!;
  const maximum = range.parsed.maximum!;
  const consistent = readings.every(({ candidate, parsed }) => {
    if (compensationReading(candidate.value) === compensationReading(range.candidate.value)) return true;
    if (parsed.currency !== null && range.parsed.currency !== null && parsed.currency !== range.parsed.currency) return false;
    if (parsed.currencyUnknownReason === "CONFLICTING_CURRENCIES") return false;
    if (parsed.amountsUnknownReason === "AMBIGUOUS_AMOUNTS") {
      const amounts = statedAmounts(candidate.value);
      return amounts.length > 0 && amounts.every((amount) => amount <= maximum);
    }
    if (parsed.amountsUnknownReason !== null) return false;
    const values = [parsed.minimum, parsed.maximum].filter((value): value is number => value !== null);
    return values.length > 0 && values.every((value) => value >= minimum && value <= maximum);
  });
  return consistent ? range.candidate : null;
}

// A compensation statement in the posting's own text that states exactly the
// given range as on-target earnings, if any: it says what a range the source
// stated elsewhere (structured amounts, a salary field) is. Only the
// description counts, never page context. The statement must state the same
// bounds (both, including an open end) in no other currency; OTE wording
// about some other figure, or a statement naming several figures (which
// parses as ambiguous), says nothing about this range.
export function onTargetStatementFor(
  text: string | null,
  range: { minimum: number | null; maximum: number | null; currency: string | null },
): TextFact<"OTE"> | null {
  if (range.minimum === null && range.maximum === null) return null;
  for (const candidate of collectCompensation(textSource(text, "rawText"))) {
    const parsed = parseCompensation(candidate.value);
    if (parsed.basis !== "OTE" || parsed.minimum !== range.minimum || parsed.maximum !== range.maximum) continue;
    if (parsed.currencyUnknownReason === "CONFLICTING_CURRENCIES") continue;
    if (parsed.currency !== null && range.currency !== null && parsed.currency !== range.currency) continue;
    return { value: "OTE", sourceField: candidate.sourceField, sourceText: candidate.sourceText };
  }
  return null;
}

// Several statements must say the same thing (the same amounts, reading and
// currency); otherwise the compensation is Unknown.
const compensationReading = (value: string) => {
  const parsed = parseCompensation(value);
  return [parsed.minimum, parsed.maximum, parsed.amountsUnknownReason, parsed.currency, parsed.currencyUnknownReason].join("|");
};

const postingDateLabels = ["posted on", "date posted", "posting date"];
const closingDateLabels = [
  "anticipated role close date", "anticipated close date", "closing date", "close date", "application closing date",
  "application deadline", "applications close", "applications close on", "deadline to apply", "apply by", "apply before", "deadline",
];

// A posting's stated age in its own metadata ("Posted 2 weeks ago", "3 days
// ago", "today"), as a date: the observation time minus that age, at day
// precision. Minutes, hours, days and weeks only; a month or more, "30+ days
// ago" and anything else stays Unknown. Never read from job-description
// prose: only a source's posted-age field or a page metadata line that is
// nothing but the age.
const relativeAge = /^(?:posted|reposted|published|listed)?\s*(?:(\d{1,2}|an?|one)\s+(minute|min|hour|hr|day|week|wk)s?\s+ago|(today|just now|yesterday))$/i;
export function relativePostedDate(text: string | null, observedAt: Date): Date | null {
  const match = text ? relativeAge.exec(text.replace(/\s+/g, " ").trim().replace(/[.:]$/, "")) : null;
  if (!match) return null;
  const amount = match[1] ? (/^\d+$/.test(match[1]) ? Number(match[1]) : 1) : match[3]!.toLowerCase() === "yesterday" ? 1 : 0;
  const unit = (match[2] ?? "day").toLowerCase();
  const days = unit.startsWith("w") ? amount * 7 : unit.startsWith("d") || match[3] ? amount : 0;
  const date = new Date(Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), observedAt.getUTCDate() - days));
  return Number.isNaN(date.getTime()) ? null : date;
}

// Dates are always read through their label (at the start of a sentence or
// a row-of-facts part, or on the line before), in both kinds of source.
function collectDate(source: TextSource, labels: readonly string[], kind: string): Array<TextFact<Date>> {
  const candidates: Array<TextFact<Date>> = [];
  const alternatives = [...labels].sort((a, b) => b.length - a.length).map(escape).join("|");
  const statement = new RegExp(`^(?:the\\s+)?(?:${alternatives})\\s*(?:[:：]|\\bis\\b|\\bwill be\\b)?\\s*(?:on\\s+|by\\s+)?`, "i");
  const seen = new Set<string>();
  const consider = (text: string, sourceText: string) => {
    const date = parseUnambiguousDate(text);
    if (date && !seen.has(`${sourceText}|${date.toISOString()}`)) {
      seen.add(`${sourceText}|${date.toISOString()}`);
      candidates.push({ value: date, sourceField: marker(source, kind), sourceText });
    }
  };
  for (const sentence of source.sentences) {
    const match = statement.exec(sentence);
    if (match) consider(sentence.slice(match[0].length), sentence);
  }
  // A line holding only the label, followed by the date.
  for (const { value, sourceText } of labelledValues(source.lines, labels)) {
    if (sourceText.includes("\n")) consider(value, sourceText);
  }
  return candidates;
}

// A two-letter U.S. zone ("ET", "PT") only right after a time ("5pm PT",
// "17:00 ET") or before "time"/"hours" ("ET hours"): elsewhere "CT" or "MT"
// is a state.
const shortZone = (letter: string) =>
  `(?<=\\d\\s?(?:[ap]\\.?m\\.?)?\\s?)${letter}T\\b|\\b${letter}T(?=\\s+(?:business\\s+|working\\s+|work\\s+|office\\s+|core\\s+)?(?:time|hours)\\b)`;
const usZone = (name: string, letter: string) =>
  new RegExp(
    `\\b${name}(?:\\s+(?:Standard|Daylight))?(?:\\s+Time\\b|(?=\\s+(?:business\\s+|working\\s+|work\\s+|office\\s+|core\\s+)?hours\\b))|\\b${letter}[SD]T\\b|${shortZone(letter)}`,
    "g",
  );
// European zones come first, so "Central European Time" is not also read as
// U.S. Central time.
const zoneFamilies: Array<[string, RegExp]> = [
  ["CET", /\b(?:CES?T|Central European(?:\s+(?:Summer|Standard))?\s+Time)\b/g],
  ["EET", /\b(?:EES?T|Eastern European(?:\s+(?:Summer|Standard))?\s+Time)\b/g],
  ["ET", usZone("Eastern", "E")],
  ["CT", usZone("Central", "C")],
  ["MT", usZone("Mountain", "M")],
  ["PT", usZone("Pacific", "P")],
  ["UTC", /\b(?:UTC|GMT)(?:\s?[+-]\s?\d{1,2}(?::\d{2})?)?(?![\w])/g],
  ["WET", /\b(?:WES?T|BST)\b/g],
  ["IST", /\bIST\b/g],
  ["AET", /\bAE[SD]T\b/g],
  ["JST", /\bJST\b/g],
  ["SGT", /\bSGT\b/g],
];
// The statement must require it: "must", "required", "need to", ...; a
// description of the team ("we overlap with Eastern hours") is not one.
const timeZoneRequirement = /\b(?:must|required|requires?|need(?:s)? to|expected to|able to work|available (?:during|for|to work|in))\b/i;
const timeZoneContext = /\b(?:hours|overlap(?:ping)?|time ?zones?|business day|working day|workday)\b|\d\s?(?:am|pm|a\.m\.|p\.m\.)/i;
const timeZoneQualifier = /\b(?:prefer(?:red|ably)?|ideally|ideal|nice to have|bonus|plus|flexible|optional|not required|any time ?zone|all time ?zones|regardless of)\b/i;
// A preference is kept as a preference (it says which zones are wanted);
// "flexible", "optional", "any time zone" state none.
const timeZonePreferenceWord = /\b(?:prefer(?:red|ably)?|ideally)\b/i;
const notAZoneStatement = /\b(?:nice to have|bonus|plus|flexible|optional|not required|any time ?zone|all time ?zones|regardless of)\b/i;

// "Eastern, Central or Mountain time zones": each zone in the list counts.
function expandZoneList(text: string): string {
  return text.replace(
    /\b(Eastern|Central|Mountain|Pacific)((?:\s*(?:,|\/|&|\bor\b|\band\b)\s*(?:Eastern|Central|Mountain|Pacific))+)(\s+(?:standard\s+)?time)/gi,
    (_match, first: string, rest: string) => [first, ...rest.split(/\s*(?:,|\/|&|\bor\b|\band\b)\s*/i).filter(Boolean)].map((zone) => `${zone} Time`).join(", "),
  );
}

// Pacific through Eastern ("between Pacific and Eastern time zones", or all
// four zones named) is the continental United States: geography, not a
// time-zone requirement or preference.
function continentalSpan(text: string, families: string[]): boolean {
  if (!families.includes("PT") || !families.includes("ET")) return false;
  return ["CT", "MT"].every((zone) => families.includes(zone)) || /\b(?:between|from|through|to|across)\b/i.test(text);
}

// The zone families a statement names, in a stable order.
function zoneFamiliesOf(text: string): string[] {
  const families: string[] = [];
  let rest = expandZoneList(text);
  for (const [family, pattern] of zoneFamilies) {
    pattern.lastIndex = 0;
    if (pattern.test(rest)) {
      families.push(family);
      pattern.lastIndex = 0;
      rest = rest.replace(pattern, " ");
    }
    pattern.lastIndex = 0;
  }
  return families.sort();
}

function collectTimeZone(source: TextSource): Array<TextFact<string>> {
  const candidates: Array<TextFact<string>> = [];
  for (const { value, sourceText } of labelledValues(source.lines, ["time zone", "timezone", "time zone requirement", "time zone requirements", "working hours", "required working hours", "work hours", "core hours"])) {
    if (zoneFamiliesOf(value).length && !timeZoneQualifier.test(value) && value.length <= 120) {
      candidates.push({ value: collapse(sourceText.replace("\n", ": ")), sourceField: marker(source, "labelled-time-zone"), sourceText });
    }
  }
  if (source.labelledOnly) return candidates.filter((candidate) => !continentalSpan(candidate.value, zoneFamiliesOf(candidate.value)));
  for (const sentence of source.sentences) {
    if (sentence.length > 200 || /^[^:]{1,40}[:：]/.test(sentence) || !timeZoneContext.test(sentence)) continue;
    const families = zoneFamiliesOf(sentence);
    if (!families.length || continentalSpan(sentence, families)) continue;
    if (timeZoneRequirement.test(sentence) && !timeZoneQualifier.test(sentence)) {
      candidates.push({ value: sentence, sourceField: marker(source, "explicit-time-zone-statement"), sourceText: sentence });
    } else if (timeZonePreferenceWord.test(sentence) && !notAZoneStatement.test(sentence) && !negation.test(sentence)) {
      // Kept as stated, so its wording says it is a preference.
      candidates.push({ value: sentence, sourceField: marker(source, "explicit-time-zone-preference"), sourceText: sentence });
    }
  }
  return candidates;
}

const labelledSeniorityValues: Record<string, Seniority> = {
  entry: "ENTRY",
  "entry level": "ENTRY",
  junior: "ENTRY",
  mid: "MID",
  "mid level": "MID",
  intermediate: "MID",
  senior: "SENIOR",
  lead: "LEAD",
  principal: "PRINCIPAL",
  director: "DIRECTOR",
  executive: "EXECUTIVE",
  "vice president": "EXECUTIVE",
  vp: "EXECUTIVE",
};

// A seniority or experience-level label as a source or a page states it
// ("Senior", "Entry level", "Mid-Level"); null for anything else
// ("Mid-Senior level", "Associate", "Manager").
export function standardizeSeniorityLabel(label: string | null): Seniority | null {
  if (!label) return null;
  const key = trimEnd(collapse(label)).toLowerCase().replace(/-/g, " ").replace(/\s+level$/, "");
  return labelledSeniorityValues[key] ?? null;
}

const seniorityLabels = ["seniority", "seniority level", "experience level", "career level"];

// A seniority label written as one ("Mid Level", "Junior and Mid level",
// "Mid-Senior level", "Entry-level"): level words joined by "and", "/", ","
// or "-", ending in "level". A bare "Senior" is not read as a label here.
const levelWord = "(?:entry|junior|mid|intermediate|senior|lead|principal|staff|director|executive)";
const seniorityLabelPattern = new RegExp(`^${levelWord}(?:\\s*(?:-|\\/|,|&|and|to)\\s*${levelWord})*[\\s-]+level$`, "i");

// Stated seniority labels, whether or not they name one level.
function collectSeniorityLabels(source: TextSource): Array<TextFact<string>> {
  const candidates: Array<TextFact<string>> = [];
  for (const { value, sourceText } of labelledValues(source.lines, seniorityLabels)) {
    const label = trimEnd(collapse(value));
    if (label && label.length <= 40 && (standardizeSeniorityLabel(label) || seniorityLabelPattern.test(label))) {
      candidates.push({ value: label, sourceField: marker(source, "labelled-seniority"), sourceText });
    }
  }
  if (source.labelledOnly) {
    for (const line of source.lines) {
      const label = trimEnd(line);
      if (label.length <= 40 && seniorityLabelPattern.test(label)) candidates.push({ value: label, sourceField: marker(source, "stated-seniority"), sourceText: line });
    }
  }
  return candidates;
}

function collectSeniority(source: TextSource): Array<TextFact<Seniority>> {
  return collectSeniorityLabels(source).flatMap((label) => {
    const seniority = standardizeSeniorityLabel(label.value);
    return seniority ? [{ value: seniority, sourceField: label.sourceField, sourceText: label.sourceText }] : [];
  });
}

// "Job Requisition ID: JR115971", "Req ID: 4521": one token with a digit.
const requisitionLabels = ["job requisition id", "requisition id", "requisition number", "requisition #", "requisition", "job req id", "req id", "req #", "req. id"];
function collectRequisitionId(source: TextSource): Array<TextFact<string>> {
  return labelledValues(source.lines, requisitionLabels, { colonOptional: true }).flatMap(({ value, sourceText }) => {
    const id = trimEnd(collapse(value));
    return /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(id) && /\d/.test(id) ? [{ value: id, sourceField: marker(source, "labelled-requisition-id"), sourceText }] : [];
  });
}

// A team the posting explicitly says the role joins: "You'll join Healthie's
// Customer Success team", "join our Revenue Operations team", "be part of
// the Support organization". The name must be written as a name (each word
// capitalized, at most four), and is never a description ("our growing
// team") or read from the job title or responsibilities.
const teamStatement =
  /\b(?:[Jj]oin(?:ing)?|[Bb]e(?:come)?\s+(?:a\s+)?part\s+of|[Ww]ork\s+(?:in|on|within))\s+(?:the\s+|our\s+|[A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3}['’]s\s+)((?:[A-Z][A-Za-z&-]*)(?:\s+(?:&|and|[A-Z][A-Za-z&-]*)){0,3})\s+(?:team|department|organization|organisation|org)\b/;
const notATeamName =
  /^(?:Growing|Amazing|Awesome|Talented|Global|Dynamic|World|Great|Fast|High|Passionate|Diverse|Innovative|Incredible|Small|Close|Tight|Collaborative|Remote|Distributed|Best|Expanding|Exciting|Brilliant|Friendly|Supportive|Fantastic|Wonderful|Our|The|Entire|Whole|New|Core|Founding|Leadership|Team)\b/;

function collectDepartment(source: TextSource): Array<TextFact<string>> {
  const labelled: Array<TextFact<string>> = [];
  for (const { value, sourceText } of labelledValues(source.lines, ["department", "team"])) {
    const department = trimEnd(collapse(value));
    if (!department || department.length > 60 || department.split(" ").length > 6) continue;
    if (!/^[A-Z0-9]/.test(department) || /[:.!?]\s|[:：]/.test(department) || proseWords.test(department)) continue;
    labelled.push({ value: department, sourceField: marker(source, "labelled-department"), sourceText });
  }
  // A labelled department outranks a statement in the prose.
  if (labelled.length || source.labelledOnly) return labelled;
  const stated: Array<TextFact<string>> = [];
  for (const sentence of source.sentences) {
    const match = teamStatement.exec(sentence);
    if (!match) continue;
    const name = match[1]!.trim();
    if (notATeamName.test(name) || isPlatformName(name) || proseWords.test(name)) continue;
    stated.push({ value: name, sourceField: marker(source, "explicit-team-statement"), sourceText: sentence });
  }
  return stated;
}

// ------------------------------------------------------ work authorization

// Common nationality words for a country, read only next to "citizen".
const demonyms: Record<string, string> = {
  american: "US", canadian: "CA", british: "GB", australian: "AU", irish: "IE", german: "DE", french: "FR",
  spanish: "ES", dutch: "NL", indian: "IN", mexican: "MX", brazilian: "BR", singaporean: "SG", swiss: "CH",
  swedish: "SE", italian: "IT", polish: "PL", portuguese: "PT", japanese: "JP", israeli: "IL",
};

// The countries a list names at the start of `text` (nothing ambiguous).
function regionsAfter(text: string): string[] {
  const reading = readGeographyList(text.replace(/^\s+/, ""));
  return reading.ambiguous ? [] : reading.codes;
}

// The countries named just before `text` ends ("U.S. work authorization",
// "a Canadian citizen"): the longest trailing run of words that reads as a
// geography list, or one nationality word.
function regionsBefore(text: string): string[] {
  const words = text.trim().split(/\s+/).slice(-5);
  const last = words.at(-1)?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  for (let start = 0; start < words.length; start += 1) {
    const candidate = words.slice(start).join(" ").replace(/[,;:]+$/, "");
    const reading = readGeographyList(candidate);
    if (!reading.ambiguous && reading.codes.length && reading.consumed >= candidate.length) return reading.codes;
  }
  return demonyms[last] ? [demonyms[last]!] : [];
}

const requirementWords = /\b(?:must|required|requires?|requirement|need(?:s|ed)?\s+to|have\s+to|has\s+to|mandatory|only\s+(?:consider|accept|open)|should\s+(?:have|hold|be))\b/i;
const conditional = /\b(?:prefer(?:red|ably)?|ideally|nice\s+to\s+have|a\s+plus|bonus|may|might|possibly|case[- ]by[- ]case|if\s+(?:needed|necessary|applicable)|where\s+applicable)\b/i;
// "without sponsorship" belongs to the sponsorship reading, not a negation
// of the requirement it qualifies.
const withoutSponsorship =
  /\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+|need\s+of\s+|the\s+need\s+of\s+)?(?:(?:current|now)\s+or\s+(?:in\s+the\s+)?future\s+)?(?:visa\s+|employer\s+|company\s+|immigration\s+|employment\s+)?sponsorship\b/i;
const negated = /\b(?:not|no|never|none)\b|n't\b/i;
// A sponsorship clause inside a requirement sentence ("…, and we cannot
// sponsor visas") is the sponsorship reading; it does not negate the
// requirement.
const sponsorshipClause =
  /[,;]?\s*(?:and\s+|but\s+)?(?:(?:we|they|the\s+company)\s+)?(?:are\s+|is\s+)?(?:unable|not\s+able|cannot|can\s?not|can't|do\s+not|don't|does\s+not|doesn't|will\s+not|won't)\b[^.;]*\bsponsor\w*|[,;]?\s*(?:and\s+)?no\s+(?:visa\s+|immigration\s+)?sponsorship\b[^.;]*/gi;

function collectWorkAuthorization(source: TextSource): Array<TextFact<{ requirement: WorkAuthorizationRequirement; regions: string[] }>> {
  const candidates: Array<TextFact<{ requirement: WorkAuthorizationRequirement; regions: string[] }>> = [];
  const add = (requirement: WorkAuthorizationRequirement, regions: string[], kind: string, sourceText: string) => {
    if (regions.length) candidates.push({ value: { requirement, regions: [...regions].sort() }, sourceField: marker(source, kind), sourceText });
  };
  // "Work authorization: United States", "Right to work: UK required".
  for (const { value, sourceText } of labelledValues(source.lines, ["work authorization", "work authorisation", "right to work", "work eligibility", "work permit"])) {
    const regions = parseGeographyList(trimEnd(collapse(value)).replace(/\s+(?:required|only)$/i, "")) ?? [];
    add("RIGHT_TO_WORK", regions, "labelled-work-authorization", sourceText);
  }
  if (source.labelledOnly) return candidates;
  for (const sentence of source.sentences) {
    if (conditional.test(sentence) || negated.test(sentence.replace(withoutSponsorship, "").replace(sponsorshipClause, ""))) continue;
    if (!requirementWords.test(sentence)) continue;
    // Citizenship: "must be a U.S. citizen", "citizenship of Canada is required".
    const citizenOf = /\bcitizen(?:s|ship)?\s+(?:of|in)\s+/i.exec(sentence);
    const citizen = /\bcitizen(?:s|ship)?\b/i.exec(sentence);
    if (citizenOf) {
      add("CITIZENSHIP", regionsAfter(sentence.slice(citizenOf.index + citizenOf[0].length)), "explicit-citizenship-statement", sentence);
      continue;
    }
    if (citizen) {
      add("CITIZENSHIP", regionsBefore(sentence.slice(0, citizen.index)), "explicit-citizenship-statement", sentence);
      continue;
    }
    // A right to work: "authorized to work in the United States", "the
    // right to work in the UK", "a valid work permit for Germany".
    const after = /\b(?:(?:legally\s+)?(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work|(?:legal\s+)?right\s+to\s+work|(?:work\s+)?(?:authori[sz]ation|eligibility|permission)\s+to\s+work|work\s+(?:authori[sz]ation|permit|visa|eligibility)|(?:valid\s+)?(?:work\s+)?visa)\s+(?:full[- ]time\s+)?(?:in|within|for)\s+/i.exec(sentence);
    if (after) {
      add("RIGHT_TO_WORK", regionsAfter(sentence.slice(after.index + after[0].length)), "explicit-work-authorization-statement", sentence);
      continue;
    }
    // "<country> work authorization is required".
    const before = /\bwork\s+(?:authori[sz]ation|permit|eligibility)\s+(?:is\s+|will\s+be\s+)?(?:required|mandatory|a\s+must)\b/i.exec(sentence);
    if (before) add("RIGHT_TO_WORK", regionsBefore(sentence.slice(0, before.index)), "explicit-work-authorization-statement", sentence);
  }
  return candidates;
}

const availableValues: Record<string, OfferAvailability> = {
  yes: "AVAILABLE", available: "AVAILABLE", offered: "AVAILABLE", provided: "AVAILABLE", supported: "AVAILABLE",
  no: "NOT_AVAILABLE", none: "NOT_AVAILABLE", "not available": "NOT_AVAILABLE", unavailable: "NOT_AVAILABLE",
  "not offered": "NOT_AVAILABLE", "not provided": "NOT_AVAILABLE", "not supported": "NOT_AVAILABLE",
};

function collectOffer(
  source: TextSource,
  labels: readonly string[],
  topic: RegExp,
  notOffered: readonly RegExp[],
  offered: readonly RegExp[],
  kind: { labelled: string; statement: string },
): Array<TextFact<OfferAvailability>> {
  const candidates: Array<TextFact<OfferAvailability>> = [];
  for (const { value, sourceText } of labelledValues(source.lines, labels)) {
    const availability = availableValues[trimEnd(collapse(value)).toLowerCase()];
    if (availability) candidates.push({ value: availability, sourceField: marker(source, kind.labelled), sourceText });
  }
  if (source.labelledOnly) return candidates;
  for (const sentence of source.sentences) {
    if (!topic.test(sentence) || conditional.test(sentence)) continue;
    if (notOffered.some((pattern) => pattern.test(sentence))) {
      candidates.push({ value: "NOT_AVAILABLE", sourceField: marker(source, kind.statement), sourceText: sentence });
    } else if (!negated.test(sentence) && offered.some((pattern) => pattern.test(sentence))) {
      candidates.push({ value: "AVAILABLE", sourceField: marker(source, kind.statement), sourceText: sentence });
    }
  }
  return candidates;
}

const collectSponsorship = (source: TextSource) =>
  collectOffer(
    source,
    ["visa sponsorship", "sponsorship", "visa sponsorship available"],
    /\bsponsor/i,
    [
      /\b(?:unable|not\s+able|cannot|can\s?not|can't|do\s+not|don't|does\s+not|doesn't|will\s+not|won't|are\s+not|is\s+not|isn't|aren't|no\s+longer)\b[^.]{0,40}\bsponsor/i,
      /\bno\s+(?:visa\s+|immigration\s+|employment\s+|work\s+)?sponsorship\b/i,
      /\bsponsorship\s+(?:is\s+|will\s+)?not\s+(?:be\s+)?(?:available|offered|provided|possible)\b/i,
      withoutSponsorship,
    ],
    [
      /\b(?:visa\s+|immigration\s+|work\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/i,
      /\b(?:we|they|the\s+company)\s+(?:will|can|do|does|are\s+able\s+to|is\s+able\s+to)\s+(?:provide\s+|offer\s+)?(?:visa\s+)?sponsor(?:ship)?\b/i,
      /\b(?:we|they)\s+sponsor\b/i,
      /\bopen\s+to\s+sponsoring\b/i,
    ],
    { labelled: "labelled-sponsorship", statement: "explicit-sponsorship-statement" },
  );

const collectRelocation = (source: TextSource) =>
  collectOffer(
    source,
    ["relocation", "relocation assistance", "relocation support"],
    /\breloca/i,
    [
      /\b(?:no|(?:(?:are|is)\s+)?(?:not|unable\s+to|cannot|can't|do\s+not|don't|does\s+not|will\s+not|won't)\s+(?:offer|provide|include))\s+(?:any\s+)?reloca\w*\s+(?:assistance|support|package|benefits?|stipend)\b/i,
      /\breloca\w*\s+(?:assistance|support|package|benefits?|stipend)\s+(?:is\s+|are\s+|will\s+)?not\s+(?:be\s+)?(?:available|provided|offered|included)\b/i,
    ],
    [
      /\breloca\w*\s+(?:assistance|support|package|benefits?|stipend)\s+(?:is\s+|are\s+|will\s+be\s+)?(?:available|provided|offered|included)\b/i,
      /\b(?:we|the\s+company)\s+(?:offer|provide)s?\s+(?:full\s+|generous\s+)?reloca/i,
    ],
    { labelled: "labelled-relocation", statement: "explicit-relocation-statement" },
  );

// "We can employ you through an employer of record in Spain or Portugal."
function collectEmployerOfRecord(source: TextSource): Array<TextFact<string[]>> {
  if (source.labelledOnly) return [];
  const candidates: Array<TextFact<string[]>> = [];
  for (const sentence of source.sentences) {
    const eor = /\b(?:employer\s+of\s+record|EOR)\b/.exec(sentence) ?? /\bemployer\s+of\s+record\b/i.exec(sentence);
    if (!eor || conditional.test(sentence) || negated.test(sentence)) continue;
    if (!/\b(?:can|will|through|via|using|hire|hires|hiring|employ|employs|employed)\b/i.test(sentence)) continue;
    const place = /\b(?:in|across|for)\s+/i.exec(sentence.slice(eor.index + eor[0].length));
    if (!place) continue;
    const regions = regionsAfter(sentence.slice(eor.index + eor[0].length + place.index + place[0].length));
    if (regions.length) candidates.push({ value: [...regions].sort(), sourceField: marker(source, "explicit-employer-of-record-statement"), sourceText: sentence });
  }
  return candidates;
}

export interface JobTextInput {
  // The posting's own text (the description).
  text: string | null;
  // When the posting was observed: a page metadata line that states only the
  // posting's age ("Posted 1 week ago") is dated from it.
  observedAt?: Date | null;
  title: string | null;
  // Neutral page context a page-based collector may supply: the document
  // title, and the job's bounded page content around its structured
  // description (labelled job metadata such as "Remote Type: Hybrid").
  pageTitle?: string | null;
  pageText?: string | null;
  // The location the source stated, if any (never read as an employer).
  location?: string | null;
  // The employer the source stated, if any (never read as a team name).
  company?: string | null;
}

// The countries (and regions) a location names, with sub-national codes read
// as their country.
const countriesIn = (codes: readonly string[]) => new Set(codes.map((code) => code.split("-")[0]!));

// A labelled location in the posting's own text that contains the source's
// location and names more ("Canada" inside "Chicago Office or Remote, North
// America (US & Canada)"). Only a labelled line counts, never prose, and only
// when it includes every place the source names: it never replaces a source
// location it disagrees with.
function broaderLabelledLocation(sourceLocation: string | null | undefined, candidates: Array<TextFact<string>>): TextFact<string> | null {
  const source = readLocationGeography(sourceLocation);
  if (!sourceLocation || source.ambiguous || !source.codes.length) return null;
  const sourceCountries = countriesIn(source.codes);
  const broader = candidates.filter((candidate) => {
    if (!candidate.sourceField.endsWith(":labelled-location")) return false;
    const stated = scanGeography(candidate.value);
    const statedCountries = countriesIn(stated.codes);
    return statedCountries.size > sourceCountries.size && [...sourceCountries].every((code) => statedCountries.has(code));
  });
  return agreed(broader);
}

// Facts read from the posting text and the bounded page context. Both are
// fallback evidence below the source's structured values: a candidate from
// either one counts, and two that disagree leave the fact Unknown.
export function readJobTextFacts(input: JobTextInput): JobTextFacts {
  const posting = textSource(input.text, "rawText");
  const page = textSource(input.pageText, "pageContext");
  const sources = [posting, page];
  const title = input.title ? collapse(input.title) : null;
  const pageTitle = input.pageTitle ? collapse(input.pageTitle) : null;

  const locations = sources.map(collectLocation);
  // Two statements of the same geography ("U.S." and "USA") agree.
  const locationKey = (value: string) => parseGeographyList(value)?.sort().join(",") ?? value.toLowerCase();
  const location = locations.some((reading) => reading.conflict) ? null : agreed(locations.flatMap((reading) => reading.candidates), locationKey);

  const positions = sources.map(collectArrangementAndEmployment);
  const arrangements = positions.flatMap((reading) => reading.arrangements);
  // "Location: Remote" states the arrangement too.
  if (location && location.sourceField.endsWith(":labelled-location")) {
    const arrangement = labelledArrangementValues[location.value.toLowerCase()];
    if (arrangement) arrangements.push({ value: arrangement, sourceField: location.sourceField, sourceText: location.sourceText });
  }
  // Several arrangements offered as options are kept as stated. Statements
  // agree when they offer the same options; a single arrangement stated
  // elsewhere agrees when it is one of them. Anything else conflicts.
  const arrangementConflict = positions.some((reading) => reading.arrangementConflict);
  const offered = arrangementConflict ? null : agreed(positions.flatMap((reading) => reading.arrangementOptions), (value) => [...value].sort().join(","));
  const optionsConsistent = offered !== null && arrangements.every((candidate) => offered.value.includes(candidate.value));
  const optionsStated = positions.some((reading) => reading.arrangementOptions.length > 0);
  const workArrangements = optionsConsistent ? offered : null;
  const remoteStatus = arrangementConflict || optionsStated ? null : agreed(arrangements);
  const employmentType = positions.some((reading) => reading.employmentConflict) ? null : agreed(positions.flatMap((reading) => reading.employments));

  const companies = sources.flatMap((source) => collectCompany(source, title));
  if (title && pageTitle) {
    const knownPlaces = [input.location ?? "", location?.value ?? ""];
    const name = companyFromPageTitle(pageTitle, title, knownPlaces, `${input.text ?? ""}\n${input.pageText ?? ""}`);
    if (name) companies.push({ value: name, sourceField: jobTextSourceFields.pageTitleCompany, sourceText: pageTitle });
  }

  const compensationCandidates = sources.flatMap(collectCompensation);
  const tiers = compensationTiers(compensationCandidates);
  // A page metadata line that is only the posting's age.
  const postedAges: Array<TextFact<Date>> = [];
  if (input.observedAt) {
    for (const line of page.lines) {
      const date = line.length <= 40 ? relativePostedDate(line, input.observedAt) : null;
      if (date) postedAges.push({ value: date, sourceField: pageContextSourceFields.relativePostedAge, sourceText: line });
    }
  }
  return {
    companyName: agreed(companies),
    location,
    workArrangements,
    broaderLocation: broaderLabelledLocation(input.location, locations.flatMap((reading) => reading.candidates)),
    remoteStatus,
    employmentType,
    compensation: tiers ? null : agreedCompensation(compensationCandidates),
    compensationTiers: tiers,
    postingDate: agreed(
      [...sources.flatMap((source) => collectDate(source, postingDateLabels, "explicit-posting-date-statement")), ...postedAges],
      (date) => date.toISOString(),
    ),
    closingDate: agreed(sources.flatMap((source) => collectDate(source, closingDateLabels, "explicit-closing-date-statement")), (date) => date.toISOString()),
    timeZoneRequirements: agreed(sources.flatMap(collectTimeZone), (value) => zoneFamiliesOf(value).join(",")),
    seniority: agreed(sources.flatMap(collectSeniority)),
    seniorityLabel: agreed(sources.flatMap(collectSeniorityLabels)),
    requisitionId: agreed(sources.flatMap(collectRequisitionId)),
    // A team named after the employer ("join the Healthie team") is not a
    // department.
    department: agreed(
      sources
        .flatMap(collectDepartment)
        .filter((candidate) => ![input.company ?? "", ...companies.map((company) => company.value)].some((name) => name && sameText(name, candidate.value))),
    ),
    workAuthorization: agreed(sources.flatMap(collectWorkAuthorization), (value) => `${value.requirement}|${value.regions.join(",")}`),
    visaSponsorship: agreed(sources.flatMap(collectSponsorship)),
    relocationSupport: agreed(sources.flatMap(collectRelocation)),
    employerOfRecord: agreed(sources.flatMap(collectEmployerOfRecord), (value) => value.join(",")),
  };
}

// Change detection for page context (Core TDD §51). The page content a
// collector sends can change for reasons that mean nothing (navigation,
// layout, widgets), so it is never hashed as text. What is hashed instead is
// this canonical evidence: every labelled value the shared reader takes from
// the page context, and the employer the page title names, for each fact
// the source does not already supply at a higher precedence (`supplied`).
// The same meaningful evidence gives the same list (sorted, case-folded),
// noise gives nothing, and a changed labelled value ("Remote Type: Hybrid" →
// "Remote") changes it.
export type EvidenceFact = keyof JobTextFacts;

export function pageContextEvidence(
  input: JobTextInput,
  supplied: Partial<Record<EvidenceFact, boolean>> = {},
): string[] {
  const page = textSource(input.pageText, "pageContext");
  const evidence = new Set<string>();
  const add = (fact: EvidenceFact, values: string[]) => {
    if (supplied[fact]) return;
    for (const value of values) evidence.add(`${fact}=${collapse(value).toLowerCase()}`);
  };
  const title = input.title ? collapse(input.title) : null;
  add("companyName", collectCompany(page, title).map((candidate) => candidate.value));
  if (title && input.pageTitle) {
    const name = companyFromPageTitle(collapse(input.pageTitle), title, [input.location ?? ""], `${input.text ?? ""}\n${input.pageText ?? ""}`);
    if (name) add("companyName", [name]);
  }
  add("location", collectLocation(page).candidates.map((candidate) => candidate.value));
  const position = collectArrangementAndEmployment(page);
  add("remoteStatus", [...position.arrangements.map((candidate) => candidate.value), ...position.arrangementOptions.map((candidate) => candidate.value.join("/"))]);
  add("employmentType", position.employments.map((candidate) => candidate.value));
  add("compensation", collectCompensation(page).map((candidate) => compensationReading(candidate.value)));
  add("postingDate", collectDate(page, postingDateLabels, "explicit-posting-date-statement").map((candidate) => candidate.value.toISOString()));
  add("closingDate", collectDate(page, closingDateLabels, "explicit-closing-date-statement").map((candidate) => candidate.value.toISOString()));
  add("timeZoneRequirements", collectTimeZone(page).map((candidate) => candidate.value));
  add("seniority", collectSeniorityLabels(page).map((candidate) => candidate.value));
  add("requisitionId", collectRequisitionId(page).map((candidate) => candidate.value));
  // A posting age is not evidence of a change: it moves with time.
  add("department", collectDepartment(page).map((candidate) => candidate.value));
  add("workAuthorization", collectWorkAuthorization(page).map((candidate) => `${candidate.value.requirement}:${candidate.value.regions.join(",")}`));
  add("visaSponsorship", collectSponsorship(page).map((candidate) => candidate.value));
  add("relocationSupport", collectRelocation(page).map((candidate) => candidate.value));
  return [...evidence].sort();
}
