"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  compensationCurrencyCodes,
  confirmedFactFields,
  confirmedFactLabels,
  employmentTypeValues,
  seniorityValues,
  type ConfirmedFactField,
} from "@ai-career/core";
import { employmentTypeLabel, seniorityLabel, workArrangementLabel } from "../opportunity-facts";

// Add missing information (November 25, 2026): when triage holds a job for
// review because a hard-requirement fact is Unknown, the user enters what
// the job description states. Each confirmation is kept with its
// provenance, can be edited or undone, and triage runs again at once. The
// captured evidence itself is never changed.

export interface ConfirmedFactItem {
  fieldName: ConfirmedFactField;
  value: unknown;
  quotation: string | null;
  note: string | null;
  confirmedAt: string;
  capturedValue: unknown;
  conflict: { capturedNow: unknown } | null;
}

export interface ConfirmedFactHistoryItem {
  id: string;
  fieldName: string;
  action: "CONFIRMED" | "EDITED" | "UNDONE";
  value: unknown;
  createdAt: string;
}

type Draft = Record<string, string | boolean | string[]>;

const regionsOf = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);

// The structured value of a draft, per field.
function valueOf(field: ConfirmedFactField, draft: Draft): unknown {
  const text = (key: string) => String(draft[key] ?? "").trim();
  const number = (key: string) => (text(key) === "" ? null : Number(text(key).replace(/[,\s]/g, "")));
  switch (field) {
    case "salaryRange":
      return { minimum: number("minimum"), maximum: number("maximum") };
    case "currency":
    case "compensationBasis":
    case "seniority":
      return text("value");
    case "applicableTier":
      return { label: text("value") };
    case "residency":
      return { requirement: text("requirement"), regions: regionsOf(text("regions")) };
    case "workArrangements":
      return (draft.arrangements as string[] | undefined) ?? [];
    case "employmentType":
      return { type: text("value"), fullTimeSchedule: draft.fullTime === true };
    case "workAuthorization":
      return {
        requirement: text("requirement") || null,
        regions: regionsOf(text("regions")),
        visaSponsorship: text("sponsorship") || null,
      };
  }
}

// A draft from a stored value, to edit it.
function draftOf(field: ConfirmedFactField, value: unknown): Draft {
  const record = (value ?? {}) as Record<string, unknown>;
  switch (field) {
    case "salaryRange":
      return { minimum: record.minimum === null ? "" : String(record.minimum ?? ""), maximum: record.maximum === null ? "" : String(record.maximum ?? "") };
    case "currency":
    case "compensationBasis":
    case "seniority":
      return { value: String(value ?? "") };
    case "applicableTier":
      return { value: String(record.label ?? "") };
    case "residency":
      return { requirement: String(record.requirement ?? "US_REQUIRED"), regions: ((record.regions as string[]) ?? []).join(", ") };
    case "workArrangements":
      return { arrangements: Array.isArray(value) ? (value as string[]) : [] };
    case "employmentType":
      return { value: String(record.type ?? "FULL_TIME"), fullTime: record.fullTimeSchedule === true };
    case "workAuthorization":
      return { requirement: String(record.requirement ?? ""), regions: ((record.regions as string[]) ?? []).join(", "), sponsorship: String(record.visaSponsorship ?? "") };
  }
}

const initialDraft: Record<ConfirmedFactField, Draft> = {
  salaryRange: { minimum: "", maximum: "" },
  currency: { value: "USD" },
  compensationBasis: { value: "BASE" },
  applicableTier: { value: "" },
  residency: { requirement: "US_REQUIRED", regions: "" },
  workArrangements: { arrangements: [] },
  employmentType: { value: "FULL_TIME", fullTime: true },
  workAuthorization: { requirement: "", regions: "", sponsorship: "" },
  seniority: { value: "MID" },
};

