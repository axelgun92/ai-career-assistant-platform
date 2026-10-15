// Domain-neutral residency / geographic-eligibility vocabulary. Codes are
// ISO 3166-1 alpha-2 for countries plus a few named regions. Names are only
// ever matched when written out; nothing is inferred from a city, a
// currency, a company headquarters or nationality.

export const residencyRequirementValues = ["US_REQUIRED", "NON_US"] as const;
// US_REQUIRED: residence must be in the United States.
// NON_US: residence outside the United States is explicitly permitted or
//   required (for example "must be based in Spain", "EU residents only",
//   "US or Canada", "anywhere in the world").
// null: Unknown (not stated, ambiguous or conflicting).
export type ResidencyRequirement = (typeof residencyRequirementValues)[number];

export const geographyRegionNames: Record<string, string> = {
  WORLDWIDE: "Worldwide",
  EU: "European Union",
  EEA: "European Economic Area",
  EUROPE: "Europe",
  EMEA: "EMEA",
  LATAM: "Latin America",
  APAC: "Asia-Pacific",
  NORTH_AMERICA: "North America",
  AMERICAS: "Americas",
};

export const geographyCountryNames: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  MX: "Mexico",
  BR: "Brazil",
  AR: "Argentina",
  CO: "Colombia",
  CL: "Chile",
  PE: "Peru",
  GB: "United Kingdom",
  IE: "Ireland",
  ES: "Spain",
  PT: "Portugal",
  FR: "France",
  DE: "Germany",
  NL: "Netherlands",
  BE: "Belgium",
  IT: "Italy",
  PL: "Poland",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  CH: "Switzerland",
  AT: "Austria",
  GR: "Greece",
  RO: "Romania",
  CZ: "Czechia",
  HU: "Hungary",
  UA: "Ukraine",
  IL: "Israel",
  TR: "Turkey",
  AE: "United Arab Emirates",
  IN: "India",
  PH: "Philippines",
  SG: "Singapore",
  JP: "Japan",
  AU: "Australia",
  NZ: "New Zealand",
  ZA: "South Africa",
  NG: "Nigeria",
  KE: "Kenya",
  EG: "Egypt",
};

// Sub-national units, as ISO 3166-2 codes ("US-TX", "CA-ON", "GB-SCT").
// U.S. states, DC and Puerto Rico are U.S. geography; provinces and
// territories belong to Canada; UK nations to the United Kingdom.
export const geographySubdivisionNames: Record<string, string> = {
  "US-AL": "Alabama", "US-AK": "Alaska", "US-AZ": "Arizona", "US-AR": "Arkansas", "US-CA": "California",
  "US-CO": "Colorado", "US-CT": "Connecticut", "US-DE": "Delaware", "US-FL": "Florida", "US-GA": "Georgia",
  "US-HI": "Hawaii", "US-ID": "Idaho", "US-IL": "Illinois", "US-IN": "Indiana", "US-IA": "Iowa",
  "US-KS": "Kansas", "US-KY": "Kentucky", "US-LA": "Louisiana", "US-ME": "Maine", "US-MD": "Maryland",
  "US-MA": "Massachusetts", "US-MI": "Michigan", "US-MN": "Minnesota", "US-MS": "Mississippi", "US-MO": "Missouri",
  "US-MT": "Montana", "US-NE": "Nebraska", "US-NV": "Nevada", "US-NH": "New Hampshire", "US-NJ": "New Jersey",
  "US-NM": "New Mexico", "US-NY": "New York", "US-NC": "North Carolina", "US-ND": "North Dakota", "US-OH": "Ohio",
  "US-OK": "Oklahoma", "US-OR": "Oregon", "US-PA": "Pennsylvania", "US-RI": "Rhode Island", "US-SC": "South Carolina",
  "US-SD": "South Dakota", "US-TN": "Tennessee", "US-TX": "Texas", "US-UT": "Utah", "US-VT": "Vermont",
  "US-VA": "Virginia", "US-WA": "Washington State", "US-WV": "West Virginia", "US-WI": "Wisconsin", "US-WY": "Wyoming",
  "US-DC": "Washington, D.C.", "US-PR": "Puerto Rico",
  "CA-AB": "Alberta", "CA-BC": "British Columbia", "CA-MB": "Manitoba", "CA-NB": "New Brunswick",
  "CA-NL": "Newfoundland and Labrador", "CA-NS": "Nova Scotia", "CA-NT": "Northwest Territories", "CA-NU": "Nunavut",
  "CA-ON": "Ontario", "CA-PE": "Prince Edward Island", "CA-QC": "Quebec", "CA-SK": "Saskatchewan", "CA-YT": "Yukon",
  "GB-ENG": "England", "GB-SCT": "Scotland", "GB-WLS": "Wales", "GB-NIR": "Northern Ireland",
};

