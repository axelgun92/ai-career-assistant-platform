// Title-term matching for discovery. A listing is kept when its title
// contains one of the domain's role-family terms as a whole phrase,
// ignoring case, punctuation and accents ("Sr. Customer-Success Manager"
// matches "Customer Success"; "Successful Customer Outreach" does not).
// Only the title is ever matched: a description mentioning a term never
// keeps an unrelated title.

function phraseKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function createTitleMatcher(terms: readonly string[]): (title: string | null) => boolean {
  const keys = [...new Set(terms.map(phraseKey).filter((key) => key.length > 0))];
  return (title) => {
    if (!title) return false;
    const padded = ` ${phraseKey(title)} `;
    return keys.some((key) => padded.includes(` ${key} `));
  };
}
