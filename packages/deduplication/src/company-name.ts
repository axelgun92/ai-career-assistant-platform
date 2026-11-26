// Deterministic company-name key shared by capture-time company reuse, the
// dashboard company grouping and duplicate detection. Only case, width,
// punctuation, "&" and one recognized trailing legal-entity suffix are
// ignored; business words are never removed.

// Recognized trailing legal-entity suffixes, as token sequences after
// punctuation is removed ("S.A." → "s a", "Pty. Ltd." → "pty ltd").
const legalEntitySuffixes: readonly (readonly string[])[] = [
  ["inc"],
  ["incorporated"],
  ["llc"],
  ["l", "l", "c"],
  ["ltd"],
  ["limited"],
  ["corp"],
  ["corporation"],
  ["gmbh"],
  ["plc"],
  ["llp"],
  ["lp"],
  ["ag"],
  ["sa"],
  ["s", "a"],
  ["bv"],
  ["b", "v"],
  ["nv"],
  ["n", "v"],
  ["pty", "ltd"],
  ["pvt", "ltd"],
  ["private", "limited"],
];

function tokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function endsWith(words: string[], suffix: readonly string[]): boolean {
  if (suffix.length >= words.length) return false;
  return suffix.every((word, index) => words[words.length - suffix.length + index] === word);
}

// Returns null when the name has no letters or digits.
export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = tokens(name);
  if (words.length === 0) return null;
  // Longest suffix first, so "pty ltd" wins over "ltd"; at most one is removed.
  const suffix = [...legalEntitySuffixes]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => endsWith(words, candidate));
  return (suffix ? words.slice(0, words.length - suffix.length) : words).join(" ");
}

// Lowercased, punctuation-free word tokens used for title/location/text
// similarity.
export function textTokens(value: string | null | undefined): string[] {
  return value ? tokens(value) : [];
}
