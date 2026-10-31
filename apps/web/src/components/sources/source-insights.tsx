import Link from "next/link";
import {
  evaluationStateOrder,
  geographyBuckets,
  sourceInsightSlug,
  sourceSortKeys,
  type SiRate,
  type SiSourceMetrics,
  type SiWindow,
  type SiWindowKey,
  type SourceInsightDetail,
} from "@ai-career/core";
import { formatDateTime, formatMoney, pluralize } from "../budget/budget-format";
import { formatPricingVersions } from "../usage/usage-format";
import {
  decisionLabels,
  evaluationStateLabels,
  formatPercent,
  formatRate,
  geographyLabels,
  noteLabels,
  sampleLabels,
  sortLabels,
  windowLabels,
} from "./insight-labels";
import { sourceCategoryLabels, sourceHealthLabels } from "./source-labels";
import type { SourceHealthBrief, SourceInsightsOverview } from "@/server/source-intelligence-service";

// Source Intelligence views (feature 15). Server-rendered and read-only. No
// figure is coloured or ranked as good or bad; every rate shows its sample.

export function SourcesSectionNav({ current }: { current: "manage" | "insights" }) {
  return (
    <nav className="sources-section-nav" aria-label="Sources sections">
      <Link href="/sources" aria-current={current === "manage" ? "page" : undefined}>
        Manage sources
      </Link>
      <Link href="/sources/insights" aria-current={current === "insights" ? "page" : undefined}>
        Source insights
      </Link>
    </nav>
  );
}

export function RateValue({ rate, none }: { rate: SiRate; none?: string }) {
  const label = sampleLabels[rate.sample];
  return (
    <>
      {formatRate(rate, none)}
      {label && rate.value !== null ? <span className="sample-label"> · {label}</span> : null}
    </>
  );
}

const dateInput = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

export function windowDescription(window: SiWindow): string {
  if (window.key !== "custom") return windowLabels[window.key];
  const end = new Date(window.to.getTime() - 24 * 60 * 60 * 1000);
  return `${dateInput(window.from)} to ${dateInput(end)}`;
}

