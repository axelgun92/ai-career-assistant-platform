import { knownSiteByKey, pageCaptureDetailMechanism, pageCaptureSiteByKey, pageCaptureSites, pageCaptureTabStaleMs } from "@ai-career/core";
import {
  PrismaPageCaptureRepository,
  type CapturedJobRow,
  type PageCaptureItemStatusValue,
  type PageCaptureListRow,
  type PageCaptureSessionRow,
} from "@ai-career/database";
import { z } from "zod";
import { statusText, type PageCaptureRowView } from "../components/extension/page-capture-labels";
import { extensionError, extensionJson, readJsonBody, requireSameOrigin } from "./extension-auth";

// The progress page's reads and Alex's actions on staged jobs (Mode B).

export const pageCaptureFilters = {
  waiting: ["QUEUED", "ACQUIRING", "AWAITING_DETAILS"],
  added: ["INGESTED", "ALREADY_SAVED"],
  unavailable: ["UNAVAILABLE"],
  dismissed: ["DISMISSED"],
} as const satisfies Record<string, readonly PageCaptureItemStatusValue[]>;
export type PageCaptureFilter = keyof typeof pageCaptureFilters | "all";

export const pageCapturePageSize = 50;

// The sites whose details the extension reads in background tabs.
const tabSiteKeys = pageCaptureSites.filter((site) => pageCaptureDetailMechanism(site) === "extension-tabs").map((site) => site.key);
const isTabSite = (key: string) => tabSiteKeys.includes(key);

export function rowView(row: PageCaptureListRow): PageCaptureRowView {
  return {
    id: row.id,
    site: row.site,
    siteName: pageCaptureSiteByKey(row.site)?.name ?? row.site,
    title: row.title,
    // Once saved, the job's own company and location; the card's before
    // (a WTTJ card states no location; November 5, 2026).
    company: row.opportunityCompany ?? row.company,
    location: row.opportunityLocation ?? row.location,
    postedText: row.postedText,
    sourceUrl: row.sourceUrl,
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    status: row.status,
    lastReason: row.lastReason,
    lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt).toISOString() : null,
    resolvedOpportunityId: row.resolvedOpportunityId,
    opportunityTitle: row.opportunityTitle,
    triageOutcome: row.triageOutcome,
    triageManualDecision: row.triageManualDecision,
    evaluationStatus: row.evaluationStatus,
    recommendation: row.recommendation,
    handoffOutcome: row.handoffOutcome,
    // A job read in background tabs is read again only by a new save of a
    // results page that shows it, never by Retry.
    retryable: !isTabSite(row.site),
  };
}

// A site's display name: a results-page site, a known site, else its host.
export function capturedSiteName(site: string, host: string | null): string {
  return pageCaptureSiteByKey(site)?.name ?? knownSiteByKey(site)?.name ?? (host || site || "Unknown site");
}

export function capturedJobView(row: CapturedJobRow): PageCaptureRowView {
  return {
    id: row.id,
    site: row.site,
    siteName: capturedSiteName(row.site, row.host),
    title: row.title,
    // Once saved, the job's own company and location; the card's before
    // (a WTTJ card states no location; November 5, 2026).
    company: row.opportunityCompany ?? row.company,
    location: row.opportunityLocation ?? row.location,
    postedText: row.postedText,
    sourceUrl: row.sourceUrl ?? "",
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    status: row.status,
    lastReason: row.lastReason,
    lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt).toISOString() : null,
    resolvedOpportunityId: row.resolvedOpportunityId,
    opportunityTitle: row.opportunityTitle,
    triageOutcome: row.triageOutcome,
    triageManualDecision: row.triageManualDecision,
    evaluationStatus: row.evaluationStatus,
    recommendation: row.recommendation,
    handoffOutcome: row.handoffOutcome,
    retryable: row.method === "batch" ? !isTabSite(row.site) : false,
    method: row.method,
    capturedAt: new Date(row.capturedAt).toISOString(),
    alsoSingle: row.alsoSingle === true,
  };
}

