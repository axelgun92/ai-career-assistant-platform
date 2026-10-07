// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applicationStatusLabel,
  relativeDays,
  timelineSentence,
  type TimelineEventView,
} from "../../apps/web/src/components/application/labels";
import type { ApplicationView } from "../../apps/web/src/components/application/types";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { StartTracking } = await import("../../apps/web/src/components/application/start-tracking");
const { Notes } = await import("../../apps/web/src/components/application/notes");
const { Contacts } = await import("../../apps/web/src/components/application/contacts");
const { StageControls } = await import("../../apps/web/src/components/application/stage-controls");
const { ApplicationPanel } = await import("../../apps/web/src/components/application/application-panel");
const { OpportunityActions } = await import("../../apps/web/src/components/opportunity-actions");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const applicationId = "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22";
const opportunityId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const contactId = "1c9f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a33";

function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: applicationId,
    opportunityId,
    stage: "APPLIED",
    outcome: null,
    appliedOn: "2026-09-25",
    closedOn: null,
    version: 4,
    notes: [],
    contacts: [],
    followUps: [],
    interviews: [],
    events: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  router.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (element: React.ReactNode) => act(() => root.render(element));
const button = (name: string) => {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const buttonNames = () => [...container.querySelectorAll("button")].map((item) => item.textContent?.trim());
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call]![1].body as string);
const conflict = () => respond(409, { code: "APPLICATION_CHANGED", error: "This application changed since you loaded it." });

