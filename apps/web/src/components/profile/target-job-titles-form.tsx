"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTitlePolicy, type TitlePolicyDecision } from "@ai-career/core";

// Target job titles for automatic capture (November 22, 2026). Every
// automatic source (configured sources, results-page capture from the
// browser extension) reads only a listing's title against these patterns
// before any job page is read; titles outside them are skipped and never
// saved. Jobs you capture yourself are always kept. Title relevance only
// decides retrieval: whether a job actually suits you is still decided by
// the job description, the hard filters, the triage and the evaluation.

export interface TargetJobTitlesInitial {
  accepted: readonly string[];
  excluded: readonly string[];
  isDefault: boolean;
  defaults: { accepted: readonly string[]; excluded: readonly string[] };
}

export function titleVerdictText(decision: TitlePolicyDecision): string {
  switch (decision.verdict) {
    case "ACCEPTED":
      return `Accepted: matches “${decision.pattern}”.`;
    case "EXCLUDED":
      return `Skipped: the excluded pattern “${decision.pattern}” is at least as specific as the accepted pattern it competes with.`;
    case "MISSING_TITLE":
      return "Enter a title to test.";
    default:
      return "Skipped: no accepted pattern appears in this title.";
  }
}

function PatternList({
  id,
  label,
  description,
  patterns,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  patterns: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.replace(/\s+/g, " ").trim();
    if (!value) return;
    if (!patterns.some((pattern) => pattern.toLowerCase() === value.toLowerCase())) onChange([...patterns, value]);
    setDraft("");
  };
  return (
    <fieldset className="title-pattern-list">
      <legend>{label}</legend>
      <p className="field-note">{description}</p>
      {patterns.length ? (
        <ul aria-label={label}>
          {patterns.map((pattern) => (
            <li key={pattern}>
              <span>{pattern}</span>
              <button type="button" aria-label={`Remove “${pattern}”`} onClick={() => onChange(patterns.filter((item) => item !== pattern))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">None.</p>
      )}
      <div className="title-pattern-add">
        <label htmlFor={`${id}-add`}>Add a pattern</label>
        <input
          id={`${id}-add`}
          value={draft}
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
    </fieldset>
  );
}

export function TargetJobTitlesForm({ initial }: { initial: TargetJobTitlesInitial }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState<string[]>([...initial.accepted]);
  const [excluded, setExcluded] = useState<string[]>([...initial.excluded]);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [sample, setSample] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const policy = useMemo(() => createTitlePolicy({ accepted, excluded }), [accepted, excluded]);
  const decision = policy(sample);

  async function send(method: "PUT" | "DELETE") {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/title-policy", {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify({ accepted, excluded }) } : {}),
      });
      const body = (await response.json()) as { accepted?: string[]; excluded?: string[]; isDefault?: boolean; error?: string };
      if (!response.ok) {
        setMessage({ kind: "error", text: body.error ?? "Target job titles could not be saved." });
        return;
      }
      setAccepted(body.accepted ?? []);
      setExcluded(body.excluded ?? []);
      setIsDefault(Boolean(body.isDefault));
      setMessage({
        kind: "success",
        text: method === "PUT" ? "Saved. The next automatic capture uses these titles." : "Reset to the default target job titles.",
      });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Target job titles could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="target-job-titles" aria-labelledby="target-job-titles-title">
      <h2 id="target-job-titles-title">Target job titles (automatic capture)</h2>
      <p>
        Automatic capture (your configured sources and results-page capture in the browser extension) reads only each listing&apos;s
        title against these patterns before opening any job page. Titles outside them are skipped and never saved. Jobs you capture
        or add yourself are always kept. Whether a job actually suits you is still decided by its description, your hard filters, the
        triage and the evaluation.
      </p>
      <p className="field-note">
        A pattern matches whole words in order, ignoring case, punctuation and plurals (“Customer Success” matches “Sr.
        Customer-Success Manager”). Seniority is never filtered. An excluded pattern only wins when it is at least as specific as the
        accepted pattern it competes with, so “Employee Onboarding” skips “Employee Onboarding Specialist” but an exclusion never
        rejects a title merely for one shared word. Changes apply to future automatic captures; saved jobs are not changed.
        {isDefault ? " You are using the default target job titles." : ""}
      </p>
      <PatternList
        id="title-accepted"
        label="Accepted title patterns"
        description="A title containing one of these is captured automatically."
        patterns={accepted}
        onChange={setAccepted}
      />
      <PatternList
        id="title-excluded"
        label="Excluded title patterns"
        description="Clearly unrelated titles that would otherwise match an accepted pattern."
        patterns={excluded}
        onChange={setExcluded}
      />
      <div className="title-test">
        <label htmlFor="title-test-input">Test a title</label>
        <input id="title-test-input" value={sample} onChange={(event) => setSample(event.target.value)} placeholder="Customer Education Specialist" />
        <p role="status" className={decision.verdict === "ACCEPTED" ? "success-message" : "field-note"}>
          {titleVerdictText(decision)}
        </p>
      </div>
      <div className="title-policy-actions">
        <button type="button" disabled={saving} onClick={() => void send("PUT")}>
          {saving ? "Saving…" : "Save target job titles"}
        </button>
        <button type="button" disabled={saving} onClick={() => void send("DELETE")}>
          Reset to defaults
        </button>
      </div>
      {message ? (
        <p className={message.kind === "success" ? "success-message" : "error-message"} role={message.kind === "success" ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
