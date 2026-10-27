# AI Career Platform

**Last updated:** October 18, 2026

A modular AI-assisted career platform for discovering, evaluating, and prioritizing opportunities using transparent, evidence-based reasoning.

The platform is designed to support multiple domain-specific assistants on top of a shared Core AI Framework. The first implemented domain is the **Customer Success AI Assistant**.

## What the Product Does

The platform is built to help users evaluate opportunities based on the actual work described in a listing rather than relying only on job titles or keyword matching.

At a high level, the platform is designed to:

- collect or accept opportunity data;
- normalize opportunities into a common internal format;
- evaluate opportunities through domain-specific pipelines;
- preserve supporting evidence, Unknowns, and contradictions;
- generate transparent recommendations;
- store evaluation history and results;
- support future discovery, deduplication, analytics, and additional domain assistants.

The current working Customer Success flow supports:

```text
Manual Opportunity
→ Persistence
→ Background Evaluation
→ Customer Success Evaluation Pipeline
→ Deterministic Final Recommendation
→ Persisted Apply / Review / Skip Result
→ Results UI
```

Future automated opportunity ingestion will feed the same existing evaluation pipeline:

```text
Job Source(s)
→ Retrieval / Collection
→ Normalization
→ Deduplication
→ Existing Evaluator
→ Apply / Review / Skip
```

## Customer Success Assistant

The Customer Success Assistant evaluates whether a role aligns with the user's career strategy, experience, preferences, and long-term goals.

Its evaluation considers:

- hard filters such as role relevance, location, salary, and travel;
- the actual responsibilities described in the job description;
- company alignment;
- organizational maturity;
- personalized fit;
- burnout risk;
- resume match and transferable experience;
- effective seniority;
- opportunity priority;
- ghost-job risk when sufficient posting-history evidence exists.

The final recommendation is one of:

- **Apply**
- **Review**
- **Skip**

The system does not rely on a single Overall Match score or a simple weighted average to make the final recommendation.

## Evaluation Principles

The evaluator follows several core rules:

- **Evidence first.** Important conclusions should be traceable to supporting evidence.
- **Unknown stays Unknown.** Missing information is not converted into an assumed positive or negative.
- **Substance over buzzwords.** The evaluator reconstructs responsibilities, workflows, ownership, and operating models rather than rewarding expected terminology.
- **Deterministic where possible.** Explicit rules such as salary thresholds, posting-age guidance, and recommendation precedence remain application logic.
- **Semantic analysis where needed.** AI is used for interpretation-heavy work such as responsibility reconstruction, ownership analysis, operating-model inference, transferable-experience comparison, and contradiction detection.
- **Preserve contradictions.** Conflicting signals are surfaced rather than silently resolved.
- **Transparent recommendations.** Apply / Review / Skip should be explainable from the underlying evidence and rules.

## Normalized Opportunity and Evaluator Boundary

Core owns factual collection, normalization, persistence, and provenance. Domain modules decide how those facts affect recommendations.

The normalized Opportunity contract now supports factual fields including:

- salary minimum and maximum as stated;
- currency;
- original salary text;
- location and work arrangement;
- employment type, seniority (and its stated label), department (inert since October 26, 2026: not a user-facing field), and closing date;
- `residencyRequirement` (`US_REQUIRED`, `NON_US`, or Unknown);
- `residencyRegions` using supported country/subdivision/region codes.

Normalization never persists FX-converted salary amounts and never derives residency from currency, company headquarters, citizenship, work authorization, time zone, or ordinary city text. Missing or ambiguous information remains Unknown. Field provenance remains attached to normalized facts.

