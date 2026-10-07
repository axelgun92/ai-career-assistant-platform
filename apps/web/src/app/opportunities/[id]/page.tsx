import Link from "next/link";
import { notFound } from "next/navigation";
import { getManualOpportunityService } from "@/server/manual-opportunity-service";
import { EvaluationExperience } from "@/components/evaluation/evaluation-experience";
import { ExternalLink, safeExternalUrl } from "@/components/external-link";
import { OpportunityActions } from "@/components/opportunity-actions";
import { OpportunityProvenance } from "@/components/opportunity-provenance";
import { formatLifecycle } from "@/components/dashboard/format";
import { getOpportunityLifecyclePresentation } from "@/server/opportunity-action-service";
import { ProfileVersionHint } from "@/components/profile/profile-version-hint";
import { getProfileService } from "@/server/profile-service";
import { getBudgetService } from "@/server/budget-service";
import { toDeferralView } from "@/components/budget/deferral-view";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getManualOpportunityService().getById(id).catch(() => null);

  if (!detail) {
    notFound();
  }
  const lifecycle = await getOpportunityLifecyclePresentation(detail.opportunity.id).catch(
    (error: unknown) => {
      console.error("Opportunity lifecycle could not be loaded", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    },
  );

  const profileHint = await getProfileService()
    .profileVersionHint(detail.opportunity.id)
    .catch((error: unknown) => {
      console.error("Profile version hint could not be loaded", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    });

  const deferral = await getBudgetService()
    .gate.findOpenDeferral(detail.opportunity.id)
    .then((record) => (record ? toDeferralView(record) : null))
    .catch((error: unknown) => {
      console.error("Deferred evaluation could not be loaded", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    });
  const activeProfile = deferral
    ? await getProfileService()
        .overview()
        .then(({ active }) => (active ? { id: active.userProfileId, version: active.version } : null))
        .catch(() => null)
    : null;

  const normalizedFields = [
    ["Lifecycle", detail.opportunity.status],
    ["Domain", detail.opportunity.domain],
    ["Title", detail.opportunity.title],
    ["Company", detail.opportunity.companyName],
    ["Location", detail.opportunity.location],
    ["Compensation", detail.opportunity.salaryText],
    ["Posting date", detail.opportunity.postingDate],
    ["Remote status", detail.opportunity.remoteStatus],
    ["Time-zone requirements", detail.opportunity.timeZoneRequirements],
  ] as const;
  const urlFields = [
    ["Source URL", detail.opportunity.canonicalUrl],
    ["Application URL", detail.opportunity.applicationUrl],
  ] as const;
  const applicationUrl = safeExternalUrl(detail.opportunity.applicationUrl);
  const sourceUrl = safeExternalUrl(detail.opportunity.canonicalUrl);

  return (
    <main className="opportunity-page">
      <Link href="/">← All opportunities</Link>

      {applicationUrl || sourceUrl ? (
        <nav className="opportunity-links" aria-label="Opportunity links">
          {applicationUrl ? (
            <ExternalLink href={applicationUrl}>Open application page</ExternalLink>
          ) : null}
          {sourceUrl ? (
            <ExternalLink href={sourceUrl}>Open source posting</ExternalLink>
          ) : null}
        </nav>
      ) : null}

      {lifecycle ? (
        <OpportunityActions
          opportunityId={detail.opportunity.id}
          statusLabel={formatLifecycle(lifecycle.status)}
          availableActions={lifecycle.availableActions}
        />
      ) : null}

      <ProfileVersionHint hint={profileHint} />

      <EvaluationExperience
        evaluable={lifecycle?.evaluable ?? true}
        deferral={deferral}
        activeProfile={activeProfile}
        opportunity={{
          id: detail.opportunity.id,
          title: detail.opportunity.title ?? "Untitled opportunity",
          company: detail.opportunity.companyName ?? "Unknown company",
          salary: detail.opportunity.salaryText ?? "Unknown",
          location: detail.opportunity.location ?? "Unknown",
          workArrangement: detail.opportunity.remoteStatus ?? "Unknown",
          timeZoneRequirements: detail.opportunity.timeZoneRequirements ?? "Unknown",
        }}
      />

      <OpportunityProvenance
        opportunity={detail.opportunity}
        sourceRecords={detail.sourceRecords}
      />

      <details className="source-details">
        <summary>Normalized opportunity and source details</summary>
      <section>
        <h2>Normalized Opportunity</h2>
        <dl>
          {normalizedFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{display(value)}</dd>
            </div>
          ))}
          {urlFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <ExternalLink href={value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>Preserved source text</h2>
        {detail.sourceRecords.map((record) => (
          <div key={record.id}>
            <p>
              SourceRecord ID: <code>{record.id}</code>
            </p>
            <pre>{record.rawDescription ?? "Unknown"}</pre>
          </div>
        ))}
      </section>

      <section>
        <h2>Field Provenance</h2>
        <ul className="provenance-list">
          {detail.fieldProvenance.map((item) => (
            <li key={item.id}>
              <strong>{item.fieldName}</strong>: {display(item.normalizedValue)}
              <br />
              <span>
                Source field: {item.sourceField}; method: {item.kind}
              </span>
            </li>
          ))}
        </ul>
      </section>
      </details>
    </main>
  );
}
