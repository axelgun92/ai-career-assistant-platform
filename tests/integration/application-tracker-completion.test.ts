// Task 8 completion pass, against the isolated test database: follow-up
// updates, calendar-date rules, actionable next actions, closed outcomes,
// interview edits, reevaluation/sweep independence, and the dated history
// later analytics will read. Evaluation uses the deterministic fixture
// transport only.
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
import { createCleanup, createHarness, createProfile, database, runWorker } from "../support/budget-integration";

const applications = new PrismaApplicationRepository();
const lists = new PrismaApplicationListRepository();
const lifecycle = new PrismaOpportunityLifecycleRepository();
const cleanup = createCleanup();
const clock = { now: new Date() };
let token = "";
// One "today" per test, passed explicitly so a run that crosses UTC midnight
// cannot change the expected answers.
let today = "";

beforeEach(async () => {
  clock.now = new Date();
  today = utcToday(clock.now);
  token = `trc${randomUUID().slice(0, 8)}`;
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
    company: `Completion ${label} ${token} ${randomUUID().slice(0, 6)}`,
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

const statusOf = async (opportunityId: string) =>
  (await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { status: true } })).status;

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApplicationError);
  expect((error as ApplicationError).code).toBe(code);
  return error as ApplicationError;
}

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

const lifecycleSnapshot = async (opportunityId: string) =>
  JSON.stringify({
    status: await statusOf(opportunityId),
    actions: await database.opportunityUserAction.findMany({ where: { opportunityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  });

async function submittedApplication(appliedOn = "2026-09-01") {
  const opportunityId = await createOpportunity();
  const application = await applications.create(opportunityId, { mode: "submitted", appliedOn }, today);
  return { opportunityId, application };
}

async function plannedApplication() {
  const opportunityId = await createOpportunity();
  await act(opportunityId, "SAVE");
  const application = await applications.create(opportunityId, { mode: "plan" }, today);
  return { opportunityId, application };
}

const lastEvent = (detail: ApplicationDetail) => detail.events.at(-1)!;

describe("rescheduling and rewording follow-ups", () => {
  it("updates a follow-up as a versioned change and records the previous values", async () => {
    const { application } = await submittedApplication();
    let detail = await applications.addFollowUp(application.id, { description: "Email the recruiter", dueOn: addDays(today, -3) });
    const followUp = detail.followUps[0]!;
    detail = await applications.updateFollowUp(application.id, {
      followUpId: followUp.id,
      expectedVersion: followUp.version,
      description: "Email the recruiter",
      dueOn: addDays(today, 4),
    });
    expect(detail.followUps[0]).toMatchObject({ id: followUp.id, dueOn: addDays(today, 4), version: 2, completedAt: null });
    expect(lastEvent(detail)).toMatchObject({
      type: "FOLLOW_UP_UPDATED",
      occurredOn: addDays(today, 4),
      payload: {
        followUpId: followUp.id,
        description: "Email the recruiter",
        changedFields: ["dueOn"],
        previousDescription: "Email the recruiter",
        previousDueOn: addDays(today, -3),
      },
    });
    // No longer overdue: the tracker's next action moves with it.
    const page = await lists.listPage({ filters: { view: "all", searchTerms: [token] }, sort: "next-action", page: 1, pageSize: 25, today });
    expect(page.items[0]?.nextFollowUp).toEqual({ description: "Email the recruiter", dueOn: addDays(today, 4), state: "UPCOMING" });

    detail = await applications.updateFollowUp(application.id, {
      followUpId: followUp.id,
      expectedVersion: 2,
      description: "Call the recruiter",
      dueOn: addDays(today, 4),
    });
    expect(lastEvent(detail).payload).toMatchObject({ changedFields: ["description"], previousDescription: "Email the recruiter" });
    expect(detail.events.map((event) => event.sequence)).toEqual(detail.events.map((_, index) => index + 1));
  });

  it("refuses a stale or unchanged update with no trace", async () => {
    const { application } = await submittedApplication();
    const detail = await applications.addFollowUp(application.id, { description: "Ping", dueOn: today });
    const followUp = detail.followUps[0]!;
    await applications.completeFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 1 });
    const before = await snapshot(application.id);
    await expectError(
      applications.updateFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 1, description: "Ping", dueOn: addDays(today, 1) }),
      "APPLICATION_CHANGED",
    );
    await expectError(
      applications.updateFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 2, description: "Ping", dueOn: today }),
      "APPLICATION_TRANSITION_NOT_ALLOWED",
    );
    await expectError(
      applications.updateFollowUp(application.id, { followUpId: randomUUID(), expectedVersion: 1, description: "Ping", dueOn: today }),
      "APPLICATION_ITEM_NOT_FOUND",
    );
    expect(await snapshot(application.id)).toBe(before);
  });

  it("keeps date-only values as the same calendar date through the API dispatcher and the database", async () => {
    const { application } = await submittedApplication();
    const run = async (body: unknown) => runApplicationCommand(applications, application.id, applicationCommandSchema.parse(body));
    let detail = await run({ command: "addFollowUp", description: "Year end", dueOn: "2026-12-31" });
    const followUp = detail.followUps[0]!;
    expect(followUp.dueOn).toBe("2026-12-31");
    for (const dueOn of ["2027-01-01", "2028-02-29", "2026-03-08", "2026-11-01"]) {
      const current = detail.followUps[0]!;
      detail = await run({ command: "updateFollowUp", followUpId: current.id, expectedVersion: current.version, description: "Year end", dueOn });
      expect(detail.followUps[0]!.dueOn).toBe(dueOn);
      expect((await applications.getDetail(application.id))!.followUps[0]!.dueOn).toBe(dueOn);
      const [row] = await database.$queryRaw<Array<{ dueOn: string }>>`
        SELECT "dueOn"::text AS "dueOn" FROM "ApplicationFollowUp" WHERE "id" = ${followUp.id}::uuid`;
      expect(row?.dueOn).toBe(dueOn);
    }
  });

  it("is refused while the opportunity is archived", async () => {
    const { opportunityId, application } = await submittedApplication();
    const followUp = (await applications.addFollowUp(application.id, { description: "Ping", dueOn: today })).followUps[0]!;
    await act(opportunityId, "ARCHIVE");
    await expectError(
      applications.updateFollowUp(application.id, { followUpId: followUp.id, expectedVersion: 1, description: "Ping", dueOn: addDays(today, 2) }),
      "OPPORTUNITY_ARCHIVED",
    );
  });
});

