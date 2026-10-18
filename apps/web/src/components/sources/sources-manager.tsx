"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/components/budget/budget-format";
import { pluralize } from "@/components/budget/budget-format";
import { retrievalSummary, runStatusLabels, scheduleLabel, sourceHealthLabels, sourceHealthTone } from "./source-labels";
import type { AdapterView, RunView, SourceHealthView, SourceView } from "./types";

const defaultScheduleHours = 12;

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return payload?.error ?? "The change could not be saved.";
  } catch {
    return "The server could not be reached.";
  }
}

function adapterStatus(adapter: AdapterView): string | null {
  if (!adapter.verified) return "awaiting verification";
  if (adapter.missingEnvironment.length) return `needs ${adapter.missingEnvironment.join(" and ")}`;
  return null;
}

function RunCounts({ run }: { run: RunView }) {
  if (!run.counts) return null;
  const { fetched, keptByTerms, created, attached, changed, unchanged, probable, failed } = run.counts;
  return (
    <span>
      {fetched} fetched, {keptByTerms} matched the role terms: {created} new
      {probable ? ` (${probable} possible duplicate${probable === 1 ? "" : "s"})` : ""}, {attached} added to existing,{" "}
      {changed} changed, {unchanged} unchanged{failed ? `, ${failed} failed` : ""}
    </span>
  );
}

function RunLine({ run }: { run: RunView }) {
  return (
    <li>
      <strong>{runStatusLabels[run.status] ?? run.status}</strong> · {run.trigger === "MANUAL" ? "Run now" : "Scheduled"} ·{" "}
      {formatDateTime(run.finishedAt ?? run.startedAt ?? run.createdAt)}
      {run.counts ? (
        <>
          {" — "}
          <RunCounts run={run} />
        </>
      ) : null}
      {run.errorMessage ? <span className="field-help"> {run.errorMessage}</span> : null}
    </li>
  );
}

function nextRunReason(health: SourceHealthView): string {
  if (health.gate?.kind === "rate_limited") return " (the source rate limited retrieval)";
  if (health.gate?.kind === "provider_wait") return " (the source asked us to wait)";
  if (health.gate?.kind === "backoff") return ` (backing off after ${pluralize(health.streak, "source failure")})`;
  return "";
}