describe("starting to track", () => {
  it("for an already-applied opportunity offers only 'Track this application', prefilled and editable", async () => {
    render(<StartTracking opportunityId={opportunityId} modes={["submitted"]} alreadyApplied effectiveAppliedOn="2026-09-15" today="2026-10-07" />);
    expect(buttonNames()).toEqual(["Track this application"]);
    expect(container.textContent).not.toContain("Planning to apply");
    expect(container.textContent).toContain("Marked as applied on 2026-09-15.");
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(date.value).toBe("2026-09-15");
    type(date, "2026-09-16");
    fetchMock.mockResolvedValue(respond(201, { application: {} }));
    act(() => button("Track this application").click());
    await settle();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/opportunities/${opportunityId}/application`);
    expect(sentBody()).toEqual({ mode: "submitted", appliedOn: "2026-09-16" });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("asks for confirmation when the applied date was not recorded", () => {
    render(<StartTracking opportunityId={opportunityId} modes={["submitted"]} alreadyApplied effectiveAppliedOn={null} today="2026-10-07" />);
    expect(container.textContent).toContain("Date not recorded — please confirm.");
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe("2026-10-07");
  });

  it("for a saved opportunity offers both a plan and a submission", async () => {
    render(<StartTracking opportunityId={opportunityId} modes={["plan", "submitted"]} alreadyApplied={false} effectiveAppliedOn={null} today="2026-10-07" />);
    expect(buttonNames()).toEqual(["Planning to apply", "I've applied"]);
    fetchMock.mockResolvedValue(respond(201, { application: {} }));
    act(() => button("Planning to apply").click());
    await settle();
    expect(sentBody()).toEqual({ mode: "plan" });
  });

  it("explains why tracking is unavailable for dismissed or archived opportunities", () => {
    render(<StartTracking opportunityId={opportunityId} modes={[]} alreadyApplied={false} effectiveAppliedOn={null} today="2026-10-07" />);
    expect(buttonNames()).toEqual([]);
    expect(container.textContent).toContain("Restore this opportunity to start tracking.");
  });
});

describe("stale-version conflicts keep typed input", () => {
  it("a new note survives a 409 and can be resubmitted after loading the latest data", async () => {
    render(<Notes application={application()} readOnly={false} />);
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    type(textarea, "Spoke with the hiring manager");
    fetchMock.mockResolvedValueOnce(conflict());
    act(() => button("Add note").click());
    await settle();
    expect(sentBody()).toEqual({ command: "addNote", body: "Spoke with the hiring manager" });
    expect(textarea.value).toBe("Spoke with the hiring manager");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("This application changed elsewhere");
    act(() => button("Load latest").click());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("Spoke with the hiring manager");
    fetchMock.mockResolvedValueOnce(respond(200, { application: {} }));
    act(() => button("Add note").click());
    await settle();
    expect(textarea.value).toBe("");
  });

  it("an edited contact keeps its fields on 409 and sends the contact's own version", async () => {
    const contact = { id: contactId, name: "Dana Reyes", role: "RECRUITER" as const, title: null, organization: "Acme", email: null, profileUrl: null, notes: null, version: 2 };
    render(<Contacts application={application({ contacts: [contact] })} readOnly={false} />);
    act(() => button("Edit").click());
    const title = [...container.querySelectorAll<HTMLInputElement>("input")].find((input) => input.closest("label")?.textContent?.startsWith("Role / title"))!;
    type(title, "Senior Recruiter");
    fetchMock.mockResolvedValueOnce(conflict());
    act(() => button("Save contact").click());
    await settle();
    expect(sentBody()).toMatchObject({ command: "updateContact", contactId, expectedVersion: 2, title: "Senior Recruiter", organization: "Acme" });
    expect(title.value).toBe("Senior Recruiter");
    expect(button("Load latest")).toBeTruthy();
  });

  it("stage commands send the application's version", async () => {
    render(<StageControls application={application({ stage: "PLANNED", appliedOn: null, version: 1 })} today="2026-10-07" reopenBlockedReason={null} />);
    fetchMock.mockResolvedValueOnce(respond(200, { application: {} }));
    act(() => button("I've applied").click());
    await settle();
    expect(sentBody()).toEqual({ command: "submit", expectedVersion: 1, appliedOn: "2026-10-07" });
  });

  it("a closed plan explains when it cannot be reopened", () => {
    render(
      <StageControls
        application={application({ stage: "CLOSED", outcome: "NOT_SUBMITTED", appliedOn: null, closedOn: "2026-10-02" })}
        today="2026-10-07"
        reopenBlockedReason="Restore the opportunity before reopening this plan."
      />,
    );
    expect(button("Reopen application").disabled).toBe(true);
    expect(container.textContent).toContain("Restore the opportunity before reopening this plan.");
    expect(container.textContent).not.toContain("Correct the applied date");
  });
});

describe("application display", () => {
  it("formats the summary, safe contact links, and a read-only archived view", () => {
    const markup = renderToStaticMarkup(
      <ApplicationPanel
        opportunityId={opportunityId}
        opportunityStatus="ARCHIVED"
        application={application({
          stage: "CLOSED",
          outcome: "REJECTED",
          closedOn: "2026-10-05",
          contacts: [
            { id: contactId, name: "Dana", role: "RECRUITER", title: null, organization: null, email: "dana@example.com", profileUrl: "javascript:alert(1)", notes: null, version: 1 },
          ],
        })}
        modes={[]}
        effectiveAppliedOn={null}
        reopenBlockedReason={null}
        today="2026-10-07"
      />,
    );
    expect(markup).toContain("This opportunity is archived, so its application is read-only.");
    expect(markup).toContain("Rejected by employer");
    expect(markup).toContain("2026-09-25 (12 days ago)");
    expect(markup).toContain('href="mailto:dana@example.com"');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Reopen application");
  });

  it("labels stages, outcomes, and relative dates", () => {
    expect(applicationStatusLabel("SCREENING", null)).toBe("Recruiter screen");
    expect(applicationStatusLabel("CLOSED", "NOT_SUBMITTED")).toBe("Decided not to apply");
    expect(relativeDays("2026-10-07", "2026-10-07")).toBe("today");
    expect(relativeDays("2026-10-06", "2026-10-07")).toBe("yesterday");
    expect(relativeDays("2026-10-10", "2026-10-07")).toBe("in 3 days");
  });

  it("turns history events into readable sentences", () => {
    const event = (overrides: Partial<TimelineEventView>): TimelineEventView => ({
      id: "e", sequence: 1, type: "CREATED", fromStage: null, toStage: null, outcome: null, occurredOn: null, payload: null,
      createdAt: "2026-10-07T12:00:00.000Z", ...overrides,
    });
    expect(timelineSentence(event({ type: "SUBMITTED", occurredOn: "2026-10-01", payload: { source: "tracker" } }))).toBe("Application submitted on 2026-10-01");
    expect(timelineSentence(event({ type: "SUBMITTED", occurredOn: "2026-09-15", payload: { source: "lifecycle" } }))).toContain("already marked as applied");
    expect(timelineSentence(event({ type: "STAGE_CHANGED", fromStage: "APPLIED", toStage: "SCREENING" }))).toBe("Stage changed from Applied to Recruiter screen");
    expect(timelineSentence(event({ type: "CLOSED", outcome: "WITHDRAWN", occurredOn: "2026-10-03", payload: { reason: "Took another offer" } })))
      .toBe("Closed: Withdrew application on 2026-10-03 — Took another offer");
    expect(timelineSentence(event({ type: "CONTACT_UPDATED", payload: { contactId, changedFields: ["title"] } }), { contacts: { [contactId]: "Dana" } }))
      .toBe("Contact updated: Dana (title)");
    expect(timelineSentence(event({ type: "INTERVIEW_UPDATED", payload: { kind: "PANEL", status: "COMPLETED", previousStatus: "SCHEDULED" } })))
      .toBe("Interview Panel: Scheduled → Completed");
    expect(timelineSentence(event({ type: "DETAILS_UPDATED", occurredOn: "2026-08-30", payload: { field: "appliedOn", previous: "2026-09-01" } })))
      .toBe("Applied date corrected from 2026-09-01 to 2026-08-30");
  });

  it("the lifecycle card hides actions the application blocks and says why", () => {
    const markup = renderToStaticMarkup(
      <OpportunityActions
        opportunityId={opportunityId}
        statusLabel="Saved"
        availableActions={["ARCHIVE", "RESTORE"]}
        blockedActions={[
          { action: "MARK_APPLIED", reason: "Record the submission in the Application section" },
          { action: "DISMISS", reason: "Close the application first" },
        ]}
      />,
    );
    expect(markup).toContain(">Archive<");
    expect(markup).not.toContain(">Mark as applied<");
    expect(markup).not.toContain(">Dismiss<");
    expect(markup).toContain("Mark as applied — Record the submission in the Application section");
  });
});
