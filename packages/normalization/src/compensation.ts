import {
  compensationCurrencyCodes,
  dollarCurrencyCodes,
  type CompensationBasis,
  isUnitedStatesGeography,
  readLocationGeography,
  scanGeography,
  type CompensationCurrency,
} from "@ai-career/core";

// Deterministic compensation parsing. Only explicit statements become
// numbers or a currency; anything ambiguous stays null (Unknown). The
// original text is always preserved separately (salaryText, SourceRecord).

// Provenance marker for a currency derived from a bare "$" (not stated by
// the source): read as USD only when the posting's geography is clearly the
// United States, so it stays identifiable and can be revisited.
export const bareDollarCurrencySourceField = "compensationText:bare-dollar-as-usd";

// Where the posting is, for reading a bare "$". Geography is only ever used
// to decide that a bare "$" is US dollars; no other currency (CAD, AUD, ...)
// is ever inferred from a place.
export interface CompensationGeography {
  location?: string | null;
  // Eligible-residency regions already read for the posting.
  residencyRegions?: readonly string[];
}

export interface ParsedCompensation {
  minimum: number | null;
  maximum: number | null;
  // What the stated range is, when the text says: base salary, or on-target
  // earnings (base plus variable pay). The bounds are the stated numbers
  // either way; whether an OTE range counts as base salary is evaluator
  // policy, never a reason to drop them here.
  basis: CompensationBasis | null;
  currency: CompensationCurrency | null;
  // How the currency was determined, for provenance and docs.
  currencyBasis: "STATED_CODE_OR_SYMBOL" | "BARE_DOLLAR_AS_USD" | "SELECTED" | null;
  // Why the amounts are Unknown although the text has numbers, if so.
  amountsUnknownReason:
    | "NON_ANNUAL_PERIOD"
    | "AMBIGUOUS_AMOUNTS"
    | "INVERTED_RANGE"
    | null;
  // Why the currency is Unknown although one was indicated, if so.
  currencyUnknownReason: "CONFLICTING_CURRENCIES" | "AMBIGUOUS_SYMBOL" | "BARE_DOLLAR_WITHOUT_US_EVIDENCE" | null;
}

const codePattern = new RegExp(`(?<![A-Z])(${compensationCurrencyCodes.join("|")})(?![A-Z])`, "g");
const prefixedDollars: Array<[RegExp, CompensationCurrency]> = [
  [/\bUS\$/g, "USD"],
  [/\b(?:CA|C)\$/g, "CAD"],
  [/\b(?:AU|A)\$/g, "AUD"],
  [/\bNZ\$/g, "NZD"],
  [/\bS\$/g, "SGD"],
  [/\bMX\$/g, "MXN"],
];
const symbols: Array<[string, CompensationCurrency]> = [
  ["€", "EUR"],
  ["£", "GBP"],
  ["₹", "INR"],
];

// Hourly, daily, weekly or monthly pay. There is no pay-period column, so
// such amounts are never stored as salary numbers.
const nonAnnualPeriod =
  /\/\s*(?:hr|hour|h|day|d|wk|week|mo|month)\b|\bper\s+(?:hour|day|week|month)\b|\b(?:hourly|daily|weekly|monthly)\b|\ban?\s+(?:hour|day|week|month)\b/i;
// On-target earnings (base and variable pay) and base salary, as a statement
// names them. OTE wording takes precedence: a statement that calls its range
// OTE is never ordinary salary because it also mentions "base" ("OTE (base +
// commission)", "60/40 base to variable"). Base salary only without it.
const onTargetEarnings = /\bOTE\b|\bon[- ]target\b/i;
const baseSalary = /\bbase\b/i;

function resolveBasis(text: string): CompensationBasis | null {
  if (onTargetEarnings.test(text)) return "OTE";
  return baseSalary.test(text) ? "BASE" : null;
}

interface AmountToken {
  value: number;
  start: number;
  end: number;
}

// Numbers such as 72,000 / 72.000 / 72000 / 72k / 72.5K / 1.2M. Percentages
// and amounts below 1,000 (years, 401(k), hourly rates) are not salary
// amounts and are ignored.
// Comma-grouped amounts may carry cents ("90,000.00", as LinkedIn writes them).
const amountPattern =
  /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2}(?!\d))?|\d{1,3}(?:\.\d{3})+(?![\d,])|\d+(?:\.\d+)?)(?:\s*([kK]|[mM])(?![a-zA-Z]))?(?!\s*%)/g;

