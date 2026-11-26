import type { DuplicateReviewMember, DuplicateGroupFilter } from "@ai-career/database";
import { descriptionOverlap } from "./duplicate-history-diagnostic";

// The Possible Duplicates review page (November 25, 2026): URL state and the
// plain-words comparison of a group's listings. Read-only.

export const duplicateReviewPageSize = 10;

export function parseDuplicateReviewQuery(params: Record<string, string | string[] | undefined>): {
  filter: DuplicateGroupFilter;
  page: number;
  group: string | null;
} {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const show = first("show");
  const filter: DuplicateGroupFilter = show === "decided" || show === "all" ? show : "open";
  const page = Number(first("page"));
  const group = first("group");
  return {
    filter,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    group: group && /^[0-9a-f-]{36}$/i.test(group) ? group.toLowerCase() : null,
  };
}

const sentences = (text: string | null) =>
  (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 25);
const sentenceKey = (sentence: string) => sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export interface DescriptionComparison {
  // Against the group's earliest listing; null for that listing itself or
  // when either description is too short to compare.
  similarity: number | null;
  // A few sentences this listing has and the earliest one does not.
  onlyHere: string[];
  onlyHereCount: number;
}

export function compareDescriptions(member: DuplicateReviewMember, reference: DuplicateReviewMember): DescriptionComparison {
  if (member.id === reference.id) return { similarity: null, onlyHere: [], onlyHereCount: 0 };
  const overlap = member.description && reference.description ? descriptionOverlap(member.description, reference.description) : null;
  const known = new Set(sentences(reference.description).map(sentenceKey));
  const only = sentences(member.description).filter((sentence) => !known.has(sentenceKey(sentence)));
  return { similarity: overlap ? overlap.jaccard : null, onlyHere: only.slice(0, 3), onlyHereCount: only.length };
}

// The fields that differ across the group, so the page can point them out.
export function differingFields(members: readonly DuplicateReviewMember[]): Set<string> {
  const fields: Array<[string, (member: DuplicateReviewMember) => string]> = [
    ["title", (member) => (member.title ?? "").toLowerCase().trim()],
    ["company", (member) => (member.companyName ?? "").toLowerCase().trim()],
    ["location", (member) => (member.location ?? "").toLowerCase().trim()],
    ["salary", (member) => `${member.salaryMin ?? ""}-${member.salaryMax ?? ""} ${member.currency ?? ""}`],
    ["arrangement", (member) => [...member.workArrangements].sort().join(",")],
    ["source", (member) => member.source ?? ""],
  ];
  return new Set(fields.filter(([, value]) => new Set(members.map(value)).size > 1).map(([name]) => name));
}
