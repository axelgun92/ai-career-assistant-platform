"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DuplicateCheckResult, DuplicateMatchSummary } from "@ai-career/core";
import { describeMatchedOn } from "./duplicate-labels";
import {
  fieldErrorsFromIssues,
  ManualOpportunityFields,
  type FieldErrors,
} from "./manual-opportunity-fields";

function optionalFormValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type Payload = Record<string, unknown>;

// Where to go after saving: an exact duplicate opens the opportunity that was
// already saved, with a notice that the capture was added to it.
export function capturedDestination(result: {
  opportunity: { id: string };
  deduplication?: { outcome: "CREATED" | "ATTACHED"; decision: string };
}) {
  const notice = result.deduplication?.outcome === "ATTACHED"
    ? "?capture=attached"
    : result.deduplication?.decision === "PROBABLE_MATCH"
      ? "?capture=probable"
      : "";
  return `/opportunities/${result.opportunity.id}${notice}`;
}

export function matchLabel(match: Pick<DuplicateMatchSummary, "title" | "companyName">) {
  return [match.title ?? "Untitled opportunity", match.companyName].filter(Boolean).join(" · ");
}

export function ManualOpportunityForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  // An exact duplicate found before saving, waiting for the user's choice.
  const [pendingMatch, setPendingMatch] = useState<{ payload: Payload; match: DuplicateMatchSummary } | null>(null);

  async function save(payload: Payload) {
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const response = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        issues?: unknown;
        opportunity?: { id: string };
        deduplication?: { outcome: "CREATED" | "ATTACHED"; decision: string };
      };

      if (!response.ok || !result.opportunity) {
        const { fieldErrors, formErrors } = fieldErrorsFromIssues(result.issues);
        setFieldErrors(fieldErrors);
        setError(
          [result.error ?? "The opportunity could not be stored", ...formErrors].join(" "),
        );
        return;
      }

      router.push(capturedDestination({ opportunity: result.opportunity, deduplication: result.deduplication }));
    } catch {
      setError("The application could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  // Read-only pre-check. When it cannot run, saving still decides
  // server-side (an exact duplicate is then added to the saved opportunity).
  async function exactMatchFor(payload: Payload): Promise<DuplicateMatchSummary | null> {
    try {
      const response = await fetch("/api/opportunities/duplicate-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return null;
      const result = (await response.json()) as DuplicateCheckResult;
      return result.decision === "MATCH"
        ? result.matches.find((match) => match.opportunityId === result.canonicalOpportunityId) ?? null
        : null;
    } catch {
      return null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingMatch(null);
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const payload: Payload = {
      rawText: formData.get("rawText"),
      title: optionalFormValue(formData, "title"),
      company: optionalFormValue(formData, "company"),
      location: optionalFormValue(formData, "location"),
      compensationText: optionalFormValue(formData, "compensationText"),
      postingDate: optionalFormValue(formData, "postingDate"),
      sourceUrl: optionalFormValue(formData, "sourceUrl"),
      applicationUrl: optionalFormValue(formData, "applicationUrl"),
      domain: optionalFormValue(formData, "domain"),
      sourceJobId: optionalFormValue(formData, "sourceJobId"),
      foundOn: optionalFormValue(formData, "foundOn"),
      workArrangement: optionalFormValue(formData, "workArrangement"),
      seniority: optionalFormValue(formData, "seniority"),
      employmentType: optionalFormValue(formData, "employmentType"),
      department: optionalFormValue(formData, "department"),
      closingDate: optionalFormValue(formData, "closingDate"),
      timeZoneRequirements: optionalFormValue(formData, "timeZoneRequirements"),
      compensationCurrency: optionalFormValue(formData, "compensationCurrency"),
      residencyRequirement: optionalFormValue(formData, "residencyRequirement"),
      residencyRegions: optionalFormValue(formData, "residencyRegions"),
    };

    const match = await exactMatchFor(payload);
    if (match) {
      setSubmitting(false);
      setPendingMatch({ payload, match });
      return;
    }
    await save(payload);
  }

  return (
    <form onSubmit={submit}>
      <ManualOpportunityFields fieldErrors={fieldErrors} />

      {pendingMatch ? (
        <section className="duplicate-match" role="alert" aria-labelledby="duplicate-match-title">
          <h2 id="duplicate-match-title">This listing is already saved</h2>
          <p>
            It matches <Link href={`/opportunities/${pendingMatch.match.opportunityId}`}>{matchLabel(pendingMatch.match)}</Link>{" "}
            ({describeMatchedOn(pendingMatch.match.matchedOn)}). Adding it as another source keeps everything you
            entered and avoids evaluating the same job twice.
          </p>
          <div className="duplicate-actions">
            <button type="button" disabled={submitting} onClick={() => save({ ...pendingMatch.payload, duplicateResolution: "ATTACH" })}>
              Add as another source
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={submitting}
              onClick={() => save({ ...pendingMatch.payload, duplicateResolution: "SEPARATE" })}
            >
              Save as a separate opportunity
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save opportunity"}
      </button>
    </form>
  );
}
