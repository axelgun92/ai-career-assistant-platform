import {
  applicationCommandSchema,
  createApplicationSchema,
  type ApplicationCommand,
  type CreateApplicationInput,
} from "@ai-career/core";
import {
  ApplicationError,
  PrismaApplicationListRepository,
  PrismaApplicationRepository,
  type ApplicationDetail,
  type ApplicationErrorCode,
  type ApplicationListPage,
  type ApplicationTrackingContext,
} from "@ai-career/database";
import { z } from "zod";
import {
  applicationPageSize,
  parseApplicationQuery,
  toApplicationListFilters,
} from "./application-query";

export interface ApplicationStore {
  create(opportunityId: string, input: CreateApplicationInput): Promise<ApplicationDetail>;
  getDetail(applicationId: string): Promise<ApplicationDetail | null>;
  getByOpportunity(opportunityId: string): Promise<ApplicationDetail | null>;
  trackingContext(opportunityId: string): Promise<ApplicationTrackingContext | null>;
  submit(id: string, input: { expectedVersion: number; appliedOn: string }): Promise<ApplicationDetail>;
  changeStage(id: string, input: Extract<ApplicationCommand, { command: "changeStage" }>): Promise<ApplicationDetail>;
  close(id: string, input: Extract<ApplicationCommand, { command: "close" }>): Promise<ApplicationDetail>;
  reopen(id: string, input: { expectedVersion: number }): Promise<ApplicationDetail>;
  correctAppliedOn(id: string, input: { expectedVersion: number; appliedOn: string }): Promise<ApplicationDetail>;
  addNote(id: string, input: { body: string }): Promise<ApplicationDetail>;
  editNote(id: string, input: { noteId: string; expectedVersion: number; body: string }): Promise<ApplicationDetail>;
  addContact(id: string, input: Extract<ApplicationCommand, { command: "addContact" }>): Promise<ApplicationDetail>;
  updateContact(id: string, input: Extract<ApplicationCommand, { command: "updateContact" }>): Promise<ApplicationDetail>;
  addFollowUp(id: string, input: { description: string; dueOn: string }): Promise<ApplicationDetail>;
  completeFollowUp(id: string, input: { followUpId: string; expectedVersion: number }): Promise<ApplicationDetail>;
  reopenFollowUp(id: string, input: { followUpId: string; expectedVersion: number }): Promise<ApplicationDetail>;
  addInterview(id: string, input: Extract<ApplicationCommand, { command: "addInterview" }>): Promise<ApplicationDetail>;
  updateInterview(id: string, input: Extract<ApplicationCommand, { command: "updateInterview" }>): Promise<ApplicationDetail>;
}

export interface ApplicationLister {
  listPage(input: Parameters<PrismaApplicationListRepository["listPage"]>[0]): Promise<ApplicationListPage>;
}

let store: ApplicationStore | undefined;
let lister: ApplicationLister | undefined;

export function getApplicationStore(): ApplicationStore {
  store ??= new PrismaApplicationRepository();
  return store;
}

export function getApplicationLister(): ApplicationLister {
  lister ??= new PrismaApplicationListRepository();
  return lister;
}

const errorStatus: Record<ApplicationErrorCode, number> = {
  OPPORTUNITY_NOT_FOUND: 404,
  APPLICATION_NOT_FOUND: 404,
  APPLICATION_ITEM_NOT_FOUND: 404,
  CONTACT_NOT_IN_APPLICATION: 400,
  APPLICATION_EXISTS: 409,
  APPLICATION_ALREADY_SUBMITTED: 409,
  OPPORTUNITY_NOT_TRACKABLE: 409,
  OPPORTUNITY_ARCHIVED: 409,
  APPLICATION_CHANGED: 409,
  APPLIED_DATE_NOT_APPLICABLE: 409,
  APPLICATION_TRANSITION_NOT_ALLOWED: 409,
};

const notFound = (code: "OPPORTUNITY_NOT_FOUND" | "APPLICATION_NOT_FOUND") =>
  Response.json(
    { error: code === "OPPORTUNITY_NOT_FOUND" ? "Opportunity not found" : "Application not found", code },
    { status: 404 },
  );

function validationFailed(error: z.ZodError) {
  return Response.json(
    {
      error: "The application request is invalid",
      code: "VALIDATION_FAILED",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
    { status: 400 },
  );
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }),
    };
  }
}

