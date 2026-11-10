import Link from "next/link";
import { opportunityHref, type OpportunityQuery } from "../../server/opportunity-query";

export function Pagination({
  query,
  page,
  pageCount,
}: {
  query: OpportunityQuery;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => opportunityHref({ ...query, page: target });
  return (
    <nav className="pagination" aria-label="Opportunity pages">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span aria-disabled="true">← Previous</span>
      )}
      <span aria-current="page">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} rel="next">
          Next →
        </Link>
      ) : (
        <span aria-disabled="true">Next →</span>
      )}
    </nav>
  );
}
