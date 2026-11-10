import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { build } from "esbuild";

// Application tracker end to end. Creates its own opportunities (scoped by a
// unique token) and needs no evaluation, budget, or profile changes.
test.describe.configure({ mode: "serial" });

const execFileAsync = promisify(execFile);
const helper = path.resolve("tests/support/e2e-evaluation-helper.ts");
const compiledHelper = path.resolve("database/.e2e-applications-helper.mjs");
const opportunityIds: string[] = [];

test.beforeAll(async () => {
  await build({
    entryPoints: [helper],
    outfile: compiledHelper,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["@prisma/*", "pg", "dotenv", "zod"],
    logLevel: "silent",
  });
});

test.afterAll(async () => {
  await unlink(compiledHelper).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});

test.afterEach(async () => {
  for (const opportunityId of opportunityIds.splice(0)) {
    await execFileAsync(process.execPath, [compiledHelper, "cleanup", opportunityId, ""], { cwd: process.cwd(), env: process.env });
  }
});

const utcDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function createOpportunity(request: APIRequestContext, title: string, company: string) {
  const response = await request.post("/api/opportunities", {
    data: {
      title,
      company,
      location: "Remote - United States",
      compensationText: "$72,000-$88,000",
      domain: "customer-success",
      rawText: `${title} at ${company}. Remote. Own onboarding, adoption, and retention.`,
    },
  });
  expect(response.status()).toBe(201);
  const { opportunity } = (await response.json()) as { opportunity: { id: string } };
  opportunityIds.push(opportunity.id);
  return opportunity.id;
}

const panel = (page: Page) => page.getByRole("region", { name: "Application" });
const stageBadge = (page: Page) => panel(page).locator(".application-summary .status-label-application");
const lifecycleHeading = (page: Page) => page.locator("#opportunity-status-title");

