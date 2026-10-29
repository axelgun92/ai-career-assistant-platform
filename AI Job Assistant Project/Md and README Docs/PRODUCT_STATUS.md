# Product Status

**Project:** AI Career Platform / AI Job Assistant  
**Primary implemented domain:** Customer Success  
**Status:** Active development  
**Last updated:** October 20, 2026

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

Automated discovery is implemented for the verified official API and feed sources (Feature 11A, committed as `fad2341`) and for the verified public/guest-endpoint and public-HTML sources (Feature 11B, committed as `2a1d8c2`). Sources added on `/sources` start disabled; once enabled, the retrieval worker collects listings whose title matches a Customer Success role family and feeds them, unevaluated, into the same normalization, deduplication and evaluation path. Source health and conservative retrieval (Feature 12, committed as `f10a02b`) back a failing source off, honour a source's request to wait, and show each source's health and freshness. Posting history (Feature 13, committed as `d1bf217`) records where and when each retrieved listing was seen, confirms removal only from sources that show their whole board, and shows a listing that returns as listed again. Browser-assisted retrieval of public, logged-out LinkedIn job pages (Feature 14A, accepted as `dd77d29`) is built and tested, but the LinkedIn source stays disabled because LinkedIn rate-limited its job pages in the local check; We Work Remotely now reads its all-jobs feed. The browser-extension companion (Feature 14B, committed as `e6bacc6`) saves the job page you are viewing, when you ask, into the same application. It stays open: its acceptance led to shared-Core corrections (committed as checkpoint v7, `6536ef8`) and, after the final human cross-source retest, the final cross-source batch (October 27, 2026; committed), which awaits a small targeted live verification. *(Earlier: "the approved shared-Core correction is implemented and verified (October 23, 2026) and awaits Alex's review (not committed)".)* The manual workflow is unchanged and remains the stable foundation.

```text
Enabled source (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Remote OK, We Work Remotely, Himalayas, Working Nomads, Workable, Wellfound; LinkedIn once verified)
→ Retrieval worker (title-term filter, raw source preserved; a logged-out browser only for LinkedIn)
→ Deterministic normalization
→ Deduplication (attach, flag or create; employer link preferred; changes recorded)
→ Dashboard, unevaluated until the user requests an evaluation
```

*(Earlier wording, superseded on October 18, 2026: "Automated discovery is not yet complete, but the manual workflow remains the stable product foundation that later retrieval will feed. The current product can evaluate a manually entered job without automated retrieval.")*

**Branch note:** the main-product work described here is implemented on `claude/gallant-pasteur-y1ou3i`. The evaluator branch `codex/evaluator-live-diagnostic` carries three things not on the main-product branch:

- the October 15 evaluator routing lock;
- the October 10–13 evaluator semantic-contract repairs;
- the Milestone 4 salary-policy alignment, with its October 25, 2026 compensation-basis correction (uncommitted on the evaluator worktree).

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
- department (no longer a user-facing field since October 26, 2026);
- employment type;
- closing date;
- residency requirement;
- residency regions.

Unknown stays Unknown. Raw text and provenance remain preserved. Salary amounts are stored as stated and are not FX-converted in persistence.

