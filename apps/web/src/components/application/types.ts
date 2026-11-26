import type {
  ApplicationContactRole,
  ApplicationInterviewKind,
  ApplicationInterviewStatus,
  ApplicationOutcome,
  ApplicationStage,
} from "@ai-career/core";
import type { ApplicationDetail } from "@ai-career/database";
import type { TimelineEventView } from "./labels";

// Plain, serializable application data for client components.
export interface ApplicationView {
  id: string;
  opportunityId: string;
  stage: ApplicationStage;
  outcome: ApplicationOutcome | null;
  appliedOn: string | null;
  closedOn: string | null;
  version: number;
  notes: Array<{ id: string; body: string; version: number; createdAt: string; editedAt: string | null }>;
  contacts: Array<{
    id: string;
    name: string;
    role: ApplicationContactRole;
    title: string | null;
    organization: string | null;
    email: string | null;
    profileUrl: string | null;
    notes: string | null;
    version: number;
  }>;
  followUps: Array<{ id: string; description: string; dueOn: string; completedAt: string | null; version: number }>;
  interviews: Array<{
    id: string;
    kind: ApplicationInterviewKind;
    roundLabel: string | null;
    scheduledAt: string | null;
    status: ApplicationInterviewStatus;
    contactId: string | null;
    notes: string | null;
    version: number;
  }>;
  events: TimelineEventView[];
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function toApplicationView(detail: ApplicationDetail): ApplicationView {
  return {
    id: detail.id,
    opportunityId: detail.opportunityId,
    stage: detail.stage,
    outcome: detail.outcome,
    appliedOn: detail.appliedOn,
    closedOn: detail.closedOn,
    version: detail.version,
    notes: detail.notes.map((note) => ({ ...note, createdAt: note.createdAt.toISOString(), editedAt: iso(note.editedAt) })),
    contacts: detail.contacts.map(({ createdAt: _createdAt, ...contact }) => contact),
    followUps: detail.followUps.map(({ createdAt: _createdAt, ...followUp }) => ({
      ...followUp,
      completedAt: iso(followUp.completedAt),
    })),
    interviews: detail.interviews.map(({ createdAt: _createdAt, ...interview }) => ({
      ...interview,
      scheduledAt: iso(interview.scheduledAt),
    })),
    events: detail.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}
