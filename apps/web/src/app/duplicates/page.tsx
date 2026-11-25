import Link from "next/link";
import { connection } from "next/server";
import { PrismaDuplicateReviewRepository, type DuplicateReviewPage } from "@ai-career/database";
import { DuplicateGroupCard } from "@/components/duplicates/duplicate-group-card";
import { formatLifecycle } from "@/components/dashboard/format";
import { formatSalaryRange, workArrangementLabel } from "@/components/opportunity-facts";
import { compareDescriptions, differingFields, duplicateReviewPageSize, parseDuplicateReviewQuery } from "@/server/duplicate-review";

export const metadata = { title: "Possible duplicates" };

const triageLabels: Record<string, string> = { EVALUATE: "Evaluate", NEEDS_REVIEW: "Needs Review", REJECT: "Rejected" };

const tabs = [
  { key: "open", label: "To review" },
  { key: "decided", label: "Decided" },
  { key: "all", label: "All" },
] as const;

// Possible Duplicates (November 25, 2026): every stored duplicate
// relationship, grouped into sets of similar listings, with each pair's
// decision and the listings side by side. Grouping is for review only;
// nothing is merged in the database.
export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const query = parseDuplicateReviewQuery(await searchParams);
  let review: DuplicateReviewPage | null = null;
  try {
    review = await new PrismaDuplicateReviewRepository().page({ filter: query.filter, page: query.page, pageSize: duplicateReviewPageSize, groupKey: query.group });
  } catch (error) {
    console.error("Possible duplicates could not be loaded", { errorName: error instanceof Error ? error.name : "UnknownError" });
  }
  const href = (changes: { show?: string; page?: number }) => {
    const params = new URLSearchParams();
    const show = changes.show ?? query.filter;
    if (show !== "open") params.set("show", show);
    if ((changes.page ?? 1) > 1) params.set("page", String(changes.page));
    const text = params.toString();
    return text ? `/duplicates?${text}` : "/duplicates";
  };

  return (
    <main className="duplicates-page">
      <p>
        <Link href="/">← Back to opportunities</Link>
      </p>
      <h1>Possible duplicates</h1>
      <p>
        Similar listings are grouped so you can compare them once and decide each pair. Grouping never merges anything: every listing
        keeps its own sources, history and evaluations. Decide <strong>Not the same job</strong> or <strong>Same job</strong> for each pair,
        and <strong>Keep</strong> or <strong>Dismiss</strong> each listing on its own: keep any combination, and a dismissed listing stays
        here so you can keep it again. Keeping or dismissing never records a duplicate decision. Or leave a group for later.
      </p>
      {review === null ? (
        <p className="error-message" role="alert">Possible duplicates could not be loaded. Check the database connection and try again.</p>
      ) : (
        <>
          <p role="status" className="duplicates-count">
            <strong>{review.counts.open}</strong> {review.counts.open === 1 ? "group" : "groups"} to review · {review.counts.decided} decided
          </p>
          {query.group ? (
            <p>
              Showing the group of one opportunity. <Link href="/duplicates">Show every group</Link>
            </p>
          ) : (
            <nav className="view-tabs" aria-label="Duplicate groups">
              {tabs.map((tab) => (
                <Link key={tab.key} href={href({ show: tab.key })} aria-current={tab.key === query.filter ? "page" : undefined}>
                  {tab.label}
                  <span className="view-tab-count"> {review!.counts[tab.key]}</span>
                </Link>
              ))}
            </nav>
          )}
          {review.groups.length === 0 ? (
            <div className="empty-state" role="status">
              <p>{query.filter === "open" ? "No possible duplicates are waiting for a decision." : "No groups here."}</p>
            </div>
          ) : (
            review.groups.map((group) => {
              const first = group.members[0];
              const differing = differingFields(group.members);
              const label = first ? [first.companyName ?? "Unknown company", first.title ?? "Untitled opportunity"].join(" / ") : "Possible duplicates";
              return (
                <DuplicateGroupCard
                  key={group.key}
                  label={label}
                  differing={[...differing]}
                  members={group.members.map((member) => ({
                    id: member.id,
                    title: member.title ?? "Untitled opportunity",
                    companyName: member.companyName,
                    location: member.location,
                    salary: formatSalaryRange(member.salaryMin, member.salaryMax, member.currency),
                    arrangement: member.workArrangements.length ? member.workArrangements.map((value) => workArrangementLabel(value)).join(", ") : null,
                    sourceWebsite: member.originalSource ?? member.source,
                    listingUrl: member.canonicalUrl,
                    applicationUrl: member.applicationUrl,
                    listingId: member.externalListingId,
                    requisitionId: member.atsRequisitionId,
                    status: member.status,
                    statusLabel: formatLifecycle(member.status),
                    triageLabel: member.triageOutcome ? (triageLabels[member.triageOutcome] ?? member.triageOutcome) : "Not triaged",
                    hasApplication: member.hasApplication,
                    firstSeen: member.firstSeenAt.toISOString().slice(0, 10),
                    description: first ? compareDescriptions(member, first) : { similarity: null, onlyHere: [], onlyHereCount: 0 },
                  }))}
                  pairs={group.edges
                    .filter((edge) => group.members.some((member) => member.id === edge.opportunityId) && group.members.some((member) => member.id === edge.relatedOpportunityId))
                    .map((edge) => ({
                      opportunityId: edge.opportunityId,
                      relatedOpportunityId: edge.relatedOpportunityId,
                      decision: edge.decision,
                      confidence: edge.confidence,
                      matchedOn: edge.matchedOn,
                      conflicts: edge.conflicts,
                      state: edge.state,
                    }))}
                />
              );
            })
          )}
          {review.pageCount > 1 && !query.group ? (
            <nav className="pagination" aria-label="Pages of duplicate groups">
              {review.page > 1 ? <Link href={href({ page: review.page - 1 })}>Previous</Link> : null}
              <span>Page {review.page} of {review.pageCount}</span>
              {review.page < review.pageCount ? <Link href={href({ page: review.page + 1 })}>Next</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