function errorResponse(error: unknown, context: string) {
  if (error instanceof ApplicationError) {
    return Response.json(
      { error: error.message, code: error.code, ...error.details },
      { status: errorStatus[error.code] },
    );
  }
  console.error(`${context} failed`, { errorName: error instanceof Error ? error.name : "UnknownError" });
  return Response.json({ error: "The application change could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
}

// Dispatches one validated command. Repositories persist only their named
// fields, so the "command" discriminator never reaches the database.
export function runApplicationCommand(target: ApplicationStore, applicationId: string, command: ApplicationCommand) {
  switch (command.command) {
    case "submit":
      return target.submit(applicationId, command);
    case "changeStage":
      return target.changeStage(applicationId, command);
    case "close":
      return target.close(applicationId, command);
    case "reopen":
      return target.reopen(applicationId, command);
    case "correctAppliedOn":
      return target.correctAppliedOn(applicationId, command);
    case "addNote":
      return target.addNote(applicationId, command);
    case "editNote":
      return target.editNote(applicationId, command);
    case "addContact":
      return target.addContact(applicationId, command);
    case "updateContact":
      return target.updateContact(applicationId, command);
    case "addFollowUp":
      return target.addFollowUp(applicationId, command);
    case "completeFollowUp":
      return target.completeFollowUp(applicationId, command);
    case "reopenFollowUp":
      return target.reopenFollowUp(applicationId, command);
    case "addInterview":
      return target.addInterview(applicationId, command);
    case "updateInterview":
      return target.updateInterview(applicationId, command);
  }
}

export function createApplicationApiHandlers(dependencies: { store: ApplicationStore; lister: ApplicationLister }) {
  return {
    // POST /api/opportunities/[id]/application
    async create(request: Request, opportunityIdValue: string) {
      const opportunityId = z.uuid().safeParse(opportunityIdValue);
      if (!opportunityId.success) return notFound("OPPORTUNITY_NOT_FOUND");
      const json = await readJson(request);
      if (!json.ok) return json.response;
      const parsed = createApplicationSchema.safeParse(json.body);
      if (!parsed.success) return validationFailed(parsed.error);
      try {
        const application = await dependencies.store.create(opportunityId.data, parsed.data);
        return Response.json({ application }, { status: 201 });
      } catch (error) {
        return errorResponse(error, "Application create");
      }
    },

    // GET /api/opportunities/[id]/application
    async forOpportunity(opportunityIdValue: string) {
      const opportunityId = z.uuid().safeParse(opportunityIdValue);
      if (!opportunityId.success) return notFound("OPPORTUNITY_NOT_FOUND");
      try {
        const context = await dependencies.store.trackingContext(opportunityId.data);
        if (!context) return notFound("OPPORTUNITY_NOT_FOUND");
        const application = await dependencies.store.getByOpportunity(opportunityId.data);
        return Response.json({ application, context });
      } catch (error) {
        return errorResponse(error, "Application read");
      }
    },

    // GET /api/applications/[id]
    async detail(applicationIdValue: string) {
      const applicationId = z.uuid().safeParse(applicationIdValue);
      if (!applicationId.success) return notFound("APPLICATION_NOT_FOUND");
      try {
        const application = await dependencies.store.getDetail(applicationId.data);
        return application ? Response.json({ application }) : notFound("APPLICATION_NOT_FOUND");
      } catch (error) {
        return errorResponse(error, "Application read");
      }
    },

    // POST /api/applications/[id] — one validated command surface.
    async command(request: Request, applicationIdValue: string) {
      const applicationId = z.uuid().safeParse(applicationIdValue);
      if (!applicationId.success) return notFound("APPLICATION_NOT_FOUND");
      const json = await readJson(request);
      if (!json.ok) return json.response;
      const parsed = applicationCommandSchema.safeParse(json.body);
      if (!parsed.success) return validationFailed(parsed.error);
      try {
        const application = await runApplicationCommand(dependencies.store, applicationId.data, parsed.data);
        return Response.json({ application });
      } catch (error) {
        return errorResponse(error, "Application command");
      }
    },

    // GET /api/applications — lenient: invalid filters are dropped.
    async list(request: Request) {
      const query = parseApplicationQuery(new URL(request.url).searchParams);
      try {
        const page = await dependencies.lister.listPage({
          filters: toApplicationListFilters(query),
          sort: query.sort,
          page: query.page,
          pageSize: applicationPageSize,
        });
        return Response.json(page);
      } catch (error) {
        return errorResponse(error, "Application list");
      }
    },
  };
}

export function getApplicationApiHandlers() {
  return createApplicationApiHandlers({ store: getApplicationStore(), lister: getApplicationLister() });
}
