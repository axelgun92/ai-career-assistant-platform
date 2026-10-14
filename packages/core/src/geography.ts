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

export function geographyName(code: string): string {
  return geographyCountryNames[code] ?? geographyRegionNames[code] ?? code;
}

// Written forms → code. Long forms match case-insensitively; short codes and
// abbreviations only as written in capitals ("US", "UK", "EU"), so a pronoun
// such as "us" is never read as a country.
const longForms: Array<[string, string]> = [
  ["united states of america", "US"],
  ["united states", "US"],
  ["united kingdom", "GB"],
  ["great britain", "GB"],
  ["england", "GB"],
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
];
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
];
const sortedLongForms = [...longForms].sort((a, b) => b[0].length - a[0].length);

// One geography name at the very start of `text`.
function matchOne(text: string): { code: string; length: number } | null {
  const article = /^the\s+/i.exec(text);
  const offset = article ? article[0].length : 0;
  const rest = text.slice(offset);
  const lower = rest.toLowerCase();
  for (const [name, code] of sortedLongForms) {
    if (lower.startsWith(name) && !/^[a-z]/i.test(rest.slice(name.length))) {
      return { code, length: offset + name.length };
    }
  }
  for (const [pattern, code] of shortForms) {
    const match = pattern.exec(rest);
    if (match) return { code, length: offset + match[0].length };
  }
  return null;
}

const connector = /^\s*(?:,\s*(?:or|and)?|\/|&|\+|\bor\b|\band\b)\s*/i;

// A list of geographies at the start of `text` ("the US or Canada", "Spain,
// Portugal and France"). Stops at the first word that is not a geography;
// `consumed` tells how far it read.
export function readGeographyList(text: string): { codes: string[]; consumed: number } {
  const codes: string[] = [];
  let position = 0;
  let consumed = 0;
  for (;;) {
    const match = matchOne(text.slice(position));
    if (!match) break;
    if (!codes.includes(match.code)) codes.push(match.code);
    position += match.length;
    consumed = position;
    const next = connector.exec(text.slice(position));
    if (!next) break;
    position += next[0].length;
  }
  return { codes, consumed };
}

// The whole text must be a geography list (surrounding punctuation allowed).
export function parseGeographyList(text: string): string[] | null {
  const trimmed = text.replace(/^[\s()[\],.;:–—-]+|[\s()[\],.;:–—-]+$/g, "");
  if (!trimmed) return null;
  const { codes, consumed } = readGeographyList(trimmed);
  return codes.length && consumed === trimmed.length ? codes : null;
}

// Classification of an eligible-geography list: only the United States →
// US_REQUIRED; anything that permits residence elsewhere → NON_US.
export function residencyRequirementFor(codes: readonly string[]): ResidencyRequirement | null {
  if (!codes.length) return null;
  return codes.length === 1 && codes[0] === "US" ? "US_REQUIRED" : "NON_US";
}