export function InsightsControls({ overview }: { overview: SourceInsightsOverview }) {
  const window = overview.window;
  const customEnd = window.key === "custom" ? new Date(window.to.getTime() - 24 * 60 * 60 * 1000) : null;
  return (
    <form className="insights-controls" method="get" action="/sources/insights" aria-label="Source insights options">
      <label>
        Window
        <select name="window" defaultValue={window.key}>
          {(Object.keys(windowLabels) as SiWindowKey[]).map((key) => (
            <option key={key} value={key}>
              {windowLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        From (custom)
        <input type="date" name="from" defaultValue={window.key === "custom" ? dateInput(window.from) : ""} />
      </label>
      <label>
        To (custom)
        <input type="date" name="to" defaultValue={customEnd ? dateInput(customEnd) : ""} />
      </label>
      <label>
        Group by
        <select name="groupBy" defaultValue={overview.groupBy}>
          <option value="source">Configured source</option>
          <option value="adapter">Adapter</option>
        </select>
      </label>
      <label>
        Order within each section
        <select name="sort" defaultValue={overview.sort}>
          {sourceSortKeys.map((key) => (
            <option key={key} value={key}>
              {sortLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="archived" value="include" defaultChecked={overview.includeArchived} /> Include archived sources
      </label>
      <button type="submit" className="secondary-button">
        Show
      </button>
    </form>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function InsightsSummary({ overview }: { overview: SourceInsightsOverview }) {
  const platform = overview.platform;
  const money = (value: number | null) => formatMoney(value, overview.currency);
  return (
    <section aria-labelledby="insights-summary-heading">
      <h2 id="insights-summary-heading">All sources, {windowDescription(overview.window).toLowerCase()}</h2>
      <dl className="usage-totals-grid insights-tiles">
        <Tile label="Opportunities discovered">{platform.discovered}</Tile>
        <Tile label="New opportunities">{platform.new}</Tile>
        <Tile label="Platform duplicate rate">
          <RateValue rate={platform.duplicateRate} none="No listings yet" />
        </Tile>
        <Tile label="Evaluated / useful (Apply or Review)">
          {platform.evaluation.evaluated} / {platform.evaluation.useful}
        </Tile>
        <Tile label="Applications → interviews → offers">
          {platform.outcomes.applications} → {platform.outcomes.interviews} → {platform.outcomes.offers}
        </Tile>
        <Tile label="Recorded evaluation spend (estimated)">{money(overview.currency ? platform.cost.totalSpend : null)}</Tile>
        <Tile label="Cost per useful job (estimated)">
          <CostPerUseful cost={platform.cost} />
        </Tile>
        <Tile label="Sources needing attention">{overview.needsAttention}</Tile>
      </dl>
      <p className="muted">
        Listings found {platform.listings}; possible duplicates (unresolved) {platform.possibleDuplicates}. Waiting for evaluation:{" "}
        {platform.evaluation.states.waiting_budget} on the AI budget, {platform.evaluation.states.waiting_usage_limit} on a usage limit — neither
        counts against a source.
        {platform.unattributed ? ` ${pluralize(platform.unattributed, "opportunity", "opportunities")} without a source record count only in these totals.` : ""}
      </p>
      <CostBasisNote currency={overview.currency} pricingVersions={overview.pricingVersions} unknownAttempts={platform.cost.unknownAttempts} failedSpend={platform.cost.failedSpend} otherSpend={platform.cost.otherSpend} />
    </section>
  );
}

export function CostPerUseful({ cost }: { cost: SiSourceMetrics["cost"] }) {
  if (cost.costPerUsefulNote === "no_currency") return <>Unknown (no pricing or budget currency)</>;
  if (cost.costPerUsefulNote === "no_useful_jobs") return <>No useful jobs yet</>;
  return (
    <>
      {formatMoney(cost.costPerUseful, cost.currency)}
      {cost.incomplete ? <span className="sample-label"> · incomplete</span> : null}
    </>
  );
}

function CostBasisNote({ currency, pricingVersions, unknownAttempts, failedSpend, otherSpend }: { currency: string | null; pricingVersions: string[]; unknownAttempts: number; failedSpend: number; otherSpend: number }) {
  return (
    <p className="usage-note">
      Costs are estimates from recorded attempts priced in {currency ?? "no configured currency"} (pricing {formatPricingVersions(pricingVersions)}).
      Cost per useful job counts completed evaluations only; failed evaluations ({formatMoney(currency ? failedSpend : null, currency)}) and
      evaluations still running ({formatMoney(currency ? otherSpend : null, currency)}) are shown apart.
      {unknownAttempts ? ` ${pluralize(unknownAttempts, "attempt")} had no recorded cost and are not counted as zero.` : ""}
    </p>
  );
}

const topGeography = (row: SiSourceMetrics) => {
  const known = geographyBuckets.filter((bucket) => bucket !== "UNKNOWN" && row.geography.buckets[bucket] > 0).sort((a, b) => row.geography.buckets[b] - row.geography.buckets[a]);
  const unknown = row.geography.denominator ? row.geography.buckets.UNKNOWN / row.geography.denominator : null;
  if (!row.geography.denominator) return "No opportunities";
  return `${known[0] ? geographyLabels[known[0]] : "None known"} · Unknown ${formatPercent(unknown)}`;
};

function HealthCell({ row, health }: { row: SiSourceMetrics; health: SourceHealthBrief | undefined }) {
  if (row.kind === "adapter") return <>{pluralize(row.memberSourceIds.length, "source")}</>;
  if (!health) return <>Not tracked</>;
  if (health.archived) return <>Archived</>;
  if (!health.enabled) return <>Disabled</>;
  return (
    <>
      {sourceHealthLabels[health.status] ?? health.status}
      {health.stale ? " · stale" : ""}
    </>
  );
}

export function SourceComparisonTable({ rows, overview, caption }: { rows: SiSourceMetrics[]; overview: SourceInsightsOverview; caption: string }) {
  const automated = rows[0]?.group !== "user-collected";
  const windowQuery = queryString(overview);
  return (
    <div className="table-scroll">
      <table className="insights-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            {automated ? <th scope="col">Health</th> : null}
            {automated ? <th scope="col">Retrieval success</th> : null}
            <th scope="col">Listings found</th>
            <th scope="col">New</th>
            <th scope="col">Already known on arrival</th>
            <th scope="col">Exclusive (as of today)</th>
            <th scope="col">Evaluated (coverage)</th>
            <th scope="col">Useful: Apply or Review</th>
            <th scope="col">Apply</th>
            <th scope="col">Waiting: budget / limit</th>
            <th scope="col">Applications → interviews → offers</th>
            <th scope="col">Cost per useful job</th>
            <th scope="col">Geography</th>
            <th scope="col">Employer ATS known</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <Link href={`/sources/${encodeURIComponent(sourceInsightSlug(row.key))}/insights${windowQuery}`}>{row.name}</Link>
                {row.category ? <span className="muted"> · {sourceCategoryLabels[row.category] ?? row.category}</span> : null}
              </th>
              {automated ? (
                <td>
                  <HealthCell row={row} health={overview.health[row.key]} />
                </td>
              ) : null}
              {automated ? (
                <td>{row.reliability ? <RateValue rate={row.reliability.successRate} none={row.reliability.runs ? "No decisive runs" : "No runs"} /> : "Not tracked"}</td>
              ) : null}
              <td>{row.discovery.listings}</td>
              <td>{row.discovery.new}</td>
              <td>
                <RateValue rate={row.discovery.duplicateRate} none="No listings" />
              </td>
              <td>{row.discovery.exclusive}</td>
              <td>
                {row.evaluation.evaluated} <span className="muted">({formatRate(row.evaluation.coverage, "none discovered")})</span>
              </td>
              <td>
                <RateValue rate={row.evaluation.usefulRate} none="None evaluated" />
              </td>
              <td>
                <RateValue rate={row.evaluation.applyRate} none="None evaluated" />
              </td>
              <td>
                {row.evaluation.states.waiting_budget} / {row.evaluation.states.waiting_usage_limit}
              </td>
              <td>
                {row.outcomes.applications} → {row.outcomes.interviews} → {row.outcomes.offers}
                {row.outcomes.awaitingResponse ? <span className="muted"> ({row.outcomes.awaitingResponse} awaiting response)</span> : null}
              </td>
              <td>
                <CostPerUseful cost={row.cost} />
              </td>
              <td>{topGeography(row)}</td>
              <td>
                {row.ats.denominator ? `${formatPercent(row.ats.known / row.ats.denominator)} (${row.ats.known} of ${row.ats.denominator})` : "No opportunities"}
                {row.ats.known ? <span className="muted"> · direct {formatRate(row.ats.directShare)}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function queryString(overview: { window: SiWindow }): string {
  const window = overview.window;
  if (window.key === "30d") return "";
  if (window.key !== "custom") return `?window=${window.key}`;
  const end = new Date(window.to.getTime() - 24 * 60 * 60 * 1000);
  return `?window=custom&from=${dateInput(window.from)}&to=${dateInput(end)}`;
}

export function RowNotes({ row }: { row: SiSourceMetrics }) {
  if (!row.notes.length) return null;
  return (
    <ul className="insight-notes">
      {row.notes.map((note) => (
        <li key={note}>{noteLabels[note]}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Drill-down

function Bars({ label, rows }: { label: string; rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(0, ...rows.map((row) => row.count));
  if (max === 0) return null;
  return (
    <div className="distribution" aria-hidden="true">
      <ul>
        {rows.map((row) => (
          <li key={row.label}>
            <span className="distribution-label">{row.label}</span>
            <span className="distribution-bar">
              <span style={{ width: `${row.count ? Math.max(2, Math.round((row.count / max) * 100)) : 0}%` }} />
            </span>
            <span className="distribution-count">{row.count}</span>
          </li>
        ))}
      </ul>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

type Detail = SourceInsightDetail & { health: SourceHealthBrief | null; currency: string | null; pricingVersions: string[] };

export function SourceInsightDetailView({ detail }: { detail: Detail }) {
  const row = detail.source;
  const money = (value: number) => formatMoney(detail.currency ? value : null, detail.currency);
  const funnel = [
    { label: "Opportunities discovered", count: row.discovery.discovered },
    { label: "New (discovered first here)", count: row.discovery.new },
    { label: "Evaluated", count: row.evaluation.evaluated },
    { label: "Useful (Apply or Review)", count: row.evaluation.useful },
    { label: "Applications", count: row.outcomes.applications },
    { label: "Interviews", count: row.outcomes.interviews },
    { label: "Offers", count: row.outcomes.offers },
  ];
  return (
    <>
      <p className="muted">
        {windowDescription(detail.window)}
        {row.category ? ` · ${sourceCategoryLabels[row.category] ?? row.category}` : ""}
        {row.group === "user-collected" ? " · User-collected" : ""}
        {detail.health ? ` · Health: ${detail.health.archived ? "Archived" : !detail.health.enabled ? "Disabled" : sourceHealthLabels[detail.health.status] ?? detail.health.status}` : ""}
      </p>
      <RowNotes row={row} />

      <section aria-labelledby="funnel-heading">
        <h2 id="funnel-heading">From discovery to outcome</h2>
        <p className="muted">
          New opportunities, evaluations, cost and outcomes are credited to the source that discovered the job first. Applications, interviews and offers
          from jobs another source found first appear below as presence, never in this source&apos;s totals.
        </p>
        <Bars label="Funnel counts; the same figures follow in a table." rows={funnel} />
        <table className="capacity-table">
          <caption>Discovery to outcome</caption>
          <tbody>
            {funnel.map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                <td>{item.count}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Useful rate (Apply or Review ÷ evaluated)</th>
              <td><RateValue rate={row.evaluation.usefulRate} none="None evaluated" /></td>
            </tr>
            <tr>
              <th scope="row">Apply rate</th>
              <td><RateValue rate={row.evaluation.applyRate} none="None evaluated" /></td>
            </tr>
            <tr>
              <th scope="row">Interview rate (of applications past 30 days or progressed)</th>
              <td><RateValue rate={row.outcomes.interviewRate} none="No mature applications" /></td>
            </tr>
            <tr>
              <th scope="row">Applications awaiting response (under 30 days)</th>
              <td>{row.outcomes.awaitingResponse}</td>
            </tr>
            <tr>
              <th scope="row">Also listed here before an outcome credited elsewhere</th>
              <td>
                {row.outcomes.alsoListedBefore.applications} applications, {row.outcomes.alsoListedBefore.interviews} interviews, {row.outcomes.alsoListedBefore.offers} offers
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="listings-heading">
        <h2 id="listings-heading">Listings and duplicates</h2>
        <table className="capacity-table">
          <caption>What this source&apos;s listings were</caption>
          <tbody>
            <tr><th scope="row">Listings found</th><td>{row.discovery.listings}</td></tr>
            <tr><th scope="row">New: this listing created the opportunity</th><td>{row.discovery.new}</td></tr>
            <tr><th scope="row">Already known on arrival</th><td><RateValue rate={row.discovery.duplicateRate} none="No listings" /></td></tr>
            <tr><th scope="row">Of those, repost on this same source</th><td>{row.discovery.repostOnSameSource}</td></tr>
            <tr><th scope="row">Possible duplicates (unresolved probable match)</th><td>{row.discovery.possibleDuplicates}</td></tr>
            <tr><th scope="row">Exclusive: no other source has listed it (as of today)</th><td>{row.discovery.exclusive}</td></tr>
            <tr><th scope="row">Not processed (kept unlinked after a normalization failure)</th><td>{row.discovery.notProcessed}</td></tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="evaluation-heading">
        <h2 id="evaluation-heading">Evaluation state of jobs it discovered first</h2>
        <p className="muted">Only completed evaluations enter the rates. Waiting, in-progress, failed, dismissed and not-yet-evaluated jobs are counted, never held against the source.</p>
        <table className="capacity-table">
          <caption>Evaluation state ({row.evaluation.cohort} jobs)</caption>
          <tbody>
            {evaluationStateOrder.map((state) => (
              <tr key={state}>
                <th scope="row">{evaluationStateLabels[state]}</th>
                <td>
                  {row.evaluation.states[state]}
                  {state === "evaluated" && row.evaluation.evaluated
                    ? ` (Apply ${row.evaluation.apply}, Review ${row.evaluation.review}, Skip ${row.evaluation.skip})`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="cost-heading">
        <h2 id="cost-heading">Evaluation cost (estimated)</h2>
        <table className="capacity-table">
          <caption>Spend on jobs it discovered first</caption>
          <tbody>
            <tr><th scope="row">Cost per useful job</th><td><CostPerUseful cost={row.cost} /></td></tr>
            <tr><th scope="row">Completed evaluations</th><td>{money(row.cost.completedSpend)}</td></tr>
            <tr><th scope="row">Failed evaluations</th><td>{money(row.cost.failedSpend)}</td></tr>
            <tr><th scope="row">Evaluations in progress</th><td>{money(row.cost.otherSpend)}</td></tr>
            <tr><th scope="row">Total recorded</th><td>{money(row.cost.totalSpend)}</td></tr>
            <tr><th scope="row">Attempts without a recorded cost</th><td>{row.cost.unknownAttempts}</td></tr>
          </tbody>
        </table>
        <p className="usage-note">Estimates from recorded attempts (pricing {formatPricingVersions(detail.pricingVersions)}); an attempt without a recorded cost is never counted as zero.</p>
      </section>

      {row.reliability ? (
        <section aria-labelledby="reliability-heading">
          <h2 id="reliability-heading">Retrieval reliability</h2>
          <table className="capacity-table">
            <caption>Runs in this window</caption>
            <tbody>
              <tr><th scope="row">Runs</th><td>{row.reliability.runs}</td></tr>
              <tr><th scope="row">Successful retrievals</th><td>{row.reliability.successfulRuns}</td></tr>
              <tr><th scope="row">Source failures</th><td>{row.reliability.sourceFailures}</td></tr>
              <tr><th scope="row">Our-side (neutral) failures, not counted</th><td>{row.reliability.neutralRuns}</td></tr>
              <tr><th scope="row">Success rate</th><td><RateValue rate={row.reliability.successRate} none="No decisive runs" /></td></tr>
              <tr><th scope="row">Listings scanned in the latest successful run</th><td>{row.reliability.lastListingsScanned ?? "Unknown"}</td></tr>
              <tr><th scope="row">Role-family yield (median kept ÷ scanned)</th><td>{formatPercent(row.reliability.roleFamilyYield)}</td></tr>
              <tr><th scope="row">Waiting for details</th><td>{row.reliability.pendingDetails}</td></tr>
            </tbody>
          </table>
        </section>
      ) : null}

      <section aria-labelledby="geography-heading">
        <h2 id="geography-heading">Geographic coverage</h2>
        <p className="muted">
          From stated residency, work-authorization or location facts only; nothing is guessed. A job open to several regions counts in each, so shares can add
          up to more than 100%. Unknown stays in the denominator ({row.geography.denominator} opportunities).
        </p>
        <table className="capacity-table">
          <caption>Opportunities by region</caption>
          <tbody>
            {geographyBuckets.map((bucket) => (
              <tr key={bucket}>
                <th scope="row">{geographyLabels[bucket]}</th>
                <td>
                  {row.geography.buckets[bucket]}
                  {row.geography.denominator ? ` (${formatPercent(row.geography.buckets[bucket] / row.geography.denominator)})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="ats-heading">
        <h2 id="ats-heading">Employer ATS</h2>
        <p className="muted">
          Employer ATS known for {row.ats.known} of {row.ats.denominator}. Direct ATS provenance (the platform also has the job from the employer&apos;s ATS):{" "}
          <RateValue rate={row.ats.directShare} none="no employer ATS known" />.
        </p>
        {Object.keys(row.ats.platforms).length ? (
          <table className="capacity-table">
            <caption>Employer ATS of the opportunities it listed</caption>
            <tbody>
              {Object.entries(row.ats.platforms)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([platform, count]) => (
                  <tr key={platform}>
                    <th scope="row">{platform}</th>
                    <td>{count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {detail.trend.length ? (
        <section aria-labelledby="trend-heading">
          <h2 id="trend-heading">Listings by week</h2>
          <Bars label="Listings per week; the same figures follow in a table." rows={detail.trend.map((week) => ({ label: week.weekStart.toISOString().slice(0, 10), count: week.listings }))} />
          <table className="capacity-table">
            <caption>Listings and new opportunities per week (weeks starting Monday, UTC)</caption>
            <thead>
              <tr><th scope="col">Week of</th><th scope="col">Listings</th><th scope="col">New</th></tr>
            </thead>
            <tbody>
              {detail.trend.map((week) => (
                <tr key={week.weekStart.toISOString()}>
                  <th scope="row">{week.weekStart.toISOString().slice(0, 10)}</th>
                  <td>{week.listings}</td>
                  <td>{week.new}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section aria-labelledby="opportunities-heading">
        <h2 id="opportunities-heading">Opportunities it listed</h2>
        {detail.opportunities.length ? (
          <div className="table-scroll">
            <table className="insights-table">
              <caption>
                Newest first{detail.opportunitiesTruncated ? " (the latest 200)" : ""}. Credit shows who discovered it first; every listing is kept.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Opportunity</th>
                  <th scope="col">Credit</th>
                  <th scope="col">Listings (first seen)</th>
                  <th scope="col">Evaluation</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {detail.opportunities.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" className="wrap-cell">
                      <Link href={`/opportunities/${item.id}`}>{item.title ?? "Untitled opportunity"}</Link>
                      {item.company ? <span className="muted"> · {item.company}</span> : null}
                      {item.possibleDuplicate ? <span className="muted"> · possible duplicate</span> : null}
                    </th>
                    <td className="wrap-cell">
                      {item.credit === "discovered" ? "Discovered here first" : `Also listed; discovered by ${item.discoveredByName ?? "another source"}`}
                      {item.coDiscovered ? " · co-discovered" : ""}
                    </td>
                    <td className="wrap-cell">
                      <ul className="insight-listings">
                        {item.listings.map((listing, index) => (
                          <li key={`${listing.source}-${index}`}>
                            {listing.sourceName} · {formatDateTime(listing.firstSeenAt)}
                            {listing.duplicateDecision === "MATCH" ? " · attached as already known" : ""}
                            {listing.duplicateDecision === "PROBABLE_MATCH" ? " · probable match" : ""}
                            {listing.via === "ledger" ? " · seen in listing history" : ""}
                            {listing.ledgerState === "REMOVED" ? " · no longer listed" : ""}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      {item.evaluationState === "evaluated" && item.decision ? decisionLabels[item.decision] ?? item.decision : evaluationStateLabels[item.evaluationState]}
                    </td>
                    <td>
                      {item.outcome.offer
                        ? "Offer"
                        : item.outcome.interview
                          ? "Interview"
                          : item.outcome.awaitingResponse
                            ? "Applied · awaiting response"
                            : item.outcome.applied
                              ? "Applied"
                              : "Not applied"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No listings from this source in this window.</p>
        )}
      </section>
    </>
  );
}
