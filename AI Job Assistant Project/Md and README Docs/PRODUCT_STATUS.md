# Product Status

**Project:** AI Career Platform / AI Job Assistant  
**Primary implemented domain:** Customer Success  
**Status:** Active development  
**Last updated:** October 18, 2026

## Purpose

This document provides a concise current-state view of the product. It does not replace the authoritative PRDs, TDDs, Semantic Evaluation Playbook, or detailed handoffs.

Use it to answer:

1. What is working now?
2. What is being completed now?
3. What remains before main-product acceptance?

## Current Working Product

The platform already supports a meaningful manual Customer Success workflow:

```text
Manual Opportunity
→ Raw source/provenance preservation
→ Deterministic normalization
→ Dashboard / search / filters
→ Budget admission and queued evaluation
→ Background Customer Success evaluation
→ Deterministic Apply / Review / Skip
→ Persisted results/evidence/history
→ Lifecycle and application workflow
```

Automated discovery is implemented for the verified official API and feed sources (Feature 11A, committed as `fad2341`) and for the verified public/guest-endpoint and public-HTML sources (Feature 11B, committed as `2a1d8c2`). Sources added on `/sources` start disabled; once enabled, the retrieval worker collects listings whose title matches a Customer Success role family and feeds them, unevaluated, into the same normalization, deduplication and evaluation path. Source health and conservative retrieval (Feature 12, committed as `f10a02b`) back a failing source off, honour a source's request to wait, and show each source's health and freshness. Posting history (Feature 13, awaiting review) records where and when each retrieved listing was seen, confirms removal only from sources that show their whole board, and shows a listing that returns as listed again. The manual workflow is unchanged and remains the stable foundation.

```text
Enabled source (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Remote OK, We Work Remotely, Himalayas, Working Nomads, Workable, Wellfound)
→ Retrieval worker (title-term filter, raw source preserved)
→ Deterministic normalization
→ Deduplication (attach, flag or create; employer link preferred; changes recorded)
→ Dashboard, unevaluated until the user requests an evaluation
```

*(Earlier wording, superseded on October 18, 2026: "Automated discovery is not yet complete, but the manual workflow remains the stable product foundation that later retrieval will feed. The current product can evaluate a manually entered job without automated retrieval.")*

**Branch note:** the main-product work described here is implemented on `claude/gallant-pasteur-y1ou3i`. The evaluator branch `codex/evaluator-live-diagnostic` carries three things not on the main-product branch:

- the October 15 evaluator routing lock;
- the October 10–13 evaluator semantic-contract repairs;
- the Milestone 4 salary-policy alignment.

Neither branch is merged into `main` yet; they are combined at the deliberate final integration pass.

## Complete or Substantially Implemented

### Core platform and product workflow

- Repository and modular-monolith foundation.
- PostgreSQL persistence and Prisma schema/migrations.
- Manual opportunity capture with raw `SourceRecord` preservation and field provenance.
- Deterministic normalization.
- Shared evaluation framework with ordered stages.
- Evidence records.
- Explicit Unknown handling.
- Contradiction handling.
- Structured semantic-output validation.
- Background evaluation processing.
- Full opportunity dashboard with search, filtering, sorting, pagination, Unknown states, and persisted evaluator-derived fields.
- Evaluation history and persisted recommendation display; results retrieval through the application.
- Saved/dismissed/archived/applied lifecycle actions with guarded transitions and action history.
- User profile/preferences management and versioning, including optional limitations.
- Semantic-operation usage and estimated-cost accounting, with AI usage/cost display.
- Restart-safe per-evaluation semantic-call budgeting.
- Persistent monthly budget ledger, reservation/reconciliation, warning thresholds, throughput/token limits, budget deferral/resume/cancel, and backlog/capacity reporting.
- Application tracker, complete after the Task 8 completion pass (`534a4c7`, October 16, 2026):
  - stages and outcomes, with applied and closed dates checked as calendar dates;
  - follow-ups that can be rescheduled or reworded;
  - interviews with full editing, plus contacts and notes;
  - next-action and due/overdue/due-today visibility for open, non-archived applications;
  - `/applications` views, filters and in-tracker recovery from empty results;
  - stale-write protection that keeps typed input;
  - guarded lifecycle interaction.
