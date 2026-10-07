"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  fieldErrorsFromIssues,
  ManualOpportunityFields,
  type FieldErrors,
} from "./manual-opportunity-fields";

function optionalFormValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function ManualOpportunityForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const payload = {
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
    };

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
      };

      if (!response.ok || !result.opportunity) {
        const { fieldErrors, formErrors } = fieldErrorsFromIssues(result.issues);
        setFieldErrors(fieldErrors);
        setError(
          [result.error ?? "The opportunity could not be stored", ...formErrors].join(" "),
        );
        return;
      }

      router.push(`/opportunities/${result.opportunity.id}`);
    } catch {
      setError("The application could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ManualOpportunityFields fieldErrors={fieldErrors} />

      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save opportunity"}
      </button>
    </form>
  );
}
