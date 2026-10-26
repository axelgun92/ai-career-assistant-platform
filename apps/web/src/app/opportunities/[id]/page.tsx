import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getManualOpportunityService } from "@/server/manual-opportunity-service";
import { EvaluationExperience } from "@/components/evaluation/evaluation-experience";
import { ExternalLink, safeExternalUrl } from "@/components/external-link";
import { OpportunityActions } from "@/components/opportunity-actions";
import { OpportunityProvenance } from "@/components/opportunity-provenance";
import { PostingHistory, toPostingHistoryListing } from "@/components/posting-history";
import { isNoLongerListed } from "@ai-career/core";
import { getListingHistory } from "@/server/retrieval-service";
import { formatLifecycle } from "@/components/dashboard/format";
import { getOpportunityLifecyclePresentation } from "@/server/opportunity-action-service";
import { ProfileVersionHint } from "@/components/profile/profile-version-hint";
import { ListingVersionHint } from "@/components/evaluation/listing-version-hint";
import { findListingVersionHint, PrismaUserEligibilityRepository } from "@ai-career/database";
import { WorkEligibilityNote } from "@/components/eligibility/work-eligibility-note";
import { getProfileService } from "@/server/profile-service";
import { getBudgetService } from "@/server/budget-service";
import { toDeferralView } from "@/components/budget/deferral-view";
import { ApplicationLoadError, ApplicationPanel } from "@/components/application/application-panel";
import { toApplicationView } from "@/components/application/types";
import { getApplicationStore } from "@/server/application-service";
import { getDuplicateStore } from "@/server/duplicate-service";
import { DuplicateNotices } from "@/components/duplicate-notices";
import {
  applicationUrlBasisNotes,
  employmentTypeLabel,
  formatSalary,
  formatWorkArrangements,
  formatResidency,
  formatWorkAuthorization,
  seniorityLabel,
  workArrangementLabel,
} from "@/components/opportunity-facts";
import {
  applicationCreationModes,
  geographyName,
  reopenRefusal,
  workAuthorizationRelevance,
  reopenTarget,
  trackingRefusalMessage,
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { capture: captureParam } = await searchParams;
  const capture = captureParam === "attached" || captureParam === "probable" ? captureParam : null;
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

  const listingHint = await findListingVersionHint(detail.opportunity.id).catch((error: unknown) => {
    console.error("Listing version hint could not be loaded", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  });

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

  const duplicates = await getDuplicateStore()
    .relationships(detail.opportunity.id)
    .catch((error: unknown) => {
      console.error("Duplicate relationships could not be loaded", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return [];
    });

  const listings = await getListingHistory(detail.opportunity.id).catch((error: unknown) => {
    console.error("Posting history could not be loaded", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return [];
  });
  const noLongerListed = isNoLongerListed(listings.map(toPostingHistoryListing));
  const now = new Date();

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
  const reopenBlockedReason = reopenRefused && trackingContext
    ? trackingRefusalMessage(reopenRefused, trackingContext.opportunityStatus, "reopen")
    : null;

  // A posting date dated from a stated age ("2 weeks ago") is approximate.
  const postedAge = detail.fieldProvenance.find((row) => row.fieldName === "postingDate" && row.sourceField.endsWith("relative-posted-age"));
  const postingDate = postedAge && detail.opportunity.postingDate
    ? `About ${display(detail.opportunity.postingDate)} (stated as "${postedAge.sourceText}")`
    : detail.opportunity.postingDate;
  const normalizedFields = [
    ["Lifecycle", formatLifecycle(detail.opportunity.status)],
    ["Domain", detail.opportunity.domain],
    ["Title", detail.opportunity.title],
    ["Company", detail.opportunity.companyName],
    ["Location", detail.opportunity.location],
    ["Salary", formatSalary(detail.opportunity)],
    ["Posting date", postingDate],
    ["Closing date", detail.opportunity.closingDate],
    ["Work arrangement", detail.opportunity.remoteStatus || detail.opportunity.workArrangements.length ? formatWorkArrangements(detail.opportunity) : null],
    ["Work authorization", formatWorkAuthorization(detail.opportunity, geographyName)],
    // Where candidates must live, a separate fact from work authorization:
    // shown only when the posting states it.
    ...(detail.opportunity.residencyRequirement
      ? [["Location eligibility", formatResidency(detail.opportunity.residencyRequirement, detail.opportunity.residencyRegions)] as const]
      : []),
    // The label as the posting states it, even when it names no single level.
    ["Seniority (as stated)", detail.opportunity.seniorityLabel ?? (detail.opportunity.seniority ? seniorityLabel(detail.opportunity.seniority) : null)],
    ["Employment type", detail.opportunity.employmentType ? employmentTypeLabel(detail.opportunity.employmentType) : null],
    // A requirement or a stated preference, in the posting's own words.
    ["Time zone", detail.opportunity.timeZoneRequirements],
  ] as const;
  const urlFields = [
    ["Source URL", detail.opportunity.canonicalUrl],
    ["Application URL", detail.opportunity.applicationUrl],
  ] as const;
  const applicationUrlNote = applicationUrlBasisNotes[
    detail.fieldProvenance.find((row) => row.fieldName === "applicationUrl")?.sourceField ?? ""
  ] ?? null;
  const eligibility = await new PrismaUserEligibilityRepository().get().catch(() => null);
  const workEligibility = workAuthorizationRelevance(detail.opportunity, eligibility);
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

      <DuplicateNotices
        opportunityId={detail.opportunity.id}
        capture={capture}
        relationships={duplicates.map((relationship) => ({
          otherOpportunityId: relationship.otherOpportunityId,
          otherTitle: relationship.otherTitle,
          otherCompanyName: relationship.otherCompanyName,
          decision: relationship.decision,
          confidence: relationship.confidence,
          matchedOn: relationship.matchedOn,
          conflicts: relationship.conflicts,
          resolution: relationship.resolution,
        }))}
      />

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
      ) : tracking === null ? (
        <ApplicationLoadError />
      ) : null}

      <ProfileVersionHint hint={profileHint} />
      <ListingVersionHint hint={listingHint} />
      <WorkEligibilityNote relevance={workEligibility} />

      <EvaluationExperience
        evaluable={lifecycle?.evaluable ?? true}
        deferral={deferral}
        activeProfile={activeProfile}
        listingWarning={
          noLongerListed
            ? "This listing is no longer listed on the sources that can confirm it (see Posting history). You can still evaluate it."
            : null
        }
        opportunity={{
          id: detail.opportunity.id,
          title: detail.opportunity.title ?? "Untitled opportunity",
          company: detail.opportunity.companyName ?? "Unknown company",
          salary: formatSalary(detail.opportunity) ?? "Unknown",
          location: detail.opportunity.location ?? "Unknown",
          workArrangement: formatWorkArrangements(detail.opportunity),
          timeZoneRequirements: detail.opportunity.timeZoneRequirements ?? "Unknown",
        }}
      />

      <OpportunityProvenance
        opportunity={detail.opportunity}
        sourceRecords={detail.sourceRecords}
      />

      <PostingHistory listings={listings} sourceRecords={detail.sourceRecords} now={now} />

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
                {label === "Application URL" && value && applicationUrlNote ? <span className="field-note"> ({applicationUrlNote})</span> : null}
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
        {detail.supersededProvenance?.length ? (
          <>
            <h3>Earlier provenance</h3>
            <p>Evidence from earlier versions of the listing, replaced by a newer version. Kept for history.</p>
            <ul className="provenance-list provenance-superseded">
              {detail.supersededProvenance.map((item) => (
                <li key={item.id}>
                  <strong>{item.fieldName}</strong>: {display(item.normalizedValue)}
                  <br />
                  <span>
                    Source field: {item.sourceField}; method: {item.kind}; replaced {item.supersededAt.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      </details>
    </main>
  );
}
