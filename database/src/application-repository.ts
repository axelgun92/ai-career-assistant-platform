import {
  applicationShapeIsValid,
  canChangeStage,
  canClose,
  creationRefusal,
  effectiveAppliedAction,
  isSubmitted,
  lifecycleActionGuard,
  reopenRefusal,
  reopenTarget,
  toIsoDate,
  utcToday,
  type ApplicationContactRole,
  type ApplicationEventType,
  type ApplicationInterviewKind,
  type ApplicationInterviewStatus,
  type ApplicationOutcome,
  type ApplicationStage,
  type ContactFields,
  type CreateApplicationInput,
  type InterviewFields,
  type OpportunityLifecycleState,
  type OpportunityUserAction,
  type SubmittedActiveStage,
} from "@ai-career/core";
import { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";
import {
  applyUserActionInTransaction,
  loadUserActionHistory,
  type UserActionResult,
} from "./opportunity-lifecycle-repository";

type Transaction = Prisma.TransactionClient;

export type ApplicationErrorCode =
  | "OPPORTUNITY_NOT_FOUND"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_EXISTS"
  | "APPLICATION_ALREADY_SUBMITTED"
  | "OPPORTUNITY_NOT_TRACKABLE"
  | "OPPORTUNITY_ARCHIVED"
  | "APPLICATION_CHANGED"
  | "APPLIED_DATE_NOT_APPLICABLE"
  | "APPLICATION_TRANSITION_NOT_ALLOWED"
  | "APPLICATION_ITEM_NOT_FOUND"
  | "CONTACT_NOT_IN_APPLICATION";

export type ApplicationEntity = "application" | "note" | "contact" | "followUp" | "interview";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

const changed = (entity: ApplicationEntity, id: string) =>
  new ApplicationError(
    "APPLICATION_CHANGED",
    "This application changed since you loaded it. Load the latest version and try again.",
    { entity, id },
  );

export interface ApplicationNoteView {
  id: string;
  body: string;
  version: number;
  createdAt: Date;
  editedAt: Date | null;
}

export interface ApplicationContactView {
  id: string;
  name: string;
  role: ApplicationContactRole;
  title: string | null;
  organization: string | null;
  email: string | null;
  profileUrl: string | null;
  notes: string | null;
  version: number;
  createdAt: Date;
}

export interface ApplicationFollowUpView {
  id: string;
  description: string;
  dueOn: string;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
}

export interface ApplicationInterviewView {
  id: string;
  kind: ApplicationInterviewKind;
  roundLabel: string | null;
  scheduledAt: Date | null;
  status: ApplicationInterviewStatus;
  contactId: string | null;
  notes: string | null;
  version: number;
  createdAt: Date;
}

export interface ApplicationEventView {
  id: string;
  sequence: number;
  type: ApplicationEventType;
  fromStage: ApplicationStage | null;
  toStage: ApplicationStage | null;
  outcome: ApplicationOutcome | null;
  occurredOn: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ApplicationDetail {
  id: string;
  opportunityId: string;
  stage: ApplicationStage;
  outcome: ApplicationOutcome | null;
  appliedOn: string | null;
  closedOn: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  notes: ApplicationNoteView[];
  contacts: ApplicationContactView[];
  followUps: ApplicationFollowUpView[];
  interviews: ApplicationInterviewView[];
  events: ApplicationEventView[];
}

export interface ApplicationTrackingContext {
  opportunityStatus: OpportunityLifecycleState;
  // The UTC date of the MARK_APPLIED action behind an APPLIED lifecycle.
  effectiveAppliedOn: string | null;
}

export type GuardedUserActionResult =
  | UserActionResult
  | { status: "BLOCKED_BY_APPLICATION"; reason: string };

const toDbDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const fromDbDate = (date: Date | null) => (date ? toIsoDate(date) : null);

const detailInclude = {
  notes: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  contacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  followUps: { orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
  interviews: { orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] },
  events: { orderBy: { sequence: "asc" } },
} satisfies Prisma.ApplicationInclude;

type DetailRow = Prisma.ApplicationGetPayload<{ include: typeof detailInclude }>;

function toDetail(row: DetailRow): ApplicationDetail {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    stage: row.stage,
    outcome: row.outcome,
    appliedOn: fromDbDate(row.appliedOn),
    closedOn: fromDbDate(row.closedOn),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    notes: row.notes.map((note) => ({
      id: note.id,
      body: note.body,
      version: note.version,
      createdAt: note.createdAt,
      editedAt: note.editedAt,
    })),
    contacts: row.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      title: contact.title,
      organization: contact.organization,
      email: contact.email,
      profileUrl: contact.profileUrl,
      notes: contact.notes,
      version: contact.version,
      createdAt: contact.createdAt,
    })),
    followUps: row.followUps.map((followUp) => ({
      id: followUp.id,
      description: followUp.description,
      dueOn: toIsoDate(followUp.dueOn),
      completedAt: followUp.completedAt,
      version: followUp.version,
      createdAt: followUp.createdAt,
    })),
    interviews: row.interviews.map((interview) => ({
      id: interview.id,
      kind: interview.kind,
      roundLabel: interview.roundLabel,
      scheduledAt: interview.scheduledAt,
      status: interview.status,
      contactId: interview.contactId,
      notes: interview.notes,
      version: interview.version,
      createdAt: interview.createdAt,
    })),
    events: row.events.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      type: event.type,
      fromStage: event.fromStage,
      toStage: event.toStage,
      outcome: event.outcome,
      occurredOn: fromDbDate(event.occurredOn),
      payload: (event.payload as Record<string, unknown> | null) ?? null,
      createdAt: event.createdAt,
    })),
  };
}

