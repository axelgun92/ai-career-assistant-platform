import { dollarCurrencyCodes, type CompensationBasis } from "./opportunity";

// What a stated pay range is, as its own statement says (Salary display
// contract, November 8, 2026, as clarified for the final pre-live
// corrections). One shared reading for the normalizers (a range that includes
// variable pay is never base salary) and for every place the Salary is shown,
// so a job reads the same in lists, on its page, in the evaluation summary and
// in the source-version check. It is read from the posting's own compensation
// statement (salaryText) and the stored compensation basis; the employer's
// wording itself stays in the source evidence and provenance.
//
// - OTE: the employer explicitly calls the range OTE or on-target earnings.
// - TARGET_TOTAL: the employer calls it target total cash (or target total
//   compensation): base plus target variable pay, in the employer's own
//   terms, never relabelled OTE.
// - BASE: guaranteed base salary, with nothing added.
// - BASE_PLUS_VARIABLE: the range is base salary, and the statement adds
//   named variable pay on top ("$70,000 base salary plus commission").
// - PLUS_VARIABLE: a range, not called base, with named variable pay added
//   ("$90,000–$110,000 plus annual bonus").
// - INCLUDES_VARIABLE: the range itself includes variable pay
//   ("$90,000–$120,000 including bonuses"). Never called OTE.
// - null: the statement says nothing about what the range is, or the range
//   is recorded as not base salary without wording that says how (no label:
//   nothing unsupported is claimed).
// Only components the statement names are shown; none is ever invented, and
// "does not include bonus" or "pay equity" adds nothing.
export type CompensationArrangementKind = "OTE" | "TARGET_TOTAL" | "BASE" | "BASE_PLUS_VARIABLE" | "PLUS_VARIABLE" | "INCLUDES_VARIABLE";
export type CompensationComponent = "bonus" | "commission" | "incentives" | "variable pay" | "equity";

export interface CompensationArrangement {
  kind: CompensationArrangementKind;
  // Named variable pay, in the order the statement names it (empty for OTE
  // and BASE).
  components: CompensationComponent[];
  // TARGET_TOTAL only: the employer's term ("Target total cash" or "Target
  // total compensation") and whether it names base pay as a part.
  term?: string;
  includesBase?: boolean;
}

// The employer's own explicit on-target wording: "OTE", "on-target
// earnings" (also "on target earnings").
const explicitOnTarget = /\bOTE\b|\bon[- ]target\b/i;
// Target total cash or compensation, in the employer's terms ("target total
// cash compensation", "total target cash", "target cash compensation",
// "total target compensation").
const targetTotal = /\btarget(?:ed)?\s+total\s+(cash|compensation|pay|earnings)\b|\btotal\s+target(?:ed)?\s+(cash|compensation|pay|earnings)\b|\btarget\s+(cash)\s+(?:compensation|pay)\b/i;
const basePart = /\bbase(?:\s+(?:pay|salary))?\b/i;

const componentWords: Array<[RegExp, CompensationComponent]> = [
  [/\bbonus(?:es)?\b/i, "bonus"],
  [/\bcommissions?\b/i, "commission"],
  [/\bincentives?\b/i, "incentives"],
  [/\bvariable(?:\s+(?:pay|compensation|component|incentives?))?\b/i, "variable pay"],
  // Never "pay equity" or "internal equity" (fair pay), which pay-transparency
  // text mentions.
  [/(?<!\b(?:pay|internal)\s)\b(?:equity|stock|RSUs?)\b/i, "equity"],
];

