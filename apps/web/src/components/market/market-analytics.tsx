import Link from "next/link";
import {
  arrangementKeys,
  geographyBuckets,
  marketEvaluationStates,
  seniorityKeys,
  type MarketAnalytics,
  type MarketDistribution,
  type MarketRecommendationRow,
  type MarketTrend,
  type SalaryBreakdownRow,
  type SalaryStats,
  type SiRate,
  type SiWindowKey,
} from "@ai-career/core";
import { Bars, RateValue } from "../sources/source-insights";
import { formatRate, windowLabels } from "../sources/insight-labels";
import {
  arrangementLabels,
  availabilityLabels,
  basisLabels,
  collectionLabels,
  formatAmount,
  formatMedian,
  labelFrom,
  marketStateLabels,
  marketWindowDescription,
  regionLabel,
  requirementCategoryLabels,
  roleClassificationLabels,
  segmentLabels,
  seniorityLabels,
  titleGroupLabel,
  workAuthorizationLabels,
} from "./market-labels";

// Job-Market Analytics views (feature 16). Server-rendered and read-only.
// Every figure shows its count and sample; nothing is coloured or ranked as
// good or bad; charts are CSS bars beside an equivalent table.

type Label = (key: string) => string;

export const marketSections = [
  { id: "overview", label: "Overview" },
  { id: "salary", label: "Salary" },
  { id: "roles", label: "Roles and titles" },
  { id: "location", label: "Location and work arrangement" },
  { id: "seniority", label: "Seniority" },
  { id: "requirements", label: "Requirements" },
  { id: "segment", label: "Customer segment" },
  { id: "recommendations", label: "Recommendations" },
] as const;

