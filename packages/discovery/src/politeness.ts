import { AdapterError } from "./contract";
import type { RetrievalTransport, TransportResponse } from "./transport";

// Basic politeness for one run: requests to a host go one at a time with at
// least minIntervalMs between their starts, and once a host answers 429
// (rate limited), 401/403 (access refused) or 5xx (server error) no further
// request is sent to it in this run; the stop keeps any Retry-After the
// source sent. Backoff across runs and source health are decided after the
// run (packages/core retrieval-health).

export const defaultMinRequestIntervalMs = 1_000;

export function createPoliteTransport(
  inner: RetrievalTransport,
  options: {
    minIntervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): RetrievalTransport {
  const minIntervalMs = options.minIntervalMs ?? defaultMinRequestIntervalMs;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const queues = new Map<string, Promise<unknown>>();
  const lastStart = new Map<string, number>();
  const stopped = new Map<string, AdapterError>();

  function schedule(url: string, send: () => Promise<TransportResponse>): Promise<TransportResponse> {
    let host: string;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      return send();
    }
    const previous = queues.get(host) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const stop = stopped.get(host);
      if (stop) throw new AdapterError(stop.code, "Retrieval from this host stopped earlier in the run", { ...stop.details, url });
      const last = lastStart.get(host);
      if (last !== undefined) {
        const wait = last + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastStart.set(host, now());
      const response = await send();
      const retryAfter = response.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: response.retryAfterSeconds };
      if (response.status === 429) {
        stopped.set(host, new AdapterError("RATE_LIMITED", "Rate limited", { status: 429, url, ...retryAfter }));
      } else if (response.status === 401 || response.status === 403) {
        stopped.set(host, new AdapterError("ACCESS_DENIED", "Access refused", { status: response.status, url }));
      } else if (response.status >= 500 && response.status < 600) {
        stopped.set(host, new AdapterError("SERVER_ERROR", "Server error", { status: response.status, url, ...retryAfter }));
      }
      return response;
    });
    queues.set(host, run);
    return run;
  }

  return {
    get: (url, request) => schedule(url, () => inner.get(url, request)),
    post: (url, body, request) => schedule(url, () => inner.post(url, body, request)),
  };
}
