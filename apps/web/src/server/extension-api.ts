import { createRetrievalIngestionService, extensionCaptureMaxBytes, extensionCaptureSchemaVersion } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  type ExtensionPairingRecord,
} from "@ai-career/database";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { z } from "zod";
import { EvaluationApiError } from "./evaluation-errors";
import { handleProductionEvaluationGet, handleProductionEvaluationPost } from "./evaluation-api";
import { getEvaluationService, type EvaluationService } from "./evaluation-service";
import {
  createExtensionCaptureService,
  ExtensionCaptureError,
  type EvaluationSummary,
  type ExtensionCaptureService,
} from "./extension-capture";
import {
  extensionError,
  extensionJson,
  generatePairingCredential,
  readJsonBody,
  requirePairing,
  requireSameOrigin,
  type ExtensionPairingStore,
} from "./extension-auth";

// The browser extension companion's API (feature 14B). Two groups of
// routes:
// - the extension's own routes (captures, status, lookup, and the
//   evaluation request and status wrappers), authenticated by the pairing
//   credential and nothing else;
// - pairing management (create, list, revoke), for the app's Extension page
//   only: same-origin, and refused when a pairing credential is presented.
// The evaluation wrappers only authenticate and then call the existing
// production evaluation handlers unchanged; admission, budget,
// duplicate-spend, queueing, retries, persistence and recommendation all
// stay there.

export interface ExtensionPairingManager extends ExtensionPairingStore {
  create(input: { label: string; tokenHash: string; tokenHint: string }): Promise<ExtensionPairingRecord>;
  list(): Promise<ExtensionPairingRecord[]>;
  revoke(id: string, at: Date): Promise<ExtensionPairingRecord | null>;
}

export interface ExtensionApiDependencies {
  pairings: ExtensionPairingManager;
  captures: ExtensionCaptureService;
  evaluation: {
    request(request: Request, opportunityId: string): Promise<Response>;
    status(request: Request, opportunityId: string): Promise<Response>;
  };
  now?: () => Date;
}

const pairingLabelSchema = z
  .object({ label: z.string().trim().min(1).max(60).optional() })
  .strict();

export function pairingView(pairing: ExtensionPairingRecord) {
  return {
    id: pairing.id,
    label: pairing.label,
    tokenHint: pairing.tokenHint,
    createdAt: pairing.createdAt.toISOString(),
    lastUsedAt: pairing.lastUsedAt?.toISOString() ?? null,
    revokedAt: pairing.revokedAt?.toISOString() ?? null,
  };
}