- Operational hardening and product-acceptance infrastructure, complete after the Task 9 completion pass (October 16, 2026):
  - setup, migration verification and the read-only `pnpm app:doctor`, which reports budget deferrals and usage-limit deferrals separately;
  - `/api/health`, with tested failure handling that returns no error detail;
  - a single-worker lock with idle-only recovery; the guarantee holds while the lock's database connection stays up;
  - honest queue states and safe public errors, with the opportunity API routes logging only the error name;
  - whole-product acceptance tests, whose E2E runs always use a deterministic, non-live AI credential.

  Task 9 added no migration and changed no queue, worker, lease or evaluator code.

`CURRENT_PROGRESS.md` records each task in detail.

### Task 7 normalized opportunity facts

Task 7 is complete at `754f956dc0860149760936a61bdace0489404b9a`.

Normalized/persisted facts now include, when explicitly supported by source data:

- salary minimum/maximum;
- currency;
- original salary text;
- work arrangement;
- seniority;
- department;
- employment type;
- closing date;
- residency requirement;
- residency regions.

Unknown stays Unknown. Raw text and provenance remain preserved. Salary amounts are stored as stated and are not FX-converted in persistence.

### Customer Success evaluator

- Nine-stage Customer Success evaluation pipeline plus deterministic Final Recommendation.
- Hard Filters.
- JD Reconstruction.
- Job Evaluation.
- Company Alignment.
- Organizational Maturity.
- Alex Fit.
- Burnout Risk.
- Resume Match with Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk fallback to deterministic `UNKNOWN` when posting-history evidence is unavailable.
- Apply / Review / Skip output.
- Evidence-backed explanations, Unknowns, contradictions, and versioned evaluation metadata.
- Preservation of Unknowns and contradictions.
- Resume Match Optimization #2 and JD Reconstruction State2 are the accepted optimization baselines.

### Results Experience

- Queued/running/completed/failed status handling.
- Bounded API polling.
- Polling cleanup when leaving the page.
- Persisted recommendation display.
- No recommendation recalculation in browser code.
- Expandable evaluation sections.
- Distinction between job-description evidence and profile evidence.
- Explicit display of Unknowns and contradictions.
- Safe rendering of untrusted job-description content as text.
- Evaluation history without overwriting previous evaluations.
- Accessible headings, controls, and status messaging.

### Current routing lock

| Operation | Execution |
| --- | --- |
| Hard Filters | Deterministic |
| JD Reconstruction | GPT-5.6 Terra |
| Job Evaluation | GPT-5.6 Luna |
| Company Alignment | GPT-6 Luna |
| Organizational Maturity | GPT-5.6 Luna |
| Alex Fit | GPT-5.6 Luna |
| Burnout Risk | GPT-6 Luna |
| Resume Match | GPT-5.6 Terra |
| Opportunity Priority | GPT-5.6 Luna |
| Ghost Job Risk | Deterministic when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

Routing is an execution detail and does not change stage semantics or recommendation rules.

**Branch state:** the GPT-6 Luna routing for Company Alignment and Burnout Risk is on `codex/evaluator-live-diagnostic`. `claude/gallant-pasteur-y1ou3i` still carries the earlier accepted routing (GPT-5.6 Luna for both) until final branch combination.

### Milestone 4 salary-policy alignment

Milestone 4 now consumes the Task 7 salary/currency/residency contract at commit `267124f` on `codex/evaluator-live-diagnostic` (not yet merged; on `claude/gallant-pasteur-y1ou3i` the evaluator subject still withholds all ten Task 7 fields until final branch combination).

- `US_REQUIRED`: `$60,000 USD-equivalent` or more = Pass; below `$60,000` = Fail/Skip. No U.S. Review band and no maximum.
- `NON_US`: `$60,000+` = Pass; `$55,000–$59,999.99` = Review; `$50,000–$54,999.99` = conditional Review only when explicit configured geography supports viability, otherwise Unknown; below `$50,000` = Fail/Skip.
- `null` residency requirement = Unknown.
- Residency selects the policy; currency does not.
- Foreign compensation uses the versioned `cs-salary-policy-v2-ecb-2026-10-14` FX policy.
- A disclosed minimum is the gate. Max-only remains Unknown unless even the maximum is below the applicable floor.
- Released to evaluator (on the Codex branch): salary minimum/maximum, currency, residency requirement, residency regions.
- Still withheld pending later coordinated adoption: work arrangement, seniority, department, employment type, closing date.

