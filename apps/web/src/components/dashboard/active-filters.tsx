import Link from "next/link";
import {
  clearFilters,
  hasActiveFilters,
  opportunityHref,
  type OpportunityQuery,
} from "../../server/opportunity-query";
import { activeFilterChips } from "./labels";

// Result count, one removable chip per active filter, and clear-all.
export function ActiveFilters({
  query,
  total,
  page,
  pageSize,
  companyNames,
}: {
  query: OpportunityQuery;
  total: number;
  page: number;
  pageSize: number;
  companyNames: Record<string, string>;
}) {
  const chips = activeFilterChips(query, { companies: companyNames });
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="active-filters">
      <p className="result-count" aria-live="polite">
        {total === 0
          ? "No opportunities found"
          : `Showing ${first}–${last} of ${total} ${total === 1 ? "opportunity" : "opportunities"}`}
      </p>
      {chips.length ? (
        <ul className="filter-chips" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.label}>
              <Link href={chip.removeHref} className="filter-chip" aria-label={`Remove filter ${chip.label}`}>
                {chip.label} <span aria-hidden="true">×</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {hasActiveFilters(query) ? (
        <Link href={opportunityHref(clearFilters(query))} className="clear-filters">
          Clear all filters
        </Link>
      ) : null}
    </div>
  );
}
