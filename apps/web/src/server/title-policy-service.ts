import {
  cleanTitlePolicyPatterns,
  createTitlePolicy,
  titlePolicyMaxPatterns,
  titlePolicyPatternMaxLength,
  type TitlePolicy,
  type TitlePolicyPatterns,
} from "@ai-career/core";
import { clearlyDisallowedCustomerSuccessTitle, customerSuccessDefaultTitlePolicy } from "@ai-career/customer-success";
import { z } from "zod";

// Target job titles for automatic acquisition (November 22, 2026). The saved
// setting is the single source of truth for every automatic source; with
// nothing saved, the Customer Success defaults apply. Every acquisition pass
// or request reads it afresh, so a change applies to the next automatic
// capture. Saved opportunities are never reprocessed.

export const titlePolicyDomain = "customer-success";

export interface TitlePolicyStore {
  get(domain: string): Promise<(TitlePolicyPatterns & { updatedAt: Date }) | null>;
  save(domain: string, patterns: TitlePolicyPatterns): Promise<TitlePolicyPatterns & { updatedAt: Date }>;
  clear(domain: string): Promise<void>;
}

export interface TitlePolicySnapshot {
  readonly patterns: TitlePolicyPatterns;
  readonly policy: TitlePolicy;
  readonly isDefault: boolean;
  readonly updatedAt: Date | null;
}

export const defaultTitlePolicyPatterns: TitlePolicyPatterns = {
  accepted: [...customerSuccessDefaultTitlePolicy.accepted],
  excluded: [...customerSuccessDefaultTitlePolicy.excluded],
};

export function snapshotOf(saved: (TitlePolicyPatterns & { updatedAt: Date }) | null): TitlePolicySnapshot {
  const patterns = saved ? { accepted: saved.accepted, excluded: saved.excluded } : defaultTitlePolicyPatterns;
  return { patterns, policy: createTitlePolicy(patterns), isDefault: !saved, updatedAt: saved?.updatedAt ?? null };
}

// A loader for automatic acquisition: the current policy, read per call.
export type TitlePolicyLoader = () => Promise<TitlePolicy>;

export function createTitlePolicyLoader(store: Pick<TitlePolicyStore, "get">): TitlePolicyLoader {
  return async () => snapshotOf(await store.get(titlePolicyDomain)).policy;
}

// Automatic acquisition (November 25, 2026): the target job titles, plus the
// Customer Success hard requirements a title alone clearly rules out (a
// level above mid-level; internship, stage, alternance, apprenticeship or
// part-time), so such listings are skipped before any job page is read. A
// deliberate capture never uses this loader, and every captured job is
// still decided by triage.
export function createAcquisitionTitlePolicyLoader(store: Pick<TitlePolicyStore, "get">): TitlePolicyLoader {
  const load = createTitlePolicyLoader(store);
  return async () => {
    const policy = await load();
    return (title) => {
      const decision = policy(title);
      if (decision.verdict !== "ACCEPTED") return decision;
      const disallowed = clearlyDisallowedCustomerSuccessTitle(title);
      return disallowed ? { verdict: "EXCLUDED", pattern: disallowed } : decision;
    };
  };
}

// Saved opportunities whose titles are outside the current target job
// titles (the dashboard's "Outside target titles" list; the list itself is
// narrowed by the selected lifecycle view), how many of them are in Active
// (the working category) and how many are in Dismissed.
const activeStatuses = new Set(["NORMALIZED", "EVALUATED", "RECOMMENDED", "SAVED"]);

export async function outsideTargetTitles(
  store: Pick<TitlePolicyStore, "get"> & { opportunityTitles(): Promise<Array<{ id: string; title: string | null; status?: string }>> },
): Promise<{ ids: string[]; active: number; dismissed: number }> {
  const policy = snapshotOf(await store.get(titlePolicyDomain)).policy;
  const outside = (await store.opportunityTitles()).filter((row) => policy(row.title).verdict !== "ACCEPTED");
  return {
    ids: outside.map((row) => row.id),
    active: outside.filter((row) => row.status !== undefined && activeStatuses.has(row.status)).length,
    dismissed: outside.filter((row) => row.status === "REJECTED_BY_USER").length,
  };
}

export async function opportunitiesOutsideTargetTitles(
  store: Parameters<typeof outsideTargetTitles>[0],
): Promise<string[]> {
  return (await outsideTargetTitles(store)).ids;
}

const patternList = z.array(z.string().max(titlePolicyPatternMaxLength)).max(titlePolicyMaxPatterns);
const bodySchema = z.object({ accepted: patternList, excluded: patternList }).strict();

const view = (snapshot: TitlePolicySnapshot) => ({
  accepted: snapshot.patterns.accepted,
  excluded: snapshot.patterns.excluded,
  isDefault: snapshot.isDefault,
  updatedAt: snapshot.updatedAt?.toISOString() ?? null,
  defaults: defaultTitlePolicyPatterns,
});

export function createTitlePolicyApiHandlers(store: TitlePolicyStore) {
  return {
    async get() {
      try {
        return Response.json(view(snapshotOf(await store.get(titlePolicyDomain))));
      } catch {
        return Response.json({ error: "Target job titles could not be loaded", code: "INTERNAL_ERROR" }, { status: 500 });
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
      if (!parsed.success) {
        return Response.json(
          {
            error: `Invalid target job titles: at most ${titlePolicyMaxPatterns} patterns of up to ${titlePolicyPatternMaxLength} characters each.`,
            code: "REQUEST_INVALID",
          },
          { status: 400 },
        );
      }
      const accepted = cleanTitlePolicyPatterns(parsed.data.accepted);
      const excluded = cleanTitlePolicyPatterns(parsed.data.excluded);
      if (accepted.length === 0) {
        return Response.json(
          {
            error: "Keep at least one accepted title pattern; without one, automatic capture would skip every job.",
            code: "REQUEST_INVALID",
            fields: [{ field: "accepted", message: "Add at least one accepted title pattern." }],
          },
          { status: 400 },
        );
      }
      try {
        return Response.json(view(snapshotOf(await store.save(titlePolicyDomain, { accepted, excluded }))));
      } catch {
        return Response.json({ error: "Target job titles could not be saved", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
    async reset() {
      try {
        await store.clear(titlePolicyDomain);
        return Response.json(view(snapshotOf(null)));
      } catch {
        return Response.json({ error: "Target job titles could not be reset", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    },
  };
}
