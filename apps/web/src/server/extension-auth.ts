import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ExtensionPairingRecord } from "@ai-career/database";

// Authentication for the browser extension companion (feature 14B). A
// pairing credential is created on the app's Extension page, shown once,
// and stored by the server only as its SHA-256 hash. It authenticates the
// extension's own /api/extension/* routes and nothing else: no other route
// reads it, and the pairing-management routes refuse it. The app has no user
// accounts; a pairing is a revocable, local-only credential for one browser.

export const pairingCredentialPrefix = "aija_";
const credentialPattern = /^aija_[A-Za-z0-9_-]{43}$/;

export function hashPairingCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

export function generatePairingCredential(): { credential: string; tokenHash: string; tokenHint: string } {
  const credential = `${pairingCredentialPrefix}${randomBytes(32).toString("base64url")}`;
  return { credential, tokenHash: hashPairingCredential(credential), tokenHint: credential.slice(-4) };
}

export interface ExtensionPairingStore {
  findByHash(tokenHash: string): Promise<(ExtensionPairingRecord & { tokenHash: string }) | null>;
  markUsed(id: string, at: Date): Promise<void>;
}

export const extensionErrorCodes = {
  PAIRING_REQUIRED: 401,
  PAIRING_INVALID: 401,
  ORIGIN_NOT_ALLOWED: 403,
  SAME_ORIGIN_REQUIRED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CAPTURE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_JSON: 400,
  INVALID_CAPTURE: 400,
  INVALID_REQUEST: 400,
  UNSUPPORTED_PAGE: 422,
  INTERNAL_ERROR: 500,
} as const;
export type ExtensionErrorCode = keyof typeof extensionErrorCodes;

// Responses of the extension routes are never cached: some carry a pairing
// credential (once) or persisted state that changes.
const noStore = { "Cache-Control": "no-store" } as const;

export function extensionJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

export function extensionError(
  code: ExtensionErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return extensionJson({ error: message, code, ...extra }, extensionErrorCodes[code]);
}

// No CORS: the extension's own pages reach the local app through their
// host permission without a preflight, and no other origin is let in.
export function methodNotAllowed(allow: string): Response {
  return extensionJson({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405, { Allow: allow });
}

type Authenticated = { ok: true; pairing: ExtensionPairingRecord } | { ok: false; response: Response };

// For the extension's routes: a request from a web page (any Origin other
// than an extension's) is refused even with a valid credential; then the
// Bearer credential must match an unrevoked pairing.
export async function requirePairing(request: Request, store: ExtensionPairingStore, now: () => Date = () => new Date()): Promise<Authenticated> {
  const origin = request.headers.get("origin");
  if (origin !== null && !origin.startsWith("chrome-extension://")) {
    return { ok: false, response: extensionError("ORIGIN_NOT_ALLOWED", "Requests from web pages are not accepted") };
  }
  const header = request.headers.get("authorization");
  if (!header) return { ok: false, response: extensionError("PAIRING_REQUIRED", "This browser is not paired with AI Job Assistant") };
  const match = /^Bearer (\S+)$/.exec(header);
  const credential = match?.[1] ?? "";
  const invalid = () => ({ ok: false as const, response: extensionError("PAIRING_INVALID", "The pairing is not valid. Pair this browser again.") });
  if (!credentialPattern.test(credential)) return invalid();
  const presented = hashPairingCredential(credential);
  const pairing = await store.findByHash(presented);
  if (!pairing || !timingSafeEqual(Buffer.from(pairing.tokenHash, "hex"), Buffer.from(presented, "hex")) || pairing.revokedAt) {
    return invalid();
  }
  await store.markUsed(pairing.id, now());
  const { id, label, tokenHint, createdAt, lastUsedAt, revokedAt } = pairing;
  return { ok: true, pairing: { id, label, tokenHint, createdAt, lastUsedAt, revokedAt } };
}

// For pairing management: only the app's own pages, never the extension.
// A request carrying a Bearer credential is refused, and a browser request
// must be same-origin (Sec-Fetch-Site, and an Origin matching the host).
export function requireSameOrigin(request: Request): Response | null {
  if (request.headers.get("authorization")) {
    return extensionError("SAME_ORIGIN_REQUIRED", "Pairings are managed only from the AI Job Assistant Extension page");
  }
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let originMatches = origin === null;
  if (origin !== null && host !== null) {
    try {
      originMatches = new URL(origin).host === host;
    } catch {
      originMatches = false;
    }
  }
  if (site !== "same-origin" || !originMatches) {
    return extensionError("SAME_ORIGIN_REQUIRED", "Pairings are managed only from the AI Job Assistant Extension page");
  }
  return null;
}

type JsonBody = { ok: true; body: unknown } | { ok: false; response: Response };

// A JSON request body read up to a byte limit: 415 for another media type,
// 413 past the limit (checked on Content-Length and on the bytes read),
// 400 for malformed JSON.
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    return { ok: false, response: extensionError("UNSUPPORTED_MEDIA_TYPE", "The request body must be JSON") };
  }
  const tooLarge = () => ({ ok: false as const, response: extensionError("CAPTURE_TOO_LARGE", "The request body is too large") });
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return { ok: true, body: text.trim() ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, response: extensionError("INVALID_JSON", "The request body must be valid JSON") };
  }
}
