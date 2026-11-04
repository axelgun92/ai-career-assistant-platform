import {
  pageCaptureBatchSchema,
  pageCaptureMaxBytes,
  pageCaptureMaxCards,
  pageCaptureSchemaVersion,
  type PageCaptureBatch,
  type PageCaptureSiteSpec,
} from "../../../packages/core/src/page-capture";
import type { ReadResultCard, ResultCardReaderInput, ResultCardsReading } from "./results";

// Mode B ("Save jobs on this page") in the popup: the reader input for a
// site, the batch sent on Save (only the cards the user kept), and the text
// shown for the outcome. Every message is plain text.

export function readerInputFor(site: PageCaptureSiteSpec): ResultCardReaderInput {
  return { ...site.reader, maxCards: pageCaptureMaxCards };
}

export type BatchResult = { ok: true; batch: PageCaptureBatch } | { ok: false; problem: string };

export function buildPageCaptureBatch(
  reading: ResultCardsReading,
  kept: readonly boolean[],
  context: { site: string; batchId: string; extensionVersion: string; capturedAt: Date },
): BatchResult {
  const cards = reading.cards.filter((_, index) => kept[index] !== false);
  if (!cards.length) return { ok: false, problem: "Select at least one job to save." };
  const batch = {
    schemaVersion: pageCaptureSchemaVersion,
    kind: "page-capture",
    batchId: context.batchId,
    site: context.site,
    pageUrl: reading.pageUrl,
    pageTitle: reading.pageTitle,
    capturedAt: context.capturedAt.toISOString(),
    extensionVersion: context.extensionVersion,
    counts: reading.counts,
    cards: cards.map((card) => ({ ...card })),
  };
  const parsed = pageCaptureBatchSchema.safeParse(batch);
  if (!parsed.success) return { ok: false, problem: "These jobs could not be read clearly enough to save." };
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > pageCaptureMaxBytes) {
    return { ok: false, problem: "Too much was read from this page. Deselect some jobs and try again." };
  }
  return { ok: true, batch: parsed.data };
}

export function readingSummary(reading: ResultCardsReading): string {
  if (reading.problem === "FRICTION") return "This page shows a sign-in or security check. Nothing was read.";
  if (reading.problem === "NO_CARDS") {
    return reading.counts.skippedUnloaded
      ? `No loaded job cards were found on this page (${reading.counts.skippedUnloaded} not loaded yet). Scroll the page so the jobs appear, then try again.`
      : "No loaded job cards were found on this page.";
  }
  const parts = [`${reading.cards.length} job${reading.cards.length === 1 ? "" : "s"} read from this page.`];
  if (reading.counts.overCap) parts.push(`${reading.counts.overCap} more loaded job${reading.counts.overCap === 1 ? " was" : "s were"} not included (limit ${pageCaptureMaxCards}).`);
  if (reading.counts.skippedUnloaded) parts.push(`${reading.counts.skippedUnloaded} not loaded yet ${reading.counts.skippedUnloaded === 1 ? "was" : "were"} skipped.`);
  if (reading.counts.overCap || reading.counts.skippedUnloaded) parts.push("Scroll the page and save again for more.");
  return parts.join(" ");
}

export const cardLine = (card: ReadResultCard) =>
  [card.title, card.company, card.location, card.postedText].filter(Boolean).join(" · ");

export interface PageCaptureResponse {
  batchId: string;
  site: { key: string; name: string; automaticDetails: boolean };
  counts: { queued: number; seenAgain: number; alreadySaved: number; rejected: number };
  outcomes: Array<{ url: string; title: string; outcome: "QUEUED" | "SEEN_AGAIN" | "ALREADY_SAVED" | "REJECTED"; reason: string | null; opportunityId: string | null }>;
  progressUrl: string;
  // Sites whose details the extension reads in background tabs.
  acquisition?: {
    mechanism: "extension-tabs";
    items: Array<{ itemId: string; url: string }>;
    minIntervalMs: number;
    loadTimeoutMs: number;
    rereadDelaysMs: number[];
    stoppedUntil: string | null;
  };
}

export function pageCaptureMessage(response: PageCaptureResponse): string {
  const { queued, seenAgain, alreadySaved, rejected } = response.counts;
  const parts: string[] = [];
  const tabs = response.acquisition;
  if (tabs?.stoppedUntil) {
    parts.push(
      `${queued + seenAgain} saved; ${response.site.name} restricted access earlier, so no job page is opened before ${new Date(tabs.stoppedUntil).toLocaleString()}. Save this page again after that`,
    );
  } else if (tabs && queued) {
    parts.push(
      `${queued} queued; their details are read one at a time in background tabs, at least ${Math.round(tabs.minIntervalMs / 1000)} seconds apart. You can keep browsing`,
    );
  } else if (queued) {
    parts.push(
      response.site.automaticDetails
        ? `${queued} queued to get their details`
        : `${queued} saved; automatic details are not available for ${response.site.name} yet`,
    );
  }
  if (seenAgain && !tabs?.stoppedUntil) parts.push(`${seenAgain} already in progress`);
  if (alreadySaved) parts.push(`${alreadySaved} already in AI Job Assistant`);
  if (rejected) parts.push(`${rejected} not saved`);
  return `${parts.join(" · ") || "Nothing was saved"}.`;
}

export const rejectedLines = (response: PageCaptureResponse) =>
  response.outcomes.filter((item) => item.outcome === "REJECTED").map((item) => `${item.title}: ${item.reason ?? "not saved"}`);