// Returns the tokens and the text their offsets refer to.
function amountTokens(source: string): { text: string; tokens: AmountToken[] } {
  // "72-88k" states thousands once for both ends.
  const text = source.replace(
    /(?<![\d.,])(\d{1,3}(?:\.\d+)?)(\s*(?:-|–|—|to)\s*[$€£₹]?\s*\d{1,3}(?:\.\d+)?\s*)([kK])(?![a-zA-Z])/g,
    "$1$3$2$3",
  );
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(amountPattern)) {
    const digits = match[1]!;
    const suffix = match[2]?.toLowerCase();
    const plain = /^\d{1,3}(?:[.,]\d{3})+$/.test(digits)
      ? digits.replace(/[.,]/g, "")
      : /^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(digits) ? digits.replace(/,/g, "") : digits;
    const value = Number(plain) * (suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1);
    if (!Number.isFinite(value) || value < 1_000) continue;
    tokens.push({ value: Math.round(value * 100) / 100, start: match.index!, end: match.index! + match[0].length });
    if (tokens.length > 3) break;
  }
  return { text, tokens };
}

// The salary-sized amounts a statement names, in order (for comparing a
// statement whose amounts are not one range with a stated range).
export function statedAmounts(text: string): number[] {
  return amountTokens(text).tokens.map((token) => token.value);
}

function currencyMarkers(text: string) {
  const explicit = new Set<CompensationCurrency>();
  let remainder = text;
  for (const [pattern, code] of prefixedDollars) {
    const replaced = remainder.replace(pattern, " ");
    if (replaced !== remainder) explicit.add(code);
    remainder = replaced;
  }
  for (const match of remainder.matchAll(codePattern)) explicit.add(match[1] as CompensationCurrency);
  for (const [symbol, code] of symbols) if (remainder.includes(symbol)) explicit.add(code);
  return {
    explicit,
    bareDollar: remainder.includes("$"),
    ambiguousSymbol: remainder.includes("¥"),
  };
}

// A bare "$" is US dollars only with clear U.S. evidence: the location, the
// eligible residency regions and the compensation statement name only U.S.
// geography (the country, a state, DC or Puerto Rico), nothing ambiguous and
// nothing else. A region abbreviation that could mean two places ("CA") is
// settled by the country the same location names ("Sunnyvale, CA, United
// States"); on its own ("Sunnyvale, CA") it stays ambiguous. Canada,
// Australia, a global or unclear location, or none at all leave the
// currency Unknown. An explicit currency always wins over this reading.
function unitedStatesEvidence(text: string, geography: CompensationGeography): boolean {
  const named = [scanGeography(text), readLocationGeography(geography.location)];
  if (named.some((reading) => reading.ambiguous)) return false;
  const codes = [...named.flatMap((reading) => reading.codes), ...(geography.residencyRegions ?? [])];
  return codes.length > 0 && codes.every(isUnitedStatesGeography);
}

function resolveCurrency(
  text: string,
  selected: CompensationCurrency | null,
  geography: CompensationGeography,
): Pick<ParsedCompensation, "currency" | "currencyBasis" | "currencyUnknownReason"> {
  const markers = currencyMarkers(text);
  const unknown = (reason: ParsedCompensation["currencyUnknownReason"]) => ({
    currency: null,
    currencyBasis: null,
    currencyUnknownReason: reason,
  });
  if (markers.explicit.size > 1) return unknown("CONFLICTING_CURRENCIES");
  const isDollar = (code: CompensationCurrency) => (dollarCurrencyCodes as readonly string[]).includes(code);
  if (markers.explicit.size === 1) {
    const [stated] = [...markers.explicit] as [CompensationCurrency];
    if (selected && selected !== stated) return unknown("CONFLICTING_CURRENCIES");
    if (markers.bareDollar && !isDollar(stated)) return unknown("CONFLICTING_CURRENCIES");
    return { currency: stated, currencyBasis: "STATED_CODE_OR_SYMBOL", currencyUnknownReason: null };
  }
  if (markers.bareDollar) {
    if (selected) {
      return isDollar(selected)
        ? { currency: selected, currencyBasis: "SELECTED", currencyUnknownReason: null }
        : unknown("CONFLICTING_CURRENCIES");
    }
    return unitedStatesEvidence(text, geography)
      ? { currency: "USD", currencyBasis: "BARE_DOLLAR_AS_USD", currencyUnknownReason: null }
      : unknown("BARE_DOLLAR_WITHOUT_US_EVIDENCE");
  }
  if (markers.ambiguousSymbol) return selected ? unknown("CONFLICTING_CURRENCIES") : unknown("AMBIGUOUS_SYMBOL");
  return selected
    ? { currency: selected, currencyBasis: "SELECTED", currencyUnknownReason: null }
    : { currency: null, currencyBasis: null, currencyUnknownReason: null };
}

