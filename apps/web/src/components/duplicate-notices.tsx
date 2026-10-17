"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { confidencePercent, describeConflicts, describeMatchedOn } from "./duplicate-labels";

export interface DuplicateRelationshipView {
  otherOpportunityId: string;
  otherTitle: string | null;
  otherCompanyName: string | null;
  decision: "MATCH" | "PROBABLE_MATCH";
  confidence: number | null;
  matchedOn: string[];
  conflicts: string[];
  resolution: "DISTINCT" | null;
}

function otherLabel(relationship: DuplicateRelationshipView) {
  return [relationship.otherTitle ?? "Untitled opportunity", relationship.otherCompanyName].filter(Boolean).join(" · ");
}

export function duplicateSentence(relationship: DuplicateRelationshipView): string {
  const conflicts = describeConflicts(relationship.conflicts);
  if (relationship.decision === "MATCH") {
    return `the same listing (${describeMatchedOn(relationship.matchedOn)}). A paid evaluation is not repeated for a duplicate listing.`;
  }
  const confidence = confidencePercent(relationship.confidence);
  return `a possible duplicate (${describeMatchedOn(relationship.matchedOn)}${confidence ? `, ${confidence} similar` : ""}${conflicts ? `; ${conflicts}` : ""}).`;
}

// Duplicate relationships of one opportunity, with the user's reversible
// "not the same job" decision. Nothing here merges opportunities.
export function DuplicateNotices({
  opportunityId,
  relationships,
  capture,
}: {
  opportunityId: string;
  relationships: DuplicateRelationshipView[];
  capture: "attached" | "probable" | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(otherOpportunityId: string, resolution: "DISTINCT" | null) {
    setPending(otherOpportunityId);
    setError(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherOpportunityId, resolution }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The decision could not be saved");
        return;
      }
      router.refresh();
    } catch {
      setError("The application could not reach the server");
    } finally {
      setPending(null);
    }
  }

  const open = relationships.filter((relationship) => relationship.resolution === null);
  const distinct = relationships.filter((relationship) => relationship.resolution === "DISTINCT");
  if (!capture && relationships.length === 0) return null;

  return (
    <section className="duplicate-notices" aria-labelledby="duplicate-notices-title">
      <h2 id="duplicate-notices-title">Duplicates</h2>
      {capture === "attached" ? (
        <p role="status">This listing was already saved. Your capture was added to it as another source.</p>
      ) : null}
      {open.length ? (
        <ul>
          {open.map((relationship) => (
            <li key={relationship.otherOpportunityId}>
              <Link href={`/opportunities/${relationship.otherOpportunityId}`}>{otherLabel(relationship)}</Link> is{" "}
              {duplicateSentence(relationship)}
              <span className="duplicate-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending !== null}
                  onClick={() => decide(relationship.otherOpportunityId, "DISTINCT")}
                >
                  Not the same job
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {distinct.length ? (
        <ul>
          {distinct.map((relationship) => (
            <li key={relationship.otherOpportunityId}>
              Marked as a different job from{" "}
              <Link href={`/opportunities/${relationship.otherOpportunityId}`}>{otherLabel(relationship)}</Link>.
              <span className="duplicate-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending !== null}
                  onClick={() => decide(relationship.otherOpportunityId, null)}
                >
                  Undo
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </section>
  );
}
