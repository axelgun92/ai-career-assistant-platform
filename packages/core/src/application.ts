import { z } from "zod";
import type { OpportunityLifecycleState } from "./opportunity";
import {
  isSystemLifecycleState,
  pendingUserActions,
  type OpportunityUserAction,
  type UserActionHistoryEntry,
} from "./opportunity-lifecycle";

// Domain-neutral application tracking rules. An Application is the user's own
// record of pursuing one Opportunity; it sits beside the Opportunity lifecycle
// and never reinterprets evaluations or recommendations.

export const applicationStageSchema = z.enum([
  "PLANNED",
  "APPLIED",
  "SCREENING",
  "INTERVIEWING",
  "FINAL_ROUND",
  "OFFER",
  "CLOSED",
]);
export type ApplicationStage = z.infer<typeof applicationStageSchema>;

export const submittedActiveStageSchema = z.enum([
  "APPLIED",
  "SCREENING",
  "INTERVIEWING",
  "FINAL_ROUND",
  "OFFER",
]);
export type SubmittedActiveStage = z.infer<typeof submittedActiveStageSchema>;
export const submittedActiveStages = submittedActiveStageSchema.options;

export const applicationOutcomeSchema = z.enum([
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "REJECTED",
  "WITHDRAWN",
  "NO_RESPONSE",
  "NOT_SUBMITTED",
]);
export type ApplicationOutcome = z.infer<typeof applicationOutcomeSchema>;
export const submittedOutcomes = [
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "REJECTED",
  "WITHDRAWN",
  "NO_RESPONSE",
] as const satisfies readonly ApplicationOutcome[];

export const applicationEventTypeSchema = z.enum([
  "CREATED",
  "SUBMITTED",
  "STAGE_CHANGED",
  "CLOSED",
  "REOPENED",
  "NOTE_ADDED",
  "NOTE_EDITED",
  "CONTACT_ADDED",
  "CONTACT_UPDATED",
  "FOLLOW_UP_ADDED",
  "FOLLOW_UP_COMPLETED",
  "FOLLOW_UP_REOPENED",
  "INTERVIEW_ADDED",
  "INTERVIEW_UPDATED",
  "DETAILS_UPDATED",
]);
export type ApplicationEventType = z.infer<typeof applicationEventTypeSchema>;

export const applicationContactRoleSchema = z.enum([
  "RECRUITER",
  "HIRING_MANAGER",
  "INTERVIEWER",
  "REFERRAL",
  "OTHER",
]);
export type ApplicationContactRole = z.infer<typeof applicationContactRoleSchema>;

export const applicationInterviewKindSchema = z.enum([
  "RECRUITER_SCREEN",
  "HIRING_MANAGER",
  "TECHNICAL",
  "CASE_STUDY",
  "PANEL",
  "FINAL",
  "OTHER",
]);
export type ApplicationInterviewKind = z.infer<typeof applicationInterviewKindSchema>;

export const applicationInterviewStatusSchema = z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]);
export type ApplicationInterviewStatus = z.infer<typeof applicationInterviewStatusSchema>;

export type RuleResult = { allowed: true } | { allowed: false; reason: string };

const allowed: RuleResult = { allowed: true };
const refuse = (reason: string): RuleResult => ({ allowed: false, reason });

// ---- Calendar dates -------------------------------------------------------
// Application dates are calendar dates (YYYY-MM-DD). "Today" is the UTC
// calendar date; a product time-zone setting can replace it later.

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const isoDateSchema = z.string().refine(isIsoDate, "Must be a valid date (YYYY-MM-DD)");

