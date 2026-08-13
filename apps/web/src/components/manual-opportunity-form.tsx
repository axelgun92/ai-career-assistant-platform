"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

function optionalFormValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function ManualOpportunityForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
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
    };

    try {
      const response = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        opportunity?: { id: string };
      };

      if (!response.ok || !result.opportunity) {
        setError(result.error ?? "The opportunity could not be stored");
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
      <label>
        Raw opportunity or job-description text
        <textarea name="rawText" rows={14} required />
      </label>

      <div className="form-grid">
        <label>
          Title (optional)
          <input name="title" />
        </label>
        <label>
          Company (optional)
          <input name="company" />
        </label>
        <label>
          Location (optional)
          <input name="location" />
        </label>
        <label>
          Compensation text (optional)
          <input name="compensationText" />
        </label>
        <label>
          Posting date (optional)
          <input name="postingDate" type="date" />
        </label>
        <label>
          Domain slug (optional)
          <input name="domain" placeholder="customer-success" />
        </label>
        <label>
          Source URL (optional)
          <input name="sourceUrl" type="url" />
        </label>
        <label>
          Application URL (optional)
          <input name="applicationUrl" type="url" />
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save and normalize"}
      </button>
    </form>
  );
}