// The jobs a capture found already saved by an earlier capture, as recorded
// at that save (older saves recorded none).
export function savedBeforeIds(counts: unknown): Set<string> {
  const ids = counts && typeof counts === "object" ? (counts as { alreadySavedItemIds?: unknown }).alreadySavedItemIds : undefined;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

const countOf = (counts: unknown, key: string) => {
  const value = counts && typeof counts === "object" ? (counts as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

export type CaptureMethodFilter = "all" | "batch" | "single";

export interface CaptureSessionView {
  id: string;
  site: string;
  siteName: string;
  pageUrl: string;
  pageTitle: string | null;
  receivedAt: string;
  jobs: number;
  pending: number;
  added: number;
  awaiting: number;
  unavailable: number;
  dismissed: number;
  // Of this capture's jobs, those already saved by an earlier capture when
  // it was made (counted in added).
  alreadySaved: number;
  // Still being read (jobs queued or being read now).
  inProgress: boolean;
}

export function sessionView(row: PageCaptureSessionRow): CaptureSessionView {
  return {
    id: row.id,
    site: row.site,
    siteName: capturedSiteName(row.site, null),
    pageUrl: row.pageUrl,
    pageTitle: row.pageTitle,
    receivedAt: new Date(row.receivedAt).toISOString(),
    jobs: row.jobs,
    pending: row.pending,
    added: row.added,
    awaiting: row.awaiting,
    unavailable: row.unavailable,
    dismissed: row.dismissed,
    alreadySaved: countOf(row.counts, "alreadySaved"),
    inProgress: row.pending > 0,
  };
}

export const captureSessionsPageSize = 10;

// Captured Jobs: every job the extension captured (single-job and results
// pages), with optional method, status, site and session filters, and the
// capture history beside it.
export async function capturedJobs(
  input: { method: CaptureMethodFilter; filter: PageCaptureFilter; site: string | null; sessionId: string | null; page: number },
  repository = new PrismaPageCaptureRepository(),
  now: () => Date = () => new Date(),
) {
  await repository.expireTabItems(tabSiteKeys, new Date(now().getTime() - pageCaptureTabStaleMs));
  const statuses = input.filter === "all" ? null : [...pageCaptureFilters[input.filter]];
  const session = input.sessionId ? await repository.findSession(input.sessionId) : null;
  const [list, sessions] = await Promise.all([
    repository.capturedJobs({
      method: session ? "batch" : input.method,
      statuses,
      site: input.site,
      itemIds: session ? session.itemIds : null,
      page: input.page,
      pageSize: pageCapturePageSize,
    }),
    repository.listSessions({ site: null, page: 1, pageSize: captureSessionsPageSize }),
  ]);
  const before = session ? savedBeforeIds(session.counts) : new Set<string>();
  return {
    rows: list.rows.map((row) => ({ ...capturedJobView(row), ...(session ? { savedBefore: before.has(row.id) } : {}) })),
    total: list.total,
    session: session
      ? { id: session.id, site: session.site, siteName: capturedSiteName(session.site, null), pageUrl: session.pageUrl, pageTitle: session.pageTitle, receivedAt: session.receivedAt.toISOString() }
      : null,
    sessions: sessions.rows.map(sessionView),
    sessionsTotal: sessions.total,
  };
}

// For the extension's side panel: recent capture sessions, and one session's
// jobs with each job's state in the app's own words.
export async function extensionCaptureSessions(limit: number, repository = new PrismaPageCaptureRepository(), now: () => Date = () => new Date()) {
  await repository.expireTabItems(tabSiteKeys, new Date(now().getTime() - pageCaptureTabStaleMs));
  const sessions = await repository.listSessions({ site: null, page: 1, pageSize: Math.max(1, Math.min(25, limit)) });
  return { sessions: sessions.rows.map(sessionView) };
}

export async function extensionCaptureSession(id: string, repository = new PrismaPageCaptureRepository(), now: () => Date = () => new Date()) {
  await repository.expireTabItems(tabSiteKeys, new Date(now().getTime() - pageCaptureTabStaleMs));
  const session = await repository.findSession(id);
  if (!session) return null;
  const [list, summary] = await Promise.all([
    repository.capturedJobs({ method: "batch", statuses: null, site: null, itemIds: session.itemIds, page: 1, pageSize: 100 }),
    repository.listSessions({ site: null, page: 1, pageSize: 1, id: session.id }),
  ]);
  const own = summary.rows[0];
  const before = savedBeforeIds(session.counts);
  return {
    session: own ? sessionView(own) : null,
    jobs: list.rows.map((row) => {
      const view = capturedJobView(row);
      return {
        id: view.id,
        title: view.opportunityTitle ?? view.title,
        company: view.company,
        location: view.location,
        status: view.status,
        statusText: statusText(view),
        savedBefore: before.has(view.id),
        opportunityPath: view.resolvedOpportunityId ? `/opportunities/${view.resolvedOpportunityId}` : null,
        sourceUrl: view.sourceUrl || null,
      };
    }),
  };
}

export async function pageCaptureProgress(
  input: { filter: PageCaptureFilter; site: string | null; page: number },
  repository = new PrismaPageCaptureRepository(),
  now: () => Date = () => new Date(),
) {
  // Jobs whose background-tab reading stopped with the browser show as
  // interrupted, never as still being read.
  await repository.expireTabItems(tabSiteKeys, new Date(now().getTime() - pageCaptureTabStaleMs));
  const statuses = input.filter === "all" ? null : [...pageCaptureFilters[input.filter]];
  const [list, counts] = await Promise.all([
    repository.list({ statuses, site: input.site, page: input.page, pageSize: pageCapturePageSize }),
    repository.statusCounts(),
  ]);
  return { rows: list.rows.map(rowView), total: list.total, counts };
}

const actionSchema = z.object({ action: z.enum(["retry", "dismiss", "restore"]) }).strict();

export async function handlePageCaptureAction(request: Request, id: string, repository = new PrismaPageCaptureRepository()) {
  const refused = requireSameOrigin(request);
  if (refused) return extensionError("SAME_ORIGIN_REQUIRED", "Jobs from results pages are managed only from AI Job Assistant");
  if (!z.uuid().safeParse(id).success) return extensionError("NOT_FOUND", "Job not found");
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return body.response;
  const parsed = actionSchema.safeParse(body.body);
  if (!parsed.success) return extensionError("INVALID_REQUEST", "The action is invalid");
  if (parsed.data.action === "retry") {
    const existing = await repository.findById(id);
    if (existing && isTabSite(existing.site)) {
      return extensionError("INVALID_REQUEST", "Save the results page that shows this job again to read its details");
    }
  }
  const item =
    parsed.data.action === "retry" ? await repository.retry(id) : parsed.data.action === "dismiss" ? await repository.dismiss(id) : await repository.restore(id);
  if (!item) return extensionError("NOT_FOUND", "This job cannot be changed that way now");
  return extensionJson({ id: item.id, status: item.status });
}