export function MarketSectionNav() {
  return (
    <nav className="sources-section-nav" aria-label="Market sections">
      {marketSections.map((section) => (
        <a key={section.id} href={`#${section.id}`}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Dashboard drill-in: only filters the dashboard already supports.

const optionKey = (value: string) => value.toLowerCase().replace(/_/g, "-");

export function dashboardHref(market: Pick<MarketAnalytics, "window">, filters: Record<string, string | null>): string {
  const params = new URLSearchParams({ view: "all" });
  if (market.window.from) params.set("from", market.window.from.slice(0, 10));
  if (market.window.key === "custom") params.set("to", new Date(new Date(market.window.to).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, key === "title" ? value : optionKey(value));
  }
  return `/?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Controls

export function MarketControls({ market }: { market: MarketAnalytics }) {
  const filters = market.filters;
  // Only stated currencies can be selected; amounts without one are never aggregated.
  const currencies = market.salary.currencies.map((row) => row.currency).filter((code) => code !== "UNKNOWN");
  const window = market.window;
  const customEnd = window.key === "custom" ? new Date(new Date(window.to).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
  const select = (name: string, label: string, value: string | null, options: Array<[string, string]>, any = "Any") => (
    <label>
      {label}
      <select name={name} defaultValue={value ?? ""}>
        {any ? <option value="">{any}</option> : null}
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form className="insights-controls" method="get" action="/market" aria-label="Market options">
      {select("window", "Window", window.key, (Object.keys(windowLabels) as SiWindowKey[]).map((key) => [key, windowLabels[key]]), "")}
      <label>
        From (custom)
        <input type="date" name="from" defaultValue={window.key === "custom" ? window.from?.slice(0, 10) ?? "" : ""} />
      </label>
      <label>
        To (custom)
        <input type="date" name="to" defaultValue={customEnd} />
      </label>
      {select("titleGroup", "Title group", filters.titleGroup, market.titleGroups.map((key) => [key, titleGroupLabel(key)]))}
      {select("seniority", "Seniority", filters.seniority, seniorityKeys.map((key) => [key, seniorityLabels[key]!]))}
      {select("arrangement", "Work arrangement", filters.arrangement, arrangementKeys.map((key) => [key, arrangementLabels[key]!]))}
      {select("region", "Job region", filters.region, geographyBuckets.map((key) => [key, regionLabel(key)]))}
      {select(
        "currency",
        "Salary currency",
        filters.currency,
        [...new Set([...currencies, ...(filters.currency ? [filters.currency] : [])])].map((code) => [code, code]),
        "Most common",
      )}
      {select("collected", "Collected by", filters.collection, Object.entries(collectionLabels), "")}
      <label className="checkbox-label">
        <input type="checkbox" name="excludeRemoved" value="1" defaultChecked={filters.excludeNoLongerListed} /> Exclude no longer listed
      </label>
      <button type="submit" className="secondary-button">
        Show
      </button>
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

function OfKnown({ rate }: { rate: SiRate | null }) {
  return rate ? <RateValue rate={rate} none="—" /> : <span className="muted">—</span>;
}

export function DistributionTable({
  caption,
  distribution,
  label,
  knownLabel = "% of known jobs",
  allLabel = "% of all jobs",
  link,
}: {
  caption: string;
  distribution: MarketDistribution;
  label: Label;
  knownLabel?: string;
  allLabel?: string;
  link?: (key: string) => string | null;
}) {
  if (!distribution.total) return <p>No jobs to measure.</p>;
  return (
    <div className="market-distribution">
      <Bars label={caption} rows={distribution.rows.map((row) => ({ label: label(row.key), count: row.count }))} />
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Jobs</th>
              <th scope="col">{allLabel}</th>
              <th scope="col">{knownLabel}</th>
            </tr>
          </thead>
          <tbody>
            {distribution.rows.map((row) => {
              const href = link?.(row.key) ?? null;
              return (
                <tr key={row.key}>
                  <th scope="row">{href ? <Link href={href}>{label(row.key)}</Link> : label(row.key)}</th>
                  <td>{row.count}</td>
                  <td>
                    <RateValue rate={row.ofAll} />
                  </td>
                  <td>
                    <OfKnown rate={row.ofKnown} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {distribution.multiValued ? <p className="muted">A job can name several regions, so shares can add up to more than 100%.</p> : null}
    </div>
  );
}

export function TrendTable({ caption, trend, label }: { caption: string; trend: MarketTrend; label: Label }) {
  if (!trend.weeks.length) return <p>No weeks in this window.</p>;
  const keys = trend.keys.filter((key) => trend.weeks.some((week) => (week.counts[key] ?? 0) > 0));
  return (
    <div className="table-scroll">
      <table className="capacity-table insights-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">First seen in week of</th>
            <th scope="col">Jobs</th>
            {keys.map((key) => (
              <th scope="col" key={key}>
                {label(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trend.weeks.map((week) => (
            <tr key={week.week}>
              <th scope="row">{week.week}</th>
              <td>{week.total}</td>
              {keys.map((key) => (
                <td key={key}>{week.counts[key] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {trend.truncated ? <p className="muted">Showing the latest 26 weeks.</p> : null}
    </div>
  );
}

// Fewer than 5: listed alphabetically, never ranked.
function ranked<T>(rows: T[], n: number, text: (row: T) => string): { rows: T[]; ranked: boolean } {
  if (n >= 5) return { rows, ranked: true };
  return { rows: [...rows].sort((a, b) => text(a).localeCompare(text(b))), ranked: false };
}

function RecommendationTable({ caption, rows, label }: { caption: string; rows: MarketRecommendationRow[]; label: Label }) {
  if (!rows.length) return null;
  return (
    <div className="table-scroll">
      <table className="capacity-table insights-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Jobs</th>
            <th scope="col">Evaluated (coverage)</th>
            <th scope="col">Apply</th>
            <th scope="col">Review</th>
            <th scope="col">Skip</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{label(row.key)}</th>
              <td>{row.jobs}</td>
              <td>{formatRate(row.coverage, "—")}</td>
              <td>
                <RateValue rate={row.apply} none="No completed evaluations" />
              </td>
              <td>
                <RateValue rate={row.review} none="—" />
              </td>
              <td>
                <RateValue rate={row.skip} none="—" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections

export function MarketNotes({ market }: { market: MarketAnalytics }) {
  return (
    <>
      {market.notes.historical ? <p className="muted">{market.notes.historical}</p> : null}
      {market.notes.selectionBias ? (
        <p className="muted">
          All collected includes jobs you captured with the extension or entered by hand. {market.notes.selectionBias}
        </p>
      ) : null}
    </>
  );
}

export function MarketOverview({ market }: { market: MarketAnalytics }) {
  const { coverage, total } = market.overview;
  return (
    <section aria-labelledby="overview" className="market-section">
      <h2 id="overview">Overview</h2>
      <p>
        {total} {total === 1 ? "job" : "jobs"} first seen in {marketWindowDescription(market.window).toLowerCase()}, {collectionLabels[market.filters.collection].toLowerCase()}
        {market.filters.excludeNoLongerListed ? ", excluding jobs no longer listed" : ", including jobs no longer listed"}. Each job counts once, however
        many sources listed it. Percentages are of all jobs in this cohort.
      </p>
      <dl className="usage-totals-grid insights-tiles">
        <Tile label="Jobs in cohort">{total}</Tile>
        <Tile label="Salary known">
          <RateValue rate={coverage.salaryKnown} />
        </Tile>
        <Tile label="Seniority known">
          <RateValue rate={coverage.seniorityKnown} />
        </Tile>
        <Tile label="Job location known">
          <RateValue rate={coverage.locationKnown} />
        </Tile>
        <Tile label="Work arrangement known">
          <RateValue rate={coverage.arrangementKnown} />
        </Tile>
        <Tile label="Evaluated">
          <RateValue rate={coverage.evaluated} />
        </Tile>
        <Tile label="Requirement data available">
          <RateValue rate={coverage.requirementData} />
        </Tile>
        <Tile label="Unresolved possible duplicates">{coverage.probableDuplicates}</Tile>
      </dl>
      <p className="muted">Possible duplicates are counted once per pair; both jobs stay in every figure until you resolve them.</p>
      {total ? (
        <>
          <Bars label="Jobs first seen per week" rows={market.overview.trend.weeks.map((week) => ({ label: week.week, count: week.total }))} />
          <TrendTable caption="Jobs first seen per week" trend={market.overview.trend} label={(key) => key} />
        </>
      ) : (
        <p>No jobs in this window.</p>
      )}
    </section>
  );
}

function SalaryBreakdown({ caption, rows, label, currency }: { caption: string; rows: SalaryBreakdownRow[]; label: Label; currency: string }) {
  if (!rows.length) return null;
  return (
    <div className="table-scroll">
      <table className="capacity-table insights-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Median midpoint</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{label(row.key)}</th>
              <td>{formatMedian(row.medianMidpoint, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalaryBasis({ stats }: { stats: SalaryStats }) {
  const currency = stats.currency;
  const name = `${currency === "UNKNOWN" ? "Currency not stated" : currency}, ${basisLabels[stats.basis]!.toLowerCase()}`;
  return (
    <div className="market-salary-basis">
      <h3>{name}</h3>
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>{`Salary statistics, ${name}`}</caption>
          <tbody>
            <tr>
              <th scope="row">Jobs with a single range</th>
              <td>
                {stats.jobs} ({stats.range} range, {stats.exact} exact, {stats.minOnly} minimum only, {stats.maxOnly} maximum only)
              </td>
            </tr>
            <tr>
              <th scope="row">Median minimum</th>
              <td>{formatMedian(stats.medianMinimum, currency)}</td>
            </tr>
            <tr>
              <th scope="row">Median maximum</th>
              <td>{formatMedian(stats.medianMaximum, currency)}</td>
            </tr>
            <tr>
              <th scope="row">Median midpoint (both bounds stated)</th>
              <td>{formatMedian(stats.medianMidpoint, currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {stats.bands.length ? (
        <>
          <Bars label={`Midpoints in 10,000 bands, ${name}`} rows={stats.bands.map((band) => ({ label: `${formatAmount(band.from, currency)}–${formatAmount(band.to, currency)}`, count: band.count }))} />
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>{`Midpoints in 10,000 bands, ${name}`}</caption>
              <thead>
                <tr>
                  <th scope="col">Midpoint band</th>
                  <th scope="col">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {stats.bands.map((band) => (
                  <tr key={band.from}>
                    <th scope="row">{`${formatAmount(band.from, currency)} to under ${formatAmount(band.to, currency)}`}</th>
                    <td>{band.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <div className="distribution-grid">
        <SalaryBreakdown caption={`By title group, ${name}`} rows={stats.breakdowns.titleGroup} label={titleGroupLabel} currency={currency} />
        <SalaryBreakdown caption={`By seniority, ${name}`} rows={stats.breakdowns.seniority} label={labelFrom(seniorityLabels)} currency={currency} />
        <SalaryBreakdown caption={`By work arrangement, ${name}`} rows={stats.breakdowns.arrangement} label={labelFrom(arrangementLabels)} currency={currency} />
        <SalaryBreakdown caption={`By job region, ${name}`} rows={stats.breakdowns.jobRegion} label={regionLabel} currency={currency} />
      </div>
    </div>
  );
}

export function MarketSalary({ market }: { market: MarketAnalytics }) {
  const salary = market.salary;
  return (
    <section aria-labelledby="salary" className="market-section">
      <h2 id="salary">Salary</h2>
      <p>
        Salary known for <RateValue rate={salary.known} /> of all jobs ({salary.singleRange} with a single range, {salary.tiered} with tiered pay,{" "}
        {salary.unknown} unknown). Only annual amounts are read; hourly or monthly pay without an annual figure is unknown. Amounts are compared only
        within one currency and one basis: nothing is converted, and base salary and on-target earnings are never combined.
      </p>
      {salary.currencies.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Jobs stating pay, by currency</caption>
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th scope="col">Single range</th>
                <th scope="col">Tiered</th>
              </tr>
            </thead>
            <tbody>
              {salary.currencies.map((row) => (
                <tr key={row.currency}>
                  <th scope="row">{row.currency === "UNKNOWN" ? "Currency not stated" : row.currency}</th>
                  <td>{row.singleRange}</td>
                  <td>{row.tiered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No salary stated in this cohort.</p>
      )}
      {salary.currencyNotStated ? (
        <p className="muted">
          Currency not stated — {salary.currencyNotStated} {salary.currencyNotStated === 1 ? "job" : "jobs"} with annual salary amounts that cannot be
          included in currency-based market statistics. They count toward salary coverage only.
        </p>
      ) : null}
      {salary.stats.map((stats) => (
        <SalaryBasis key={stats.basis} stats={stats} />
      ))}
      {salary.selectedCurrency && !salary.stats.length ? <p>No single-range salaries in {salary.selectedCurrency}.</p> : null}
      <h3>Tiered pay</h3>
      <p>
        {salary.tiered} {salary.tiered === 1 ? "job states" : "jobs state"} pay in labelled tiers (by place, zone or band). Tiers are listed as stated and never
        enter the medians above; a job with three tiers is still one job.
      </p>
      {salary.tiers.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Tiered pay as stated</caption>
            <thead>
              <tr>
                <th scope="col">Opportunity</th>
                <th scope="col">Tier</th>
                <th scope="col">Minimum</th>
                <th scope="col">Maximum</th>
                <th scope="col">Currency</th>
              </tr>
            </thead>
            <tbody>
              {salary.tiers.map((tier, index) => (
                <tr key={`${tier.opportunityId}-${index}`}>
                  <th scope="row">
                    <Link href={`/opportunities/${tier.opportunityId}`}>{tier.title ?? "Untitled job"}</Link>
                  </th>
                  <td>{tier.label}</td>
                  <td>{formatAmount(tier.minimum, tier.currency)}</td>
                  <td>{formatAmount(tier.maximum, tier.currency)}</td>
                  <td>{tier.currency ?? "Not stated"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {salary.tiersTruncated ? <p className="muted">Showing the first 100 tiers.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function MarketRoles({ market }: { market: MarketAnalytics }) {
  const roles = market.roles;
  const titles = ranked(roles.topTitles, market.overview.total, (row) => row.title);
  return (
    <section aria-labelledby="roles" className="market-section">
      <h2 id="roles">Roles and titles</h2>
      <p>
        Title groups are the Customer Success discovery terms: each title belongs to the longest term it contains. A title containing none is Other title.
        Nothing is inferred or stored.
      </p>
      <DistributionTable
        caption="Title groups"
        distribution={roles.titleGroups}
        label={titleGroupLabel}
        knownLabel="% of jobs matching a term"
        link={(key) => (key === "OTHER" ? null : dashboardHref(market, { title: key }))}
      />
      <h3>Top exact titles</h3>
      {titles.rows.length ? (
        <>
          {!titles.ranked ? <p className="muted">Insufficient sample: listed alphabetically, not ranked.</p> : null}
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Exact titles (case and spacing ignored)</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Jobs</th>
                  <th scope="col">% of all jobs</th>
                </tr>
              </thead>
              <tbody>
                {titles.rows.map((row) => (
                  <tr key={row.title}>
                    <th scope="row">{row.title}</th>
                    <td>{row.count}</td>
                    <td>
                      <RateValue rate={row.share} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No titles in this window.</p>
      )}
      <TrendTable caption="Title groups by first-seen week" trend={roles.trend} label={titleGroupLabel} />
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>Seniority by title group</caption>
          <thead>
            <tr>
              <th scope="col">Title group</th>
              <th scope="col">Jobs</th>
              {seniorityKeys.map((key) => (
                <th scope="col" key={key}>
                  {seniorityLabels[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.seniorityByGroup.map((row) => (
              <tr key={row.key}>
                <th scope="row">{titleGroupLabel(row.key)}</th>
                <td>{row.jobs}</td>
                {seniorityKeys.map((key) => (
                  <td key={key}>{row.counts[key] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Evaluator role classification — evaluated jobs only</h3>
      <p>
        How the evaluator classified the work, for the {roles.roleClassification.evaluated} evaluated {roles.roleClassification.evaluated === 1 ? "job" : "jobs"}{" "}
        (coverage <RateValue rate={roles.roleClassification.coverage} />). This is a separate view and never changes a title group.
      </p>
      <DistributionTable
        caption="Evaluator role classification (evaluated jobs)"
        distribution={roles.roleClassification.distribution}
        label={labelFrom(roleClassificationLabels)}
        allLabel="% of evaluated jobs"
        knownLabel="% of classified jobs"
        link={(key) => (key === "UNKNOWN" ? null : dashboardHref(market, { role: key }))}
      />
    </section>
  );
}

export function MarketLocation({ market }: { market: MarketAnalytics }) {
  const geography = market.geography;
  return (
    <section aria-labelledby="location" className="market-section">
      <h2 id="location">Location and work arrangement</h2>
      <p>
        Where a job is (its location), who may be hired (stated residency), work authorization, sponsorship and relocation are separate facts and are
        shown separately. Unknown means the posting did not say; it is never assumed.
      </p>
      <div className="distribution-grid">
        <div>
          <h3>Job location</h3>
          <DistributionTable caption="Job location region" distribution={geography.jobLocation} label={regionLabel} />
        </div>
        <div>
          <h3>Hiring eligibility</h3>
          <DistributionTable caption="Hiring eligibility (stated residency)" distribution={geography.hiringEligibility} label={regionLabel} />
        </div>
      </div>
      <h3>Work arrangement</h3>
      <DistributionTable
        caption="Work arrangement"
        distribution={geography.arrangement}
        label={labelFrom(arrangementLabels)}
        link={(key) => (key === "SEVERAL" ? null : dashboardHref(market, { arrangement: key }))}
      />
      {geography.severalOptions.length ? (
        <p>
          Several options:{" "}
          {geography.severalOptions.map((row) => `${row.combination.map((key) => arrangementLabels[key] ?? key).join(" or ")} (${row.count})`).join("; ")}
        </p>
      ) : null}
      <TrendTable caption="Work arrangement by first-seen week" trend={geography.arrangementTrend} label={labelFrom(arrangementLabels)} />
      <TrendTable caption="Job region by first-seen week" trend={geography.regionTrend} label={regionLabel} />
      <div className="distribution-grid">
        <div>
          <h3>Work authorization</h3>
          <DistributionTable caption="Work authorization" distribution={geography.workAuthorization} label={labelFrom(workAuthorizationLabels)} />
        </div>
        <div>
          <h3>Visa sponsorship</h3>
          <DistributionTable caption="Visa sponsorship" distribution={geography.sponsorship} label={labelFrom(availabilityLabels)} />
        </div>
        <div>
          <h3>Relocation support</h3>
          <DistributionTable caption="Relocation support" distribution={geography.relocation} label={labelFrom(availabilityLabels)} />
        </div>
        <div>
          <h3>Employer of record</h3>
          <p>
            Stated for <RateValue rate={geography.employerOfRecord.stated} /> of all jobs.
          </p>
          <DistributionTable caption="Employer of record regions" distribution={geography.employerOfRecord.regions} label={regionLabel} />
        </div>
      </div>
      <h3>Time-zone requirements</h3>
      <p>
        Stated for <RateValue rate={geography.timeZone.stated} /> of all jobs.
        {geography.timeZone.top.length ? ` Most stated: ${geography.timeZone.top.map((row) => `${row.text} (${row.count})`).join("; ")}.` : ""}
      </p>
    </section>
  );
}

export function MarketSeniority({ market }: { market: MarketAnalytics }) {
  const seniority = market.seniority;
  return (
    <section aria-labelledby="seniority" className="market-section">
      <h2 id="seniority">Seniority</h2>
      <p>Seniority as stated by the posting or its title; nothing is inferred from years, salary or wording. Salary and recommendations by seniority are in their sections.</p>
      <DistributionTable
        caption="Seniority"
        distribution={seniority.distribution}
        label={labelFrom(seniorityLabels)}
        link={(key) => dashboardHref(market, { seniority: key })}
      />
      <TrendTable caption="Seniority by first-seen week" trend={seniority.trend} label={labelFrom(seniorityLabels)} />
      {seniority.labels.length ? <p>Seniority as written: {seniority.labels.map((row) => `${row.label} (${row.count})`).join("; ")}.</p> : null}
    </section>
  );
}

export function MarketRequirements({ market }: { market: MarketAnalytics }) {
  const requirements = market.requirements;
  const n = requirements.cohort.jobs;
  const phrases = ranked(requirements.topPhrases, n, (row) => row.phrase);
  return (
    <section aria-labelledby="requirements" className="market-section">
      <h2 id="requirements">Requirements</h2>
      <p>
        From the job-side requirements the evaluator reconstructed for evaluated jobs only: {requirements.evaluated} of {market.overview.total} jobs (
        <RateValue rate={requirements.evaluatedCoverage} />
        ), {requirements.withRequirementData} with requirement data. {market.notes.evaluation} Location and travel requirements are not counted here.
      </p>
      {requirements.versions.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Requirement data by JD Reconstruction version</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Evaluated jobs</th>
                <th scope="col">In the figures below</th>
              </tr>
            </thead>
            <tbody>
              {requirements.versions.map((row) => (
                <tr key={row.version ?? "unrecorded"}>
                  <th scope="row">{row.version ?? "Version not recorded"}</th>
                  <td>{row.jobs}</td>
                  <td>{row.included ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {requirements.cohort.reason ? <p className="muted">{requirements.cohort.reason}</p> : null}
      {n ? (
        <>
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>{`Evaluated jobs with at least one requirement, by category (n = ${n})`}</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Any strength</th>
                  <th scope="col">Required</th>
                  <th scope="col">Preferred</th>
                  <th scope="col">Other strengths</th>
                </tr>
              </thead>
              <tbody>
                {requirements.categories.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{requirementCategoryLabels[row.category] ?? row.category}</th>
                    <td>
                      <RateValue rate={row.jobs} />
                    </td>
                    <td>{formatRate(row.required)}</td>
                    <td>{formatRate(row.preferred)}</td>
                    <td>{formatRate(row.other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Other strengths: ideal, nice to have, or ambiguous.</p>
          <h3>Highest stated minimum experience requirement per job</h3>
          <p>
            {requirements.statedYears.withYears} of {requirements.statedYears.jobs} jobs with an experience requirement state a number of years (
            {requirements.statedYears.openEnded} open-ended, such as “5+ years”). Each job counts once, by the highest minimum stated in any one of its
            experience requirements; this is not a single total-experience requirement.
          </p>
          {requirements.statedYears.withYears ? (
            <div className="table-scroll">
              <table className="capacity-table insights-table">
                <caption>Highest stated minimum experience requirement per job (years)</caption>
                <thead>
                  <tr>
                    <th scope="col">Years</th>
                    <th scope="col">Jobs</th>
                    <th scope="col">% of jobs stating years</th>
                  </tr>
                </thead>
                <tbody>
                  {requirements.statedYears.buckets.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.key}</th>
                      <td>{row.count}</td>
                      <td>
                        <RateValue rate={row.share} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <h3>Most stated requirements</h3>
          {!phrases.ranked ? <p className="muted">Insufficient sample: listed alphabetically, not ranked.</p> : null}
          <div className="table-scroll">
            <table className="capacity-table insights-table">
              <caption>Requirements as written (case and spacing ignored)</caption>
              <thead>
                <tr>
                  <th scope="col">Requirement</th>
                  <th scope="col">Category</th>
                  <th scope="col">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {phrases.rows.map((row) => (
                  <tr key={`${row.category}-${row.phrase}`}>
                    <th scope="row">{row.phrase}</th>
                    <td>{requirementCategoryLabels[row.category] ?? row.category}</td>
                    <td>
                      <RateValue rate={row.share} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No requirement data for evaluated jobs in this window.</p>
      )}
    </section>
  );
}

export function MarketSegment({ market }: { market: MarketAnalytics }) {
  const segment = market.segment;
  return (
    <section aria-labelledby="segment" className="market-section">
      <h2 id="segment">Customer segment — evaluated jobs only</h2>
      <p>
        The customer segment the evaluator identified, for {segment.evaluated} evaluated {segment.evaluated === 1 ? "job" : "jobs"} (coverage{" "}
        <RateValue rate={segment.coverage} />
        ). {market.notes.evaluation} Industry is not available.
      </p>
      <DistributionTable
        caption="Customer segment (evaluated jobs)"
        distribution={segment.distribution}
        label={labelFrom(segmentLabels)}
        allLabel="% of evaluated jobs"
        knownLabel="% of jobs with a known segment"
        link={(key) => dashboardHref(market, { segment: key })}
      />
    </section>
  );
}

export function MarketRecommendations({ market }: { market: MarketAnalytics }) {
  const recommendations = market.recommendations;
  const decision = (key: "APPLY" | "REVIEW" | "SKIP") => dashboardHref(market, { rec: key });
  return (
    <section aria-labelledby="recommendations" className="market-section">
      <h2 id="recommendations">Recommendations</h2>
      <p className="market-disclosure">{market.notes.evaluation}</p>
      <p>
        Rates use completed evaluations only: {recommendations.completed} of {recommendations.total} jobs (coverage <RateValue rate={recommendations.coverage} />
        ), each job by its latest completed evaluation, as stored.
      </p>
      <dl className="usage-totals-grid insights-tiles">
        <Tile label="Apply">
          <Link href={decision("APPLY")}>
            <RateValue rate={recommendations.apply} none="No completed evaluations" />
          </Link>
        </Tile>
        <Tile label="Review">
          <Link href={decision("REVIEW")}>
            <RateValue rate={recommendations.review} none="No completed evaluations" />
          </Link>
        </Tile>
        <Tile label="Skip">
          <Link href={decision("SKIP")}>
            <RateValue rate={recommendations.skip} none="No completed evaluations" />
          </Link>
        </Tile>
      </dl>
      <div className="table-scroll">
        <table className="capacity-table insights-table">
          <caption>Evaluation state</caption>
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Jobs</th>
            </tr>
          </thead>
          <tbody>
            {marketEvaluationStates.map((state) => (
              <tr key={state}>
                <th scope="row">{marketStateLabels[state]}</th>
                <td>{recommendations.states[state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recommendations.trend.length ? (
        <div className="table-scroll">
          <table className="capacity-table insights-table">
            <caption>Recommendations by first-seen week</caption>
            <thead>
              <tr>
                <th scope="col">First seen in week of</th>
                <th scope="col">Jobs</th>
                <th scope="col">Evaluated</th>
                <th scope="col">Coverage</th>
                <th scope="col">Apply</th>
                <th scope="col">Review</th>
                <th scope="col">Skip</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.trend.map((row) => (
                <tr key={row.week}>
                  <th scope="row">{row.week}</th>
                  <td>{row.jobs}</td>
                  <td>{row.completed}</td>
                  <td>{formatRate(row.coverage, "—")}</td>
                  <td>
                    <RateValue rate={row.applyRate} none="—" />
                  </td>
                  <td>
                    <RateValue rate={row.reviewRate} none="—" />
                  </td>
                  <td>
                    <RateValue rate={row.skipRate} none="—" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Apply, Review and Skip are shares of that week’s completed evaluations with a recommendation (n = Evaluated).</p>
        </div>
      ) : null}
      <RecommendationTable caption="Recommendations by title group" rows={recommendations.byTitleGroup} label={titleGroupLabel} />
      <RecommendationTable caption="Recommendations by seniority" rows={recommendations.bySeniority} label={labelFrom(seniorityLabels)} />
      <RecommendationTable caption="Recommendations by work arrangement" rows={recommendations.byArrangement} label={labelFrom(arrangementLabels)} />
      <RecommendationTable caption="Recommendations by job region" rows={recommendations.byJobRegion} label={regionLabel} />
    </section>
  );
}

export function MarketView({ market }: { market: MarketAnalytics }) {
  return (
    <>
      <MarketNotes market={market} />
      <MarketSectionNav />
      <MarketOverview market={market} />
      <MarketSalary market={market} />
      <MarketRoles market={market} />
      <MarketLocation market={market} />
      <MarketSeniority market={market} />
      <MarketRequirements market={market} />
      <MarketSegment market={market} />
      <MarketRecommendations market={market} />
      <p className="muted">
        Links open the dashboard with the matching filter and first-seen dates where it supports them; the dashboard lists every collected job and
        matches titles by text, so its counts can differ.
      </p>
    </>
  );
}
