import { geographyCountryNames, readLocationGeography, scanGeography, type CompensationTier } from "@ai-career/core";

// The primary range of country-labelled salary tiers (Workstream B, November
// 5, 2026). A posting that states a range per country ("U.S.: $86,000 –
// $95,000 USD · Canada: $77,000 – $85,000 CAD") keeps every tier, each in its
// own currency, never converted or combined. One tier is also the role's
// salary only when the posting's own evidence says where the role is hired:
//   1. every tier is a country (intra-country zones never pick a primary);
//   2. the eligibility evidence names exactly one country: the residency the
//      posting states, or else the job's stated location's country, when the
//      rest of the posting names no other tier's country (a remote or
//      eligibility statement could open it);
//   3. exactly one tier is for that country.
// Otherwise there is no primary: the tiers are shown and the salary range
// stays Unknown, as before.

const countryOfLabel = (label: string): string | null => {
  const entry = Object.entries(geographyCountryNames).find(([, name]) => name === label);
  return entry ? entry[0] : null;
};
const countryOf = (code: string) => code.split("-")[0]!;
const countryAdjectives: Record<string, string> = {
  Canadian: "CA", British: "GB", Mexican: "MX", Australian: "AU", Irish: "IE", German: "DE", French: "FR",
  Dutch: "NL", Spanish: "ES", Indian: "IN", Brazilian: "BR",
};
const countryAdjective = new RegExp(`\\b(${Object.keys(countryAdjectives).join("|")})\\b`, "g");

export interface PrimaryTier {
  index: number;
  country: string;
  // The evidence that names the country (a residency statement or the
  // location), for provenance.
  evidence: string;
}

export function primaryCountryTier(input: {
  tiers: readonly CompensationTier[];
  tierStatements: readonly string[];
  residency: { requirement: string | null; regions: readonly string[]; statements?: ReadonlyArray<{ sentence: string }> };
  location: string | null;
  description: string | null;
}): PrimaryTier | null {
  if (input.tiers.length < 2) return null;
  const tierCountries = input.tiers.map((tier) => countryOfLabel(tier.label));
  if (tierCountries.some((code) => code === null)) return null;
  if (new Set(tierCountries).size !== tierCountries.length) return null;

  let country: string | null = null;
  let evidence: string | null = null;
  if (input.residency.requirement && input.residency.regions.length) {
    const countries = new Set(input.residency.regions.filter((region) => /^[A-Z]{2}(?:-|$)/.test(region)).map(countryOf));
    if (countries.size !== 1 || input.residency.regions.some((region) => !/^[A-Z]{2}(?:-|$)/.test(region))) return null;
    country = [...countries][0]!;
    evidence = input.residency.statements?.map((statement) => statement.sentence).join("\n") || input.residency.regions.join(", ");
  } else {
    const located = readLocationGeography(input.location);
    const countries = new Set(located.codes.map(countryOf));
    if (located.ambiguous || countries.size !== 1) return null;
    country = [...countries][0]!;
    // The rest of the posting must not open another tier's country.
    let rest = input.description ?? "";
    for (const statement of input.tierStatements) rest = rest.split(statement).join(" ");
    // A country named by its adjective counts too: "teams … across 27 U.S.
    // states, 2 Canadian Provinces, …" (Juniper Square, November 5, 2026)
    // opens Canada, so the U.S. location alone does not pick the U.S. tier.
    const named = new Set([...scanGeography(rest).codes.map(countryOf), ...[...rest.matchAll(countryAdjective)].map((match) => countryAdjectives[match[1]!]!)]);
    if (tierCountries.some((code) => code !== country && named.has(code!))) return null;
    evidence = input.location!;
  }
  const index = tierCountries.indexOf(country);
  if (index < 0 || tierCountries.lastIndexOf(country) !== index) return null;
  return { index, country, evidence };
}