export function geographyName(code: string): string {
  return geographyCountryNames[code] ?? geographySubdivisionNames[code] ?? geographyRegionNames[code] ?? code;
}

// True for the United States or any part of it.
export const isUnitedStatesGeography = (code: string) => code === "US" || code.startsWith("US-");

// Written forms → code. Long forms match case-insensitively; short codes and
// abbreviations only as written in capitals ("US", "UK", "EU"), so a pronoun
// such as "us" is never read as a country.
const longForms: Array<[string, string]> = [
  ["united states of america", "US"],
  ["united states", "US"],
  ["united kingdom", "GB"],
  ["great britain", "GB"],
  ["european union", "EU"],
  ["european economic area", "EEA"],
  ["europe", "EUROPE"],
  ["latin america", "LATAM"],
  ["asia-pacific", "APAC"],
  ["asia pacific", "APAC"],
  ["north america", "NORTH_AMERICA"],
  ["the americas", "AMERICAS"],
  ["americas", "AMERICAS"],
  ["czech republic", "CZ"],
  ["the netherlands", "NL"],
  ["united arab emirates", "AE"],
  ["new zealand", "NZ"],
  ["south africa", "ZA"],
  ...Object.entries(geographyCountryNames)
    .filter(([code]) => !["US", "GB", "NZ", "ZA", "AE"].includes(code))
    .map(([code, name]) => [name.toLowerCase(), code] as [string, string]),
  // Sub-national names. "Georgia" (a U.S. state and a country) and a bare
  // "Washington" (a state or D.C.) are ambiguous and listed separately.
  ...Object.entries(geographySubdivisionNames)
    .filter(([code]) => !["US-GA", "US-WA", "US-DC"].includes(code))
    .map(([code, name]) => [name.toLowerCase(), code] as [string, string]),
  ["washington state", "US-WA"],
  ["state of washington", "US-WA"],
  ["washington, d.c.", "US-DC"],
  ["washington, dc", "US-DC"],
  ["washington d.c.", "US-DC"],
  // A trailing period may already be trimmed ("Washington, D.C").
  ["washington, d.c", "US-DC"],
  ["washington d.c", "US-DC"],
  ["washington dc", "US-DC"],
  ["district of columbia", "US-DC"],
  ["québec", "CA-QC"],
  ["newfoundland", "CA-NL"],
  ["yukon territory", "CA-YT"],
];
// Names that cannot be resolved without guessing: never read as either.
const ambiguousLongForms = ["georgia", "washington"];
// A city that shares its name with the state is not the state.
const notTheState = /^\s+city\b/i;
const shortForms: Array<[RegExp, string]> = [
  [/^U\.S\.A\.?/, "US"],
  [/^U\.S\.?/, "US"],
  [/^USA(?![A-Za-z])/, "US"],
  [/^US(?![A-Za-z])/, "US"],
  [/^U\.K\.?/, "GB"],
  [/^UK(?![A-Za-z])/, "GB"],
  [/^EU(?![A-Za-z])/, "EU"],
  [/^EEA(?![A-Za-z])/, "EEA"],
  [/^EMEA(?![A-Za-z])/, "EMEA"],
  [/^LATAM(?![A-Za-z])/i, "LATAM"],
  [/^APAC(?![A-Za-z])/, "APAC"],
  [/^UAE(?![A-Za-z])/, "AE"],
  [/^D\.C\.?/, "US-DC"],
];
// Postal abbreviations, only as written in capitals and only for U.S.
// states and Canadian provinces/territories (the two sets do not overlap).
// "CA" is ambiguous (California or Canada) and is never resolved.
const subdivisionAbbreviations: Record<string, string> = Object.fromEntries([
  ...["AL", "AK", "AZ", "AR", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
    "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
    "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"].map((code) => [code, `US-${code}`]),
  ...["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"].map((code) => [code, `CA-${code}`]),
]);
const ambiguousAbbreviations = new Set(["CA"]);
const sortedLongForms = [...longForms].sort((a, b) => b[0].length - a[0].length);

