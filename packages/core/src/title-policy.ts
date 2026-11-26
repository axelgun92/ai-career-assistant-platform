// Universal job-title relevance policy for automatic acquisition (November
// 22, 2026). Every automatic source (configured sources, browser-extension
// results pages, the LinkedIn worker, Welcome to the Jungle tabs) decides
// from a listing's title alone, before any job page is read, whether the job
// is inside the user's target job titles. Deliberate user actions (Single
// Capture, the manual form, a card the user explicitly ticks) are never
// filtered.
//
// Title relevance only decides retrieval. Whether an accepted job actually
// suits the user stays with the job-description analysis, the hard filters,
// the triage and the evaluator.
//
// Deterministic matching rules:
//   1. A title and a pattern are normalized the same way: accents removed,
//      lower case, "&" read as "and", every other run of punctuation
//      (hyphens, slashes, commas, dots, brackets) a single space, then each
//      word's plural folded ("specialists" -> "specialist", "companies" ->
//      "company"; words ending in "ss", such as "success", are unchanged).
//   2. A pattern matches when its words appear in the title as a contiguous
//      run of whole words: "Customer Success" matches "Sr. Customer-Success
//      Manager, EMEA" but not "Successful Customer Outreach".
//   3. The most specific match decides: the longest matching accepted
//      pattern is compared with the longest matching excluded pattern (by
//      number of words). An excluded pattern wins only when it is at least as
//      long. So an exclusion never rejects "Customer Success Engineer"
//      merely because it mentions "Engineer", while "Customer Experience
//      Designer" (excluded) beats "Customer Experience" (accepted).
//   4. A missing or empty title is never accepted (MISSING_TITLE).
//   5. Seniority is never filtered.

export type TitlePolicyVerdict = "ACCEPTED" | "OUTSIDE" | "EXCLUDED" | "MISSING_TITLE";

export interface TitlePolicyPatterns {
  readonly accepted: readonly string[];
  readonly excluded: readonly string[];
}

export interface TitlePolicyDecision {
  readonly verdict: TitlePolicyVerdict;
  // The accepted pattern that matched (ACCEPTED), or the excluded pattern
  // that won (EXCLUDED), as the user wrote it.
  readonly pattern?: string;
}

export type TitlePolicy = (title: string | null | undefined) => TitlePolicyDecision;

export const titlePolicyPatternMaxLength = 80;
export const titlePolicyMaxPatterns = 200;

function foldWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// The normalized word list of a title or pattern.
export function titlePolicyWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0)
    .map(foldWord);
}

interface CompiledPattern {
  readonly text: string;
  readonly key: string;
  readonly words: number;
}

function compile(patterns: readonly string[]): CompiledPattern[] {
  const seen = new Set<string>();
  const compiled: CompiledPattern[] = [];
  for (const text of patterns) {
    const words = titlePolicyWords(text);
    if (words.length === 0) continue;
    const key = words.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    compiled.push({ text: text.trim(), key, words: words.length });
  }
  // Longest first, so the first match is the most specific one.
  return compiled.sort((left, right) => right.words - left.words);
}

function longestMatch(padded: string, patterns: readonly CompiledPattern[]): CompiledPattern | undefined {
  return patterns.find((pattern) => padded.includes(` ${pattern.key} `));
}

export function createTitlePolicy(patterns: TitlePolicyPatterns): TitlePolicy {
  const accepted = compile(patterns.accepted);
  const excluded = compile(patterns.excluded);
  return (title) => {
    const words = typeof title === "string" ? titlePolicyWords(title) : [];
    if (words.length === 0) return { verdict: "MISSING_TITLE" };
    const padded = ` ${words.join(" ")} `;
    const acceptedMatch = longestMatch(padded, accepted);
    const excludedMatch = longestMatch(padded, excluded);
    if (excludedMatch && (!acceptedMatch || excludedMatch.words >= acceptedMatch.words)) {
      return acceptedMatch ? { verdict: "EXCLUDED", pattern: excludedMatch.text } : { verdict: "OUTSIDE" };
    }
    if (acceptedMatch) return { verdict: "ACCEPTED", pattern: acceptedMatch.text };
    return { verdict: "OUTSIDE" };
  };
}

export function titlePolicyAccepts(decision: TitlePolicyDecision): boolean {
  return decision.verdict === "ACCEPTED";
}

// A keep-title predicate for code that only needs yes or no.
export function titlePolicyMatcher(policy: TitlePolicy): (title: string | null) => boolean {
  return (title) => titlePolicyAccepts(policy(title));
}

// Cleans a user-edited pattern list: trimmed, empty and duplicate patterns
// (by normalized words) removed, order kept.
export function cleanTitlePolicyPatterns(patterns: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of patterns) {
    const text = raw.replace(/\s+/g, " ").trim();
    const key = titlePolicyWords(text).join(" ");
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
  }
  return cleaned;
}
