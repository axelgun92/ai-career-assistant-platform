import type { ExtensionCaptureInput } from "../../../packages/core/src/extension-capture";

// The extension's only network client. It calls the configured local AI Job
// Assistant, and only its /api/extension/* routes; the pairing credential
// travels only in the Authorization header of those requests. It never calls
// any other route of the app, any job site or any third party.

export const extensionApiPrefix = "/api/extension/";

// A local AI Job Assistant: http on 127.0.0.1 or localhost, any port, no
// path. These are the only hosts the manifest grants.
export function normalizeBackendUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) return null;
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  return url.origin;
}

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; code: string; error: string; body?: unknown };

export interface ApiClient {
  status(): Promise<ApiResult<{ paired: true; pairing: { label: string; tokenHint: string } }>>;
  lookup(pageUrl: string): Promise<ApiResult<LookupResponse>>;
  capture(envelope: ExtensionCaptureInput): Promise<ApiResult<CaptureResponse>>;
  requestEvaluation(opportunityId: string): Promise<ApiResult<{ outcome?: string; reason?: string; evaluationId?: string }>>;
  evaluationStatus(opportunityId: string): Promise<ApiResult<EvaluationStatusResponse>>;
}

export interface EvaluationSummary {
  evaluationId: string;
  status: string;
  queueState: string;
  recommendation: { decision: string; explanation: string | null } | null;
  // The latest completed evaluation is of an earlier version of the posting
  // than the one saved now (for example after "Use my selected text
  // instead"): requesting evaluation evaluates the current version.
  evaluatedEarlierVersion?: boolean;
}

export interface CaptureResponse {
  outcome: "CREATED" | "ATTACHED" | "UNCHANGED" | "CHANGED";
  decision: string | null;
  opportunityId: string;
  opportunityUrl: string;
  site: { host: string; name: string; knownHost: boolean };
  sourceCategory: string;
  probableDuplicate: boolean;
  outsideRoleFamilies: boolean;
  evaluation: EvaluationSummary | null;
}

export interface LookupResponse {
  found: boolean;
  supported: boolean;
  site: { host: string; name: string; knownHost: boolean } | null;
  opportunityId?: string;
  opportunityUrl?: string;
  title?: string | null;
  company?: string | null;
  evaluation?: EvaluationSummary | null;
}

export interface EvaluationStatusResponse {
  evaluationId: string;
  status: string;
  queueState: string;
  recommendation: { decision: string; explanation?: string | null } | null;
}

export function createApiClient(settings: { backendUrl: string; credential: string }, fetcher: typeof fetch = fetch): ApiClient {
  const origin = normalizeBackendUrl(settings.backendUrl);

  async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }): Promise<ApiResult<T>> {
    const route = path.split("?")[0]!;
    if (!route.startsWith(extensionApiPrefix) || route.includes("..")) throw new Error("The extension only calls its own API routes");
    if (!origin) return { ok: false, status: 0, code: "NOT_CONFIGURED", error: "Set the AI Job Assistant address in the extension's options" };
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${settings.credential}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      return { ok: false, status: 0, code: "UNREACHABLE", error: "AI Job Assistant could not be reached. Is it running?" };
    }
    const body = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
    if (response.ok && body) return { ok: true, status: response.status, body };
    return {
      ok: false,
      status: response.status,
      code: body?.code ?? "REQUEST_FAILED",
      error: typeof body?.error === "string" ? body.error : `The request failed (HTTP ${response.status})`,
      body,
    };
  }

  const opportunityPath = (id: string, leaf: string) => `${extensionApiPrefix}opportunities/${encodeURIComponent(id)}/${leaf}`;
  return {
    status: () => call(`${extensionApiPrefix}status`),
    lookup: (pageUrl) => call(`${extensionApiPrefix}lookup?url=${encodeURIComponent(pageUrl)}`),
    capture: (envelope) => call(`${extensionApiPrefix}captures`, { method: "POST", body: envelope }),
    requestEvaluation: (id) => call(opportunityPath(id, "evaluation-requests"), { method: "POST", body: {} }),
    evaluationStatus: (id) => call(opportunityPath(id, "evaluation")),
  };
}
