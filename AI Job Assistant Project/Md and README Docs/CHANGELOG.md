# Changelog

All notable project changes for the AI Job Assistant are documented here.

This changelog summarizes major implementation milestones and evaluator evolution. Detailed historical implementation records live in `MILESTONES_1_10.md` and `EVALUATOR_STATUS.md`.

---

## Unreleased

Entries are newest first. The October 15 entries below describe the project as of October 15, 2026. The entries marked "added October 16, 2026" were recovered from Git history and the branch records. The Task 9 entry was added when Task 9 closed on October 16, 2026. The Features 1–10 Gap Closure entry was added at its closeout on October 17, 2026. The Feature 11A entry was added at its closeout on October 18, 2026. The Feature 11B entry was added at its closeout on October 18, 2026. The Feature 12 entry was added when Feature 12 was implemented and verified, awaiting review, on October 18, 2026. The Feature 13 entry was added when Feature 13 was implemented and verified, awaiting review, on October 19, 2026. The Feature 14 entry was added when Feature 14 was implemented and verified, awaiting review, on October 19, 2026. The Feature 14B correction entry was added when it was implemented and verified, awaiting review, on October 23, 2026. The Feature 14B cross-source correction entry was added on October 26, 2026. The Feature 14B final cross-source batch and currency symbol correction entries were added on October 27, 2026.

### Feature 14B currency symbol correction (October 27, 2026; committed; awaiting the targeted live verification)

- **Product rule:** a recognized currency symbol is read directly as its currency ("$" US dollars, "€" euros, "£" pounds sterling, "₹" rupees, "¥" yen), with no geography or other context; a currency code or name the posting states ("$100,000 CAD", "Canadian dollars") takes precedence over the symbol. The user's selected currency also takes precedence over a symbol.
- **Supersedes** the bare-"$" geography rule (October 23, 2026) and the final batch's U.S. work-authorization evidence for it. One shared function (`parseCompensation`) for every path.
- Healthie, Mongoose, PeopleGrove, AlphaSense and New Law Business Model now read as USD. Core Platform TDD v1.15 and Core AI Framework PRD v1.14 still state the old rule (not edited).

### Feature 14B final cross-source batch (October 27, 2026; committed; awaiting the targeted live verification)

From Alex's final human cross-source retest; fixed as shared contracts along the capture path, not per posting.
- **Shared normalizer:** page metadata read with or without a colon and without layout separators, and split salary ranges rejoined; an arrangement-only labelled location states the arrangement, not a place; a more precise labelled location replaces the source's; bounded explicit statements (fully remote, Virtual First's primary remote experience, a labelled Flexible or Remote work persona, employment classification lines, zone abbreviations and required overlap, "End Date" and "posting will close" dates, labelled posted ages); rounded and exact statements of one range agree; variable pay stated on its own is the `bonus` fact, never the salary; hourly pay with its stated annual equivalent gives that range; a U.S. work-authorization requirement is U.S. context for a bare "$" (superseded the same day by the currency symbol correction above); labelled regional tiers become `compensationTiers` (additive migration `20261027090000_compensation_tiers`).
- **Extension collection:** the posting's own heading over a careers-site title (and h2-titled pages now get page context); the job's own header and footer kept in page context; microdata `baseSalary`; apply links with typographic apostrophes, in the job's own header or footer, and one destination per address; the page's full description over a shortened structured copy; a default "Anywhere" never replaces a stated location.
- **Display:** Salary shows labelled tiers side by side, never merged; the opportunity shows its requisition ID; the popup says when the evaluation shown is of an earlier listing version.
- **Evaluator:** no prompt, schema, model, routing or policy change; `compensationTiers` and `bonus` are withheld from the evaluator subject.
- **Replay helper:** compares tiers and bonus; `--evidence <file>` saves a stored version's evidence for offline replay.

### Feature 14B original-JD retest helper (October 26, 2026; acceptance tooling only)

- `pnpm acceptance:check-source-version` re-normalizes one stored source version's exact evidence with the production normalizer, and prints it beside the opportunity's stored facts.
- It is read-only by construction (read-only session and `READ ONLY` transaction), never calls the evaluator, a provider or the network, and refuses a database other than the one named.
- It is for original postings that a recapture reports as unchanged during the cross-source live retest.

### Feature 14B cross-source correction (October 26, 2026; committed `6536ef8` as checkpoint v7; awaiting the cross-source live retest)

**Why.** Live acceptance captures across every supported source showed defects on every source except Greenhouse. The failures sat in collection, transport and shared normalization, and were corrected as one contract.

- **Shared normalization:**
  - Remote-hiring geography (`sourceFacts.remoteLocations`) becomes the role's location ("Remote (United States)") and eligible geography; an office is never a remote role's location.
  - A posting's statement that the remote role is based somewhere counts as eligibility, below explicit statements; an ordinary job or office location never does. A posting's fuller labelled location replaces a narrower one it contains.
  - One pay range agrees with its own OTE or breakdown detail. Regional tiers or zones, each labelled with its place, have no single range, even over a source field, and are kept with their labels.
  - Time-zone preferences are kept, and a Pacific-to-Eastern span is geography. Source-stated posting ages are dated at day precision and marked.
  - Stated seniority labels are kept (`Opportunity.seniorityLabel`) and several stated work arrangements are kept as options (`Opportunity.workArrangements`), in one additive migration. Labelled requisition IDs are read.
  - "Office or Remote" keeps both options (On-site / Remote), and one to four office days a week reads as hybrid. Compound employment labels and eligible-state lists are read, and "continental U.S." is U.S. geography.
- **Extension collection:**
  - JobPosting microdata, and structured data without a description;
  - the job's own container, never another job's `<article>`, with other-jobs lists excluded;
  - page context one item per line with every description;
  - the application page ranked above `directApply`;
  - the LinkedIn criteria list and posted age;
  - two optional envelope fields, `remoteLocations` and `seniority`.
- **Adapters:** Wellfound and Himalayas map their remote geography into the shared fact. Adapter content hashes are unchanged.
- **Product:** Salary (the normalized range, or Unknown) replaces the separate Compensation row; the arrangement filter matches each offered option. An approximate posting date is withheld from the evaluator subject. Department is removed from the opportunity, the dashboard filter and manual entry.
- **Unchanged:** deduplication logic, and the evaluator's stages, prompts, models and routing (`seniorityLabel` is withheld from the evaluator).

### Feature 14B correction — shared-normalization convergence (October 25, 2026; implemented and verified, awaiting review; not committed)

**Why.** The Greenhouse Healthie acceptance capture left stated facts Unknown: an OTE salary range, the department, work authorization and the application URL.

