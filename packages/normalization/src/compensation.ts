import { compensationCurrencyCodes, type CompensationBasis, type CompensationCurrency } from "@ai-career/core";

// Deterministic compensation parsing. Only explicit statements become
// numbers or a currency; anything ambiguous stays null (Unknown). The
// original text is always preserved separately (salaryText, SourceRecord).

// Provenance marker for a currency read from a bare "$" (USD), kept
// distinct from a stated currency code so it stays identifiable.
export const bareDollarCurrencySourceField = "compensationText:bare-dollar-as-usd";

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
  currencyUnknownReason: "CONFLICTING_CURRENCIES" | null;
}

const codePattern = new RegExp(`(?<![A-Z])(${compensationCurrencyCodes.join("|")})(?![A-Z])`, "g");
const prefixedDollars: Array<[RegExp, CompensationCurrency]> = [
  [/\bUS\$/g, "USD"],
  [/\b(?:CA|C)\$/g, "CAD"],
  [/\b(?:AU|A)\$/g, "AUD"],
  [/\bNZ\$/g, "NZD"],
  [/\bS\$/g, "SGD"],
  [/\bMX\$/g, "MXN"],
  [/\bR\$/g, "BRL"],
];
// Currencies named in words ("Canadian dollars", "euros"): as explicit as a
// code.
const currencyNames: Array<[RegExp, CompensationCurrency]> = [
  [/\b(?:U\.?S\.?|American)\s+dollars?\b/gi, "USD"],
  [/\bCanadian\s+dollars?\b/gi, "CAD"],
  [/\bAustralian\s+dollars?\b/gi, "AUD"],
  [/\bNew\s+Zealand\s+dollars?\b/gi, "NZD"],
  [/\bSingapore(?:an)?\s+dollars?\b/gi, "SGD"],
  [/\beuros?\b/gi, "EUR"],
  [/\b(?:British\s+)?pounds?\s+sterling\b|\bBritish\s+pounds?\b/gi, "GBP"],
  [/\bSwiss\s+francs?\b/gi, "CHF"],
  [/\bSwedish\s+kron(?:a|or)\b/gi, "SEK"],
  [/\bNorwegian\s+kron(?:e|er)\b/gi, "NOK"],
  [/\bDanish\s+kron(?:e|er)\b/gi, "DKK"],
  [/\b(?:Polish\s+)?zlot(?:y|ys|ych)\b/gi, "PLN"],
  [/\b(?:Indian\s+)?rupees?\b/gi, "INR"],
  [/\bJapanese\s+yen\b/gi, "JPY"],
  [/\bMexican\s+pesos?\b/gi, "MXN"],
  [/\bBrazilian\s+rea(?:l|is)\b/gi, "BRL"],
  [/\bSouth\s+African\s+rand\b/gi, "ZAR"],
];
// Currency symbols, each read as its currency: "$" is US dollars, "€"
// euros, "£" pounds sterling, "₹" rupees, "¥" yen. A currency the text
// states as a code or name ("$100,000 CAD") takes precedence over a symbol.
const symbols: Array<[string, CompensationCurrency]> = [
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₹", "INR"],
  ["¥", "JPY"],
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
  for (const [pattern, code] of [...prefixedDollars, ...currencyNames]) {
    const replaced = remainder.replace(pattern, " ");
    if (replaced !== remainder) explicit.add(code);
    remainder = replaced;
  }
  for (const match of remainder.matchAll(codePattern)) explicit.add(match[1] as CompensationCurrency);
  const symbolic = new Set<CompensationCurrency>();
  for (const [symbol, code] of symbols) if (remainder.includes(symbol)) symbolic.add(code);
  return { explicit, symbolic };
}

