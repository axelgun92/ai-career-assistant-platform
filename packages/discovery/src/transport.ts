import { AdapterError } from "./contract";

// The injectable HTTP boundary for retrieval. Production uses fetch; tests,
// the E2E helper and offline fixture checks use a fixture transport that
// serves recorded responses. Nothing else in the collection framework
// touches the network.

export interface TransportResponse {
  status: number;
  // The URL that answered (redirects are never followed).
  url: string;
  contentType: string | null;
  body: string;
}

export interface TransportRequestOptions {
  accept?: string;
  maxBytes?: number;
}

export interface RetrievalTransport {
  get(url: string, options?: TransportRequestOptions): Promise<TransportResponse>;
}

export const defaultRetrievalUserAgent = "AI-Career-Assistant/0.1 (personal job-search tool)";
export const defaultRequestTimeoutMs = 20_000;
// A hard ceiling: a larger response is refused (RESPONSE_TOO_LARGE), never
// truncated. The largest verified response was Lever's at about 6 MB.
export const defaultMaxResponseBytes = 10 * 1024 * 1024;

function requireHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AdapterError("CONFIG", "Request URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AdapterError("CONFIG", "Only http(s) requests are allowed");
  }
  return parsed;
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AdapterError("RESPONSE_TOO_LARGE", "Response exceeds the size limit", { url });
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AdapterError("RESPONSE_TOO_LARGE", "Response exceeds the size limit", { url });
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

// Plain GETs with an identifying User-Agent, a timeout and a size limit.
// No cookies or credentials are sent and redirects are not followed (a
// redirect is reported, never chased).
export function createFetchTransport(options: {
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): RetrievalTransport {
  const userAgent = options.userAgent?.trim() || defaultRetrievalUserAgent;
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async get(url, request = {}) {
      requireHttpUrl(url);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: { "user-agent": userAgent, accept: request.accept ?? "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new AdapterError("NETWORK", timedOut ? "Request timed out" : "Request failed", { url });
      }
      const body = await readCapped(response, request.maxBytes ?? defaultMaxResponseBytes, url).catch((error: unknown) => {
        if (error instanceof AdapterError) throw error;
        throw new AdapterError("NETWORK", "Response could not be read", { url });
      });
      return { status: response.status, url, contentType: response.headers.get("content-type"), body };
    },
  };
}

// Recorded responses keyed by exact URL. An unrecorded URL is a network
// failure, so a test can never reach a real source by accident.
export function createFixtureTransport(
  responses: Readonly<Record<string, TransportResponse | Omit<TransportResponse, "url">>>,
): RetrievalTransport & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url) {
      requireHttpUrl(url);
      requested.push(url);
      const response = responses[url];
      if (!response) throw new AdapterError("NETWORK", "No recorded response for this URL", { url });
      return { url, ...response };
    },
  };
}

// The one place response statuses are classified. 429 is a rate limit;
// 401/403 is an access failure; redirects and other non-2xx statuses are
// HTTP failures.
export function ensureSuccess(response: TransportResponse): TransportResponse {
  const { status, url } = response;
  if (status >= 200 && status < 300) return response;
  if (status === 429) throw new AdapterError("RATE_LIMITED", "The source rate-limited the request (HTTP 429)", { status, url });
  if (status === 401 || status === 403) {
    throw new AdapterError("ACCESS_DENIED", `The source refused access (HTTP ${status})`, { status, url });
  }
  if (status >= 300 && status < 400) throw new AdapterError("HTTP_STATUS", `Unexpected redirect (HTTP ${status})`, { status, url });
  throw new AdapterError("HTTP_STATUS", `Unexpected response (HTTP ${status})`, { status, url });
}

export async function getJson(
  transport: RetrievalTransport,
  url: string,
  options: TransportRequestOptions = {},
): Promise<unknown> {
  const response = ensureSuccess(await transport.get(url, { accept: "application/json", ...options }));
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new AdapterError("CONTRACT_MISMATCH", "Response is not valid JSON", { url });
  }
}

export async function getText(
  transport: RetrievalTransport,
  url: string,
  options: TransportRequestOptions = {},
): Promise<string> {
  return ensureSuccess(await transport.get(url, options)).body;
}