**Job-text fallback (Core Platform TDD v1.15 §51).** Structured and user-stated values come first. When a source supplies none for an already-supported fact, Core's shared normalization (`readJobTextFacts` in `packages/normalization`) reads it from explicit statements in the posting's own text. That reader is one and the same for manual entry, every retrieval adapter and the browser extension, and adapters and the extension never parse these facts themselves. A page-based collector may add bounded neutral page context (the browser extension's `pageTitle`, and `pageText`: the job's own page content beside a structured description). Page context is read only through labelled values, with `pageContext:*` markers.
- **What it reads:** labelled lines and bounded job-specific constructions only.
- **Conflicts:** conflicting statements stay Unknown.
- **Provenance:** values are DETERMINISTIC with `rawText:*` markers, or `pageContext:page-title-company` for a company read from the page title.
- **Never:** it never overwrites a value and never infers a time zone from a place. A stated compensation range keeps its numbers whatever its basis, with `compensationBasis` (BASE / OTE; OTE wording takes precedence over a mention of base, and the description's statement of the same range as OTE also counts), in its original currency; whether an OTE range counts as base salary is evaluator policy (October 25, 2026; it previously never flattened OTE into base salary by leaving the bounds Unknown). Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility.
- **Bare "$":** USD only with clear U.S. evidence; otherwise the currency stays Unknown. An explicit country in a full location settles an ambiguous region abbreviation ("Sunnyvale, CA, United States"; `readLocationGeography`).

**Final cross-source batch (October 27, 2026).** The same contract, completed from the final human retest:
- **Page metadata** is read with or without a colon ("Job type Full-Time"), each value checked as its kind, without layout separators, and with split ranges rejoined; colon-less labels are never read in the description.
- **Pay:** labelled regional tiers are a normalized fact (`Opportunity.compensationTiers`: label, amounts, currency each), shown as the Salary side by side; variable pay stated on its own is `bonus`; rounded and exact statements of one range agree; a stated annual equivalent of hourly pay is the range; a U.S. work-authorization requirement is U.S. context for a bare "$". Both new facts are withheld from the evaluator.
- **Location and arrangement:** an arrangement-only labelled location states the arrangement; a more precise labelled location replaces the source's; a default worldwide remote place never replaces a stated location.
- **Extension collection:** the posting's own heading over a careers-site title; microdata pay; the page's full description over a shortened structured copy; apply links in the job's own header or footer, with typographic apostrophes, one destination per address.

**Cross-source correction (October 26, 2026; Core Platform TDD v1.15 §51).** One contract across every source; a source-specific reader only maps what a site exposes into these generic facts.
- **Remote-hiring geography:** `sourceFacts.remoteLocations` comes from JobPosting `applicantLocationRequirements` (extension), Wellfound's accepted remote locations and Himalayas' location restrictions. It makes a remote role's location "Remote (<places>)" and its eligible geography. An office in a remote posting's data is never the location.
- **Weaker readings:** a posting's statement that the remote role is based somewhere ("U.S.-based … remote role") reads as eligibility (`rawText:explicit-remote-base-statement`), and any explicit eligibility statement replaces it; an ordinary job or office location never sets eligibility. A posting's labelled location that contains the source's location and states more is the fuller statement of the same fact. One that names another place never replaces the source.
- **Compensation:** one range with its own OTE or breakdown detail is that range. Regional tiers, each labelled with its place or zone, have no single range, even over a source field; they are kept as the salary text with their labels, with their shared currency if they have one. The Salary field shows Unknown for them.
- **Other facts:** time-zone preferences are kept, and a Pacific-to-Eastern span is geography. A source's stated posting age is dated at day precision and marked. The stated seniority label is kept in `seniorityLabel`, withheld from the evaluator. A labelled requisition ID is read. Several stated arrangements ("Office or Remote", "Remote or Hybrid") are kept in `workArrangements`, in order, with `remoteStatus` null; one to four office days a week is hybrid. An approximate posting date is withheld from the evaluator subject.
- **Page context:** the extension sends it one visible item per line with every non-LinkedIn description. Core reads labelled values and whole metadata items (a salary, an employment type, an arrangement or cadence, a seniority label, a country list, a posting age) from it.
- **Extension collection:** JobPosting microdata, structured data without a description, the job's own container (never another job's `<article>`), other-jobs lists excluded, application page above `directApply`, and the LinkedIn criteria list and posted age.
- **Unchanged:** adapter content hashes, deduplication logic and the evaluator.

