"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confidencePercent, describeConflicts, describeMatchedOn } from "../duplicate-labels";

// One group of possible duplicates (November 25, 2026). Every listing is
// controlled on its own: Keep keeps or restores only that listing in Active,
// Dismiss moves only that listing to Dismissed (restorable), and neither
// records any duplicate decision; "Same job" and "Not the same job" are
// separate, explicit decisions per pair. Every listing stays in its group,
// dismissed ones included. Everything goes through the existing guarded
// endpoints (Move to, the per-pair decision, deletion from Dismissed after
// a confirmation). Nothing is merged; "Review later" writes nothing.

export interface DuplicateGroupMemberView {
  id: string;
  title: string;
  companyName: string | null;
  location: string | null;
  salary: string | null;
  arrangement: string | null;
  sourceWebsite: string | null;
  listingUrl: string | null;
  applicationUrl: string | null;
  listingId: string | null;
  requisitionId: string | null;
  status: string;
  statusLabel: string;
  triageLabel: string | null;
  hasApplication: boolean;
  firstSeen: string;
  description: { similarity: number | null; onlyHere: string[]; onlyHereCount: number };
}

export interface DuplicateGroupPairView {
  opportunityId: string;
  relatedOpportunityId: string;
  decision: "MATCH" | "PROBABLE_MATCH";
  confidence: number | null;
  matchedOn: string[];
  conflicts: string[];
  state: "UNRESOLVED" | "DISTINCT" | "SAME_JOB";
}

// The field keys differingFields() reports, in words.
const fieldNames: Record<string, string> = {
  title: "title", company: "company", location: "location", salary: "salary", arrangement: "work arrangement", source: "source website",
};

const activeStatuses = new Set(["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"]);

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; reason?: string; results?: Array<{ result: string; reason?: string }> };
    if (!response.ok) return payload.reason ?? payload.error ?? "The change could not be saved";
    const refused = payload.results?.find((result) => result.result !== "DELETED");
    return refused ? (refused.reason ?? "The change could not be saved") : null;
  } catch {
    return "The application could not reach the server";
  }
}