// Health lines for an enabled source: last attempt and success, next run
// and why, the latest failure, and freshness notes.
function SourceHealthLines({ source }: { source: SourceView }) {
  const { health } = source;
  const failureIsCurrent =
    health.lastFailure !== null && (health.lastSuccessAt === null || health.lastFailure.at > health.lastSuccessAt);
  const notes = [
    health.stale ? "No successful retrieval for more than two schedule intervals." : null,
    health.neverSucceeded ? "This source has not retrieved successfully yet." : null,
    health.emptyResult ? "The last successful retrieval returned no listings; the board may be empty." : null,
  ].filter((note): note is string => note !== null);
  return (
    <>
      <p className="source-meta">
        Last successful retrieval: {health.lastSuccessAt ? formatDateTime(health.lastSuccessAt) : "never"}
        {health.nextRunAt ? (
          <>
            {" · "}Next run: {health.nextRunDue ? "due now" : formatDateTime(health.nextRunAt)}
            {nextRunReason(health)}
          </>
        ) : null}
      </p>
      {failureIsCurrent && health.lastFailure ? (
        <p className="source-meta">
          Latest failure: {formatDateTime(health.lastFailure.at)} · {health.lastFailure.message ?? health.lastFailure.code}
        </p>
      ) : null}
      {notes.length ? (
        <ul className="source-health-notes field-help">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ConfigSummary({ source }: { source: SourceView }) {
  const entries = source.configFields
    .map((field) => [field.label, source.config[field.name]] as const)
    .filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([label, value]) => (
        <span key={label}>
          {" · "}
          {label}: <code>{String(value)}</code>
        </span>
      ))}
    </>
  );
}

function SourceCard({ source }: { source: SourceView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);

  async function act(label: string, url: string, method: string, body?: unknown, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const failure = await send(url, method, body);
    setBusy(false);
    if (failure) {
      setError(`${label}: ${failure}`);
      return;
    }
    if (done) setNotice(done);
    router.refresh();
  }

  const archived = Boolean(source.archivedAt);
  const headingId = `source-${source.id}`;
  const showHealth = source.enabled && !archived;
  const gate = source.health.gate;
  // A rate limit or a wait the source asked for cannot be overridden.
  const sourceGate = gate && gate.kind !== "backoff" ? gate : null;
  const backoff = gate?.kind === "backoff" ? gate : null;
  const tone = sourceHealthTone(source.health.status);
  return (
    <section className="source-card" aria-labelledby={headingId}>
      <div className="source-card-header">
        <h3 id={headingId}>{source.name}</h3>
        <span className="source-card-badges">
          <span className={`status-label${source.enabled ? "" : " status-label-muted"}`}>
            {archived ? "Archived" : source.enabled ? "Enabled" : "Disabled"}
          </span>
          {showHealth && sourceHealthLabels[source.health.status] ? (
            <span className={`status-label${tone ? ` status-label-health-${tone}` : ""}`} aria-label={`Health: ${sourceHealthLabels[source.health.status]}`}>
              {sourceHealthLabels[source.health.status]}
            </span>
          ) : null}
        </span>
      </div>
      <p className="source-meta">
        {source.adapterName} ({retrievalSummary(source.sourceCategory, source.retrievalType)})
        <ConfigSummary source={source} />
      </p>
      <p className="source-meta">
        Runs {scheduleLabel(source.scheduleMinutes)} when enabled · Last attempt:{" "}
        {source.lastRunAt ? formatDateTime(source.lastRunAt) : "never"}
      </p>
      {showHealth ? <SourceHealthLines source={source} /> : null}
      {source.enableBlockedReason && !archived ? <p className="field-help">Cannot be enabled: {source.enableBlockedReason}</p> : null}
      <div className="source-actions">
        {archived ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => act("Restore", `/api/sources/${source.id}/restore`, "POST")}>
            Restore
          </button>
        ) : (
          <>
            {source.enabled ? (
              <button type="button" className="secondary-button" disabled={busy} onClick={() => act("Disable", `/api/sources/${source.id}`, "PATCH", { enabled: false })}>
                Disable
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || Boolean(source.enableBlockedReason)}
                onClick={() => act("Enable", `/api/sources/${source.id}`, "PATCH", { enabled: true })}
              >
                Enable
              </button>
            )}
            {source.enabled && backoff && confirmOverride ? (
              <span className="confirm-inline">
                <span>
                  Retrieval is backing off after source failures until {formatDateTime(backoff.until)}. Running now sends one run
                  to the source anyway.
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setConfirmOverride(false);
                    await act("Run now", `/api/sources/${source.id}/runs`, "POST", { override: true }, "Run queued. The retrieval worker will pick it up.");
                  }}
                >
                  Run now anyway
                </button>
                <button type="button" className="link-button" onClick={() => setConfirmOverride(false)}>
                  Wait
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !source.enabled || Boolean(sourceGate)}
                onClick={() =>
                  backoff
                    ? setConfirmOverride(true)
                    : act("Run now", `/api/sources/${source.id}/runs`, "POST", undefined, "Run queued. The retrieval worker will pick it up.")
                }
              >
                Run now
              </button>
            )}
            {source.enabled && sourceGate ? (
              <span className="field-help" role="note">
                {sourceGate.kind === "rate_limited"
                  ? `Rate limited until ${formatDateTime(sourceGate.until)}`
                  : `Retry after ${formatDateTime(sourceGate.until)} (requested by the source)`}
              </span>
            ) : null}
            {confirmRemove ? (
              <span className="confirm-inline">
                <span>
                  {source.runs.length
                    ? "This source has run before, so it will be archived and its listings keep their provenance."
                    : "This source has never run and will be deleted."}
                </span>
                <button type="button" className="danger-button" disabled={busy} onClick={() => act("Remove", `/api/sources/${source.id}`, "DELETE")}>
                  Confirm remove
                </button>
                <button type="button" className="link-button" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="link-button" disabled={busy} onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            )}
          </>
        )}
      </div>
      {notice ? (
        <p className="success-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <details className="source-details">
        <summary>Run history ({source.runs.length})</summary>
        {source.runs.length ? (
          <ul className="provenance-list">
            {source.runs.map((run) => (
              <RunLine key={run.id} run={run} />
            ))}
          </ul>
        ) : (
          <p>No runs yet.</p>
        )}
      </details>
    </section>
  );
}

