"use client";

import {
  applicationOutcomeOptions,
  applicationSortOptions,
  applicationStageOptions,
  defaultApplicationSort,
  defaultApplicationView,
  followUpFilterOptions,
  hasApplicationFilters,
  type ApplicationQuery,
} from "../../server/application-query";
import { outcomeLabels, stageLabels } from "./labels";

// A plain GET form, like the dashboard filters: every state is a URL.
export function ApplicationFilters({ query }: { query: ApplicationQuery }) {
  const autoSubmit = (event: React.ChangeEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === "search") return;
    event.currentTarget.requestSubmit();
  };
  return (
    <form
      className="opportunity-filters"
      method="get"
      action="/applications"
      role="search"
      aria-label="Search and filter applications"
      onChange={autoSubmit}
    >
      {query.view !== defaultApplicationView ? <input type="hidden" name="view" value={query.view} /> : null}
      <div className="filter-bar">
        <label className="filter-search">
          <span className="visually-hidden">Search applications</span>
          <input type="search" name="q" defaultValue={query.q} placeholder="Search role or company…" maxLength={400} />
        </label>
        <button type="submit">Search</button>
        <label className="inline-label filter-sort">
          Sort
          <select name="sort" defaultValue={query.sort === defaultApplicationSort ? "" : query.sort}>
            {(Object.keys(applicationSortOptions) as Array<keyof typeof applicationSortOptions>).map((value) => (
              <option key={value} value={value === defaultApplicationSort ? "" : value}>
                {applicationSortOptions[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="filter-panel" open={hasApplicationFilters({ ...query, q: "" })}>
        <summary>Filters</summary>
        <div className="filter-grid">
          <fieldset className="filter-group">
            <legend>Stage</legend>
            {(Object.keys(applicationStageOptions) as Array<keyof typeof applicationStageOptions>).map((value) => (
              <label key={value} className="checkbox-label">
                <input type="checkbox" name="stage" value={value} defaultChecked={query.stage.includes(value)} />
                {stageLabels[applicationStageOptions[value]]}
              </label>
            ))}
          </fieldset>
          <fieldset className="filter-group">
            <legend>Outcome</legend>
            {(Object.keys(applicationOutcomeOptions) as Array<keyof typeof applicationOutcomeOptions>).map((value) => (
              <label key={value} className="checkbox-label">
                <input type="checkbox" name="outcome" value={value} defaultChecked={query.outcome.includes(value)} />
                {outcomeLabels[applicationOutcomeOptions[value]]}
              </label>
            ))}
          </fieldset>
          <fieldset className="filter-group filter-group-details">
            <legend>Follow-ups and dates</legend>
            <label>
              Follow-up
              <select name="followUp" defaultValue={query.followUp ?? ""}>
                <option value="">Any</option>
                {(Object.keys(followUpFilterOptions) as Array<keyof typeof followUpFilterOptions>).map((value) => (
                  <option key={value} value={value}>
                    {followUpFilterOptions[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Applied from
              <input type="date" name="from" defaultValue={query.from ?? ""} />
            </label>
            <label>
              Applied to
              <input type="date" name="to" defaultValue={query.to ?? ""} />
            </label>
          </fieldset>
        </div>
      </details>
    </form>
  );
}