### Evaluator semantic-contract repairs (evaluator branch, not merged)

Between October 10 and 13, 2026, the evaluator branch repaired several semantic contracts.

- Provider-authored prose became display-only, so no acceptance decision depends on it.
- Requirement statements, experience levels and Genuine Gap evidence became structured fields.
- Structured profile limitations became the only proof of a Genuine Gap.
- INDUSTRY evidence became requirement-relative.
- A Resume Match run fails closed on an outdated JD Reconstruction map.
- Current prompt identifiers on that branch:
  - `cs-jd-reconstruction-v7`
  - `cs-resume-match-v4`
  - `cs-organizational-maturity-v7`

The main-product branch still runs `cs-jd-reconstruction-v3`, `cs-resume-match-v2` and `cs-organizational-maturity-v6`. Details, residual risks and outstanding verification are in `EVALUATOR_STATUS.md` §20.

## In Progress Now

### Main-product tasks

Feature 13, posting history and listing removal, is implemented and verified on the isolated test database and awaiting user review; it is not committed. Feature 12 was committed as `f10a02b` (October 18, 2026). Feature 13 adds an objective posting history for retrieved listings, without changing how they are retrieved, ingested, deduplicated or evaluated:

- **What a run saw:** each run records the IDs of every listing the source listed, before the role-title filter, so a listing whose title changes is still seen. Only Greenhouse, Lever and Ashby, and Workday and SmartRecruiters when a run reads their stated total in full (exactly that many listings), can confirm that a listing is gone; the other sources only record sightings.
- **Removal and reappearance:** a listing missing from one complete check is "Not found in the latest complete check"; missing from two, at least 24 hours apart, it is "No longer listed". A listing that returns is "Listed again". An expiry date a source states is shown, but is never treated as removal.
- **Source settings:** changing what a source retrieves (its board, site, company or career site) starts fresh tracking; changing it back does not bring the old history back. Listings found before Feature 13 show "Last observed …; current status unknown" until they are seen again.
- **Where it shows:** a "Posting history" section on the opportunity page with objective facts (for example "Listed on the employer's board" or "Removed by the employer, still visible elsewhere"), a "No longer listed" dashboard badge when every source that can confirm it has, and a warning, not a block, before evaluating such a listing. Nothing closes or archives an opportunity automatically.
- **Evaluator:** the facts are ready in Ghost Job Risk's input shape but are not passed to the evaluator yet; Ghost Job Risk stays Unknown, and evaluation cost and recommendations are unchanged, until the coordinated evaluator integration.

*(Earlier status, superseded on October 19, 2026 when Feature 12 was committed as `f10a02b`. It read as follows.)*

Feature 12, source health and conservative retrieval, is implemented and verified on the isolated test database and awaiting user review; it is not committed. Feature 11B was committed as `2a1d8c2` (October 18, 2026). Feature 12 adds deterministic health and backoff around the existing sources, without changing any adapter:

- **Stopping politely within a run:** a server error (any 5xx, now its own `SERVER_ERROR` code), like a rate limit (429) or an access refusal (401/403), stops all further requests to that source for the run. Nothing is retried within a run.
- **Waiting between runs:** after a source failure the next run waits longer each time, up to once a week; an access refusal or a changed response format waits at least a day. A source's own Retry-After (on a 429 or 503) is honoured in full, however long. Failures on our side (an interrupted worker, an internal error) never count. No source is ever disabled automatically.
- **Run now:** it can never override a rate limit ("Rate limited until …") or a wait the source asked for ("Retry after … (requested by the source)"). Our own backoff can be passed once with an explicit "Run now anyway". Changing a source's settings clears only our own backoff; enabling or disabling a source keeps any wait.
- **Health on `/sources`:** Healthy, Degraded, Failing, Needs attention, Rate limited or Waiting, with the last attempt, the last successful retrieval, the next run and why, the latest failure, a stale note when no successful retrieval happened for two schedule intervals, and an empty-result note. A run stopped part-way by the source never counts as a successful retrieval.
- **`pnpm app:doctor`:** read-only warnings for enabled sources that are rate limited, waiting, failing, need attention or are stale.
- Listing expiry and removal detection moved to feature 13 (posting history).

*(Earlier status, superseded on October 18, 2026 when Feature 11B was committed as `2a1d8c2`. It read as follows.)*