**Job-text fallback (Feature 14B correction, October 23, 2026; awaiting review).**
- **When the source states nothing:** when the source supplies no structured or stated value, these facts, and the company, location, posting date and time-zone requirement, are also read from explicit statements in the job description itself. Examples: "This is a full-time, NYC-Hybrid position.", "Salary: $100,000–$120,000", "Anticipated role close date: 11/30/2026", "Must overlap Eastern Time business hours."
- **How:** one shared Core reader serves manual entry, automated retrieval and the browser extension alike. Facts a job source states in its own fields also reach it now: department, seniority or experience level, and Wellfound's compensation text. That covers Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Himalayas, LinkedIn and Wellfound.
- **Changes on a saved job page:** if a labelled detail on the page changes, the next capture is recorded as a change; layout or navigation changes are not.
- **Changed listings update the saved job (current-version projection, October 23, 2026; awaiting review).** When the listing a job was found from changes, the job shows the newest version's facts and description; a fact the newest version no longer states becomes Unknown.
  - Every earlier version and its provenance are kept, as history.
  - A copy of the job from another site never overwrites the facts.
  - A manually entered job is never changed by retrieval.
  - A value you corrected is kept until you change it.
  - Nothing is evaluated automatically. An earlier evaluation is kept and is tied to the listing version it evaluated, and the job page says when the listing has changed since, so you can reevaluate if you choose.
  - *(Before, a changed listing was kept as a linked version but the job's facts stayed as first seen.)*
- **Precedence and provenance:** a value the user stated or corrected, or a source's structured value, always wins. Text-derived values are marked in provenance as read from the text.
- **OTE:** OTE is never turned into base salary. *(Superseded October 25, 2026: a stated range keeps its numbers, marked as OTE or base salary when the posting says, in its original currency; the evaluator decides whether it counts as base salary.)*
- **Work authorization (October 25, 2026; awaiting review):** explicit work-authorization, citizenship, sponsorship, relocation and employer-of-record statements are captured for every job, separate from where candidates must live. Under "Work eligibility" on the profile page you record where you may work; a requirement you already meet raises no warning, and jobs in other countries whose requirements or sponsorship need a look (or state nothing) are marked "Check work eligibility".
- **Department and application link (October 25, 2026):** a stated team ("You'll join … Customer Success team") fills the department, and the application page is captured whenever the job shows one (an apply link, the page's own application form), with how it was found. *(October 26, 2026: Department is no longer shown, filtered on or entered; see below.)*
- **Cross-source correction (October 26, 2026; awaiting review and the cross-source live retest).** This follows from the live acceptance captures of every supported source.
  - **Remote roles:** a remote role's location is where the source says it may be done from ("Remote (United States)"), and that is its eligible geography. An optional office is never the role's location, and an ordinary job or office location never sets eligibility on its own. A posting's own fuller location statement ("Chicago Office or Remote, North America (US & Canada)") is kept over a narrower listing location it includes. Eligible states listed one per line are read, and "continental U.S." counts as the U.S.
  - **Pay:** one pay range stays readable beside its own OTE or base-plus-variable detail. Pay stated in regional tiers or zones is kept as stated, with no single range and no tier applied everywhere.
  - **Work arrangement:** several stated options are kept, in the posting's order ("Office or Remote" shows as "On-site / Remote"; "Remote or Hybrid" as "Remote / Hybrid"); the dashboard's arrangement filter finds the job under each option. Only ambiguous or conflicting statements stay Unknown.
  - **Other facts:** a stated time-zone preference is kept as a preference. A stated seniority label is kept as written ("Mid-Senior level", "Junior and Mid level"). A posting's stated age ("2 weeks ago") is dated approximately and shown as such. A labelled requisition ID ("JR115971") is read.
  - **Pages:** job-page details shown as separate items (salary, office days, seniority, employment type, posted age, "Visa Sponsorship: Not Available") are read. Lists of other jobs on the page (We Work Remotely's Related Jobs) are never part of the posting. A job's own application page outranks the posting page.
  - **Product decisions:** the opportunity shows **Salary**: the normalized range, or Unknown when there is none (several regional tiers included); the stated compensation text stays in the data and its provenance, not as a separate Compensation row. **Department** is no longer shown, filtered on the dashboard or entered manually; the data stays only for compatibility, and the evaluator never used it.
- **Final cross-source batch (October 27, 2026; committed; awaiting the targeted live verification).** From Alex's final human retest of every source:
  - **Pay:** labelled ranges for several zones or places are shown side by side as the Salary, each with its own currency, never merged ("Zone 1: 92,600–139,000 USD · Zone 2: 86,600–129,800 USD"). A rounded and an exact statement of one range agree (the exact one is kept). A bonus stated on its own is kept separately, never as the salary. Hourly pay with its stated annual equivalent gives the annual range. A "$" is US dollars with no other context (see Currency symbols below).
  - **Job pages:** details a page shows as "Job type Full-Time" or "Region United States" (no colon), or with layout separators ("Full Time /"), are read. A salary a page splits ("$80" / "-95k") is read whole. "Location: Remote" says Remote rather than naming a place; "United States (East Coast)" is kept over "United States".
  - **Statements now read:** "Fully remote work", Virtual First's "remote work is the primary experience", a labelled "Work Persona: Flexible or Remote" (Hybrid / Remote), "Full-Time, Non-Exempt (W2)", "EST or CST" or a required overlap with Pacific Time, "End Date:" and "This job posting will close …".
  - **The extension:** the posting's own title (never a careers site's own name), a SmartRecruiters page's pay and "I'm interested" link, the full description when a board's job data holds only a teaser, and no worldwide eligibility from a default "Anywhere" when the page states a location. The popup says when the evaluation shown is of an earlier version of the posting (after "Use my selected text instead").
  - **Shown:** the opportunity's requisition ID.
- **Live acceptance, round 2 (October 29, 2026; committed; live acceptance passed).** Verified by Alex through the installed Chrome extension, after tracing each case on his real stored captures and the real rendered pages:
  - **Location:** "📍 Locations (Remote): United States (East Coast)" is kept over a page header's "United States" (icons before labels are ignored; the more specific of two compatible places wins). No East Coast residency or Eastern time zone is inferred.
  - **Where to apply:** SmartRecruiters' "I'm interested" link is read (its hidden "Apply with Smartr" duplicates no longer make it ambiguous); on Remote OK the job's own Apply is read among other jobs' hidden expanded copies.
  - **Complete default captures:** We Work Remotely pages are read in full without highlighting (the posting body beside the header, the sidebar's facts, and the company from "Remote <title> at <Company>"); Workday's line-structured page description is used over its run-on JSON-LD copy, so "Able to work PST/MST hours" is read.
  - **Pay:** Workday's "Zone 1: $76,900 USD - $115,300 USD Applicable for: CA, …" zones show side by side; a posting's own range wins over a board's coarser salary bucket.
  - **Known, non-blocking:** Lever Bluesight's employment type; Jobs for Humanity's monthly pay; Remote OK Renaissance's short description (the page shows only that); NLBM's "Region: Anywhere" not shown as a location.
- **Live acceptance batch (October 29, 2026; committed; its live round led to round 2 above).** From Alex's latest full live round:
  - **Job pages:** a job's own sidebar ("About the job": job type, salary, region, posted) is read; a page header item such as "Full Time - Remote - In-person meeting attendance required" gives Full-time; "WORK STYLE – WFH or come to the office" gives Remote / On-site, even on a listing the site marks remote; "United States (East Coast)" is kept also when the page writes the place as "Remote, United States"; "USA Only", "Only US" and "Anywhere in the US" are U.S. places.
  - **Pay:** zones stated in one sentence (ServiceTitan) or as a label line and an amount line (Dropbox) show side by side as the Salary; "$85,000 - $90,000 with bonus potential up to $10,000" gives the range with the bonus apart. Monthly pay ("$1,500–$3,000 per month") stays Unknown as a salary, never annualized (product decision recorded).
  - **Where to apply:** the job's own Apply or "I'm interested" button is read in its sidebar, a sticky header that repeats the job, or a button that carries its address, and other jobs' Apply buttons on the same page no longer hide it (Remote OK, SmartRecruiters). On LinkedIn, the employer's Apply link and the posted age ("12 hours ago") are read also on pages with structured data.
  - **Dates:** Welcome to the Jungle's rolling listing expiry is no closing date.
- **Currency symbols (corrected October 27, 2026):** a recognized currency symbol is read directly as its currency ("$" US dollars, "€" euros, "£" pounds sterling, "₹" rupees, "¥" yen), with no geography or other context; a currency code or name the posting states ("$100,000 CAD", "Canadian dollars") takes precedence over the symbol. Two different stated currencies, or two different symbols with none stated, leave the currency Unknown. *(Superseded rule: "Bare "$": read as US dollars only when the job is clearly in the U.S.; otherwise the currency stays Unknown. A location that names its country settles a state abbreviation that could mean two places".)*

*(Before this correction, these facts were read only from structured or stated fields and never from the job text, and a bare "$" was always read as US dollars.)*

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

#### Compensation-basis correction (October 25, 2026, Codex; not merged)

Codex completed the evaluator side of the Feature 14B compensation-basis contract on `codex/evaluator-live-diagnostic`, over `267124f`. It is uncommitted on the evaluator worktree and not merged; the list above is its earlier `267124f` state, preserved as written.

Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility.

- **Basis:** `compensationBasis` is exactly `BASE` | `OTE` | `null`. `BASE` and `null` (an ordinary stated range) are evaluated normally. `OTE` keeps its normalized bounds untouched, but salary eligibility is Unknown unless separate confirmed base-salary evidence exists; that Unknown still points to the OTE evidence.
- **Thresholds:** unchanged (the bands above).
- **Currency and FX:** the evaluator reads the currency Core normalized and does not repeat Core's bare-"$" geography rule. FX conversion stays evaluator-only, and nothing converted is written back.
- **Residency and work authorization:** residency still selects the policy branch. Work-authorization facts, sponsorship, relocation, citizenship and `UserEligibility` are never evaluator input.
- **Identifiers:** Hard Filters `cs-hard-filters-v3`; salary policy `cs-salary-policy-v3-ecb-2026-10-14`. Semantic prompts, provider models and routing are unchanged.
- **Released to the evaluator there:** `compensationBasis`, in addition to the five fields above (`salaryText` is evaluator input on both branches). Until the native Core field exists on that branch, it reads the basis through a temporary compatibility boundary, which is replaced by the native Core field at integration. On `claude/gallant-pasteur-y1ou3i`, `compensationBasis` stays in `fieldsWithheldFromEvaluator` until then.
- **Core side, resolved October 25, 2026 (Feature 14B v5):**
  - OTE wording takes precedence over a "base" mention in the same statement: "$120,000 - $150,000 OTE (base + commission)" is `OTE`, not ordinary salary.
  - A source-stated range is also `OTE` when the job description states that same range as OTE.
  - See the integration contract in `HANDOFFS.md`.

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

Feature 14 has two parts and is not complete yet. **Feature 14B, the browser-extension companion, is committed as `e6bacc6` (October 20, 2026) and stays open.** Alex's local acceptance passed for the local fixture, LinkedIn (Incognito, logged out), Welcome to the Jungle and revocation. On Greenhouse, Lever and an employer careers page, it showed that the shared normalizers left facts stated only in the job description Unknown (company, location, salary, closing date, work arrangement). The approved correction is implemented and verified (October 23, 2026) and awaits Alex's review, then a minimal retest; it is not committed. It is a shared Core job-text fallback with a safer bare-"$" rule, and no extension- or site-specific parsing. **Feature 14A, browser-assisted retrieval and source corrections, is complete**: committed as `dd77d29` and accepted on October 20, 2026 (Feature 13: `d1bf217`). Features 15–18 follow 14B. Feature 14A:

- **LinkedIn (public, logged-out pages only):** a new source that reads LinkedIn's public job search and public job pages in a headless browser started fresh for each run, with no account, cookies, profile or stored state. It never signs in, applies, saves, follows or messages, and only opens and reads pages, one at a time and at least 5 seconds apart. Any refusal (HTTP 403, 429 or 999), sign-in wall, authwall, checkpoint, CAPTCHA or challenge ends the run, and the source waits through Feature 12's backoff; nothing is retried or worked around.
- **Discovery and details separately:** each run reads up to 4 search pages (at most 100 results; both adjustable within hard caps of 8 and 200) and keeps the Customer Success titles. It then opens at most 20 job pages (hard cap 25). Matches whose page has not been read yet are remembered and read first in later runs, oldest first, even after they leave the search; stored jobs are re-read only when last checked over a week ago. LinkedIn never confirms that a listing is gone.
- **Not enabled yet, but viable:** from the Claude cloud environment, LinkedIn answered the single automated check with HTTP 429 and an anti-bot page, so retrieval stopped there as designed. A separate logged-out check from a local browser loaded normal public results (about 11,000 Customer Success jobs in the United States, with titles, companies, locations and links), under a "Sign in to view more jobs" modal that did not hide them. So LinkedIn is not generally blocked: the cloud result is specific to that environment. The adapter's own check from the local runtime (October 20, 2026) found 60 public jobs on the search page, then the first job page answered HTTP 429 and the run stopped at once with no retry. That is LinkedIn limiting requests, not a fault in the product, so LinkedIn stays unverified and disabled. The source is listed on `/sources` but cannot be enabled until one logged-out check of a real search page and job page succeeds (`pnpm sources:verify linkedin`). It also needs `RETRIEVAL_BROWSER_EXECUTABLE` (a Chromium or Chrome binary) for the retrieval worker.
- **We Work Remotely** now reads its official all-jobs RSS feed and applies the Customer Success title filter itself, instead of one category feed; it never reads WWR's web pages.
- **Wellfound** requests are now at least 12 seconds apart (was 2), still one at a time from the page's embedded data.
- **Audited and unchanged:** Greenhouse, Lever, Ashby, SmartRecruiters, Himalayas, Remote OK, Working Nomads (its public `exposed_jobs` feed, not the site's internal search), Workday (tenant JSON) and Workable (anonymous JSON). Adzuna stays disabled until verified.
- **Welcome to the Jungle / Otta:** now treated as a public-webpage source (it has no public jobs API) rather than ruled out by its terms, but still not enabled, because no tested public page shows usable job records. Its public search page shows no listings. From the Claude cloud environment a browser load was refused (HTTP 403), but a local browser check loaded its public company jobs page without any block; that page needs JavaScript and, once rendered, showed a job count but "We didn’t find any jobs for your search", with no job details.
- **Feature 14B, the browser-extension companion (committed `e6bacc6`; normalization correction awaiting review):** a Chrome extension (`apps/extension`; `pnpm extension:build`, then load `apps/extension/dist` unpacked) that saves the job page you are viewing into your local AI Job Assistant, only when you ask it to.
  - **Before saving:** you see an editable preview and can correct the title, company, location or description; nothing is sent until you press Save.
  - **What it reads:** that one page's job posting: its structured job data; on LinkedIn, only the job-detail areas of a job page; the text you selected; or, except on LinkedIn, the page's main content. It never reads other tabs, history, cookies, or account, profile, messaging or feed content.
  - **Where saved jobs go:** into the same normalization, deduplication, provenance and lifecycle as every other source, shown as "Found via <site> (browser extension)". An unrecognised site is kept as the lowest-priority source and never replaces an employer or ATS link.
  - **Normalization:** Core's shared normalization fills facts the page states only in its text (company, location, pay, work arrangement and so on), including labelled job details shown beside a structured description ("Remote Type: Hybrid"). The extension sends the page's title, and the job's own page content without navigation, footers or other jobs, as neutral context and interprets nothing itself. A field you corrected in the preview is recorded as user-corrected.
  - **Duplicates:** the same job saved from another site is added to the existing opportunity only when they share a listing URL, or a listing or requisition ID at the same company. Otherwise a sufficiently similar copy is flagged as a possible duplicate, and other copies stay separate. Similar text alone never merges anything.
  - **Evaluation:** saving never evaluates. **Request evaluation** uses the existing evaluation path (budget, duplicate-spend protection, queue), and the popup shows the persisted state and recommendation, read-only.
  - **Pairing:** a browser is paired on the new **Extension** page with a credential shown once, stored only as a hash, and revocable.
  - **LinkedIn:** capture complements 14A; it does not change 14A's disabled LinkedIn adapter.
  - Until 14B is accepted, adding a job by hand remains the established way to capture a single page. *(Earlier wording, superseded on October 20, 2026 when 14B was implemented: "Not yet built (Feature 14B): … the next task …". An October 19, 2026 implementation instruction incorrectly treated Feature 14B, the required browser-extension companion, as deferred, an optional future idea and not required. No approved roadmap or authoritative product-scope revision removed Feature 14B from the main product. The October 20, 2026 correction resolved that inconsistency while preserving Feature 14A's accepted implementation.)*

How each source is read (least intrusive method that works):

| Method | Sources |
| --- | --- |
| Official API or feed | Greenhouse, Lever, Ashby, SmartRecruiters, Himalayas, Remote OK, We Work Remotely (RSS), Adzuna (once credentials exist and it is verified) |
| Public feed | Working Nomads (`exposed_jobs` JSON) |
| Public structured data, no browser | Workday (tenant career-site JSON), Workable (anonymous search JSON) |
| Public data embedded in a webpage | Wellfound (conservative 12-second cadence) |
| Browser-assisted, public and logged-out | LinkedIn (unverified and disabled: its local adapter check discovered public jobs, then a job page answered HTTP 429; the Claude cloud check met an anti-bot page) |
| Public logged-out webpage (candidate) | Welcome to the Jungle / Otta (unverified: its tested public pages expose no usable job records) |
| Browser extension, on request (Feature 14B, awaiting acceptance) | any job page you are viewing and choose to save, including LinkedIn job pages and Welcome to the Jungle / Otta through the generic reader |

*(Earlier status, superseded on October 19, 2026 when Feature 13 was committed as `d1bf217`. It read as follows.)*

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
- **Re-retrieval:** an unchanged listing only updates last-seen times. A changed listing is kept as a linked new version, shown as "Listing changed since first seen", while the original description stays. *(Superseded October 23, 2026: a changed version of the originating listing now becomes the job's current facts and description, with every version kept; see "Job-text fallback" above.)*
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
6. Done: Feature 13 (`d1bf217`, October 19, 2026), with Core AI Framework PRD v1.10, Customer Success PRD v1.9, Core Platform TDD v1.11 and Customer Success TDD v1.9. *(Earlier step: "Now: Feature 13, posting history and listing removal, implemented and verified, awaiting review.")*
7. Done: Feature 14A (`dd77d29`, accepted October 20, 2026), browser-assisted LinkedIn retrieval and source corrections, with Core AI Framework PRD v1.11, Customer Success PRD v1.10, Core Platform TDD v1.12 and Customer Success TDD v1.10; LinkedIn stays unverified and disabled. *(Earlier step: "Now: Feature 14, … implemented and verified, awaiting review.")* *(Corrected October 20, 2026: this step previously also called the browser extension deferred and optional, following an October 19 implementation instruction; see the correction note under "Main-product tasks".)*
8. Now: Feature 14B, the browser-extension companion (committed `e6bacc6`). Its local acceptance led to the shared-Core job-text fallback correction, implemented and verified October 23, 2026 with Core Platform TDD v1.15 and Core AI Framework PRD v1.14, and awaiting Alex's review. Then come the minimal human retest, acceptance and the commit. Feature 14 is not complete until 14B is accepted, and Feature 15 has not started. *(Earlier steps: "Now: Feature 14B … (not started)", superseded October 20, 2026; "Now: Feature 14B …, implemented and verified (October 20, 2026), awaiting Alex's review and local Chrome acceptance …", superseded October 23, 2026.)*
9. Then, after 14B is accepted, build the rest of main-product features 15–18:
   - source intelligence;
   - job-market analytics;
   - personal job-search analytics;
   - company intelligence.
10. Only after features 1–18 are complete: deliberate evaluator/product integration (including the decision on how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

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

- merging the evaluator branch: routing lock, October 10–13 contract repairs, Milestone 4 alignment and its October 25 compensation-basis correction;
- removing the five released Task 7 fields, plus `compensationBasis`, from `fieldsWithheldFromEvaluator`, and replacing the evaluator's temporary compensation-basis compatibility read with the native Core field;
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
- The browser extension (Feature 14B, required; implemented, awaiting acceptance) is a companion to the same application, backend, data, evaluator, lifecycle, provenance, budget, and dashboard; it never becomes a second evaluator.
- Browser-assisted retrieval is public and logged-out only: no account, cookies or stored state, no account actions, and no proxy rotation, stealth, fingerprint changes, CAPTCHA solving or access-control bypass.
- Paid provider calls require explicit authorization.
- Experiments/tests must not use the normal application database without explicit authorization.
- Historical milestone/status documents should remain truthful history; current-state documents should reflect the latest accepted implementation.