const rangeSeparator = /^\s*(?:[A-Z]{3}|US\$|CA\$|C\$|AU\$|A\$|NZ\$|[$€£₹])?\s*(?:-|–|—|to|and)\s*(?:[A-Z]{3}|US\$|CA\$|C\$|AU\$|A\$|NZ\$|[$€£₹])?\s*$/i;
const upperBoundCue = /\b(?:up to|max(?:imum)?|no more than|not to exceed)\s*[^\d]{0,6}$|≤\s*[^\d]{0,4}$/i;
const lowerBoundCue = /\b(?:from|starting(?: at)?|at least|min(?:imum)?|no less than)\s*[^\d]{0,6}$|≥\s*[^\d]{0,4}$/i;
// "$100,000 or more", "$90k and up": an open upper end.
const openUpperEnd = /^\s*(?:[A-Z]{3}\s*)?(?:\+|or more\b|or above\b|and up\b|and above\b)/i;

function resolveAmounts(text: string): Pick<ParsedCompensation, "minimum" | "maximum" | "amountsUnknownReason"> {
  const none = (reason: ParsedCompensation["amountsUnknownReason"]) => ({ minimum: null, maximum: null, amountsUnknownReason: reason });
  const { text: expanded, tokens } = amountTokens(text);
  if (tokens.length === 0) return none(null);
  // Larger than any plausible salary (and the stored column).
  if (tokens.some((token) => token.value >= 1_000_000_000)) return none("AMBIGUOUS_AMOUNTS");
  if (nonAnnualPeriod.test(text)) return none("NON_ANNUAL_PERIOD");
  if (tokens.length === 1) {
    const [token] = tokens as [AmountToken];
    const before = expanded.slice(0, token.start);
    const after = expanded.slice(token.end);
    if (upperBoundCue.test(before)) return { minimum: null, maximum: token.value, amountsUnknownReason: null };
    if (lowerBoundCue.test(before) || openUpperEnd.test(after)) {
      return { minimum: token.value, maximum: null, amountsUnknownReason: null };
    }
    return { minimum: token.value, maximum: token.value, amountsUnknownReason: null };
  }
  if (tokens.length === 2) {
    const [first, second] = tokens as [AmountToken, AmountToken];
    // An annual unit written after the first amount ("$90,000/yr - $110,000/yr").
    const between = expanded.slice(first.end, second.start).replace(/^\s*(?:\/\s*(?:yr|year)|per\s+(?:year|annum)|a\s+year)\b/i, "");
    if (!rangeSeparator.test(between)) return none("AMBIGUOUS_AMOUNTS");
    if (first.value > second.value) return none("INVERTED_RANGE");
    return { minimum: first.value, maximum: second.value, amountsUnknownReason: null };
  }
  return none("AMBIGUOUS_AMOUNTS");
}

export function parseCompensation(
  text: string | null,
  selectedCurrency: CompensationCurrency | null = null,
  geography: CompensationGeography = {},
): ParsedCompensation {
  if (text === null || !text.trim()) {
    return {
      minimum: null,
      maximum: null,
      basis: null,
      currency: selectedCurrency,
      currencyBasis: selectedCurrency ? "SELECTED" : null,
      amountsUnknownReason: null,
      currencyUnknownReason: null,
    };
  }
  const amounts = resolveAmounts(text);
  const stated = amounts.minimum !== null || amounts.maximum !== null;
  return { ...amounts, basis: stated ? resolveBasis(text) : null, ...resolveCurrency(text, selectedCurrency, geography) };
}