function componentsIn(text: string): CompensationComponent[] {
  const found = componentWords
    .map(([pattern, component]) => ({ component, index: text.search(pattern) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.component);
  return [...new Set(found)];
}

const variableWord = String.raw`(?:bonus(?:es)?|commissions?|incentives?|variable|(?<!\b(?:pay|internal)\s)equity|stock|RSUs?)`;
// "including bonuses", "inclusive of base salary and any bonus", "which
// includes commission": the range itself holds variable pay. A negation
// ("does not include bonus", "excluding commission") never does.
const includesClause = new RegExp(String.raw`\b(?:includ(?:es|ing|e)|inclusive\s+of)\b([^.;]*?\b${variableWord}\b[^.;]*)`, "i");
const negatedInclusion = /\b(?:not|n['’]t|never)\s+(?:be\s+)?includ|\bexclud(?:es|ing|e)\b|\bexclusive\s+of\b|\bdoes\s+not\s+include\b/i;
// Variable pay added to the range: "plus commission", "+ bonus", "with an
// annual bonus", "and equity", "eligible for a bonus", "in addition to … a
// bonus".
const addedClause = new RegExp(
  String.raw`(?:\b(?:plus|with|and|in\s+addition\s+to|on\s+top\s+of|eligible\s+for|eligibility\s+for)\b|\+)\s*(?:(?:a|an|the|any|our|annual|quarterly|monthly|performance(?:[- ]based)?|potential|uncapped|competitive|generous|target|discretionary|company|sales|additional|variable)\s+){0,3}${variableWord}\b`,
  "gi",
);

// Whether the statement says the range includes variable pay (and does not
// negate it).
export function rangeIncludesVariablePay(text: string | null | undefined): boolean {
  if (!text) return false;
  const match = includesClause.exec(text);
  if (!match) return false;
  const lead = text.slice(Math.max(0, match.index - 25), match.index + match[0].length);
  return !negatedInclusion.test(lead);
}

// Phrases that name variable pay only to rule it out.
const negatedVariable = /\b(?:does\s+not\s+include|do\s+not\s+include|not\s+including|excluding|exclusive\s+of|without|no)\b[^.;]*/gi;

// The variable pay a statement adds to the range: once it affirmatively adds
// some ("plus commission"), every component it names outside a negation
// ("$80,000 base salary, bonus and equity" → bonus, equity).
function addedComponents(text: string): CompensationComponent[] {
  const affirmative = text.replace(negatedVariable, " ");
  addedClause.lastIndex = 0;
  if (!addedClause.test(affirmative)) return [];
  addedClause.lastIndex = 0;
  return componentsIn(affirmative);
}

export function compensationArrangement(basis: CompensationBasis | string | null | undefined, statement: string | null | undefined): CompensationArrangement | null {
  const text = statement ?? "";
  if (explicitOnTarget.test(text)) return { kind: "OTE", components: [] };
  const target = targetTotal.exec(text);
  if (target) {
    // What the total is made of, as the statement says after naming it
    // ("… inclusive of both base pay and any target sales incentive").
    const parts = text.slice(target.index + target[0].length).replace(negatedVariable, " ");
    const kind = (target[1] ?? target[2] ?? target[3] ?? "").toLowerCase();
    return {
      kind: "TARGET_TOTAL",
      components: componentsIn(parts),
      term: kind === "cash" ? "Target total cash" : "Target total compensation",
      includesBase: basePart.test(parts),
    };
  }
  if (rangeIncludesVariablePay(text)) {
    const clause = includesClause.exec(text)!;
    return { kind: "INCLUDES_VARIABLE", components: componentsIn(clause[1] ?? clause[0]) };
  }
  // Recorded as not base salary (OTE basis internally) without wording here
  // that says how (e.g. statements that disagree about the range): nothing
  // unsupported is shown, neither OTE, nor variable pay, nor base salary
  // (final pre-live Salary correction, November 8, 2026).
  if (basis === "OTE") return null;
  const added = addedComponents(text);
  if (basis === "BASE") return added.length ? { kind: "BASE_PLUS_VARIABLE", components: added } : { kind: "BASE", components: [] };
  return added.length ? { kind: "PLUS_VARIABLE", components: added } : null;
}

const includedNames: Record<CompensationComponent, string> = {
  bonus: "bonuses",
  commission: "commission",
  incentives: "incentives",
  "variable pay": "variable pay",
  equity: "equity",
};
const joinWithAnd = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

// The arrangement in the Salary's standard wording, placed after the amounts:
// "(Base salary)", "(OTE)", "(Target total cash: base + incentives)",
// "base + commission", "+ bonus", "(Includes bonuses)".
export function compensationArrangementLabel(arrangement: CompensationArrangement | null): string | null {
  if (!arrangement) return null;
  switch (arrangement.kind) {
    case "OTE":
      return "(OTE)";
    case "TARGET_TOTAL": {
      const parts = [...(arrangement.includesBase ? ["base"] : []), ...arrangement.components];
      return parts.length ? `(${arrangement.term}: ${parts.join(" + ")})` : `(${arrangement.term})`;
    }
    case "BASE":
      return "(Base salary)";
    case "BASE_PLUS_VARIABLE":
      return `base + ${arrangement.components.join(" + ")}`;
    case "PLUS_VARIABLE":
      return `+ ${arrangement.components.join(" + ")}`;
    case "INCLUDES_VARIABLE":
      return arrangement.components.length ? `(Includes ${joinWithAnd(arrangement.components.map((component) => includedNames[component]))})` : "(Includes variable pay)";
  }
}

const currencySymbols: Record<string, string> = { EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };
// The sign written before an amount in this currency, if it has one ("$" for
// every dollar currency; the code after the amounts says which).
export function currencySign(currency: string | null | undefined): string {
  if (!currency) return "";
  return (dollarCurrencyCodes as readonly string[]).includes(currency) ? "$" : currencySymbols[currency] ?? "";
}
