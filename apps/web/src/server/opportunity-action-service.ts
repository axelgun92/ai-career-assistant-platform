import {
  availableUserActions,
  canRequestEvaluation,
  opportunityUserActionSchema,
  type OpportunityLifecycleState,
  type OpportunityUserAction,
} from "@ai-career/core";
import {
  PrismaOpportunityLifecycleRepository,
  type UserActionResult,
} from "@ai-career/database";
import { z } from "zod";

export interface OpportunityActionWriter {
  applyUserAction(input: {
    opportunityId: string;
    action: OpportunityUserAction;
  }): Promise<UserActionResult>;
}

const actionRequestSchema = z.object({ action: opportunityUserActionSchema }).strict();

let actionWriter: OpportunityActionWriter | undefined;

export function getOpportunityActionWriter(): OpportunityActionWriter {
  actionWriter ??= new PrismaOpportunityLifecycleRepository();
  return actionWriter;
}

export interface OpportunityLifecyclePresentation {
  status: OpportunityLifecycleState;
  availableActions: OpportunityUserAction[];
  evaluable: boolean;
}

// Lifecycle state and the actions the user may take now, for server rendering.
export async function getOpportunityLifecyclePresentation(
  opportunityId: string,
): Promise<OpportunityLifecyclePresentation | null> {
  const view = await new PrismaOpportunityLifecycleRepository().getLifecycleView(opportunityId);
  if (!view) return null;
  return {
    status: view.status,
    availableActions: availableUserActions({
      currentStatus: view.status,
      history: view.history,
      currentSystemState: view.systemState,
    }),
    evaluable: canRequestEvaluation(view.status),
  };
}

// POST /api/opportunities/[id]/action — explicit user lifecycle actions only.
export function createOpportunityActionHandler(writer: OpportunityActionWriter) {
  return async function post(request: Request, opportunityIdValue: string) {
    const opportunityId = z.uuid().safeParse(opportunityIdValue);
    if (!opportunityId.success) {
      return Response.json({ error: "Opportunity not found", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 });
    }
    const parsed = actionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: "The opportunity action is invalid",
          code: "REQUEST_INVALID",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    try {
      const result = await writer.applyUserAction({
        opportunityId: opportunityId.data,
        action: parsed.data.action,
      });
      switch (result.status) {
        case "APPLIED":
          return Response.json({
            opportunityId: opportunityId.data,
            action: parsed.data.action,
            from: result.from,
            status: result.to,
          });
        case "NOT_FOUND":
          return Response.json({ error: "Opportunity not found", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });
        case "NOT_ALLOWED":
          return Response.json({ error: result.reason, code: "OPPORTUNITY_ACTION_NOT_ALLOWED" }, { status: 409 });
        case "CONFLICT":
          return Response.json(
            { error: "The opportunity changed at the same time; reload and try again", code: "OPPORTUNITY_ACTION_CONFLICT" },
            { status: 409 },
          );
      }
    } catch (error) {
      console.error("Opportunity action failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return Response.json({ error: "The opportunity action could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
    }
  };
}