test("track an application from plan to outcome, with follow-ups on the dashboard and tracker", async ({ page, request }) => {
  const token = `A${Date.now()}`;
  const title = `Tracker Customer Success Manager ${token}`;
  const opportunityId = await createOpportunity(request, title, `Trackerco ${token}`);
  expect((await request.post(`/api/opportunities/${opportunityId}/action`, { data: { action: "SAVE" } })).status()).toBe(200);

  await page.goto(`/opportunities/${opportunityId}`);
  await expect(lifecycleHeading(page)).toHaveText("Saved");
  await panel(page).getByRole("button", { name: "Planning to apply" }).click();
  await expect(stageBadge(page)).toHaveText("Planning to apply");
  // While planned, "Mark as applied" is replaced by a pointer to the tracker.
  await expect(page.getByRole("button", { name: "Mark as applied" })).toHaveCount(0);
  await expect(page.getByText("Mark as applied — Record the submission in the Application section")).toBeVisible();

  const submit = panel(page).getByRole("form", { name: "Record submission" });
  await submit.getByLabel("Applied on (UTC date)").fill(utcDate(-3));
  await submit.getByRole("button", { name: "I've applied" }).click();
  await expect(stageBadge(page)).toHaveText("Applied");
  await expect(lifecycleHeading(page)).toHaveText("Applied");
  await expect(panel(page).getByText(`${utcDate(-3)} (3 days ago)`)).toBeVisible();

  const stageForm = panel(page).getByRole("form", { name: "Change stage" });
  await stageForm.getByLabel("Move to stage").selectOption({ label: "Recruiter screen" });
  await stageForm.getByRole("button", { name: "Update stage" }).click();
  await expect(stageBadge(page)).toHaveText("Recruiter screen");

  await panel(page).getByText("Add contact", { exact: true }).click();
  const contactForm = panel(page).getByRole("form", { name: "Add contact" });
  await contactForm.getByLabel("Name").fill("Dana Reyes");
  await contactForm.getByLabel("LinkedIn or profile URL (optional)").fill("https://www.linkedin.com/in/e2e-dana");
  await contactForm.getByRole("button", { name: "Save contact" }).click();
  const contacts = panel(page).getByRole("list", { name: "Contacts" });
  await expect(contacts).toContainText("Dana Reyes");
  await expect(contacts.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "https://www.linkedin.com/in/e2e-dana");

  const noteForm = panel(page).getByRole("form", { name: "Add note" });
  await noteForm.getByLabel("New note").fill("Recruiter screen went well.");
  await noteForm.getByRole("button", { name: "Add note" }).click();
  await expect(panel(page).getByRole("list", { name: "Notes" })).toContainText("Recruiter screen went well.");

  const followUpForm = panel(page).getByRole("form", { name: "Add follow-up" });
  await followUpForm.getByLabel("Next action").fill("Email Dana a thank-you");
  await followUpForm.getByLabel("Due (UTC date)").fill(utcDate(-1));
  await followUpForm.getByRole("button", { name: "Add follow-up" }).click();
  await expect(panel(page).getByText(/Next action: Email Dana a thank-you — overdue since/)).toBeVisible();

  // Dashboard row and the "Follow-ups due" attention item.
  await page.goto(`/?view=applied&q=${token}`);
  const row = page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("Recruiter screen");
  await expect(row).toContainText(`Follow-up overdue · ${utcDate(-1)}`);
  await page.getByRole("link", { name: /^Follow-ups due: [1-9]\d*$/ }).click();
  await expect(page).toHaveURL(/\/applications\?followUp=due$/);
  await expect(page.getByRole("table", { name: "Applications" })).toContainText(title);

  // Completing the follow-up removes it from "due".
  await page.goto(`/opportunities/${opportunityId}`);
  await panel(page).getByRole("list", { name: "Follow-ups" }).getByRole("button", { name: "Mark done" }).click();
  await expect(panel(page).getByText("No open follow-ups.")).toBeVisible();
  await page.goto(`/applications?followUp=due&q=${token}`);
  await expect(page.getByText("No applications match these filters.")).toBeVisible();

  await page.goto(`/opportunities/${opportunityId}`);
  await panel(page).getByText("Add interview", { exact: true }).click();
  const interviewForm = panel(page).getByRole("form", { name: "Add interview" });
  await interviewForm.getByLabel("Type").selectOption({ label: "Hiring manager" });
  await interviewForm.getByLabel("Interviewer (optional)").selectOption({ label: "Dana Reyes" });
  await interviewForm.getByRole("button", { name: "Save interview" }).click();
  await expect(panel(page).getByRole("list", { name: "Interviews" })).toContainText("With Dana Reyes");
  await expect(panel(page).getByRole("button", { name: "Move to Interviewing" })).toBeVisible();

  await panel(page).getByText("Close application", { exact: true }).first().click();
  const closeForm = panel(page).getByRole("form", { name: "Close application" });
  await closeForm.getByLabel("Outcome").selectOption({ label: "Rejected by employer" });
  await closeForm.getByLabel("Reason or note (optional)").fill("Role filled internally");
  await closeForm.getByRole("button", { name: "Close application" }).click();
  await expect(stageBadge(page)).toHaveText("Rejected by employer");
  await expect(lifecycleHeading(page)).toHaveText("Applied");

  const expectedHistory = [
    /^Closed: Rejected by employer on .+ — Role filled internally$/,
    /^Interview added: Hiring manager$/,
    /^Follow-up completed: Email Dana a thank-you$/,
    /^Follow-up added: Email Dana a thank-you/,
    /^Note added$/,
    /^Contact added: Dana Reyes$/,
    /^Stage changed from Applied to Recruiter screen$/,
    /^Application submitted on /,
    /^Started tracking \(Planning to apply\)$/,
  ];
  const history = panel(page).getByRole("list", { name: "Application history" }).locator("li > span");
  await expect(history).toHaveCount(expectedHistory.length);
  for (const [index, pattern] of expectedHistory.entries()) await expect(history.nth(index)).toHaveText(pattern);

  await page.reload();
  await expect(stageBadge(page)).toHaveText("Rejected by employer");
  await expect(history).toHaveCount(expectedHistory.length);
  await expect(panel(page).getByRole("list", { name: "Notes" })).toContainText("Recruiter screen went well.");
});

test("an opportunity already marked as applied can only be tracked as submitted", async ({ page, request }) => {
  const token = `B${Date.now()}`;
  const opportunityId = await createOpportunity(request, `Applied Onboarding Lead ${token}`, `Appliedco ${token}`);
  expect((await request.post(`/api/opportunities/${opportunityId}/action`, { data: { action: "MARK_APPLIED" } })).status()).toBe(200);

  await page.goto(`/opportunities/${opportunityId}`);
  await expect(panel(page).getByRole("button", { name: "Planning to apply" })).toHaveCount(0);
  await expect(panel(page).getByText(`Marked as applied on ${utcDate()}.`)).toBeVisible();
  await expect(panel(page).getByLabel("Applied on (UTC date)")).toHaveValue(utcDate());
  // A direct request for a plan is refused.
  const refused = await request.post(`/api/opportunities/${opportunityId}/application`, { data: { mode: "plan" } });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "APPLICATION_ALREADY_SUBMITTED" });

  await panel(page).getByRole("button", { name: "Track this application" }).click();
  await expect(stageBadge(page)).toHaveText("Applied");
  await expect(panel(page).getByRole("list", { name: "Application history" })).toContainText("already marked as applied");
  await page.goto(`/?view=applied&q=${token}`);
  await expect(page.getByRole("list", { name: "Opportunities" }).getByRole("listitem").first()).toContainText("Applied");
});

