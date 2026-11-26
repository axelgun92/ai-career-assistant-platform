// @vitest-environment jsdom
// Task 8 completion pass: follow-up and interview editing, conflict classes,
// input preservation across refreshes, next-action visibility, and empty
// states.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationListItem, ApplicationTrackerSummary } from "@ai-career/database";
import { timelineSentence, type TimelineEventView } from "../../apps/web/src/components/application/labels";
import type { ApplicationView } from "../../apps/web/src/components/application/types";
import { parseApplicationQuery } from "../../apps/web/src/server/application-query";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => router }));
const { FollowUps } = await import("../../apps/web/src/components/application/follow-ups");
const { Interviews } = await import("../../apps/web/src/components/application/interviews");
const { StageControls } = await import("../../apps/web/src/components/application/stage-controls");
const { ApplicationLoadError } = await import("../../apps/web/src/components/application/application-panel");
const { ApplicationEmptyState, ApplicationTable } = await import("../../apps/web/src/components/application/application-list");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const applicationId = "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22";
const opportunityId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const followUpId = "2c9f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a44";
const interviewId = "3c9f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a55";
const today = "2026-10-15";

function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: applicationId,
    opportunityId,
    stage: "APPLIED",
    outcome: null,
    appliedOn: "2026-10-01",
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

const followUp = { id: followUpId, description: "Email the recruiter", dueOn: "2026-10-10", completedAt: null, version: 3 };
const interview = {
  id: interviewId,
  kind: "PANEL" as const,
  roundLabel: "Round 2",
  scheduledAt: "2026-10-20T16:30:45.123Z",
  status: "SCHEDULED" as const,
  contactId: null,
  notes: null,
  version: 2,
};

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
const button = (name: string, scope: ParentNode = container) => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const hasButton = (name: string) => [...container.querySelectorAll("button")].some((item) => item.textContent?.trim() === name);
const form = (name: string) => container.querySelector<HTMLFormElement>(`form[aria-label="${name}"]`)!;
const field = <T extends HTMLElement>(scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(label))!.querySelector("input, select, textarea") as T;
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function choose(element: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call]![1].body as string);
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? "";

describe("follow-up editing", () => {
  it("reschedules a follow-up with its own version and keeps the edit on a conflict", async () => {
    render(<FollowUps application={application({ followUps: [followUp] })} today={today} readOnly={false} opportunityStatus="APPLIED" />);
    expect(container.textContent).toContain("Next action: Email the recruiter — overdue since 2026-10-10");
    act(() => button("Edit").click());
    const edit = form("Edit follow-up");
    type(field<HTMLInputElement>(edit, "Due"), "2026-10-18");
    type(field<HTMLInputElement>(edit, "Next action"), "Email the recruiter again");
    fetchMock.mockResolvedValueOnce(respond(409, { code: "APPLICATION_CHANGED", error: "Changed" }));
    act(() => button("Save follow-up").click());
    await settle();
    expect(sentBody()).toEqual({
      command: "updateFollowUp",
      followUpId,
      expectedVersion: 3,
      description: "Email the recruiter again",
      dueOn: "2026-10-18",
    });
    expect(field<HTMLInputElement>(form("Edit follow-up"), "Due").value).toBe("2026-10-18");
    expect(alertText()).toContain("This application changed elsewhere");
    act(() => button("Load latest").click());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(field<HTMLInputElement>(form("Edit follow-up"), "Next action").value).toBe("Email the recruiter again");
    fetchMock.mockResolvedValueOnce(respond(200, { application: {} }));
    act(() => button("Save follow-up").click());
    await settle();
    expect(container.querySelector('form[aria-label="Edit follow-up"]')).toBeNull();
  });

  it("a closed application, or an archived opportunity, has no next action", () => {
    const closed = renderToStaticMarkup(
      <FollowUps
        application={application({ stage: "CLOSED", outcome: "REJECTED", closedOn: "2026-10-12", followUps: [followUp] })}
        today={today}
        readOnly={false}
        opportunityStatus="APPLIED"
      />,
    );
    expect(closed).toContain("This application is closed, so it has no next action.");
    expect(closed).not.toContain("Next action:");
    const archived = renderToStaticMarkup(
      <FollowUps application={application({ followUps: [followUp] })} today={today} readOnly opportunityStatus="ARCHIVED" />,
    );
    expect(archived).toContain("This opportunity is archived, so its follow-ups are not due.");
    expect(archived).not.toContain(">Edit<");
    expect(archived).not.toContain("Mark done");
  });
});