Feature 11B is implemented and verified on the isolated test database and awaiting user review; it is not committed. Feature 11A was committed as `fad2341` (October 18, 2026). 11B adds the verified public/guest-endpoint and public-HTML sources to the same retrieval path:

- **Workday** (employer ATS): add an employer's career-site address (for example `https://acme.wd5.myworkdayjobs.com/External`). Each run reads a bounded window of the first 100 postings Workday's listing returns (5 pages of 20; Workday does not state their order) and fetches the full details of matching titles, at most 25 per run, postings not seen before first. The company comes from the posting (an optional company name is used only when it is missing).
- **Workable** (job board): the Jobs by Workable search for "customer success", with no setup. Each result already has its full text, so no extra requests are made per job. A run reads a bounded window of the search results (up to 5 pages, relevance order, not newest first).
- **Wellfound** (startup marketplace): the public Customer Success role page, with no setup. Listings are read from the page's embedded data (complete descriptions), up to 11 pages per run, at least 2 seconds apart. Compensation is shown as the source states it and is not normalized.
- **Welcome to the Jungle / Otta** is listed but cannot be enabled: its logged-out site now shows a sign-up and matching flow instead of a public job search, so no listing interface could be verified. It may be reconsidered with browser-assisted retrieval (feature 14).
- Everything else works as in 11A: title-only discovery, complete descriptions, cross-source deduplication with the employer's link preferred, changed listings kept as linked versions, no automatic evaluation, and the same safety limits.

*(Earlier status, superseded on October 18, 2026 when Feature 11A was committed as `fad2341`. It read as follows.)*

Feature 11A is implemented and verified on the isolated test database and awaiting user review; it is not committed. It adds automated retrieval from the verified official API and feed sources:

- **Sources:** Greenhouse, Lever, Ashby and SmartRecruiters (employer ATS), plus Remote OK, We Work Remotely, Himalayas and Working Nomads. Each was verified against one approved live response and a small committed fixture. Adzuna is listed but stays disabled until it is verified.
- **`/sources`:** add, configure, enable or disable a source, Run now, view run history, remove (archived when it has history) or restore. Sources start disabled and run every 12 hours once enabled.
- **Discovery:** only listings whose title contains a Customer Success core or adjacent role-family term are kept. The complete description and raw source data are preserved.
- **Deduplication across sources:** exact duplicates are attached (engine `core-dedup-v2`, with source-scoped listing IDs) and possible duplicates are flagged. An employer-ATS application link replaces an aggregator's, and a link you entered is never replaced.
- **Re-retrieval:** an unchanged listing only updates last-seen times. A changed listing is kept as a linked new version, shown as "Listing changed since first seen", while the original description stays.
- **No automatic evaluation:** retrieved jobs arrive unevaluated, and evaluation stays your choice within the budget.
- **Safety:** an identifying User-Agent, a 20 s timeout, a 10 MB response ceiling, at least 1 s between requests to a host, a stop on 429 or 403, and one retrieval worker at a time.

Feature 11B (the verified public/guest-endpoint and public-HTML sources) follows as a separate acceptance unit.

*(Earlier status, superseded on October 18, 2026 when the gap closure was committed as `d573acf` on October 17. It read as follows.)*

The Features 1–10 Gap Closure is implemented and verified on the isolated test database and awaiting user review; it is not committed. It followed a read-only audit of features 1–10 (October 17, 2026) and closes these gaps:

- **Feature 9, deduplication with provenance retention:**
  - an exact duplicate capture (same listing URL, or the same job ID at the same company) is added to the saved opportunity as another source instead of becoming a second opportunity;
  - a possible duplicate is flagged for review and never merged;
  - "Not the same job" decisions are reversible.
- **Feature 10:** a paid evaluation, or a deferred resume, is refused when an exact duplicate already has an evaluation or a pending request. The check is serialized, so simultaneous requests cannot both pay.
- **Features 2 and 8:** company names are normalized and reused, so the dashboard company filter treats spellings of one company as one company. An explicit, additive `pnpm db:backfill-dedup` covers existing data; it is not run automatically.
- **Feature 3:** evaluation-history rows show the profile and evaluator versions behind them.
- **Feature 6:** an optional stated time-zone requirement, never read from the job text and withheld from the evaluator.
- **Feature 7:** AI usage and spend by domain and source on `/budget`.
- Phone-width layout fixes on the opportunity page and `/profile`.

