"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatLifecycle } from "../dashboard/format";
import { formatDateTime, formatMoney } from "./budget-format";
import { runDeferredAction, type DeferredActionResult } from "./deferred-actions";
import type { DeferralView } from "./types";

const outcomeMessages: Record<Exclude<DeferredActionResult["kind"], "error">, string> = {
  queued: "Queued — the evaluation will run shortly.",
  "still-deferred": "Still deferred: the budget does not have room yet.",
  cancelled: "Request cancelled.",
};

export function ProfileVersionNote({
  deferral,
  activeProfile,
}: {
  deferral: Pick<DeferralView, "userProfileId" | "userProfileVersion">;
  activeProfile: { id: string; version: number } | null;
}) {
  if (!deferral.userProfileId) return <span>Profile no longer exists</span>;
  const differs = activeProfile && activeProfile.id !== deferral.userProfileId;
  return (
    <span>
      v{deferral.userProfileVersion ?? "?"}
      {differs ? <span className="field-help"> (active profile is v{activeProfile.version})</span> : null}
    </span>
  );
}

// The persistent backlog of evaluations deferred for lack of budget.
export function DeferredBacklog({
  deferrals,
  activeProfile,
}: {
  deferrals: DeferralView[];
  activeProfile: { id: string; version: number } | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, DeferredActionResult>>({});
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  async function act(id: string, action: "resume" | "cancel") {
    setPending(id);
    setConfirmCancel(null);
    const result = await runDeferredAction(id, action);
    setResults((current) => ({ ...current, [id]: result }));
    setPending(null);
    router.refresh();
  }

  return (
    <section className="deferred-backlog" id="deferred-evaluations" aria-labelledby="deferred-title">
      <h2 id="deferred-title">Deferred evaluations</h2>
      {deferrals.length === 0 ? (
        <p className="empty-state">No evaluations are waiting for budget.</p>
      ) : (
        <>
          <p className="field-help">
            These evaluations were not started because the budget did not have room. Nothing was spent on them.
            Resuming checks the budget again; each runs with the profile version it was requested with.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Opportunity</th>
                  <th scope="col">Deferred</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Reserve</th>
                  <th scope="col">Profile</th>
                  <th scope="col">Last checked</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deferrals.map((deferral) => {
                  const result = results[deferral.id];
                  return (
                    <tr key={deferral.id} data-deferral-id={deferral.id}>
                      <td className="wrap-cell">
                        <Link href={`/opportunities/${deferral.opportunityId}`}>
                          {deferral.opportunityTitle ?? "Untitled opportunity"}
                        </Link>
                        <br />
                        <span className="field-help">
                          {deferral.companyName ?? "Unknown company"} · {formatLifecycle(deferral.opportunityStatus)}
                        </span>
                      </td>
                      <td>{formatDateTime(deferral.createdAt)}</td>
                      <td>Budget unavailable</td>
                      <td>{deferral.snapshot ? formatMoney(deferral.snapshot.reserve, deferral.snapshot.currency) : "Unknown"}</td>
                      <td>
                        <ProfileVersionNote deferral={deferral} activeProfile={activeProfile} />
                      </td>
                      <td>{formatDateTime(deferral.lastCheckedAt)}</td>
                      <td className="version-actions">
                        <button type="button" disabled={pending !== null} onClick={() => act(deferral.id, "resume")}>
                          {pending === deferral.id ? "Checking…" : "Resume"}
                        </button>
                        {confirmCancel === deferral.id ? (
                          <span className="confirm-inline" role="group" aria-label="Confirm cancelling this request">
                            <button
                              type="button"
                              className="secondary-button danger-button"
                              disabled={pending !== null}
                              onClick={() => act(deferral.id, "cancel")}
                            >
                              Cancel request
                            </button>
                            <button type="button" className="secondary-button" onClick={() => setConfirmCancel(null)}>
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={pending !== null}
                            onClick={() => setConfirmCancel(deferral.id)}
                          >
                            Cancel…
                          </button>
                        )}
                        {result ? (
                          <span role="status" className={result.kind === "error" ? "field-error" : "usage-note"}>
                            {result.kind === "error" ? result.message : outcomeMessages[result.kind]}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
