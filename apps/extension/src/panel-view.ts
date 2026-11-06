import type { CaptureSessionSummary } from "./api";

// The side panel's choices and wording, kept pure (no chrome.*, no DOM) so
// they can be tested: which capture mode a page starts in, how a capture
// session is described, and which sessions are the current and latest ones.
// Every message is plain text.

export type CaptureMode = "single" | "batch";

// A supported results page starts in Batch Capture; any other page in Single
// Job. The user can always switch.
export function defaultMode(input: { resultsPageOffered: boolean }): CaptureMode {
  return input.resultsPageOffered ? "batch" : "single";
}

// What Single Job says on a results page: it reads one posting, so the
// results page itself is never read into the single-job form.
export const singleOnResultsPage =
  "This is a results page with several jobs. Single Job reads one job posting: open a job's own page to save it, or use Batch Capture here.";

export const batchOnOtherPage =
  "Batch Capture works on a supported results page (for example a LinkedIn job search). This page is not one; your captures stay available below.";

// The panel cannot see or read a page it has not been given access to (the
// extension asks for no broad host permission): one click on the toolbar
// button gives it access to the page shown.
export const pageAccessNeeded = "To read this page, click the AI Job Assistant button in the toolbar. Your captures stay available below.";

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function sessionCounts(
  session: Pick<CaptureSessionSummary, "jobs" | "pending" | "added" | "awaiting" | "unavailable" | "dismissed" | "alreadySaved">,
): string {
  const parts = [`${session.added} added${session.alreadySaved ? ` (${session.alreadySaved} already saved before)` : ""}`];
  if (session.pending) parts.push(`${session.pending} getting details`);
  if (session.awaiting) parts.push(`${session.awaiting} awaiting details`);
  if (session.unavailable) parts.push(`${session.unavailable} no longer available`);
  if (session.dismissed) parts.push(`${session.dismissed} dismissed`);
  return `${session.jobs} job${session.jobs === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

export function sessionLine(session: CaptureSessionSummary): string {
  return [session.siteName, when(session.receivedAt), sessionCounts(session)].filter(Boolean).join(" · ");
}

export function sessionHeading(session: CaptureSessionSummary): string {
  return `${session.inProgress ? "Current capture" : "Capture"}: ${session.siteName}${session.receivedAt ? `, ${when(session.receivedAt)}` : ""}`;
}

// The capture in progress (the newest one with jobs still being read), the
// latest finished one, and the others, newest first.
export function arrangeSessions(sessions: readonly CaptureSessionSummary[]): {
  current: CaptureSessionSummary | null;
  latest: CaptureSessionSummary | null;
  previous: CaptureSessionSummary[];
} {
  const current = sessions.find((session) => session.inProgress) ?? null;
  const latest = sessions.find((session) => !session.inProgress) ?? null;
  return { current, latest, previous: sessions.filter((session) => session !== current && session !== latest) };
}

// One job of a capture, as the panel lists it.
export function sessionJobDetail(job: { company: string | null; location?: string | null; statusText: string; savedBefore?: boolean }): string {
  return `${job.company ? ` · ${job.company}` : ""}${job.location ? ` · ${job.location}` : ""} — ${job.statusText}${job.savedBefore ? " · already saved before this capture" : ""}`;
}

// The app's Captured Jobs page, for one capture session or all of them.
export const capturedJobsPath = (sessionId?: string | null) => (sessionId ? `/extension/jobs?session=${encodeURIComponent(sessionId)}` : "/extension/jobs");