export function describeConfirmedValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  const record = value as Record<string, unknown>;
  switch (field) {
    case "salaryRange": {
      const money = (amount: unknown) => (typeof amount === "number" ? amount.toLocaleString("en-US") : "?");
      return record.minimum !== null && record.maximum !== null ? `${money(record.minimum)}–${money(record.maximum)}` : record.minimum !== null ? `at least ${money(record.minimum)}` : `up to ${money(record.maximum)}`;
    }
    case "compensationBasis":
      return value === "OTE" ? "On-target earnings (base + variable)" : "Base salary";
    case "applicableTier":
      return String(record.label);
    case "residency":
      return record.requirement === "US_REQUIRED" ? "Must live in the United States" : `Eligible regions: ${((record.regions as string[]) ?? []).join(", ")}`;
    case "workArrangements":
      return (value as string[]).map((item) => workArrangementLabel(item)).join(" or ");
    case "employmentType":
      return `${employmentTypeLabel(String(record.type))}${record.fullTimeSchedule ? " (full-time schedule)" : ""}`;
    case "workAuthorization":
      return [
        record.requirement ? `${record.requirement === "CITIZENSHIP" ? "Citizenship" : "Right to work"} in ${((record.regions as string[]) ?? []).join(", ") || "the stated regions"}` : "No authorization requirement stated",
        record.visaSponsorship === "AVAILABLE" ? "sponsorship available" : record.visaSponsorship === "NOT_AVAILABLE" ? "no sponsorship" : null,
      ].filter(Boolean).join("; ");
    case "seniority":
      return seniorityLabel(String(value));
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

export function MissingInformation({
  opportunityId,
  facts,
  history,
  tierLabels,
  needsReview,
  suggestedFields,
}: {
  opportunityId: string;
  facts: ConfirmedFactItem[];
  history: ConfirmedFactHistoryItem[];
  tierLabels: string[];
  needsReview: boolean;
  // Fields triage reported Unknown, offered first.
  suggestedFields: ConfirmedFactField[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<ConfirmedFactField>(suggestedFields[0] ?? "salaryRange");
  const [draft, setDraft] = useState<Draft>(initialDraft[suggestedFields[0] ?? "salaryRange"]);
  const [quotation, setQuotation] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const fields = [...suggestedFields, ...confirmedFactFields.filter((item) => !suggestedFields.includes(item))].filter((item) => item !== "applicableTier" || tierLabels.length > 0);
  const working = busy || refreshing;

  function choose(next: ConfirmedFactField, existing?: ConfirmedFactItem) {
    setField(next);
    setDraft(existing ? draftOf(next, existing.value) : initialDraft[next]);
    setQuotation(existing?.quotation ?? "");
    setNote(existing?.note ?? "");
    setOpen(true);
  }

  async function send(method: "POST" | "DELETE", target: ConfirmedFactField) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        method === "POST" ? `/api/opportunities/${opportunityId}/confirmed-facts` : `/api/opportunities/${opportunityId}/confirmed-facts?field=${target}`,
        method === "POST"
          ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fieldName: target, value: valueOf(target, draft), quotation, note }) }
          : { method },
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string; triage?: { outcome: string } | null };
      if (!response.ok) {
        setMessage({ kind: "error", text: body.error ?? "The information could not be saved" });
        return;
      }
      const outcome = body.triage ? { EVALUATE: "Evaluate", NEEDS_REVIEW: "Needs Review", REJECT: "Rejected" }[body.triage.outcome] ?? body.triage.outcome : null;
      setMessage({
        kind: "success",
        text: `${method === "POST" ? "Saved" : "Undone"}: ${confirmedFactLabels[target]}.${outcome ? ` Triage now: ${outcome}.` : ""}`,
      });
      if (method === "POST") setOpen(false);
      startRefresh(() => router.refresh());
    } catch {
      setMessage({ kind: "error", text: "The application could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  const input = (key: string, label: string, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input value={String(draft[key] ?? "")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} disabled={working} {...props} />
    </label>
  );
  const select = (key: string, label: string, options: Array<[string, string]>) => (
    <label>
      {label}
      <select value={String(draft[key] ?? "")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} disabled={working}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );

  return (
    <section className="missing-information" aria-labelledby="missing-information-title">
      <h2 id="missing-information-title">Information you confirmed</h2>
      {needsReview && suggestedFields.length ? (
        <p role="note">
          Triage is holding this job for review because some information is Unknown. If the job description states it, add it here.
        </p>
      ) : null}
      <p className="field-help">
        Facts you add from the job description are used by triage and shown on this page, marked as confirmed by you. The captured
        listing is not changed, and a later capture never overwrites what you confirmed.
      </p>
      {facts.length ? (
        <ul className="confirmed-facts">
          {facts.map((fact) => (
            <li key={fact.fieldName} data-field={fact.fieldName}>
              <strong>{confirmedFactLabels[fact.fieldName]}:</strong> {describeConfirmedValue(fact.fieldName, fact.value)}
              <span className="field-help"> · confirmed by you {new Date(fact.confirmedAt).toLocaleDateString()}</span>
              {fact.quotation ? <blockquote>{fact.quotation}</blockquote> : null}
              {fact.note ? <p className="field-help">Note: {fact.note}</p> : null}
              {fact.conflict ? (
                <p className="field-error" role="note">
                  A later capture states {describeConfirmedValue(fact.fieldName, fact.conflict.capturedNow)}. Your confirmed value is still used; edit or undo it if the listing changed.
                </p>
              ) : null}
              <span className="duplicate-actions">
                <button type="button" className="secondary-button" disabled={working} onClick={() => choose(fact.fieldName, fact)}>Edit</button>
                <button type="button" className="secondary-button" disabled={working} onClick={() => void send("DELETE", fact.fieldName)}>Undo</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {!open ? (
        <button type="button" disabled={working} onClick={() => choose(field)}>
          Add missing information
        </button>
      ) : (
        <form
          className="missing-information-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send("POST", field);
          }}
        >
          <label>
            Information
            <select value={field} onChange={(event) => choose(event.target.value as ConfirmedFactField, facts.find((fact) => fact.fieldName === event.target.value))} disabled={working}>
              {fields.map((item) => (
                <option key={item} value={item}>
                  {confirmedFactLabels[item]}{suggestedFields.includes(item) ? " (triage needs this)" : ""}
                </option>
              ))}
            </select>
          </label>
          {field === "salaryRange" ? (
            <>
              {input("minimum", "Minimum (base, per year)", { inputMode: "numeric" })}
              {input("maximum", "Maximum (base, per year)", { inputMode: "numeric" })}
            </>
          ) : null}
          {field === "currency" ? select("value", "Currency", compensationCurrencyCodes.map((code) => [code, code])) : null}
          {field === "compensationBasis" ? select("value", "The stated pay is", [["BASE", "Base salary"], ["OTE", "On-target earnings (base + variable)"]]) : null}
          {field === "applicableTier" ? select("value", "The tier that applies to this job", [["", "Choose a tier"], ...tierLabels.map((label) => [label, label] as [string, string])]) : null}
          {field === "residency" ? (
            <>
              {select("requirement", "Where candidates must live", [["US_REQUIRED", "In the United States"], ["NON_US", "In the regions below"]])}
              {input("regions", "Regions (countries, states or regions, comma-separated)", { placeholder: "Germany, France, EU" })}
            </>
          ) : null}
          {field === "workArrangements" ? (
            <fieldset>
              <legend>Arrangements the job offers</legend>
              {(["REMOTE", "HYBRID", "ONSITE"] as const).map((item) => (
                <label key={item} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={((draft.arrangements as string[]) ?? []).includes(item)}
                    disabled={working}
                    onChange={(event) => {
                      const current = new Set((draft.arrangements as string[]) ?? []);
                      if (event.target.checked) current.add(item);
                      else current.delete(item);
                      setDraft({ ...draft, arrangements: [...current] });
                    }}
                  />
                  {workArrangementLabel(item)}
                </label>
              ))}
            </fieldset>
          ) : null}
          {field === "employmentType" ? (
            <>
              {select("value", "Employment type", employmentTypeValues.map((value) => [value, employmentTypeLabel(value)]))}
              <label className="checkbox-label">
                <input type="checkbox" checked={draft.fullTime === true} disabled={working} onChange={(event) => setDraft({ ...draft, fullTime: event.target.checked })} />
                The job states a full-time schedule
              </label>
            </>
          ) : null}
          {field === "workAuthorization" ? (
            <>
              {select("requirement", "Work authorization required", [["", "None stated"], ["RIGHT_TO_WORK", "Right to work"], ["CITIZENSHIP", "Citizenship"]])}
              {input("regions", "In (countries or regions, comma-separated)", { placeholder: "United States" })}
              {select("sponsorship", "Visa sponsorship", [["", "Not stated"], ["AVAILABLE", "Available"], ["NOT_AVAILABLE", "Not available"]])}
            </>
          ) : null}
          {field === "seniority" ? select("value", "Seniority", seniorityValues.map((value) => [value, seniorityLabel(value)])) : null}
          <label>
            Quotation from the job description (optional)
            <textarea value={quotation} onChange={(event) => setQuotation(event.target.value)} rows={2} maxLength={2000} disabled={working} />
          </label>
          <label>
            Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={working} />
          </label>
          <div className="evaluation-actions">
            <button type="submit" disabled={working}>{working ? "Saving…" : "Save and re-run triage"}</button>
            <button type="button" className="secondary-button" disabled={working} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {message ? <p className={message.kind === "success" ? "success-message" : "field-error"} role={message.kind === "success" ? "status" : "alert"}>{message.text}</p> : null}
      {history.length ? (
        <details className="confirmed-fact-history">
          <summary>History of confirmed information ({history.length})</summary>
          <ol>
            {history.map((event) => (
              <li key={event.id}>
                {new Date(event.createdAt).toLocaleString()}: {event.action === "UNDONE" ? "Undid" : event.action === "EDITED" ? "Edited" : "Confirmed"}{" "}
                {confirmedFactLabels[event.fieldName as ConfirmedFactField] ?? event.fieldName}
                {event.action !== "UNDONE" ? ` (${describeConfirmedValue(event.fieldName, event.value)})` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
