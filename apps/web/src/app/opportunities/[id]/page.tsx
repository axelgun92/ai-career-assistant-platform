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
import { applyConfirmedFacts, isNoLongerListed, normalizationCorrectionsOf, type ConfirmedFactField } from "@ai-career/core";
import { getListingHistory } from "@/server/retrieval-service";
import { formatLifecycle } from "@/components/dashboard/format";
import { getOpportunityLifecyclePresentation } from "@/server/opportunity-action-service";
import { ProfileVersionHint } from "@/components/profile/profile-version-hint";
import { ListingVersionHint } from "@/components/evaluation/listing-version-hint";
import { findListingVersionHint, PrismaConfirmedFactRepository, PrismaPreEvaluatorTriageRepository, PrismaTriageRoutingRepository, PrismaUserEligibilityRepository } from "@ai-career/database";
import { MissingInformation } from "@/components/confirmed-facts/missing-information";
import { suggestedConfirmableFields } from "@/components/confirmed-facts/suggested-fields";
import { confirmedFactView } from "@/server/confirmed-fact-service";
import { WorkEligibilityNote } from "@/components/eligibility/work-eligibility-note";
import { getProfileService } from "@/server/profile-service";
import { getBudgetService } from "@/server/budget-service";
import { toDeferralView } from "@/components/budget/deferral-view";
import { ApplicationLoadError, ApplicationPanel } from "@/components/application/application-panel";
import { toApplicationView } from "@/components/application/types";
import { getApplicationStore } from "@/server/application-service";
import { getDuplicateStore } from "@/server/duplicate-service";
import { getCompanyIntelligenceService } from "@/server/company-intelligence-service";
import { getPreEvaluatorTriageService } from "@/server/pre-evaluator-triage-service";
import { getEvaluationService } from "@/server/evaluation-service";
import { DuplicateNotices } from "@/components/duplicate-notices";
import { duplicateStageOf } from "@/components/processing-breakdown";
import {
  applicationUrlBasisNotes,
  employerOnTargetStatement,
  employmentTypeLabel,
  formatSalary,
  formatArrangementWithExceptions,
  formatResidency,
  formatResidencyEligibility,
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

const triageOutcomeLabel: Record<string, string> = { EVALUATE: "Evaluate", NEEDS_REVIEW: "Needs Review", REJECT: "Rejected" };
const triageTriggerLabel: Record<string, string> = {
  INITIAL: "first assessment",
  CAPTURE_CHANGED: "the listing changed",
  PROFILE_CHANGED: "your profile changed",
  USER_CORRECTION: "you confirmed information",
  RULES_CHANGED: "the triage rules changed",
  INPUT_CHANGED: "an input changed",
};

// The facts table row each confirmed field overlays.
const confirmedRowOf: Record<ConfirmedFactField, string> = {
  salaryRange: "Salary",
  currency: "Salary",
  compensationBasis: "Salary",
  applicableTier: "Salary",
  residency: "Location eligibility",
  workArrangements: "Work arrangement",
  employmentType: "Employment type",
  workAuthorization: "Work authorization",
  seniority: "Seniority (as stated)",
};

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
  // D1: when a current fact's provenance was written by a normalization
  // correction of the same, unchanged source version (its row was written
  // with that correction event), that correction's date.
  const corrections = new Map(detail.sourceRecords.map((record) => [record.id, normalizationCorrectionsOf(record.sourceMetadata)]));
  const correctionOf = (item: (typeof detail.fieldProvenance)[number]): Date | null => {
    const created = new Date(item.createdAt).getTime();
    const event = (corrections.get(item.sourceRecordId ?? "") ?? []).find(
      (correction) => correction.fields.includes(item.fieldName) && Math.abs(correction.at.getTime() - created) < 60_000,
    );
    return event?.at ?? null;
  };
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
  // A stored assessment whose inputs changed (facts, confirmed facts, the
  // profile, eligibility or the rules) is assessed again before it is shown,
  // so the facts and the triage explanation always agree (November 25,
  // 2026). An opportunity never triaged is left as it is.
  if (await getPreEvaluatorTriageService().gate.get(detail.opportunity.id).catch(() => null)) {
    await getEvaluationService()
      .assessTriage(detail.opportunity.id, { onlyIfStale: true })
      .catch((error: unknown) => console.error("Pre-evaluator triage could not be refreshed", { errorName: error instanceof Error ? error.name : "UnknownError" }));
  }
  const triage = await getPreEvaluatorTriageService()
    .gate.get(detail.opportunity.id)
    .catch((error: unknown) => {
      console.error("Pre-evaluator triage could not be loaded", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    });

  // Whether an evaluation exists, so an unevaluated job renders its normal
  // state without a request the API answers 404 (November 25, 2026). A
  // failed check leaves it unknown: the panel then loads as before and
  // reports a genuine failure.
  const evaluationExists = await getEvaluationService()
    .hasEvaluation(detail.opportunity.id)
    .catch((error: unknown) => {
      console.error("Evaluation presence could not be checked", { errorName: error instanceof Error ? error.name : "UnknownError" });
      return null;
    });

  // Every assessment, oldest first (November 25, 2026): the triage result
  // stays in the job's history whatever lifecycle state it moves to.
  const triageHistory = await new PrismaPreEvaluatorTriageRepository().history(detail.opportunity.id).catch(() => []);

  // A dismissal the app made itself, by triage-to-lifecycle routing.
  const automaticDismissal =
    lifecycle?.status === "REJECTED_BY_USER"
      ? await new PrismaTriageRoutingRepository().automaticDismissal(detail.opportunity.id).catch(() => null)
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
  // Company Intelligence (feature 18): the company page this job belongs to.
  const companyId = await getCompanyIntelligenceService()
    .companyIdForOpportunity(detail.opportunity.id)
    .catch(() => null);
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
  // Both dates are kept as the posting states them; a closing date before
  // the posting date (a posting that restates an old deadline) is shown with
  // a note, never corrected.
  const closingDate =
    detail.opportunity.closingDate && detail.opportunity.postingDate && new Date(detail.opportunity.closingDate) < new Date(detail.opportunity.postingDate)
      ? `${display(detail.opportunity.closingDate)} (as stated; earlier than the posting date, so the posting may restate a past deadline)`
      : detail.opportunity.closingDate;
  const onTargetStatement = employerOnTargetStatement(detail.fieldProvenance);
  // Facts the user confirmed from the job description overlay the captured
  // ones here exactly as in triage (November 25, 2026), marked as such.
  const confirmedStore = new PrismaConfirmedFactRepository();
  const [confirmedFacts, confirmedHistory, capturedNow] = await Promise.all([
    confirmedStore.list(detail.opportunity.id).catch(() => []),
    confirmedStore.history(detail.opportunity.id).catch(() => []),
    confirmedStore.capturedFacts(detail.opportunity.id).catch(() => null),
  ]);
  const shown = applyConfirmedFacts({ ...detail.opportunity, fullTimeScheduleConfirmed: false }, confirmedFacts);
  const confirmedRows = new Set(confirmedFacts.map((fact) => confirmedRowOf[fact.fieldName]));
  const marked = (row: string, value: string | null) => (value && confirmedRows.has(row) ? `${value} (confirmed by you)` : value);
  const normalizedFields = [
    ["Lifecycle", formatLifecycle(detail.opportunity.status)],
    ["Domain", detail.opportunity.domain],
    ["Title", detail.opportunity.title],
    ["Company", detail.opportunity.companyName],
    ["Location", detail.opportunity.location],
    ["Salary", marked("Salary", formatSalary(shown))],
    // The employer's on-target earnings beside its base salary, in its own
    // words: total pay (base plus variable), never labelled variable pay.
    ...(onTargetStatement ? [["On-target earnings (as stated; base + variable)", onTargetStatement] as const] : []),
    ["Posting date", postingDate],
    ["Closing date", closingDate],
    ["Work arrangement", marked("Work arrangement", shown.remoteStatus || shown.workArrangements.length ? formatArrangementWithExceptions(shown, confirmedRows.has("Work arrangement") ? [] : detail.fieldProvenance) : null)],
    ["Work authorization", marked("Work authorization", formatWorkAuthorization(shown, geographyName))],
    // Where candidates must live, a separate fact from work authorization:
    // shown only when the posting states it.
    ...(shown.residencyRequirement || shown.residencyExclusions.length
      ? [["Location eligibility", marked("Location eligibility", formatResidencyEligibility(shown.residencyRequirement, shown.residencyRegions, shown.residencyExclusions))] as const]
      : []),
    // The label as the posting states it, even when it names no single level.
    ["Seniority (as stated)", confirmedRows.has("Seniority (as stated)") && shown.seniority ? marked("Seniority (as stated)", seniorityLabel(shown.seniority)) : detail.opportunity.seniorityLabel ?? (detail.opportunity.seniority ? seniorityLabel(detail.opportunity.seniority) : null)],
    ["Employment type", marked("Employment type", shown.employmentType ? `${employmentTypeLabel(shown.employmentType)}${shown.fullTimeScheduleConfirmed ? " (full-time schedule)" : ""}` : null)],
    // A requirement or a stated preference, in the posting's own words.
    ["Time zone", detail.opportunity.timeZoneRequirements],
  ] as const;
  const urlFields = [
    ["Source URL", detail.opportunity.canonicalUrl],
    ["Application URL", detail.opportunity.applicationUrl],
  ] as const;
  // The requisition ID the listing states (a source field, or a labelled
  // "Job Requisition ID" on the page or in the posting).
  const requisitionId = detail.opportunity.atsRequisitionId;
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
          {companyId && detail.opportunity.companyName ? (
            <Link href={`/companies/${companyId}`}>{detail.opportunity.companyName}</Link>
          ) : (
            (detail.opportunity.companyName ?? "Unknown company")
          )}
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
          automaticDismissal={automaticDismissal?.reason ?? null}
          moveDestinations={lifecycle.moveDestinations}
          blockedMoves={lifecycle.blockedMoves}
          applicationPointer={
            lifecycle.availableActions.includes("MARK_APPLIED") || lifecycle.blockedActions.some((blocked) => blocked.action === "MARK_APPLIED")
          }
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

      {detail.opportunity.domain === "customer-success" ? (
        <MissingInformation
          opportunityId={detail.opportunity.id}
          facts={confirmedFacts.map((fact) => confirmedFactView(fact, capturedNow))}
          history={confirmedHistory.map((event) => ({ id: event.id, fieldName: event.fieldName, action: event.action, value: event.value, createdAt: event.createdAt.toISOString() }))}
          tierLabels={(detail.opportunity.compensationTiers ?? []).map((tier) => tier.label)}
          needsReview={triage?.outcome === "NEEDS_REVIEW"}
          suggestedFields={triage?.outcome === "NEEDS_REVIEW" ? suggestedConfirmableFields(triage.reasons.map((reason) => reason.code)) : []}
        />
      ) : null}

      {triageHistory.length > 1 ? (
        <details className="triage-history">
          <summary>Triage history ({triageHistory.length} assessments)</summary>
          <ol>
            {triageHistory.map((entry) => (
              <li key={entry.id}>
                {entry.assessedAt.toLocaleString()}: {triageOutcomeLabel[entry.outcome] ?? entry.outcome} ({triageTriggerLabel[entry.trigger] ?? entry.trigger})
                {entry.reasons.length ? ` · ${entry.reasons.map((reason) => reason.message).join(" ")}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <EvaluationExperience
        evaluationExists={evaluationExists}
        evaluable={lifecycle?.evaluable ?? true}
        deferral={deferral}
        activeProfile={activeProfile}
        capture={{
          normalized: detail.opportunity.status !== "DISCOVERED",
          observations: detail.sourceRecords.length,
          firstFoundAt: new Date(detail.opportunity.discoveredAt ?? detail.opportunity.createdAt).toISOString(),
        }}
        duplicate={duplicateStageOf(duplicates)}
        triage={triage ? {
          outcome: triage.outcome,
          automaticOutcome: triage.automaticOutcome,
          reasons: triage.reasons,
          manualDecision: triage.manualDecision,
          manuallyDecidedAt: triage.manuallyDecidedAt?.toISOString() ?? null,
          userProfileVersion: triage.userProfileVersion,
          assessedAt: triage.assessedAt.toISOString(),
        } : null}
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
          workArrangement: formatArrangementWithExceptions(detail.opportunity, detail.fieldProvenance),
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
          <div>
            <dt>Requisition ID</dt>
            <dd>{display(requisitionId)}</dd>
          </div>
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
                {correctionOf(item) ? `; corrected ${correctionOf(item)!.toISOString().slice(0, 10)} by the current reading rules (posting unchanged)` : ""}
              </span>
            </li>
          ))}
        </ul>
        {detail.supersededProvenance?.length ? (
          <>
            <h3>Earlier provenance</h3>
            <p>
              Evidence from earlier versions of the listing, or from an earlier reading of the same version, replaced by a newer version or by
              a correction under the current reading rules. Kept for history.
            </p>
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
