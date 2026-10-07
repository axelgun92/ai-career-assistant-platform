import { connection } from "next/server";
import { z } from "zod";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { ProfileHeader } from "@/components/profile/profile-header";
import { StartingProfileButton } from "@/components/profile/starting-profile-button";
import type { ProfileDocument } from "@/components/profile/structured-fields";
import { alexandraNugentCustomerSuccessProfile } from "@/server/profile-import/alexandra-nugent-customer-success-profile";
import { getProfileService, structuredFieldDefaults } from "@/server/profile-service";

export const metadata = { title: "Profile & preferences" };

const savedMessages: Record<string, string> = {
  created: "Saved as a new version. It is not active: new evaluations still use the active version.",
  "created-active": "Saved as a new version and made active. New evaluations will use it.",
  existing: "No new version was created: this content matches an existing version, shown here.",
  "existing-active": "This content matches an existing version, which is now active.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string | string[]; saved?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const service = getProfileService();

  let overview: Awaited<ReturnType<typeof service.overview>>;
  try {
    overview = await service.overview();
  } catch (error) {
    console.error("Profile page could not load profiles", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return (
      <main className="profile-page">
        <h1>Profile &amp; preferences</h1>
        <p className="error-message" role="alert">
          Profiles could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }

  if (overview.versions.length === 0) {
    return (
      <main className="profile-page">
        <h1>Profile &amp; preferences</h1>
        <p className="empty-state">
          No profile exists yet. Evaluations need a profile with your Customer Success preferences.
        </p>
        <StartingProfileButton document={alexandraNugentCustomerSuccessProfile} />
      </main>
    );
  }

  const requested = z.uuid().safeParse(first(params.version));
  const displayedId =
    requested.success && overview.versions.some((item) => item.id === requested.data)
      ? requested.data
      : overview.active?.userProfileId ?? overview.versions[0]!.id;
  const displayed = await service.getVersion(displayedId);
  const saved = savedMessages[first(params.saved) ?? ""];
  const activeId = overview.active?.explicit ? overview.active.userProfileId : null;

  return (
    <main className="profile-page">
      <ProfileHeader
        active={
          overview.active
            ? {
                ...overview.active,
                activatedAt: overview.active.activatedAt ? overview.active.activatedAt.toISOString() : null,
              }
            : null
        }
        displayed={{
          id: displayed.id,
          version: displayed.version,
          label: displayed.label,
          createdAt: displayed.createdAt.toISOString(),
        }}
      />
      {saved ? (
        <p className="success-message" role="status">
          {saved}
        </p>
      ) : null}
      <ProfileEditor
        key={displayed.id}
        base={{
          id: displayed.id,
          label: displayed.label,
          version: displayed.version,
          document: displayed.document as unknown as ProfileDocument,
        }}
        defaults={structuredFieldDefaults()}
        versions={overview.versions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))}
        activeId={activeId}
        effectiveId={overview.active?.userProfileId ?? null}
      />
    </main>
  );
}
