import { getDatabaseClient } from "./client";

// The centralized Possible Duplicates review (November 25, 2026). Stored
// duplicate relationships (DuplicateReference, MATCH and PROBABLE_MATCH; never
// NO_MATCH) are grouped into connected sets of opportunities, so a set of
// three similar jobs is one group, not three repeated pairs. Grouping is for
// review only: nothing is merged, and every decision stays per pair.
//
// Scale: only the relationships' ids and states are read to build groups
// (a few per opportunity: at most three probable matches are stored for each
// new one); the opportunities' details are read for the requested page's
// groups only.

export type DuplicatePairState = "UNRESOLVED" | "DISTINCT" | "SAME_JOB";

export interface DuplicateEdge {
  id: string;
  opportunityId: string;
  relatedOpportunityId: string;
  decision: "MATCH" | "PROBABLE_MATCH";
  confidence: number | null;
  matchedOn: string[];
  conflicts: string[];
  state: DuplicatePairState;
  createdAt: Date;
}

export interface DuplicateGroupShape {
  key: string;
  memberIds: string[];
  edges: DuplicateEdge[];
  unresolved: number;
  latestAt: Date;
}

export type DuplicateGroupFilter = "open" | "decided" | "all";

// Connected components (union-find), each listed once. Members and edges are
// in a stable order, so a group looks the same from wherever it is opened.
export function buildDuplicateGroups(edges: readonly DuplicateEdge[]): DuplicateGroupShape[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let node = id;
    while (parent.get(node) !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  for (const edge of edges) {
    for (const id of [edge.opportunityId, edge.relatedOpportunityId]) if (!parent.has(id)) parent.set(id, id);
    const left = find(edge.opportunityId);
    const right = find(edge.relatedOpportunityId);
    if (left !== right) parent.set(left < right ? right : left, left < right ? left : right);
  }
  const groups = new Map<string, { members: Set<string>; edges: DuplicateEdge[] }>();
  for (const edge of edges) {
    const root = find(edge.opportunityId);
    const group = groups.get(root) ?? { members: new Set<string>(), edges: [] };
    group.members.add(edge.opportunityId).add(edge.relatedOpportunityId);
    group.edges.push(edge);
    groups.set(root, group);
  }
  return [...groups.values()]
    .map((group) => {
      const memberIds = [...group.members].sort();
      const sorted = [...group.edges].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || (left.id < right.id ? -1 : 1));
      return {
        key: memberIds[0]!,
        memberIds,
        edges: sorted,
        unresolved: sorted.filter((edge) => edge.state === "UNRESOLVED").length,
        latestAt: sorted.reduce((latest, edge) => (edge.createdAt > latest ? edge.createdAt : latest), sorted[0]!.createdAt),
      };
    })
    // Newest relationships first, then a stable key.
    .sort((left, right) => right.latestAt.getTime() - left.latestAt.getTime() || (left.key < right.key ? -1 : 1));
}

export interface DuplicateReviewMember {
  id: string;
  title: string | null;
  companyName: string | null;
  location: string | null;
  workArrangements: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  source: string | null;
  originalSource: string | null;
  sourceType: string | null;
  canonicalUrl: string | null;
  applicationUrl: string | null;
  externalListingId: string | null;
  atsRequisitionId: string | null;
  description: string | null;
  status: string;
  triageOutcome: string | null;
  hasApplication: boolean;
  firstSeenAt: Date;
}

export interface DuplicateReviewPage {
  groups: Array<DuplicateGroupShape & { members: DuplicateReviewMember[] }>;
  counts: { open: number; decided: number; all: number };
  filter: DuplicateGroupFilter;
  page: number;
  pageCount: number;
  pageSize: number;
}

type Database = ReturnType<typeof getDatabaseClient>;

const stateOf = (resolution: string | null): DuplicatePairState =>
  resolution === "DISTINCT" ? "DISTINCT" : resolution === "SAME_JOB" ? "SAME_JOB" : "UNRESOLVED";

