import { formatDate } from "../dashboard/format";

export interface ActiveProfileSummary {
  userProfileId: string;
  version: number;
  label: string;
  activatedAt: string | null;
  explicit: boolean;
}

export function ProfileHeader({
  active,
  displayed,
}: {
  active: ActiveProfileSummary | null;
  displayed: { id: string; version: number; label: string; createdAt: string };
}) {
  const viewingActive = active?.userProfileId === displayed.id;
  return (
    <div className="profile-header">
      <p className="eyebrow">{displayed.label}</p>
      <h1>Profile &amp; preferences</h1>
      {active ? (
        <p className="profile-active" data-testid="active-profile">
          New evaluations use <strong>version {active.version}</strong>
          {active.explicit && active.activatedAt
            ? ` (active since ${formatDate(active.activatedAt)}).`
            : " (the newest profile, because no version has been made active yet)."}
        </p>
      ) : (
        <p className="profile-active">No profile is available for evaluations yet.</p>
      )}
      {!viewingActive ? (
        <p className="unknown-callout" role="note">
          You are viewing version {displayed.version} (saved {formatDate(displayed.createdAt)}), which is not the
          version new evaluations use. Saving from here creates a new version; it does not change version{" "}
          {displayed.version}.
        </p>
      ) : null}
    </div>
  );
}
