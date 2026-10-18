import { AdapterError } from "./contract";
import type { RetrievalTransport } from "./transport";

// Basic politeness for one run: requests to a host go one at a time with at
// least minIntervalMs between their starts, and once a host answers 429
// (rate limited) or 401/403 (access refused) no further request is sent to
// it in this run. Health tracking, backoff across runs and freshness are
// Feature 12.

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

  return {
    get(url, request) {
      let host: string;
      try {
        host = new URL(url).host.toLowerCase();
      } catch {
        return inner.get(url, request);
      }
      const previous = queues.get(host) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(async () => {
        const stop = stopped.get(host);
        if (stop) throw new AdapterError(stop.code, "Retrieval from this host stopped earlier in the run", { url, status: stop.details.status });
        const last = lastStart.get(host);
        if (last !== undefined) {
          const wait = last + minIntervalMs - now();
          if (wait > 0) await sleep(wait);
        }
        lastStart.set(host, now());
        const response = await inner.get(url, request);
        if (response.status === 429) {
          stopped.set(host, new AdapterError("RATE_LIMITED", "Rate limited", { status: 429, url }));
        } else if (response.status === 401 || response.status === 403) {
          stopped.set(host, new AdapterError("ACCESS_DENIED", "Access refused", { status: response.status, url }));
        }
        return response;
      });
      queues.set(host, run);
      return run;
    },
  };
}
