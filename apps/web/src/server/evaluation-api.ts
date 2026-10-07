import { ZodError } from "zod";
import { EvaluationApiError } from "./evaluation-errors";
import type { EvaluationService } from "./evaluation-service";
import { getEvaluationService } from "./evaluation-service";

function safeError(error: unknown) {
  if (error instanceof EvaluationApiError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "The evaluation request is invalid",
        code: "REQUEST_INVALID",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  console.error("Evaluation API request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json(
    { error: "The evaluation request could not be completed", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export function createEvaluationApiHandlers(service: EvaluationService) {
  return {
    async post(request: Request, opportunityId: string) {
      let body: unknown = {};
      try {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        return Response.json(
          { error: "Request body must be valid JSON", code: "REQUEST_INVALID" },
          { status: 400 },
        );
      }
      try {
        const result = await service.requestEvaluation(opportunityId, body);
        // A deferred request is accepted and persisted but not queued.
        if (result.outcome === "DEFERRED") return Response.json(result, { status: 200 });
        return Response.json(result, {
          status: 202,
          headers: {
            Location: `/api/opportunities/${opportunityId}/evaluation`,
          },
        });
      } catch (error) {
        return safeError(error);
      }
    },
    async resume(deferredId: string) {
      try {
        const result = await service.resumeDeferred(deferredId);
        return Response.json(result, { status: result.outcome === "DEFERRED" ? 200 : 202 });
      } catch (error) {
        return safeError(error);
      }
    },
    async cancel(deferredId: string) {
      try {
        return Response.json(await service.cancelDeferred(deferredId));
      } catch (error) {
        return safeError(error);
      }
    },
    async get(opportunityId: string, evaluationId?: string | null) {
      try {
        return Response.json(
          await service.getLatestEvaluation(opportunityId, evaluationId),
        );
      } catch (error) {
        return safeError(error);
      }
    },
  };
}

export async function handleProductionEvaluationPost(
  request: Request,
  opportunityId: string,
) {
  try {
    return await createEvaluationApiHandlers(getEvaluationService()).post(
      request,
      opportunityId,
    );
  } catch (error) {
    return safeError(error);
  }
}

export async function handleProductionEvaluationGet(
  request: Request,
  opportunityId: string,
) {
  try {
    const evaluationId = new URL(request.url).searchParams.get("evaluationId");
    return await createEvaluationApiHandlers(getEvaluationService()).get(
      opportunityId,
      evaluationId,
    );
  } catch (error) {
    return safeError(error);
  }
}

export async function handleDeferredEvaluationAction(action: "resume" | "cancel", deferredId: string) {
  try {
    const handlers = createEvaluationApiHandlers(getEvaluationService());
    return await (action === "resume" ? handlers.resume(deferredId) : handlers.cancel(deferredId));
  } catch (error) {
    return safeError(error);
  }
}
