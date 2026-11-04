import type { PageCaptureBatch } from "../../../packages/core/src/page-capture";
import type { ApiResult } from "./api";
import type { PageCaptureResponse } from "./page-capture-view";
import type { TabRunState } from "./tab-acquisition";

// Messages between the popup and the service worker for "Save selected jobs"
// on a site whose details are read in background tabs. The popup asks for the
// site's host permission inside the Save click and hands the batch to the
// service worker, which sends it and then reads the jobs. The batch is also
// kept for a short while in session storage, so that a permission granted
// while the popup closed (Chrome may close it when its permission prompt
// opens) still saves the batch; a declined permission saves nothing.

export const pendingSaveKey = "pageCapturePendingSave";
// A pending batch older than this is never sent.
export const pendingSaveMaxAgeMs = 2 * 60 * 1000;

export interface PendingSave {
  batch: PageCaptureBatch;
  site: string;
  createdAt: number;
}

export type TabMessage =
  | { type: "page-capture:save"; pending: PendingSave }
  | { type: "page-capture:state" }
  | { type: "page-capture:stop" };

export type SaveReply = ApiResult<PageCaptureResponse> | { ok: false; status: 0; code: "NOT_PAIRED" | "EXPIRED"; error: string };

export interface StateReply {
  state: TabRunState | null;
}

export function isTabMessage(value: unknown): value is TabMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "page-capture:save" || type === "page-capture:state" || type === "page-capture:stop";
}

export interface TabSaveChrome {
  // Not awaited: the permission request must follow within the click.
  keepPending(pending: PendingSave): void;
  dropPending(): Promise<void>;
  requestPermission(origins: string[]): Promise<boolean>;
  send(message: TabMessage): Promise<SaveReply>;
}

export type TabSaveOutcome = { granted: false } | { granted: true; reply: SaveReply };

// "Save selected jobs" on a background-tab site, from inside the Save click:
// the batch is kept for the service worker, then the site's host permission
// is requested before anything is awaited (Chrome requires the user's
// gesture). Declined: nothing is sent and the kept batch is dropped.
// Granted: the service worker sends the batch and reads the jobs.
export function startTabSave(input: { batch: PageCaptureBatch; site: string; hostPermissions: string[]; now: number }, chromeApi: TabSaveChrome): Promise<TabSaveOutcome> {
  const pending: PendingSave = { batch: input.batch, site: input.site, createdAt: input.now };
  chromeApi.keepPending(pending);
  const asked = chromeApi.requestPermission(input.hostPermissions);
  return asked.then(
    async (granted) => {
      if (!granted) {
        await chromeApi.dropPending();
        return { granted: false } as const;
      }
      return { granted: true, reply: await chromeApi.send({ type: "page-capture:save", pending }) } as const;
    },
    async () => {
      await chromeApi.dropPending();
      return { granted: false } as const;
    },
  );
}
