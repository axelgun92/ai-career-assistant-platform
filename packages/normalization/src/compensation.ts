import {
  compensationCurrencyCodes,
  dollarCurrencyCodes,
  type CompensationCurrency,
} from "@ai-career/core";

// Deterministic compensation parsing. Only explicit statements become
// numbers or a currency; anything ambiguous stays null (Unknown). The
// original text is always preserved separately (salaryText, SourceRecord).

// Provenance marker for a currency derived from a bare "$" (read as USD by
// product decision, not stated by the source), so it stays identifiable
// and can be revisited.
export const bareDollarCurrencySourceField = "compensationText:bare-dollar-as-usd";

export interface ParsedCompensation {
  minimum: number | null;
  maximum: number | null;
  currency: CompensationCurrency | null;
  // How the currency was determined, for provenance and docs.
  currencyBasis: "STATED_CODE_OR_SYMBOL" | "BARE_DOLLAR_AS_USD" | "SELECTED" | null;
  // Why the amounts are Unknown although the text has numbers, if so.
  amountsUnknownReason:
    | "NON_ANNUAL_PERIOD"
    | "TOTAL_COMPENSATION"
    | "AMBIGUOUS_AMOUNTS"
    | "INVERTED_RANGE"
    | null;
  // Why the currency is Unknown although one was indicated, if so.
  currencyUnknownReason: "CONFLICTING_CURRENCIES" | "AMBIGUOUS_SYMBOL" | null;
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
// On-target earnings mix base and variable pay.
const totalCompensation = /\bOTE\b|\bon[- ]target\b/i;

interface AmountToken {
  value: number;
  start: number;
  end: number;
}

// Numbers such as 72,000 / 72.000 / 72000 / 72k / 72.5K / 1.2M. Percentages
// and amounts below 1,000 (years, 401(k), hourly rates) are not salary
// amounts and are ignored.
const amountPattern =
  /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+(?![\d,])|\d+(?:\.\d+)?)(?:\s*([kK]|[mM])(?![a-zA-Z]))?(?!\s*%)/g;

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
    const plain = /^\d{1,3}(?:[.,]\d{3})+$/.test(digits) ? digits.replace(/[.,]/g, "") : digits;
    const value = Number(plain) * (suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1);
    if (!Number.isFinite(value) || value < 1_000) continue;
    tokens.push({ value: Math.round(value * 100) / 100, start: match.index!, end: match.index! + match[0].length });
    if (tokens.length > 3) break;
  }
  return { text, tokens };
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

function resolveCurrency(
  text: string,
  selected: CompensationCurrency | null,
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
    // Product decision: a bare "$" is read as US dollars.
    return { currency: "USD", currencyBasis: "BARE_DOLLAR_AS_USD", currencyUnknownReason: null };
  }
  if (markers.ambiguousSymbol) return selected ? unknown("CONFLICTING_CURRENCIES") : unknown("AMBIGUOUS_SYMBOL");
  return selected
    ? { currency: selected, currencyBasis: "SELECTED", currencyUnknownReason: null }
    : { currency: null, currencyBasis: null, currencyUnknownReason: null };
}

const rangeSeparator = /^\s*(?:[A-Z]{3}|US\$|CA\$|C\$|AU\$|A\$|NZ\$|[$€£₹])?\s*(?:-|–|—|to|and)\s*(?:[A-Z]{3}|US\$|CA\$|C\$|AU\$|A\$|NZ\$|[$€£₹])?\s*$/i;
const upperBoundCue = /\b(?:up to|max(?:imum)?|no more than|not to exceed)\s*[^\d]{0,6}$|≤\s*[^\d]{0,4}$/i;
const lowerBoundCue = /\b(?:from|starting(?: at)?|at least|min(?:imum)?|no less than)\s*[^\d]{0,6}$|≥\s*[^\d]{0,4}$/i;

function resolveAmounts(text: string): Pick<ParsedCompensation, "minimum" | "maximum" | "amountsUnknownReason"> {
  const none = (reason: ParsedCompensation["amountsUnknownReason"]) => ({ minimum: null, maximum: null, amountsUnknownReason: reason });
  const { text: expanded, tokens } = amountTokens(text);
  if (tokens.length === 0) return none(null);
  // Larger than any plausible salary (and the stored column).
  if (tokens.some((token) => token.value >= 1_000_000_000)) return none("AMBIGUOUS_AMOUNTS");
  if (nonAnnualPeriod.test(text)) return none("NON_ANNUAL_PERIOD");
  if (totalCompensation.test(text)) return none("TOTAL_COMPENSATION");
  if (tokens.length === 1) {
    const [token] = tokens as [AmountToken];
    const before = expanded.slice(0, token.start);
    const after = expanded.slice(token.end);
    if (upperBoundCue.test(before)) return { minimum: null, maximum: token.value, amountsUnknownReason: null };
    if (lowerBoundCue.test(before) || /^\s*\+/.test(after)) {
      return { minimum: token.value, maximum: null, amountsUnknownReason: null };
    }
    return { minimum: token.value, maximum: token.value, amountsUnknownReason: null };
  }
  if (tokens.length === 2) {
    const [first, second] = tokens as [AmountToken, AmountToken];
    if (!rangeSeparator.test(expanded.slice(first.end, second.start))) return none("AMBIGUOUS_AMOUNTS");
    if (first.value > second.value) return none("INVERTED_RANGE");
    return { minimum: first.value, maximum: second.value, amountsUnknownReason: null };
  }
  return none("AMBIGUOUS_AMOUNTS");
}

export function parseCompensation(
  text: string | null,
  selectedCurrency: CompensationCurrency | null = null,
): ParsedCompensation {
  if (text === null || !text.trim()) {
    return {
      minimum: null,
      maximum: null,
      currency: selectedCurrency,
      currencyBasis: selectedCurrency ? "SELECTED" : null,
      amountsUnknownReason: null,
      currencyUnknownReason: null,
    };
  }
  return { ...resolveAmounts(text), ...resolveCurrency(text, selectedCurrency) };
}
