import { pageCaptureSiteByKey } from "@ai-career/core";
import { PrismaPageCaptureRepository, type PageCaptureItemStatusValue, type PageCaptureListRow } from "@ai-career/database";
import { z } from "zod";
import type { PageCaptureRowView } from "@/components/extension/page-capture-list";
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

export function rowView(row: PageCaptureListRow): PageCaptureRowView {
  return {
    id: row.id,
    site: row.site,
    siteName: pageCaptureSiteByKey(row.site)?.name ?? row.site,
    title: row.title,
    company: row.company,
    location: row.location,
    postedText: row.postedText,
    sourceUrl: row.sourceUrl,
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    status: row.status,
    lastReason: row.lastReason,
    resolvedOpportunityId: row.resolvedOpportunityId,
    opportunityTitle: row.opportunityTitle,
    triageOutcome: row.triageOutcome,
    triageManualDecision: row.triageManualDecision,
    evaluationStatus: row.evaluationStatus,
    recommendation: row.recommendation,
    handoffOutcome: row.handoffOutcome,
  };
}

export async function pageCaptureProgress(input: { filter: PageCaptureFilter; site: string | null; page: number }, repository = new PrismaPageCaptureRepository()) {
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
  const item =
    parsed.data.action === "retry" ? await repository.retry(id) : parsed.data.action === "dismiss" ? await repository.dismiss(id) : await repository.restore(id);
  if (!item) return extensionError("NOT_FOUND", "This job cannot be changed that way now");
  return extensionJson({ id: item.id, status: item.status });
}
