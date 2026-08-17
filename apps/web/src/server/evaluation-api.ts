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
    async get(opportunityId: string) {
      try {
        return Response.json(await service.getLatestEvaluation(opportunityId));
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

export async function handleProductionEvaluationGet(opportunityId: string) {
  try {
    return await createEvaluationApiHandlers(getEvaluationService()).get(
      opportunityId,
    );
  } catch (error) {
    return safeError(error);
  }
}
