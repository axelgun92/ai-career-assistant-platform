import {
  capturedFactValue,
  parseGeographyList,
  confirmedFactInputSchema,
  confirmedFactFields,
  type ConfirmableFacts,
  type ConfirmedFactField,
} from "@ai-career/core";
import { PrismaConfirmedFactRepository, type ConfirmedFactEventRecord, type ConfirmedFactRecord } from "@ai-career/database";
import { z } from "zod";
import { getEvaluationService } from "./evaluation-service";

// Add missing information (November 25, 2026): the user confirms a fact
// the job description states but capture left Unknown. Each confirmation
// is stored with its provenance (confirmed by the user, when, an optional
// quotation from the job description and a note) apart from the captured
// evidence, recorded in the audit history, editable and undoable; triage is
// assessed again at once, so the job moves to the right working category
// and its evaluation eligibility follows. A later capture never overwrites
// a confirmation: a disagreeing capture is shown as a conflict to review.

export interface ConfirmedFactStore {
  list(opportunityId: string): Promise<ConfirmedFactRecord[]>;
  history(opportunityId: string): Promise<ConfirmedFactEventRecord[]>;
  save(input: {
    opportunityId: string;
    fieldName: ConfirmedFactField;
    value: unknown;
    capturedValue: unknown;
    quotation: string | null;
    note: string | null;
    at: Date;
  }): Promise<ConfirmedFactRecord | null>;
  revoke(input: { opportunityId: string; fieldName: ConfirmedFactField; at: Date }): Promise<boolean>;
}

export interface ConfirmedFactDependencies {
  store: ConfirmedFactStore;
  // The captured, normalized facts (without confirmations), or null.
  captured(opportunityId: string): Promise<ConfirmableFacts | null>;
  // Triage assessed again after a change; its outcome for the response.
  reassess(opportunityId: string): Promise<{ outcome: string } | null>;
  now?: () => Date;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

// A confirmed fact as shown: its value and provenance, the value captured
// when it was confirmed, and a conflict when a later capture states a
// different value than both.
export function confirmedFactView(fact: ConfirmedFactRecord, capturedNow: ConfirmableFacts | null) {
  const now = capturedNow ? capturedFactValue(fact.fieldName, capturedNow) : null;
  const conflict = now !== null && !same(now, fact.capturedValue) && !same(now, fact.value);
  return {
    fieldName: fact.fieldName,
    value: fact.value,
    quotation: fact.quotation,
    note: fact.note,
    confirmedAt: fact.confirmedAt.toISOString(),
    capturedValue: fact.capturedValue,
    conflict: conflict ? { capturedNow: now } : null,
  };
}

export type ConfirmedFactView = ReturnType<typeof confirmedFactView>;

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }) };
  }
}

export function createConfirmedFactHandlers(dependencies: ConfirmedFactDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const notFound = () => Response.json({ error: "Opportunity not found", code: "OPPORTUNITY_NOT_FOUND" }, { status: 404 });

  async function state(opportunityId: string) {
    const [facts, history, captured] = await Promise.all([
      dependencies.store.list(opportunityId),
      dependencies.store.history(opportunityId),
      dependencies.captured(opportunityId),
    ]);
    return {
      facts: facts.map((fact) => confirmedFactView(fact, captured)),
      history: history.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
    };
  }

  return {
    async get(opportunityIdValue: string) {
      const id = z.uuid().safeParse(opportunityIdValue);
      if (!id.success || !(await dependencies.captured(id.data))) return notFound();
      return Response.json(await state(id.data));
    },

    // POST {fieldName, value, quotation?, note?}: confirm or edit.
    async save(request: Request, opportunityIdValue: string) {
      const id = z.uuid().safeParse(opportunityIdValue);
      if (!id.success) return notFound();
      const read = await readJson(request);
      if (!read.ok) return read.response;
      const parsed = confirmedFactInputSchema.safeParse(read.body);
      if (!parsed.success) {
        return Response.json({ error: parsed.error.issues[0]?.message ?? "The information is invalid", code: "REQUEST_INVALID" }, { status: 400 });
      }
      // Regions may be typed as names or codes ("Germany, France", "DE"):
      // stored as the codes the rest of the product compares.
      const value = parsed.data.value as { regions?: string[] } | null;
      if (value && typeof value === "object" && Array.isArray(value.regions) && value.regions.length) {
        const codes = parseGeographyList(value.regions.join(", "));
        if (!codes) {
          return Response.json({ error: "Name the regions as countries, U.S. states or regions (for example Germany, EU, US-NY)", code: "REQUEST_INVALID" }, { status: 400 });
        }
        value.regions = codes;
      }
      const captured = await dependencies.captured(id.data);
      if (!captured) return notFound();
      const saved = await dependencies.store.save({
        opportunityId: id.data,
        fieldName: parsed.data.fieldName,
        value: parsed.data.value,
        capturedValue: capturedFactValue(parsed.data.fieldName, captured),
        quotation: parsed.data.quotation,
        note: parsed.data.note,
        at: now(),
      });
      if (!saved) return notFound();
      const triage = await dependencies.reassess(id.data).catch(() => null);
      return Response.json({ ...(await state(id.data)), triage });
    },

    // DELETE ?field=<name>: undo a confirmation (its history stays).
    async undo(request: Request, opportunityIdValue: string) {
      const id = z.uuid().safeParse(opportunityIdValue);
      if (!id.success) return notFound();
      const field = z.enum(confirmedFactFields as [ConfirmedFactField, ...ConfirmedFactField[]]).safeParse(new URL(request.url).searchParams.get("field"));
      if (!field.success) return Response.json({ error: "Name the information to undo", code: "REQUEST_INVALID" }, { status: 400 });
      const undone = await dependencies.store.revoke({ opportunityId: id.data, fieldName: field.data, at: now() });
      if (!undone) return Response.json({ error: "Nothing to undo", code: "NOT_CONFIRMED" }, { status: 404 });
      const triage = await dependencies.reassess(id.data).catch(() => null);
      return Response.json({ ...(await state(id.data)), triage });
    },
  };
}

export function getConfirmedFactHandlers() {
  const store = new PrismaConfirmedFactRepository();
  return createConfirmedFactHandlers({
    store,
    captured: (opportunityId) => store.capturedFacts(opportunityId),
    reassess: async (opportunityId) => {
      const result = await getEvaluationService().assessTriage(opportunityId, { trigger: "USER_CORRECTION" });
      return result.status === "ASSESSED" ? { outcome: result.triage.outcome } : null;
    },
  });
}