**Changed (domain-neutral, every ingestion path):**
- **Compensation.** A stated range keeps its numbers whatever its basis, with a new `compensationBasis` (BASE / OTE), in the original currency; no conversion is stored. OTE is no longer a reason for Unknown bounds; the evaluator decides what qualifies as base salary. *(Supersedes "OTE is never stored as base salary; bounds Unknown".)* OTE wording takes precedence over a mention of base in the same statement, and a source-stated range (structured amounts or a salary field) is OTE when the job description states that same range as OTE (v5).
- **Work authorization.** A new normalized fact for every job and country, separate from residency: the requirement and its countries, sponsorship, relocation, and employer-of-record countries. A separate relevance layer (`workAuthorizationRelevance`, with the user's `UserEligibility`, set on the profile page) decides what to surface: a requirement the user meets raises no warning, non-U.S. issues are shown for review, and an unstated non-U.S. job is flagged "worth checking".
- **Department.** An explicit team statement counts ("join Healthie's Customer Success team"), without inference.
- **Application URL.**
  - It is captured with its basis on every path. The extension detects an on-page application form, JSON-LD `directApply` and explicit Apply links.
  - Adapters declare their basis.
  - A job board's own listing page is no longer stored as an application URL; the hash is unchanged.
  - A changed originating listing updates the link only when it owned it.
- **Closing date.** JSON-LD `validThrough` and Greenhouse `application_deadline`.
- **UI.** Salary basis, a Work authorization row, Location eligibility only when stated, an application-URL basis note, and an eligibility note and "Check work eligibility" badge.
- **Migration.** `20261025090000_work_authorization_and_compensation_basis` is additive. It was applied only to the isolated test database, with no backfill.

**Adapter regression check (same day):**
- Every implemented adapter's fixture was followed through normalization and persistence, with a content-hash snapshot: 36 listings, none changed.
- Fixed: Remote OK and Himalayas listing pages repeated in their apply fields are no longer stored as application URLs.
- Fixed: LinkedIn's "$90,000.00/yr - $110,000.00/yr" ranges keep their numbers.
- Fixed (shared geography): an explicit country in a full location settles an ambiguous region abbreviation for bare-"$" currency. "Sunnyvale, CA, United States" → USD, derived; "Sunnyvale, CA" and "Toronto, ON, Canada" unchanged; explicit currencies always win.
- Totals after the check: unit 62 files, 1,587 tests; integration 35 files, 306 tests.

**Unchanged:** deduplication logic; the evaluator's prompts, models and routing; the new fields are withheld from evaluator input.

**Verified:** typecheck, lint, unit (61 files, 1,554), integration (34 files, 293), the full E2E chain: 44/44 (5.2 min), including the extension project, both builds, `db:verify-migrations`, `git diff --check`.

### Feature 14B correction — current-version projection of changed listings (October 23, 2026; implemented and verified, awaiting review; not committed)

**Why.** The Feature 14 closeout found stale current facts: a CHANGED re-observation (Hybrid → Remote) was recorded, but the opportunity still showed Hybrid. Task 7 had anticipated re-normalizing changed listings and left it incomplete; Feature 11A then deliberately left the opportunity unchanged (Core TDD v1.8–v1.14). Alex approved correcting the contract in Core TDD v1.15 §51.

**Changed:**
- **Re-projection.** A CHANGED observation of the opportunity's originating listing (its first source record's source and listing ID) is re-normalized and becomes the opportunity's current facts, including the description. A fact the new version no longer supports becomes Unknown. Every version stays stored.
- **Who may write facts.** Attached copies from other sources and manual opportunities are never re-projected; link precedence is unchanged. Values with `userCorrected:*` provenance stay unless the capture is the user's own edit of them.
- **Superseded provenance.** New `FieldProvenance.supersededAt`. Replaced rows are marked, never deleted or rewritten. Current views show only non-superseded rows, and the opportunity page lists "Earlier provenance".
- **Evaluated source version.** New `Evaluation.sourceRecordId`, bound when the user requests the evaluation.
  - `loadSubject({ evaluationId })` reconstructs that version as it stood, and Customer Success stages read the bound record (`evaluatedSource`) instead of `rawSources[0]`.
  - Semantic attempts record the bound record.
  - No automatic evaluation, and no new lifecycle status.
- **UI.** A version hint when the latest evaluation used an earlier listing version. The "Listing changed since first seen" notice and the dashboard badge tooltip are reworded: current facts show the latest version, earlier versions are kept, an evaluation may describe an earlier version, and reevaluating is optional.
- **Migration.** `20261023090000_superseded_provenance_and_evaluated_source` is additive, nullable and carries rollback comments. It was applied only to the isolated test database, with no backfill.

**Unchanged:** deduplication; content hashing and change detection; the evaluator's stages, models, prompts, routing, schemas and recommendation logic; `fieldsWithheldFromEvaluator`.

**Verified:** typecheck, lint, unit (59 files, 1,519), integration (33 files, 288; new `listing-version-projection` suite of 12 covering the 26 approved cases), the full E2E chain: 44/44 (5.8 min), including the extension project, both builds, `db:verify-migrations`, `git diff --check`.

### Feature 14B correction — shared Core job-text fallback (October 23, 2026; implemented and verified, awaiting review; not committed)

**Why.** Alex's local acceptance of Feature 14B showed that the shared normalizers left already-supported facts Unknown when a page stated them only in its job description. That happened on a Greenhouse, a Lever and an employer careers page. This restores the Core requirement in shared Core. It is not an extension, adapter or site patch.

**Changed:**
- **New shared reader.** `readJobTextFacts` in `packages/normalization` is used by both the manual and retrieved normalizers, and so by every ingestion path. It fills only facts the source left missing, from explicit labelled lines and bounded job-specific statements. The facts are company, location, work arrangement, employment type, salary text with base amounts, posting and closing dates, time-zone requirement, and labelled seniority and department.
- **Precedence:**
  1. user-stated or corrected;
  2. structured;
  3. dedicated field;
  4. page title (company only);
  5. job text;
  6. Unknown.

  A fallback never overwrites, and conflicting statements stay Unknown.
