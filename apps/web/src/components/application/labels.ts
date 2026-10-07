// Display text for the application tracker. Pure: it only reformats stored
// values (stages, outcomes, history events) into readable labels.
import type {
  ApplicationContactRole,
  ApplicationInterviewKind,
  ApplicationInterviewStatus,
  ApplicationOutcome,
  ApplicationStage,
  FollowUpState,
} from "@ai-career/core";

export const stageLabels: Record<ApplicationStage, string> = {
  PLANNED: "Planning to apply",
  APPLIED: "Applied",
  SCREENING: "Recruiter screen",
  INTERVIEWING: "Interviewing",
  FINAL_ROUND: "Final interview",
  OFFER: "Offer received",
  CLOSED: "Closed",
};

export const outcomeLabels: Record<ApplicationOutcome, string> = {
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_DECLINED: "Offer declined",
  REJECTED: "Rejected by employer",
  WITHDRAWN: "Withdrew application",
  NO_RESPONSE: "No response / closed",
  NOT_SUBMITTED: "Decided not to apply",
};

export const contactRoleLabels: Record<ApplicationContactRole, string> = {
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring manager",
  INTERVIEWER: "Interviewer",
  REFERRAL: "Referral",
  OTHER: "Other",
};

export const interviewKindLabels: Record<ApplicationInterviewKind, string> = {
  RECRUITER_SCREEN: "Recruiter screen",
  HIRING_MANAGER: "Hiring manager",
  TECHNICAL: "Technical",
  CASE_STUDY: "Case study / assessment",
  PANEL: "Panel",
  FINAL: "Final",
  OTHER: "Other",
};

export const interviewStatusLabels: Record<ApplicationInterviewStatus, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const followUpStateLabels: Record<FollowUpState, string> = {
  COMPLETED: "Done",
  OVERDUE: "Overdue",
  DUE_TODAY: "Due today",
  UPCOMING: "Upcoming",
  LATER: "Later",
};

// The single badge for an application: its outcome once closed, else its stage.
export function applicationStatusLabel(stage: ApplicationStage, outcome: ApplicationOutcome | null): string {
  return stage === "CLOSED" && outcome ? outcomeLabels[outcome] : stageLabels[stage];
}

const dayMs = 86_400_000;

// "today", "yesterday", "12 days ago", "in 3 days", between calendar dates.
export function relativeDays(isoDate: string, today: string): string {
  const days = Math.round(
    (new Date(`${today}T00:00:00.000Z`).getTime() - new Date(`${isoDate}T00:00:00.000Z`).getTime()) / dayMs,
  );
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  return days > 0 ? `${days} days ago` : `in ${-days} days`;
}

export function formatInstantUtc(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not scheduled" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface TimelineEventView {
  id: string;
  sequence: number;
  type: string;
  fromStage: ApplicationStage | null;
  toStage: ApplicationStage | null;
  outcome: ApplicationOutcome | null;
  occurredOn: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// One readable sentence per history event. Only stored facts are shown.
export function timelineSentence(
  event: TimelineEventView,
  names: { contacts: Record<string, string> } = { contacts: {} },
): string {
  const payload = event.payload ?? {};
  const stage = (value: ApplicationStage | null) => (value ? stageLabels[value] : "an unknown stage");
  switch (event.type) {
    case "CREATED":
      return `Started tracking (${stage(event.toStage)})`;
    case "SUBMITTED":
      return payload.source === "lifecycle"
        ? `Tracked as applied on ${event.occurredOn ?? "an unknown date"} (already marked as applied)`
        : `Application submitted on ${event.occurredOn ?? "an unknown date"}`;
    case "STAGE_CHANGED":
      return `Stage changed from ${stage(event.fromStage)} to ${stage(event.toStage)}`;
    case "CLOSED": {
      const outcome = event.outcome ? outcomeLabels[event.outcome] : "Closed";
      const reason = text(payload.reason);
      return `Closed: ${outcome} on ${event.occurredOn ?? "an unknown date"}${reason ? ` — ${reason}` : ""}`;
    }
    case "REOPENED":
      return `Reopened at ${stage(event.toStage)}`;
    case "NOTE_ADDED":
      return "Note added";
    case "NOTE_EDITED":
      return "Note edited";
    case "CONTACT_ADDED": {
      const name = names.contacts[text(payload.contactId)];
      return name ? `Contact added: ${name}` : "Contact added";
    }
    case "CONTACT_UPDATED": {
      const name = names.contacts[text(payload.contactId)];
      const fields = Array.isArray(payload.changedFields) ? payload.changedFields.join(", ") : "";
      return `Contact updated${name ? `: ${name}` : ""}${fields ? ` (${fields})` : ""}`;
    }
    case "FOLLOW_UP_ADDED":
      return `Follow-up added: ${text(payload.description)} (due ${event.occurredOn ?? "unknown"})`;
    case "FOLLOW_UP_COMPLETED":
      return `Follow-up completed: ${text(payload.description)}`;
    case "FOLLOW_UP_REOPENED":
      return `Follow-up reopened: ${text(payload.description)}`;
    case "INTERVIEW_ADDED": {
      const kind = interviewKindLabels[payload.kind as ApplicationInterviewKind] ?? "Interview";
      return `Interview added: ${kind}`;
    }
    case "INTERVIEW_UPDATED": {
      const kind = interviewKindLabels[payload.kind as ApplicationInterviewKind] ?? "Interview";
      const status = interviewStatusLabels[payload.status as ApplicationInterviewStatus];
      const previous = interviewStatusLabels[payload.previousStatus as ApplicationInterviewStatus];
      return status && previous && status !== previous
        ? `Interview ${kind}: ${previous} → ${status}`
        : `Interview updated: ${kind}`;
    }
    case "DETAILS_UPDATED":
      return payload.field === "appliedOn"
        ? `Applied date corrected from ${text(payload.previous) || "none"} to ${event.occurredOn ?? "unknown"}`
        : "Details updated";
    default:
      return "Application updated";
  }
}
