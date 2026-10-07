import Link from "next/link";
import type { ApplicationCreationMode, OpportunityLifecycleState } from "@ai-career/core";
import { Contacts } from "./contacts";
import { FollowUps } from "./follow-ups";
import { Interviews } from "./interviews";
import { applicationStatusLabel, outcomeLabels, relativeDays } from "./labels";
import { Notes } from "./notes";
import { StageControls } from "./stage-controls";
import { StartTracking } from "./start-tracking";
import { Timeline } from "./timeline";
import type { ApplicationView } from "./types";

export interface ApplicationPanelProps {
  opportunityId: string;
  opportunityStatus: OpportunityLifecycleState;
  application: ApplicationView | null;
  modes: ApplicationCreationMode[];
  effectiveAppliedOn: string | null;
  reopenBlockedReason: string | null;
  today: string;
}

// The application tracker section of the opportunity page. It sits beside
// the opportunity's lifecycle and evaluation, and never changes either on
// its own (recording a submission marks the opportunity applied).
export function ApplicationPanel(props: ApplicationPanelProps) {
  const { application, today } = props;
  const readOnly = props.opportunityStatus === "ARCHIVED";
  return (
    <section className="application-panel" aria-labelledby="application-title">
      <p className="eyebrow">Application tracker</p>
      <h2 id="application-title">Application</h2>
      {!application ? (
        <StartTracking
          opportunityId={props.opportunityId}
          modes={props.modes}
          alreadyApplied={props.opportunityStatus === "APPLIED"}
          effectiveAppliedOn={props.effectiveAppliedOn}
          today={today}
        />
      ) : (
        <>
          {readOnly ? (
            <p className="warning-message" role="status">
              This opportunity is archived, so its application is read-only. Restore the opportunity to make changes.
            </p>
          ) : null}
          <dl className="application-summary">
            <div>
              <dt>Stage</dt>
              <dd>
                <span className="status-label status-label-application">
                  {applicationStatusLabel(application.stage, application.outcome)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Applied</dt>
              <dd>
                {application.appliedOn
                  ? `${application.appliedOn} (${relativeDays(application.appliedOn, today)})`
                  : "Not submitted"}
              </dd>
            </div>
            {application.outcome ? (
              <div>
                <dt>Outcome</dt>
                <dd>
                  {outcomeLabels[application.outcome]}
                  {application.closedOn ? ` · closed ${application.closedOn}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
          {readOnly ? null : (
            <StageControls application={application} today={today} reopenBlockedReason={props.reopenBlockedReason} />
          )}
          <FollowUps application={application} today={today} readOnly={readOnly} />
          <Interviews application={application} readOnly={readOnly} />
          <Contacts application={application} readOnly={readOnly} />
          <Notes application={application} readOnly={readOnly} />
          <Timeline application={application} />
          <p>
            <Link href="/applications">View all applications</Link>
          </p>
        </>
      )}
    </section>
  );
}
