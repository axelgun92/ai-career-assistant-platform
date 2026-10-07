"use client";

import type { DashboardFilterOptions } from "@ai-career/database";
import {
  defaultPageSize,
  defaultSort,
  defaultView,
  evaluationStateOptions,
  hasActiveFilters,
  priorityOptions,
  recommendationOptions,
  roleFamilyOptions,
  segmentOptions,
  sourceTypeOptions,
  type OpportunityQuery,
} from "../../server/opportunity-query";
import {
  evaluationStateLabels,
  priorityLabels,
  recommendationLabels,
  roleFamilyLabels,
  segmentLabels,
  sortChoices,
  sourceTypeFilterLabels,
} from "./labels";

function CheckboxFilter<T extends Record<string, string>>({
  name,
  legend,
  options,
  labels,
  selected,
}: {
  name: keyof OpportunityQuery & string;
  legend: string;
  options: T;
  labels: Record<keyof T & string, string>;
  selected: string[];
}) {
  return (
    <fieldset className="filter-group">
      <legend>{legend}</legend>
      {(Object.keys(options) as Array<keyof T & string>).map((value) => (
        <label key={value} className="checkbox-label">
          <input type="checkbox" name={name} value={value} defaultChecked={selected.includes(value)} />
          {labels[value]}
        </label>
      ))}
    </fieldset>
  );
}

// A plain GET form: every submission is a URL (bookmarkable, back/forward
// friendly) and works without JavaScript. With JavaScript, changing a
// checkbox, select or date submits immediately; text submits on Enter.
export function OpportunityFilters({
  query,
  options,
}: {
  query: OpportunityQuery;
  options: DashboardFilterOptions;
}) {
  const filtersOpen = hasActiveFilters({ ...query, q: "" });
  const autoSubmit = (event: React.ChangeEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === "text") return;
    if (target instanceof HTMLInputElement && target.type === "search") return;
    event.currentTarget.requestSubmit();
  };
  return (
    <form className="opportunity-filters" method="get" action="/" role="search" aria-label="Search and filter opportunities" onChange={autoSubmit}>
      {query.view !== defaultView ? <input type="hidden" name="view" value={query.view} /> : null}
      {query.pageSize !== defaultPageSize ? <input type="hidden" name="pageSize" value={query.pageSize} /> : null}
      <div className="filter-bar">
        <label className="filter-search">
          <span className="visually-hidden">Search opportunities</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Search title, company, location, source…"
            maxLength={400}
          />
        </label>
        <button type="submit">Search</button>
        <label className="inline-label filter-sort">
          Sort
          <select name="sort" defaultValue={query.sort}>
            {sortChoices.map((choice) => (
              <option key={choice.value} value={choice.value === defaultSort ? "" : choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="filter-panel" open={filtersOpen}>
        <summary>Filters</summary>
        <div className="filter-grid">
          <CheckboxFilter name="rec" legend="Recommendation" options={recommendationOptions} labels={recommendationLabels} selected={query.rec} />
          <CheckboxFilter name="eval" legend="Evaluation" options={evaluationStateOptions} labels={evaluationStateLabels} selected={query.eval} />
          <CheckboxFilter name="priority" legend="Priority" options={priorityOptions} labels={priorityLabels} selected={query.priority} />
          <CheckboxFilter name="role" legend="Role family" options={roleFamilyOptions} labels={roleFamilyLabels} selected={query.role} />
          <CheckboxFilter name="segment" legend="Customer segment" options={segmentOptions} labels={segmentLabels} selected={query.segment} />
          <CheckboxFilter name="sourceType" legend="Source type" options={sourceTypeOptions} labels={sourceTypeFilterLabels} selected={query.sourceType} />
          <fieldset className="filter-group filter-group-details">
            <legend>Details</legend>
            <label>
              Company
              <select name="company" defaultValue={query.company ?? ""}>
                <option value="">Any company</option>
                {options.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} ({company.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select name="source" defaultValue={query.source ?? ""}>
                <option value="">Any source</option>
                {options.sources.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.value} ({source.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Domain
              <select name="domain" defaultValue={query.domain ?? ""}>
                <option value="">Any domain</option>
                {options.domains.map((domain) => (
                  <option key={domain.value} value={domain.value}>
                    {domain.value} ({domain.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Salary
              <select name="salary" defaultValue={query.salary ?? ""}>
                <option value="">Any</option>
                <option value="stated">Salary stated</option>
                <option value="not-stated">Salary not stated</option>
              </select>
            </label>
            <label>
              Title contains
              <input type="text" name="title" defaultValue={query.title ?? ""} maxLength={200} />
            </label>
            <label>
              Location contains
              <input type="text" name="location" defaultValue={query.location ?? ""} maxLength={200} />
            </label>
            <label>
              Discovered from
              <input type="date" name="from" defaultValue={query.from ?? ""} />
            </label>
            <label>
              Discovered to
              <input type="date" name="to" defaultValue={query.to ?? ""} />
            </label>
          </fieldset>
        </div>
        <div className="evaluation-actions">
          <button type="submit">Apply filters</button>
        </div>
      </details>
    </form>
  );
}
