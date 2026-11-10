import Link from "next/link";
import {
  arrangementKeys,
  companySortKeys,
  companyWindowKeys,
  type CiDistribution,
  type CiTiming,
  type CompanyDetail,
  type CompanyIndex,
} from "@ai-career/core";
import { Bars, RateValue } from "../sources/source-insights";
import { geographyLabels, sampleLabels } from "../sources/insight-labels";
import { arrangementLabels, segmentLabels, titleGroupLabel } from "../market/market-labels";
import { customerTypeLabels } from "../my-search/my-search-labels";
import {
  applicationStageLabels,
  businessModelLabels,
  companyClosedLabels,
  companySortLabels,
  companyWindowPhrase,
  companyWindowLabels,
  day,
  listingStateLabels,
} from "./company-labels";

// Company Intelligence views (feature 18). Server-rendered and read-only.
// Observed facts with their counts; no score, rank, label or colouring.

type Label = (key: string) => string;
const fromTable = (labels: Record<string, string>): Label => (key) => labels[key] ?? key;

const companyHref = (id: string, window?: CompanyDetail["window"]) => {
  const params = new URLSearchParams();
  if (window && window.key !== "all") {
    params.set("window", window.key);
    if (window.key === "custom") {
      params.set("from", window.from?.slice(0, 10) ?? "");
      params.set("to", new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
  }
  const query = params.toString();
  return `/companies/${id}${query ? `?${query}` : ""}`;
};

function WindowFields({ window }: { window: CompanyIndex["window"] }) {
  const customEnd = window.key === "custom" ? new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
  return (
    <>
      <label>
        Window
        <select name="window" defaultValue={window.key}>
          {companyWindowKeys.map((key) => (
            <option key={key} value={key}>
              {companyWindowLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        From (custom)
        <input type="date" name="from" defaultValue={window.key === "custom" ? window.from?.slice(0, 10) ?? "" : ""} />
      </label>
      <label>
        To (custom)
        <input type="date" name="to" defaultValue={customEnd} />
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Index

export function CompanyIndexControls({ index }: { index: CompanyIndex }) {
  const filters = index.filters;
  return (
    <form className="insights-controls" method="get" action="/companies" aria-label="Company options">
      <label>
        Company name
        <input type="search" name="q" defaultValue={filters.q ?? ""} />
      </label>
      <WindowFields window={index.window} />
      <label>
        Title group
        <select name="titleGroup" defaultValue={filters.titleGroup ?? ""}>
          <option value="">Any</option>
          {index.titleGroups.map((key) => (
            <option key={key} value={key}>
              {titleGroupLabel(key)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Work arrangement
        <select name="arrangement" defaultValue={filters.arrangement ?? ""}>
          <option value="">Any</option>
          {arrangementKeys.map((key) => (
            <option key={key} value={key}>
              {arrangementLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Order by
        <select name="sort" defaultValue={index.sort}>
          {companySortKeys.map((key) => (
            <option key={key} value={key}>
              {companySortLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="listed" value="1" defaultChecked={filters.listed} /> Has currently listed roles
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="applied" value="1" defaultChecked={filters.applied} /> Has your applications
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="signals" value="1" defaultChecked={filters.signals} /> Has posting-history signals
      </label>
      <button type="submit" className="secondary-button">
        Show
      </button>
      <p className="muted">
        Companies appear when a role was first observed in the window; their applications are counted by application date. Title group and work arrangement
        narrow both. “Listed again after removal” is the same listing seen again after a confirmed removal; a relisting under a new listing ID is shown on the
        company page.
      </p>
    </form>
  );
}

function pageHref(index: CompanyIndex, page: number) {
  const params = new URLSearchParams();
  const filters = index.filters;
  if (index.window.key !== "all") params.set("window", index.window.key);
  if (index.window.key === "custom") {
    params.set("from", index.window.from?.slice(0, 10) ?? "");
    params.set("to", new Date(new Date(index.window.to).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  if (filters.q) params.set("q", filters.q);
  if (filters.titleGroup) params.set("titleGroup", filters.titleGroup);
  if (filters.arrangement) params.set("arrangement", filters.arrangement);
  for (const key of ["listed", "applied", "signals"] as const) if (filters[key]) params.set(key, "1");
  if (index.sort !== "roles") params.set("sort", index.sort);
  params.set("page", String(page));
  return `/companies?${params.toString()}`;
}

export function CompanyIndexView({ index }: { index: CompanyIndex }) {
  return (
    <section aria-labelledby="company-list" className="market-section">
      <h2 id="company-list">Companies</h2>
      <p>
        {index.total} {index.total === 1 ? "company" : "companies"} with roles first observed {companyWindowPhrase(index.window)}; your applications to them are
        counted by their application date.
        {index.withoutCompany ? ` ${index.withoutCompany} ${index.withoutCompany === 1 ? "job has" : "jobs have"} no recorded company and ${index.withoutCompany === 1 ? "is" : "are"} not shown.` : ""}
      </p>
      <p className="muted">{index.notes.identity}</p>
      {index.rows.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Companies by {companySortLabels[index.sort].toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Observed roles</th>
                <th scope="col">Currently listed</th>
                <th scope="col">Listed again after removal</th>
                <th scope="col">Recurring role groups</th>
                <th scope="col">Remote</th>
                <th scope="col">Your applications</th>
                <th scope="col">Interviews</th>
                <th scope="col">Offers</th>
                <th scope="col">Last observed</th>
              </tr>
            </thead>
            <tbody>
              {index.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <Link href={companyHref(row.id)}>{row.name}</Link>
                    {row.otherNames.length ? <span className="muted"> · +{row.otherNames.length} name {row.otherNames.length === 1 ? "variant" : "variants"}</span> : null}
                  </th>
                  <td>{row.observedRoles}</td>
                  <td>{row.currentlyListed}</td>
                  <td>{row.listedAgain}</td>
                  <td>{row.recurringGroups}</td>
                  <td>
                    {row.arrangementKnown ? `${row.remote} of ${row.arrangementKnown}` : "Not stated"}
                    {row.arrangementUnknown ? <span className="muted"> · {row.arrangementUnknown} unknown</span> : null}
                  </td>
                  <td>{row.applications}</td>
                  <td>{row.interviews}</td>
                  <td>{row.offers}</td>
                  <td>{day(row.lastObservedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No companies match these options.</p>
      )}
      {index.pageCount > 1 ? (
        <nav className="opportunity-links" aria-label="Company pages">
          {index.page > 1 ? <Link href={pageHref(index, index.page - 1)}>← Previous</Link> : null}
          <span>
            Page {index.page} of {index.pageCount}
          </span>
          {index.page < index.pageCount ? <Link href={pageHref(index, index.page + 1)}>Next →</Link> : null}
        </nav>
      ) : null}
      <p className="market-disclosure">{index.notes.postings}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detail building blocks

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DistributionTable({ caption, distribution, label, unit = "roles" }: { caption: string; distribution: CiDistribution; label: Label; unit?: string }) {
  if (!distribution.total) return <p>No {unit} in this window.</p>;
  return (
    <>
      <Bars label={caption} rows={distribution.rows.map((row) => ({ label: label(row.key), count: row.count }))} />
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Roles</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {distribution.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{label(row.key)}</th>
                <td>{row.count}</td>
                <td>
                  <RateValue rate={row.share} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {distribution.multiValued ? <p className="muted">A role open to several regions counts in each, so shares can add up to more than 100%.</p> : null}
    </>
  );
}

export function timingText(timing: CiTiming, none = "No dates recorded"): string {
  const inconsistent = timing.inconsistent ? ` (${timing.inconsistent} with dates out of order not counted)` : "";
  if (!timing.n) return `${none}${inconsistent}`;
  const sample = sampleLabels[timing.sample];
  const unit = (value: number) => `${value} ${value === 1 ? "day" : "days"}`;
  const figure = timing.median !== null ? `Median ${unit(timing.median)}` : `${timing.values.join(", ")} ${timing.values.length === 1 && timing.values[0] === 1 ? "day" : "days"}`;
  return `${figure} (n = ${timing.n})${sample ? ` · ${sample}` : ""}${inconsistent}`;
}

// ---------------------------------------------------------------------------
// Detail

export const companySections = [
  { id: "overview", label: "Overview" },
  { id: "postings", label: "Observed postings" },
  { id: "recurring", label: "Recurring roles" },
  { id: "arrangement", label: "Work arrangement and hiring regions" },
  { id: "history", label: "Your history with this company" },
  { id: "signals", label: "Posting-history signals" },
] as const;

export function CompanyDetailControls({ detail }: { detail: CompanyDetail }) {
  return (
    <form className="insights-controls" method="get" action={`/companies/${detail.company.id}`} aria-label="Company window">
      <WindowFields window={detail.window} />
      <button type="submit" className="secondary-button">
        Show
      </button>
    </form>
  );
}

export function CompanyOverview({ detail }: { detail: CompanyDetail }) {
  const overview = detail.overview;
  const type = overview.companyType;
  return (
    <section aria-labelledby="overview" className="market-section">
      <h2 id="overview">Overview</h2>
      <p>
        Roles first observed {companyWindowPhrase(detail.window)} and your applications dated then. Listing status is as of now.
      </p>
      {detail.company.names.length > 1 ? <p>Names grouped here: {detail.company.names.join("; ")}</p> : null}
      <dl className="usage-totals-grid insights-tiles">
        <Tile label="Observed roles">{overview.observedRoles}</Tile>
        <Tile label="First observed">{day(overview.firstObservedAt)}</Tile>
        <Tile label="Last observed">{day(overview.lastObservedAt)}</Tile>
        <Tile label="Currently listed">{overview.currentlyListed}</Tile>
        <Tile label="No longer listed">{overview.noLongerListed}</Tile>
        <Tile label="Status unknown">{overview.statusUnknown}</Tile>
        <Tile label="Your applications">{overview.applications}</Tile>
      </dl>
      <h3>Company type (from evaluated roles)</h3>
      <p>
        From each role’s latest completed evaluation: {type.evaluatedRoles} of {type.roles} {type.roles === 1 ? "role" : "roles"} evaluated. Roles can be
        classified differently; each is counted as stored.
      </p>
      {type.evaluatedRoles ? (
        <>
          <DistributionTable caption="Customer segment" distribution={type.customerSegment} label={fromTable(segmentLabels)} />
          <DistributionTable caption="Customer type" distribution={type.customerType} label={fromTable(customerTypeLabels)} />
          <DistributionTable caption="Business model" distribution={type.businessModel} label={fromTable(businessModelLabels)} />
        </>
      ) : null}
      <p className="muted">{detail.notes.identity}</p>
    </section>
  );
}

export function CompanyPostings({ detail }: { detail: CompanyDetail }) {
  const postings = detail.postings;
  const duration = postings.duration;
  return (
    <section aria-labelledby="postings" className="market-section">
      <h2 id="postings">Observed postings</h2>
      <p>Distinct roles by the month they were first observed. A role seen on several sources counts once.</p>
      {postings.months.length ? (
        <>
          <Bars label="Observed roles by month" rows={postings.months.map((row) => ({ label: row.month, count: row.roles }))} />
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Observed roles by month</caption>
              <tbody>
                {postings.months.map((row) => (
                  <tr key={row.month}>
                    <th scope="row">{row.month}</th>
                    <td>{row.roles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No roles observed in this window.</p>
      )}
      <p>Roles whose posting changed after it was first stored: {postings.changedRoles}.</p>
      {postings.probableDuplicatePairs ? (
        <p>
          {postings.probableDuplicatePairs} possible duplicate {postings.probableDuplicatePairs === 1 ? "pair is" : "pairs are"} unresolved among these roles and
          counted separately. <Link href={`/?company=${encodeURIComponent(detail.company.key)}`}>Review them on the dashboard</Link>.
        </p>
      ) : null}
      <h3>Observed listing duration</h3>
      <p>
        Per listing, from when that listing was first seen to its own confirmed removal (listings from sources that can confirm removal):{" "}
        {timingText(duration.confirmed, "No confirmed removals")}. This is how long a listing was observed, not how long hiring took.
      </p>
      {duration.stillListed.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Listings still listed</caption>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Source</th>
                <th scope="col">Listed for at least</th>
              </tr>
            </thead>
            <tbody>
              {duration.stillListed.map((row) => (
                <tr key={`${row.opportunityId}-${row.sourceName}`}>
                  <th scope="row">
                    <Link href={`/opportunities/${row.opportunityId}`}>{row.title ?? "Untitled opportunity"}</Link>
                  </th>
                  <td>{row.sourceName}</td>
                  <td>{row.atLeastDays} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="market-disclosure">{detail.notes.postings}</p>
    </section>
  );
}

export function CompanyRecurring({ detail }: { detail: CompanyDetail }) {
  const groups = detail.recurring.groups;
  return (
    <section aria-labelledby="recurring" className="market-section">
      <h2 id="recurring">Recurring roles</h2>
      <p>
        A recurring role group is two or more distinct roles in the same title group. It is not a repost: listings shown again after removal are under
        posting-history signals. Recurring role groups: {detail.recurring.recurringGroups}.
      </p>
      {groups.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Roles by title group</caption>
            <thead>
              <tr>
                <th scope="col">Title group</th>
                <th scope="col">Roles</th>
                <th scope="col">First observed</th>
                <th scope="col">Last observed</th>
                <th scope="col">Currently listed</th>
                <th scope="col">No longer listed</th>
                <th scope="col">Applied</th>
                <th scope="col">Exact titles</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <th scope="row">
                    {titleGroupLabel(group.key)}
                    {group.recurring ? <span className="muted"> · recurring</span> : null}
                  </th>
                  <td>{group.roles}</td>
                  <td>{day(group.firstSeenAt)}</td>
                  <td>{day(group.lastSeenAt)}</td>
                  <td>{group.currentlyListed}</td>
                  <td>{group.noLongerListed}</td>
                  <td>{group.applied}</td>
                  <td>{group.titles.map((title) => `${title.title} (${title.count})`).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No roles observed in this window.</p>
      )}
      <p className="muted">Exact titles ignore case and spacing only; similar wording is not merged.</p>
    </section>
  );
}

export function CompanyArrangement({ detail }: { detail: CompanyDetail }) {
  const arrangement = detail.arrangement;
  const availabilityRows = (caption: string, counts: CompanyDetail["arrangement"]["visaSponsorship"]) => (
    <tr>
      <th scope="row">{caption}</th>
      <td>{counts.AVAILABLE}</td>
      <td>{counts.NOT_AVAILABLE}</td>
      <td>{counts.UNKNOWN}</td>
    </tr>
  );
  return (
    <section aria-labelledby="arrangement" className="market-section">
      <h2 id="arrangement">Work arrangement and hiring regions</h2>
      <p>
        {arrangement.arrangementKnown
          ? `${arrangement.remote} of ${arrangement.arrangementKnown} observed ${arrangement.arrangementKnown === 1 ? "role that states" : "roles that state"} an arrangement ${arrangement.remote === 1 ? "was" : "were"} Remote.`
          : "No observed role states its work arrangement."}{" "}
        Work arrangement and hiring eligibility are separate facts.
      </p>
      <DistributionTable caption="Work arrangement" distribution={arrangement.arrangement} label={fromTable(arrangementLabels)} />
      <h3>Hiring-eligibility regions</h3>
      <DistributionTable caption="Hiring-eligibility regions (stated residency)" distribution={arrangement.hiringRegions} label={fromTable(geographyLabels)} />
      <h3>Job-location regions</h3>
      <DistributionTable caption="Job-location regions" distribution={arrangement.jobRegions} label={fromTable(geographyLabels)} />
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>Sponsorship and relocation stated</caption>
          <thead>
            <tr>
              <th scope="col">Stated</th>
              <th scope="col">Available</th>
              <th scope="col">Not available</th>
              <th scope="col">Not stated</th>
            </tr>
          </thead>
          <tbody>
            {availabilityRows("Visa sponsorship", arrangement.visaSponsorship)}
            {availabilityRows("Relocation support", arrangement.relocationSupport)}
          </tbody>
        </table>
      </div>
      <p>
        Employer-of-record regions stated:{" "}
        {arrangement.employerOfRecordRegions.length ? arrangement.employerOfRecordRegions.map((row) => `${row.code} (${row.roles})`).join(", ") : "none"}.
      </p>
    </section>
  );
}

export function CompanyHistory({ detail }: { detail: CompanyDetail }) {
  const history = detail.history;
  const steps = [
    { label: "Applied", count: history.applications },
    { label: "Recruiter screen", count: history.recruiterScreens },
    { label: "Any interview stage (recruiter screens included)", count: history.interviews },
    { label: "Final round", count: history.finalRounds },
    { label: "Offer", count: history.offers },
  ];
  return (
    <section aria-labelledby="history" className="market-section">
      <h2 id="history">Your history with this company</h2>
      {history.applications ? (
        <>
          <p>
            {history.applications} {history.applications === 1 ? "application" : "applications"} dated {companyWindowPhrase(detail.window)}: first{" "}
            {day(history.firstAppliedAt)}, most recent {day(history.lastAppliedAt)}. An application under 30 days old without a response is awaiting
            response, never counted as no response.
          </p>
          <Bars label="Your applications to this company" rows={steps} />
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Your applications to this company</caption>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.label}>
                    <th scope="row">{step.label}</th>
                    <td>{step.count}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Awaiting response</th>
                  <td>{history.awaitingResponse}</td>
                </tr>
                <tr>
                  <th scope="row">In process</th>
                  <td>{history.inProcess}</td>
                </tr>
                <tr>
                  <th scope="row">30 days or more, nothing recorded yet</th>
                  <td>{history.matureNothingRecorded}</td>
                </tr>
                {Object.entries(history.closed).map(([key, count]) => (
                  <tr key={key}>
                    <th scope="row">{companyClosedLabels[key] ?? key}</th>
                    <td>{count}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Interview rate (of mature applications)</th>
                  <td>
                    <RateValue rate={history.interviewRate} none="No mature applications" />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Offer rate (of resolved applications)</th>
                  <td>
                    <RateValue rate={history.offerRate} none="None resolved yet" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3>Application-process timing</h3>
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Days from your application</caption>
              <tbody>
                <tr>
                  <th scope="row">To first progress recorded in your tracker</th>
                  <td>{timingText(history.timings.progress)}</td>
                </tr>
                <tr>
                  <th scope="row">To first interview date</th>
                  <td>{timingText(history.timings.interview)}</td>
                </tr>
                <tr>
                  <th scope="row">To closed</th>
                  <td>{timingText(history.timings.closed)}</td>
                </tr>
                <tr>
                  <th scope="row">To offer</th>
                  <td>{timingText(history.timings.offer)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">{detail.notes.progress} Whole days; below 5 applications the individual values are shown instead of a median.</p>
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Your applications</caption>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.roles.map((row) => (
                  <tr key={row.opportunityId}>
                    <th scope="row">
                      <Link href={`/opportunities/${row.opportunityId}`}>{row.title ?? "Untitled opportunity"}</Link>
                    </th>
                    <td>{day(row.appliedAt)}</td>
                    <td>{row.stage ? applicationStageLabels[row.stage] ?? row.stage : "—"}</td>
                    <td>{row.outcome ? companyClosedLabels[row.outcome] ?? row.outcome : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No applications to this company in this window.</p>
      )}
      <p className="market-disclosure">{detail.notes.outcomes}</p>
    </section>
  );
}

export function CompanySignals({ detail }: { detail: CompanyDetail }) {
  const signals = detail.signals;
  const roles = detail.overview.observedRoles;
  return (
    <section aria-labelledby="signals" className="market-section">
      <h2 id="signals">Posting-history signals</h2>
      <p>
        Facts from the listing history (feature 13). Only roles listed on a source that can confirm removal can show a listing again after removal:{" "}
        {signals.removalTracked} of {roles}.
      </p>
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>Posting-history signals</caption>
          <tbody>
            <tr>
              <th scope="row">Listed again after confirmed removal</th>
              <td>
                {signals.listedAgain} of {roles} observed {roles === 1 ? "role" : "roles"} ({signals.reappearances} {signals.reappearances === 1 ? "time" : "times"} in total)
              </td>
            </tr>
            <tr>
              <th scope="row">Relisted under a new listing ID — same requisition</th>
              <td>
                {signals.requisitionRelisted} of {roles}
              </td>
            </tr>
            <tr>
              <th scope="row">No longer on the employer’s board but seen elsewhere</th>
              <td>
                {signals.closedElsewhere} of {roles}
              </td>
            </tr>
            <tr>
              <th scope="row">Content unchanged for 30 days or more</th>
              <td>
                {signals.unchanged} of {roles}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {signals.relistings.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Listings shown again after removal</caption>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Source</th>
                <th scope="col">Confirmed removed</th>
                <th scope="col">Listed again</th>
                <th scope="col">Days between</th>
                <th scope="col">Times</th>
              </tr>
            </thead>
            <tbody>
              {signals.relistings.map((row) => (
                <tr key={`${row.opportunityId}-${row.sourceName}-${row.reappearedAt}`}>
                  <th scope="row">
                    <Link href={`/opportunities/${row.opportunityId}`}>{row.title ?? "Untitled opportunity"}</Link>
                  </th>
                  <td>{row.sourceName}</td>
                  <td>{day(row.removedAt)}</td>
                  <td>{day(row.reappearedAt)}</td>
                  <td>{row.days ?? "—"}</td>
                  <td>{row.reappearances}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted">
        These are observed listing facts. An older or relisted posting is not evidence that a job is not real, and no company is labelled from them.
      </p>
    </section>
  );
}

export function CompanyRoles({ detail }: { detail: CompanyDetail }) {
  if (!detail.roles.length) return null;
  return (
    <section aria-labelledby="roles" className="market-section">
      <h2 id="roles">Observed roles</h2>
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>Observed roles at this company</caption>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">First observed</th>
              <th scope="col">Listing status</th>
              <th scope="col">Arrangement</th>
              <th scope="col">Found first by</th>
              <th scope="col">Posted (as stated)</th>
              <th scope="col">Salary (as stated)</th>
              <th scope="col">Applied</th>
            </tr>
          </thead>
          <tbody>
            {detail.roles.map((row) => (
              <tr key={row.opportunityId}>
                <th scope="row">
                  <Link href={`/opportunities/${row.opportunityId}`}>{row.title ?? "Untitled opportunity"}</Link>
                </th>
                <td>{day(row.firstSeenAt)}</td>
                <td>{listingStateLabels[row.state]}</td>
                <td>{arrangementLabels[row.arrangement] ?? row.arrangement}</td>
                <td>{row.foundFirstBy ?? "—"}</td>
                <td>{day(row.postingDate)}</td>
                <td>{row.salaryText ?? "—"}</td>
                <td>{row.applied ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CompanyDetailView({ detail }: { detail: CompanyDetail }) {
  return (
    <>
      <nav className="sources-section-nav" aria-label="Company sections">
        {companySections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.label}
          </a>
        ))}
      </nav>
      <CompanyOverview detail={detail} />
      <CompanyPostings detail={detail} />
      <CompanyRecurring detail={detail} />
      <CompanyArrangement detail={detail} />
      <CompanyHistory detail={detail} />
      <CompanySignals detail={detail} />
      <CompanyRoles detail={detail} />
    </>
  );
}

export { companyHref };