Work authorization is a normalized fact (October 25, 2026): the stated requirement and its countries, sponsorship, relocation and employer-of-record countries, for any country, never read as residency. What it means for the user is decided by a separate relevance layer (`workAuthorizationRelevance` in `packages/core/src/eligibility.ts`, with the user's `UserEligibility`), never by normalization and never as evaluator input. The application URL carries its basis in provenance on every path (`applicationUrlProvenance`), and the posting page counts as the application page only on explicit evidence.

Customer Success salary thresholds, affordability policy, and recommendation consequences remain inside `domains/customer-success`; they are not Core rules. With Customer Success Milestone 4 (`267124f` on `codex/evaluator-live-diagnostic`), the evaluator consumes salary minimum/maximum, currency, residency requirement, and residency regions. Work arrangement, seniority, department, employment type, and closing date remain withheld from the evaluator until separately adopted through a coordinated contract change.

**Branch state:** that release is not yet merged. On `claude/gallant-pasteur-y1ou3i`, `fieldsWithheldFromEvaluator` in `loadSubject()` still withholds all ten Task 7 fields; the five released fields are removed from that list (and its tests updated) at final branch combination.

**Compensation basis (October 25, 2026; Codex, uncommitted on `codex/evaluator-live-diagnostic`, not merged):** the evaluator side of the Feature 14B contract is complete there, as Hard Filters `cs-hard-filters-v3` and salary policy `cs-salary-policy-v3-ecb-2026-10-14`, with thresholds, prompts, models and routing unchanged.
- **Basis:** it consumes `compensationBasis` (exactly `BASE` | `OTE` | `null`). `BASE` and `null` are evaluated normally; `OTE` keeps its normalized bounds but makes salary eligibility Unknown unless separate base-salary evidence exists.
- **Currency:** it reads the currency Core normalized, keeps FX conversion internal and does not repeat Core's bare-"$" rule.
- **Residency:** residency selects the policy branch. Work-authorization facts and `UserEligibility` never reach it.
- **Integration:** it reads the basis through a temporary compatibility boundary, replaced by the native Core field at integration, when `compensationBasis` also leaves `fieldsWithheldFromEvaluator` here. Core's side is settled (Feature 14B v5): OTE wording takes precedence over a "base" mention in the same statement, and a source-stated range is `OTE` when the description states that same range as OTE (`onTargetStatementFor`), so an OTE range never reaches the evaluator as `null`.

## Current Evaluator Architecture

The Customer Success evaluator uses ordered semantic and deterministic stages.

Current accepted semantic model routing:

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
| Ghost Job Risk | Deterministic Unknown when posting-history evidence is insufficient |
| Final Recommendation | Deterministic application logic |

Model routing is treated as an execution detail. It does not change the meaning of the domain schemas, stage outputs, evidence rules, Unknown handling, contradictions, or recommendation behavior.

The GPT-6 Luna routes for Company Alignment and Burnout Risk are implemented on `codex/evaluator-live-diagnostic`; `claude/gallant-pasteur-y1ou3i` keeps the earlier accepted GPT-5.6 Luna routes for both until final branch combination.

## Current Development Status

### Implemented / established

- shared Core evaluation framework and PostgreSQL-backed product foundation;
- background evaluation processing and persisted evaluation history;
- ordered Customer Success evaluation stages with evidence tracking, Unknown and contradiction handling, and structured semantic outputs and validation;
- deterministic recommendation logic;
- semantic usage and estimated-cost accounting;
- per-operation model routing;
- Customer Success results interface with bounded evaluation polling and status handling and safe rendering of untrusted job-description content;
- manual opportunity ingestion with raw-source preservation, deterministic normalization, and provenance;
- opportunity dashboard, search/sort/filter, lifecycle actions, evaluation history, profile/version management, AI usage/cost display, and budget controls;
- application tracker, complete after the Task 8 completion pass (`534a4c7`);
- setup and operations tooling, single-worker evaluation processing, honest queue states, and whole-product acceptance tests (original Task 9 work), complete after the Task 9 completion pass (October 16, 2026);
- deduplication with provenance retention for captured listings (an exact duplicate is added to the saved opportunity as another source; a possible duplicate is flagged and never merged), a serialized guard against paying twice for one listing, and normalized company names (Features 1–10 Gap Closure, `d573acf`);
- automated retrieval from the verified official API and feed sources (Greenhouse, Lever, Ashby, SmartRecruiters, Remote OK, We Work Remotely, Himalayas, Working Nomads): sources managed on `/sources` and disabled until enabled, title-only Customer Success role-family discovery, cross-source deduplication with employer-link preference, changed-listing observations, and no automatic evaluation (Feature 11A, `fad2341`);
- automated retrieval from the verified public/guest-endpoint and public-HTML sources (Workday career sites, the Workable job search, the Wellfound role page) through the same path; Welcome to the Jungle / Otta registered but not enabled (Feature 11B, `2a1d8c2`);
- source health and conservative retrieval: escalating backoff after source failures (capped at 7 days), a source's Retry-After honoured in full, any 5xx stopping a host for the run, no in-run retries or automatic disabling, derived health and freshness on `/sources`, Run now that cannot override a rate limit or requested wait, and read-only doctor warnings (Feature 12, `f10a02b`);
- posting history: listing coverage recorded before the title filter, removal confirmed only by complete boards (Greenhouse, Lever, Ashby; Workday and SmartRecruiters when their stated total is read exactly), a listing ledger per tracking-scope generation, reappearance, a "Posting history" section, a "No longer listed" dashboard badge, and evaluator-shaped facts withheld from the evaluator (Feature 13, `d1bf217`);
- persistent monthly AI budget ledger, atomic reservation/reconciliation, deferral/resume/cancel flow, warnings, and throughput/token limits;
- Task 7 normalized salary/currency/position/residency contract;
- Customer Success nine-stage evaluator plus deterministic Final Recommendation;
- Resume Match Optimization #2 and JD Reconstruction State2 accepted;
- final routing policy locked (GPT-6 Luna routes on `codex/evaluator-live-diagnostic`; not yet merged);
- Customer Success Milestone 4 aligned to Task 7 salary/currency/residency facts at commit `267124f` on `codex/evaluator-live-diagnostic` (not yet merged), with the October 25 compensation-basis correction (`cs-hard-filters-v3`, `cs-salary-policy-v3-ecb-2026-10-14`) completed uncommitted on that branch's worktree;
- evaluator semantic-contract repairs of October 10–13 (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`, `cs-organizational-maturity-v7`) on `codex/evaluator-live-diagnostic` (not yet merged; the main-product branch still runs `cs-jd-reconstruction-v3`, `cs-resume-match-v2` and `cs-organizational-maturity-v6`).

### In progress

- Feature 14B, the browser-extension companion, is committed (`e6bacc6`, October 20, 2026) and stays open (Feature 14 is not complete until it is accepted). Its local acceptance led to the approved shared-Core job-text fallback correction, implemented and verified October 23, 2026, awaiting review and not committed. It is a source-collection boundary only: captures enter retrieval ingestion with `BROWSER_EXTENSION` provenance, and evaluation is only ever the user's explicit request through the existing path.
- Feature 14A is complete (`dd77d29`, accepted October 20, 2026; LinkedIn stays unverified and disabled after its local adapter check met HTTP 429 on a job page): a reusable browser-assisted runner (a fresh logged-out Playwright/Chromium context per run, navigation only, sequential at least 5 seconds apart, page budgets, timeouts and a page-size limit, a stop with no further request on any 403, 429, 999, sign-in wall, authwall, checkpoint, CAPTCHA, challenge or account cookie, handed to Feature 12 backoff); the LinkedIn adapter for public, logged-out job search and job pages, with separate discovery and detail budgets and a pending queue of discovered matches kept in the `RetrievedListing` ledger (unverified: the Claude cloud check met HTTP 429 and an anti-bot interstitial and stopped as designed; a local logged-out browser check loaded normal public results, and the exact adapter's local check discovered 60 public jobs, then the first job page answered HTTP 429, so the source stays unverified and disabled); We Work Remotely on its all-jobs RSS feed; Wellfound at 12 seconds between requests; Welcome to the Jungle / Otta is reclassified as public logged-out webpage retrieval (no public jobs API) and stays an unverified candidate: its tested public surfaces expose no usable job records (the search page has no listings; the company jobs page, reachable logged out from a local browser though the Claude cloud browser got a CloudFront 403, renders only a job count and "no jobs found"). No migration. The browser-extension companion is Feature 14B, not part of 14A.
- Feature 13 is complete (`d1bf217`, October 19, 2026): pre-title-filter listing coverage, the removal-capable source matrix with exact stated totals, the `RetrievedListing` ledger with opaque tracking-scope generations and a HISTORICAL baseline, the removal and reappearance rules, posting-history facts withheld from the evaluator, and the opportunity-page and dashboard display.
- Feature 12 is complete (`f10a02b`, October 18, 2026): the `SERVER_ERROR` code and a host stop after any 5xx, Retry-After on the transport, one backoff gate per source (`RetrievalSource.nextEligibleAt`, with `RetrievalRun.retryAfterUntil`), derived source health, Run now's gate rules and doctor warnings. Listing expiry/removal detection moved to feature 13.
- Feature 11B is complete (`2a1d8c2`, October 18, 2026): the Workday, Workable and Wellfound adapters, a JSON POST transport method and source-specific request intervals and page caps; Welcome to the Jungle / Otta registered but unverified.
- Feature 11A is complete (`fad2341`, October 18, 2026): the collection framework, eight verified official API/feed adapters, the retrieval worker and `/sources`, title-only role-family discovery, cross-source deduplication (`core-dedup-v2`), canonical-link precedence and changed-listing observations.
- The Features 1–10 Gap Closure is complete (`d573acf`, October 17, 2026).
- The features 1–10 gap audit, Task 8, Task 9 and the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update are complete (Core AI Framework PRD v1.5, Customer Success PRD v1.4, Core Platform TDD v1.6, Customer Success TDD v1.4, Semantic Evaluation Playbook v1.3).

### Main-product work still required before final acceptance

- feature 14B — browser extension companion (committed `e6bacc6`; its shared-Core normalization correction awaits review; Feature 14 is not complete until it is accepted);
- source intelligence;
- job-market analytics;
- personal job-search analytics;
- company intelligence;
- only after all main-product features 1–18 are complete: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

### Later add-ons only

- company watchlists;
- proactive notifications/follow-ups;
- calendar integration;
- email integration;
- application-assistance features such as resume tailoring, cover letters, application questions, interview preparation, and learning recommendations.

Beyond these add-ons, additional domain assistants remain planned on the same Core platform.

## Architecture

The shared platform is designed as a modular monolith with clear boundaries between platform infrastructure and domain-specific evaluation logic.

High-level architecture:

```text
Sources
→ Collection
→ Normalization
→ Deduplication
→ Domain Evaluation
→ Evidence Validation
→ Recommendation
→ Storage
→ UI
→ Analytics
```

The Core Platform remains domain-agnostic.

Domain assistants provide their own:

- evaluation criteria;
- hard filters;
- user preferences;
- scoring semantics;
- prompts;
- schemas;
- recommendation rules;
- domain-specific result presentation.

The Customer Success Assistant is the first reference implementation.

## Technology Stack

Current design targets:

- **Frontend:** React + TypeScript
- **Web framework:** Next.js
- **Backend/API:** Next.js server/API layer
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Validation:** Zod / JSON Schema
- **Background processing:** lightweight worker / queue architecture
- **Testing:** Vitest / Jest + Playwright
- **Browser-assisted retrieval:** Playwright (`playwright-core`) driving headless Chromium, logged out, retrieval worker only (feature 14)
- **Browser extension:** TypeScript + Chrome Manifest V3, bundled with esbuild, loaded unpacked (Feature 14B; `apps/extension`)
- **Version control:** Git

The project intentionally avoids unnecessary infrastructure complexity while the core workflow is being completed.

## Documentation

Authoritative product and technical documentation includes:

- **Core AI Framework PRD** — defines what the shared platform should do.
- **Core Platform TDD** — defines how the shared platform implements those requirements.
- **Customer Success AI Assistant PRD** — defines the Customer Success product requirements.
- **Customer Success Assistant TDD** — defines the executable Customer Success technical design.
- **AI Career Assistant Semantic Evaluation Implementation Playbook** — preserves evaluator implementation safeguards, testing lessons, routing guidance, and optimization rules.

The following repository documentation also exists (paths are listed in the "Documentation Locations" table in `AGENTS.md`):

- Milestones 1–10;
- current product status;
- evaluator status;
- development plan;
- active workstreams;
- current progress;
- future agent handoffs.

## Development Priorities

The current development order is:

1. keep the evaluator stable and make only demonstrated evaluator-sensitive corrections;
2. the Task 1–9 product completion pass is complete (Task 8 and Task 9 complete); the post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete; the features 1–10 gap audit, the Features 1–10 Gap Closure, Feature 11A, Feature 11B and Feature 12 are complete, Feature 12, Feature 13 and Feature 14A are complete, and Feature 14B (the browser-extension companion) is next;
3. build any still-missing main-product features through feature 18, including retrieval and analytics/intelligence;
4. only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge;
5. add features 19–23 later.

The retrieval layer must feed the existing evaluator rather than redesign it. The browser extension (Feature 14B) is a companion client to the same backend/data/evaluator/dashboard, not a separate product.

## Local Development

The repository-root `README.md` ("Local Development") is the authoritative operator guide for prerequisites, first-time setup, environment variables, normal startup (the web app and exactly one worker), test-only setup and the deterministic test workflow, worker/queue behavior, troubleshooting, and health checks.

Use the repository scripts documented there, including `pnpm app:setup` for setup and `pnpm app:doctor` for the read-only environment/health diagnostic. Do not duplicate machine-specific WSL paths or credentials in this architecture document.

Testing rules:

- unit tests may use deterministic/fake transports;
- DB-backed integration/E2E work must use the designated isolated test database/environment;
- never use, reset, seed, migrate, clean up, or otherwise modify the normal application database for experiments or tests without explicit authorization;
- real semantic evaluations can incur provider charges and require explicit authorization for paid diagnostic/acceptance work.

Operational notes:

- Playwright starts its own Next.js dev server **unless one is already running on port 3000** (`reuseExistingServer` outside CI); stop your own `pnpm dev` before E2E runs.
- Migrations are applied with `pnpm db:migrate` (`prisma migrate deploy`); `pnpm db:verify-migrations` checks a clean apply against a temporary database.
- No machine-specific paths are required (earlier notes referenced a personal WSL path).

### Historical development-environment notes (Windows/WSL, August 2026)

Restored from the earlier version of this document (removed in the Task 9 operations update on October 7, 2026). These are permanent implementation lessons, not setup requirements. The personal WSL path from the original notes is intentionally omitted.

- Development was performed through Ubuntu/WSL against a Windows-mounted repository.
- WSL is not established as a repository requirement.
- The worker was corrected to use an async `main()` rather than top-level `await`, allowing it to load under the project’s Node.js 24, Windows, pnpm, and `tsx` configuration.
- A machine-specific Node.js 24/`tsx` error was occasionally encountered with temporary one-off test harnesses:

```text
uv_os_get_passwd returned ENOMEM
```

This was handled with a temporary preload workaround. It has not been established as a requirement for the normal web or worker commands and should not be presented as standard setup.

- Playwright previously timed out while launching its web server. The current configuration fixes this by launching Next.js directly from `apps/web` on `127.0.0.1`. Do not reintroduce the old `pnpm dev` Playwright child-process configuration without retesting it.
- Run shell commands on separate lines. Combining commands accidentally produced invalid commands such as `HEADgit` and `statusgit`.

## Repository Structure

```text
apps/
  web/                 Next.js application and server-side worker/API code
  extension/           Browser-extension companion (Feature 14B; Manifest V3, loaded unpacked)

database/
  prisma/              Prisma schema and migrations
  src/                 PostgreSQL repositories and database client

domains/
  customer-success/    Customer Success schemas, extraction and evaluation logic

packages/
  core/                Domain-neutral opportunity and platform contracts
  evaluation/          Evaluation runner, stages and semantic executor
  evidence/            Evidence contracts
  normalization/       Opportunity normalization
  shared/              Environment and shared server configuration
  discovery/           Collection framework and source adapters (features 11A and 11B; feature 12 stop rules; feature 13 listing coverage; feature 14 browser session and LinkedIn)
  browser-retrieval/   Logged-out Playwright/Chromium driver for browser-assisted sources (feature 14; retrieval worker only)
  deduplication/       Domain-neutral deduplication package

tests/
  unit/
  integration/
  e2e/
```

### Additional architecture notes

- This is a private pnpm monorepo.
- Core remains domain-neutral; Customer Success rules live under `domains/customer-success`.
- Manual opportunities are normalized and persisted in PostgreSQL.
- Retrieved listings (features 11A and 11B) are collected by the single retrieval worker from sources enabled on `/sources`, through an injectable transport with politeness and size limits; feature 12 adds a backoff gate per source, written with each run's outcome, and source health derived from run history (`packages/core/src/retrieval-health.ts`); feature 13 records each listing's sightings, confirmed removal and reappearance in `RetrievedListing` and derives posting-history facts (`packages/core/src/posting-history.ts`), which are not passed to the evaluator; feature 14 adds a fresh logged-out browser per run for browser-assisted sources (LinkedIn) and keeps their discovered-but-not-yet-read matches as pending ledger rows. They are normalized and deduplicated in the same capture transaction as manual captures and arrive unevaluated.
- Evaluation tasks are stored in PostgreSQL and processed by the background worker.
- Semantic results use strict structured outputs, schema validation, evidence-reference validation, Unknown preservation, contradiction preservation, and bounded retry/call budgets.
- Provider calls and retries persist model, prompt version, token usage, pricing version, estimated cost, status, and duration.
- Production supports per-operation model routing with no automatic Luna-to-Terra fallback.
- Current routing uses GPT-5.6 Terra for JD Reconstruction and Resume Match; GPT-5.6 Luna for Job Evaluation, Organizational Maturity, Alex Fit, and Opportunity Priority; and GPT-6 Luna for Company Alignment and Burnout Risk (the GPT-6 Luna routes are on `codex/evaluator-live-diagnostic` until final integration).
- Ghost Job Risk remains deterministic `UNKNOWN` when objective posting-history evidence is unavailable.
- Final Apply/Review/Skip recommendation logic is deterministic.
- Unit tests and normal fake-provider integration flows do not require live OpenAI calls.
- Real evaluations can incur API charges and send the configured job description, company/opportunity data, profile-derived evidence, preferences, and intermediate stage results to OpenAI.


### Source retrieval methods (feature 14)

Each source uses the least intrusive method that works. The labels below describe how a source is read, not a claim about any source's terms; the adapter's own `retrievalType` keeps the established categories (for example `PUBLIC_GUEST_INTERNAL_ENDPOINT` for Workday and Workable).

| Method | Sources | Notes |
| --- | --- | --- |
| Official API or feed | Greenhouse, Lever, Ashby, SmartRecruiters, Himalayas, Remote OK, We Work Remotely, Adzuna | We Work Remotely: the all-jobs RSS feed (`remote-jobs.rss`) with the local title filter; Adzuna only once credentials exist and it is verified (disabled) |
| Public feed | Working Nomads | The public `exposed_jobs` JSON feed (labelled an official public feed in code); the site's internal `/jobsapi/_search` is not used, intercepted or replayed |
| Public structured data, no browser | Workday, Workable | Workday tenant career-site JSON; Workable's anonymous search JSON (not its large XML feed) |
| Public data embedded in a webpage | Wellfound | The role page's embedded state; at least 12 seconds between requests, sequential |
| Browser-assisted, public and logged-out | LinkedIn | Fresh logged-out Chromium context per run; navigation only; stops on any access friction; a sign-in modal over visible results is not a block; unverified and disabled (the Claude cloud check met HTTP 429 and an anti-bot interstitial; the local adapter check discovered public jobs, then a job page answered HTTP 429) |
| Public logged-out webpage (candidate) | Welcome to the Jungle / Otta | No public jobs API; unverified: the search page has no listings in its HTML; the company jobs page needs JavaScript and, rendered in a local browser, showed a job count but no job records; the Claude cloud browser got a CloudFront 403 (environment-specific) |
| Browser extension, on request (Feature 14B, awaiting acceptance) | any job page the user is viewing and chooses to save | the user's own page view only; structured data, LinkedIn job-detail areas, the selection, or main content; same backend, data, evaluator and dashboard |

No adapter reads `robots.txt`; the conservative cadence, page caps, stop rules and Feature 12 backoff are the politeness controls today.

## Project Status

**Active development**

Task 7, the corresponding Customer Success Milestone 4 salary-policy alignment (on the evaluator branch), the Task 8 Application Tracker completion pass (`534a4c7`) and the Task 9 operations-hardening completion pass (October 16, 2026) are complete. The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete. The features 1–10 gap audit and the Features 1–10 Gap Closure are complete, Features 11A, 11B, 12, 13 and 14A (browser-assisted LinkedIn retrieval and source corrections, `dd77d29`) are complete, and Feature 14B (the browser-extension companion) is next; Feature 14 is not complete until it is accepted. Main-product features 15–18 follow 14B. Deliberate evaluator/product integration, full isolated verification, the evaluator freeze and the merge are intentionally deferred until the entire intended main product (features 1–18) is complete. Features 19–23 remain later add-ons.