// Task 8 completion pass. The browser runs far ahead of UTC (UTC+14), where a
// local/UTC date shift would show up first: every date typed must come back
// as exactly the same calendar date after the API, database, and a reload.
test.describe("tracker completion", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("reschedule a follow-up, edit an interview, close and reopen; everything survives reload", async ({ page, request }) => {
    const token = `C${Date.now()}`;
    const opportunityId = await createOpportunity(request, `Completion Renewal Manager ${token}`, `Completionco ${token}`);
    expect((await request.post(`/api/opportunities/${opportunityId}/action`, { data: { action: "SAVE" } })).status()).toBe(200);

    await page.goto(`/opportunities/${opportunityId}`);
    await panel(page).getByRole("button", { name: "I've applied" }).click();
    await panel(page).getByLabel("Applied on (UTC date)").fill(utcDate(-6));
    await panel(page).getByRole("button", { name: "Save as applied" }).click();
    await expect(stageBadge(page)).toHaveText("Applied");
    await expect(panel(page).getByText(`${utcDate(-6)} (6 days ago)`)).toBeVisible();

    // Overdue follow-up, then rescheduled out of overdue.
    const add = panel(page).getByRole("form", { name: "Add follow-up" });
    await add.getByLabel("Next action").fill("Ask about the timeline");
    await add.getByLabel("Due (UTC date)").fill(utcDate(-2));
    await add.getByRole("button", { name: "Add follow-up" }).click();
    await expect(panel(page).getByText(`Next action: Ask about the timeline — overdue since ${utcDate(-2)}`)).toBeVisible();
    await panel(page).getByRole("button", { name: "Edit follow-up: Ask about the timeline" }).click();
    const edit = panel(page).getByRole("form", { name: "Edit follow-up" });
    await edit.getByLabel("Due (UTC date)").fill(utcDate(3));
    await edit.getByRole("button", { name: "Save follow-up" }).click();
    await expect(panel(page).getByText(`Next action: Ask about the timeline — due ${utcDate(3)} (in 3 days)`)).toBeVisible();
    await page.goto(`/applications?followUp=overdue&q=${token}`);
    await expect(page.getByText("No applications match these filters.")).toBeVisible();
    await page.goto(`/applications?followUp=upcoming&q=${token}`);
    await expect(page.getByRole("table", { name: "Applications" })).toContainText(`Upcoming · ${utcDate(3)}`);

    // Interviews: a cancelled one does not suggest Interviewing; a completed one does.
    await page.goto(`/opportunities/${opportunityId}`);
    await panel(page).getByText("Add interview", { exact: true }).click();
    const interviewForm = panel(page).getByRole("form", { name: "Add interview" });
    await interviewForm.getByLabel("Type").selectOption({ label: "Case study / assessment" });
    await interviewForm.getByLabel("Status").selectOption({ label: "Cancelled" });
    await interviewForm.getByRole("button", { name: "Save interview" }).click();
    const interviews = panel(page).getByRole("list", { name: "Interviews" });
    await expect(interviews).toContainText("Cancelled");
    await expect(panel(page).getByRole("button", { name: "Move to Interviewing" })).toHaveCount(0);
    await interviews.getByRole("button", { name: "Edit details" }).click();
    const editInterview = panel(page).getByRole("form", { name: "Edit interview Case study / assessment" });
    await editInterview.getByLabel("Round (optional)").fill("Take-home review");
    await editInterview.getByLabel("Status").selectOption({ label: "Completed" });
    await editInterview.getByRole("button", { name: "Save interview" }).click();
    await expect(interviews).toContainText("Take-home review");
    await panel(page).getByRole("button", { name: "Move to Interviewing" }).click();
    await expect(stageBadge(page)).toHaveText("Interviewing");

    // Close as withdrawn on a chosen date, check it after reload, then reopen.
    await panel(page).getByText("Close application", { exact: true }).first().click();
    const closeForm = panel(page).getByRole("form", { name: "Close application" });
    await closeForm.getByLabel("Outcome").selectOption({ label: "Withdrew application" });
    await closeForm.getByLabel("Closed on (UTC date)").fill(utcDate(-1));
    await closeForm.getByRole("button", { name: "Close application" }).click();
    await expect(stageBadge(page)).toHaveText("Withdrew application");
    await expect(panel(page).getByText("This application is closed, so it has no next action.")).toBeVisible();
    await page.reload();
    await expect(panel(page).getByText(`Withdrew application · closed ${utcDate(-1)}`)).toBeVisible();
    await expect(panel(page).getByText(`${utcDate(-6)} (6 days ago)`)).toBeVisible();
    await page.goto(`/applications?view=all&q=${token}`);
    await expect(page.getByRole("table", { name: "Applications" })).toContainText("None · closed");

    await page.goto(`/opportunities/${opportunityId}`);
    await panel(page).getByRole("button", { name: "Reopen application" }).click();
    await expect(stageBadge(page)).toHaveText("Interviewing");
    await expect(panel(page).getByText(`Next action: Ask about the timeline — due ${utcDate(3)} (in 3 days)`)).toBeVisible();
    await expect(lifecycleHeading(page)).toHaveText("Applied");

    const history = panel(page).getByRole("list", { name: "Application history" });
    await expect(history).toContainText(`Follow-up updated: Ask about the timeline (rescheduled from ${utcDate(-2)} to ${utcDate(3)})`);
    await page.reload();
    await expect(stageBadge(page)).toHaveText("Interviewing");
    await expect(interviews).toContainText("Take-home review");
    await expect(interviews).toContainText("Completed");
    await expect(panel(page).getByText(`${utcDate(-6)} (6 days ago)`)).toBeVisible();

    // The server refuses a future applied date even without the picker limit.
    const { application } = (await (await request.get(`/api/opportunities/${opportunityId}/application`)).json()) as {
      application: { id: string; version: number; appliedOn: string };
    };
    expect(application.appliedOn).toBe(utcDate(-6));
    const refused = await request.post(`/api/applications/${application.id}`, {
      data: { command: "correctAppliedOn", expectedVersion: application.version, appliedOn: utcDate(1) },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "APPLICATION_DATE_INVALID" });
  });

  test("a blocked lifecycle action is explained, and tracker views recover from empty results", async ({ page, request }) => {
    const token = `D${Date.now()}`;
    const title = `Completion Onboarding Specialist ${token}`;
    const opportunityId = await createOpportunity(request, title, `Recoverco ${token}`);
    expect((await request.post(`/api/opportunities/${opportunityId}/action`, { data: { action: "SAVE" } })).status()).toBe(200);
    const created = await request.post(`/api/opportunities/${opportunityId}/application`, { data: { mode: "plan" } });
    expect(created.status()).toBe(201);
    const { application } = (await created.json()) as { application: { id: string; version: number } };

    // Dismissing would contradict the active plan: refused, and the card says why.
    const dismiss = await request.post(`/api/opportunities/${opportunityId}/action`, { data: { action: "DISMISS" } });
    expect(dismiss.status()).toBe(409);
    expect(await dismiss.json()).toMatchObject({ code: "APPLICATION_BLOCKS_ACTION" });
    await page.goto(`/opportunities/${opportunityId}`);
    await expect(page.getByText("Dismiss — Close the application first, for example as 'Decided not to apply'")).toBeVisible();
    await expect(lifecycleHeading(page)).toHaveText("Saved");

    const closed = await request.post(`/api/applications/${application.id}`, {
      data: { command: "close", expectedVersion: application.version, outcome: "NOT_SUBMITTED" },
    });
    expect(closed.status()).toBe(200);

    // An outcome filter chosen under the default Active view shows what it names.
    await page.goto(`/applications?outcome=not-submitted&q=${token}`);
    // The tracker search is normalized to lower case in the canonical URL.
    await expect(page).toHaveURL(new RegExp(`/applications\\?view=all&q=${token.toLowerCase()}&outcome=not-submitted$`));
    await expect(page.getByRole("table", { name: "Applications" })).toContainText(title);

    // An empty Active result recovers inside the tracker.
    await page.goto(`/applications?q=${token}`);
    await expect(page.getByText("No applications match these filters.")).toBeVisible();
    await page.getByRole("link", { name: "Search all applications" }).click();
    await expect(page).toHaveURL(new RegExp(`/applications\\?view=all&q=${token.toLowerCase()}$`));
    await expect(page.getByRole("table", { name: "Applications" })).toContainText("Decided not to apply");
  });
});