function captureFailure(error: unknown): Response {
  if (error instanceof ExtensionCaptureError) {
    return extensionError(error.code, error.message, error.issues.length ? { issues: error.issues } : {});
  }
  console.error("Extension request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
  return extensionError("INTERNAL_ERROR", "The request could not be completed");
}

export function createExtensionApiHandlers(dependencies: ExtensionApiDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const authenticate = (request: Request) => requirePairing(request, dependencies.pairings, now);

  return {
    async capture(request: Request) {
      const auth = await authenticate(request);
      if (!auth.ok) return auth.response;
      const body = await readJsonBody(request, extensionCaptureMaxBytes);
      if (!body.ok) return body.response;
      try {
        const { status, result } = await dependencies.captures.capture(body.body, auth.pairing);
        return extensionJson(result, status);
      } catch (error) {
        return captureFailure(error);
      }
    },

    async status(request: Request) {
      const auth = await authenticate(request);
      if (!auth.ok) return auth.response;
      return extensionJson({
        paired: true,
        pairing: { label: auth.pairing.label, tokenHint: auth.pairing.tokenHint },
        captureSchemaVersion: extensionCaptureSchemaVersion,
      });
    },

    async lookup(request: Request) {
      const auth = await authenticate(request);
      if (!auth.ok) return auth.response;
      try {
        return extensionJson(await dependencies.captures.lookup(new URL(request.url).searchParams.get("url")));
      } catch (error) {
        return captureFailure(error);
      }
    },

    // Wrapper: authentication only, then the existing production handler.
    async requestEvaluation(request: Request, opportunityId: string) {
      const auth = await authenticate(request);
      if (!auth.ok) return auth.response;
      const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (type !== "application/json") return extensionError("UNSUPPORTED_MEDIA_TYPE", "The request body must be JSON");
      return dependencies.evaluation.request(request, opportunityId);
    },

    // Wrapper: authentication only, then the existing latest-evaluation read.
    async evaluationStatus(request: Request, opportunityId: string) {
      const auth = await authenticate(request);
      if (!auth.ok) return auth.response;
      return dependencies.evaluation.status(request, opportunityId);
    },

    async listPairings(request: Request) {
      const refused = requireSameOrigin(request);
      if (refused) return refused;
      try {
        return extensionJson({ pairings: (await dependencies.pairings.list()).map(pairingView) });
      } catch (error) {
        return captureFailure(error);
      }
    },

    // The credential is in this response only; it is never stored or shown
    // again.
    async createPairing(request: Request) {
      const refused = requireSameOrigin(request);
      if (refused) return refused;
      const body = await readJsonBody(request, 4 * 1024);
      if (!body.ok) return body.response;
      const parsed = pairingLabelSchema.safeParse(body.body);
      if (!parsed.success) return extensionError("INVALID_REQUEST", "The pairing label is invalid");
      try {
        const { credential, tokenHash, tokenHint } = generatePairingCredential();
        const pairing = await dependencies.pairings.create({ label: parsed.data.label ?? "Browser", tokenHash, tokenHint });
        return extensionJson({ pairing: pairingView(pairing), credential }, 201);
      } catch (error) {
        return captureFailure(error);
      }
    },

    async revokePairing(request: Request, id: string) {
      const refused = requireSameOrigin(request);
      if (refused) return refused;
      if (!z.uuid().safeParse(id).success) return extensionError("NOT_FOUND", "Pairing not found");
      try {
        const pairing = await dependencies.pairings.revoke(id, now());
        if (!pairing) return extensionError("NOT_FOUND", "Pairing not found");
        return extensionJson({ pairing: pairingView(pairing) });
      } catch (error) {
        return captureFailure(error);
      }
    },
  };
}

export type ExtensionApiHandlers = ReturnType<typeof createExtensionApiHandlers>;

// The persisted evaluation state through the existing latest-evaluation
// read; null when the opportunity has no evaluation.
export function evaluationSummaryReader(service: Pick<EvaluationService, "getLatestEvaluation">) {
  return async (opportunityId: string): Promise<EvaluationSummary | null> => {
    try {
      const latest = await service.getLatestEvaluation(opportunityId);
      return {
        evaluationId: latest.evaluationId,
        status: latest.status,
        queueState: latest.queueState,
        recommendation: latest.recommendation
          ? { decision: latest.recommendation.decision, explanation: latest.recommendation.explanation ?? null }
          : null,
      };
    } catch (error) {
      if (error instanceof EvaluationApiError && error.code === "EVALUATION_NOT_FOUND") return null;
      throw error;
    }
  };
}

let handlers: ExtensionApiHandlers | undefined;

export function getExtensionApi(): ExtensionApiHandlers {
  handlers ??= createExtensionApiHandlers({
    pairings: new PrismaExtensionPairingRepository(),
    captures: createExtensionCaptureService({
      ingestion: createRetrievalIngestionService({
        repository: new PrismaManualOpportunityRepository(),
        normalizer: createRetrievedOpportunityNormalizer(),
      }),
      lookup: new PrismaExtensionLookupRepository(),
      latestEvaluation: (opportunityId) => evaluationSummaryReader(getEvaluationService())(opportunityId),
      discovery: customerSuccessDiscoveryConfiguration,
    }),
    evaluation: { request: handleProductionEvaluationPost, status: handleProductionEvaluationGet },
  });
  return handlers;
}
