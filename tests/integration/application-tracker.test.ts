import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  createManualOpportunityService,
  utcToday,
  type OpportunityUserAction,
} from "@ai-career/core";
import {
  ApplicationError,
  PrismaApplicationListRepository,
  PrismaApplicationRepository,
  PrismaManualOpportunityRepository,
  PrismaOpportunityDashboardRepository,
  PrismaOpportunityLifecycleRepository,
  PrismaOpportunityListRepository,
  type ApplicationDetail,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { applicationCommandSchema } from "@ai-career/core";
import { runApplicationCommand } from "../../apps/web/src/server/application-service";
import {
  createCleanup,
  createHarness,
  createProfile,
  database,
  runWorker,
  setBudget,
} from "../support/budget-integration";

const applications = new PrismaApplicationRepository();
const lists = new PrismaApplicationListRepository();
const lifecycle = new PrismaOpportunityLifecycleRepository();
const cleanup = createCleanup();
const clock = { now: new Date() };
let token = "";

beforeEach(async () => {
  clock.now = new Date();
  token = `trk${randomUUID().slice(0, 8)}`;
  await cleanup.before();
});
afterEach(() => cleanup.after());
afterAll(() => database.$disconnect());

async function createOpportunity(label = "Customer Success Manager") {
  const detail = await createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  }).submit({
    title: `${label} ${token}`,
    company: `Tracker ${label} ${token} ${randomUUID().slice(0, 6)}`,
    location: "Remote - United States",
    compensationText: "$72,000-$88,000",
    domain: "customer-success",
    rawText: [
      `${label} at a SaaS workflow platform.`,
      "Remote. Applicants must reside in the United States.",
      "Salary $72,000-$88,000. No travel required.",
      "Own onboarding, adoption, education, retention, and business reviews.",
    ].join("\n"),
  });
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

async function act(opportunityId: string, action: OpportunityUserAction) {
  const result = await lifecycle.applyUserAction({ opportunityId, action });
  if (result.status !== "APPLIED") throw new Error(`${action} was ${result.status}`);
}

const guarded = (opportunityId: string, action: OpportunityUserAction) =>
  applications.applyLifecycleActionGuarded({ opportunityId, action });

const statusOf = async (opportunityId: string) =>
  (await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { status: true } })).status;

const actionRows = (opportunityId: string) =>
  database.opportunityUserAction.findMany({ where: { opportunityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApplicationError);
  expect((error as ApplicationError).code).toBe(code);
  return error as ApplicationError;
}

// Every application-owned row, for "nothing changed" assertions.
async function snapshot(applicationId: string) {
  const application = await database.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      events: { orderBy: { sequence: "asc" } },
      notes: { orderBy: { id: "asc" } },
      contacts: { orderBy: { id: "asc" } },
      followUps: { orderBy: { id: "asc" } },
      interviews: { orderBy: { id: "asc" } },
    },
  });
  return JSON.stringify(application);
}

function sequences(detail: ApplicationDetail) {
  return detail.events.map((event) => event.sequence);
}

function expectGapFree(detail: ApplicationDetail) {
  expect(sequences(detail)).toEqual(detail.events.map((_, index) => index + 1));
}

async function plannedApplication() {
  const opportunityId = await createOpportunity();
  await act(opportunityId, "SAVE");
  const application = await applications.create(opportunityId, { mode: "plan" });
  return { opportunityId, application };
}

async function submittedApplication(appliedOn = "2026-09-01") {
  const opportunityId = await createOpportunity();
  const application = await applications.create(opportunityId, { mode: "submitted", appliedOn });
  return { opportunityId, application };
}