describe("conflict classes", () => {
  it("a validation refusal shows only its message and keeps the typed dates", async () => {
    render(<StageControls application={application()} today={today} reopenBlockedReason={null} />);
    const close = form("Close application");
    type(field<HTMLInputElement>(close, "Closed on"), "2026-09-30");
    type(field<HTMLTextAreaElement>(close, "Reason"), "Heard back by phone");
    fetchMock.mockResolvedValueOnce(
      respond(400, { code: "APPLICATION_DATE_INVALID", error: "The closed date cannot be earlier than the applied date" }),
    );
    // The picker's min blocks this date in the browser…
    act(() => button("Close application", close).click());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    // …and the server refuses it when a request arrives anyway.
    act(() => {
      close.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(sentBody()).toMatchObject({ command: "close", expectedVersion: 4, closedOn: "2026-09-30", reason: "Heard back by phone" });
    expect(alertText()).toBe("The closed date cannot be earlier than the applied date");
    expect(hasButton("Load latest")).toBe(false);
    expect(field<HTMLInputElement>(close, "Closed on").value).toBe("2026-09-30");
    expect(field<HTMLTextAreaElement>(close, "Reason").value).toBe("Heard back by phone");
  });

  it.each(["OPPORTUNITY_ARCHIVED", "APPLICATION_EXISTS", "APPLICATION_ALREADY_SUBMITTED", "OPPORTUNITY_NOT_TRACKABLE"])(
    "%s offers Load latest and keeps the input",
    async (code) => {
      render(<FollowUps application={application({ followUps: [followUp] })} today={today} readOnly={false} opportunityStatus="APPLIED" />);
      const add = form("Add follow-up");
      type(field<HTMLInputElement>(add, "Next action"), "Send thank-you note");
      fetchMock.mockResolvedValueOnce(respond(409, { code, error: "The opportunity changed" }));
      act(() => button("Add follow-up").click());
      await settle();
      expect(alertText()).toContain("The opportunity changed. Your changes are still here.");
      expect(hasButton("Load latest")).toBe(true);
      expect(field<HTMLInputElement>(add, "Next action").value).toBe("Send thank-you note");
    },
  );

  it.each(["APPLICATION_TRANSITION_NOT_ALLOWED", "APPLIED_DATE_NOT_APPLICABLE", "CONTACT_NOT_IN_APPLICATION"])(
    "%s shows only its message",
    async (code) => {
      render(<FollowUps application={application()} today={today} readOnly={false} opportunityStatus="APPLIED" />);
      type(field<HTMLInputElement>(form("Add follow-up"), "Next action"), "Ping");
      fetchMock.mockResolvedValueOnce(respond(409, { code, error: "Refused for a reason" }));
      act(() => button("Add follow-up").click());
      await settle();
      expect(alertText()).toBe("Refused for a reason");
      expect(hasButton("Load latest")).toBe(false);
    },
  );
});

describe("stage controls keep input when the application changes", () => {
  it("a typed close reason survives a refresh that moved the stage", () => {
    render(<StageControls application={application()} today={today} reopenBlockedReason={null} />);
    type(field<HTMLTextAreaElement>(form("Close application"), "Reason"), "Chose another role");
    render(<StageControls application={application({ stage: "SCREENING", version: 5 })} today={today} reopenBlockedReason={null} />);
    expect(field<HTMLTextAreaElement>(form("Close application"), "Reason").value).toBe("Chose another role");
    const stage = field<HTMLSelectElement>(form("Change stage"), "Move to stage");
    expect([...stage.options].map((option) => option.value)).not.toContain("SCREENING");
    expect(stage.value).toBe("APPLIED");
  });

  it("the applied-date form shows a date changed elsewhere until the user types, then keeps the draft", () => {
    render(<StageControls application={application()} today={today} reopenBlockedReason={null} />);
    const applied = () => field<HTMLInputElement>(form("Correct the applied date"), "Applied on");
    expect(applied().value).toBe("2026-10-01");
    render(<StageControls application={application({ appliedOn: "2026-09-29", version: 5 })} today={today} reopenBlockedReason={null} />);
    expect(applied().value).toBe("2026-09-29");
    type(applied(), "2026-09-27");
    render(<StageControls application={application({ appliedOn: "2026-09-28", version: 6 })} today={today} reopenBlockedReason={null} />);
    expect(applied().value).toBe("2026-09-27");
  });

  it("date pickers state the calendar limits", () => {
    render(<StageControls application={application()} today={today} reopenBlockedReason={null} />);
    const closedOn = field<HTMLInputElement>(form("Close application"), "Closed on");
    expect(closedOn.min).toBe("2026-10-01");
    expect(closedOn.max).toBe(today);
    expect(field<HTMLInputElement>(form("Correct the applied date"), "Applied on").max).toBe(today);
  });
});

describe("interviews", () => {
  it("can be added with a status other than scheduled", async () => {
    render(<Interviews application={application()} readOnly={false} />);
    const add = form("Add interview");
    choose(field<HTMLSelectElement>(add, "Type"), "CASE_STUDY");
    choose(field<HTMLSelectElement>(add, "Status"), "COMPLETED");
    fetchMock.mockResolvedValueOnce(respond(200, { application: {} }));
    act(() => button("Save interview", add).click());
    await settle();
    expect(sentBody()).toMatchObject({ command: "addInterview", kind: "CASE_STUDY", status: "COMPLETED", scheduledAt: null });
  });

  it("edits every field and keeps an untouched time exactly", async () => {
    render(<Interviews application={application({ interviews: [interview] })} readOnly={false} />);
    act(() => button("Edit details").click());
    const edit = form("Edit interview Panel");
    type(field<HTMLInputElement>(edit, "Round"), "Final panel");
    choose(field<HTMLSelectElement>(edit, "Type"), "FINAL");
    type(field<HTMLTextAreaElement>(edit, "Notes"), "Bring the case study");
    fetchMock.mockResolvedValueOnce(respond(409, { code: "APPLICATION_CHANGED", error: "Changed" }));
    act(() => button("Save interview", edit).click());
    await settle();
    expect(sentBody()).toEqual({
      command: "updateInterview",
      interviewId,
      expectedVersion: 2,
      kind: "FINAL",
      roundLabel: "Final panel",
      scheduledAt: "2026-10-20T16:30:45.123Z",
      status: "SCHEDULED",
      contactId: "",
      notes: "Bring the case study",
    });
    expect(field<HTMLInputElement>(form("Edit interview Panel"), "Round").value).toBe("Final panel");
    expect(hasButton("Load latest")).toBe(true);
  });

  it("the quick status control follows a status saved elsewhere", () => {
    render(<Interviews application={application({ interviews: [interview] })} readOnly={false} />);
    const status = () => field<HTMLSelectElement>(form("Update interview Panel"), "Interview status");
    expect(status().value).toBe("SCHEDULED");
    render(<Interviews application={application({ interviews: [{ ...interview, status: "COMPLETED", version: 3 }] })} readOnly={false} />);
    expect(status().value).toBe("COMPLETED");
  });

  it("suggests Interviewing only when an interview is not cancelled", () => {
    const cancelled = renderToStaticMarkup(
      <Interviews application={application({ interviews: [{ ...interview, status: "CANCELLED" }] })} readOnly={false} />,
    );
    expect(cancelled).not.toContain("Move to Interviewing");
    const scheduled = renderToStaticMarkup(<Interviews application={application({ interviews: [interview] })} readOnly={false} />);
    expect(scheduled).toContain("Move to Interviewing");
  });
});

describe("tracker list and page states", () => {
  const item = (overrides: Partial<ApplicationListItem>): ApplicationListItem => ({
    id: applicationId,
    opportunityId,
    title: "Customer Success Manager",
    companyName: "Acme",
    opportunityStatus: "APPLIED",
    stage: "APPLIED",
    outcome: null,
    appliedOn: "2026-10-01",
    closedOn: null,
    nextFollowUp: null,
    lastActivityAt: new Date("2026-10-12T10:00:00.000Z"),
    ...overrides,
  });

  it("states closed and archived applications in the next-action cell", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTable
        items={[
          item({ id: "a", stage: "CLOSED", outcome: "WITHDRAWN", closedOn: "2026-10-11" }),
          item({ id: "b", opportunityStatus: "ARCHIVED" }),
          item({ id: "c" }),
        ]}
      />,
    );
    expect(markup).toContain("None · closed");
    expect(markup).toContain("None · opportunity archived (read-only)");
    expect(markup).toContain(">None<");
  });

  const summary = (active: number, closed: number): ApplicationTrackerSummary => ({
    active,
    closed,
    followUpsOverdue: 0,
    followUpsDueToday: 0,
    interviewsScheduled: 0,
    offers: 0,
  });
  const query = (search: string) => parseApplicationQuery(new URLSearchParams(search));

  it("recovers an empty Active view inside the tracker", () => {
    const markup = renderToStaticMarkup(<ApplicationEmptyState query={query("")} filtered={false} summary={summary(0, 2)} />);
    expect(markup).toContain("No active applications. 2 closed applications are in the other view.");
    expect(markup).toContain('href="/applications?view=all"');
    expect(markup).not.toContain('href="/"');
  });

  it("offers to clear filters or search all applications", () => {
    const markup = renderToStaticMarkup(
      <ApplicationEmptyState query={query("q=acme&followUp=overdue")} filtered summary={summary(3, 1)} />,
    );
    expect(markup).toContain("No applications match these filters.");
    expect(markup).toContain('href="/applications">Clear all filters');
    expect(markup).toContain('href="/applications?view=all&amp;q=acme&amp;followUp=overdue">Search all applications');
  });

  it("points to the dashboard only when nothing is tracked yet", () => {
    const markup = renderToStaticMarkup(<ApplicationEmptyState query={query("")} filtered={false} summary={summary(0, 0)} />);
    expect(markup).toContain("You are not tracking any applications yet.");
    expect(markup).toContain('href="/"');
  });

  it("explains an application that could not be loaded instead of hiding the panel", () => {
    const markup = renderToStaticMarkup(<ApplicationLoadError />);
    expect(markup).toContain("The application for this opportunity could not be loaded.");
    expect(markup).toContain('role="alert"');
  });

  it("describes follow-up updates in the history", () => {
    const event = (payload: Record<string, unknown>): TimelineEventView => ({
      id: "e", sequence: 3, type: "FOLLOW_UP_UPDATED", fromStage: null, toStage: null, outcome: null,
      occurredOn: "2026-10-18", payload, createdAt: "2026-10-15T12:00:00.000Z",
    });
    expect(timelineSentence(event({ description: "Email Dana", changedFields: ["dueOn"], previousDueOn: "2026-10-10", previousDescription: "Email Dana" })))
      .toBe("Follow-up updated: Email Dana (rescheduled from 2026-10-10 to 2026-10-18)");
    expect(timelineSentence(event({ description: "Call Dana", changedFields: ["description"], previousDueOn: "2026-10-18", previousDescription: "Email Dana" })))
      .toBe("Follow-up updated: Call Dana (was: Email Dana)");
  });
});