export function DuplicateGroupCard({
  label,
  members,
  pairs,
  differing,
}: {
  label: string;
  members: DuplicateGroupMemberView[];
  pairs: DuplicateGroupPairView[];
  differing: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [messages, setMessages] = useState<string[]>([]);
  const [later, setLater] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const byId = new Map(members.map((member) => [member.id, member]));
  // Listings are numbered in the order they were first seen, so listings
  // with the same title stay distinguishable.
  const number = new Map(members.map((member, index) => [member.id, index + 1]));
  const short = (id: string) => (number.has(id) ? `Listing ${number.get(id)}` : "Another listing");
  const name = (id: string) => {
    const member = byId.get(id);
    return member ? `${short(id)} (${[member.title, member.companyName].filter(Boolean).join(" · ")})` : "Another listing";
  };
  const unresolved = pairs.filter((pair) => pair.state === "UNRESOLVED").length;
  const working = busy || refreshing;

  async function run(steps: Array<() => Promise<string | null>>, done: string) {
    setBusy(true);
    setMessages([]);
    const problems: string[] = [];
    for (const step of steps) {
      const problem = await step();
      if (problem) problems.push(problem);
    }
    setBusy(false);
    setConfirmDelete(null);
    setMessages(problems.length ? problems : [done]);
    startRefresh(() => router.refresh());
  }

  const decide = (pair: DuplicateGroupPairView, resolution: "DISTINCT" | "SAME_JOB" | null) => () =>
    post(`/api/opportunities/${pair.opportunityId}/duplicates`, { otherOpportunityId: pair.relatedOpportunityId, resolution });
  const move = (id: string, destination: "ACTIVE" | "DISMISSED" | "RESTORE") => () => post(`/api/opportunities/${id}/move`, { destination });

  // Keep: this listing only. From Dismissed it is restored (to where it was,
  // or Active); from Archived or Closed it returns to Active. Nothing else in
  // the group, and no duplicate decision, changes.
  const keep = (member: DuplicateGroupMemberView) =>
    run([move(member.id, member.status === "REJECTED_BY_USER" ? "RESTORE" : "ACTIVE")], `${name(member.id)} kept in Active.`);
  // Dismiss: this listing only, restorable from Dismissed.
  const dismiss = (member: DuplicateGroupMemberView) => run([move(member.id, "DISMISSED")], `${name(member.id)} moved to Dismissed.`);

  if (later) {
    return (
      <article className="duplicate-group duplicate-group-later" aria-label={label}>
        <h2>{label}</h2>
        <p>Left for later; nothing was changed. <button type="button" className="link-button" onClick={() => setLater(false)}>Show again</button></p>
      </article>
    );
  }

  return (
    <article className="duplicate-group" aria-label={label}>
      <header className="duplicate-group-header">
        <h2>{label}</h2>
        <p className="field-help">
          {members.length} listings · {unresolved ? `${unresolved} ${unresolved === 1 ? "pair" : "pairs"} to review` : "every pair decided"}
          {differing.length ? ` · differences in ${differing.map((field) => fieldNames[field] ?? field).join(", ")}` : " · no differences in the main details"}
        </p>
      </header>

      <div className="table-scroll">
        <table className="duplicate-compare">
          <caption className="visually-hidden">Listings in this group, side by side</caption>
          <thead>
            <tr>
              <th scope="col">Listing</th>
              {members.map((member) => (
                <th key={member.id} scope="col">
                  {short(member.id)}: <Link href={`/opportunities/${member.id}`}>{member.title}</Link>
                  <span className="field-help"> First seen {member.firstSeen}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([
              ["Title", (member) => member.title, "title"],
              ["Company", (member) => member.companyName, "company"],
              ["Location", (member) => member.location, "location"],
              ["Salary", (member) => member.salary, "salary"],
              ["Work arrangement", (member) => member.arrangement, "arrangement"],
              ["Source website", (member) => member.sourceWebsite, "source"],
              ["Where it is now", (member) => member.statusLabel, null],
              ["Triage", (member) => member.triageLabel, null],
            ] as Array<[string, (member: DuplicateGroupMemberView) => string | null, string | null]>).map(([rowLabel, value, field]) => (
              <tr key={rowLabel} className={field && differing.includes(field) ? "duplicate-differs" : undefined}>
                <th scope="row">{rowLabel}{field && differing.includes(field) ? <span className="visually-hidden"> (differs)</span> : null}</th>
                {members.map((member) => (
                  <td key={member.id}>{value(member) ?? "Not stated"}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Description</th>
              {members.map((member, index) => (
                <td key={member.id}>
                  {index === 0
                    ? "Compared with the others"
                    : member.description.similarity === null
                      ? "Too short to compare"
                      : `${Math.round(member.description.similarity * 100)}% the same text as the first`}
                  {member.description.onlyHereCount ? (
                    <details>
                      <summary>{member.description.onlyHereCount} sentence(s) only in this listing</summary>
                      <ul>{member.description.onlyHere.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul>
                    </details>
                  ) : null}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Actions</th>
              {members.map((member) => (
                <td key={member.id}>
                  <div className="duplicate-member-actions" data-listing={number.get(member.id)}>
                    {member.status === "APPLIED" || member.hasApplication ? (
                      // Protected: the Application Tracker owns this listing.
                      <span className="field-help">Has application history; managed in Applications</span>
                    ) : (
                      <>
                        {activeStatuses.has(member.status) ? (
                          <span className="field-help">In Active</span>
                        ) : (
                          <button type="button" className="secondary-button" disabled={working} aria-label={`Keep ${short(member.id)}`} onClick={() => keep(member)}>
                            Keep
                          </button>
                        )}
                        {member.status === "REJECTED_BY_USER" ? (
                          <button type="button" className="danger-button" disabled={working} aria-label={`Delete ${short(member.id)} permanently`} onClick={() => setConfirmDelete(member.id)}>
                            Delete permanently…
                          </button>
                        ) : (
                          <button type="button" className="secondary-button" disabled={working} aria-label={`Dismiss ${short(member.id)}`} onClick={() => dismiss(member)}>
                            Dismiss
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <details className="duplicate-identifiers">
        <summary>Identifiers and links</summary>
        <dl>
          {members.map((member) => (
            <div key={member.id}>
              <dt>{name(member.id)}</dt>
              <dd>
                Listing URL: {member.listingUrl ? <a href={member.listingUrl} rel="noreferrer" target="_blank">{member.listingUrl}</a> : "Not stated"}
                <br />
                Application URL: {member.applicationUrl ? <a href={member.applicationUrl} rel="noreferrer" target="_blank">{member.applicationUrl}</a> : "Not stated"}
                <br />
                Listing ID: {member.listingId ?? "Not stated"} · Requisition ID: {member.requisitionId ?? "Not stated"}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {confirmDelete ? (
        <div className="duplicate-confirm" role="alertdialog" aria-label="Confirm permanent deletion">
          <p>
            Delete <strong>{name(confirmDelete)}</strong> permanently? This cannot be undone. Its evaluations and history are removed; the
            other listings in this group are not changed.
          </p>
          <button
            type="button"
            className="danger-button"
            disabled={working}
            onClick={() => run([() => post("/api/opportunities/dismissed/delete", { opportunityIds: [confirmDelete] })], `${name(confirmDelete)} deleted permanently.`)}
          >
            Delete this listing permanently
          </button>
          <button type="button" className="secondary-button" disabled={working} onClick={() => setConfirmDelete(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      <h3 className="duplicate-pairs-title">Pairs</h3>
      <ul className="duplicate-pairs">
        {pairs.map((pair) => (
          <li key={`${pair.opportunityId}-${pair.relatedOpportunityId}`} data-state={pair.state}>
            <span>
              {short(pair.opportunityId)} and {short(pair.relatedOpportunityId)}:{" "}
              {pair.decision === "MATCH" ? "the same listing" : "a possible duplicate"} ({describeMatchedOn(pair.matchedOn)}
              {confidencePercent(pair.confidence) ? `, ${confidencePercent(pair.confidence)} similar` : ""}
              {describeConflicts(pair.conflicts) ? `; ${describeConflicts(pair.conflicts)}` : ""}).{" "}
              <strong>{pair.state === "UNRESOLVED" ? "Not decided" : pair.state === "DISTINCT" ? "Different jobs" : "Same job"}</strong>
            </span>
            <span className="duplicate-actions">
              {pair.state === "UNRESOLVED" ? (
                <>
                  <button type="button" className="secondary-button" disabled={working} onClick={() => run([decide(pair, "DISTINCT")], "Marked as different jobs.")}>
                    Not the same job
                  </button>
                  <button type="button" className="secondary-button" disabled={working} onClick={() => run([decide(pair, "SAME_JOB")], "Marked as the same job; both listings are kept.")}>
                    Same job
                  </button>
                </>
              ) : (
                <button type="button" className="secondary-button" disabled={working} onClick={() => run([decide(pair, null)], "The decision was undone.")}>
                  Undo
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p>
        <button type="button" className="link-button" disabled={working} onClick={() => setLater(true)}>
          Review later
        </button>
      </p>
      {messages.length ? (
        <div role="status" className="duplicate-messages">
          {messages.map((message) => <p key={message}>{message}</p>)}
        </div>
      ) : null}
    </article>
  );
}