function AddSourceForm({ adapters }: { adapters: AdapterView[] }) {
  const router = useRouter();
  const [adapterKey, setAdapterKey] = useState(adapters[0]?.key ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [hours, setHours] = useState(String(defaultScheduleHours));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adapter = adapters.find((item) => item.key === adapterKey);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!adapter) return;
    const config = Object.fromEntries(
      adapter.configFields.map((field) => [field.name, values[field.name]?.trim() ?? ""]).filter(([, value]) => value !== ""),
    );
    const scheduleHours = Number(hours);
    if (!Number.isInteger(scheduleHours) || scheduleHours < 1 || scheduleHours > 168) {
      setError("The schedule must be a whole number of hours from 1 to 168.");
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await send("/api/sources", "POST", {
      adapterKey: adapter.key,
      ...(name.trim() ? { name: name.trim() } : {}),
      config,
      scheduleMinutes: scheduleHours * 60,
    });
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setValues({});
    setName("");
    router.refresh();
  }

  if (!adapters.length) return <p>No source types are available yet.</p>;
  return (
    <form className="source-form" onSubmit={submit} aria-labelledby="add-source-heading">
      <h2 id="add-source-heading">Add a source</h2>
      <div className="form-grid">
        <label>
          Source type
          <select
            value={adapterKey}
            onChange={(event) => {
              setAdapterKey(event.target.value);
              setValues({});
            }}
          >
            {adapters.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
                {adapterStatus(item) ? ` (${adapterStatus(item)})` : ""}
              </option>
            ))}
          </select>
        </label>
        {adapter?.configFields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.required ? "" : " (optional)"}
            <span className="field-help">{field.help}</span>
            <input
              required={field.required}
              value={values[field.name] ?? ""}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            />
          </label>
        ))}
        <label>
          Name (optional)
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={adapter?.name} />
        </label>
        <label>
          Run every (hours)
          <input type="number" min={1} max={168} step={1} value={hours} onChange={(event) => setHours(event.target.value)} />
        </label>
      </div>
      {adapter ? (
        <p className="field-help">
          {capitalize(retrievalSummary(adapter.sourceCategory, adapter.retrievalType))}.
          {adapterStatus(adapter) ? ` This source can be added but not enabled yet: ${adapterStatus(adapter)}.` : ""} New
          sources start disabled.
        </p>
      ) : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || !adapter}>
        Add source
      </button>
    </form>
  );
}

export function SourcesManager({ sources, adapters }: { sources: SourceView[]; adapters: AdapterView[] }) {
  const active = sources.filter((source) => !source.archivedAt);
  const archived = sources.filter((source) => source.archivedAt);
  return (
    <>
      <section className="source-list" aria-labelledby="your-sources-heading">
        <h2 id="your-sources-heading">Your sources ({active.length})</h2>
        {active.length ? active.map((source) => <SourceCard key={source.id} source={source} />) : <p>No sources yet.</p>}
      </section>
      <AddSourceForm adapters={adapters} />
      {archived.length ? (
        <details className="source-details">
          <summary>Archived sources ({archived.length})</summary>
          {archived.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </details>
      ) : null}
    </>
  );
}