// Every application write and every guarded lifecycle action takes this row
// lock first, so they serialize per Opportunity.
async function lockOpportunity(transaction: Transaction, opportunityId: string) {
  const rows = await transaction.$queryRaw<Array<{ status: OpportunityLifecycleState }>>`
    SELECT "status"::text AS "status" FROM "Opportunity" WHERE "id" = ${opportunityId}::uuid FOR UPDATE`;
  return rows[0]?.status ?? null;
}

// Allocates the next event sequence (strict and gap-free within one
// application) and appends the event. Only called after the guarded change
// succeeded inside the same transaction.
async function appendEvent(
  transaction: Transaction,
  applicationId: string,
  event: {
    type: ApplicationEventType;
    fromStage?: ApplicationStage | null;
    toStage?: ApplicationStage | null;
    outcome?: ApplicationOutcome | null;
    occurredOn?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  const rows = await transaction.$queryRaw<Array<{ sequence: number }>>`
    UPDATE "Application" SET "lastEventSequence" = "lastEventSequence" + 1
    WHERE "id" = ${applicationId}::uuid
    RETURNING "lastEventSequence" AS "sequence"`;
  const sequence = rows[0]?.sequence;
  if (sequence === undefined) throw new ApplicationError("APPLICATION_NOT_FOUND", "Application not found");
  await transaction.applicationEvent.create({
    data: {
      applicationId,
      sequence,
      type: event.type,
      fromStage: event.fromStage ?? null,
      toStage: event.toStage ?? null,
      outcome: event.outcome ?? null,
      occurredOn: event.occurredOn ? toDbDate(event.occurredOn) : null,
      payload: event.payload ? (event.payload as Prisma.InputJsonObject) : Prisma.DbNull,
    },
  });
}

function assertShape(input: {
  stage: ApplicationStage;
  outcome: ApplicationOutcome | null;
  appliedOn: string | null;
  closedOn: string | null;
}) {
  // The service-side mirror of the database constraints; reaching this is a
  // bug, and the transaction rolls back.
  if (!applicationShapeIsValid(input)) {
    throw new Error("Application state would violate the stage/outcome/date invariant");
  }
}

const notAllowed = (reason: string) => new ApplicationError("APPLICATION_TRANSITION_NOT_ALLOWED", reason);

// Only the persisted fields, whatever else the caller's object carries.
function contactFields(input: ContactFields): ContactFields {
  return {
    name: input.name,
    role: input.role,
    title: input.title,
    organization: input.organization,
    email: input.email,
    profileUrl: input.profileUrl,
    notes: input.notes,
  };
}

function interviewFields(input: InterviewFields): InterviewFields {
  return {
    kind: input.kind,
    roundLabel: input.roundLabel,
    scheduledAt: input.scheduledAt,
    status: input.status,
    contactId: input.contactId,
    notes: input.notes,
  };
}

function contactChanges(before: ContactFields, after: ContactFields) {
  return (Object.keys(after) as Array<keyof ContactFields>).filter((key) => before[key] !== after[key]);
}

export class PrismaApplicationRepository {
  private readonly database = getDatabaseClient();

  private transaction<T>(work: (transaction: Transaction) => Promise<T>) {
    return this.database.$transaction(work, { maxWait: 15_000, timeout: 30_000 });
  }

  private async loadDetail(client: Transaction | ReturnType<typeof getDatabaseClient>, where: Prisma.ApplicationWhereUniqueInput) {
    const row = await client.application.findUnique({ where, include: detailInclude });
    return row ? toDetail(row) : null;
  }

  async getDetail(applicationId: string): Promise<ApplicationDetail | null> {
    return this.loadDetail(this.database, { id: applicationId });
  }

  async getByOpportunity(opportunityId: string): Promise<ApplicationDetail | null> {
    return this.loadDetail(this.database, { opportunityId });
  }

  async trackingContext(opportunityId: string): Promise<ApplicationTrackingContext | null> {
    const opportunity = await this.database.opportunity.findUnique({
      where: { id: opportunityId },
      select: { status: true },
    });
    if (!opportunity) return null;
    const action = opportunity.status === "APPLIED"
      ? effectiveAppliedAction(await loadUserActionHistory(this.database, opportunityId))
      : null;
    return {
      opportunityStatus: opportunity.status,
      effectiveAppliedOn: action ? toIsoDate(action.createdAt) : null,
    };
  }

  async create(
    opportunityId: string,
    input: CreateApplicationInput,
    today: string = utcToday(),
  ): Promise<ApplicationDetail> {
    try {
      return await this.transaction(async (transaction) => {
        const status = await lockOpportunity(transaction, opportunityId);
        if (!status) throw new ApplicationError("OPPORTUNITY_NOT_FOUND", "Opportunity not found");
        const existing = await transaction.application.findUnique({ where: { opportunityId }, select: { id: true } });
        if (existing) {
          throw new ApplicationError("APPLICATION_EXISTS", "This opportunity already has an application", {
            applicationId: existing.id,
          });
        }
        const refusal = creationRefusal(status, input.mode);
        if (refusal === "APPLICATION_ALREADY_SUBMITTED") {
          throw new ApplicationError(
            refusal,
            "This opportunity is already marked as applied. Track it as a submitted application.",
          );
        }
        if (refusal) {
          throw new ApplicationError(refusal, "Restore the opportunity before tracking an application for it");
        }

        if (input.mode === "plan") {
          assertShape({ stage: "PLANNED", outcome: null, appliedOn: null, closedOn: null });
          const application = await transaction.application.create({
            data: { opportunityId, stage: "PLANNED" },
            select: { id: true },
          });
          await appendEvent(transaction, application.id, { type: "CREATED", toStage: "PLANNED" });
          return (await this.loadDetail(transaction, { id: application.id }))!;
        }

        // A submission always has a date: the one given, else the date of the
        // MARK_APPLIED behind an APPLIED lifecycle, else today.
        let appliedOn = input.appliedOn ?? null;
        let lifecycleAction: OpportunityUserAction | null = null;
        if (status === "APPLIED") {
          if (!appliedOn) {
            const action = effectiveAppliedAction(await loadUserActionHistory(transaction, opportunityId));
            appliedOn = action ? toIsoDate(action.createdAt) : null;
          }
        } else {
          const result = await applyUserActionInTransaction(transaction, { opportunityId, action: "MARK_APPLIED" });
          if (result.status !== "APPLIED") {
            throw new ApplicationError("OPPORTUNITY_NOT_TRACKABLE", "The opportunity could not be marked as applied");
          }
          lifecycleAction = "MARK_APPLIED";
        }
        appliedOn ??= today;
        assertShape({ stage: "APPLIED", outcome: null, appliedOn, closedOn: null });
        const application = await transaction.application.create({
          data: { opportunityId, stage: "APPLIED", appliedOn: toDbDate(appliedOn) },
          select: { id: true },
        });
        await appendEvent(transaction, application.id, { type: "CREATED", toStage: "APPLIED" });
        await appendEvent(transaction, application.id, {
          type: "SUBMITTED",
          toStage: "APPLIED",
          occurredOn: appliedOn,
          payload: { source: status === "APPLIED" ? "lifecycle" : "tracker", lifecycleAction },
        });
        return (await this.loadDetail(transaction, { id: application.id }))!;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.database.application.findUnique({ where: { opportunityId }, select: { id: true } });
        throw new ApplicationError("APPLICATION_EXISTS", "This opportunity already has an application", {
          ...(existing ? { applicationId: existing.id } : {}),
        });
      }
      throw error;
    }
  }

  // Runs one application command: lock the Opportunity row, refuse writes
  // while archived, then work on the freshly read application. Any thrown
  // error rolls back every write, including event sequence allocation.
  private async command(
    applicationId: string,
    work: (context: {
      transaction: Transaction;
      application: { id: string; stage: ApplicationStage; outcome: ApplicationOutcome | null; appliedOn: string | null; closedOn: string | null; version: number };
      status: OpportunityLifecycleState;
    }) => Promise<void>,
  ): Promise<ApplicationDetail> {
    return this.transaction(async (transaction) => {
      const reference = await transaction.application.findUnique({
        where: { id: applicationId },
        select: { opportunityId: true },
      });
      if (!reference) throw new ApplicationError("APPLICATION_NOT_FOUND", "Application not found");
      const status = await lockOpportunity(transaction, reference.opportunityId);
      if (!status) throw new ApplicationError("APPLICATION_NOT_FOUND", "Application not found");
      if (status === "ARCHIVED") {
        throw new ApplicationError(
          "OPPORTUNITY_ARCHIVED",
          "This opportunity is archived, so its application is read-only. Restore it to make changes.",
        );
      }
      const row = await transaction.application.findUniqueOrThrow({ where: { id: applicationId } });
      await work({
        transaction,
        status,
        application: {
          id: row.id,
          stage: row.stage,
          outcome: row.outcome,
          appliedOn: fromDbDate(row.appliedOn),
          closedOn: fromDbDate(row.closedOn),
          version: row.version,
        },
      });
      return (await this.loadDetail(transaction, { id: applicationId }))!;
    });
  }

  // Compare-and-set on Application.version. The version was already checked
  // under the row lock; the conditional update keeps the guarantee local.
  private async updateApplication(
    transaction: Transaction,
    applicationId: string,
    expectedVersion: number,
    data: Prisma.ApplicationUpdateManyMutationInput,
  ) {
    const result = await transaction.application.updateMany({
      where: { id: applicationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1) throw changed("application", applicationId);
  }

  async submit(applicationId: string, input: { expectedVersion: number; appliedOn: string }) {
    return this.command(applicationId, async ({ transaction, application, status }) => {
      if (application.version !== input.expectedVersion) throw changed("application", applicationId);
      if (application.stage !== "PLANNED") throw notAllowed("This application has already been submitted or closed");
      let lifecycleAction: OpportunityUserAction | null = null;
      if (status !== "APPLIED") {
        const opportunity = await transaction.application.findUniqueOrThrow({
          where: { id: applicationId },
          select: { opportunityId: true },
        });
        const result = await applyUserActionInTransaction(transaction, {
          opportunityId: opportunity.opportunityId,
          action: "MARK_APPLIED",
        });
        if (result.status !== "APPLIED") {
          throw new ApplicationError("OPPORTUNITY_NOT_TRACKABLE", "The opportunity could not be marked as applied");
        }
        lifecycleAction = "MARK_APPLIED";
      }
      assertShape({ stage: "APPLIED", outcome: null, appliedOn: input.appliedOn, closedOn: null });
      await this.updateApplication(transaction, applicationId, input.expectedVersion, {
        stage: "APPLIED",
        appliedOn: toDbDate(input.appliedOn),
      });
      await appendEvent(transaction, applicationId, {
        type: "SUBMITTED",
        fromStage: "PLANNED",
        toStage: "APPLIED",
        occurredOn: input.appliedOn,
        payload: { source: "tracker", lifecycleAction },
      });
    });
  }

  async changeStage(applicationId: string, input: { expectedVersion: number; stage: SubmittedActiveStage }) {
    return this.command(applicationId, async ({ transaction, application }) => {
      if (application.version !== input.expectedVersion) throw changed("application", applicationId);
      const rule = canChangeStage(application.stage, input.stage);
      if (!rule.allowed) throw notAllowed(rule.reason);
      assertShape({ ...application, stage: input.stage });
      await this.updateApplication(transaction, applicationId, input.expectedVersion, { stage: input.stage });
      await appendEvent(transaction, applicationId, {
        type: "STAGE_CHANGED",
        fromStage: application.stage,
        toStage: input.stage,
      });
    });
  }

  async close(
    applicationId: string,
    input: { expectedVersion: number; outcome: ApplicationOutcome; closedOn?: string; reason?: string | null },
    today: string = utcToday(),
  ) {
    return this.command(applicationId, async ({ transaction, application }) => {
      if (application.version !== input.expectedVersion) throw changed("application", applicationId);
      const rule = canClose(application.stage, input.outcome);
      if (!rule.allowed) throw notAllowed(rule.reason);
      const closedOn = input.closedOn ?? today;
      // appliedOn is never touched by closing.
      assertShape({ stage: "CLOSED", outcome: input.outcome, appliedOn: application.appliedOn, closedOn });
      await this.updateApplication(transaction, applicationId, input.expectedVersion, {
        stage: "CLOSED",
        outcome: input.outcome,
        closedOn: toDbDate(closedOn),
      });
      await appendEvent(transaction, applicationId, {
        type: "CLOSED",
        fromStage: application.stage,
        toStage: "CLOSED",
        outcome: input.outcome,
        occurredOn: closedOn,
        payload: input.reason ? { reason: input.reason } : null,
      });
    });
  }

  async reopen(applicationId: string, input: { expectedVersion: number }) {
    return this.command(applicationId, async ({ transaction, application, status }) => {
      if (application.version !== input.expectedVersion) throw changed("application", applicationId);
      if (application.stage !== "CLOSED") throw notAllowed("Only a closed application can be reopened");
      const events = await transaction.applicationEvent.findMany({
        where: { applicationId, type: "CLOSED" },
        select: { type: true, fromStage: true, sequence: true },
      });
      const target = reopenTarget(events);
      if (!target) throw notAllowed("The application history does not identify a stage to reopen to");
      const refusal = reopenRefusal(target, status);
      if (refusal === "APPLICATION_ALREADY_SUBMITTED") {
        throw new ApplicationError(
          refusal,
          "This opportunity is already marked as applied, so the application cannot return to planning",
        );
      }
      if (refusal) throw new ApplicationError(refusal, "Restore the opportunity before reopening this plan");
      // appliedOn is never touched by reopening: NULL for a plan, the original
      // submission date otherwise.
      assertShape({ stage: target, outcome: null, appliedOn: application.appliedOn, closedOn: null });
      await this.updateApplication(transaction, applicationId, input.expectedVersion, {
        stage: target,
        outcome: null,
        closedOn: null,
      });
      await appendEvent(transaction, applicationId, {
        type: "REOPENED",
        fromStage: "CLOSED",
        toStage: target,
        payload: { previousOutcome: application.outcome, previousClosedOn: application.closedOn },
      });
    });
  }

  async correctAppliedOn(applicationId: string, input: { expectedVersion: number; appliedOn: string }) {
    return this.command(applicationId, async ({ transaction, application }) => {
      if (application.version !== input.expectedVersion) throw changed("application", applicationId);
      if (!isSubmitted(application.stage, application.outcome)) {
        throw new ApplicationError(
          "APPLIED_DATE_NOT_APPLICABLE",
          "This application was never submitted, so it has no applied date",
        );
      }
      if (application.appliedOn === input.appliedOn) throw notAllowed("The applied date is already set to that day");
      assertShape({ ...application, appliedOn: input.appliedOn });
      await this.updateApplication(transaction, applicationId, input.expectedVersion, {
        appliedOn: toDbDate(input.appliedOn),
      });
      await appendEvent(transaction, applicationId, {
        type: "DETAILS_UPDATED",
        occurredOn: input.appliedOn,
        payload: { field: "appliedOn", previous: application.appliedOn },
      });
    });
  }

  async addNote(applicationId: string, input: { body: string }) {
    return this.command(applicationId, async ({ transaction }) => {
      const note = await transaction.applicationNote.create({
        data: { applicationId, body: input.body },
        select: { id: true },
      });
      await appendEvent(transaction, applicationId, { type: "NOTE_ADDED", payload: { noteId: note.id } });
    });
  }

  async editNote(applicationId: string, input: { noteId: string; expectedVersion: number; body: string }) {
    return this.command(applicationId, async ({ transaction }) => {
      const note = await transaction.applicationNote.findFirst({
        where: { id: input.noteId, applicationId },
        select: { body: true, version: true },
      });
      if (!note) throw new ApplicationError("APPLICATION_ITEM_NOT_FOUND", "Note not found");
      if (note.version !== input.expectedVersion) throw changed("note", input.noteId);
      if (note.body === input.body) throw notAllowed("The note is unchanged");
      const result = await transaction.applicationNote.updateMany({
        where: { id: input.noteId, applicationId, version: input.expectedVersion },
        data: { body: input.body, editedAt: new Date(), version: { increment: 1 } },
      });
      if (result.count !== 1) throw changed("note", input.noteId);
      await appendEvent(transaction, applicationId, {
        type: "NOTE_EDITED",
        payload: { noteId: input.noteId, previousBody: note.body },
      });
    });
  }

  async addContact(applicationId: string, input: ContactFields) {
    return this.command(applicationId, async ({ transaction }) => {
      const contact = await transaction.applicationContact.create({
        data: { applicationId, ...contactFields(input) },
        select: { id: true },
      });
      await appendEvent(transaction, applicationId, {
        type: "CONTACT_ADDED",
        payload: { contactId: contact.id, role: input.role },
      });
    });
  }

  async updateContact(applicationId: string, input: ContactFields & { contactId: string; expectedVersion: number }) {
    return this.command(applicationId, async ({ transaction }) => {
      const contact = await transaction.applicationContact.findFirst({
        where: { id: input.contactId, applicationId },
      });
      if (!contact) throw new ApplicationError("APPLICATION_ITEM_NOT_FOUND", "Contact not found");
      if (contact.version !== input.expectedVersion) throw changed("contact", input.contactId);
      const { contactId, expectedVersion } = input;
      const fields = contactFields(input);
      const changedFields = contactChanges(contact, fields);
      if (changedFields.length === 0) throw notAllowed("The contact is unchanged");
      const result = await transaction.applicationContact.updateMany({
        where: { id: contactId, applicationId, version: expectedVersion },
        data: { ...fields, version: { increment: 1 } },
      });
      if (result.count !== 1) throw changed("contact", contactId);
      // Field names only: contact details are not copied into history.
      await appendEvent(transaction, applicationId, {
        type: "CONTACT_UPDATED",
        payload: { contactId, changedFields },
      });
    });
  }

  async addFollowUp(applicationId: string, input: { description: string; dueOn: string }) {
    return this.command(applicationId, async ({ transaction }) => {
      const followUp = await transaction.applicationFollowUp.create({
        data: { applicationId, description: input.description, dueOn: toDbDate(input.dueOn) },
        select: { id: true },
      });
      await appendEvent(transaction, applicationId, {
        type: "FOLLOW_UP_ADDED",
        occurredOn: input.dueOn,
        payload: { followUpId: followUp.id, description: input.description },
      });
    });
  }

  private async setFollowUpCompletion(
    applicationId: string,
    input: { followUpId: string; expectedVersion: number },
    complete: boolean,
  ) {
    return this.command(applicationId, async ({ transaction }) => {
      const followUp = await transaction.applicationFollowUp.findFirst({
        where: { id: input.followUpId, applicationId },
        select: { completedAt: true, version: true, description: true },
      });
      if (!followUp) throw new ApplicationError("APPLICATION_ITEM_NOT_FOUND", "Follow-up not found");
      if (followUp.version !== input.expectedVersion) throw changed("followUp", input.followUpId);
      if (complete === (followUp.completedAt !== null)) {
        throw notAllowed(complete ? "This follow-up is already complete" : "This follow-up is not complete");
      }
      const result = await transaction.applicationFollowUp.updateMany({
        where: { id: input.followUpId, applicationId, version: input.expectedVersion },
        data: { completedAt: complete ? new Date() : null, version: { increment: 1 } },
      });
      if (result.count !== 1) throw changed("followUp", input.followUpId);
      await appendEvent(transaction, applicationId, {
        type: complete ? "FOLLOW_UP_COMPLETED" : "FOLLOW_UP_REOPENED",
        payload: { followUpId: input.followUpId, description: followUp.description },
      });
    });
  }

  async completeFollowUp(applicationId: string, input: { followUpId: string; expectedVersion: number }) {
    return this.setFollowUpCompletion(applicationId, input, true);
  }

  async reopenFollowUp(applicationId: string, input: { followUpId: string; expectedVersion: number }) {
    return this.setFollowUpCompletion(applicationId, input, false);
  }

  private async assertContactInApplication(transaction: Transaction, applicationId: string, contactId: string | null) {
    if (!contactId) return;
    const contact = await transaction.applicationContact.findFirst({
      where: { id: contactId, applicationId },
      select: { id: true },
    });
    if (!contact) {
      throw new ApplicationError("CONTACT_NOT_IN_APPLICATION", "Choose a contact from this application");
    }
  }

  async addInterview(applicationId: string, input: InterviewFields) {
    return this.command(applicationId, async ({ transaction }) => {
      const fields = interviewFields(input);
      await this.assertContactInApplication(transaction, applicationId, fields.contactId);
      const interview = await transaction.applicationInterview.create({
        data: { applicationId, ...fields },
        select: { id: true },
      });
      await appendEvent(transaction, applicationId, {
        type: "INTERVIEW_ADDED",
        payload: { interviewId: interview.id, kind: fields.kind, status: fields.status },
      });
    });
  }

  async updateInterview(
    applicationId: string,
    input: InterviewFields & { interviewId: string; expectedVersion: number },
  ) {
    return this.command(applicationId, async ({ transaction }) => {
      const interview = await transaction.applicationInterview.findFirst({
        where: { id: input.interviewId, applicationId },
      });
      if (!interview) throw new ApplicationError("APPLICATION_ITEM_NOT_FOUND", "Interview not found");
      if (interview.version !== input.expectedVersion) throw changed("interview", input.interviewId);
      const { interviewId, expectedVersion } = input;
      const fields = interviewFields(input);
      await this.assertContactInApplication(transaction, applicationId, fields.contactId);
      const changedFields = (Object.keys(fields) as Array<keyof InterviewFields>).filter((key) => {
        const before = interview[key];
        const after = fields[key];
        return before instanceof Date || after instanceof Date
          ? (before as Date | null)?.getTime() !== (after as Date | null)?.getTime()
          : before !== after;
      });
      if (changedFields.length === 0) throw notAllowed("The interview is unchanged");
      const result = await transaction.applicationInterview.updateMany({
        where: { id: interviewId, applicationId, version: expectedVersion },
        data: { ...fields, version: { increment: 1 } },
      });
      if (result.count !== 1) throw changed("interview", interviewId);
      await appendEvent(transaction, applicationId, {
        type: "INTERVIEW_UPDATED",
        payload: {
          interviewId,
          changedFields,
          kind: fields.kind,
          status: fields.status,
          previousStatus: interview.status,
        },
      });
    });
  }

  // Applies a lifecycle action unless it would contradict the application,
  // under the same Opportunity row lock as application writes.
  async applyLifecycleActionGuarded(input: {
    opportunityId: string;
    action: OpportunityUserAction;
  }): Promise<GuardedUserActionResult> {
    return this.transaction(async (transaction) => {
      const status = await lockOpportunity(transaction, input.opportunityId);
      if (!status) return { status: "NOT_FOUND" as const };
      const application = await transaction.application.findUnique({
        where: { opportunityId: input.opportunityId },
        select: { stage: true, outcome: true },
      });
      const guard = lifecycleActionGuard(input.action, status, application);
      if (!guard.allowed) return { status: "BLOCKED_BY_APPLICATION" as const, reason: guard.reason };
      return applyUserActionInTransaction(transaction, input);
    });
  }

  async findStateForOpportunity(opportunityId: string) {
    return this.database.application.findUnique({
      where: { opportunityId },
      select: { id: true, stage: true, outcome: true },
    });
  }
}