// The currency: a code or name the text states (or the one the user
// selected) first, then the currency symbol it uses. Two different stated
// currencies, or two different symbols with nothing stated, conflict and
// leave it Unknown. No place or other context is needed to read a symbol.
function resolveCurrency(
  text: string,
  selected: CompensationCurrency | null,
): Pick<ParsedCompensation, "currency" | "currencyBasis" | "currencyUnknownReason"> {
  const { explicit, symbolic } = currencyMarkers(text);
  const unknown = () => ({ currency: null, currencyBasis: null, currencyUnknownReason: "CONFLICTING_CURRENCIES" as const });
  if (explicit.size > 1) return unknown();
  if (explicit.size === 1) {
    const [stated] = [...explicit] as [CompensationCurrency];
    if (selected && selected !== stated) return unknown();
    return { currency: stated, currencyBasis: "STATED_CODE_OR_SYMBOL", currencyUnknownReason: null };
  }
  if (selected) return { currency: selected, currencyBasis: "SELECTED", currencyUnknownReason: null };
  if (symbolic.size > 1) return unknown();
  if (symbolic.size === 1) {
    const [currency] = [...symbolic] as [CompensationCurrency];
    return { currency, currencyBasis: currency === "USD" ? "BARE_DOLLAR_AS_USD" : "STATED_CODE_OR_SYMBOL", currencyUnknownReason: null };
  }
  return { currency: null, currencyBasis: null, currencyUnknownReason: null };
}

const rangeSeparator = /^\s*(?:[A-Z]{3}|US\$|CA\$|C\$|AU\$|A\$|NZ\$|[$€£₹])?\s*(?:-|–|—|to|and)\s*(?:[A-Z]{3}|US\$|CA\$|C\$|AU\$|A\$|NZ\$|[$€£₹])?\s*$/i;
const upperBoundCue = /\b(?:up to|max(?:imum)?|no more than|not to exceed)\s*[^\d]{0,6}$|≤\s*[^\d]{0,4}$/i;
const lowerBoundCue = /\b(?:from|starting(?: at)?|at least|min(?:imum)?|no less than)\s*[^\d]{0,6}$|≥\s*[^\d]{0,4}$/i;
// "$100,000 or more", "$90k and up": an open upper end.
const openUpperEnd = /^\s*(?:[A-Z]{3}\s*)?(?:\+|or more\b|or above\b|and up\b|and above\b)/i;

// An annual equivalent the statement itself gives for non-annual pay
// ("Hourly Base Wage: $40.87–$45.67 ($85,000–$95,000 / annualized)").
const annualEquivalent = /\bannuali[sz]ed\b|\bannual(?:ly)?\b|\byearly\b|\bper\s+(?:year|annum)\b|\ba\s+year\b|\/\s*(?:yr|year)\b/i;

// The one part of a statement that states pay as annual when the rest
// states it per hour, day, week or month: a parenthetical or a clause
// (between commas, semicolons or "or") with an annual unit and no other.
function annualPart(text: string): string | null {
  const parts = text
    .split(/[()]/)
    .flatMap((part) => part.split(/;|,(?!\d{3})|\s+or\s+/i))
    .map((part) => part.trim())
    .filter((part) => annualEquivalent.test(part) && !nonAnnualPeriod.test(part) && amountTokens(part).tokens.length > 0);
  return parts.length === 1 ? parts[0]! : null;
}

function resolveAmounts(text: string): Pick<ParsedCompensation, "minimum" | "maximum" | "amountsUnknownReason"> {
  const none = (reason: ParsedCompensation["amountsUnknownReason"]) => ({ minimum: null, maximum: null, amountsUnknownReason: reason });
  const { text: expanded, tokens } = amountTokens(text);
  if (tokens.length === 0) return none(null);
  // Larger than any plausible salary (and the stored column).
  if (tokens.some((token) => token.value >= 1_000_000_000)) return none("AMBIGUOUS_AMOUNTS");
  if (nonAnnualPeriod.test(text)) {
    // Non-annual pay with its explicit annual equivalent: the annual amounts.
    const annual = annualPart(text);
    return annual ? resolveAmounts(annual) : none("NON_ANNUAL_PERIOD");
  }
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

export function parseCompensation(text: string | null, selectedCurrency: CompensationCurrency | null = null): ParsedCompensation {
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
  return { ...amounts, basis: stated ? resolveBasis(text) : null, ...resolveCurrency(text, selectedCurrency) };
}
