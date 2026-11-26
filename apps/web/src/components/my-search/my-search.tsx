import Link from "next/link";
import {
  arrangementKeys,
  personalWindowKeys,
  recommendationAtApplicationStates,
  seniorityKeys,
  type PaOutcomeRow,
  type PaRoleRow,
  type PaSourceRow,
  type PersonalAnalytics,
  type SiRate,
} from "@ai-career/core";
import { Bars, RateValue } from "../sources/source-insights";
import { arrangementLabels, labelFrom, requirementCategoryLabels, roleClassificationLabels, segmentLabels, seniorityLabels, titleGroupLabel } from "../market/market-labels";
import {
  alexFitLabels,
  closedOutcomeLabels,
  customerTypeLabels,
  decisionImpactLabels,
  dimensionLabels,
  personalWindowDescription,
  personalWindowLabels,
  recommendationAtApplicationLabels,
  resumeMatchBandLabels,
} from "./my-search-labels";

// Personal Job-Search Analytics views (feature 17). Server-rendered and
// read-only. Evaluator opinion and actual outcomes are shown as separate
// signals; no composite score, no accuracy measure, no good/bad colouring.

type Label = (key: string) => string;

export const mySearchSections = [
  { id: "overview", label: "Overview" },
  { id: "funnel", label: "Application funnel" },
  { id: "roles", label: "Roles" },
  { id: "gaps", label: "Recurring Genuine Gaps" },
  { id: "sources", label: "Sources" },
  { id: "not-progressing", label: "Where applications are not progressing" },
  { id: "company-type", label: "Company type" },
] as const;

export type RoleSort = "title" | "fit" | "apply" | "interview";
export const roleSortLabels: Record<RoleSort, string> = {
  title: "Title group",
  fit: "Highest evaluator fit",
  apply: "Most APPLY recommendations",
  interview: "Highest interview conversion",
};
export const parseRoleSort = (value: string | null | undefined): RoleSort =>
  value === "fit" || value === "apply" || value === "interview" ? value : "title";

