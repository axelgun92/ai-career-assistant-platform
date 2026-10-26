export interface ListingVersionHintData {
  evaluatedAt: Date;
  evaluatedVersionSeenAt: Date | null;
  currentVersionSeenAt: Date | null;
}

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "an earlier date");

// Informational: the latest evaluation evaluated an earlier version of the
// listing. Reevaluating stays the user's choice and adds a new evaluation;
// the earlier one is kept.
export function ListingVersionHint({ hint }: { hint: ListingVersionHintData | null }) {
  if (!hint) return null;
  return (
    <p className="unknown-callout listing-version-hint" role="note">
      The latest evaluation was made using the listing version first seen on {date(hint.evaluatedVersionSeenAt)}. The listing has
      changed since then (latest version seen on {date(hint.currentVersionSeenAt)}). Reevaluate to evaluate the current version;
      the earlier evaluation is kept.
    </p>
  );
}
