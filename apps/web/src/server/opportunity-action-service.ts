import {
  availableUserActions,
  canRequestEvaluation,
  lifecycleActionGuard,
  opportunityUserActionSchema,
  type OpportunityLifecycleState,
  type OpportunityUserAction,
} from "@ai-career/core";
import {
  PrismaApplicationRepository,
  PrismaOpportunityLifecycleRepository,
  type GuardedUserActionResult,
} from "@ai-career/database";
import { z } from "zod";

export interface OpportunityActionWriter {
  applyUserAction(input: {
    opportunityId: string;
    action: OpportunityUserAction;
  }): Promise<GuardedUserActionResult>;
}

const actionRequestSchema = z.object({ action: opportunityUserActionSchema }).strict();

let actionWriter: OpportunityActionWriter | undefined;

// Lifecycle actions run through the application guard: an action that would
// contradict the application record (for example restoring a submitted
// application's opportunity) is refused in the same locked transaction.
export function getOpportunityActionWriter(): OpportunityActionWriter {
  if (!actionWriter) {
    const applications = new PrismaApplicationRepository();
    actionWriter = { applyUserAction: (input) => applications.applyLifecycleActionGuarded(input) };
  }
  return actionWriter;
}

export interface OpportunityLifecyclePresentation {
  status: OpportunityLifecycleState;
  availableActions: OpportunityUserAction[];
  // Actions the lifecycle rules allow but the application record blocks.
  blockedActions: Array<{ action: OpportunityUserAction; reason: string }>;
  evaluable: boolean;
}

// Lifecycle state and the actions the user may take now, for server rendering.
export async function getOpportunityLifecyclePresentation(
  opportunityId: string,
): Promise<OpportunityLifecyclePresentation | null> {
  const [view, application] = await Promise.all([
    new PrismaOpportunityLifecycleRepository().getLifecycleView(opportunityId),
    new PrismaApplicationRepository().findStateForOpportunity(opportunityId),
  ]);
  if (!view) return null;
  const allowedByLifecycle = availableUserActions({
    currentStatus: view.status,
    history: view.history,
    currentSystemState: view.systemState,
  });
  const availableActions: OpportunityUserAction[] = [];
  const blockedActions: OpportunityLifecyclePresentation["blockedActions"] = [];
  for (const action of allowedByLifecycle) {
    const guard = lifecycleActionGuard(action, view.status, application);
    if (guard.allowed) availableActions.push(action);
    else blockedActions.push({ action, reason: guard.reason });
  }
  return { status: view.status, availableActions, blockedActions, evaluable: canRequestEvaluation(view.status) };
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
        case "BLOCKED_BY_APPLICATION":
          return Response.json({ error: result.reason, code: "APPLICATION_BLOCKS_ACTION" }, { status: 409 });
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
