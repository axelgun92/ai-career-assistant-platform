import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
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
import { ApplicationPanel } from "@/components/application/application-panel";
import { toApplicationView } from "@/components/application/types";
import { getApplicationStore } from "@/server/application-service";
import {
  applicationCreationModes,
  reopenRefusal,
  reopenTarget,
  utcToday,
} from "@ai-career/core";

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

// Not found (bad id or missing opportunity) is a 404; a failure to load is
// an error page, so a database problem is never reported as "not found".
async function loadOpportunity(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return getManualOpportunityService().getById(id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadOpportunity(id).catch(() => null);
  return { title: detail?.opportunity.title ?? "Opportunity" };
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadOpportunity(id);

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

  const tracking = await Promise.all([
    getApplicationStore().getByOpportunity(detail.opportunity.id),
    getApplicationStore().trackingContext(detail.opportunity.id),
  ]).catch((error: unknown) => {
    console.error("Application could not be loaded", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  });
  const [application, trackingContext] = tracking ?? [null, null];
  const reopenTo = application?.stage === "CLOSED" ? reopenTarget(application.events) : null;
  const reopenRefused = reopenTo && trackingContext ? reopenRefusal(reopenTo, trackingContext.opportunityStatus) : null;
  const reopenBlockedReason = reopenRefused === "APPLICATION_ALREADY_SUBMITTED"
    ? "This opportunity is already marked as applied, so this plan cannot be reopened."
    : reopenRefused
      ? "Restore the opportunity before reopening this plan."
      : null;

  const normalizedFields = [
    ["Lifecycle", formatLifecycle(detail.opportunity.status)],
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
      <Link href="/">← Back to dashboard</Link>
      <header className="opportunity-title">
        <h1>{detail.opportunity.title ?? "Untitled opportunity"}</h1>
        <p>
          {detail.opportunity.companyName ?? "Unknown company"}
          {detail.opportunity.location ? ` · ${detail.opportunity.location}` : ""}
        </p>
      </header>

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
          blockedActions={lifecycle.blockedActions}
        />
      ) : null}

      {trackingContext ? (
        <ApplicationPanel
          opportunityId={detail.opportunity.id}
          opportunityStatus={trackingContext.opportunityStatus}
          application={application ? toApplicationView(application) : null}
          modes={applicationCreationModes(trackingContext.opportunityStatus)}
          effectiveAppliedOn={trackingContext.effectiveAppliedOn}
          reopenBlockedReason={reopenBlockedReason}
          today={utcToday()}
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
