import Link from "next/link";

export function ProfileVersionHint({
  hint,
}: {
  hint: { evaluatedVersion: number; currentVersion: number } | null;
}) {
  if (!hint) return null;
  return (
    <p className="unknown-callout profile-hint" role="note">
      This opportunity was last evaluated with profile version {hint.evaluatedVersion}; new evaluations use
      version {hint.currentVersion}. Reevaluate to apply your current preferences.{" "}
      <Link href="/profile">Profile &amp; preferences</Link>
    </p>
  );
}
