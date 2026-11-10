import { geographyCountryNames, parseGeographyList, type UserWorkEligibility } from "@ai-career/core";
import { z } from "zod";

// The user's own work eligibility: which countries they may work in and are
// a citizen of. It only decides which jobs' work-authorization facts are
// shown as needing attention; normalization and the evaluator never read it.

export interface EligibilityStore {
  get(): Promise<(UserWorkEligibility & { updatedAt: Date }) | null>;
  save(input: UserWorkEligibility): Promise<UserWorkEligibility & { updatedAt: Date }>;
}

const bodySchema = z
  .object({
    authorizedRegions: z.string().max(500),
    citizenshipRegions: z.string().max(500),
  })
  .strict();

// "United States, Canada" or "US, CA" → ["CA", "US"]; countries only (a
// state, a region such as the EU, or an unreadable name is refused).
export function parseCountries(text: string): string[] | null {
  if (!text.trim()) return [];
  const codes = parseGeographyList(text);
  if (!codes || codes.some((code) => !(code in geographyCountryNames))) return null;
  return [...new Set(codes)].sort();
}

const view = (value: (UserWorkEligibility & { updatedAt: Date }) | null) =>
  value
    ? { authorizedRegions: value.authorizedRegions, citizenshipRegions: value.citizenshipRegions, updatedAt: value.updatedAt.toISOString() }
    : { authorizedRegions: [], citizenshipRegions: [], updatedAt: null };

export function createEligibilityApiHandlers(store: EligibilityStore) {
  return {
    async get() {
      try {
        return Response.json(view(await store.get()));
      } catch {
        return Response.json({ error: "Work eligibility could not be loaded", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
    async put(request: Request) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 });
      }
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "Invalid work eligibility", code: "REQUEST_INVALID" }, { status: 400 });
      const authorizedRegions = parseCountries(parsed.data.authorizedRegions);
      const citizenshipRegions = parseCountries(parsed.data.citizenshipRegions);
      const fields = [
        ...(authorizedRegions ? [] : [{ field: "authorizedRegions", message: "Name countries, for example “United States” or “US, Canada”." }]),
        ...(citizenshipRegions ? [] : [{ field: "citizenshipRegions", message: "Name countries, for example “United States”." }]),
      ];
      if (fields.length) return Response.json({ error: "Invalid work eligibility", code: "REQUEST_INVALID", fields }, { status: 400 });
      try {
        return Response.json(view(await store.save({ authorizedRegions: authorizedRegions!, citizenshipRegions: citizenshipRegions! })));
      } catch {
        return Response.json({ error: "Work eligibility could not be saved", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  };
}