The Task 1–9 completion pass and the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update are complete. *(Earlier status, superseded on October 17, 2026: "No main-product implementation task is open … The next step is an audit of any remaining gaps in features 1–10.")*

### Evaluator acceptance state

The evaluator routing policy is locked on the evaluator branch.

The main-product branch runs its own unit, DB-backed integration and E2E suites with deterministic fixtures on every task. What stays deferred until all intended main-product work is complete:

- DB-backed and E2E acceptance of the merged evaluator contracts;
- whole-product acceptance;
- any final live provider verification;
- measurement of the current-contract evaluation cost.

## Next Main-Product Work

Task 8 and Task 9 are complete. In order:

1. Done: the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update (Core AI Framework PRD v1.5, Customer Success PRD v1.4, Core Platform TDD v1.6, Customer Success TDD v1.4, Semantic Evaluation Playbook v1.3).
2. Done: the Features 1–10 Gap Closure (`d573acf`, October 17, 2026). *(Earlier step: "Now: the Features 1–10 Gap Closure. The audit is complete; the implementation is verified and awaiting review, then the versioned-specification check and the commit.")*
3. Done: Feature 11A (`fad2341`, October 18, 2026), with Core AI Framework PRD v1.7, Customer Success PRD v1.6, Core Platform TDD v1.8 and Customer Success TDD v1.6. *(Earlier step: "Now: Feature 11A, implemented and verified, awaiting review.")*
4. Done: Feature 11B (`2a1d8c2`, October 18, 2026), with Core AI Framework PRD v1.8, Customer Success PRD v1.7, Core Platform TDD v1.9 and Customer Success TDD v1.7. *(Earlier step: "Now: Feature 11B, implemented and verified, awaiting review.")*
5. Done: Feature 12 (`f10a02b`, October 18, 2026), with Core AI Framework PRD v1.9, Customer Success PRD v1.8, Core Platform TDD v1.10 and Customer Success TDD v1.8. *(Earlier step: "Now: Feature 12, source health and conservative retrieval, implemented and verified, awaiting review.")*
6. Now: Feature 13, posting history and listing removal, implemented and verified, awaiting review. Its versioned-specification check is done (Core AI Framework PRD v1.10, Customer Success PRD v1.9, Core Platform TDD v1.11, Customer Success TDD v1.9).
7. Build the rest of main-product features 14–18:
   - browser extension companion;
   - source intelligence;
   - job-market analytics;
   - personal job-search analytics;
   - company intelligence.
8. Only after features 1–18 are complete: deliberate evaluator/product integration (including the decision on how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons (see below).

Retrieval flow:

```text
Job Sources
→ Retrieval / Scraping
→ Normalization
→ Deduplication
→ Existing Evaluator
→ Apply / Review / Skip
```

The retrieval layer should feed the existing evaluator rather than redesign it.

## Awaiting Final Integration or Acceptance

These happen only at the final evaluator/product integration, after features 1–18 are complete:

- merging the evaluator branch: routing lock, October 10–13 contract repairs, Milestone 4 alignment;
- removing the five released Task 7 fields from `fieldsWithheldFromEvaluator`;
- the open Codex reviews listed in `HANDOFFS.md`;
- the `Recommendation.evidenceReferences` drift decision;
- full DB-backed, E2E and live acceptance of the integrated evaluator;
- current-contract cost measurement;
- the evaluator freeze and the deliberate merge.

## Later Add-ons Only

The following are not part of main-product acceptance:

- company watchlists;
- proactive notifications/follow-ups;
- calendar integration;
- email integration;
- application assistance such as resume tailoring, cover letters, application questions, interview preparation, and skills-gap/learning assistance.

Beyond the Customer Success product:

- additional domain assistants;
- additional deferred features defined in the authoritative PRDs/TDDs.

## Current Boundaries

- Core remains domain-neutral.
- Customer Success owns its salary thresholds and affordability policy.
- Retrieval must feed the existing normalization/dedup/evaluator boundary rather than create a second evaluator.
- The browser extension is a companion to the same application, backend, data, evaluator, lifecycle, provenance, budget, and dashboard.
- Paid provider calls require explicit authorization.
- Experiments/tests must not use the normal application database without explicit authorization.
- Historical milestone/status documents should remain truthful history; current-state documents should reflect the latest accepted implementation.
