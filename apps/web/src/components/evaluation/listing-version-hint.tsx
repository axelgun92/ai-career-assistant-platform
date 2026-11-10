export interface ListingVersionHintData {
  evaluatedAt: Date;
  evaluatedVersionSeenAt: Date | null;
  currentVersionSeenAt: Date | null;
  // D1: the evaluated version is the current one, but its saved facts were
  // corrected by the current reading rules after the evaluation.
  correctedAt?: Date;
  correctedFacts?: string[];
}

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "an earlier date");

// Informational: the latest evaluation evaluated an earlier version of the
// listing. Reevaluating stays the user's choice and adds a new evaluation;
// the earlier one is kept.
export function ListingVersionHint({ hint }: { hint: ListingVersionHintData | null }) {
  if (!hint) return null;
  if (hint.correctedAt) {
    return (
      <p className="unknown-callout listing-version-hint" role="note">
        The latest evaluation was made before the saved details were corrected on {date(hint.correctedAt)} by the current reading rules
        {hint.correctedFacts?.length ? ` (${hint.correctedFacts.join(", ")})` : ""}. The posting itself has not changed. Reevaluate to evaluate
        the corrected details; the earlier evaluation is kept.
      </p>
    );
  }
  return (
    <p className="unknown-callout listing-version-hint" role="note">
      The latest evaluation was made using the listing version first seen on {date(hint.evaluatedVersionSeenAt)}. The listing has
      changed since then (latest version seen on {date(hint.currentVersionSeenAt)}). Reevaluate to evaluate the current version;
      the earlier evaluation is kept.
    </p>
  );
}