export class PrismaDuplicateReviewRepository {
  constructor(private readonly database: Database = getDatabaseClient()) {}

  async edges(): Promise<DuplicateEdge[]> {
    const rows = await this.database.duplicateReference.findMany({
      where: { decision: { not: "NO_MATCH" } },
      select: { id: true, opportunityId: true, relatedOpportunityId: true, decision: true, confidence: true, evidence: true, resolution: true, createdAt: true },
    });
    return rows.map((row) => {
      const evidence = (row.evidence ?? {}) as { matchedOn?: string[]; conflicts?: string[] };
      return {
        id: row.id,
        opportunityId: row.opportunityId,
        relatedOpportunityId: row.relatedOpportunityId,
        decision: row.decision as DuplicateEdge["decision"],
        confidence: row.confidence === null ? null : Number(row.confidence),
        matchedOn: evidence.matchedOn ?? [],
        conflicts: evidence.conflicts ?? [],
        state: stateOf(row.resolution),
        createdAt: row.createdAt,
      };
    });
  }

  async members(ids: readonly string[]): Promise<DuplicateReviewMember[]> {
    if (!ids.length) return [];
    const rows = await this.database.opportunity.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true, title: true, location: true, workArrangements: true, salaryMin: true, salaryMax: true, currency: true,
        source: true, originalSource: true, sourceType: true, canonicalUrl: true, applicationUrl: true,
        externalListingId: true, atsRequisitionId: true, jobDescription: true, status: true, firstSeenAt: true,
        company: { select: { name: true } },
        preEvaluatorTriage: { select: { outcome: true, manualDecision: true } },
        application: { select: { id: true } },
      },
    });
    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        companyName: row.company?.name ?? null,
        location: row.location,
        workArrangements: row.workArrangements,
        salaryMin: row.salaryMin === null ? null : Number(row.salaryMin),
        salaryMax: row.salaryMax === null ? null : Number(row.salaryMax),
        currency: row.currency,
        source: row.source,
        originalSource: row.originalSource,
        sourceType: row.sourceType,
        canonicalUrl: row.canonicalUrl,
        applicationUrl: row.applicationUrl,
        externalListingId: row.externalListingId,
        atsRequisitionId: row.atsRequisitionId,
        description: row.jobDescription,
        status: row.status,
        triageOutcome: row.preEvaluatorTriage ? (row.preEvaluatorTriage.manualDecision ?? row.preEvaluatorTriage.outcome) : null,
        hasApplication: row.application !== null,
        firstSeenAt: row.firstSeenAt,
      }))
      .sort((left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime() || (left.id < right.id ? -1 : 1));
  }

  async page(input: { filter: DuplicateGroupFilter; page: number; pageSize: number; groupKey?: string | null }): Promise<DuplicateReviewPage> {
    const all = buildDuplicateGroups(await this.edges());
    const counts = { open: all.filter((group) => group.unresolved > 0).length, decided: all.filter((group) => group.unresolved === 0).length, all: all.length };
    const filtered = input.groupKey
      ? all.filter((group) => group.memberIds.includes(input.groupKey!))
      : all.filter((group) => (input.filter === "all" ? true : input.filter === "open" ? group.unresolved > 0 : group.unresolved === 0));
    const pageCount = Math.max(1, Math.ceil(filtered.length / input.pageSize));
    const page = Math.min(Math.max(1, input.page), pageCount);
    const slice = filtered.slice((page - 1) * input.pageSize, page * input.pageSize);
    const members = await this.members(slice.flatMap((group) => group.memberIds));
    const byId = new Map(members.map((member) => [member.id, member]));
    return {
      groups: slice.map((group) => ({ ...group, members: members.filter((member) => group.memberIds.includes(member.id)).filter((member) => byId.has(member.id)) })),
      counts,
      filter: input.filter,
      page,
      pageCount,
      pageSize: input.pageSize,
    };
  }
}