type Match =
  | { code: string; length: number; abbreviation: boolean }
  | { ambiguous: true };

// One geography name at the very start of `text`.
function matchOne(text: string): Match | null {
  const article = /^the\s+/i.exec(text);
  const offset = article ? article[0].length : 0;
  const rest = text.slice(offset);
  const lower = rest.toLowerCase();
  const ends = (length: number) => !/^[a-z]/i.test(rest.slice(length));
  for (const [name, code] of sortedLongForms) {
    if (lower.startsWith(name) && ends(name.length)) {
      if (notTheState.test(rest.slice(name.length))) return null;
      return { code, length: offset + name.length, abbreviation: false };
    }
  }
  if (ambiguousLongForms.some((name) => lower.startsWith(name) && ends(name.length))) return { ambiguous: true };
  for (const [pattern, code] of shortForms) {
    const match = pattern.exec(rest);
    if (match) return { code, length: offset + match[0].length, abbreviation: false };
  }
  const abbreviation = /^[A-Z]{2}(?![A-Za-z])/.exec(rest)?.[0];
  if (abbreviation && ambiguousAbbreviations.has(abbreviation)) return { ambiguous: true };
  if (abbreviation && subdivisionAbbreviations[abbreviation]) {
    return { code: subdivisionAbbreviations[abbreviation]!, length: offset + 2, abbreviation: true };
  }
  return null;
}

const connector = /^\s*(?:,\s*(?:or|and)?|\/|&|\+|\bor\b|\band\b)\s*/i;
// "or", "and", "/", "&", "+" always join list items; a plain comma may end
// the list ("in Texas, Monday to Friday").
const joinsItems = (separator: string) => !/^\s*,\s*$/.test(separator);

export interface GeographyListReading {
  codes: string[];
  consumed: number;
  // An ambiguous name (Georgia, Washington, CA) or a list item that is not a
  // supported geography ("Texas or Puerto Rico" reads fine; "Texas or Narnia"
  // does not): the list cannot be read without guessing.
  ambiguous: boolean;
  // A two-letter postal abbreviation was read ("TX", "ON").
  abbreviated: boolean;
}

// A list of geographies at the start of `text` ("the US or Canada", "Texas,
// Florida or Ohio", "TX/FL/GA"). Stops at the first word that is not a
// geography; `consumed` tells how far it read.
export function readGeographyList(text: string): GeographyListReading {
  const reading: GeographyListReading = { codes: [], consumed: 0, ambiguous: false, abbreviated: false };
  let position = 0;
  let separator: string | null = null;
  for (;;) {
    const match = matchOne(text.slice(position));
    if (match && "ambiguous" in match) {
      reading.ambiguous = true;
      break;
    }
    if (!match) {
      // A joined item that is not a supported geography makes the list partial.
      if (separator !== null && joinsItems(separator) && /^[A-Z]/.test(text.slice(position))) reading.ambiguous = true;
      break;
    }
    if (!reading.codes.includes(match.code)) reading.codes.push(match.code);
    reading.abbreviated ||= match.abbreviation;
    position += match.length;
    reading.consumed = position;
    const next = connector.exec(text.slice(position));
    if (!next) break;
    separator = next[0];
    position += next[0].length;
  }
  return reading;
}

// The whole text must be a geography list (surrounding punctuation allowed).
export function parseGeographyList(text: string): string[] | null {
  const trimmed = text.replace(/^[\s()[\],.;:–—-]+|[\s()[\],.;:–—-]+$/g, "");
  if (!trimmed) return null;
  const reading = readGeographyList(trimmed);
  return reading.codes.length && !reading.ambiguous && reading.consumed === trimmed.length ? reading.codes : null;
}

// Classification of an eligible-geography list: residence restricted
// entirely to U.S. geography (the country, states, DC, Puerto Rico) →
// US_REQUIRED; anything that permits residence elsewhere → NON_US.
export function residencyRequirementFor(codes: readonly string[]): ResidencyRequirement | null {
  if (!codes.length) return null;
  return codes.every(isUnitedStatesGeography) ? "US_REQUIRED" : "NON_US";
}