describe("creating applications and the lifecycle", () => {
  it("creates a plan from a saved opportunity without touching the lifecycle", async () => {
    const opportunityId = await createOpportunity();
    await act(opportunityId, "SAVE");
    const before = await actionRows(opportunityId);
    const application = await applications.create(opportunityId, { mode: "plan" });
    expect(application).toMatchObject({ stage: "PLANNED", outcome: null, appliedOn: null, closedOn: null, version: 1 });
    expect(application.events.map((event) => event.type)).toEqual(["CREATED"]);
    expect(await statusOf(opportunityId)).toBe("SAVED");
    expect(await actionRows(opportunityId)).toEqual(before);
  });

  it("submitting moves the stage and marks the opportunity applied with exactly one MARK_APPLIED", async () => {
    const { opportunityId, application } = await plannedApplication();
    const actionsBefore = (await actionRows(opportunityId)).length;
    const submitted = await applications.submit(application.id, { expectedVersion: 1, appliedOn: "2026-10-02" });
    expect(submitted).toMatchObject({ stage: "APPLIED", appliedOn: "2026-10-02", version: 2 });
    expect(submitted.events.at(-1)).toMatchObject({
      type: "SUBMITTED",
      fromStage: "PLANNED",
      toStage: "APPLIED",
      occurredOn: "2026-10-02",
      payload: { source: "tracker", lifecycleAction: "MARK_APPLIED" },
    });
    expect(await statusOf(opportunityId)).toBe("APPLIED");
    const actions = await actionRows(opportunityId);
    expect(actions).toHaveLength(actionsBefore + 1);
    expect(actions.at(-1)).toMatchObject({ action: "MARK_APPLIED", fromStatus: "SAVED", toStatus: "APPLIED" });
    expectGapFree(submitted);
  });

  it("creates a submitted application from a system state, marking it applied in the same transaction", async () => {
    const opportunityId = await createOpportunity();
    const application = await applications.create(opportunityId, { mode: "submitted" }, "2026-10-05");
    expect(application).toMatchObject({ stage: "APPLIED", appliedOn: "2026-10-05" });
    expect(application.events.map((event) => event.type)).toEqual(["CREATED", "SUBMITTED"]);
    expect(await statusOf(opportunityId)).toBe("APPLIED");
    expect((await actionRows(opportunityId)).map((row) => row.action)).toEqual(["MARK_APPLIED"]);
  });

  it("refuses dismissed and archived opportunities", async () => {
    const dismissed = await createOpportunity();
    await act(dismissed, "DISMISS");
    await expectError(applications.create(dismissed, { mode: "plan" }), "OPPORTUNITY_NOT_TRACKABLE");
    const archived = await createOpportunity();
    await act(archived, "ARCHIVE");
    await expectError(applications.create(archived, { mode: "submitted" }), "OPPORTUNITY_NOT_TRACKABLE");
    expect(await database.application.count({ where: { opportunityId: { in: [dismissed, archived] } } })).toBe(0);
  });

  it("allows one application per opportunity, also under concurrent creation", async () => {
    const opportunityId = await createOpportunity();
    await act(opportunityId, "SAVE");
    const results = await Promise.allSettled([
      applications.create(opportunityId, { mode: "plan" }),
      applications.create(opportunityId, { mode: "plan" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ApplicationError);
    expect(rejected.reason.code).toBe("APPLICATION_EXISTS");
    expect(rejected.reason.details.applicationId).toBeTruthy();
    expect(await database.application.count({ where: { opportunityId } })).toBe(1);
  });
});

describe("existing APPLIED opportunities", () => {
  async function appliedThroughLifecycle() {
    const opportunityId = await createOpportunity();
    for (const action of ["SAVE", "MARK_APPLIED", "ARCHIVE", "RESTORE"] as const) await act(opportunityId, action);
    // Seed fixed timestamps (test data only) so the effective date is known.
    const rows = await actionRows(opportunityId);
    const stamps = ["2026-09-14T10:00:00Z", "2026-09-15T23:30:00Z", "2026-09-20T09:00:00Z", "2026-09-21T09:00:00Z"];
    for (const [index, row] of rows.entries()) {
      await database.opportunityUserAction.update({ where: { id: row.id }, data: { createdAt: new Date(stamps[index]!) } });
    }
    expect(await statusOf(opportunityId)).toBe("APPLIED");
    return opportunityId;
  }

  it("refuses a PLANNED application with a clear 409 and writes nothing", async () => {
    const opportunityId = await appliedThroughLifecycle();
    const before = await actionRows(opportunityId);
    await expectError(applications.create(opportunityId, { mode: "plan" }), "APPLICATION_ALREADY_SUBMITTED");
    expect(await database.application.count({ where: { opportunityId } })).toBe(0);
    expect(await database.applicationEvent.count({ where: { application: { opportunityId } } })).toBe(0);
    expect(await actionRows(opportunityId)).toEqual(before);
  });

  it("tracks it as submitted, dated from the MARK_APPLIED behind the current state, without new lifecycle actions", async () => {
    const opportunityId = await appliedThroughLifecycle();
    const before = await actionRows(opportunityId);
    expect(await applications.trackingContext(opportunityId)).toEqual({
      opportunityStatus: "APPLIED",
      effectiveAppliedOn: "2026-09-15",
    });
    const application = await applications.create(opportunityId, { mode: "submitted" });
    expect(application).toMatchObject({ stage: "APPLIED", appliedOn: "2026-09-15" });
    expect(application.events.at(-1)?.payload).toEqual({ source: "lifecycle", lifecycleAction: null });
    expect(await actionRows(opportunityId)).toEqual(before);
  });

  it("uses the user's adjusted date when given", async () => {
    const opportunityId = await appliedThroughLifecycle();
    const application = await applications.create(opportunityId, { mode: "submitted", appliedOn: "2026-09-16" });
    expect(application.appliedOn).toBe("2026-09-16");
  });

  it("uses the newer MARK_APPLIED after a restore and re-apply", async () => {
    const opportunityId = await createOpportunity();
    for (const action of ["MARK_APPLIED", "RESTORE", "MARK_APPLIED"] as const) await act(opportunityId, action);
    const rows = await actionRows(opportunityId);
    const stamps = ["2026-08-01T12:00:00Z", "2026-08-02T12:00:00Z", "2026-08-10T12:00:00Z"];
    for (const [index, row] of rows.entries()) {
      await database.opportunityUserAction.update({ where: { id: row.id }, data: { createdAt: new Date(stamps[index]!) } });
    }
    expect((await applications.trackingContext(opportunityId))?.effectiveAppliedOn).toBe("2026-08-10");
  });
});

describe("the appliedOn invariant", () => {
  async function rawInsert(opportunityId: string, values: { stage: string; outcome: string | null; appliedOn: string | null; closedOn: string | null }) {
    return database.$executeRaw`
      INSERT INTO "Application" ("id", "opportunityId", "stage", "outcome", "appliedOn", "closedOn", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${opportunityId}::uuid, ${values.stage}::"ApplicationStage",
        ${values.outcome}::"ApplicationOutcome", ${values.appliedOn}::date, ${values.closedOn}::date, now())`;
  }

  it("the database rejects every contradictory shape", async () => {
    const opportunityId = await createOpportunity();
    const bad = [
      { stage: "PLANNED", outcome: null, appliedOn: "2026-10-01", closedOn: null },
      { stage: "SCREENING", outcome: null, appliedOn: null, closedOn: null },
      { stage: "CLOSED", outcome: "REJECTED", appliedOn: null, closedOn: "2026-10-03" },
      { stage: "CLOSED", outcome: "NOT_SUBMITTED", appliedOn: "2026-10-01", closedOn: "2026-10-03" },
    ];
    for (const values of bad) {
      await expect(rawInsert(opportunityId, values)).rejects.toThrow(/Application_applied_on_matches_stage/);
    }
    await expect(rawInsert(opportunityId, { stage: "CLOSED", outcome: null, appliedOn: null, closedOn: "2026-10-03" }))
      .rejects.toThrow(/Application_outcome_matches_stage/);
    await expect(rawInsert(opportunityId, { stage: "APPLIED", outcome: null, appliedOn: "2026-10-01", closedOn: "2026-10-03" }))
      .rejects.toThrow(/Application_closed_on_matches_stage/);
    expect(await database.application.count({ where: { opportunityId } })).toBe(0);

    const { application } = await plannedApplication();
    await expect(database.$executeRaw`
      UPDATE "Application" SET "appliedOn" = '2026-10-01' WHERE "id" = ${application.id}::uuid`)
      .rejects.toThrow(/Application_applied_on_matches_stage/);
  });

  it("plans have no date; closing and reopening never change appliedOn", async () => {
    const { application } = await plannedApplication();
    expect(application.appliedOn).toBeNull();
    const closedPlan = await applications.close(application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED", closedOn: "2026-10-03" });
    expect(closedPlan).toMatchObject({ stage: "CLOSED", outcome: "NOT_SUBMITTED", appliedOn: null, closedOn: "2026-10-03" });
    const reopenedPlan = await applications.reopen(application.id, { expectedVersion: 2 });
    expect(reopenedPlan).toMatchObject({ stage: "PLANNED", outcome: null, appliedOn: null, closedOn: null });

    const submitted = await submittedApplication("2026-09-01");
    expect(submitted.application.appliedOn).toBe("2026-09-01");
    await applications.changeStage(submitted.application.id, { expectedVersion: 1, stage: "SCREENING" });
    const rejected = await applications.close(submitted.application.id, { expectedVersion: 2, outcome: "REJECTED" }, "2026-10-04");
    expect(rejected).toMatchObject({ stage: "CLOSED", outcome: "REJECTED", appliedOn: "2026-09-01", closedOn: "2026-10-04" });
    const reopened = await applications.reopen(submitted.application.id, { expectedVersion: 3 });
    expect(reopened).toMatchObject({ stage: "SCREENING", appliedOn: "2026-09-01", outcome: null, closedOn: null });
  });

  it("refuses an applied-date correction on never-submitted applications, with no trace", async () => {
    const { application } = await plannedApplication();
    const before = await snapshot(application.id);
    await expectError(
      applications.correctAppliedOn(application.id, { expectedVersion: 1, appliedOn: "2026-10-01" }),
      "APPLIED_DATE_NOT_APPLICABLE",
    );
    expect(await snapshot(application.id)).toBe(before);
    await applications.close(application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED" });
    const closed = await snapshot(application.id);
    await expectError(
      applications.correctAppliedOn(application.id, { expectedVersion: 2, appliedOn: "2026-10-01" }),
      "APPLIED_DATE_NOT_APPLICABLE",
    );
    expect(await snapshot(application.id)).toBe(closed);
  });

  it("corrects the applied date of a submitted application as a new event", async () => {
    const { application } = await submittedApplication("2026-09-01");
    const corrected = await applications.correctAppliedOn(application.id, { expectedVersion: 1, appliedOn: "2026-08-30" });
    expect(corrected.appliedOn).toBe("2026-08-30");
    expect(corrected.events.at(-1)).toMatchObject({
      type: "DETAILS_UPDATED",
      occurredOn: "2026-08-30",
      payload: { field: "appliedOn", previous: "2026-09-01" },
    });
  });
});

describe("lifecycle guards", () => {
  it("MARK_APPLIED is refused while the application is unsubmitted", async () => {
    const { opportunityId, application } = await plannedApplication();
    expect(await guarded(opportunityId, "MARK_APPLIED")).toMatchObject({ status: "BLOCKED_BY_APPLICATION" });
    await applications.close(application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED" });
    expect(await guarded(opportunityId, "MARK_APPLIED")).toMatchObject({ status: "BLOCKED_BY_APPLICATION" });
    expect(await statusOf(opportunityId)).toBe("SAVED");
  });

  it("reopening to PLANNED needs a lifecycle that permits a plan", async () => {
    const { opportunityId, application } = await plannedApplication();
    await applications.close(application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED" });
    expect(await guarded(opportunityId, "DISMISS")).toMatchObject({ status: "APPLIED", to: "REJECTED_BY_USER" });
    const dismissed = await snapshot(application.id);
    await expectError(applications.reopen(application.id, { expectedVersion: 2 }), "OPPORTUNITY_NOT_TRACKABLE");
    expect(await snapshot(application.id)).toBe(dismissed);

    // A legacy, unguarded MARK_APPLIED (not reachable through the product)
    // must still never produce PLANNED under an APPLIED lifecycle.
    const second = await plannedApplication();
    await applications.close(second.application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED" });
    await act(second.opportunityId, "MARK_APPLIED");
    await expectError(applications.reopen(second.application.id, { expectedVersion: 2 }), "APPLICATION_ALREADY_SUBMITTED");
  });

  it("RESTORE is refused while submitted, DISMISS while active; closing never changes the lifecycle", async () => {
    const { opportunityId, application } = await plannedApplication();
    expect(await guarded(opportunityId, "DISMISS")).toMatchObject({ status: "BLOCKED_BY_APPLICATION" });
    await applications.submit(application.id, { expectedVersion: 1, appliedOn: "2026-10-01" });
    expect(await guarded(opportunityId, "RESTORE")).toMatchObject({ status: "BLOCKED_BY_APPLICATION" });
    await applications.close(application.id, { expectedVersion: 2, outcome: "REJECTED" });
    expect(await statusOf(opportunityId)).toBe("APPLIED");
    expect(await guarded(opportunityId, "RESTORE")).toMatchObject({ status: "BLOCKED_BY_APPLICATION" });
    expect(await statusOf(opportunityId)).toBe("APPLIED");
  });

  it("archiving keeps the application read-only until restored", async () => {
    const { opportunityId, application } = await submittedApplication();
    await applications.addNote(application.id, { body: "Sent a thank-you note." });
    expect(await guarded(opportunityId, "ARCHIVE")).toMatchObject({ status: "APPLIED", to: "ARCHIVED" });
    const archived = await snapshot(application.id);
    await expectError(applications.addNote(application.id, { body: "Another" }), "OPPORTUNITY_ARCHIVED");
    await expectError(applications.changeStage(application.id, { expectedVersion: 1, stage: "SCREENING" }), "OPPORTUNITY_ARCHIVED");
    expect(await snapshot(application.id)).toBe(archived);
    expect(await guarded(opportunityId, "RESTORE")).toMatchObject({ status: "APPLIED", to: "APPLIED" });
    expect((await applications.changeStage(application.id, { expectedVersion: 1, stage: "SCREENING" })).stage).toBe("SCREENING");
  });

  it("concurrent plan creation and MARK_APPLIED always end consistent", async () => {
    for (let round = 0; round < 6; round += 1) {
      const opportunityId = await createOpportunity();
      await act(opportunityId, "SAVE");
      const [created, marked] = await Promise.allSettled([
        applications.create(opportunityId, { mode: "plan" }),
        guarded(opportunityId, "MARK_APPLIED"),
      ]);
      const status = await statusOf(opportunityId);
      const application = await database.application.findUnique({ where: { opportunityId } });
      if (application) {
        expect(created.status).toBe("fulfilled");
        expect(marked).toMatchObject({ status: "fulfilled", value: { status: "BLOCKED_BY_APPLICATION" } });
        expect(status).toBe("SAVED");
        expect(application.stage).toBe("PLANNED");
      } else {
        expect(created.status).toBe("rejected");
        expect((created as PromiseRejectedResult).reason.code).toBe("APPLICATION_ALREADY_SUBMITTED");
        expect(status).toBe("APPLIED");
      }
    }
  });
});

describe("history, notes, contacts, follow-ups and interviews", () => {
  it("stage progression keeps a strict, gap-free event order", async () => {
    const { application } = await submittedApplication();
    let detail = await applications.changeStage(application.id, { expectedVersion: 1, stage: "SCREENING" });
    detail = await applications.changeStage(application.id, { expectedVersion: 2, stage: "INTERVIEWING" });
    detail = await applications.changeStage(application.id, { expectedVersion: 3, stage: "SCREENING" });
    await expectError(applications.changeStage(application.id, { expectedVersion: 4, stage: "SCREENING" }), "APPLICATION_TRANSITION_NOT_ALLOWED");
    await expectError(applications.close(application.id, { expectedVersion: 4, outcome: "OFFER_ACCEPTED" }), "APPLICATION_TRANSITION_NOT_ALLOWED");
    detail = await applications.changeStage(application.id, { expectedVersion: 4, stage: "OFFER" });
    detail = await applications.close(application.id, { expectedVersion: 5, outcome: "OFFER_ACCEPTED", reason: "Great team" });
    expect(detail.events.map((event) => `${event.type}:${event.fromStage ?? ""}>${event.toStage ?? ""}`)).toEqual([
      "CREATED:>APPLIED",
      "SUBMITTED:>APPLIED",
      "STAGE_CHANGED:APPLIED>SCREENING",
      "STAGE_CHANGED:SCREENING>INTERVIEWING",
      "STAGE_CHANGED:INTERVIEWING>SCREENING",
      "STAGE_CHANGED:SCREENING>OFFER",
      "CLOSED:OFFER>CLOSED",
    ]);
    expect(detail.events.at(-1)).toMatchObject({ outcome: "OFFER_ACCEPTED", payload: { reason: "Great team" } });
    expectGapFree(detail);
  });

  it("note edits keep the previous body in history", async () => {
    const { application } = await submittedApplication();
    let detail = await applications.addNote(application.id, { body: "Recruiter called." });
    const note = detail.notes[0]!;
    detail = await applications.editNote(application.id, { noteId: note.id, expectedVersion: 1, body: "Recruiter called on Monday." });
    expect(detail.notes[0]).toMatchObject({ body: "Recruiter called on Monday.", version: 2 });
    expect(detail.notes[0]!.editedAt).not.toBeNull();
    expect(detail.events.at(-1)).toMatchObject({
      type: "NOTE_EDITED",
      payload: { noteId: note.id, previousBody: "Recruiter called." },
    });
  });

  it("contacts record changed field names only", async () => {
    const { application } = await submittedApplication();
    let detail = await applications.addContact(application.id, {
      name: "Dana Reyes", role: "RECRUITER", title: null, organization: "Acme", email: "dana@example.com",
      profileUrl: "https://www.linkedin.com/in/dana", notes: null,
    });
    const contact = detail.contacts[0]!;
    detail = await applications.updateContact(application.id, {
      contactId: contact.id, expectedVersion: 1, name: "Dana Reyes", role: "HIRING_MANAGER", title: "Director",
      organization: "Acme", email: "dana@example.com", profileUrl: "https://www.linkedin.com/in/dana", notes: null,
    });
    expect(detail.contacts[0]).toMatchObject({ role: "HIRING_MANAGER", title: "Director", version: 2 });
    expect(detail.events.at(-1)).toMatchObject({
      type: "CONTACT_UPDATED",
      payload: { contactId: contact.id, changedFields: ["role", "title"] },
    });
    expect(JSON.stringify(detail.events.at(-1)?.payload)).not.toContain("dana@example.com");
  });

  it("follow-ups complete and reopen, and drive the due counts", async () => {
    const today = utcToday();
    const { application } = await submittedApplication();
    let detail = await applications.addFollowUp(application.id, { description: "Email the recruiter", dueOn: addDays(today, -1) });
    const followUp = detail.followUps[0]!;
    const due = () => lists.listPage({ filters: { view: "active", followUp: "due", searchTerms: [token] }, sort: "next-action", page: 1, pageSize: 25, today });
    expect((await due()).items.map((item) => item.id)).toEqual([application.id]);
    expect((await due()).items[0]?.nextFollowUp).toMatchObject({ description: "Email the recruiter", state: "OVERDUE" });
    detail = await applications.completeFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 1 });
    expect(detail.followUps[0]!.completedAt).not.toBeNull();
    expect((await due()).total).toBe(0);
    await expectError(applications.completeFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 2 }), "APPLICATION_TRANSITION_NOT_ALLOWED");
    detail = await applications.reopenFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 2 });
    expect(detail.followUps[0]!.completedAt).toBeNull();
    expect(detail.events.slice(-3).map((event) => event.type)).toEqual(["FOLLOW_UP_ADDED", "FOLLOW_UP_COMPLETED", "FOLLOW_UP_REOPENED"]);
  });

  it("interviews link to contacts of the same application only", async () => {
    const { application } = await submittedApplication();
    const other = await submittedApplication();
    const withContact = await applications.addContact(application.id, {
      name: "Sam Lee", role: "INTERVIEWER", title: null, organization: null, email: null, profileUrl: null, notes: null,
    });
    const foreign = await applications.addContact(other.application.id, {
      name: "Not Here", role: "OTHER", title: null, organization: null, email: null, profileUrl: null, notes: null,
    });
    const fields = { kind: "HIRING_MANAGER" as const, roundLabel: "Round 1", scheduledAt: new Date("2026-10-20T15:00:00Z"), status: "SCHEDULED" as const, notes: null };
    await expectError(
      applications.addInterview(application.id, { ...fields, contactId: foreign.contacts[0]!.id }),
      "CONTACT_NOT_IN_APPLICATION",
    );
    let detail = await applications.addInterview(application.id, { ...fields, contactId: withContact.contacts[0]!.id });
    const interview = detail.interviews[0]!;
    expect(interview).toMatchObject({ contactId: withContact.contacts[0]!.id, status: "SCHEDULED" });
    detail = await applications.updateInterview(application.id, {
      ...fields, contactId: withContact.contacts[0]!.id, interviewId: interview.id, expectedVersion: 1, status: "COMPLETED",
    });
    expect(detail.interviews[0]).toMatchObject({ status: "COMPLETED", version: 2 });
    expect(detail.events.at(-1)).toMatchObject({
      type: "INTERVIEW_UPDATED",
      payload: { interviewId: interview.id, changedFields: ["status"], status: "COMPLETED", previousStatus: "SCHEDULED" },
    });
    // Interviews never move the stage.
    expect(detail.stage).toBe("APPLIED");
  });
});

describe("commands through the API dispatcher", () => {
  it("persists validated commands exactly as the API sends them", async () => {
    const { application } = await submittedApplication();
    const run = (body: Record<string, unknown>) =>
      runApplicationCommand(applications, application.id, applicationCommandSchema.parse(body));
    let detail = await run({ command: "addContact", name: "Dana", role: "RECRUITER", email: "", profileUrl: "https://example.com/dana" });
    const contact = detail.contacts[0]!;
    expect(contact).toMatchObject({ name: "Dana", email: null, profileUrl: "https://example.com/dana" });
    detail = await run({ command: "updateContact", contactId: contact.id, expectedVersion: 1, name: "Dana", role: "HIRING_MANAGER" });
    expect(detail.events.at(-1)?.payload).toMatchObject({ changedFields: ["role", "profileUrl"] });
    detail = await run({ command: "addInterview", kind: "PANEL", scheduledAt: "2026-10-20T15:00:00.000Z", contactId: contact.id });
    const interview = detail.interviews[0]!;
    expect(interview).toMatchObject({ status: "SCHEDULED", contactId: contact.id });
    detail = await run({ command: "updateInterview", interviewId: interview.id, expectedVersion: 1, kind: "PANEL", status: "COMPLETED", contactId: contact.id, scheduledAt: "2026-10-20T15:00:00.000Z" });
    expect(detail.interviews[0]).toMatchObject({ status: "COMPLETED", version: 2 });
    detail = await run({ command: "addFollowUp", description: "Ping", dueOn: "2026-10-30" });
    detail = await run({ command: "completeFollowUp", followUpId: detail.followUps[0]!.id, expectedVersion: 1 });
    detail = await run({ command: "close", expectedVersion: 1, outcome: "WITHDRAWN", reason: "" });
    expect(detail).toMatchObject({ stage: "CLOSED", outcome: "WITHDRAWN" });
    expect(detail.events.at(-1)?.payload).toBeNull();
    expectGapFree(detail);
  });
});

describe("optimistic concurrency", () => {
  async function fullApplication() {
    const planned = await plannedApplication();
    const submitted = await submittedApplication();
    let detail = await applications.addNote(submitted.application.id, { body: "First note" });
    detail = await applications.addContact(submitted.application.id, {
      name: "Alex Kim", role: "RECRUITER", title: null, organization: null, email: null, profileUrl: null, notes: null,
    });
    detail = await applications.addFollowUp(submitted.application.id, { description: "Check in", dueOn: "2026-10-30" });
    detail = await applications.addInterview(submitted.application.id, {
      kind: "PANEL", roundLabel: null, scheduledAt: null, status: "SCHEDULED", contactId: null, notes: null,
    });
    return { planned, submitted: detail };
  }

  it("every versioned command refuses a stale version and leaves no trace", async () => {
    const { planned, submitted } = await fullApplication();
    const id = submitted.id;
    const note = submitted.notes[0]!;
    const contact = submitted.contacts[0]!;
    const followUp = submitted.followUps[0]!;
    const interview = submitted.interviews[0]!;
    // Advance every version once so version 1 is stale everywhere.
    await applications.changeStage(id, { expectedVersion: 1, stage: "SCREENING" });
    await applications.editNote(id, { noteId: note.id, expectedVersion: 1, body: "Edited" });
    await applications.updateContact(id, { contactId: contact.id, expectedVersion: 1, name: "Alex Kim", role: "OTHER", title: null, organization: null, email: null, profileUrl: null, notes: null });
    await applications.completeFollowUp(id, { followUpId: followUp.id, expectedVersion: 1 });
    await applications.updateInterview(id, { interviewId: interview.id, expectedVersion: 1, kind: "PANEL", roundLabel: "R2", scheduledAt: null, status: "SCHEDULED", contactId: null, notes: null });
    await applications.changeStage(planned.application.id, { expectedVersion: 1, stage: "SCREENING" }).catch(() => undefined);
    await applications.addNote(planned.application.id, { body: "plan note" });
    const plannedStale = await applications.close(planned.application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED" });
    await applications.reopen(planned.application.id, { expectedVersion: plannedStale.version });

    const before = await snapshot(id);
    const plannedBefore = await snapshot(planned.application.id);
    const opportunityStatus = await statusOf(planned.opportunityId);
    const stale: Array<[string, () => Promise<unknown>, string]> = [
      ["submit", () => applications.submit(planned.application.id, { expectedVersion: 1, appliedOn: "2026-10-01" }), planned.application.id],
      ["changeStage", () => applications.changeStage(id, { expectedVersion: 1, stage: "OFFER" }), id],
      ["close", () => applications.close(id, { expectedVersion: 1, outcome: "WITHDRAWN" }), id],
      ["reopen", () => applications.reopen(id, { expectedVersion: 1 }), id],
      ["correctAppliedOn", () => applications.correctAppliedOn(id, { expectedVersion: 1, appliedOn: "2026-08-01" }), id],
      ["editNote", () => applications.editNote(id, { noteId: note.id, expectedVersion: 1, body: "Stale" }), id],
      ["updateContact", () => applications.updateContact(id, { contactId: contact.id, expectedVersion: 1, name: "Stale", role: "OTHER", title: null, organization: null, email: null, profileUrl: null, notes: null }), id],
      ["completeFollowUp", () => applications.completeFollowUp(id, { followUpId: followUp.id, expectedVersion: 1 }), id],
      ["reopenFollowUp", () => applications.reopenFollowUp(id, { followUpId: followUp.id, expectedVersion: 1 }), id],
      ["updateInterview", () => applications.updateInterview(id, { interviewId: interview.id, expectedVersion: 1, kind: "FINAL", roundLabel: null, scheduledAt: null, status: "CANCELLED", contactId: null, notes: null }), id],
    ];
    for (const [name, run] of stale) {
      const error = await expectError(run(), "APPLICATION_CHANGED");
      expect(error.details.id, name).toBeTruthy();
    }
    expect(await snapshot(id)).toBe(before);
    expect(await snapshot(planned.application.id)).toBe(plannedBefore);
    expect(await statusOf(planned.opportunityId)).toBe(opportunityStatus);
  });

  async function race(
    setup: () => Promise<{ id: string; detail: ApplicationDetail }>,
    first: (detail: ApplicationDetail) => Promise<unknown>,
    second: (detail: ApplicationDetail) => Promise<unknown>,
    check?: (after: ApplicationDetail, before: ApplicationDetail) => unknown,
  ) {
    for (let round = 0; round < 3; round += 1) {
      const { id, detail } = await setup();
      const results = await Promise.allSettled([first(detail), second(detail)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(ApplicationError);
      expect(failure.reason.code).toBe("APPLICATION_CHANGED");
      const after = (await applications.getDetail(id))!;
      expect(after.events).toHaveLength(detail.events.length + 1);
      expectGapFree(after);
      await check?.(after, detail);
    }
  }

  const submittedSetup = async () => {
    const { application } = await submittedApplication();
    return { id: application.id, detail: application };
  };

  it("two stage changes with the same version: one wins, one 409, one event", async () => {
    await race(
      submittedSetup,
      (detail) => applications.changeStage(detail.id, { expectedVersion: detail.version, stage: "SCREENING" }),
      (detail) => applications.changeStage(detail.id, { expectedVersion: detail.version, stage: "INTERVIEWING" }),
      (after) => expect(after.events.at(-1)).toMatchObject({ type: "STAGE_CHANGED", fromStage: "APPLIED", toStage: after.stage }),
    );
  });

  it("close racing a stage change", async () => {
    await race(
      submittedSetup,
      (detail) => applications.close(detail.id, { expectedVersion: detail.version, outcome: "REJECTED" }),
      (detail) => applications.changeStage(detail.id, { expectedVersion: detail.version, stage: "SCREENING" }),
      (after) => expect(after.events.at(-1)?.fromStage).toBe("APPLIED"),
    );
  });

  it("two submissions: exactly one MARK_APPLIED", async () => {
    let opportunityId = "";
    await race(
      async () => {
        const planned = await plannedApplication();
        opportunityId = planned.opportunityId;
        return { id: planned.application.id, detail: planned.application };
      },
      (detail) => applications.submit(detail.id, { expectedVersion: detail.version, appliedOn: "2026-10-01" }),
      (detail) => applications.submit(detail.id, { expectedVersion: detail.version, appliedOn: "2026-10-02" }),
      async () => {
        const marks = (await actionRows(opportunityId)).filter((row) => row.action === "MARK_APPLIED");
        expect(marks).toHaveLength(1);
      },
    );
  });

  it("two note edits: the surviving event holds the true previous body", async () => {
    await race(
      async () => {
        const { application } = await submittedApplication();
        const detail = await applications.addNote(application.id, { body: "Original" });
        return { id: application.id, detail };
      },
      (detail) => applications.editNote(detail.id, { noteId: detail.notes[0]!.id, expectedVersion: 1, body: "Edit A" }),
      (detail) => applications.editNote(detail.id, { noteId: detail.notes[0]!.id, expectedVersion: 1, body: "Edit B" }),
      (after) => expect(after.events.at(-1)).toMatchObject({ type: "NOTE_EDITED", payload: { previousBody: "Original" } }),
    );
  });

  it("two follow-up completions and two interview updates", async () => {
    await race(
      async () => {
        const { application } = await submittedApplication();
        const detail = await applications.addFollowUp(application.id, { description: "Ping", dueOn: "2026-10-30" });
        return { id: application.id, detail };
      },
      (detail) => applications.completeFollowUp(detail.id, { followUpId: detail.followUps[0]!.id, expectedVersion: 1 }),
      (detail) => applications.completeFollowUp(detail.id, { followUpId: detail.followUps[0]!.id, expectedVersion: 1 }),
    );
    const fields = { kind: "TECHNICAL" as const, roundLabel: null, scheduledAt: null, contactId: null, notes: null };
    await race(
      async () => {
        const { application } = await submittedApplication();
        const detail = await applications.addInterview(application.id, { ...fields, status: "SCHEDULED" });
        return { id: application.id, detail };
      },
      (detail) => applications.updateInterview(detail.id, { ...fields, interviewId: detail.interviews[0]!.id, expectedVersion: 1, status: "COMPLETED" }),
      (detail) => applications.updateInterview(detail.id, { ...fields, interviewId: detail.interviews[0]!.id, expectedVersion: 1, status: "CANCELLED" }),
      (after) => expect(after.events.at(-1)?.payload).toMatchObject({ previousStatus: "SCHEDULED" }),
    );
  });

  it("additive commands never conflict, and per-entity versions keep unrelated edits independent", async () => {
    const { application } = await submittedApplication();
    await Promise.all([
      applications.addNote(application.id, { body: "One" }),
      applications.addNote(application.id, { body: "Two" }),
    ]);
    let detail = (await applications.getDetail(application.id))!;
    expect(detail.notes).toHaveLength(2);
    expectGapFree(detail);
    const note = detail.notes[0]!;
    await Promise.all([
      applications.editNote(application.id, { noteId: note.id, expectedVersion: 1, body: "One, edited" }),
      applications.changeStage(application.id, { expectedVersion: detail.version, stage: "SCREENING" }),
    ]);
    detail = (await applications.getDetail(application.id))!;
    expect(detail.stage).toBe("SCREENING");
    expect(detail.notes.find((item) => item.id === note.id)?.body).toBe("One, edited");
    expectGapFree(detail);
  });
});

describe("independence from evaluation and budget", () => {
  it("reevaluation and budget deferral leave application rows untouched, and vice versa", async () => {
    const { budget, service } = createHarness(clock);
    void budget;
    const profile = await createProfile(cleanup);
    const { opportunityId, application } = await submittedApplication();
    await applications.addNote(application.id, { body: "Keep me" });
    await applications.addFollowUp(application.id, { description: "Follow up", dueOn: "2026-10-30" });
    const before = await snapshot(application.id);

    const queued = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(queued.outcome).toBe("QUEUED");
    await runWorker();
    expect(await snapshot(application.id)).toBe(before);
    expect(await statusOf(opportunityId)).toBe("APPLIED");

    await setBudget({ amount: 0.01, reservePerEvaluation: 0.6 });
    const deferred = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
    expect(deferred.outcome).toBe("DEFERRED");
    expect(await snapshot(application.id)).toBe(before);

    const evaluations = await database.evaluation.count({ where: { opportunityId } });
    const deferrals = await database.deferredEvaluation.findMany({ where: { opportunityId } });
    await applications.changeStage(application.id, { expectedVersion: 1, stage: "SCREENING" });
    await applications.addNote(application.id, { body: "Another" });
    expect(await database.evaluation.count({ where: { opportunityId } })).toBe(evaluations);
    expect(await database.deferredEvaluation.findMany({ where: { opportunityId } })).toEqual(deferrals);
  });
});

describe("tracker and dashboard queries", () => {
  it("filters, sorts, paginates, and clamps beyond the last page", async () => {
    const today = utcToday();
    const a = await submittedApplication("2026-09-01");
    const b = await submittedApplication("2026-09-10");
    const c = await plannedApplication();
    await applications.addFollowUp(a.application.id, { description: "Overdue", dueOn: addDays(today, -2) });
    await applications.addFollowUp(b.application.id, { description: "Soon", dueOn: addDays(today, 3) });
    await applications.close(c.application.id, { expectedVersion: 1, outcome: "NOT_SUBMITTED" });
    const list = (filters: Partial<Parameters<typeof lists.listPage>[0]["filters"]>, sort: Parameters<typeof lists.listPage>[0]["sort"] = "next-action", page = 1, pageSize = 25) =>
      lists.listPage({ filters: { view: "all", searchTerms: [token], ...filters }, sort, page, pageSize, today });

    expect((await list({ view: "active" })).items.map((item) => item.id)).toEqual([a.application.id, b.application.id]);
    expect((await list({ view: "closed" })).items.map((item) => item.id)).toEqual([c.application.id]);
    expect((await list({ outcomes: ["NOT_SUBMITTED"] })).total).toBe(1);
    expect((await list({ followUp: "overdue" })).items.map((item) => item.id)).toEqual([a.application.id]);
    expect((await list({ followUp: "upcoming" })).items.map((item) => item.id)).toEqual([b.application.id]);
    expect((await list({ followUp: "none" })).items.map((item) => item.id)).toEqual([c.application.id]);
    expect((await list({ appliedFrom: "2026-09-05", appliedTo: "2026-09-10" })).items.map((item) => item.id)).toEqual([b.application.id]);
    expect((await list({}, "applied-newest")).items.map((item) => item.id)).toEqual([b.application.id, a.application.id, c.application.id]);
    expect((await list({ stages: ["APPLIED"] })).total).toBe(2);
    const clamped = await list({}, "next-action", 99, 2);
    expect(clamped).toMatchObject({ page: 2, requestedPage: 99, pageCount: 2, total: 3 });
    expect(clamped.items).toHaveLength(1);
    expect(await list({ searchTerms: [`${token}nomatch`] })).toMatchObject({ total: 0, items: [], page: 1 });
  });

  it("dashboard rows carry the application state; the Follow-ups due count equals its linked view", async () => {
    const today = utcToday();
    const { opportunityId, application } = await submittedApplication();
    await applications.addFollowUp(application.id, { description: "Call back", dueOn: today });
    const page = await new PrismaOpportunityListRepository().listPage({
      filters: { searchTerms: [token] }, sort: "newest", page: 1, pageSize: 25,
    });
    expect(page.items.find((item) => item.id === opportunityId)?.application).toEqual({
      stage: "APPLIED", outcome: null, nextFollowUpOn: today, nextFollowUpState: "DUE_TODAY",
    });
    const summary = await new PrismaOpportunityDashboardRepository().summarize();
    const view = await lists.listPage({ filters: { view: "active", followUp: "due" }, sort: "next-action", page: 1, pageSize: 25, today });
    expect(summary.followUpsDue).toBe(view.total);
    expect(summary.followUpsDue).toBeGreaterThanOrEqual(1);
    const tracker = await lists.summarize({ today });
    expect(tracker.followUpsOverdue + tracker.followUpsDueToday).toBe(view.total);
  });
});