describe("applied and closed calendar dates", () => {
  it("refuses future applied dates on create and submit, without marking the opportunity applied", async () => {
    const opportunityId = await createOpportunity();
    const lifecycleBefore = await lifecycleSnapshot(opportunityId);
    const error = await expectError(
      applications.create(opportunityId, { mode: "submitted", appliedOn: addDays(today, 1) }, today),
      "APPLICATION_DATE_INVALID",
    );
    expect(error.message).toBe("The applied date cannot be in the future");
    expect(await database.application.count({ where: { opportunityId } })).toBe(0);
    expect(await lifecycleSnapshot(opportunityId)).toBe(lifecycleBefore);

    const planned = await plannedApplication();
    const planLifecycle = await lifecycleSnapshot(planned.opportunityId);
    const before = await snapshot(planned.application.id);
    await expectError(
      applications.submit(planned.application.id, { expectedVersion: 1, appliedOn: addDays(today, 1) }, today),
      "APPLICATION_DATE_INVALID",
    );
    expect(await snapshot(planned.application.id)).toBe(before);
    expect(await lifecycleSnapshot(planned.opportunityId)).toBe(planLifecycle);
    // Today itself is accepted (no tolerance either way).
    const submitted = await applications.submit(planned.application.id, { expectedVersion: 1, appliedOn: today }, today);
    expect(submitted.appliedOn).toBe(today);
  });

  it("refuses closing before the applied date or in the future, and accepts the same day", async () => {
    const { application } = await submittedApplication(addDays(today, -5));
    const before = await snapshot(application.id);
    const early = await expectError(
      applications.close(application.id, { expectedVersion: 1, outcome: "REJECTED", closedOn: addDays(today, -6) }, today),
      "APPLICATION_DATE_INVALID",
    );
    expect(early.message).toBe("The closed date cannot be earlier than the applied date");
    await expectError(
      applications.close(application.id, { expectedVersion: 1, outcome: "REJECTED", closedOn: addDays(today, 1) }, today),
      "APPLICATION_DATE_INVALID",
    );
    expect(await snapshot(application.id)).toBe(before);
    const closed = await applications.close(application.id, { expectedVersion: 1, outcome: "REJECTED", closedOn: addDays(today, -5) }, today);
    expect(closed).toMatchObject({ stage: "CLOSED", appliedOn: addDays(today, -5), closedOn: addDays(today, -5) });
  });

  it("refuses an applied-date correction later than the closed date or today", async () => {
    const { application } = await submittedApplication(addDays(today, -10));
    await applications.close(application.id, { expectedVersion: 1, outcome: "NO_RESPONSE", closedOn: addDays(today, -2) }, today);
    const before = await snapshot(application.id);
    await expectError(
      applications.correctAppliedOn(application.id, { expectedVersion: 2, appliedOn: addDays(today, -1) }, today),
      "APPLICATION_DATE_INVALID",
    );
    expect(await snapshot(application.id)).toBe(before);
    const corrected = await applications.correctAppliedOn(application.id, { expectedVersion: 2, appliedOn: addDays(today, -2) }, today);
    expect(corrected).toMatchObject({ appliedOn: addDays(today, -2), closedOn: addDays(today, -2), outcome: "NO_RESPONSE" });

    const open = await submittedApplication(addDays(today, -3));
    await expectError(
      applications.correctAppliedOn(open.application.id, { expectedVersion: 1, appliedOn: addDays(today, 1) }, today),
      "APPLICATION_DATE_INVALID",
    );
  });

  it("checks the version before the dates, so a stale form gets a conflict first", async () => {
    const { application } = await submittedApplication(addDays(today, -1));
    await applications.changeStage(application.id, { expectedVersion: 1, stage: "SCREENING" });
    await expectError(
      applications.close(application.id, { expectedVersion: 1, outcome: "REJECTED", closedOn: addDays(today, 3) }, today),
      "APPLICATION_CHANGED",
    );
  });
});