export function toIsoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function utcToday(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

// ---- Stage and outcome rules ---------------------------------------------

export function isSubmittedActiveStage(stage: ApplicationStage): stage is SubmittedActiveStage {
  return (submittedActiveStages as readonly string[]).includes(stage);
}

export function isSubmittedOutcome(outcome: ApplicationOutcome | null): boolean {
  return outcome !== null && (submittedOutcomes as readonly string[]).includes(outcome);
}

// Submitted means the user actually sent the application: a submitted active
// stage, or a closed application whose outcome followed a submission.
export function isSubmitted(stage: ApplicationStage, outcome: ApplicationOutcome | null): boolean {
  return isSubmittedActiveStage(stage) || (stage === "CLOSED" && isSubmittedOutcome(outcome));
}

export function isActiveApplication(stage: ApplicationStage): boolean {
  return stage !== "CLOSED";
}

// Whether appliedOn must be set (true) or must be empty (false). Mirrors the
// database constraint "Application_applied_on_matches_stage".
export function appliedOnRequired(stage: ApplicationStage, outcome: ApplicationOutcome | null): boolean {
  return isSubmitted(stage, outcome);
}

// The full shape check (stage, outcome, closedOn and appliedOn together),
// matching the three database constraints on Application.
export function applicationShapeIsValid(input: {
  stage: ApplicationStage;
  outcome: ApplicationOutcome | null;
  appliedOn: string | null;
  closedOn: string | null;
}): boolean {
  const closed = input.stage === "CLOSED";
  if (closed !== (input.outcome !== null)) return false;
  if (closed !== (input.closedOn !== null)) return false;
  return appliedOnRequired(input.stage, input.outcome) === (input.appliedOn !== null);
}

export function canChangeStage(from: ApplicationStage, to: ApplicationStage): RuleResult {
  if (from === to) return refuse("The application is already at that stage");
  if (from === "CLOSED") return refuse("Reopen the application before changing its stage");
  if (from === "PLANNED") return refuse("Record the submission before moving the application forward");
  if (!isSubmittedActiveStage(to)) {
    return to === "PLANNED"
      ? refuse("A submitted application cannot return to planning")
      : refuse("Close the application with an outcome instead");
  }
  return allowed;
}

export function canClose(stage: ApplicationStage, outcome: ApplicationOutcome): RuleResult {
  if (stage === "CLOSED") return refuse("The application is already closed");
  if (stage === "PLANNED") {
    return outcome === "NOT_SUBMITTED"
      ? allowed
      : refuse("An application that was never submitted can only be closed as 'Decided not to apply'");
  }
  if (outcome === "NOT_SUBMITTED") return refuse("A submitted application cannot be closed as 'Decided not to apply'");
  if ((outcome === "OFFER_ACCEPTED" || outcome === "OFFER_DECLINED") && stage !== "OFFER") {
    return refuse("Offer outcomes need the application to be at the offer stage");
  }
  return allowed;
}

// The stage a closed application returns to: the stage it held when it was
// last closed, read from its own history.
export function reopenTarget(
  events: ReadonlyArray<{ type: ApplicationEventType; fromStage: ApplicationStage | null; sequence: number }>,
): ApplicationStage | null {
  const lastClose = [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((event) => event.type === "CLOSED")
    .at(-1);
  const stage = lastClose?.fromStage ?? null;
  return stage && stage !== "CLOSED" ? stage : null;
}

// ---- Lifecycle interaction ---------------------------------------------

export type ApplicationCreationMode = "plan" | "submitted";

// Which kinds of application may be created for an Opportunity in this
// lifecycle state. An already-APPLIED Opportunity can only be tracked as
// submitted; dismissed, archived, closed, and unnormalized ones not at all.
export function applicationCreationModes(status: OpportunityLifecycleState): ApplicationCreationMode[] {
  if (status === "SAVED" || isSystemLifecycleState(status)) return ["plan", "submitted"];
  if (status === "APPLIED") return ["submitted"];
  return [];
}

export type ApplicationRefusalCode = "APPLICATION_ALREADY_SUBMITTED" | "OPPORTUNITY_NOT_TRACKABLE";

// Why a PLANNED (or submitted) application may not exist for this lifecycle
// state, or null when it may.
export function creationRefusal(
  status: OpportunityLifecycleState,
  mode: ApplicationCreationMode,
): ApplicationRefusalCode | null {
  if (applicationCreationModes(status).includes(mode)) return null;
  return status === "APPLIED" && mode === "plan" ? "APPLICATION_ALREADY_SUBMITTED" : "OPPORTUNITY_NOT_TRACKABLE";
}

// Reopening to PLANNED re-creates a planned application, so it needs the
// same lifecycle permission as creating one.
export function reopenRefusal(
  target: ApplicationStage,
  status: OpportunityLifecycleState,
): ApplicationRefusalCode | null {
  return target === "PLANNED" ? creationRefusal(status, "plan") : null;
}

// The MARK_APPLIED action that put an APPLIED Opportunity into that state,
// using the same undo stack as RESTORE. Null when the history does not show
// one (for example, seeded data); history is only read, never changed.
export function effectiveAppliedAction<Entry extends UserActionHistoryEntry>(
  history: readonly Entry[],
): Entry | null {
  const top = pendingUserActions(history).at(-1);
  return top && top.action === "MARK_APPLIED" && top.toStatus === "APPLIED" ? top : null;
}

// Product guard: lifecycle actions that would contradict the application.
export function lifecycleActionGuard(
  action: OpportunityUserAction,
  currentStatus: OpportunityLifecycleState,
  application: { stage: ApplicationStage; outcome: ApplicationOutcome | null } | null,
): RuleResult {
  if (!application) return allowed;
  const submitted = isSubmitted(application.stage, application.outcome);
  switch (action) {
    case "RESTORE":
      return currentStatus === "APPLIED" && submitted
        ? refuse("This opportunity has a submitted application; restoring it would contradict the application record")
        : allowed;
    case "DISMISS":
      return isActiveApplication(application.stage)
        ? refuse("Close the application first, for example as 'Decided not to apply'")
        : allowed;
    case "MARK_APPLIED":
      if (submitted) return allowed;
      return application.stage === "PLANNED"
        ? refuse("Record the submission in the Application section")
        : refuse("This application was closed as 'Decided not to apply'; reopen it first and record the submission there");
    default:
      return allowed;
  }
}

// ---- Follow-ups ------------------------------------------------------------

export type FollowUpState = "COMPLETED" | "OVERDUE" | "DUE_TODAY" | "UPCOMING" | "LATER";
export const upcomingWindowDays = 7;

export function followUpState(dueOn: string, completedAt: Date | string | null, today: string): FollowUpState {
  if (completedAt) return "COMPLETED";
  if (dueOn < today) return "OVERDUE";
  if (dueOn === today) return "DUE_TODAY";
  if (dueOn <= addDays(today, upcomingWindowDays)) return "UPCOMING";
  return "LATER";
}

// ---- Input schemas ---------------------------------------------------------

const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional()).transform((value) => value ?? null);

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const optionalHttpUrl = z
  .preprocess(
    blankToNull,
    z.string().trim().max(2000).refine(isSafeHttpUrl, "Must be an http or https link").nullable().optional(),
  )
  .transform((value) => value ?? null);

const optionalEmail = z
  .preprocess(blankToNull, z.email("Must be a valid email address").max(320).nullable().optional())
  .transform((value) => value ?? null);

export const noteBodySchema = z
  .string()
  .max(10_000, "Notes are limited to 10,000 characters")
  .refine((value) => value.trim().length > 0, "Write something first");

export const contactFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  role: applicationContactRoleSchema,
  title: optionalText(200),
  organization: optionalText(200),
  email: optionalEmail,
  profileUrl: optionalHttpUrl,
  notes: optionalText(2000),
});
export type ContactFields = z.output<typeof contactFieldsSchema>;

