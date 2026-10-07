"use client";

import { useState } from "react";
import { formatDate } from "../dashboard/format";

export interface ProfileVersionRow {
  id: string;
  label: string;
  version: number;
  createdAt: string;
  evaluationCount: number;
}

export function ProfileVersions({
  versions,
  activeId,
  effectiveId,
  displayedId,
  activating,
  onView,
  onActivate,
}: {
  versions: ProfileVersionRow[];
  activeId: string | null;
  effectiveId: string | null;
  displayedId: string;
  activating: string | null;
  onView: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const showLabels = new Set(versions.map((item) => item.label)).size > 1;
  return (
    <section className="profile-versions" aria-labelledby="profile-versions-title">
      <h2 id="profile-versions-title">Version history</h2>
      <p className="field-help">
        Every save creates a new version; versions are never changed. Each evaluation stays linked to the version
        it used.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Version</th>
              {showLabels ? <th scope="col">Profile</th> : null}
              <th scope="col">Saved</th>
              <th scope="col">Evaluations</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((item) => (
              <tr key={item.id} data-version-id={item.id} aria-current={item.id === displayedId ? "true" : undefined}>
                <td>v{item.version}</td>
                {showLabels ? <td>{item.label}</td> : null}
                <td>{formatDate(item.createdAt)}</td>
                <td>{item.evaluationCount}</td>
                <td>
                  {item.id === activeId ? <span className="status-label">Active</span> : null}
                  {item.id !== activeId && item.id === effectiveId ? (
                    <span className="status-label" title="No version has been made active; evaluations use the newest profile">
                      In use (newest)
                    </span>
                  ) : null}
                  {item.id === displayedId ? <span className="viewing-label">Viewing</span> : null}
                </td>
                <td className="version-actions">
                  {item.id !== displayedId ? (
                    <button type="button" className="secondary-button" onClick={() => onView(item.id)}>
                      View v{item.version}
                    </button>
                  ) : null}
                  {item.id !== activeId ? (
                    confirming === item.id ? (
                      <span className="confirm-inline" role="group" aria-label={`Confirm making v${item.version} active`}>
                        <span>New evaluations will use v{item.version}.</span>
                        <button
                          type="button"
                          disabled={activating !== null}
                          onClick={() => {
                            setConfirming(null);
                            onActivate(item.id);
                          }}
                        >
                          Confirm
                        </button>
                        <button type="button" className="secondary-button" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={activating !== null}
                        onClick={() => setConfirming(item.id)}
                      >
                        {activating === item.id ? "Activating…" : `Make v${item.version} active`}
                      </button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