describe("next actions only for actionable applications", () => {
  it("excludes closed applications and archived opportunities from due work, and keeps tiles equal to their views", async () => {
    const active = await submittedApplication();
    const closed = await submittedApplication();
    const archived = await submittedApplication();
    await applications.addFollowUp(active.application.id, { description: "Due today", dueOn: today });
    await applications.addFollowUp(closed.application.id, { description: "Stale overdue", dueOn: addDays(today, -4) });
    await applications.addFollowUp(archived.application.id, { description: "Archived overdue", dueOn: addDays(today, -4) });
    await applications.close(closed.application.id, { expectedVersion: 1, outcome: "WITHDRAWN" }, today);
    await act(archived.opportunityId, "ARCHIVE");

    const list = (filters: Partial<Parameters<typeof lists.listPage>[0]["filters"]>) =>
      lists.listPage({ filters: { view: "all", searchTerms: [token], ...filters }, sort: "next-action", page: 1, pageSize: 25, today });
    const ids = async (filters: Partial<Parameters<typeof lists.listPage>[0]["filters"]>) =>
      (await list(filters)).items.map((item) => item.id);

    expect(await ids({ followUp: "overdue" })).toEqual([]);
    expect(await ids({ followUp: "today" })).toEqual([active.application.id]);
    expect(await ids({ followUp: "due" })).toEqual([active.application.id]);
    expect((await ids({ followUp: "none" })).sort()).toEqual([closed.application.id, archived.application.id].sort());
    const all = await list({});
    expect(all.items[0]?.id).toBe(active.application.id); // next-action sort: actionable due work first
    expect(all.items.find((item) => item.id === closed.application.id)?.nextFollowUp).toBeNull();
    expect(all.items.find((item) => item.id === archived.application.id)).toMatchObject({ nextFollowUp: null, opportunityStatus: "ARCHIVED" });
    // The follow-up rows themselves are kept unchanged.
    expect(await database.applicationFollowUp.count({ where: { applicationId: closed.application.id, completedAt: null } })).toBe(1);

    const rows = await new PrismaOpportunityListRepository().listPage({ filters: { searchTerms: [token] }, sort: "newest", page: 1, pageSize: 25 });
    const row = (id: string) => rows.items.find((item) => item.id === id)?.application;
    expect(row(active.opportunityId)).toMatchObject({ nextFollowUpOn: today, nextFollowUpState: "DUE_TODAY" });
    expect(row(closed.opportunityId)).toMatchObject({ stage: "CLOSED", nextFollowUpOn: null, nextFollowUpState: null });

    // Tile counts equal their linked views over the whole (isolated) database.
    const summary = await lists.summarize({ today, now: clock.now });
    const global = (filters: Parameters<typeof lists.listPage>[0]["filters"]) =>
      lists.listPage({ filters, sort: "next-action", page: 1, pageSize: 1, today }).then((page) => page.total);
    expect(summary.followUpsOverdue).toBe(await global({ view: "active", followUp: "overdue" }));
    expect(summary.followUpsDueToday).toBe(await global({ view: "active", followUp: "today" }));
    expect(await lists.countFollowUpsDue(today)).toBe(await global({ view: "active", followUp: "due" }));
    const dashboard = await new PrismaOpportunityDashboardRepository().summarize();
    if (utcToday() === today) expect(dashboard.followUpsDue).toBe(await global({ view: "active", followUp: "due" }));
  });

  it("reopening a closed application makes its follow-ups due again", async () => {
    const { application } = await submittedApplication();
    await applications.addFollowUp(application.id, { description: "Overdue", dueOn: addDays(today, -1) });
    await applications.close(application.id, { expectedVersion: 1, outcome: "REJECTED" }, today);
    const overdue = () =>
      lists.listPage({ filters: { view: "all", searchTerms: [token], followUp: "overdue" }, sort: "next-action", page: 1, pageSize: 25, today });
    expect((await overdue()).total).toBe(0);
    await applications.reopen(application.id, { expectedVersion: 2 });
    expect((await overdue()).items.map((item) => item.id)).toEqual([application.id]);
  });
});

