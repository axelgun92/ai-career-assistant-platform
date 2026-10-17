import { z } from "zod";
import {
  DuplicateResolutionError,
  PrismaDuplicateRepository,
  type DuplicateRelationship,
} from "@ai-career/database";

export interface DuplicateStore {
  relationships(opportunityId: string): Promise<DuplicateRelationship[]>;
  resolve(input: { opportunityId: string; otherOpportunityId: string; resolution: "DISTINCT" | null }): Promise<DuplicateRelationship>;
}

let store: DuplicateStore | undefined;

export function getDuplicateStore(): DuplicateStore {
  store ??= new PrismaDuplicateRepository();
  return store;
}

// DISTINCT marks a detected pair as different jobs; null reopens it so the
// pair is treated as duplicates again.
const resolutionBodySchema = z
  .object({
    otherOpportunityId: z.uuid(),
    resolution: z.enum(["DISTINCT"]).nullable(),
  })
  .strict();

export function createDuplicateResolutionHandler(duplicates: DuplicateStore) {
  return async (request: Request, opportunityIdValue: string) => {
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
    const parsed = resolutionBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "The duplicate decision is invalid", code: "REQUEST_INVALID" }, { status: 400 });
    }
    try {
      const relationship = await duplicates.resolve({
        opportunityId: opportunityId.data,
        otherOpportunityId: parsed.data.otherOpportunityId,
        resolution: parsed.data.resolution,
      });
      return Response.json({ relationship });
    } catch (error) {
      if (error instanceof DuplicateResolutionError) {
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.code === "OPPORTUNITY_NOT_FOUND" ? 404 : 409 },
        );
      }
      console.error("Duplicate decision failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return Response.json({ error: "The duplicate decision could not be saved", code: "INTERNAL_ERROR" }, { status: 500 });
    }
  };
}
