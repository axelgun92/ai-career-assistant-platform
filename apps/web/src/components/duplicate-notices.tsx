"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";
import { confidencePercent, describeConflicts, describeMatchedOn } from "./duplicate-labels";

export interface DuplicateRelationshipView {
  otherOpportunityId: string;
  otherTitle: string | null;
  otherCompanyName: string | null;
  decision: "MATCH" | "PROBABLE_MATCH";
  confidence: number | null;
  matchedOn: string[];
  conflicts: string[];
  // SAME_JOB (November 25, 2026): the user confirmed one vacancy; nothing
  // is merged.
  resolution: DuplicateResolutionValue;
}

export type DuplicateResolutionValue = "DISTINCT" | "SAME_JOB" | null;

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
//
// November 25, 2026 (the "entries disappear and reappear" report): every
// relationship keeps its place in one list, whatever its state, and its own
// saving state; the saved decision shows at once (from the server's reply,
// never guessed), and the links to related jobs wait while a decision is
// being saved, so the other page is never opened before the decision is
// stored.
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
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<Readonly<Record<string, DuplicateResolutionValue>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [refreshing, startRefresh] = useTransition();

  // A decision saved here wins until the page's own data catches up.
  const resolutionOf = (relationship: DuplicateRelationshipView) =>
    relationship.otherOpportunityId in saved ? saved[relationship.otherOpportunityId]! : relationship.resolution;

  async function decide(otherOpportunityId: string, resolution: DuplicateResolutionValue) {
    setPending((current) => new Set(current).add(otherOpportunityId));
    setErrors(({ [otherOpportunityId]: _cleared, ...rest }) => rest);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherOpportunityId, resolution }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; relationship?: { resolution?: DuplicateResolutionValue } };
      if (!response.ok) {
        setErrors((current) => ({ ...current, [otherOpportunityId]: body.error ?? "The decision could not be saved" }));
        return;
      }
      const stored = body.relationship && "resolution" in body.relationship ? body.relationship.resolution ?? null : resolution;
      setSaved((current) => ({ ...current, [otherOpportunityId]: stored }));
      startRefresh(() => router.refresh());
    } catch {
      setErrors((current) => ({ ...current, [otherOpportunityId]: "The application could not reach the server" }));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(otherOpportunityId);
        return next;
      });
    }
  }

  if (!capture && relationships.length === 0) return null;
  const saving = pending.size > 0 || refreshing;
  const unresolved = relationships.filter((relationship) => resolutionOf(relationship) === null).length;
  const different = relationships.length - unresolved;
  const holdWhileSaving = (event: MouseEvent<HTMLAnchorElement>) => {
    if (saving) event.preventDefault();
  };

  return (
    <section className="duplicate-notices" aria-labelledby="duplicate-notices-title">
      <h2 id="duplicate-notices-title">Duplicates</h2>
      {capture === "attached" ? (
        <p role="status">This listing was already saved. Your capture was added to it as another source.</p>
      ) : null}
      {relationships.length ? (
        <p className="duplicate-summary">
          {[
            unresolved ? `${unresolved} to review` : null,
            different ? `${different} decided` : null,
          ].filter(Boolean).join(" · ")}
          {" · "}
          <Link href={`/duplicates?group=${opportunityId}`} onClick={holdWhileSaving}>Compare this group side by side</Link>
        </p>
      ) : null}
      {relationships.length ? (
        <ul>
          {relationships.map((relationship) => {
            const id = relationship.otherOpportunityId;
            const resolution = resolutionOf(relationship);
            const busy = pending.has(id);
            const link = (
              <Link href={`/opportunities/${id}`} onClick={holdWhileSaving} aria-disabled={saving || undefined}>
                {otherLabel(relationship)}
              </Link>
            );
            return (
              <li key={id} data-resolution={resolution ?? "UNRESOLVED"}>
                {resolution === "DISTINCT" ? (
                  <>Marked as a different job from {link}.</>
                ) : resolution === "SAME_JOB" ? (
                  <>Confirmed as the same job as {link}. Both are kept; dismiss the one you do not need.</>
                ) : (
                  <>
                    {link} is {duplicateSentence(relationship)}
                  </>
                )}
                <span className="duplicate-actions">
                  {busy ? (
                    <button type="button" className="secondary-button" disabled aria-busy>
                      Saving…
                    </button>
                  ) : resolution === null ? (
                    <>
                      <button type="button" className="secondary-button" onClick={() => decide(id, "DISTINCT")}>
                        Not the same job
                      </button>
                      <button type="button" className="secondary-button" onClick={() => decide(id, "SAME_JOB")}>
                        Same job
                      </button>
                    </>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => decide(id, null)}>
                      Undo
                    </button>
                  )}
                </span>
                {errors[id] ? <p className="field-error" role="alert">{errors[id]}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