describe("closed outcomes", () => {
  it("persists Offer declined and No response with their dates, and filters by them", async () => {
    const offer = await submittedApplication(addDays(today, -20));
    await applications.changeStage(offer.application.id, { expectedVersion: 1, stage: "OFFER" });
    const declined = await applications.close(offer.application.id, { expectedVersion: 2, outcome: "OFFER_DECLINED", closedOn: addDays(today, -1), reason: "Compensation" }, today);
    expect(declined).toMatchObject({ stage: "CLOSED", outcome: "OFFER_DECLINED", closedOn: addDays(today, -1), appliedOn: addDays(today, -20) });
    const silent = await submittedApplication(addDays(today, -30));
    await applications.close(silent.application.id, { expectedVersion: 1, outcome: "NO_RESPONSE" }, today);

    const reloaded = await applications.getDetail(offer.application.id);
    expect(reloaded).toMatchObject({ outcome: "OFFER_DECLINED", closedOn: addDays(today, -1) });
    expect(lastEvent(reloaded!)).toMatchObject({ type: "CLOSED", fromStage: "OFFER", outcome: "OFFER_DECLINED", payload: { reason: "Compensation" } });
    expect((await applications.getDetail(silent.application.id))).toMatchObject({ outcome: "NO_RESPONSE", closedOn: today });
    const byOutcome = (outcome: "OFFER_DECLINED" | "NO_RESPONSE") =>
      lists.listPage({ filters: { view: "all", searchTerms: [token], outcomes: [outcome] }, sort: "next-action", page: 1, pageSize: 25, today })
        .then((page) => page.items.map((item) => item.id));
    expect(await byOutcome("OFFER_DECLINED")).toEqual([offer.application.id]);
    expect(await byOutcome("NO_RESPONSE")).toEqual([silent.application.id]);
    // Closing never changed the lifecycle.
    expect(await statusOf(offer.opportunityId)).toBe("APPLIED");
    expect(await statusOf(silent.opportunityId)).toBe("APPLIED");
  });

  it("explains a refused tracking request for the opportunity's own state", async () => {
    const dismissed = await createOpportunity();
    await act(dismissed, "DISMISS");
    const error = await expectError(applications.create(dismissed, { mode: "plan" }, today), "OPPORTUNITY_NOT_TRACKABLE");
    expect(error.message).toContain("dismissed. Restore it");
  });
});