export function MySearchSectionNav() {
  return (
    <nav className="sources-section-nav" aria-label="My search sections">
      {mySearchSections.map((section) => (
        <a key={section.id} href={`#${section.id}`}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Controls

export function MySearchControls({ personal, roleSort }: { personal: PersonalAnalytics; roleSort: RoleSort }) {
  const filters = personal.filters;
  const window = personal.window;
  const customEnd = window.key === "custom" ? new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
  const sources = [...personal.sources.automated, ...personal.sources.userCollected];
  const select = (name: string, label: string, value: string | null, options: Array<[string, string]>, any: string | null = "Any") => (
    <label>
      {label}
      <select name={name} defaultValue={value ?? ""}>
        {any !== null ? <option value="">{any}</option> : null}
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form className="insights-controls" method="get" action="/my-search" aria-label="My search options">
      {select("window", "Window", window.key, personalWindowKeys.map((key) => [key, personalWindowLabels[key]]), null)}
      <label>
        From (custom)
        <input type="date" name="from" defaultValue={window.key === "custom" ? window.from?.slice(0, 10) ?? "" : ""} />
      </label>
      <label>
        To (custom)
        <input type="date" name="to" defaultValue={customEnd} />
      </label>
      {select("titleGroup", "Title group", filters.titleGroup, personal.titleGroups.map((key) => [key, titleGroupLabel(key)]))}
      {select("recommendation", "Recommendation at application", filters.recommendation, recommendationAtApplicationStates.map((key) => [key, recommendationAtApplicationLabels[key]]))}
      {select("arrangement", "Work arrangement", filters.arrangement, arrangementKeys.map((key) => [key, arrangementLabels[key]!]))}
      {select("seniority", "Seniority", filters.seniority, seniorityKeys.map((key) => [key, seniorityLabels[key]!]))}
      {select("source", "Found first by", filters.source, sources.map((row) => [row.key, row.name]))}
      {select(
        "profile",
        "Profile version (fit and gaps)",
        filters.profile,
        [
          ["active", "Active profile"],
          ...personal.profile.options.map((option): [string, string] => [option.id, `${option.label} v${option.version}${option.active ? " (active)" : ""}`]),
          ["none", "Profile not recorded"],
        ],
        null,
      )}
      {select("roleSort", "Order roles by", roleSort, Object.entries(roleSortLabels), null)}
      <button type="submit" className="secondary-button">
        Show
      </button>
      <p className="muted">
        Recommendation at application applies to application figures only; profile version applies to fit and gap figures only; the other filters apply to
        every section.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Building blocks

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OutcomeTable({ caption, rows, label, empty = "No applications in this window." }: { caption: string; rows: PaOutcomeRow[]; label: Label; empty?: string }) {
  if (!rows.length) return <p>{empty}</p>;
  return (
    <div className="table-scroll">
      <table className="capacity-table insights-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Applied</th>
            <th scope="col">Mature</th>
            <th scope="col">Awaiting response</th>
            <th scope="col">In process</th>
            <th scope="col">Interview rate</th>
            <th scope="col">Offer rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{label(row.key)}</th>
              <td>{row.applied}</td>
              <td>{row.mature}</td>
              <td>{row.awaitingResponse}</td>
              <td>{row.inProcess}</td>
              <td>
                <RateValue rate={row.interviewRate} none="No mature applications" />
              </td>
              <td>
                <RateValue rate={row.offerRate} none="None resolved yet" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Ranks only groups whose measure meets the sample threshold; the rest follow
// in title order, unranked.
function sortRoles(rows: PaRoleRow[], sort: RoleSort, titleOrder: string[]): { ranked: PaRoleRow[]; unranked: PaRoleRow[] } {
  const byTitle = (a: PaRoleRow, b: PaRoleRow) => titleOrder.indexOf(a.key) - titleOrder.indexOf(b.key);
  if (sort === "title") return { ranked: [...rows].sort(byTitle), unranked: [] };
  const measure: Record<Exclude<RoleSort, "title">, (row: PaRoleRow) => SiRate> = {
    fit: (row) => row.resumeMatchGoodOrBetter,
    apply: (row) => row.apply,
    interview: (row) => row.outcomes.interviewRate,
  };
  const rankable = (row: PaRoleRow) => row.rankable[sort];
  return {
    ranked: rows.filter(rankable).sort((a, b) => (measure[sort](b).value ?? 0) - (measure[sort](a).value ?? 0) || byTitle(a, b)),
    unranked: rows.filter((row) => !rankable(row)).sort(byTitle),
  };
}

// ---------------------------------------------------------------------------
// Sections

export function MySearchOverview({ personal }: { personal: PersonalAnalytics }) {
  const overview = personal.overview;
  return (
    <section aria-labelledby="overview" className="market-section">
      <h2 id="overview">Overview</h2>
      <p>
        Applications dated in {personalWindowDescription(personal.window).toLowerCase()}, with their later interviews and offers; evaluations completed in
        the same window. An application under 30 days old without a response is awaiting response, never counted as a failure; one still interviewing is in
        process and not counted against offers.
      </p>
      <dl className="usage-totals-grid insights-tiles">
        <Tile label="Applied">{overview.applied}</Tile>
        <Tile label="Awaiting response">{overview.awaitingResponse}</Tile>
        <Tile label="In process">{overview.inProcess}</Tile>
        <Tile label="Interview rate (of mature applications)">
          <RateValue rate={overview.interviewRate} none="No mature applications" />
        </Tile>
        <Tile label="Offer rate (of resolved applications)">
          <RateValue rate={overview.offerRate} none="None resolved yet" />
        </Tile>
        <Tile label="Interview to offer (concluded interviews)">
          <RateValue rate={overview.interviewToOffer} none="No concluded interviews" />
        </Tile>
        <Tile label="Evaluated">{overview.evaluated}</Tile>
        <Tile label="Applications with a recommendation at application">
          <RateValue rate={overview.applicationsWithRecommendation} none="No applications" />
        </Tile>
      </dl>
      <p className="market-disclosure">{personal.notes.outcomes}</p>
      <p className="muted">{personal.notes.versions}</p>
    </section>
  );
}

export function MySearchFunnel({ personal }: { personal: PersonalAnalytics }) {
  const all = personal.funnels.applications;
  const evaluated = personal.funnels.evaluated;
  const steps = [
    { label: "Applied", count: all.applied },
    { label: "Any interview stage (recruiter screens included)", count: all.anyInterview },
    { label: "Recruiter screen", count: all.recruiterScreen },
    { label: "Interview beyond screening", count: all.beyondScreening },
    { label: "Final round", count: all.finalRound },
    { label: "Offer", count: all.offers },
  ];
  return (
    <section aria-labelledby="funnel" className="market-section">
      <h2 id="funnel">Application funnel</h2>
      <h3>All applications</h3>
      <p>Every application, whether or not it was evaluated. Each application counts once at each step it reached.</p>
      <Bars label="All applications" rows={steps} />
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>All applications</caption>
          <tbody>
            {steps.map((step) => (
              <tr key={step.label}>
                <th scope="row">{step.label}</th>
                <td>{step.count}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Awaiting response</th>
              <td>{all.awaitingResponse}</td>
            </tr>
            <tr>
              <th scope="row">In process</th>
              <td>{all.inProcess}</td>
            </tr>
            {Object.entries(all.closed).map(([key, count]) => (
              <tr key={key}>
                <th scope="row">{closedOutcomeLabels[key] ?? key}</th>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Evaluated opportunities</h3>
      <p>Opportunities whose latest evaluation completed in this window, by that evaluation’s recommendation, and what happened next.</p>
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>Evaluated opportunities by recommendation</caption>
          <thead>
            <tr>
              <th scope="col">Recommendation</th>
              <th scope="col">Evaluated</th>
              <th scope="col">Applied</th>
              <th scope="col">Interview</th>
              <th scope="col">Offer</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(evaluated.decisions).map(([key, row]) => (
              <tr key={key}>
                <th scope="row">{key === "NONE" ? "No recommendation" : recommendationAtApplicationLabels[key as "APPLY"]}</th>
                <td>{row.evaluated}</td>
                <td>{row.applied}</td>
                <td>{row.interviews}</td>
                <td>{row.offers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Recommended but not applied: {evaluated.recommendedNotApplied} (Apply recommendations without an application; shown for information only).</p>
      <h3>Applications by recommendation at application</h3>
      <p className="muted">
        The recommendation you had when you applied: an evaluation completed before the application. When the application has only a date and an
        evaluation completed the same day, the order is unknown and no recommendation is assumed.
      </p>
      <OutcomeTable caption="Applications by recommendation at application" rows={personal.funnels.byRecommendationAtApplication} label={(key) => recommendationAtApplicationLabels[key as "APPLY"] ?? key} />
    </section>
  );
}

export function MySearchRoles({ personal, roleSort }: { personal: PersonalAnalytics; roleSort: RoleSort }) {
  const { ranked, unranked } = sortRoles(personal.roles.rows, roleSort, personal.titleGroups);
  const rows = [...ranked, ...unranked];
  const profile = personal.profile.selected;
  return (
    <section aria-labelledby="roles" className="market-section">
      <h2 id="roles">Roles</h2>
      <p>
        What the evaluator said and what actually happened are different signals, shown side by side. Evaluator fit uses the{" "}
        {profile.notRecorded ? "evaluations without a recorded profile" : profile.label ? `${profile.label} v${profile.version} profile` : "selected profile (none is active)"}.
        {roleSort !== "title" ? ` Ordered by ${roleSortLabels[roleSort].toLowerCase()}; only groups with at least 5 are ranked.` : ""}
      </p>
      {rows.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Roles by evaluator fit and by outcomes</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Title group
                </th>
                <th scope="colgroup" colSpan={4}>
                  What the evaluator said
                </th>
                <th scope="colgroup" colSpan={3}>
                  What actually happened
                </th>
              </tr>
              <tr>
                <th scope="col">Evaluated</th>
                <th scope="col">Apply rate</th>
                <th scope="col">Resume Match good or better</th>
                <th scope="col">Alex Fit strong or good</th>
                <th scope="col">Applied</th>
                <th scope="col">Interview rate</th>
                <th scope="col">Offers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {titleGroupLabel(row.key)}
                    {roleSort !== "title" && unranked.includes(row) ? <span className="sample-label"> · not ranked</span> : null}
                  </th>
                  <td>{row.evaluated}</td>
                  <td>
                    <RateValue rate={row.apply} none="—" />
                  </td>
                  <td>
                    <RateValue rate={row.resumeMatchGoodOrBetter} none="—" />
                  </td>
                  <td>
                    <RateValue rate={row.alexFitStrongOrGood} none="—" />
                  </td>
                  <td>{row.outcomes.applied}</td>
                  <td>
                    <RateValue rate={row.outcomes.interviewRate} none="—" />
                  </td>
                  <td>{row.outcomes.offers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No evaluations or applications in this window.</p>
      )}
      <h3>Outcomes by title group</h3>
      <OutcomeTable caption="Outcomes by title group" rows={personal.outcomesBy.titleGroup} label={titleGroupLabel} />
      <div className="distribution-grid">
        <div>
          <h3>Outcomes by work arrangement</h3>
          <OutcomeTable caption="Outcomes by work arrangement" rows={personal.outcomesBy.arrangement} label={labelFrom(arrangementLabels)} />
        </div>
        <div>
          <h3>Outcomes by seniority</h3>
          <OutcomeTable caption="Outcomes by seniority" rows={personal.outcomesBy.seniority} label={labelFrom(seniorityLabels)} />
        </div>
      </div>
      <h3>Outcomes by evaluator role classification (evaluated applications)</h3>
      <OutcomeTable caption="Outcomes by evaluator role classification" rows={personal.roles.byRoleClassification} label={labelFrom(roleClassificationLabels)} empty="No evaluated applications in this window." />
      <h3>Outcomes by the fit you were shown</h3>
      <p>
        {personal.fitOutcomes.credited} of {personal.fitOutcomes.applied} applications had a Resume Match in the selected profile and compatible version at
        application. {personal.notes.outcomes}
      </p>
      <div className="distribution-grid">
        <div>
          <OutcomeTable caption="Outcomes by Resume Match band at application" rows={personal.fitOutcomes.resumeMatchBand} label={labelFrom(resumeMatchBandLabels)} empty="No applications with a Resume Match at application." />
        </div>
        <div>
          <OutcomeTable caption="Outcomes by Alex Fit at application" rows={personal.fitOutcomes.alexFit} label={labelFrom(alexFitLabels)} empty="No applications with an Alex Fit at application." />
        </div>
      </div>
    </section>
  );
}

export function MySearchGaps({ personal }: { personal: PersonalAnalytics }) {
  const gaps = personal.gaps;
  const profile = personal.profile.selected;
  const profileText = profile.notRecorded ? "evaluations without a recorded profile" : profile.label ? `the ${profile.label} v${profile.version} profile${profile.active ? " (active)" : ""}` : "no profile (none is active)";
  return (
    <section aria-labelledby="gaps" className="market-section">
      <h2 id="gaps">Recurring Genuine Gaps</h2>
      <p>
        Requirements the evaluator found you do not meet, for {gaps.evaluated} evaluated {gaps.evaluated === 1 ? "opportunity" : "opportunities"} under{" "}
        {profileText}; {gaps.otherwiseGood} of them were recommended Apply or Review (otherwise worth pursuing). Gaps belong to the profile they were
        evaluated against: a gap under an earlier profile may no longer apply. {personal.notes.gaps}
      </p>
      {gaps.versions.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Evaluations by Resume Match version</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Evaluated</th>
                <th scope="col">In the figures below</th>
              </tr>
            </thead>
            <tbody>
              {gaps.versions.map((row) => (
                <tr key={row.version ?? "unrecorded"}>
                  <th scope="row">{row.version ?? "Version not recorded"}</th>
                  <td>{row.evaluated}</td>
                  <td>{row.included ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {gaps.reason ? <p className="muted">{gaps.reason}</p> : null}
      {gaps.categories.length ? (
        <>
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Genuine Gaps by requirement category</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Evaluated opportunities</th>
                  <th scope="col">Among Apply or Review</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Interviewed</th>
                  <th scope="col">Required / preferred / other</th>
                  <th scope="col">Decision impact</th>
                </tr>
              </thead>
              <tbody>
                {gaps.categories.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{requirementCategoryLabels[row.category] ?? row.category}</th>
                    <td>
                      <RateValue rate={row.share} />
                    </td>
                    <td>
                      <RateValue rate={row.otherwiseGoodShare} none="—" />
                    </td>
                    <td>{row.applied}</td>
                    <td>{row.interviewed}</td>
                    <td>
                      {row.strength.required} / {row.strength.preferred} / {row.strength.other}
                    </td>
                    <td>
                      {Object.entries(row.decisionImpact)
                        .map(([key, count]) => `${decisionImpactLabels[key] ?? key} ${count}`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Most repeated gap requirements, as written</caption>
              <thead>
                <tr>
                  <th scope="col">Requirement</th>
                  <th scope="col">Category</th>
                  <th scope="col">Opportunities</th>
                  <th scope="col">Among Apply or Review</th>
                </tr>
              </thead>
              <tbody>
                {gaps.phrases.map((row) => (
                  <tr key={`${row.category}-${row.requirement}`}>
                    <th scope="row">{row.requirement}</th>
                    <td>{requirementCategoryLabels[row.category] ?? row.category}</td>
                    <td>{row.opportunities}</td>
                    <td>{row.otherwiseGood}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No Genuine Gaps recorded for this profile and window.</p>
      )}
    </section>
  );
}

function SourceTable({ caption, rows }: { caption: string; rows: PaSourceRow[] }) {
  if (!rows.length) return null;
  return <OutcomeTable caption={caption} rows={rows} label={(key) => rows.find((row) => row.key === key)?.name ?? key} />;
}

export function MySearchSources({ personal }: { personal: PersonalAnalytics }) {
  const sources = personal.sources;
  const any = sources.automated.length + sources.userCollected.length + (sources.unknown ? 1 : 0);
  return (
    <section aria-labelledby="sources" className="market-section">
      <h2 id="sources">Sources</h2>
      <p>
        Your applications and their outcomes by the source that found each job first (the same credit rule as Source insights). Jobs you collected
        yourself are shown separately and are not compared with automated sources. For each source’s full evidence — volume, duplicates, reliability and
        cost — see <Link href="/sources/insights">Source insights</Link>.
      </p>
      {any ? (
        <>
          <SourceTable caption="Automated sources" rows={sources.automated} />
          <SourceTable caption="Collected by you" rows={sources.userCollected} />
          {sources.unknown ? <SourceTable caption="No source record" rows={[sources.unknown]} /> : null}
        </>
      ) : (
        <p>No applications in this window.</p>
      )}
    </section>
  );
}

export function MySearchNotProgressing({ personal }: { personal: PersonalAnalytics }) {
  const groups = personal.notProgressing.groups;
  return (
    <section aria-labelledby="not-progressing" className="market-section">
      <h2 id="not-progressing">Where applications are not progressing</h2>
      <p>
        Groups with at least 5 mature applications and no interview yet. This describes what has happened so far; it does not judge any single application,
        and applications awaiting a response are not counted.
      </p>
      {groups.length ? (
        <ul className="insight-notes">
          {groups.map((row) => (
            <li key={`${row.dimension}-${row.key}`}>
              {dimensionLabels[row.dimension] ?? row.dimension}: {groupLabel(row.dimension, row.label)} — {row.mature} mature applications, no interviews yet
            </li>
          ))}
        </ul>
      ) : (
        <p>No group has 5 or more mature applications without an interview.</p>
      )}
      <p className="muted">Recommended but not applied: {personal.notProgressing.recommendedNotApplied} Apply recommendations without an application (for information only).</p>
    </section>
  );
}

function groupLabel(dimension: string, key: string): string {
  if (dimension === "titleGroup") return titleGroupLabel(key);
  if (dimension === "arrangement") return arrangementLabels[key] ?? key;
  if (dimension === "seniority") return seniorityLabels[key] ?? key;
  if (dimension === "customerSegment") return segmentLabels[key] ?? key;
  return key;
}

export function MySearchCompanyType({ personal }: { personal: PersonalAnalytics }) {
  const company = personal.companyType;
  return (
    <section aria-labelledby="company-type" className="market-section">
      <h2 id="company-type">Company type</h2>
      <p>
        Outcomes by the customer segment and customer type the evaluator identified, for the {company.evaluatedApplied} evaluated applications only. No
        individual company is ranked; company history belongs to company intelligence.
      </p>
      <div className="distribution-grid">
        <div>
          <OutcomeTable caption="Outcomes by customer segment (evaluated applications)" rows={company.segment} label={labelFrom(segmentLabels)} empty="No evaluated applications in this window." />
        </div>
        <div>
          <OutcomeTable caption="Outcomes by customer type (evaluated applications)" rows={company.customerType} label={labelFrom(customerTypeLabels)} empty="No evaluated applications in this window." />
        </div>
      </div>
    </section>
  );
}

export function MySearchView({ personal, roleSort }: { personal: PersonalAnalytics; roleSort: RoleSort }) {
  return (
    <>
      <MySearchSectionNav />
      <MySearchOverview personal={personal} />
      <MySearchFunnel personal={personal} />
      <MySearchRoles personal={personal} roleSort={roleSort} />
      <MySearchGaps personal={personal} />
      <MySearchSources personal={personal} />
      <MySearchNotProgressing personal={personal} />
      <MySearchCompanyType personal={personal} />
      <p className="muted">Every rate shows its counts; under 5 is labelled an insufficient sample and is never ranked, and 5 to 19 is a small sample.</p>
    </>
  );
}