- **Provenance.** Text-derived facts are DETERMINISTIC with `rawText:*` markers; a company from the page title is marked `pageContext:page-title-company`. Fields corrected in the extension preview are DIRECT with `userCorrected:<field>`.
- **Compensation.** A statement needs a compensation cue, and business metrics and perks are excluded. OTE is never stored as base salary; "plus commission" keeps the base range. The whole statement is kept as salary text. *(Superseded October 25, 2026: OTE bounds are kept, with basis OTE.)*
- **Currency, product-wide.** A bare "$" is USD only with clear U.S. evidence (location, residency regions or the statement itself). Otherwise it is Unknown, and CAD or AUD are never inferred from a place. *(October 25, 2026: an explicit country in a full location settles an ambiguous region abbreviation, so "Sunnyvale, CA, United States" is U.S. evidence while "Sunnyvale, CA" stays ambiguous.)* *(Previously a bare "$" was always USD, a product decision of October 14, 2026, now superseded by Alex's October 23 decision.)*
- **Time zone.** `timeZoneRequirements` is an existing normalized fact, so an explicit requirement in the job text is now read. It is never read from a place.
- **Browser extension.** The extension sends the tab's title as neutral `pageTitle` context, never on LinkedIn, and the envelope change is additive. The server keeps `sourceMetadata.pageTitle` and `sourceMetadata.userCorrectedFields`.
- **Bounded job-page context.** With a structured-data or selection capture, the extension also sends `pageText`: the job's main content or heading container, without navigation, header, footer, side panels, forms or recommendation, related-job, sharing and cookie widgets. It is capped and never sent on LinkedIn. Shared normalization reads it only through labelled values ("Remote Type: Hybrid", "Location: …"), with `pageContext:*` markers, below structured values; disagreement leaves the fact Unknown.
- **Source facts, product-wide.** A department, seniority or experience level, or a compensation text that a retrieval source states in its own fields, was collected but never normalized (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Himalayas, LinkedIn, Wellfound). It now reaches the shared normalizer through a neutral `sourceFacts` record, with no content-hash change. Wellfound's compensation text yields amounts only when it states an annual period.
- **Page-context change detection.** The canonical labelled page-context evidence, not the page text, takes part in a capture's content hash. Noise is no change; a changed labelled fact is a CHANGED re-observation.
- **Page-title company.** A part naming a place, arrangement, employment type or department is never the employer, and a dash-separated name must appear in the posting.

**Unchanged:**
- deduplication (engine, thresholds and rules; re-run with the corrected inputs and behaving as specified);
- the unknown-host site-ID rule and link precedence;
- the evaluator, `loadSubject()` and the withheld fields.

There is no schema change and no backfill.

**Tests.** New unit `job-text-fallback` (42) and integration `job-text-fallback` (6) suites. Tests encoding the superseded bare-"$" and "time zone never from text" rules were updated deliberately.

**Specifications.** Core Platform TDD v1.15 and Core AI Framework PRD v1.14. The Customer Success PRD and TDD are unchanged.

### Feature 14B — browser-extension companion (October 20, 2026; committed `e6bacc6`; still open after the local acceptance described above)

*(Heading updated on October 23, 2026; it read "implemented and verified, awaiting review and local acceptance; not committed". The entry below is as written.)*

Built to the approved Feature 14B plan (decisions D1–D4 and O1–O4) and the Feature 14B implementation prompt (decisions D1–D8).

- **Extension** (`apps/extension`, TypeScript, Manifest V3, esbuild, `pnpm extension:build`, loaded unpacked):
  - a popup that reads the job page you are viewing only on "Read this page", shows an editable preview (title, company, location, description; corrected fields named in `editedFields`), and sends it only on "Save";
  - a self-contained page reader that takes no arguments and has no storage, cookie or network access;
  - local envelope validation with the server's schema;
  - one API client limited to `/api/extension/*` on a local backend;
  - options that keep the backend address and pairing credential in `chrome.storage.local` only, restricted to the extension's own pages with `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`;
  - a minimal service worker that only applies that restriction on installation and browser start.
  - Permissions: `activeTab`, `scripting` and `storage`, plus host access to `127.0.0.1` and `localhost` only. No content scripts.
- **Extraction:**
  - schema.org JobPosting data first;
  - on LinkedIn job pages only, a reader limited to the job-detail areas, then the user's selection, with no whole-page fallback, and never account, profile, messaging, feed or cookies;
  - the user's selection;
  - everywhere except LinkedIn, the page's main content.
  - Welcome to the Jungle and Otta go through the generic path. Nothing is invented.
- **Capture API** (`POST /api/extension/captures`):
  - a strict envelope (128 KB, 50,000-character description, no HTML);
  - server-side site classification: known ATS, job-board and marketplace hosts, every other host AGGREGATOR with its real host kept;
  - LinkedIn canonical job URLs;
  - mapped to a retrieved listing with `BROWSER_EXTENSION` / `BROWSER_ASSISTED` provenance and ingested through `createRetrievalIngestionService`: created, attached, unchanged or changed, with existing link precedence.
  - Captures never evaluate.
  - Also `GET /api/extension/status` and `GET /api/extension/lookup`.
- **Evaluation from the extension:**
  - the explicit "Request evaluation" and the status read go through credential-gated wrappers (`/api/extension/opportunities/:id/evaluation-requests` and `…/evaluation`);
  - the wrappers call the existing `handleProductionEvaluationPost` and `handleProductionEvaluationGet` unchanged;
  - the popup shows only the persisted state and recommendation.
- **Pairing:**
  - an Extension page (`/extension`, in the header) to create, list and revoke pairings;
  - the credential (`aija_` plus 32 random bytes) is shown once and stored only as a SHA-256 hash;
  - a constant-time check, web origins refused (403), no CORS (`OPTIONS` → 405);
  - pairing management is same-origin only and refuses Bearer credentials.
- **Migration:** `20261020090000_extension_pairing` (additive; one table, no foreign keys), applied only to the isolated test database.
- **Doctor:** names the connected database (name and host only) and counts paired browsers.
- **Checks made during implementation:**
  - Chrome storage restriction: supported, Chrome 102 and later (the manifest requires 120). In Chromium 141 a page-injected script reads `chrome.storage.local` by default and is refused after the restriction.
  - Shell `DATABASE_URL` precedence over `.env`: proved for `app:doctor`, Prisma, `next dev` and `dotenv/config` with a temporary decoy `.env`.
- **Acceptance runbook** (`apps/extension/README.md`), with a local fixture page (`apps/extension/fixtures/acceptance-job.html`):
  - a dedicated `ai_career_assistant_acceptance` database, selected in the shell;
  - the doctor's database line checked before and after migrating;
  - an offline evaluation mode with no provider call.
- **Tests:**
  - unit: `extension-extract` (13), `extension-client` (16), `extension-server` (41), plus doctor and navigation checks; 1,433 unit tests in all;
  - integration: `extension-capture` (7, on the test database); 265 integration tests in all;
  - E2E: a new Playwright `extension` project (6) that loads the built extension into Chromium through `launchPersistentContext`, with DNS limited to `127.0.0.1` and `localhost`. It covers:
    - the service worker and storage closed to page scripts;
    - pairing, the editable preview, and no capture request before Save;
    - created, unchanged and possible-duplicate results;
    - Open in AI Job Assistant;
    - Request evaluation with its queued, running, completed and failed states (the deterministic helper worker, fixture transport);
    - a page with no job;
    - the LinkedIn reader with decoys and Welcome to the Jungle in real Chromium (pages answered by Playwright);
    - revocation and route refusals.
  - Full E2E chain on the test database: 43/43 passed (7.2 min), including the 6 extension tests.
  - The production web build passes.
- **Unchanged:** evaluator internals, model routing, semantic schemas and recommendation logic.
- **Spec versions:** Core Platform TDD v1.14, Customer Success TDD v1.12, Core AI Framework PRD v1.13 and Customer Success PRD v1.12; the previous versions moved unchanged into `Archive/`. TDD v1.14 also:
  - corrects Section 9's stale "verified browser-assisted sources include LinkedIn and Upwork": LinkedIn's browser-assisted support is implemented, but the source is unverified and disabled after HTTP 429; Upwork is Freelance-domain;
  - records the approved pairing-credential exception and the user-requested evaluation rule.
- **Remaining:** Alex's review, Alex's local Chrome acceptance on the acceptance database, and the commit (on approval).

### Feature 14A — browser-assisted LinkedIn retrieval and source corrections (October 19, 2026; awaiting review)

*(Correction, October 20, 2026: heading changed from "Feature 14 — …". This entry covers Feature 14A. Feature 14B, the browser-extension companion, is required main-product work, is not yet implemented and is next, so Feature 14 is not complete. New specification versions record this: Core Platform TDD v1.13, Core AI Framework PRD v1.12, Customer Success AI Assistant PRD v1.11 and Customer Success Assistant TDD v1.11, with the previous versions moved to `Archive/`.)*

*(Annotation, October 20, 2026: committed as `dd77d29` and Feature 14A accepted. On October 20, 2026 the committed adapter (`dd77d29`) was run from the local WSL runtime with one search page and one job page: the public search page returned HTTP 200 and 60 public job cards were discovered (the "Sign in to view more jobs" modal did not prevent it); the first job-detail page returned HTTP 429, and the run stopped at once as RATE_LIMITED, with no retry and no listing emitted. Feature 14A was accepted on that result; LinkedIn itself stays unverified and disabled (a source-side rate limit, not an implementation defect) and is not retried.)*

- **Browser-assisted runner** (`packages/discovery/src/browser.ts`, new `packages/browser-retrieval`): a fresh, logged-out headless Chromium context per run (Playwright), with no account, cookies, profile or stored state; navigation only; one page at a time with the adapter's minimum interval; per-run navigation caps, a 30-second timeout and a 5 MB page limit; images, fonts and media not downloaded; a page can never navigate by itself (a script reload or meta refresh is refused), so a challenge page cannot cause a further request; response headers are kept for diagnosis with cookie values dropped. Any 403, 429, 999, sign-in wall, authwall, checkpoint, CAPTCHA, challenge or account cookie stops the run with no further request and reaches Feature 12 backoff. No login, proxy rotation, stealth, fingerprint changes or CAPTCHA solving.
- **LinkedIn** (`linkedin`, browser-assisted, job board): public job search pages paged by the actual result count (default 4 pages and 100 results; hard caps 8 and 200) with the Customer Success title filter, then at most 20 public job pages per run (hard cap 25). Title matches whose details are not stored are kept as pending rows in the existing `RetrievedListing` ledger (no migration) and read first in later runs, oldest first, for up to 30 days; stored jobs are re-read only after 7 days; a gone page leaves the queue. Parsing uses the page's schema.org JobPosting data, then its public fields; the source URL is the public job page and an application URL only when the page states one. Bounded, never removal-capable. **Unverified:** the environment first denied www.linkedin.com by network policy; once it was reachable, the single logged-out verification request was answered with HTTP 429 and LinkedIn's anti-bot interstitial (an obfuscated cookie script and a meta refresh), and the run stopped there with no retry. That result is specific to the Claude cloud environment: a separate local logged-out browser check loaded normal public results (about 11,000 United States Customer Success jobs) under a "Sign in to view more jobs" modal, so LinkedIn remains a viable source; the adapter no longer treats that modal as a login wall while results are present, and uses the verified `/jobs/search/` form. The adapter was built against synthetic pages, now also detects that interstitial whatever its status, and cannot be enabled until a live logged-out check of the adapter itself passes from a local runtime (`pnpm sources:verify linkedin`, which now supports a browser).
- **We Work Remotely:** the official all-jobs RSS feed (`remote-jobs.rss`) with the local title filter, instead of one category feed; still RSS only. Verified live on October 20, 2026 with one request (91 items, all parsed, 3 kept by the title filter) and the fixture re-captured from it.
- **Final live smoke checks (October 20, 2026, one request each, production routes):** Wellfound, Working Nomads, Remote OK, Himalayas and the SmartRecruiters posting list all answered 200 and parsed with the existing adapters; no defect was found.
- **Wellfound:** at least 12 seconds between requests (was 2), sequential, embedded state unchanged.
- **Audited, unchanged:** Greenhouse, Lever, Ashby, SmartRecruiters, Himalayas and Remote OK (official APIs or feeds); Working Nomads (the public `exposed_jobs` feed; the internal `/jobsapi/_search` is not used); Workday (tenant career-site JSON); Workable (anonymous search JSON, not the large XML feed); Adzuna (disabled). No adapter reads `robots.txt`.
- **Welcome to the Jungle / Otta (revised B11):** reclassified as public logged-out webpage retrieval (`PUBLIC_HTML`; no public jobs API), an active candidate rather than disabled because of its terms. Live check on October 19, 2026: one plain GET of the public search page answered 200 with a sign-up and matching landing page (no listings, no job links, the query ignored), and one logged-out headless-browser load was refused by its CloudFront firewall (HTTP 403), a stop condition; no further request was made. Then a local WSL browser check run by Alex then loaded the public company jobs page (`/en/companies/wttj/jobs`, which ends at `/en/companies-v1/wttj/jobs`) logged out with no 403, 429, CAPTCHA, sign-in wall or challenge, and with JavaScript rendering showed the company shell and a "Jobs 16" tab but "We didn’t find any jobs for your search": no job cards, links, IDs, descriptions, locations, employment types or dates. The cloud 403 was environment-specific, but no tested public surface exposes usable job records, so it stays unverified and cannot be enabled; no internal API discovery was done and no other route was tried.
- **Not built in this task:** the Manifest V3 manual-capture extension (no manifest, popup, permissions, local bridge or pairing were built). *(Corrected October 20, 2026: this line called it "deferred" and "an optional future idea". An October 19, 2026 implementation instruction incorrectly treated Feature 14B, the required browser-extension companion, as deferred, an optional future idea and not required. No approved roadmap or authoritative product-scope revision removed Feature 14B from the main product. This correction (October 20, 2026) resolves that inconsistency while preserving Feature 14A's accepted implementation. Feature 14B is required main-product work and is next.)*
- **New versioned specifications:** Core Platform TDD v1.12 (§51 "Browser-Assisted Retrieval and Source Corrections (Feature 14)"), Core AI Framework PRD v1.11, Customer Success AI Assistant PRD v1.10 and Customer Success Assistant TDD v1.10 (status, revision history and dependencies). The previous versions moved unchanged into `Archive/`; the Semantic Evaluation Playbook is unchanged.

### Feature 13 — posting history and listing removal (October 19, 2026; awaiting review)

*(Annotation, October 19, 2026: committed as `d1bf217`.)*

- **Listing coverage** (`packages/discovery`): `CollectResult` may carry `coverage: { observedListingIds, complete }`. The IDs are every listing the source listed, read **before** the title filter (which still decides ingestion), so a stored listing whose title changes is still seen. A run is complete only when it read the whole listing, every item had a usable ID, it was not halted or capped, and, where the source states a total, the unique IDs **equal** it exactly. Adapters declare `listingCoverage` and `trackingScope` (their retrieval-scope fields).
- **Removal-capable sources:** Greenhouse, Lever and Ashby (a whole-board response), and Workday and SmartRecruiters (when the stated total fits the page cap and is read in full). Wellfound, Himalayas, Remote OK, Working Nomads, Workable and We Work Remotely only record sightings.
- **Listing ledger** (migration `20261019090000_retrieved_listing_history`, additive): `RetrievedListing`, with one row per stored listing per tracking-scope generation (states HISTORICAL, LISTED, MISSING, REMOVED, UNTRACKED), and `RetrievalSource.trackingScopeKey`, an opaque generation key. A retrieval-scope settings change starts a fresh generation and makes earlier rows UNTRACKED, so A → B → A never inherits A₁'s history; display-only changes keep the scope. Pre-feature-13 listings are backfilled as HISTORICAL (last observed, never currently listed); a source's first run adopts that baseline unless a scope change came first. `RetrievalRun.listingCoverageComplete` records each run's coverage.
- **Transitions:** a sighting makes a listing LISTED and moves the opportunity's last-seen time (`SourceRecord.lastObservedAt` still means content observed). One qualifying complete miss gives MISSING; two, at least 24 hours after the first, give REMOVED; REMOVED seen again is a reappearance. Bounded, incomplete, partial or failed runs never infer absence. There is no automatic lifecycle change.
- **Facts** (`packages/core/src/posting-history.ts`): ACTIVE_ATS, CURRENT_POSTING, REPOSTED (after a confirmed removal), CLOSED_ATS_VISIBLE_ELSEWHERE, AGGREGATOR_VISIBILITY and UNCHANGED_OVER_TIME (from content observations, at least 30 days). They are contract-tested against the Customer Success posting-history schema but **withheld** from `loadSubject()`: no evaluator, routing, cost or recommendation change.
- **UI:** a "Posting history" section on the opportunity page, a current-scope "No longer listed" dashboard badge, an evaluation warning (not a block), and coverage plus listing counts in `/sources` run history.
- **New versioned specifications:** Core Platform TDD v1.11 (§51 "Posting History and Listing Removal (Feature 13)"), Core AI Framework PRD v1.10, Customer Success AI Assistant PRD v1.9 and Customer Success Assistant TDD v1.9 (status, revision history, and the §45 and §49 Ghost Job Risk notes annotated). The previous versions moved unchanged into `Archive/`; the Semantic Evaluation Playbook is unchanged (v1.3).

### Feature 12 — source health and conservative retrieval (October 18, 2026; awaiting review)

*(Annotation, October 19, 2026: committed as `f10a02b`.)*

- **Within a run** (`packages/discovery`): HTTP 5xx is now its own adapter error code, `SERVER_ERROR` (other unexpected statuses stay `HTTP_STATUS`), and any server error, like a 429 or a 401/403, stops further requests to that host for the run; SmartRecruiters and Workday stop requesting details on the same failures (`isStopError`). A valid Retry-After on a 429 or 503 (delta-seconds or a future HTTP date) is parsed by the transport and carried with the failure; invalid or past values are ignored. No retries within a run.
- **Between runs** (`packages/core/src/retrieval-health.ts`, migration `20261018120000_retrieval_source_health`, additive and nullable): one gate per source, `RetrievalSource.nextEligibleAt`, written with each run's outcome in the same transaction; `RetrievalRun.retryAfterUntil` keeps the source's requested wait. A successful retrieval (COMPLETED, or PARTIAL only through our listing failures) clears it; a source failure backs off by its streak (rate limit: the schedule doubled per failure; transient: the normal schedule first, then doubling; access/contract/settings/oversized: at least a day, then doubling), capped at 7 days, with a valid Retry-After honoured in full; neutral outcomes on our side never count. No automatic disabling.
- **Run now and settings:** the scheduler and Run now respect the gate. A rate limit (`SOURCE_RATE_LIMITED`) and a wait the source asked for on another response (`SOURCE_PROVIDER_WAIT`) can never be overridden; our own backoff (`SOURCE_BACKING_OFF`) only with an explicit "Run now anyway" (`{"override": true}`), for one run. When our backoff outlasts the source's Retry-After, the gate is a provider wait until that date and backoff after it. A settings change clears only our own backoff; enabling or disabling a source never changes the gate.
- **Health:** derived from runs, shown on `/sources` (status badge, last attempt, last successful retrieval, next run and why, latest failure, stale and empty-result notes, distinct "Rate limited until …" and "Retry after … (requested by the source)" wording) and as read-only `pnpm app:doctor` warnings.
- **Scope:** listing expiry/removal detection moved from feature 12 to feature 13.
- **New versioned specifications:** Core Platform TDD v1.10 (§51 "Source Health and Conservative Retrieval (Feature 12)"), Core AI Framework PRD v1.9, Customer Success AI Assistant PRD v1.8 and Customer Success Assistant TDD v1.8 (status and revision history). The previous versions moved unchanged into `Archive/`; the Semantic Evaluation Playbook is unchanged (v1.3).

### Feature 11B — automated retrieval from the verified public/guest-endpoint and public-HTML sources (October 18, 2026)

- **Sources** (each verified with individually approved live requests; committed fixtures of at most three items with metadata; raw responses outside Git):
  - **Workday** (employer ATS, public/guest endpoint): configured by the employer's career-site address. A stateless JSON POST list with offset paging (the total is reported on the first page only), capped detail requests with unseen postings first, listing IDs qualified by tenant and site, the company from the detail, the absolute start date as the posting date, and only Remote/Onsite mapped to a workplace type. Pay ranges stay in the description; daily-changing fields are not material.
  - **Workable** (job board, public/guest endpoint): the Jobs by Workable search for "customer success", paged by `pageToken`, with the complete text (description, requirements, benefits) inline, so no detail requests. Its official whole-feed XML export (about 850 MB) was verified as a contingency only and is not used.
  - **Wellfound** (marketplace, public HTML): the embedded Next.js state of the public Customer Success role page, up to 11 pages at least 2 s apart, complete descriptions converted from Markdown-style text; compensation kept as source data.
  - **Welcome to the Jungle / Otta** keeps its Type #3 classification but is registered unverified and cannot be enabled: its logged-out search now shows a sign-up and matching flow with no listings or anonymous listing endpoint. Deferred to browser-assisted retrieval (feature 14) for reconsideration.
- **Framework:** a JSON POST transport method with the existing ceiling, politeness, 401/403/429 handling and no-redirect rule; source-specific request intervals and page caps; the unseen-first detail priority shared by SmartRecruiters and Workday; an embedded-state reader. No schema change, no worker or deduplication change.
- **New versioned specifications:** Core AI Framework PRD v1.8, Customer Success AI Assistant PRD v1.7, Core Platform TDD v1.9 (§51 "Automated Retrieval: Type #3 and Type #4 Sources (Feature 11B)") and Customer Success Assistant TDD v1.7 (the §8 implementation note). The previous versions moved unchanged into `Archive/`; the Semantic Evaluation Playbook is unchanged (v1.3).

### Feature 11A — automated retrieval from the verified official API and feed sources (October 18, 2026)

- **Collection framework** (`packages/discovery`): the source-adapter contract.
  - **Transport:** injectable, with an identifying User-Agent, a 20 s timeout, a hard 10 MB ceiling (refused, never truncated), no cookies and no redirects followed.
  - **Politeness:** at least 1 s between requests to a host, and a stop on 429 (`RATE_LIMITED`) or 401/403 (`ACCESS_DENIED`).
  - **Other pieces:** credential redaction, an RSS reader, title-term matching and a material-field content hash.
- **Verified adapters:** Greenhouse, Lever, Ashby, SmartRecruiters, Remote OK, We Work Remotely, Himalayas (cursor paging) and Working Nomads. Each was verified with one approved live request and a committed fixture of at most three items with metadata; SmartRecruiters with `BoschGroup` after `Visa` returned an empty board. SmartRecruiters pages its list by offset (verified with one approved page-2 request) up to the 5-page cap, so a run sees at most the newest 500 postings, and spends its 25 detail requests per run on unseen postings first (oldest first), then on stored postings by oldest last check. Adzuna is registered but unverified and disabled.
- **Discovery and normalization:** only listings whose title contains a Customer Success role-family term are kept, with the full description. A retrieved-listing normalizer records DIRECT provenance for structured facts. Salary is normalized only as one annual range with a known currency; residency only from explicit statements; time zones never.
- **Storage and ingestion** (migration `20261018090000_retrieval_sources`, additive):
  - `RetrievalSource` and `RetrievalRun`. Sources or runs with history are archived, never deleted.
  - Re-observation: an unchanged listing only moves last-seen times, and a changed one adds a linked observation while the original description stays.
  - Canonical-link precedence: employer ATS over job board over aggregator, and a manual link is never replaced.
- **Deduplication engine `core-dedup-v2`:** source-scoped listing IDs, with listing-ID conflicts only within one source.
- **Worker, UI and tooling:**
  - `pnpm worker:retrieval`: a single worker, a 12-hour default schedule, sources disabled until enabled, per-listing failure isolation and no automatic evaluation.
  - `/sources` with run history; "Found via" and "Listing changed" on the dashboard and opportunity page.
  - `pnpm sources:verify`, and read-only retrieval checks in `pnpm app:doctor`.
- **New versioned specifications:** Core AI Framework PRD v1.7, Customer Success AI Assistant PRD v1.6, Core Platform TDD v1.8 (§51 "Automated Retrieval (Feature 11A)") and Customer Success Assistant TDD v1.6 (dated implementation notes in §6–§8 and §49). The previous versions moved unchanged into `Archive/`; the Semantic Evaluation Playbook is unchanged (v1.3).

### Features 1–10 Gap Closure (October 17, 2026)

- A read-only audit of main-product features 1–10 against the current PRDs/TDDs found that feature 9 (deduplication with provenance retention) was missing, plus smaller gaps in features 2, 3, 6, 7 and 8. The gap closure addresses them; there is no task number by decision.
- **Deduplication** (`packages/deduplication`, engine `core-dedup-v1`):
  - **MATCH:** the same listing URL with nothing conflicting, or the same job/requisition ID at the same company. An exact re-capture is attached to the saved opportunity as another source instead of becoming a second opportunity.
  - **PROBABLE_MATCH:** confidence-scored. The opportunity is created and the pair is recorded for review; nothing is merged on a probable match.
  - Capture is one transaction (raw source record, decision, create or attach); a normalization failure still preserves the raw record.
  - "Not the same job" (`DISTINCT`) is reversible.
  - Existing opportunities are never merged retroactively.
- **Duplicate-spend guard:** a paid evaluation request or deferred resume is refused (409 `DUPLICATE_LISTING_ALREADY_EVALUATED`) while an exact duplicate already has an evaluation, admission or deferral. The check and admission are serialized by an advisory lock, closing the race between simultaneous requests. The Task 6 admission gate is unchanged.
- **Companies:** reused by normalized name, with the typed spelling kept in provenance; one dashboard company-filter entry per company. `pnpm db:backfill-dedup [--dry-run]` is explicit, additive and idempotent, and is not part of `pnpm app:setup`; `pnpm app:doctor` reports when it is needed.
- **Also:**
  - versions on evaluation-history rows;
  - an optional user-stated time-zone requirement, withheld from the evaluator;
  - AI usage and spend by domain and source on `/budget`;
  - phone-width overflow fixes on the opportunity page and `/profile`.
- **Migration:** `20261017120000_deduplication`, additive only.
- **New versioned specifications:** Core AI Framework PRD v1.6, Customer Success AI Assistant PRD v1.5, Core Platform TDD v1.7 and Customer Success Assistant TDD v1.5. Their status sections and the Core TDD §51 deduplication summary are updated; the requirements are unchanged. The previous versions moved unchanged into `Archive/`. The Semantic Evaluation Playbook is unchanged (v1.3).
- **Verification** (isolated test database, no paid calls): unit 1,128, integration 223, E2E 32/32. No evaluator internals, routing, prompts or recommendation logic changed.
- Commit: `feat: close features 1–10 gaps` on `claude/gallant-pasteur-y1ou3i`.

### Post-Task-9 versioned specification update (October 16, 2026)

- New current versions: Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3.
- The previous current PRD/TDD versions moved unchanged into the `Archive/` folders; Playbooks v1.1 and v1.2 stay beside v1.3.
- Core AI Framework PRD v1.5 and Customer Success PRD v1.4: current status after the Task 1–9 completion pass, and the evaluator-branch semantic-contract repairs noted as effective at final integration. Product requirements are unchanged.
- Core Platform TDD v1.6:
  - documents the `USAGE_LIMIT_REACHED` deferral reason and the legacy `BUDGET_UNAVAILABLE` mapping;
  - completes the neutral "eligible for evaluation" wording;
  - adds implementation-status summaries for the application tracker and for the operations and worker model.
- Customer Success TDD v1.4: a per-branch table of evaluator contract versions and the October 10–13 evaluator-branch rules, effective at final integration. The evaluation design body is unchanged until then.
- Semantic Evaluation Playbook v1.3 adds §14 with the October 10–13 semantic-contract rules (on `codex/evaluator-live-diagnostic`), plus dated notes in §11 and §13.
- `AGENTS.md` and `CLAUDE.md` point to the new versions. Documentation only; no code, test, database or provider activity.

### Task 9 completion — operational hardening (October 16, 2026)

- Completed the audit-first completion pass over the October 10 Task 9 operations work. The worker loop, single-worker lock, task claiming, recovery, error classification, backoff, shutdown, queue states, AI-configuration handling, health behavior, public evaluation API, navigation and acceptance tests were audited as complete and left unchanged.
- `POST /api/opportunities` and `GET /api/opportunities/[id]` now log only the error name, like every other route; response bodies are unchanged.
- `pnpm app:doctor` reports requests waiting for the AI budget (including legacy `BUDGET_UNAVAILABLE` rows) separately from those waiting for usage limits (`USAGE_LIMIT_REACHED`). It remains a single read-only query.
- E2E runs always use a deterministic, non-live `OPENAI_API_KEY` (`playwright.config.ts`, `e2eEnvironment()`), so the runner, its helpers and the web server never inherit a real key from `.env`.
- New unit tests cover `/api/health` (200 and 503 with no error detail), error-name-only logging in both routes, and the E2E credential; the integration suite checks the doctor's per-reason deferral counts. `vitest.config.ts` resolves the web app's `@/` alias.
- The root `README.md` documents usage-limit deferrals, the E2E credential, and the single-worker lock's connection-loss caveat (the lock holds only while its database connection stays up; documented, not changed).
- No migration; no queue, worker, lease, routing, prompt or evaluator change. Verified on an isolated test database with no paid calls: unit 1,086, integration 192, E2E 27/27.
- Commit: `feat: complete operational hardening` on `claude/gallant-pasteur-y1ou3i`.

### Task 8 completion — application tracker (October 16, 2026)

- Completed the audit-first completion pass over the October tracker; the stages, outcomes and lifecycle model are unchanged.
- Calendar dates:
  - applied and closed dates cannot be later than the current UTC date;
  - a close cannot precede the applied date;
  - an applied-date correction cannot follow the closed date;
  - refusals return `APPLICATION_DATE_INVALID` (400) with no trace.
- Follow-ups can be rescheduled and reworded through the versioned `updateFollowUp` command, recorded as a `FOLLOW_UP_UPDATED` event. Additive migration: `20261017090000_application_follow_up_updated`.
- Interviews have full editing; the status can be chosen when adding; "Move to Interviewing?" appears only for a non-cancelled interview.
- Only open applications of non-archived opportunities have a next action. The rule applies consistently to follow-up filters, tracker tiles, the next-action sort, dashboard badges and the "Follow-ups due" count.
- `/applications`:
  - an outcome or Closed filter under Active widens the view to All;
  - empty results recover inside the tracker.
- Stale writes:
  - typed input is kept on every refusal;
  - "Load latest" is offered only for state and concurrency conflicts.
- Tracking refusals name the opportunity's state; the opportunity page shows a load-error notice.
- The guarded lifecycle path and the evaluator are unchanged. Verified on an isolated test database with no paid calls (E2E 27/27).
- Commit: `534a4c7` on `claude/gallant-pasteur-y1ou3i`.

### Final evaluator routing lock (October 15, 2026)

- Kept deterministic execution for Hard Filters, Ghost Job Risk when objective posting-history evidence is unavailable, and Final Recommendation.
- Kept GPT-5.6 Terra for JD Reconstruction and Resume Match.
- Kept GPT-5.6 Luna for Job Evaluation, Organizational Maturity, Alex Fit, and Opportunity Priority.
- Routed Company Alignment and Burnout Risk to GPT-6 Luna.
- Rejected GPT-6 Luna for Job Evaluation after the isolated benchmark changed Strategic Bridge Value from `HIGH` to `MODERATE` and omitted established process-development evidence.
- Skipped the remaining GPT-6 stage benchmarks by explicit product decision and locked the routing policy rather than continuing paid experimentation.
- Final live/whole-product acceptance remains deferred until the evaluator and all intended main-product work are integrated.
- Branch state: the GPT-6 Luna routes are implemented on `codex/evaluator-live-diagnostic`; `claude/gallant-pasteur-y1ou3i` keeps the earlier accepted routing until final integration.

### Task 6 completion — AI budget and usage controls (October 14, 2026)

- Completed the persistent monthly AI budget ledger, atomic reservation/reconciliation, configurable warning thresholds, daily/weekly evaluation-volume limits, monthly output-token limits, budget deferral/resume/cancel flow, usage reporting, and dashboard capacity/cost visibility.
- Standardized dollar-budget deferrals on `AI_BUDGET_LIMIT`; throughput/token limits use `USAGE_LIMIT_REACHED`.
- Preserved unknown provider usage as Unknown rather than coercing it to zero.
- Accepted the product decision that already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered.
- Checkpoints: `267138a` and naming cleanup `8d3993a`.

### Task 7 completion — normalized opportunity facts (October 14, 2026)

- Added deterministic normalization and persistence for salary minimum/maximum, currency, work arrangement, seniority, department, employment type, closing date, residency requirement, and residency regions while preserving raw text and field provenance.
- Added supported residency geography codes for countries, U.S. states/DC/Puerto Rico, Canadian provinces/territories, UK nations, and broad regions such as EU, EEA, EMEA, APAC, LATAM, and WORLDWIDE.
- Preserved Unknown for ambiguous geography, ordinary city/location text, conflicting currencies, non-annual compensation, OTE, and unsupported cases.
- Added the bare-`$` USD provenance marker while keeping explicit currency authoritative.
- Added dashboard salary/filter/sort support and residency-aware persisted data without silently changing evaluator behavior during Task 7.
- Final Task 7 checkpoint: `754f956dc0860149760936a61bdace0489404b9a` on `claude/gallant-pasteur-y1ou3i`.

### Milestone 4 completion alignment — salary policy and Task 7 contract (October 15, 2026)

- Updated Customer Success Hard Filters to consume the Task 7 salary/currency/residency contract.
- U.S.-residency-required roles now use a hard `$60,000 USD-equivalent` minimum: `$60,000+` Pass; below `$60,000` Fail/Skip; no U.S. Review band and no salary maximum.
- Non-U.S.-eligible roles use: `$60,000+` Pass; `$55,000–$59,999.99` Review; `$50,000–$54,999.99` conditional Review only when explicit configured location/cost context supports viability, otherwise Unknown; below `$50,000` Fail/Skip.
- Residency requirement selects the policy; salary currency does not.
- Added versioned FX handling under `cs-salary-policy-v2-ecb-2026-10-14` using reproducible ECB euro-reference cross-rates. No converted salary values are persisted.
- A disclosed minimum is the salary gate. Max-only salary remains Unknown unless the stated maximum is itself below the applicable floor.
- Released `salaryMin`, `salaryMax`, `currency`, `residencyRequirement`, and `residencyRegions` with provenance to the evaluator; `remoteStatus`, `seniority`, `department`, `employmentType`, and `closingDate` remain withheld pending later coordinated adoption.
- Version identifiers advanced to `cs-evaluation-v1.2-m9`, `customer-success-v1.2`, `cs-rules-v1.2`, and `cs-hard-filters-v2` (on `codex/evaluator-live-diagnostic`) without changing prompt/model versions as part of this correction.
- Focused offline verification passed without provider calls or normal-database use. Broader DB-backed integration, E2E, web build, live calls, and final Task 7→evaluator acceptance remain intentionally deferred to the later whole-product integration pass.
- Commit: `267124f fix(cs): align Milestone 4 salary policy with Task 7` on `codex/evaluator-live-diagnostic`. Not yet merged: on `claude/gallant-pasteur-y1ou3i`, `fieldsWithheldFromEvaluator` still withholds all ten Task 7 fields and the earlier version identifiers remain until final branch combination.

### Product completion planning (October 15, 2026)

- Main-product scope is features 1–18. Retrieval, source health, posting-history intelligence, the browser extension, source intelligence, market analytics, personal job-search analytics, and company intelligence are part of the intended main product rather than optional post-product add-ons.
- Only features 19–23 remain later add-ons: company watchlists, proactive notifications/follow-ups, calendar integration, email integration, and application-assistance features.
- The current sequence is: finish the Task 1–9 completion pass (Task 8 next, then Task 9), build any still-missing main-product features 1–18, then perform final evaluator/product integration, whole-product acceptance, and deliberate freeze/merge.
- Retrieval work may begin after the evaluator and manual product are stable enough to support it, but final product acceptance does not occur until all intended main-product features are complete.
- Kept evaluator and main-product workstreams separated to reduce architectural drift.

### Profile limitations and policy readiness (October 14, 2026; added October 16, 2026 from Git)

- Persisted optional structured profile `limitations` (`UserProfile.limitations`) and delivered them to the evaluator subject without loosening the installed profile contract. Commit `96c6eb1`.
- Removed a stale execution-policy pin and prepared the profile/policy integration; `pnpm app:doctor` reports the evaluator's built-in policy version. Commit `35b8265`.

### Evaluator semantic-contract stabilization (October 10–13, 2026; evaluator branch, not merged; added October 16, 2026 from Git)

- Recorded on `codex/evaluator-live-diagnostic`; not part of the main-product branch until final integration.
- Changes:
  - provider prose is display-only;
  - Genuine Gap proof uses structured `gapEvidence` and structured profile limitations;
  - requirement-relative experience levels;
  - structured `requirementStatements` with deterministic reconciliation;
  - requirement-relative INDUSTRY evidence;
  - Unknown without supported or unsupported portions;
  - a fail-closed `RESUME_MATCH_PREREQUISITE_OUTDATED` gate.
- Contract identifiers on that branch: `cs-jd-reconstruction-v7`, `cs-resume-match-v4`, `cs-organizational-maturity-v7`.
- Commits:
  - `ba95d76` (Oct 11, work-in-progress handoff; introduces the GPT-6 Luna policy code);
  - `04611af` and `1c09924` (Oct 11);
  - `7149563` and `f29530c` (Oct 12);
  - `067c5dc` (Oct 13).
- Offline verification only. Final paid acceptance and current-contract cost measurement remain outstanding. See `EVALUATOR_STATUS.md` §20.

### Main-product Tasks 1–9: initial implementation (October 6–7, 2026; added October 16, 2026 from Git)

Commit dates are from Git. The task records in `CURRENT_PROGRESS.md` and `HANDOFFS.md` carry dates from October 6 to October 10; those record dates are preserved as written.

- October 6:
  - opportunity dashboard and Domain default (`ccd3761`);
  - evaluator test-harness repair (`a0e225c`);
  - evaluation-experience correctness under failure and delay (`0639785`);
  - evaluation of any normalized opportunity (`27c897e`);
  - opportunity lifecycle and user actions (`f129d40`);
  - AI usage and estimated-cost display (`440306a`);
  - job provenance foundation (`26dbdb5`);
  - agent-guide documentation paths (`e3e6d5e`).
- October 7:
  - Task 5, profile and preferences management with an explicit active version (`68f25c9`);
  - Task 6, AI budget ledger with deferral and request-integrity admissions (`ccd80c9`);
  - Task 7, dashboard search, filters, sorting, pagination and summaries (`a0d99a5`);
  - Task 8, application tracker beside the opportunity lifecycle (`f884b72`);
  - Task 9, final setup, operations hardening and whole-product acceptance (`b7f7e87`).

---

## Earlier Unreleased Entries (recorded before October 15, 2026; added to the repository October 6, 2026)

*Preserved as recorded before the October 15, 2026 updates above. The remaining evaluator sequence and development order below have since been completed or superseded (October 15 routing lock; main-product scope of features 1–18).*

### Evaluator finalization

- Accepted Resume Match Optimization #2 as the current Resume Match baseline.
- Retained JD Reconstruction State2 as the accepted JD Reconstruction optimization after rejecting more aggressive sparse-omission candidates.
- Reduced projected full-evaluator cost from `$0.2566362` to approximately `$0.2026282`.
- Preserved semantic safeguards around evidence, provenance, Unknowns, contradictions, seniority, specialization, and direct/related/transferable experience.
- Established final optimization acceptance rule: same or better required quality at the same or lower total cost.
- Established the current remaining evaluator sequence:
  1. benchmark GPT models stage-by-stage;
  2. lock final routing;
  3. run one final full evaluator;
  4. freeze the evaluator baseline.
- Established a verification rule that actual production request/state takes precedence over helper-derived fingerprint reproduction when full candidate identity already matches.

### Product completion planning

- Confirmed development order:
  - finish evaluator;
  - finish remaining main-product work in parallel;
  - combine into a usable product;
  - build retrieval/scraping afterward as an ingestion layer into the existing normalization/evaluation pipeline.
- Kept evaluator and main-product workstreams separated to reduce architectural drift.
- Deferred automated retrieval/scraping until after the manually usable product is complete.

---

## Evaluator Cost Optimization Phase

### Resume Match Optimization #2

- Reworked the provider-visible Resume Match schema to reduce runtime-expanded requirement-assessment structure.
- Rejected an ultra-compact candidate after live inference produced invalid semantic combinations despite passing offline replay.
- Restored provider-visible compatibility constraints without weakening domain validators.
- Accepted final live Optimization #2 result:
  - input: `20,560` tokens;
  - total: `27,048` tokens;
  - cost: `$0.1189760`;
  - quality: SAME;
  - cost: BETTER.
- Confirmed downstream compatibility through Opportunity Priority, Ghost Job Risk, and Final Recommendation.
- Made Resume Match Optimization #2 the new accepted Resume Match baseline.

### JD Reconstruction Optimization #2

- Tested more aggressive sparse-omission variants.
- Rejected v6 because cost improved but semantic quality degraded.
- Rejected v7 because quality degraded and cost increased.
- Retained JD Reconstruction State2 as the accepted baseline.

### JD Reconstruction Optimization #1

- Compacted provider schema and provider-visible payload.
- Restored application-owned metadata deterministically after provider output.
- Reduced:
  - provider schema from `11,395` to `6,361` bytes;
  - production payload from `6,015` to `2,949` bytes.
- Accepted State2 at `$0.0542460`.

### Resume Match Optimization #1

- Compacted the provider-facing Resume Match transport.
- Corrected regressions affecting startup safeguards and narrative citation behavior.
- Reduced:
  - input tokens by `35.12%`;
  - total tokens by `30.92%`;
  - cost from `$0.1714280` to `$0.1372300`.
- Commit:
  - `7ec73f8 perf: compact resume match provider transport`

---

## Terra/Luna Routing and Semantic Stabilization

### Final accepted routing

- Deterministic:
  - Hard Filters
  - Ghost Job Risk when no objective posting-history evidence is available
  - Final Recommendation
- GPT-5.6 Terra:
  - JD Reconstruction
  - Resume Match
- GPT-5.6 Luna:
  - Job Evaluation
  - Company Alignment
  - Organizational Maturity
  - Alex Fit
  - Burnout Risk
  - Opportunity Priority

### Final accepted mixed-model evaluation

- Completed a full live mixed-model evaluation successfully.
- Final recommendation: `REVIEW`.
- Accepted evaluation ID:
  - `437dcca0-f299-4066-b8d3-fe949c124ce3`
- Completed with:
  - `8` provider calls;
  - `0` retries;
  - `0` fallbacks.
- Accepted total evaluator cost:
  - `$0.2566362`
- This run became the semantic-quality baseline for the later cost-optimization phase.

### Opportunity Priority contract repair

- Fixed invalid evidence identifiers returned by the provider.
- Replaced free-form semantic evidence labels with bounded numeric evidence indexes and deterministic restoration.
- Accepted isolated Opportunity Priority verification after the repair.

### Resume Match transport and evidence repairs

- Stabilized:
  - direct / related / transferable distinctions;
  - evidence-basis compatibility;
  - specialization safeguards;
  - job-only seniority;
  - duplicate-evidence handling;
  - assessment-local decision-impact evidence;
  - Genuine Gap and Unknown behavior.
- Added partition-integrity validation so decision-impact and assessment-only evidence references cannot overlap.
- Commits:
  - `1b1bade fix: redesign resume match decision impact transport`
  - `e9c3f47 fix: enforce resume match partition integrity`

### Terra/Luna comparison outcomes

- Retained Terra for JD Reconstruction after Luna produced:
  - inflated strengths;
  - overstated responsibilities;
  - omitted Education ownership.
- Retained Terra for Resume Match because it remained the most judgment-sensitive stage and no accepted Luna replacement was established.
- Accepted Luna for six bounded semantic stages after calibration and contract stabilization.

### Original all-Terra production baseline

- Completed the first successful full production evaluation using Terra for all semantic operations.
- Final recommendation: `REVIEW`.
- Total tokens: `125,670`.
- Estimated cost: `$0.4528088`.
- Known checkpoint:
  - `a7a0a47 feat: complete Customer Success evaluation foundation`

---

## Milestone 10 — Results Interface and Manual-JD Vertical Slice

- Completed the Customer Success results experience.
- Added:
  - evaluation request flow;
  - queued/running/completed/failed states;
  - bounded polling;
  - polling cleanup;
  - duplicate active-submission prevention;
  - persisted recommendation display;
  - strengths, concerns, Unknowns, and review conditions;
  - expandable stage details;
  - JD versus profile evidence distinction;
  - contradiction display;
  - safe JD text rendering;
  - evaluation history;
  - reevaluation behavior that preserves prior successful results;
  - accessible and responsive results UI.
- Completed the deterministic manual-JD end-to-end product flow.

---

## Milestone 9 — Production Evaluation Workflow

- Added durable PostgreSQL-backed evaluation task execution.
- Added:
  - request/status APIs;
  - worker execution;
  - task leasing;
  - retries and recovery;
  - persisted stage/evidence/recommendation state;
  - model usage recording;
  - restart-safe per-evaluation call budgets;
  - resume-from-persisted-stages behavior.
- Introduced OpenAI Responses structured-output execution.
- Added worker commands:
  - `pnpm worker:evaluations`
  - `pnpm worker:evaluations:once`

---

## Milestone 8 — Opportunity Priority, Ghost Job Risk, and Final Recommendation

- Added:
  - Opportunity Priority;
  - Ghost Job Risk;
  - deterministic final `APPLY`, `REVIEW`, or `SKIP`.
- Kept Final Recommendation outside the numbered stage sequence.
- Established deterministic `UNKNOWN` for Ghost Job Risk when objective posting-history evidence is unavailable.
- Preserved a nine-stage evaluator architecture plus deterministic finalization.
- Did not introduce a universal Overall Match score.

---

## Milestone 7 — Resume Match and Effective Seniority

- Added Resume Match as Stage 7.
- Nested Effective Seniority inside Resume Match rather than creating a separate stage.
- Added requirement-level classifications:
  - `STRONG_MATCH`
  - `TRANSFERABLE_MATCH`
  - `PARTIAL_MATCH`
  - `GENUINE_GAP`
  - `UNKNOWN`
- Added evidence-backed score/band handling and seniority classifications.
- Preserved separate JD and profile evidence validation.

---

## Milestone 6 — Alex Fit and Burnout Risk

- Added:
  - Alex Fit;
  - Burnout Risk.
- Kept Alex Fit categorical rather than percentage-based.
- Added explicit separation of:
  - direct experience;
  - related experience;
  - transferable experience.
- Added holistic burnout-risk scoring with explicit risk contributors and positive workload indicators.

---

## Milestone 5 — Company Alignment and Organizational Maturity

- Added:
  - Company Alignment;
  - Organizational Maturity.
- Reused structured maps and validated prior-stage results instead of rereading the raw JD.
- Used a holistic bounded maturity score rather than a hidden weighted formula.
- Preserved uncertainty where company facts were not established.

---

## Milestone 4 — Customer Success Domain Foundation and JD Reconstruction

- Introduced the first Customer Success-specific evaluator logic.
- Added:
  - Customer Success domain registration;
  - typed preferences;
  - JD Reconstruction;
  - Responsibility Map;
  - Requirement Map;
  - Ownership Map;
  - Hard Filters;
  - Job Evaluation;
  - Strategic Bridge Value.
- Preserved evidence, Unknowns, and contradictions.
- Reused the existing Core runner without refactoring Core for the domain.
- Established the Customer Success salary hard-filter rules and role-classification taxonomy.

---

## Milestone 3 — Shared Core Evaluation Framework

- Added the reusable domain-neutral evaluation framework.
- Added:
  - ordered stages;
  - structured stage results;
  - stage validation;
  - shared evaluation context;
  - evidence records;
  - Unknown handling;
  - contradictions;
  - retryable isolated failures;
  - evaluator/version metadata;
  - evaluation persistence.
- Kept Customer Success logic out of Core.
- Established the core principle:

> Core supplies infrastructure and execution behavior; domains supply career-specific intelligence.

---

## Milestone 2 — Manual Opportunity Ingestion and Persistence

- Added the first real product data slice:
  - manual opportunity input;
  - raw source preservation;
  - deterministic normalization;
  - field provenance;
  - PostgreSQL persistence;
  - retrieval;
  - opportunity detail UI.
- Added the initial database migration:
  - `20260812230155_init`
- Added APIs:
  - `/api/opportunities`
  - `/api/opportunities/[id]`
- Stabilized Playwright automatic server startup.
- Known commits:
  - `4d90d1e Completed Milestone platform 2`
  - `344fece Fix Playwright E2E server startup`
- Final tag:
  - `milestone-2`

---

## Milestone 1 — Repository and Platform Foundation

- Established the permanent pnpm-workspace modular monolith.
- Added:
  - Next.js;
  - React;
  - TypeScript;
  - Prisma;
  - PostgreSQL-oriented persistence;
  - Vitest;
  - Playwright;
  - Chrome-extension application boundary.
- Established separation between Core infrastructure and domain-owned logic.
- Added initial data-model foundations for opportunities, sources, companies, provenance, evaluations, evidence, contradictions, and recommendations.
- Deliberately avoided a universal Overall Match score.
- Known commit:
  - `482ecf7 Completed Milestone platform 1`
- Known tag:
  - `milestone-1`

---

## Historical Notes

- Milestone-specific details, test counts, bugs, and deferred work are documented in `MILESTONES_1_10.md`.
- Evaluator routing, live evaluation history, request IDs, optimization details, rejected candidates, and current completion status are documented in `EVALUATOR_STATUS.md`.
- PRDs describe intended product behavior.
- TDDs describe technical architecture and implementation contracts.
- The Semantic Evaluation Implementation Playbook records evaluator engineering and verification practice.