describe("interview edits", () => {
  it("updates every interview field, including cancelling it", async () => {
    const { application } = await submittedApplication();
    let detail = await applications.addContact(application.id, { name: "Dana", role: "INTERVIEWER", title: null, organization: null, email: null, profileUrl: null, notes: null });
    const contact = detail.contacts[0]!;
    detail = await applications.addInterview(application.id, { kind: "CASE_STUDY", roundLabel: null, scheduledAt: null, status: "COMPLETED", contactId: null, notes: null });
    const interview = detail.interviews[0]!;
    expect(interview.status).toBe("COMPLETED");
    detail = await applications.updateInterview(application.id, {
      interviewId: interview.id,
      expectedVersion: 1,
      kind: "FINAL",
      roundLabel: "Onsite",
      scheduledAt: new Date("2026-11-02T17:15:00.000Z"),
      status: "CANCELLED",
      contactId: contact.id,
      notes: "Rescheduled by the company",
    });
    expect(detail.interviews[0]).toMatchObject({
      kind: "FINAL",
      roundLabel: "Onsite",
      scheduledAt: new Date("2026-11-02T17:15:00.000Z"),
      status: "CANCELLED",
      contactId: contact.id,
      notes: "Rescheduled by the company",
      version: 2,
    });
    expect(lastEvent(detail).payload).toMatchObject({
      changedFields: ["kind", "roundLabel", "scheduledAt", "status", "contactId", "notes"],
      previousStatus: "COMPLETED",
      status: "CANCELLED",
    });
  });
});

describe("independence from reevaluation and lifecycle repair", () => {
  it("evaluation, lifecycle sync, and the sweep never downgrade Applied or touch the application", async () => {
    const { service } = createHarness(clock);
    const profile = await createProfile(cleanup);
    const { opportunityId, application } = await submittedApplication();
    await applications.changeStage(application.id, { expectedVersion: 1, stage: "INTERVIEWING" });
    await applications.addFollowUp(application.id, { description: "Thank-you note", dueOn: today });
    const before = await snapshot(application.id);
    const lifecycleBefore = await lifecycleSnapshot(opportunityId);

    for (let run = 0; run < 2; run += 1) {
      const queued = await service.requestEvaluation(opportunityId, { userProfileId: profile.id });
      expect(queued.outcome).toBe("QUEUED");
      await runWorker();
    }
    expect(await database.evaluation.count({ where: { opportunityId, status: "COMPLETED" } })).toBe(2);
    expect(await lifecycle.syncSystemLifecycle(opportunityId)).toBeNull();
    await lifecycle.sweepSystemLifecycle();
    expect(await statusOf(opportunityId)).toBe("APPLIED");
    expect(await lifecycleSnapshot(opportunityId)).toBe(lifecycleBefore);
    expect(await snapshot(application.id)).toBe(before);
  });
});

describe("history for later analytics", () => {
  it("records a dated, ordered pursuit from submission to outcome", async () => {
    const { application } = await submittedApplication(addDays(today, -21));
    await applications.changeStage(application.id, { expectedVersion: 1, stage: "SCREENING" });
    await applications.addInterview(application.id, { kind: "RECRUITER_SCREEN", roundLabel: null, scheduledAt: null, status: "COMPLETED", contactId: null, notes: null });
    await applications.changeStage(application.id, { expectedVersion: 2, stage: "INTERVIEWING" });
    await applications.close(application.id, { expectedVersion: 3, outcome: "REJECTED", closedOn: addDays(today, -2) }, today);
    const detail = (await applications.getDetail(application.id))!;
    expect(detail.events.map((event) => [event.type, event.toStage, event.outcome, event.occurredOn])).toEqual([
      ["CREATED", "APPLIED", null, null],
      ["SUBMITTED", "APPLIED", null, addDays(today, -21)],
      ["STAGE_CHANGED", "SCREENING", null, null],
      ["INTERVIEW_ADDED", null, null, null],
      ["STAGE_CHANGED", "INTERVIEWING", null, null],
      ["CLOSED", "CLOSED", "REJECTED", addDays(today, -2)],
    ]);
    expect(detail.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    const times = detail.events.map((event) => event.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(detail).toMatchObject({ appliedOn: addDays(today, -21), closedOn: addDays(today, -2), outcome: "REJECTED" });
  });
});