const optionalInstant = z
  .preprocess(blankToNull, z.iso.datetime({ offset: true, local: true }).nullable().optional())
  .transform((value) => (value ? new Date(value) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), "Must be a valid date and time");

export const interviewFieldsSchema = z.object({
  kind: applicationInterviewKindSchema,
  roundLabel: optionalText(120),
  scheduledAt: optionalInstant,
  status: applicationInterviewStatusSchema.default("SCHEDULED"),
  contactId: z.preprocess(blankToNull, z.uuid().nullable().optional()).transform((value) => value ?? null),
  notes: optionalText(2000),
});
export type InterviewFields = z.output<typeof interviewFieldsSchema>;

export const followUpFieldsSchema = z.object({
  description: z.string().trim().min(1, "Describe the follow-up").max(500),
  dueOn: isoDateSchema,
});

export const expectedVersionSchema = z.number().int().min(1);

// Creating an application. "plan" never carries a date; "submitted" may omit
// it, and the server resolves one so the stored submission always has a date.
export const createApplicationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("plan") }).strict(),
  z.object({ mode: z.literal("submitted"), appliedOn: isoDateSchema.optional() }).strict(),
]);
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

// Every command that updates an existing entity requires expectedVersion;
// additive commands (add*) do not accept one (strict objects reject it).
export const applicationCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("submit"), expectedVersion: expectedVersionSchema, appliedOn: isoDateSchema }).strict(),
  z.object({ command: z.literal("changeStage"), expectedVersion: expectedVersionSchema, stage: submittedActiveStageSchema }).strict(),
  z
    .object({
      command: z.literal("close"),
      expectedVersion: expectedVersionSchema,
      outcome: applicationOutcomeSchema,
      closedOn: isoDateSchema.optional(),
      reason: optionalText(1000),
    })
    .strict(),
  z.object({ command: z.literal("reopen"), expectedVersion: expectedVersionSchema }).strict(),
  z.object({ command: z.literal("correctAppliedOn"), expectedVersion: expectedVersionSchema, appliedOn: isoDateSchema }).strict(),
  z.object({ command: z.literal("addNote"), body: noteBodySchema }).strict(),
  z.object({ command: z.literal("editNote"), noteId: z.uuid(), expectedVersion: expectedVersionSchema, body: noteBodySchema }).strict(),
  contactFieldsSchema.extend({ command: z.literal("addContact") }).strict(),
  contactFieldsSchema
    .extend({ command: z.literal("updateContact"), contactId: z.uuid(), expectedVersion: expectedVersionSchema })
    .strict(),
  followUpFieldsSchema.extend({ command: z.literal("addFollowUp") }).strict(),
  z.object({ command: z.literal("completeFollowUp"), followUpId: z.uuid(), expectedVersion: expectedVersionSchema }).strict(),
  z.object({ command: z.literal("reopenFollowUp"), followUpId: z.uuid(), expectedVersion: expectedVersionSchema }).strict(),
  interviewFieldsSchema.extend({ command: z.literal("addInterview") }).strict(),
  interviewFieldsSchema
    .extend({ command: z.literal("updateInterview"), interviewId: z.uuid(), expectedVersion: expectedVersionSchema })
    .strict(),
]);
export type ApplicationCommand = z.output<typeof applicationCommandSchema>;
export type ApplicationCommandName = ApplicationCommand["command"];

export const versionedApplicationCommands = [
  "submit",
  "changeStage",
  "close",
  "reopen",
  "correctAppliedOn",
  "editNote",
  "updateContact",
  "completeFollowUp",
  "reopenFollowUp",
  "updateInterview",
] as const satisfies readonly ApplicationCommandName[];

export const additiveApplicationCommands = [
  "addNote",
  "addContact",
  "addFollowUp",
  "addInterview",
] as const satisfies readonly ApplicationCommandName[];
