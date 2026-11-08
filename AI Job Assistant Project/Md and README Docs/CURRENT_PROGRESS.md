# Current Progress

**Project:** AI Career Platform / AI Job Assistant  
**Last updated:** November 8, 2026

## Mode B Rev 3 — November 7 Live Round Follow-up (November 8, 2026; implemented, verified offline and approved by Alex; LinkedIn acceptance pending)

WTTJ Mode B Rev 3 was accepted by Alex in the November 7 live round. LinkedIn Mode B is not accepted: three jobs were read live, then LinkedIn answered HTTP 429. Evidence: the November 7 diagnostic package (`aija-linkedin-nov7-rate-limit`: worker log, timeline, capture items, page evidence of the four reads) and E5 (read-only acceptance-database export: the stored texts of TENEX.AI, Nearmap, Thomson Reuters and ServiceTitan, the WTTJ version timestamps, the LinkedIn job states, the November 7 worker log).

- **L1, why LinkedIn stopped (confirmed by the worker log):**
  - 18:47 UTC, a worker with no browser configured recovered the 20 interrupted LinkedIn jobs and moved all 20 to Awaiting details (`NO_BROWSER`) without opening any page (no read or navigation event).
  - 18:51 UTC, a restart without a browser found nothing due.
  - From 18:57 UTC a worker with a browser found nothing due either: the 20 jobs needed a Retry each. Four Retries gave four passes, each launching a fresh logged-out browser and opening one page:
    - TENEX.AI (19:10) 200, Thomson Reuters (19:13) 200, Nearmap (19:14) 200;
    - listing 4473692916 (19:15:13) answered **HTTP 429** after 1.0 s.
  - `RATE_LIMITED` is set only for an HTTP 429 main document (a sign-in wall or challenge is `ACCESS_STOPPED`; a failed load is a one-hour deferral). The requests were 1–3 minutes apart, far wider than the 5 s pacing, never overlapping or repeated (one worker, its lock held, one navigation per pass, no retry), so pacing did not cause it.
  - The handling matched the contract: the job and the site's other queued jobs waited uncounted; LinkedIn was stopped until 2026-11-08 19:15Z.
  - State in the acceptance database: 8 LinkedIn jobs added (the 5 of November 5 and these 3), 16 waiting as Awaiting details (`NO_BROWSER`, never charged), 1 queued behind the stop.
  - Earlier evidence agrees that LinkedIn's logged-out budget is small and varies: the first logged-out request on October 20 answered 429; 5–6 pages at 5 s spacing passed on November 3 and November 5.
- **Confirmed defects and fixes:**
  - *No browser forced a Retry per job* (`page-capture-acquisition.ts`, `page-capture-repository.ts` `holdForBrowser` / `releaseBrowserHold`, `page-capture-labels.ts`): a worker without a browser no longer claims jobs; they wait in the batch, uncounted, shown as "Waiting: No browser is configured…". A worker with a browser returns them, and jobs an earlier version parked in Awaiting details as `NO_BROWSER` (never charged), to the batch automatically. Jobs waiting behind a site stop now say "Waiting: The site asked us to slow down…" instead of "Getting details".
  - *L2 TENEX.AI* (`job-text-facts.ts` office-first reading, both normalizers, `formatArrangementWithExceptions` on the job page): the posting expects people to "relocate and commute" for "in-person work" and offers fully remote work only to "the rare '10x of 10x' talent". It is now Hybrid, with the exception recorded as its own provenance row (`…:remote-by-exception`), and the job page shows "Hybrid, with remote availability only by exception" (lists show Hybrid). No office days, residency or salary are inferred. The rule needs both statements; an explicit on-site or hybrid statement, or stated options, take precedence.
  - *L3 Nearmap* (`job-text-facts.ts`, `residency.ts`, `opportunity-facts.ts`): "Role Location: Fully remote within the continental United States." was not read. "Role/Position Location:" is now a location label: Remote. "Continental/contiguous U.S." or "lower 48" in a statement placing the role or its candidates is U.S. residence excluding Alaska and Hawaii, shown as "Continental U.S. residence required (excluding Alaska and Hawaii)". The Lehi, UT location stays as stated; the overseas-work benefit and statements about customers add nothing. This also refines the 14B Wellfound (Instrumentl) case ("based in the continental U.S."), which keeps U.S. residence and now states the two exclusions.
  - *L4 Thomson Reuters* (`compensation.ts`, `opportunity-facts.ts`): "the target total cash compensation range for this role is $106,400 USD - $197,600 USD", with "inclusive of both base pay and any target sales incentive" stated separately, was a bare range. Target total cash (also total target cash, target cash compensation) is now on-target pay; a mention of base pay inside such a statement never makes it base salary. On-target pay is shown as "(OTE: base salary plus target variable pay)". The closing date (12/31/2026) and the absence of an arrangement (work from anywhere 8 weeks a year is a benefit) are unchanged.
  - *W2 WTTJ dates* (`opportunity-provenance.tsx`, the shared page-capture ingestor): E5 shows every November 7 refreshed version stored on 2026-11-07 with `discoveredAt` and `lastObservedAt` of 2026-11-04 23:40, and each job's last seen left at November 4. The batch ingestor passed the card's first sighting as the time of every read. Now a refresh records the read's time as the new version's discovery time, its last observation and the job's last seen (a first read keeps the first sighting). "Latest change found" and each version's "found" date use when the version was stored. Existing rows are not rewritten: their last seen advances at their next refresh.
- **Not a defect:**
  - *W1 ServiceTitan*: the November 7 version of the ServiceTitan Customer Success Manager job (`4e1bc62a`, read complete, reader revision 1) holds the job-specific Workday link (basis page apply link), and so does the saved job. The ServiceTitan job without a link is a different listing, Senior Customer Success Manager (Strategic Accounts) (`1d84d84c`), saved on November 5 from structured data only and not on the November 7 page. Its next save reads it again (outdated reader revision).
  - *LinkedIn apply links*: the three November 7 pages, rendered and as sent, carry no `code#applyUrl` and no employer link. Apply is a sign-in modal button (TENEX.AI, Thomson Reuters) or LinkedIn's own apply (Nearmap), so "Apply on LinkedIn (listing page)" is the right result for logged-out reads.
- **Architecture finding (no change made):**
  - LinkedIn's logged-out page budget, not pacing, limits a 25-job batch.
  - The page as LinkedIn sends it already holds the complete job description (identical to the rendered page on all three real pages), so running its scripts adds requests and no content. Reading the sent page without running its scripts could cut the extra requests per job; whether LinkedIn counts those is unknown, so this is an option for a controlled live test, not a change.
  - The results page the user loaded holds only the cards' title, company and location, not the descriptions, so a separate read per job remains necessary.
  - Reading details in the user's own signed-in Chrome (as WTTJ does) would not use the logged-out budget, but acts within the user's LinkedIn account; that is a product and risk decision for Alex.
- **Verified (offline; `ai_career_assistant_test` only; no live request):** typecheck, lint, Prisma validate, extension build, `db:verify-migrations` (28), `git diff --check`: pass. Unit 2,303 passed / 6 skipped (103 files, 1 skipped), including `mode-b-nov7-linkedin.test.ts` (12, the three real texts from `tests/fixtures/real-captures/mode-b-e5-linkedin-nov7.json`) and two new restriction-classification cases in `mode-b-diagnostics.test.ts`. Integration 418/418: the 25-job hold-and-release on the real repository, and a refresh dated by its read. E2E 60/60: the Retry/Dismiss test now reaches Awaiting details through a page unreadable three times, not through a missing browser. Tests changed for intended behaviour only: the "(OTE)" wording (three assertions), the old no-browser expectation, and the reader's output shape (the new `remoteByException` field).
- **Approved by Alex (November 8, 2026)** as targeted repairs verified offline; this is not LinkedIn Mode B acceptance and not authorization for a live LinkedIn test.
- **Open:** LinkedIn live acceptance. On the next authorized run after the stop, the worker attempts the 16 + 1 waiting jobs automatically (no Retry); given LinkedIn's confirmed HTTP 429 limits, all 17 completing in one run is not guaranteed: a 429 stops the site for at least a day with nothing counted, and the remaining jobs resume on their own after it. The five November 5 jobs are refreshed on the next save of their page. Next scope, for Alex's approval: Option A (LinkedIn's page as sent, without running its scripts) before any signed-in-browser approach. The acceptance database was only read (E5).

## Mode B Rev 3 — Final E4/E4b Evidence, Repair Review, Persistent Diagnostics and Offline Acceptance (November 6, 2026; implemented and verified offline on top of `58ef504`; not committed, awaiting Alex's approval)

- **Evidence conclusion (E4/E4b, closed):** the November 5 LinkedIn batch (25 jobs, run at `144fa6c`) ingested AlertMedia, Juniper Square, Dataminr, FourKites and Critical Start (each handed off as `USER_PROFILE_NOT_FOUND`, expected with no active profile). The sixth job claimed was **TENEX.AI (LinkedIn 4372638963)**: left ACQUIRING, 0 attempts, no Opportunity, no SourceRecord, and no other SourceRecord write in the window. The worker therefore failed while processing TENEX.AI, after the fifth ingestion and before anything of TENEX.AI was committed. **Which transaction raised the P2028 is not proven:** the evidence cannot separate TENEX.AI's capture transaction (`ingestRetrievedListing`, 15 s / 30 s at `144fa6c`) from the preservation of an unnormalized listing (`preserveUnnormalizedListing`, Prisma's 2 s / 5 s defaults at `144fa6c`) or another transaction-lifecycle failure, because the historical log kept only the error code and no worker log or raw page survived (E4b Windows and WSL searches found none). Historical search is closed.
- **Audit of `58ef504` (contracts A–J):**
  - A worker resilience and DB_PENDING accounting, G selective refresh, H evidence-based updates, I Captured Jobs display: present and verified; no gap (now also verified by the TENEX.AI scenarios below).
  - B transaction consistency: every capture-lock transaction had explicit options; the retrieval-run transactions (`claimNextRun`, `finishRun`, `recordListingObservations`) still used Prisma's defaults, and `stageBatch` errors carried no transaction name. Hardened.
  - C LinkedIn application routes: steps 1 (employer/ATS link, 14B) and 3 (labelled listing fallback) present; **step 2 (the link from the page as received, when scripts remove it after load) was missing.** Implemented.
  - D regional salary, E residency exclusions and remote status, F deadline wording: the generic mechanisms passed their synthetic regressions, but the real stored texts (final check below) exposed three defects, now fixed.
  - J historical 14B regressions (SafeBreach; QAD and ServiceNow / SmartRecruiters; INNERGY and Renaissance Learning / Remote OK; Dropbox and NLBM / We Work Remotely; ServiceTitan / Workday; Wellfound): 8 suites, 195 tests, all pass.
  - Persistent diagnostics: absent (console lines only). Implemented (below).
- **Corrections (uncommitted):**
  - Confirmed gaps fixed: received-HTML apply link (`packages/discovery/src/browser.ts`: the page as the site sent it, `servedHtml`, from the same response, no second request; `packages/browser-retrieval/src/index.ts`; `page-capture-acquisition.ts`: LinkedIn only, used only when the rendered page has a posting but no employer link, basis `PAGE_APPLY_LINK`; route recorded as `EMPLOYER_LINK_RENDERED`, `EMPLOYER_LINK_SERVED` or `LISTING_FALLBACK`). Persistent diagnostics and page evidence (below). A sanitizer defect found by its own test in the new code (`Authorization: Bearer <token>` kept the token) was fixed before use.
  - Preventive hardening (not tied to the November 5 evidence): explicit 15 s / 30 s options and names for the retrieval-run transactions (`database/src/transaction-diagnostics.ts`); `stageBatch` named; the capture repository's duplicate naming helper replaced by the shared one.
  - Not changed (unproven): which P2028 occurred; whether LinkedIn's logged-out page carries `code#applyUrl` in the received HTML (step 2 is built; the next live run's page evidence will show it).
- **Persistent diagnostics (automatic):** the retrieval worker appends one JSON object per event, synchronously, to `RETRIEVAL_WORKER_LOG_DIR` (default `~/.ai-job-assistant/diagnostics`)`/logs/retrieval-worker-<UTC date>.jsonl` (folder 0700, files 0600, refused inside the repository, removed after `RETRIEVAL_WORKER_LOG_RETENTION_DAYS`, default 30; `RETRIEVAL_WORKER_LOG_DIR=off` disables). Events: `worker.start` (git SHA and branch, reader revision, Node, browser configured, detail sites, evidence on/off), `worker.lock`, `worker.recovery`, `worker.transient` (attempt, delay, next retry), `worker.fatal`, `worker.crash` (uncaught error or rejection), `worker.exit`, `run.finished`; per pass `recovery`, `pass.start` (the claimed jobs in order), `job.read` (status, timing, description length, application route, missing fields), `job.ingested`, `job.failed` (stage, failure class, decision, the capture transaction settings, Prisma code, fixed P2028 form, timeout and elapsed ms, transaction name, sanitized message), `job.decision`, `job.handoff`, `probe`, `site.stopped`, `pass.decision`, `pass.end`. Ids, decisions and timings only: no page content, no credentials, tokens, cookies or connection strings (messages sanitized and capped at 600 characters).
- **Page evidence (opt-in, never by default):** with `PAGE_CAPTURE_EVIDENCE_DIR` set (outside the repository), each job read leaves `<item>.rendered.html`, `<item>.served.html` and `<item>.json` (ids, status, timing, apply-link evidence: `code#applyUrl`, apply links and buttons, the route taken, fields read or missing, error) in `<dir>/<worker session>/` (0700/0600; session folders removed after `PAGE_CAPTURE_EVIDENCE_RETENTION_DAYS`, default 7). It can hold personal or session data: local only, never committed or uploaded, deleted after review.
- **Failure evidence package:** `pnpm diagnostics:package --database <test or acceptance database> (--capture-session <id> | --latest [--site linkedin]) --out <new folder outside the repository>` assembles `manifest.json` (git SHA, reader revision, environment variable names only, what is present or absent), `capture-session.json`, `capture-items.json`, `source-records.json` (including unlinked records), `opportunities.json` (with triage outcome), `timeline.json`, `worker-log.jsonl` and `page-evidence/`. One READ ONLY transaction on a read-only session; refuses any database whose name does not say test or acceptance (the normal database is never read) and any output inside the repository; reruns nothing, contacts no site, makes no evaluation or paid call.
- **Verified (offline; `ai_career_assistant_test` only; offline simulation, not live acceptance):**
  - typecheck, lint, Prisma validate, extension build, `git diff --check`: pass; `db:verify-migrations`: 28 applied in order (known documented exception only).
  - Unit (before the final checks): 101 files (1 skipped), 2,278 passed, 6 skipped. New `mode-b-diagnostics.test.ts` (18, now 24): sanitization; repository refusal; owner-only files; retention; no crash on an unwritable folder; events survive an uncaught error and a SIGKILL (child processes); loop events (transient with next retry, fatal); apply evidence; page evidence files, permissions and retention; received-HTML apply link (served, rendered-first, listing fallback); the 25-job TENEX.AI batch (localized P2028 counted once with 24 ingested; outage on the sixth and seventh, nothing counted, 18 unread requeued, completion after recovery; restart after the sixth job's provisional failure, 19 recovered, TENEX.AI completed uncounted); unreadable and gone pages; package safety checks.
  - Integration: 53 files, 416 passed (browser-driver tests with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; the real driver now returns the served HTML from the one request). New `mode-b-tenex-diagnostics.test.ts` (5, real repositories and normalization): TENEX.AI sixth with a P2028 in its capture transaction (5 + 19 ingested, TENEX counted once, retried an hour later onto one opportunity, 25 hand-offs total), with its diagnostics, page evidence and evidence package checked; a database-wide outage at TENEX.AI then a worker restart (nothing counted, 20 completed, no duplicate, both diagnostics sessions in the package); a P2028 while preserving TENEX.AI's unnormalized listing (provisional, counted once, nothing preserved; the next read preserves it unlinked and counts it unreadable; the package shows the unlinked record); a P2028 while staging the batch (nothing staged, error names `stageBatch`, a second save stages it once, a third is idempotent); the package's reads cannot write.
  - Existing coverage of the other required failure paths, re-run green: failure before the write, after commit before acknowledgement (`PageCaptureSavedError`), normalization/extraction failure, site restriction, explicit unavailable, interrupted worker, duplicate identity and similar-but-distinct listings (FourKites), refresh of a saved job, refresh missing a field (`page-capture-db-failures`, `mode-b-refresh-recovery`, `mode-b-live-round-fixes`, `workstream-b-evidence-updates`).
  - 14B historical suites: 195 passed. E2E: 60/60 (including the one-click save → preview → select → one submission → automatic processing flow, Mode A, and the refresh scenario).
  - No real browser or source test, no live LinkedIn or WTTJ request, no paid evaluator call.
- **Database safety:** this container holds only `ai_career_assistant_test` and `postgres` (no normal or acceptance database). Tests, the migration check (a temporary `ai_career_migration_check_<n>`, created and dropped) and the package smoke run used only those; the package command's refusal of a normal-database name happens before any connection.
- **Real E4 texts (final check, November 6):** Alex supplied the E4 archive (`e4.tgz`: the stored source versions exported read-only at `144fa6c`). It holds each listing's complete stored description, so the wording failures could be tested on the real text. Replayed through today's capture mapping and normalization, `58ef504` still failed on two of the three and mis-handled the third, so these were confirmed defects, now fixed:
  - Critical Start: "Application Deadline: / The application deadline for this position is November 20, 2026." was not read (the label allowed nothing between it and "is"). The closing-date statement now allows "for this position/role/job/…". Result: closing date 2026-11-20; the pay-transparency "remotely within the U.S." still states no arrangement or residency.
  - AlertMedia: "Location: Position is fully remote and open to candidates in Austin, Texas or other cities in the United States. Please note that we currently do not hire candidates residing in the following states: …" gave nothing. Now: Remote (a "Location:" label before a role statement, and "Position is …" without "This"); U.S. residence ("… or other cities in the United States" names where candidates may be); the 15 excluded states ("do not hire … residing in the following states:"). The Austin location is kept, and work authorization (U.S., no sponsorship) stays separate.
  - Juniper Square: both country tiers were read, but the U.S. tier was made the primary from the Denver location alone, although the company works "across 27 U.S. states, 2 Canadian Provinces, …" and the role states a Canadian range. Country adjectives now count as opening another tier's country, so there is no primary (contract D); both tiers stay in their own currencies, and no arrangement or residency is invented.
  - The other six E4 records (Dataminr OTE, both FourKites, both ServiceTitan, Beam) normalize identically before and after.
  - Regression: `tests/unit/mode-b-e4-real-texts.test.ts` (4) on `tests/fixtures/real-captures/mode-b-e4-linkedin-nov5.json`: the three public descriptions and listing identity only (capture metadata removed, one recruiting e-mail address redacted).
  - E4 also shows that the five November 3 logged-out LinkedIn pages carried no `code#applyUrl`: Apply was a sign-up modal button, and the "Apply" links went to LinkedIn sign-up. A new test with that markup confirms a sign-up link is never taken as the application link; the labelled listing fallback is used. On logged-out reads the fallback is therefore the expected outcome; the received-HTML step helps only if LinkedIn sends the link.
  - The saved November 5 records are re-read (reader revision 0 < 1) on the next save of their page, which applies these fixes to them.
- **Diagnostic security review (final check, November 6).** Gaps found and fixed:
  - Folders were refused only inside the working directory, without resolving links. Now any folder inside any Git checkout is refused (logs, page evidence, package output), resolved through symbolic links, whatever folder the command starts from.
  - A pre-existing log file or package folder kept wider permissions. Now each log file is made 0600 on first write; the package folder 0700 even when it already existed; copied page evidence 0600.
  - The sanitizer missed secrets inside longer names (`PGPASSWORD=`, `access_token=`), provider keys (`sk-…`, `ghp_…`), JSON web tokens and non-error fields. Every string in an event is now redacted, and the URL in `job.read` is kept without credentials, query or fragment.
  - Page evidence was pruned only when the worker started with the variable set. New `pnpm diagnostics:cleanup` (`--all-evidence` to remove every session) applies retention at any time and deletes only its own logs and session folders.
  - `.gitignore` backstop for log, evidence and package names.
  - Confirmed: no code path uploads or serves these files (no CI workflow; nothing under `public/`; no network call in the diagnostics code). Console output carries ids, stages and whitelisted error fields only. Evidence packages are never pruned automatically; you delete them yourself.
- **Verification after the final checks:** typecheck, lint, Prisma validate, extension build, `git diff --check`: pass. Unit 2,288 passed / 6 skipped (102 files, 1 skipped), including `mode-b-diagnostics` (24) and `mode-b-e4-real-texts` (4). Integration 416/416. E2E 60/60. 14B historical suites unchanged.
- **Open:** the acceptance-database migration (`residencyExclusions`, the 28th) and the live round need authorization; closeout needs Alex's approval. Whether LinkedIn sends the employer link in the received HTML of a logged-out page is only knowable live (page evidence on).

## Workstream B — Mode B Live-Round Fixes (November 6, 2026; structural work and every E4-independent gap implemented and verified offline; committed and pushed as `58ef504`; E4 evidence, source-specific fixes and the live round pending)

Baseline: `144fa6c` on `integration/final-evaluator-product`. Scope: only the November 5 Mode B acceptance failures (LinkedIn worker crash after 5 of 25 jobs; WTTJ jobs saved before `144fa6c` never re-read; Captured Jobs locations; LinkedIn Apply links; regional salary; residency exclusions). Plan rev 3 approved November 5 with two safeguards (crash-safe provisional DB accounting; withdrawal only on explicit source evidence).

- **Confirmed root causes (code at `144fa6c`):**
  - Worker crash amplification: one job's database error was rethrown and ended the pass; Prisma P2028 was classed fatal, so the worker exited; the log did not say which P2028 or which transaction. The 20 claimed jobs were left ACQUIRING (recoverable, uncounted).
  - Capture-lock transactions used different options: `preserveUnnormalizedListing` and `stageBatch` used Prisma's 2 s / 5 s defaults behind the same global lock as the 15 s / 30 s ingestion; `stageBatch` ran about 3 queries per card.
  - Saved jobs were never re-read: a later save marked them ALREADY_SAVED, so the November 4 WTTJ records kept their pre-`144fa6c` gaps.
  - Captured Jobs showed the staged card's company and location; WTTJ cards state no location by design.
  - Country-labelled salary ranges in one sentence ("… in the U.S. and … in Canada") were not tiers, so two currencies made the salary Unknown.
  - LinkedIn's apply link is lost at extraction on the worker's logged-out page (mapping and normalization pass it through unchanged).
  - Residency exclusions ("not eligible in Alaska, …") made residency Unknown; there was no field for them.
  - The geography connector read ", Oregon" as ", or" (a list-parsing bug found while adding exclusions).
- **Fixed (offline):**
  - **Worker resilience:** per-job database failure classes. Contention (55P03 lock timeout, P2034, 40001, 40P01): the job goes back uncounted and the pass ends. Permanent (the job's own data refused): that job's counted attempt, pass continues. Transient (P2028, connection, pool): provisional `DB_PENDING` (uncounted); the next ingestion, or a capture-lock probe when none follows, decides: success counts it once (one conditional, idempotent update); a second transient failure ends the pass with nothing counted. Every status write is best effort; claimed jobs fall back to the existing interrupted-job recovery. P2028 and the capture lock's 55P03 are transient for the retrieval worker loop only (`classifyRetrievalWorkerError`: backoff, lock kept); the evaluation worker's classification is unchanged from `144fa6c`. Diagnostics name the P2028 form (start-timeout / expired, timeout and elapsed ms) and the transaction, from Prisma's fixed text only.
  - **Transactions:** every capture-lock transaction uses the same explicit options (15 s / 30 s) and takes the lock with a 20 s `lock_timeout`; `stageBatch`'s lookups are two queries per batch. No blanket timeout increase.
  - **Selective re-observation:** reader revision (`pageReaderRevision` = 1) carried in the capture envelope and stored per read with its read quality. A later save queues a saved job to be read again (REFRESHING) only when its latest browser-extension read is outdated (R1), incomplete and at least 24 h old (R2, at most 3 in a row) or at least 14 days old (R3), per site; never while the site is stopped, never a dismissed job, never more than once per batch, within the same 25-card cap. A refresh lands on the same opportunity, is never handed off again, and on unavailable / restricted / failed / stopped restores the saved job untouched with the outcome recorded.
  - **Evidence-based re-projection** (browser-extension reads): per field group (salary; arrangement; residency incl. exclusions; work authorization), an observed value updates the group, an unstated value keeps the previous value and provenance, and only an explicit statement in the posting's own description withdraws. An application link is never cleared by absence.
    - Salary replaces a saved salary only as a complete statement (a range with its currency, or tiers); a partial one (a sentence with no amounts, amounts with no currency) never overwrites saved amounts, currency, basis or tiers, and may only fill an empty salary group.
    - Explicit withdrawals implemented (`packages/normalization/src/withdrawal.ts`; description text only, never template labels or extractor output): closing date ("open until filled", "no application deadline", "rolling basis"); salary ("Salary: not disclosed", "confidential", "we do not disclose salary"); work arrangement ("Work arrangement: to be determined", "remote eligibility is TBD", "whether this role is remote … will be decided"). "Not specified", "Unknown", "competitive", "negotiable" and "Location: TBD" never withdraw. Other field groups have no recognized withdrawal and can only be replaced by a newly stated value.
  - **LinkedIn application route:** a job-specific employer/ATS link stays first (unchanged 14B logic). Otherwise the LinkedIn listing itself, labelled "Apply on LinkedIn (listing page)", never shown as a direct employer link; it never replaces an employer link, and a later employer link replaces it. A careers site's front page is never an application link.
  - **Residency exclusions:** additive `Opportunity.residencyExclusions` (migration `20261106090000_opportunity_residency_exclusions`, test database only), parsed from explicit statements, kept with the residency requirement (never work authorization), shown as "… residence required, excluding: …". Triage unchanged.
  - **Regional salary:** countries (noun or adjective) are tier labels in one sentence or in label lines; each tier keeps its own currency. A primary range is chosen only when the tiers are countries, the posting's eligibility evidence names exactly one country and one tier is for it; otherwise the tiers are shown and the salary stays Unknown.
  - **Display:** Captured Jobs, capture history and the panel take company and location from the saved job when resolved; the WTTJ preview notes "Locations are read with each job's details."
- **E4-independent completion (November 6, after the completion audit):**
  - Partial-salary overwrite fixed (above), with salary and work-arrangement withdrawals.
  - FourKites-shaped regression: same company, similar or identical title and description, different listing IDs and URLs stay separate opportunities (at most a probable-duplicate reference, never a merge); the same URL still attaches.
  - Refresh under database failures: a transient failure keeps the refresh queued and uncounted (`requeueUncounted`); proven the refresh's own, it ends REFRESH_FAILED with the saved job untouched; an outage leaves it a refresh for the next pass. Permanent failures (REFRESH_FAILED) and restrictions (REFRESH_DEFERRED) stay distinct.
  - Post-save failures (`PageCaptureSavedError`): a job whose ingestion committed but whose item could not be marked is requeued uncounted (SAVED_UNMARKED) and re-read onto the same job (no new source record, one hand-off); a failed hand-off record leaves the job added, not re-read. Neither is ever charged an attempt. The background-tab path treats them the same way.
  - Evaluation-worker side effect removed: the shared classifier is back to its `144fa6c` sets; only the retrieval worker retries P2028 and 55P03.
  - Defects found and fixed while completing the tests:
    - a site restriction met while every queued job was a refresh was lost (the stop lived only on the restored items' cleared fields), so the next save could read the site again; a deferred refresh now keeps the stop's end (REFRESH_DEFERRED with `nextAttemptAt`), and `siteStoppedUntil` reads it, for the worker and the background tabs;
    - a deferral that is not a restriction (a failed load) labelled refreshes "restricted"; they now wait queued as refreshes;
    - a refresh that read the same content (UNCHANGED) kept the old record's reader revision, so it was re-read on every save; such a read now records `lastRead` (time, reader revision, read quality) on the record (additive metadata; stored evidence unchanged);
    - refresh timing used the record's `lastObservedAt`, which for batch reads is the card's first sighting, so a job first seen over 14 days ago was re-read on every save; it now uses the read's own capture time.
  - Smaller items: worker logs name the stage (navigate, read, normalize, ingest, mark, handoff); a gone listing's refresh is dated by the recorded time its page was opened ("Read again on <date>: …"), undated when none is recorded.
- **Verified (offline; `ai_career_assistant_test` only):**
  - typecheck, lint, Prisma validate, extension build, `git diff --check`: pass; `db:verify-migrations`: 28 applied in order, schema matches (known documented exception only).
  - Unit: 100 files (1 skipped: the evaluator live-artifact replay), 2,260 passed, 6 skipped. New: `page-capture-db-failures.test.ts` (17), `workstream-b-mode-b-fixes.test.ts` (19), plus retrieval-loop and evaluation-classifier cases.
  - Integration: 52 files, 411 passed (including the 4 browser-driver tests, run with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` in this container). New: `workstream-b-evidence-updates.test.ts` (8: salary guard and withdrawal, tiers, arrangement and closing-date withdrawal, user-corrected location, exclusions persistence and re-projection, identical re-read adds no source record, FourKites identity); `mode-b-refresh-recovery.test.ts` (13: refresh transient failure and outage, post-save mark and hand-off failures, refresh suppressed during an active stop, a restriction while every job is a refresh, failed load / unreadable / stopped refresh, dated unavailable, 10 + 15 mixed batch at the 25 cap, read-time-based refresh, history and side-panel hydration, capture transaction options and constant read count for 5 vs 25 cards, worker lock freed when its connection dies); a WTTJ test (restriction while reading saved jobs again keeps the site stopped; a save during the stop reads nothing; Retry refused; your next save after the wait reads them); `mode-b-live-round-fixes.test.ts` (8): a held capture lock gives 55P03 CONTENTION after the lock wait; a 25-job batch with one transient failure counts it once and ingests 24; two transient failures in a row count nothing and the next pass completes with no duplicate; a provisional failure survives a crash uncounted and recovery completes once; an outdated record refreshes onto the same job with no second hand-off, keeps the unstated salary and withdraws the closing date only on the explicit statement, and a repeat save reads nothing; a gone listing restores the job untouched; a dismissed job is never refreshed; Captured Jobs shows the saved location; the LinkedIn fallback gives way to an employer link and never replaces it.
  - E2E: 60/60 in one uninterrupted run, including a new refresh scenario (an outdated saved job is read again from a real popup save, no second triage, Captured Jobs shows the update and the location, the same page again reads nothing).
  - Existing tests changed for intended behaviour only: three integration fixtures now carry the current reader revision (a record without one is correctly re-read); the WTTJ restriction test now expects the saved job's one incomplete-read refresh after more than 24 h; one E2E and two integration count expectations include the additive `refreshing: 0`; the 14B Easy Apply case expects the labelled listing fallback (Alex's decision).
  - The browser-driver integration tests need `PLAYWRIGHT_CHROMIUM_EXECUTABLE` in this container, or Playwright's own Chromium installed (environmental).
- **Not yet confirmed (waits for Alex's read-only E4 evidence):** which P2028 occurred (H1 unnormalized-listing write behind the lock, H2 slow work in the capture transaction, H3 transaction start); whether the logged-out LinkedIn page carries `code#applyUrl` (H4); AlertMedia's remote wording or precedence (H5); Critical Start's deadline wording (H6); Juniper Square's exact wording and eligibility (decides a primary); the FourKites duplicate trace on the real records (the deterministic identity regression is in place). No wording-specific fix was made without that evidence.
- **Needs authorization:** closeout commit/push; the acceptance-database migration (`residencyExclusions`) before the next round; the controlled live round (recovery of the 20 LinkedIn jobs first, then LinkedIn and WTTJ refresh saves). Normal database untouched; acceptance database untouched; no profile created; no evaluation worker; no live or paid call.

## Codex E2E Cleanup — Grouped Verification Complete

**State:** implemented and verified on `integration/final-evaluator-product` at baseline `17d2a3289688ce40a17a4a573ead87aefe042e74`; Alex accepted the grouped verification as sufficient for repository closeout. This is grouped E2E verification, not an uninterrupted 59/59 full-suite pass.

- The four stale E2E scenarios identified after pre-evaluator triage were corrected without weakening triage or evaluator behavior:
  - the Review fixtures now produce the intended material uncertainty through valid evaluator evidence;
  - dashboard fixtures use jobs that deterministically reach their intended Apply or Review state;
  - golden-path jobs state the location and no-travel facts needed for deterministic admission;
  - the deterministic worker helper emits the current evaluator contract.
- Windows/runtime portability and synchronization corrections are narrow:
  - extension IDs use Chromium's Windows path hashing behavior;
  - the P1 runtime test invokes the portable `tsx` CLI entry point;
  - exact asynchronous UI assertions retain their expected values with a 15-second Playwright assertion allowance for the measured slow filesystem;
  - browser-assisted retrieval records the navigation start after invoking the driver, preserving the locked minimum source interval;
  - listing-version projection compares unordered evidence rows by immutable ID.
- Verification preserved from the synchronized implementation:
  - unit: 92 files passed, 1 replay file skipped; 2,144 passed and 6 skipped;
  - integration: the shared-browser cadence correction passed 75 focused unit tests and 3 focused integration tests; the subsequent full integration run passed 372 tests before one nondeterministic evidence-order comparison, and that test-only comparison correction then passed its focused 13-test integration file;
  - extension plus page capture: 12/12 passed after synchronization.
- **Grouped E2E verification:** all 59 tests have passing evidence on this unchanged implementation and deterministic configuration, using only `ai_career_assistant_test`:
  - the latest complete-suite attempt passed 31 tests, failed the daily-limit budget test while its second save request remained stalled, and left 27 unexecuted under fail-fast;
  - the daily-limit test then passed unchanged (1/1); its trace showed both budget saves returning HTTP 200 in 602 ms and 112 ms;
  - the ordered downstream group passed 25/27; the Companies index navigation encountered first-use `/companies` compilation and the serial detail test did not run;
  - after read-only route warm-up, the Companies index test passed; the detail route then returned HTTP 200 in 15.7 seconds (14.8 seconds of Next.js compilation/cache work, 828 ms of application work), just beyond the unchanged assertion window; the focused detail test passed unchanged after compilation;
  - the Next.js server measured the worktree filesystem at 6.9 seconds and reported cache compactions of 31.6–66 seconds. These trace-backed failures were environmental first-use compilation/stalled-server events, not product, API-contract or assertion defects.
- No assertion was removed, no retry was added, no test was skipped, and no product behavior was changed to accommodate the environment. No live/provider/paid call was made. The normal and acceptance databases were untouched.
- **Acceptance:** no additional uninterrupted run is required for this closeout. Report **grouped E2E verification complete** and state explicitly that an uninterrupted 59/59 run did not pass and was deliberately waived for this task.

## Workstream B — Capture Correctness from E1/E2/E3 Evidence (November 5, 2026; implemented and verified offline; approved and committed with Decision 2; live confirmation pending)

Baseline: `d88a83d`. Evidence:
- E1: a read-only export of the acceptance database, 20 WTTJ records (the ten original jobs, Ogury and 9 more);
- E2: 9 rendered WTTJ job pages exported from Alex's Chrome;
- E3: 3 logged-out LinkedIn results-page states (list / app promotion / central sign-in modal), plus Alex's screenshot of the modal and the promotion.

Each is kept as a regression fixture (`tests/fixtures/real-captures/wttj-acceptance-e1.json`, `wttj-e2-pages.json`, `linkedin-e3-friction.json`).

- **Root causes (confirmed):**
  - (1) **WTTJ description incomplete (extension, Single Job and Batch).**
    - WTTJ's JSON-LD `description` is only "You'll be working on". The page renders "We're looking for" (the JSON-LD `qualifications`, as run-together text) and "How we hire" (not in the JSON-LD) as separate blocks.
    - The reader took the JSON-LD description alone. Reproduced on all 9 rendered pages: 8 lacked "We're looking for" and Hack The Box lacked "How we hire". Beam and Ogury publish their whole posting as the description.
  - (2) **Background-tab timing (extension, Batch only).**
    - The tab was read the moment it loaded. JSON-LD is in the page source, so the first read succeeded before the page rendered its body.
    - E1: 16 of 20 records have no page context, and exactly those 16 have no Apply link.
    - E2: every rendered page has one Apply destination (header and sticky bar), which the reader finds.
  - (3) **WTTJ header remote tag not normalized (server).** "No remote" and "A few days home" were not read as page metadata.
  - (4) **LinkedIn false FRICTION (extension results reader).**
    - The challenge check matched markup by presence. Every E3 state holds the invisible reCAPTCHA Enterprise badge (`div.grecaptcha-badge`, `display:none`, no box) beside 120 loaded cards.
    - Reproduced: the committed reader answers FRICTION on the real badge markup.
    - The job-page check for background tabs had the same presence-only challenge selectors.
- **Fixed (offline):**
  - **Reader:** after the rendered description, adds the posting's own following blocks, headed as posting parts ("We're looking for", requirements, qualifications, "How we hire", hiring/interview process). It stops at the company, workplace and other-job blocks and never adds text twice. When the page has not rendered them, it adds the JSON-LD `qualifications`/`responsibilities`/`skills`/`education` text instead. This is generic, not employer-specific.
  - **Tab reader:** a posting read without page context is held and the same document re-read (+2 s, +5 s, +10 s; the registry's re-reads gained +10 s, still inside the 12 s spacing). The read is taken as it is only if the page never renders.
  - **Normalizer:** page-metadata items "Fully-remote" → Remote, "No remote" → On-site, "A few days home" → Hybrid. "Remote: Not specified" states none.
  - **Friction:**
    - only a shown challenge counts (never the reCAPTCHA badge);
    - **revised per Alex's Decision 2 (November 5):** a shown sign-in modal (a dialog of real size with shown sign-in controls such as Continue with Google, Sign in with Email, Join now, or a shown password field) over loaded, readable cards is **not** FRICTION. The cards are read, the modal is left untouched, and the summary adds "The page shows a sign-in prompt; the jobs already loaded behind it were read, and the prompt was left as it is." (reading notice `SIGN_IN_PROMPT_SHOWN`; not part of the saved batch);
    - FRICTION is now only: a sign-in/authwall/checkpoint/challenge address, a shown challenge, or a shown sign-in prompt with no readable card behind it ("This page shows a sign-in wall or security check instead of the results. Nothing was read.");
    - a job link inside a shown sign-in prompt is never taken as a result;
    - hidden sign-in dialogs, the scroll lock and the app promotion never count;
    - nothing is ever dismissed, clicked, submitted or bypassed (the reader's spies record no click, scroll or navigation);
    - the job-page check counts only shown challenge markup;
    - LinkedIn job details are read by the server worker in its own fresh logged-out browser, so the modal in Alex's tab is not on the detail path; per-job failures (404/410 unavailable, unreadable → later attempt) never stop the other jobs, and a real site restriction stops only that site, leaving its jobs queued until the wait ends, when the next worker pass resumes them with no second action (new unit tests).
  - **Earlier this round (E1):** Ogury's repeated "Denver, Denver"; ServiceTitan's PST/MST hours inside run-on text; `#LI-` workplace tags, in-person days, remote-first with optional offices, "Work from anywhere" lines and "This is a senior-level role"; the display note for a closing date earlier than the posting date.
- **Verified on the real pages** (`wttj-e2-pages.test.ts`):
  - every page keeps its posting blocks once, and its Apply link;
  - ServiceTitan keeps "Able to work PST/MST hours";
  - arrangements: ServiceTitan, Zeta, Hack The Box, Vantage and Standard Metrics Remote; Mintlify On-site; Beam and Ogury Hybrid; FourKites Unknown ("Remote: Not specified");
  - Ogury: "Denver, US";
  - the tab reader waits for the rendered page, and an unrendered read still keeps the JSON-LD qualifications.
- **Expected behaviour, not changed:**
  - Vantage's and Hack The Box's U.S. residency comes from the posting's own structured `applicantLocationRequirements` (US). The visible page shows "Fully-remote" with a U.S. location and states no residency sentence.
  - Ogury's closing date (October 15, 2025, stated in the posting) predates its posting date (July 16, 2026). Both are kept and noted on the job page.
- **Not proven by the evidence:**
  - the central LinkedIn modal's markup is not in E3 (the exporter kept only 40 dialog-like elements; the modal shows only as the body's scroll lock), and the promotion is in no export;
  - their handling is tested on markup that follows LinkedIn's sign-in modal classes and the screenshot, and needs the live round;
  - E3 shows 120 loaded cards in all three states; it does not prove that every job detail is retrievable while the central modal is shown (that is the server worker's fresh logged-out read, confirmed only live);
  - the console's `Cannot read properties of null (reading 'addEventListener')` is not explained by the extension: every element ID the side panel uses exists in `popup.html`; it is likely a page script.
- **Verification** (test DB only; no live site, provider, paid or evaluator call; normal and acceptance databases not accessed):
  - typecheck, lint, `prisma validate`, extension build and `git diff --check` pass;
  - unit: 97 files passed, 1 skipped (2,221 passed, 6 skipped), including `wttj-acceptance-e1` (11), `wttj-e2-pages` (8), `linkedin-e3-friction` (11, revised for Decision 2) and two new acquisition tests (job-level failure isolation; automatic resume after a site wait);
  - integration: 49 files, 381 tests;
  - E2E: the full suite, all 12 Playwright projects, 59/59 (after Decision 2);
  - test DB left clean.

## Salary Policy v4 (D-P1, D-P2) and Triage Boundary Decisions (November 5, 2026; implemented, verified offline and approved by Alex)

Baseline: `39757c1`. Alex approved both salary corrections as targeted changes.

- **One shared policy changed:** `cs-salary-policy-v4-ecb-2026-10-14` in `domains/customer-success/src/config/salary-policy.ts`. The triage and the evaluator's hard filter read the same policy, so the two always agree, and a job Alex releases from Needs Review is not then failed on salary by the evaluator.
  - **D-P1:** a U.S.-residence job with a stated minimum of $55,000–$59,999 is `REVIEW` (new reason `US_REVIEW`, triage code `salary-us-review` → Needs Review), whatever its maximum (e.g. $57,000–$70,000). Below $55,000 is still `FAIL` (Reject / Skip).
  - **D-P2:** a non-U.S. job with a minimum below $50,000 is `REVIEW` (new reason `NON_US_LOWER_COST_REVIEW`, code `salary-non-us-lower-cost-review`) only when its eligible location matches a configured lower-cost country; elsewhere it is still `FAIL`.
  - Unchanged: the thresholds otherwise, the ECB rates, residency selecting the policy (never currency), OTE and unknown salary as Unknown, the max-only rule, and conflicting-evidence handling. A U.S.-residence job never uses the lower-cost exception.
- **Evaluation and admission compatibility:**
  - In the evaluator, a salary `REVIEW` makes the hard-filter overall `REVIEW`, which caps the final recommendation at Review. Proven by the updated `customer-success` and `customer-success-priority-recommendation` tests.
  - Triage maps `REVIEW` to Needs Review, so nothing is admitted until Alex decides. Proven on the test DB (`captured-jobs`: a $57k–$59k U.S. job → Needs Review, `salary-us-review`, zero admissions and evaluations).
  - No schema, prompt, model, routing or stage change. The hard-filter stage version `cs-hard-filters-v3` is unchanged; its explanations name the policy version.
- **Triage boundary (role relevance, working hours, mandatory travel): Alex's decisions, November 5. Nothing added.**
  - Current handling:
    - Role and travel are judged in the evaluator's first stage (hard filters), after its first paid semantic call (job reconstruction). A failure there stops every later semantic stage.
    - Working hours are checked by no rule.
  - B-1 role-title exclusions: **on hold**; existing screening and evaluator behaviour kept.
  - B-2 working-hours rules: **not implemented**. Explicit working-hours information (for example ServiceTitan's PST/MST hours) must be preserved through capture and normalization; Workstream B checks this against the evidence.
  - B-3 deterministic travel rules: **on hold**; the evaluator's travel handling is kept.
  - B-4 salary floor: **no change**. The approved thresholds are final.

## Pre-Acceptance Round — Pre-Evaluation Review, Overlapping Captures, Triage Policy Mapping (November 5, 2026; implemented and verified offline; committed as `39757c1`)

Baseline: `6795fe2` (the Workstreams C–E checkpoint, committed and pushed). Workstream B (capture correctness) is still waiting for Alex's E1 evidence.

- **Pre-Evaluation Review.** The dashboard lifecycle view is renamed **Pre-Evaluation Review** (formerly "To triage", briefly "Not acted on"). Its meaning, statuses and URL (`?view=triage`) are unchanged. It stays separate from the pre-evaluator triage, its Needs Review queue and Captured Jobs.
- **Overlapping captures.**
  - Defect fixed: a job an earlier capture had already added was reported by a later batch as "already in progress". It is now reported as **already in AI Job Assistant**, with its opportunity; a job an earlier capture is still reading stays "in progress".
  - Each capture session records, as of that save, how many of its jobs were already saved and which ones (`counts.alreadySaved`, `counts.seenAgain`, `counts.alreadySavedItemIds`; JSON only, no migration).
  - The side panel and Captured Jobs show "N added (M already saved before)" for a capture, and mark each such job "already saved before this capture".
  - Proven on the test DB: batch A (10) plus batch B (10, 3 shared) gives 17 opportunities and 17 staged jobs, not 20. Each page is read once. Both sessions keep their own 10 jobs: a later capture never removes a job from an earlier one. B reports exactly the 3 as already saved, and repeating B changes nothing.
- **Cross-method deduplication** (the existing dedup is reused).
  - A job saved as a Single Job and then on a results page, or the other way round, is one opportunity and one Captured Jobs row. The row reads "Results page and single job".
  - New provenance marker: `sourceMetadata.capture.method` = `single` / `batch` on new extension source records. It is not a material field, so the content hash is unchanged (tested).
  - Older records without the marker count as a single-job save only when they were saved before the job's first results-page sighting.
- **Triage policy mapping (G3; no rule added or changed).** A synthetic profile mirrors Alex's stated baseline: remote only, U.S.-only roles allowed, no country exclusions, lower-cost countries configured, U.S. citizen. It is tested case by case in `tests/unit/triage-profile-policy.test.ts` (21 cases).
  - Matches the stated policy:
    - $60k+ base → EVALUATE; unknown salary → Needs Review; OTE is not base → Needs Review;
    - a U.S.-residence job below $55k → REJECT;
    - non-U.S. $55–59.9k → Needs Review; non-U.S. $50–54.9k → Needs Review (lower-cost country, or unresolved);
    - below $55k with unclear residency → Needs Review;
    - hybrid-only or on-site-only → REJECT; remote among the job's arrangements → passes; unknown arrangement → Needs Review;
    - U.S.-only roles are not rejected; unresolved eligibility → Needs Review;
    - European roles are never rejected for location (Needs Review while the right to work there is unresolved);
    - a U.S. citizen meets an explicit U.S. authorization requirement (W-2 is not a factor).
  - Differs from the stated policy (reported; both since corrected with Alex's approval in salary policy v4, above):
    - (1) a U.S.-residence job whose minimum is $55k–59.9k is REJECTED (the stated policy says Review), even when its maximum is $60k+, because the disclosed minimum is the gate;
    - (2) a non-U.S. base below $50k is REJECTED even in a configured lower-cost country (the stated policy says it may be considered).
  - No deterministic triage rule exists for: role relevance (the evaluator classifies it after admission), required working hours (nothing checks them), and mandatory travel (the evaluator's hard filters judge it after admission). Not added.
  - The manual Evaluate / Reject resolution, persistence, idempotency, reassessment, no-profile handling and admission/budget protection are covered by the existing `pre-evaluator-triage` and `captured-jobs` integration tests (re-run, passing).
  - Verifying Alex's exact saved profile needs one read-only query on the normal database, which has NOT been run (Alex's separate authorization is required).
- **Verification** (test DB only; no live site, provider, paid or evaluator call; normal and acceptance databases not accessed):
  - typecheck, lint, `prisma validate`, extension build and `git diff --check` pass;
  - unit: 94 files passed, 1 skipped (2,181 passed, 6 skipped), including the new `triage-profile-policy` (21) and extended `extension-workflows` and `page-capture`;
  - integration: 49 files, 380 tests, including the new `overlapping-captures` (2). `browser-driver` needs `PLAYWRIGHT_CHROMIUM_EXECUTABLE` in this container;
  - E2E: `extension` 8/8, `page-capture` 4/4;
  - test DB left clean.

## Consolidated Mode B Acceptance Fixes — Workstreams A, C, D, E (November 5, 2026; implemented and verified offline; committed as `6795fe2`)

Baseline: `integration/final-evaluator-product` at `8013226` (Codex's E2E stabilization, on top of `17d2a32` WTTJ P2). Decisions D1–D5 approved by Alex on November 5, 2026.

- **Workstream A — diagnostic (complete).** Confirmed from code:
  - LinkedIn FRICTION: the results reader treats any challenge-like element as friction, rendered or not.
  - The old popup showed both modes on a results page, so Mode A read a results page as one job.
  - Reopening returned to the first screen, but the capture work was not lost.
  - Acceptance triage never ran: there was no active profile, so the hand-off stopped at USER_PROFILE_NOT_FOUND before triage, shown as "Added; the evaluation request was not accepted".
  - "To triage" was a lifecycle view, not pre-evaluator triage.
  - Ogury's "Denver, Denver, US" comes from a repeated locality and region.
  - Not yet proven: WTTJ description and Apply-link losses (the likely cause is that only the JSON-LD `description` is read). They wait for evidence.
- **Workstream B — capture correctness: waiting for evidence (not started).** Alex collects E1 (read-only acceptance-DB export), then E2 (WTTJ job-page exports) and E3 (LinkedIn friction exports). No extraction, Apply-link, normalization or LinkedIn friction change is made before that evidence.
- **Workstream C — triage (D2, D5).**
  - A single-job save now runs the deterministic pre-evaluator triage only (`EvaluationService.assessTriage`): the same profile resolution and triage gate as `requestEvaluation`, with no admission, budget, queue or provider call.
  - With no active profile the job is saved and reported "not triaged: no active profile"; no outcome is invented.
  - The batch hand-off is unchanged; its no-profile rows now read "Added; not triaged yet: no active profile".
  - The dashboard view "To triage" is now **Pre-Evaluation Review** (URL unchanged; briefly "Not acted on"). A **Needs Review before evaluation** count links to the existing Needs Review queue.
  - The opportunity page says when triage has not run yet. Evaluate/Reject resolution is unchanged.
- **Workstream D3 — capture history.** One additive table, `PageCaptureSession`: each results-page save with its staged item IDs, in page order, and its counts. A repeated batch is the same session, and no job record is copied. Migration `20261105090000_page_capture_session` also adds the nullable `ExtensionPairing.lastExtensionVersion`. Applied to `ai_career_assistant_test` only.
- **Workstream D — extension 0.3.0 (D1).**
  - The toolbar button opens a Chrome **side panel**; there is no more popup. The click is the activeTab grant for the page shown; no new host permission was added (the only new permission is `sidePanel`).
  - Explicit **Single Job | Batch Capture** modes: Single Job never reads a results page; Batch Capture never shows the single-job fields.
  - The panel follows the page you are on, and says to click the toolbar button when it cannot see a page.
  - Batch Capture offers **View current capture** / **View results** / **Previous captures** and opens a session's jobs in the panel. A banner offers the latest capture on reopen.
  - The panel opens Captured Jobs (the session, or all). Background capture execution is unchanged.
- **Workstream E — app Extension pages.** Two destinations:
  - **Setup & Connection** (`/extension`): Pair New Extension, paired browsers with last use and reported version, **Unpair / Revoke Access** with a confirmation that names the pairing (captured jobs kept), troubleshooting, installation/updates, and the supported sites and modes derived from the registry.
  - **Captured Jobs** (`/extension/jobs`, reusing "Jobs from results pages"): single-job and results-page captures in one list, one row per job, with method, status, site and session filters, and capture history on the same page.
- **Codex-owned E2E edits (necessary and explained):** four assertion lines in two specs, for the approved wording only:
  - `extension.spec`: the h1 "Setup & Connection" and the two "Unpair / Revoke Access" clicks;
  - `extension-page-capture.spec`: the h1 "Captured Jobs";
  - `tests/support/e2e-page-capture-helper.ts`: one cleanup line for orphaned capture sessions.
- **Verification** (test DB only; no live site, provider, paid or evaluator call; normal and acceptance databases not accessed):
  - typecheck, lint, `prisma validate`, extension build and `git diff --check` pass; `db:verify-migrations` applied 27 migrations in order, with only the documented Recommendation drift;
  - unit: 93 files passed, 1 skipped (2,158 passed, 6 skipped), including the new `extension-workflows` (14);
  - integration: 48 files, 378 tests, including the new `captured-jobs` (5): sessions, the unified list, triage at save EVALUATE / NEEDS_REVIEW / REJECT with zero admissions or evaluations, no profile, pairing version;
  - E2E: `extension` 8/8, `page-capture` 4/4, `dashboard` 4/4, `pre-evaluator-triage` 1/1;
  - `next-env.d.ts` restored; the test database was left clean.
- **Not yet verified live:** the side panel in Alex's Chrome (opening from the toolbar, tab changes, Incognito, activeTab after navigation). Chromium in E2E loads the manifest, but the tests open the panel page directly.

## Extension Mode B — Bounded Results-Page Ingestion

**Committed on `integration/final-evaluator-product`: `6768598` (Mode B), `3ce9100` (P1 runner), `c946e1b` (P1 runtime fix), `77f7321` (LinkedIn enablement), `17d2a32` (WTTJ / Otta P2). WTTJ / Otta P2 is implemented, committed and verified offline; live acceptance still needs Alex's separate authorization.**
- **LinkedIn:** enabled; verified automatic detail mechanism (P1 PASS). Mode B is not complete until LinkedIn's targeted end-to-end acceptance.
- **Welcome to the Jungle / Otta:** NOT complete and not offered by default. F0 done, P1 BLOCKED (HTTP 403), P3 unsupported. P2 (sequential background tabs in Alex's Chrome) is implemented and verified offline only (see "WTTJ / Otta P2 implemented" below). It is enabled only by the explicit server setting `PAGE_CAPTURE_ACCEPTANCE_SITES=welcome-to-the-jungle`, for its live acceptance, which needs Alex's separate authorization.
  - *(Earlier status, November 4, before P2 implementation: "P2 (sequential background tabs) is the chosen mechanism and not yet implemented; implementation needs separate approval.")*

*(Earlier status line, November 3, 2026: "Implemented and verified offline on November 3, 2026, on `integration/final-evaluator-product` after `e84c1cc`. Not committed: it awaits Alex's review and commit approval. It is not live-accepted. Mode B is not complete for any real site yet.")*

It follows the locked plan "Final Extension Bounded Page-Capture Plan, Revision 5".

- **Two modes.** Mode A ("Read this page", single job) is unchanged and optional. Mode B ("Save jobs on this page") is ingestion and discovery, not bookmarking:
  - it reads up to 25 already-loaded cards, with no autoscroll, paging, crawling, clicking or navigation;
  - a preview lets the user deselect jobs;
  - the selected jobs are staged in `PageCaptureItem`.
- **Detail acquisition** runs only for a `detailVerified` site. It is an isolated pass in the retrieval worker, run when no source is due:
  - it opens each job's own page with the Feature 14A browser session: fresh and logged-out, sequential, the site's interval, at most 25 per pass, and a stop with a backoff of at least 24 h on any refusal, sign-in wall, challenge, rate limit or account cookie;
  - it reads the page with the unchanged single-job reader and builds the unchanged capture envelope;
  - the unchanged `capturedListing()` and retrieval ingestion create or re-observe the opportunity.
- **Triage integration point:** each newly ingested opportunity without a triage record, open deferral or evaluation is handed once to `EvaluationService.requestEvaluation(id, {})`. There, Codex's `triageGate.assess` runs before `admitAndEnqueue`. No triage logic exists in Mode B or the extension.
- **Per-job fallback:** AWAITING_DETAILS. The reasons are NO_BROWSER, NOT_SUPPORTED, UNREADABLE, FAILED_REPEATEDLY or a friction stop; a 404 or 410 gives UNAVAILABLE. Such a job has no opportunity, record, listing or evaluation, and offers Retry, Dismiss, Restore and Open job on `/extension/jobs`.
- **Mode A integration correction:** the popup's Request evaluation now handles `NEEDS_REVIEW` and `REJECT` per the triage handoff's extension contract: it says nothing was spent, does not poll, and has no decision buttons. This is the only Mode A change.
- **Provenance and analytics:** batch jobs are BROWSER_EXTENSION, user-collected and keyed by Mode A identity. There is no fake RetrievalSource, no RetrievedListing and no opportunity-less SourceRecord. Features 13 and 15–18 are unchanged.
- **Sites (as of November 4, 2026):** LinkedIn is `cardVerified`/`detailVerified: true` (see "LinkedIn Mode B enabled" below). Welcome to the Jungle / Otta stays `false`/`false`; Wellfound is excluded.
  - *(Earlier, November 3: "LinkedIn and Welcome to the Jungle / Otta stay `cardVerified`/`detailVerified: false`"; the steps below record that state.)*
  - Required next: F0 fixtures (the DevTools snippet `tests/support/page-capture-fixture-export.js`), then the bounded P1 experiment `pnpm page-capture:verify <site> <≤5 job URLs>` with `RETRIEVAL_BROWSER_EXECUTABLE`. Both run locally, by Alex, with authorization.
  - Prior P1 evidence: negative for LinkedIn (429 on the first job-detail request). Welcome to the Jungle / Otta has no verified logged-out job-detail path yet.
  - If P1 fails, stop; another mechanism (for example P2, background tabs) needs Alex's separate decision.
- **LinkedIn F0 collected (November 3, 2026):** 5 real logged-out public cards, job IDs 4484727127, 4423511448, 4486498409, 4444032301 and 4486439538. Their markup matches the Mode B reader spec; the card-reader fixture test belongs to the consolidated step.
- **P1 runner ready (not run):** `pnpm page-capture:verify` reports PASS / FAIL / BLOCKED (exit 0 / 2 / 3).
  - It opens the canonical job URL production fetches and checks that the page shown is the requested job.
  - It now applies LinkedIn's own friction checks (login wall, security check, anti-bot interstitial, even with HTTP 200), as does production Mode B acquisition, where such a page now stops the site for at least a day instead of counting as unreadable.
  - It is covered offline by `tests/unit/page-capture-verify.test.ts`.
  - Alex runs it locally for LinkedIn, then for Welcome to the Jungle / Otta after its F0.
- **P1 runtime fix (November 3, 2026):** the first local LinkedIn P1 run stopped with exit 1 before any verdict ("ReferenceError: __name is not defined" inside the evaluated reader).
  - Cause: `tsx`, the runtime of `pnpm page-capture:verify` and `pnpm worker:retrieval`, compiles with esbuild `keepNames`. That wraps the reader's inner functions in `__name(...)` calls whose helper sits at module scope, outside the source text `readJobPage` serializes and evaluates in the page.
  - Vitest and the extension bundle do not compile that way, so the unit tests and Mode A in Chrome were unaffected. Production Mode B acquisition under the worker would have failed the same way.
  - Fix: `readJobPage` now supplies the same `__name` helper (it only sets a function's name) around the unchanged reader source. There is no extraction change and no LinkedIn-specific logic.
  - Regression: `tests/unit/page-capture-verify-runtime.test.ts` runs the real P1 path in a tsx child process with a fake browser. It confirms the `__name` calls are present, P1 gives PASS, and the reader output under tsx equals Vitest's for structured-data, LinkedIn and main-content pages. It fails without the fix.
  - No verdict was produced by the failed run; LinkedIn P1 is to be re-run once.
- **LinkedIn F0/P1 results (Alex, local, November 3, 2026):**
  - P1 PASS, exit 0, 5/5 READABLE (1,731–7,253 description characters) in an isolated Linux-native WSL clone at `c946e1b` with fresh logged-out Chromium.
  - The real F0 cards are read exactly (5/5) by the Mode B card reader.
- **Welcome to the Jungle / Otta F0/P1/P3 (November 3–4, 2026):**
  - F0: 5 real cards from `/en/get-started/jobs-preview`.
  - P1 BLOCKED, exit 3: HTTP 403 ACCESS_DENIED on the first job page; it stopped as designed, and per the stop rule there is no repeat or probing.
  - P3 not viable: the cards hold only the title, company, a company tagline, tags and a date, with no job description. Embedded page state was not observed and would mean reading an internal format.
  - The card reader identified all 5 cards but extracted titles only, and `/en/get-started/jobs-preview` was not recognised as a results page. Both are fixed in the P2 implementation below.
- **LinkedIn Mode B enabled (approved D-A, November 4, 2026; implemented and verified offline; awaiting commit approval):**
  - `packages/core/src/page-capture.ts`: LinkedIn `cardVerified`/`detailVerified: true`, with the evidence. Pacing (5 s), ≤ 25 per batch and per pass, the ≥ 24 h friction stop, the `li_at` stop and LinkedIn friction checks are unchanged. Welcome to the Jungle stays off.
  - The real F0 cards are a regression fixture: `tests/fixtures/page-capture/linkedin-f0-cards.json`.
  - `tests/unit/page-capture-linkedin.test.ts`: exact card reading, production registry and offer, the popup batch through the production intake (automatic details, Mode A identity `linkedin:<id>`), and the LinkedIn job-detail reader path on the public page.
  - `tests/integration/page-capture-linkedin.test.ts` (test DB):
    - real F0 cards → intake → acquisition (fake browser, canonical pages, ≥ 5 s apart) → ingestion → Opportunities (browser-extension, `discoveredAt` = first sighting) → real triage (EVALUATE admitted; NEEDS_REVIEW and REJECT not);
    - idempotent repeats; Mode A re-observation of a batch job; the anti-bot interstitial stops the site with nothing ingested; no RetrievalSource or listing rows.
  - Verification: offline only, on `ai_career_assistant_test`, with no live LinkedIn or WTTJ request and no provider or evaluator call; the normal and acceptance databases do not exist in this container and were not touched. Typecheck, lint and `prisma validate` pass (no schema change, so no migration check was needed). Unit: 90 files passed, 1 replay file skipped (2,091 passed, 6 skipped), including the new `page-capture-linkedin` (4) and the updated `page-capture` registry test. Integration: 46 files, 368 tests passed, including the new `page-capture-linkedin` (3). `browser-driver` (4) needs `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to point at an installed Chromium; it failed when run without it and passed with it. E2E: the `extension` (8/8) and `page-capture` (4/4) projects pass; no E2E file was changed. `git diff --check` is clean and `apps/web/next-env.d.ts` is untouched; the test database was left clean.
  - Not yet done: LinkedIn's targeted end-to-end acceptance. It needs separate approval: Alex's real Chrome (logged-in results markup is covered by synthetic tests only; F0 was logged-out), the acceptance database, and the retrieval worker with `RETRIEVAL_BROWSER_EXECUTABLE`.
- **WTTJ P2 — plan (Alex, November 4, 2026; now implemented, see the next entry):**
  - WTTJ will use the proposed sequential background-tab mechanism, subject to implementation and live acceptance.
  - One "Save selected jobs" action for up to 25 already-loaded jobs stages them and automatically reads every job in sequential background tabs of Alex's Chrome. There is no second action and no lower batch cap.
  - Preserved rules:
    - WTTJ-only optional host permissions, granted within the Save click; if declined, nothing is staged or processed;
    - one tab at a time, at least 12 s apart;
    - an access restriction stops the batch, and the end of the 24 h backoff does not resume that blocked batch automatically.
  - *Superseded plan (November 4): a separate three-job proof-of-concept phase before implementation, with Alex's correction that it would use three loaded jobs automatically, was removed. WTTJ goes directly to implementation (when approved) and live acceptance.*
- **WTTJ / Otta P2 implemented (authorized November 4, 2026; committed as `17d2a32`; verified offline; NOT live-accepted):**
  - **Flow.** On a WTTJ results page, the existing "Save selected jobs" (up to 25 already-loaded jobs, no lower cap) asks for the WTTJ host permission inside the click. Declined: nothing is staged or sent. Granted: the service worker sends the batch, and the server stages it and lists the queued jobs back in page order. The service worker then reads every job automatically, with no second action:
    - the server confirms each job is still to be read (`POST /api/extension/page-captures/items/<id>/start`), and the extension checks it still holds the permission;
    - at least 12 s after the previous navigation started, the job's page opens in a new background tab (`tabs.create({ active: false })`); the user's tabs are never touched, navigated or closed;
    - after load (30 s timeout), a self-contained page check runs (navigation `responseStatus`, sign-in redirects, challenge and CAPTCHA markers, a sign-in form in place of the posting), then the unchanged Mode A reader, again on the same document at +2 s and +5 s while no posting is found (no reload);
    - the extension closes its own tab and reports the capture (`…/details`) or why there was none (`…/result`).
  - **Server.** `apps/web/src/server/page-capture-tabs.ts`: the page must be the staged job (`capturedPageIdentity` of the final address equals the staged `externalId`), then it goes through the shared ingestion path — the same one the LinkedIn worker uses — and is handed once to the existing triage-gated evaluation request. Every report is idempotent: only a job still queued changes.
  - **Safeguards.**
    - Access restriction (HTTP 401/403/429/999/5xx, sign-in redirect or wall, challenge or CAPTCHA, the tab leaving the site's hosts): the batch stops, every queued WTTJ job becomes Awaiting details (ACCESS_STOPPED or RATE_LIMITED), and the site is not contacted for at least 24 h. The end of the wait resumes nothing; only a new save of a results page reads again, and a save during the wait stages the jobs but opens no tab.
    - Identity mismatch: the batch stops; the job is IDENTITY_MISMATCH and the rest BATCH_STOPPED; the site is not stopped.
    - 404/410: UNAVAILABLE; continue. Unreadable: UNREADABLE; continue.
    - A tab the user closed: INTERRUPTED; never reopened; continue.
    - The user's Stop (popup), or a removed permission: the job being read finishes, nothing more opens, and the rest becomes USER_STOPPED or PERMISSION_MISSING.
    - Browser closed: the run lives in `chrome.storage.session` and is cleared at browser start, so nothing reopens; jobs still queued 60 minutes after their save and last start become INTERRUPTED (`expireTabItems`, run on the progress page and at intake).
    - Service-worker restart mid-run: an alarm backstop resumes; the open tab is read once, or the job is INTERRUPTED if its tab is gone.
  - **Registry (`packages/core/src/page-capture.ts`).** WTTJ gains `tabAcquisition` (host permissions `https://www.welcometothejungle.com/*` and `https://app.welcometothejungle.com/*`, 30 s load timeout, re-reads at 2 s and 5 s); its 12 s interval is unchanged. Card-reader fixes from the real F0: `/en/get-started/jobs-preview` is a results page; a structural company selector; the posted date. Location is read from the job page. `cardVerified`/`detailVerified` stay `false` until live acceptance; the new explicit `PAGE_CAPTURE_ACCEPTANCE_SITES` setting enables it for acceptance only. New reason codes: INTERRUPTED, IDENTITY_MISMATCH, BATCH_STOPPED, USER_STOPPED, PERMISSION_MISSING.
  - **Extension.** Manifest `0.2.0`: adds `alarms` and `optional_host_permissions` (exactly the two WTTJ hosts; still no `tabs`, content script or other host). New `tab-acquisition.ts` (orchestrator and page check) and `tab-messages.ts` (popup ↔ service worker). The service worker runs the reading. The popup shows the run's progress with a Stop button. If Chrome closes the popup while the permission prompt is open, a grant still saves the batch (kept 2 minutes in session storage).
  - **Progress page.** No Retry for background-tab jobs: they show "Save the results page that shows it again to read its details". The server refuses Retry for them; Dismiss and Restore are unchanged.
  - **Shared changes, explained.** LinkedIn behaviour is unchanged:
    - the ingest-and-hand-off step moved verbatim out of the worker pass into `createPageCaptureIngestor`, so both mechanisms share one path;
    - the worker skips any site whose mechanism is not `server-browser`, so it never fetches WTTJ even when the site is enabled;
    - the repository gains tab-only methods (`startTabItem`, `settleTabItem`, `stopTabItems`, `stopTabSite`, `expireTabItems`) and two optional `stageBatch` inputs used only for tab sites (`requeueAwaiting`, `awaitingReason`).
    - No schema change and no migration. LinkedIn's committed tests pass unchanged.
  - **Tests.**
    - `tests/fixtures/page-capture/wttj-f0-cards.json`: the real F0 cards, read exactly.
    - `tests/unit/page-capture-wttj.test.ts` (19): registry, manifest parity, intake, the worker's exclusion, Save asking for the permission inside the click and sending nothing when declined, route authentication, Retry refusal.
    - `tests/unit/page-capture-tab-acquisition.test.ts` (32): the 25-job run, pacing, re-reads, every restriction signal, identity mismatch, interruption, Stop, permission removal, service-worker resume, page-check markers.
    - `tests/integration/page-capture-wttj.test.ts` (5, test DB): the real orchestrator against the real server tab service, ingestion and triage (EVALUATE / NEEDS_REVIEW / REJECT, admission only for EVALUATE); the access-restriction stop with no resume and re-save after the wait; identity mismatch; interruption, 404 and Stop; staleness and idempotent reports.
    - `tests/unit/page-capture-ui.test.tsx` (+2).
    - `tests/unit/extension-client.test.ts`: the 14B manifest and service-worker contract updated narrowly to P2 (alarms and the two optional WTTJ hosts; the service worker may open background tabs and inject only the page check and the reader).
  - **Verification** (offline only; test DB only; no WTTJ request, no permission granted, no live browser, no provider or evaluator call):
    - typecheck, lint, `prisma validate`, extension build and `git diff --check` pass; `apps/web/next-env.d.ts` untouched.
    - Unit: 92 files passed, 1 skipped (2,144 passed, 6 skipped).
    - Integration: 47 files, 373 tests passed.
    - E2E not run: no E2E file changed, and Codex owns the E2E cleanup.
    - The test database was left clean.
  - **Not yet done (separate authorization):** WTTJ's live acceptance in Alex's Chrome (acceptance database, `PAGE_CAPTURE_ACCEPTANCE_SITES=welcome-to-the-jungle`). After it passes, set WTTJ `cardVerified`/`detailVerified` and record the evidence.
    - Risk to confirm live: a job link carrying non-tracking query parameters (for example `?q=…&o=…`) is a different listing identity under the existing shared rule. F0's links had none.
- **Verification:** offline only, on `ai_career_assistant_test`; no live, provider, paid or evaluator call; the normal and acceptance databases do not exist in this container and were not touched.
  - typecheck, lint, `prisma validate`, production web build, extension build, `git diff --check`; `apps/web/next-env.d.ts` untouched.
  - `db:verify-migrations`: all 26 migrations applied in order to a temporary database; only the documented Recommendation default drift; temporary database dropped.
  - Unit: 87 files passed, 1 replay file skipped (2,072 passed, 6 skipped). New suites: `page-capture` 17, `page-capture-reader` 10, `page-capture-ui` 6, `extension-triage-outcomes` 3.
  - Integration: 45 files / 365 tests, including `page-capture` (4): staging creates nothing; acquisition → real ingestion → real triage, with EVALUATE admitted and NEEDS_REVIEW/REJECT creating no admission, evaluation or semantic attempt; idempotent repeats; Mode A re-observation; no RetrievalSource or RetrievedListing.
  - E2E, every project run sequentially (`--no-deps`), plus each formerly blocked test run on its own: 55 passed, 4 failed, 0 not run (59 tests).
    - The new `page-capture` project passed 4/4: read loaded cards, deselect, stage, Awaiting details with Retry/Dismiss/Restore, automatic acquisition, Evaluate/Needs Review/Reject, the Needs Review decision in the triage panel, and Mode A re-observation plus a Mode A REJECT message with no polling.
    - The `extension` project passed 8/8.
  - **One extension test was updated narrowly to the triage contract:** `extension.spec` "pair, read, … request an evaluation, and capture again".
    - Its fixture job is legitimately held as Needs Review, and the test had encoded the pre-triage "queued" step.
    - It now asserts the truthful held message: not queued, no polling, no evaluation.
    - It then releases the job with **Evaluate** in the existing triage panel and checks that the reopened popup follows the queued evaluation to its recommendation.
    - The later test "running and failed states" passed unchanged, proving that a `QUEUED` request still starts the normal polling flow.
  - **All 4 remaining failures reproduce identically on the untouched `e84c1cc` baseline**, in older web-app specs whose fixtures predate the post-`45d5fff` triage/evaluator changes:
    - `evaluation-results` "material ambiguity … Review" and `dashboard` "search, filter, sort…": the deterministic helper worker ends FAILED;
    - `golden-path` "golden path…" and "recovery…": triage holds the fixture, so there is no "Evaluation accepted and queued".
    They need a coordinated fixture decision (Codex / Alex) and are not fixed here.

## Pre-Evaluator Triage — Milestone 9 Admission/Backlog Enhancement

**Implemented, verified and committed on November 2, 2026 at `5ac3c9d`, after the final-integration baseline `45d5fff`.** This is a new enhancement; it was not part of the historical Milestone 9 implementation or the CX-1–CX-4 integration baseline.

- Architecture: normalization and deduplication/re-observation remain unchanged; the product evaluation service now runs deterministic triage before duplicate-spend locking, budget admission, deferral or evaluator enqueue.
- Contract: exactly `EVALUATE`, `NEEDS_REVIEW` and `REJECT`. `NEEDS_REVIEW` and `REJECT` create zero Evaluation, EvaluationTask, EvaluationAdmission, DeferredEvaluation or SemanticOperationAttempt rows. Only `EVALUATE` reaches the existing admission/backlog path.
- Deterministic inputs: the accepted salary policy over normalized salary/currency/compensation-basis/residency facts; normalized residency against configured location policy; normalized work arrangements against configured hard preferences; and conservative work-authorization relevance. Unknown, incomplete, ambiguous or conflicting prerequisites are held for review, never guessed or converted to rejection.
- Deliberately excluded: seniority and employment type have no sufficiently deterministic structured profile hard policy; role fit, travel and all prose interpretation remain in the semantic evaluator.
- Persistence/UI: one additive `PreEvaluatorTriage` record per Opportunity stores the automatic outcome, reasons, causal fields, input fingerprint, profile version and optional manual decision. `/budget` exposes the review backlog; opportunity pages show reasons; open review has exactly **Evaluate** and **Reject**. Manual decisions preserve the unresolved facts and survive reassessment.
- Re-observation: triage is recomputed from current normalized facts when evaluation is requested or a deferral is resumed; the same record is updated, provenance/history and `firstSeenAt` are untouched, and an explicit manual decision is not silently erased.
- Evaluator boundary: no evaluator prompt, model, route, schema, six-released/fifteen-withheld field contract, Ghost Job Risk behavior or deterministic final recommendation changed.
- Verification: Prisma validation and migration status; all 25 migrations applied in order to a temporary test-only database with only the documented Recommendation default drift; 83 unit files passed plus one replay file skipped (2,036 passed, 6 skipped); 44 integration files passed (361 tests, with the sandbox-failed source-version subprocess rerun successfully outside the constrained sandbox); focused 12-file admission/lifecycle/evaluator/normalization/dedup gate (229 tests); triage DB integration (7 tests); dedicated Playwright E2E (1 complete scenario); typecheck, lint, production web build and `git diff --check`. All DB-backed work used `ai_career_assistant_test`; no live/provider/paid calls; normal and acceptance databases untouched.

## Current Objective

Extension Mode B is implemented and verified offline (see above). It awaits Alex's review and commit/push approval. Then come:
- F0 fixtures and the bounded P1 experiment per site (Alex, local);
- each site's targeted live acceptance;
- the final whole-product regression gate;
- the final evaluator live acceptance (D8, separately authorized);
- the next formal PRD/TDD versions covering triage and the extension together.

The Milestones 1–10 historical integrity audit is complete (Codex, against `45d5fff`): 0 critical, 0 major, 0 partial, 0 missing and no freeze blocker. *(Earlier objective, November 2, 2026: "The pre-evaluator triage enhancement is complete. Next is the separate Milestones 1–10 historical integrity audit. Do not start the extension implementation, final live evaluator acceptance, or later add-ons as part of this task.")*

The historical boundary is explicit:

1. `45d5fff` — final evaluator/product integration, before pre-evaluator triage.
2. `5ac3c9d` — new triage implementation.
3. Next — Milestones 1–10 integrity audit, which must evaluate the earlier milestone state against `45d5fff` without backdating triage.

## Final Evaluator / Product Integration — CX-1 to CX-4

**Implemented, fully verified, committed and pushed as `45d5fff` on November 2, 2026. This is the preserved pre-triage baseline.**

- The accepted evaluator checkpoint `7d1f4f0` was merged with `--no-ff --no-commit` onto the product-based integration branch. Product-owned Features 11–18 code won its conflicts; evaluator-owned Hard Filters v3, salary policy v3, JD Reconstruction v7, Resume Match v4, Organizational Maturity v7, semantic contract repairs, routing overrides and GPT-6 pricing/configuration were retained.
- Exactly `salaryMin`, `salaryMax`, `currency`, `residencyRequirement`, `residencyRegions` and native Core `compensationBasis` are released to the evaluator. The other 15 approved fields remain withheld. Evaluated-source and as-of provenance binding remain intact.
- The eight reproduced unit failures were resolved as one evaluator regression (six cases of a missing `residencyRegions` array), two stale expectations, and the generated-Prisma environment prerequisite. Full unit verification passes: 81 files passed, one replay file skipped because no local artifacts exist; 2,023 tests passed and six skipped. Typecheck, lint, Prisma schema validation, and focused evaluator/lifecycle verification pass.
- Ghost Job Risk remains intentionally `UNKNOWN` in production with no posting-history input or provider call. Final Recommendation remains deterministic. The structured profile-limitations contract is integrated without importing or activating a persisted profile.
- The isolated `ai_career_assistant_test` database was created empty and migrated through all 24 repository migrations. The complete guarded integration suite passes (43 files, 354 tests). Migration verification applied all 24 migrations in order to a fresh temporary `ai_career_migration_check_*` database, confirmed only the documented `Recommendation.evidenceReferences` default drift, and dropped the temporary database. The normal and acceptance databases were untouched.
- The DB gate exposed four stale Genuine Gap vertical-slice fixtures, two stale pre-integration withholding assertions, and two Windows-only `pnpm` child-process launch defects in test/migration tooling. The fixtures now prove the accepted structured limitation plus JD Reconstruction v7 level contract; the assertions prove the six-field release; the tooling invokes pnpm safely on Windows. No evaluator contract was weakened.
- The integration was committed and pushed as `45d5fff`. The original dirty product checkout remained untouched.

## Earlier Objective — Final Integration Closeout

**CX-1 to CX-4 were completed and accepted on November 2, 2026. The text below records that closeout state and is preserved as history.**
- Alex approved the final integration audit with every recommended decision: D1–D7, D9 and D10. D8, the live acceptance, is not yet authorized.
- Alex assigned the merge work (CX-1 to CX-4) to Codex.
- Claude created the integration branch `integration/final-evaluator-product` from the accepted product checkpoint `b1b15af`, and recorded the Codex work package in `HANDOFFS.md` ("Final Evaluator / Product Integration — Codex Work Package CX-1 to CX-4").
- The controlled merge remains staged and uncommitted. No live or provider call was made. Feature 19 has not started.

In order, what follows:

1. Done: Alex's final review and commit/push approval for CX-1 to CX-4; committed as `45d5fff`.
2. Next after the new post-baseline triage enhancement: the Milestones 1–10 Codex integrity audit.
3. Then (Claude), in the locked final-integration sequence:
   - CL-1: withholding tests;
   - CL-2: profile-limitations version;
   - CL-3: cross-feature regression;
   - CL-4: full isolated gate;
   - CL-5: documentation.
4. Then: the final live acceptance (only with Alex's separate authorization), then the documentation and spec bump at the freeze, then the merge.

*(The objective below, from October 31, 2026, is kept as written; integration has now started.)*

**Feature 18, Company Intelligence, is complete: implemented, verified and accepted by Alex on October 31, 2026, and committed. Main-product features 1–18 are complete.** It was built to the approved Feature 18 contract (planning audit approved October 31, 2026, decisions D1–D19 as recommended) and completes main-product features 1–18. Details are in the Feature 18 section below.

In order, what follows:

1. Done: Alex's review and acceptance of Feature 18 (October 31, 2026, after the approved pre-commit corrections) and the checkpoint commit. *(Earlier step: "Next: Alex's review of Feature 18, then the checkpoint commit on Alex's approval.")*
2. Next: the deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge (not started).

*(The objective below, from October 31, 2026, is kept as written; Feature 18 has now been implemented.)*

**Feature 17, Personal Job-Search Analytics, is complete: implemented, verified and accepted by Alex on October 31, 2026, and committed.** It was built to the approved Feature 17 contract (planning audit approved October 31, 2026, decisions D1–D14 with two corrections: date-only recommendation-at-application timing and offer denominators that exclude processes still in progress); see "Feature 17 — Personal Job-Search Analytics" under Recently Completed.

In order, what follows:

1. Done: Alex's review and acceptance of Feature 17 (October 31, 2026; the seven implementation interpretations accepted as reported) and the checkpoint commit. *(Earlier step: "Next: Alex's review of Feature 17 …, then the checkpoint commit on Alex's approval.")*
2. Then: main-product feature 18, company intelligence (not started). Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

*(The objective below, from October 31, 2026, is kept as written; Feature 17 has now been implemented.)*

**Feature 16, Job-Market Analytics, is complete: implemented, verified and accepted by Alex on October 31, 2026, and committed.** It was built to the approved Feature 16 contract (planning audit approved October 31, 2026, decisions D1–D10 with the "Automated only" default and requirement option A with stricter version handling); see "Feature 16 — Job-Market Analytics" under Recently Completed.

In order, what follows:

1. Done: Alex's review and acceptance of Feature 16 (October 31, 2026, after the approved pre-commit corrections) and the checkpoint commit. *(Earlier step: "Next: Alex's review of Feature 16 …, then the checkpoint commit on Alex's approval.")*
2. Then: main-product features 17–18 in order (Feature 17 has not started) (personal job-search analytics, company intelligence). Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

*(The objective below, from October 31, 2026, is kept as written; Feature 16 has now been implemented.)*

**Feature 15, Source Intelligence, is complete: implemented, verified and accepted by Alex on October 31, 2026, and committed.** It was built to the approved Feature 15 contract (planning audit approved October 31, 2026 with decisions D1–D11 and seven clarifications); see "Feature 15 — Source Intelligence" under Recently Completed. Feature 14 is complete: Feature 14B's live acceptance passed on October 29, 2026 (`2ccdc7f`).

In order, what follows:

1. Done: Alex's review and acceptance of Feature 15 (October 31, 2026, after the approved pre-commit corrections) and the checkpoint commit. *(Earlier step: "Next: Alex's review of Feature 15 …, then the checkpoint commit on Alex's approval.")*
2. Next: main-product features 16–18 in order (Feature 16 has not started) (job-market analytics, personal job-search analytics, company intelligence). Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

*(The objective below, from October 29, 2026, is kept as written; Feature 14 is now complete.)*

**Feature 14B live acceptance passed (October 29, 2026).** The live round of the October 29 batch (`76ce118`) still failed on seven cases (SafeBreach location, SmartRecruiters and Remote OK application URLs, We Work Remotely default capture and the New Law Business Model company, ServiceTitan's default-capture PST/MST hours and its zone tiers). This second round was worked from the real environment, not from fixtures: Alex's computer was connected through Remote Control, his stored extension captures were exported read-only from `ai_career_assistant_acceptance`, and the live pages were rendered and read in Playwright's own Chromium on his machine. Every fix was traced on that real evidence and then verified by Alex through the installed Chrome extension into the live acceptance app: **all eight blocker cases pass** (see "Feature 14B live acceptance, round 2" under Recently Completed). Committed on `claude/gallant-pasteur-y1ou3i`. The remaining known edge cases (Lever Bluesight's employment type, Jobs for Humanity's monthly pay, Remote OK Renaissance's short description, NLBM's "Region: Anywhere" not shown as a location) are explicitly non-blocking. Feature 15 has not started.

*(The objective below, from October 29, 2026, is kept as written; its live round found the defects fixed by round 2.)*

**Feature 14B live acceptance batch (October 29, 2026).** Alex's latest full live round of the committed batch (`51f3279` with the currency correction `451b652`) confirmed Working Nomads, Ashby, Workable, Wellfound, Greenhouse Healthie, Lever Mongoose and Wing, Workday Thomson Reuters, LinkedIn Serrala's tiers and Welcome to the Jungle AlphaSense's salary, and found the remaining defects listed in the batch-fix handoff. They were fixed as one end-to-end contract (page evidence → extension collection → page context and structured fields → capture mapping and source facts → shared normalization → provenance and persistence → display); see "Feature 14B live acceptance batch" under Recently Completed. The batch is implemented, verified and committed on `claude/gallant-pasteur-y1ou3i`. **Feature 14B stays unaccepted** until the corrected build passes the targeted live verification listed under the batch; a few cases need Alex's stored evidence before they can be closed (listed there). Feature 15 has not started.

*(The objective below, from October 27, 2026, is kept as written; its live round is done.)*

**Feature 14B final cross-source batch (October 27, 2026).** Alex's final human cross-source retest of the committed checkpoint (v7 `6536ef8`, with the read-only retest helper `362fe01`) found remaining defects on ten sources. They were audited along the whole path (extension collection → capture envelope and source facts → shared normalization → provenance and persistence → the opportunity's display) and fixed as shared contracts, not per posting; see "Feature 14B final cross-source batch" under Recently Completed. The batch is implemented, verified and committed on `claude/gallant-pasteur-y1ou3i`. The same day, Alex corrected the currency rule: a recognized currency symbol is read directly as its currency, and a stated code or name takes precedence (see "Feature 14B currency symbol correction"; also committed). **Feature 14B stays unaccepted** until the corrected build passes the small targeted live verification listed under the batch. Feature 15 has not started.

*(The objective below, from October 23–26, 2026, is kept as written; its review and the cross-source live retest it called for are done.)*

**Feature 14B correction — the shared Core job-text fallback** is implemented and verified with automated tests on `claude/gallant-pasteur-y1ou3i`, and awaits Alex's review. It is **not committed or pushed**. Feature 14B was committed as `e6bacc6` (October 20, 2026). Alex's local acceptance then showed that the shared Core normalizers left already-supported facts Unknown when a source stated them only in the job text, and Alex approved correcting this in shared Core. See "Feature 14B correction" under Recently Completed. The same review then corrected the Core TDD §51 re-observation contract: a changed version of the listing an opportunity was found from now becomes its current facts, with every version kept and evaluations bound to the version they evaluated (see "current-version projection" under Recently Completed). That is implemented and verified too, and also **not committed or pushed**. The final acceptance capture (Greenhouse Healthie) then led to the shared-normalization convergence correction of October 25, 2026 (see "shared-normalization convergence" under Recently Completed): stated compensation keeps its numbers and basis, work authorization is a normalized fact interpreted for the user by a separate relevance layer, explicit team statements populate the department, and the application URL is captured with its basis on every path. Also **not committed or pushed**.

On October 25, 2026, Codex also handed over the evaluator side of the compensation-basis contract (Milestone 4 correction, uncommitted on `codex/evaluator-live-diagnostic`, not merged). Its review found the two sides compatible except one edge case: an OTE range that also mentions "base" normalized with a `null` basis. Alex approved the Core fix the same day, and it is implemented as Feature 14B v5 (see "Feature 14B v5 — compensation-basis OTE precedence" under Recently Completed). With it, the contracts are compatible.

Alex's full live acceptance sweep across every supported source then produced the **cross-source correction of October 26, 2026** (see "Feature 14B cross-source correction" under Recently Completed): every source except Greenhouse had a defect, and they were corrected as one contract rather than per source. Department was removed from the product and the opportunity now shows Salary instead of a separate Compensation row. Also **not committed or pushed**.

**Feature 14B stays open and Feature 14 is not complete.** They close only after Alex's review of these corrections, a **complete cross-source live retest** of every supported source domain (generic employer careers pages excluded), and Alex's acceptance. Feature 15 does not start before then. *(Earlier: "after Alex's review of this correction, the minimal human retest, and Alex's acceptance".)*

In order, what follows:

1. Next: Alex's review of the correction (diff, verification and documentation, including Core Platform TDD v1.15 and Core AI Framework PRD v1.14), then the minimal human retest on fresh isolated records, then the checkpoint commit on Alex's approval.
2. Then: once Feature 14B is accepted and Feature 14 complete, clean-up of the disposable Feature 14 acceptance data. This applies only to dedicated acceptance or test databases, after verifying the target is not the normal application database. After that, the personal-documentation export and Feature 15.
3. Then: main-product features 15–18. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

*(Earlier objective, superseded on October 23, 2026 when the job-text fallback correction was implemented. It read as follows.)*

**Feature 14B — the browser-extension companion** is implemented and verified with automated tests on `claude/gallant-pasteur-y1ou3i`, and awaits Alex's review and local Chrome acceptance. It is **not committed or pushed**. It was built to the approved Feature 14B plan (decisions D1–D4 and O1–O4, October 20, 2026); see "Feature 14B" under Recently Completed. Feature 14 is **not complete until 14B is accepted**; there is no Feature 14C, and Feature 15 does not start before then.

*(Earlier wording, superseded on October 20, 2026 when 14B was implemented: "Feature 14B … is the next main-product task. It is required main-product work and is not yet implemented (no extension code exists; `apps/extension` holds only a placeholder).")*

**Feature 14A — browser-assisted automated retrieval and source corrections** is complete and accepted: committed and pushed as `dd77d298cfb0888f8914e1592d30d426b30fe6c4` on `claude/gallant-pasteur-y1ou3i` (October 20, 2026) and accepted after the local-runtime LinkedIn adapter check. On October 20, 2026 the committed adapter (`dd77d29`) was run from the local WSL runtime with one search page and one job page: the public search page returned HTTP 200 and 60 public job cards were discovered (the "Sign in to view more jobs" modal did not prevent it); the first job-detail page returned HTTP 429, and the run stopped at once as RATE_LIMITED, with no retry and no listing emitted. Feature 14A was accepted on that result; LinkedIn itself stays unverified and disabled (a source-side rate limit, not an implementation defect) and is not retried. Any later live check of LinkedIn's job pages is a separate, explicitly approved source-enablement decision.

In order, what follows:

1. Next: Alex's review of Feature 14B (implementation, verification and documentation, including the new spec versions, are done), then its local acceptance in Chrome on a dedicated acceptance database (`apps/extension/README.md`, "Local acceptance runbook"), then the checkpoint commit on Alex's approval. *(Earlier step: "Next: Feature 14B, the browser-extension companion (not started …)", superseded October 20, 2026 when it was implemented.)*
2. Then: main-product features 15–18, after 14B is accepted. Feature 15 does not begin before then unless Alex changes the roadmap.
3. Only after features 1–18: deliberate evaluator/product integration (including how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Correction, October 20, 2026: An October 19, 2026 implementation instruction incorrectly treated Feature 14B, the required browser-extension companion, as deferred, an optional future idea and not required. No approved roadmap or authoritative product-scope revision removed Feature 14B from the main product. This correction (October 20, 2026) resolves that inconsistency while preserving Feature 14A's accepted implementation. From October 19 this document repeated that instruction, calling the browser extension "deferred" or "an optional future idea"; those statements are superseded. The corrected specification versions are Core AI Framework PRD v1.12, Customer Success PRD v1.11, Core Platform TDD v1.13 and Customer Success TDD v1.11.)*

*(Earlier objective, superseded on October 20, 2026 when Feature 14A was committed as `dd77d29` and accepted. It read as follows.)*

**Feature 14 — browser-assisted retrieval and source corrections** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 13 was committed as `d1bf217` (October 19, 2026).

In order, what follows:

1. Next: user review of Feature 14, then the checkpoint commit and the personal-file refresh. LinkedIn is a viable source awaiting one controlled local-runtime verification of the Feature 14 adapter itself, after this code is synced locally (the Claude cloud automated Chromium got HTTP 429 and an anti-bot interstitial, but a local logged-out browser check loaded normal public results); Welcome to the Jungle stays disabled because WTTJ's tested public surfaces (the search page, and the company jobs page checked locally) expose no usable job records. Any further check is a separate, approved decision, never a workaround.
2. Then: main-product features 15–18.
3. Only after features 1–18: deliberate evaluator/product integration (including how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved. The Manifest V3 browser extension, originally planned as feature 14, is deferred as an optional future idea.

*(Earlier objective, superseded on October 19, 2026 when Feature 13 had been committed as `d1bf217` and Feature 14 implemented. It read as follows.)*

**Feature 13 — posting history and listing removal** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 12 was committed as `f10a02b` (October 18, 2026).

In order, what follows:

1. Next: user review of Feature 13, then the checkpoint commit and the personal-file refresh.
2. Then: main-product features 14–18.
3. Only after features 1–18: deliberate evaluator/product integration (including how Ghost Job Risk adopts the Feature 13 posting-history facts), full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 19, 2026 when Feature 12 had been committed as `f10a02b` and Feature 13 implemented. It read as follows.)*

**Feature 12 — source health and conservative retrieval** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 11B was committed as `2a1d8c2` (October 18, 2026).

In order, what follows:

1. Next: user review of Feature 12, then the checkpoint commit and the personal-file refresh.
2. Then: main-product features 13–18 (feature 13 now includes listing expiry/removal detection).
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 18, 2026 when Feature 11B had been committed as `2a1d8c2` and Feature 12 implemented. It read as follows.)*

**Feature 11B — automated retrieval from the verified public/guest-endpoint and public-HTML sources** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 11A was committed as `fad2341` (October 18, 2026).

In order, what follows:

1. Next: user review of Feature 11B, then the checkpoint commit and the personal-file refresh.
2. Then: main-product features 12–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 18, 2026 when Feature 11A had been committed as `fad2341` and Feature 11B implemented. It read as follows.)*

**Feature 11A — automated retrieval from the verified official API and feed sources** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. Its documentation closeout, including the versioned PRD/TDD check, is done; it closes with the review and then the checkpoint commit. Feature 11B (the verified public/guest-endpoint and public-HTML sources) is a separate acceptance unit that starts only after 11A is committed.

In order, what follows:

1. Next: user review of Feature 11A, then the checkpoint commit and the personal-file refresh.
2. Then: Feature 11B, then main-product features 12–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 18, 2026 when the gap closure had been committed as `d573acf` on October 17 and Feature 11A implemented. It read as follows.)*

The **Features 1–10 Gap Closure** is implemented and verified on `claude/gallant-pasteur-y1ou3i` and is awaiting user review. It is not committed or pushed yet. It closes with the review, the check of the versioned PRDs/TDDs against what changed, and then the checkpoint commit. The read-only gap audit that defined it is complete (October 17, 2026). The work package has deliberately not been given a task number.

In order, what follows:

1. Next: user review of the gap closure, the versioned-specification check, and the checkpoint commit.
2. Then: main-product features 11–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier objective, superseded on October 17, 2026 when the gap audit was completed and the gap closure implemented. It read as follows.)*

The Task 1–9 completion pass is complete on `claude/gallant-pasteur-y1ou3i`:

- Task 8 — Application Tracker completion pass: complete (`534a4c7`);
- Task 9 — Operations hardening completion pass: complete (commit `feat: complete operational hardening`, October 16, 2026).

The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is also complete (October 16, 2026): Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3 are the current authoritative versions.

In order, what follows:

1. Next: audit any remaining gaps in main-product features 1–10.
2. Then: main-product features 11–18.
3. Only after features 1–18: deliberate evaluator/product integration, full isolated verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons. The Task 7 → Customer Success Milestone 4 contract is preserved.

*(Earlier next step, superseded on October 16, 2026 when the versioned-document update was committed: "Next: the separate post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update (new PRD/TDD versions, Semantic Evaluation Playbook v1.3).")*

*(Earlier objective, superseded on October 16, 2026 when the Task 9 completion pass was committed: "The current task is Claude Task 9 — Operations hardening completion pass on `claude/gallant-pasteur-y1ou3i`. It is open: implementation and isolated verification are complete; the documentation synchronization is under review; it closes with the review and then the checkpoint commit.")*

*(Earlier objective, superseded on October 16, 2026 when the Task 8 completion pass was committed: "The Claude Task 8 — Application Tracker completion pass is implemented on `claude/gallant-pasteur-y1ou3i` and awaiting user review before its checkpoint commit. The Task 9 completion pass follows after that review.")*

*(Earlier objective, superseded on October 15, 2026 when the completion pass was implemented: "Complete Claude Task 8 — Application Tracker as the next completion-pass task while preserving the now-aligned Task 7 → Customer Success Milestone 4 contract.")*

*(Earlier objective, superseded on October 15, 2026: "Finish the evaluator and remaining main-product work in parallel so they can be combined into a stable, usable first product before automated retrieval/scraping begins." Main-product scope is now features 1–18, which include retrieval and intelligence; see `DEVELOPMENT_PLAN.md`.)*

## Recently Completed (October 14–31, 2026)

### Feature 18 — Company Intelligence (implemented, verified and accepted October 31, 2026; committed)

**What it does.** A read-only view of what the system knows about each company over time, from the listings collected and Alex's own applications (Development Plan item 18: repost/frequency patterns, hiring speed, remote friendliness, response patterns, recurring roles), with every term replaced by an observable fact.

**Approved contract (October 31, 2026; D1–D19 as recommended).** Recorded in Customer Success PRD v1.16 §19 and Core Platform TDD v1.19 §51.
- **Identity (D1):** a company is the Company rows grouped by `COALESCE(normalizedName, id)` (the dashboard company filter), shown under the oldest row's name with its name variants; any member id resolves to it; no fuzzy, alias, domain or parent merging; jobs without a company counted only; the page discloses that legal entities and brands stay separate.
- **Routes (D2):** `/companies` ("Companies" after Market) and `/companies/[id]`; `GET /api/companies`, `GET /api/companies/[id]` (400 invalid, 404 unknown or malformed id; a valid company always opens, possibly with no roles observed in the window but with its applications by application date); the opportunity page links its company.
- **Observed postings (D3):** distinct canonical opportunities by `firstSeenAt` month in the budget time zone; "counts what your sources collected, not the company's actual hiring"; changed postings; unresolved probable duplicates disclosed, not subtracted.
- **Reposts (D4, A + B):** Feature 13 facts per role — listed again after confirmed removal (with days from `removedAt` to `reappearedAt` and times), closed on the employer board but seen elsewhere, unchanged ≥ 30 days — and relisting under a new listing ID with the same requisition (a MATCH record with `matchedOn` including `requisitionId` from a source that already listed the role under another ID); "x of n", with how many roles could show a repost; no ghost wording.
- **Recurring roles (D5):** ≥ 2 roles in one title group (Other title never recurring), exact titles case- and space-folded; not a repost.
- **Arrangement and regions (D6, D13):** arrangement distribution and "x of n … were Remote"; hiring-eligibility and job-location regions as separate tables; sponsorship, relocation and employer-of-record counts; no label.
- **Your history (D7):** Feature 17 `personalOutcomeOf` unchanged; awaiting response, in process, mature with nothing recorded, recorded closed outcomes; interview and offer rates with their counts, never ranked.
- **Timing (D8, D9):** observed listing duration per listing, never combining two listings (each removed listing's own first seen → its own confirmed removal; each still-listed listing "at least N days", outside the confirmed figures); application → first progress recorded (stage change or interview by when it was recorded), first interview date, closed, offer — whole days, values below 5, median from 5, out-of-order dates excluded and counted.
- **Not included (D10, D12, D17):** Ghost Job Risk summary (always UNKNOWN on this branch), salary analysis (stated text per role only), a timeline.
- **Company type (D11):** customer segment, customer type and business model from each role's latest completed evaluation, counted, never averaged, with coverage.
- **Windows (D14):** 30/90/180 days, 1 year, all time (default), custom; roles by first seen, applications by application date; listing state as of now.
- **Index (D15) and detail (D16):** the index lists companies with at least one role first observed in the window (applications alone never add a company; a company page opened directly still shows its applications by application date, even with no role in the window); its "Listed again after removal" column counts only roles with a Feature 13 reappearance after confirmed removal (same-requisition relisting stays a separate detail signal; the has-signals filter accepts either); columns, filters and orderings as approved; 50 per page; no rate ordering; six detail sections plus the observed roles.

**Implementation.**
- `packages/core/src/company-intelligence.ts` — the pure contract: `companyGroups`, `parseCompanyWindow`, `parseCompanyIndexQuery`, `roleListingState`, `roleSignals`, `requisitionRelisted`, `applicationTimings`, `buildCompanyIndex`, `buildCompanyDetail`. Reuses Feature 13 `isRecentlyListed` / `isNoLongerListed` / `derivePostingHistoryFacts`, Feature 15 `siRate` / sample labels / `sourceInfoOf`, Feature 16 `createTitleGrouper` / `arrangementOf` / `hiringRegionsOf` / `jobRegionsOf` / `median` / `latestCompletedEvaluation` (made generic), Feature 17 `personalOutcomeOf` / `localDay` / `parsePersonalWindow` / `dateOnlyDay` / `originIdentityOf` (exported).
- `database/src/company-intelligence-repository.ts` — `facts(companyIds?)`, `companyGroupIds(id)`, `companyIdForOpportunity(id)`: read-only SELECTs (companies; opportunities with a company, originating record and MARK_APPLIED; ledger rows with current-scope flag; source records with superseded/changed flags and MATCH `matchedOn`; evaluation classifications by JSON path; unresolved PROBABLE_MATCH pairs; applications with events and interviews). A detail read is scoped to one company group.
- `apps/web/src/server/company-intelligence-service.ts`, `GET /api/companies`, `GET /api/companies/[id]`, `/companies`, `/companies/[id]`, `apps/web/src/components/companies/*`; nav entry; opportunity-page company link.

**Schema / migration:** none. 24 migrations, unchanged.

**Tests.** Unit `company-intelligence.test.ts` (27: identity grouping, query parsing, roles counted once, listing state, listing duration, months by time zone, probable duplicates, Feature 13 reposts, requisition relisting vs cross-source duplicates, closed elsewhere / unchanged, recurring groups and exact titles, arrangement and regions, Feature 17 outcomes, timing and inconsistent dates, values vs median, windows, company type, index filters / sorts / paging, no score fields; pre-commit corrections: index column Feature 13 only and a role with both signals counted once, index cohort needs a role in the window, listing-level duration never combining two listings) and `companies-ui.test.tsx` (5: 400 before reading, 404, index and detail wording with no hiring, ghost, score or label terms, timing text); navigation test extended. Integration `company-intelligence.test.ts` (6, isolated test database: group ids, stored facts read, scoped reads, detail, history and timing, index; table counts unchanged by a read). E2E `companies.spec.ts` (2, own project after my-search: nav, search and filters, invalid query, detail sections, legacy id, 404, opportunity-page link).

**Verified:** October 31, 2026; isolated test database `ai_career_assistant_test` only; no live or provider calls; the normal and acceptance databases were not touched: typecheck and lint; `prisma validate`; `db:verify-migrations` (24, unchanged); unit 76 files / 1,856 tests; integration 43 files / 354 tests; E2E 54/54 (2 new in the `companies` project); web and extension builds; `git diff --check` clean; `apps/web/next-env.d.ts` restored.

**Known limitations.** Company identity is exact normalized name only: legal-entity strings (often from Workday) and brands split one employer. Automated retrieval began October 18, 2026, so removal, repost and duration facts are sparse for now and show as insufficient samples. Stage changes are recorded without a date, so progress timing is when Alex recorded the change. Per-company personal samples are almost always below 5. Unresolved probable duplicates may inflate a company's role count (disclosed).

**Docs and specs.** Core AI Framework PRD v1.18 (§20 company-level analytics as observed facts), Customer Success PRD v1.16 (§19 Company Intelligence definitions; Feature 17/18 deliverable labels), Core Platform TDD v1.19 (§51 Company Intelligence; the Feature 13 note on new-ID reposts updated), Customer Success TDD v1.16 (evaluator outputs read); previous versions archived unchanged. HANDOFFS Feature 18 record.

### Feature 17 — Personal Job-Search Analytics (implemented, verified and accepted October 31, 2026; committed)

**What it does.** A read-only view of what is actually working in Alex's own job search, from persisted evaluations and applications (Development Plan item 17: best-fit roles, recurring gaps, application-to-interview outcomes, strongest sources, wasted effort). It never evaluates, scores, retrieves, writes, calls a provider, measures evaluator accuracy, estimates effort or prescribes learning.

**Approved contract (October 31, 2026).** Recorded in Customer Success PRD v1.15 §19 and Core Platform TDD v1.18 §51.
- **Cohorts (D1, D11):** evaluation figures = one opportunity, latest completed evaluation, dated by `completedAt`; application figures = one opportunity counted as applied by Feature 15's `outcomeOf` (submitted tracked application or `MARK_APPLIED`, once; PLANNED and NOT_SUBMITTED excluded), dated by `appliedAt`, with later interviews/offers kept with the application. Windows 30 / 90 / 180 days, all time (default), custom; Feature 15/16 windows unchanged (a 180-day wrapper).
- **Recommendation at application (D1 correction):** with an exact time (the earliest `MARK_APPLIED`, when it is the earliest application evidence), the latest completed APPLY/REVIEW/SKIP evaluation with `completedAt ≤` it; with only a date, earlier calendar day = credited, later day = "Evaluated after applying", same day = "Same-day order unknown" (unless an earlier-day recommendation exists that every same-day evaluation agrees with); none = "Not evaluated". Calendar days use the budget's time zone (UTC when none). No end-of-day assumption.
- **Outcomes and denominators (D6 correction):** Feature 15 rules; mature = not awaiting response (30 days); interview rate = interviews ÷ mature; offer rate = offers ÷ resolved (offer, closed, or mature without progress) — open SCREENING / INTERVIEWING / FINAL_ROUND are "In process" and excluded; interview → offer = offers ÷ concluded interviews (offer or closed). Recruiter screen, beyond screening and final round read from stages and non-cancelled interview kinds.
- **Funnels:** all applications (applied → any interview stage → recruiter screen → beyond screening → final round → offer; awaiting response, in process, rejected, withdrawn, no response, offer accepted/declined), evaluated opportunities by latest recommendation (evaluated → applied → interview → offer), and applications by recommendation at application.
- **Roles (D2, D3):** title group primary; per group "What the evaluator said" (evaluated, Apply rate, Resume Match good or better, Alex Fit strong or good) beside "What actually happened" (applied, interview rate, offers); orderings "Highest evaluator fit", "Most APPLY recommendations", "Highest interview conversion" rank only groups with n ≥ 5 (others listed "not ranked"); no composite score, no "best fit" claim. Outcomes also by title group, arrangement, seniority, role classification, and by the Resume Match band / Alex Fit credited at application.
- **Genuine Gaps (D4, D5, D9):** structured `requirementAssessments` classified `GENUINE_GAP` (never prose); one occurrence per opportunity per category, then per category + exact case-folded/whitespace-collapsed `requirementText`; otherwise-good = Apply or Review; strength (required / preferred / other) and decision impact; active profile version by default (a chosen version, or "profile not recorded"); Resume Match versions combine only within `resumeMatchCompatibilityGroups` (`cs-resume-match-v2` only; v3/v4 separate). Similar wording is not merged (stated on the page).
- **Sources (D7):** personal outcomes by Feature 15 first-discovery identity (`listingIdentity` of the earliest chain head; names via the newly exported `sourceInfoOf`), automated and user-collected tables apart, a "No source record" row, link to `/sources/insights`; no cost, health, duplicates or presence.
- **Not progressing (D8):** groups (title group, source, arrangement, seniority, customer segment) with ≥ 5 mature applications and 0 interviews — "N mature applications, no interviews yet"; "Recommended but not applied" as neutral information. Never "wasted"; no effort figure.
- **Company type (D12):** outcomes by `customerSegment` and `customerType` (evaluated applications only); no named companies; organizational maturity left out.
- **No accuracy (D14):** disclosure «These tables show what happened after each stored evaluation or recommendation. They do not measure evaluator accuracy.»; no accuracy / precision / recall / calibration / error rates. Recommendations and outcomes span versions as stored, disclosed.

**Implementation.**
- `packages/core/src/personal-analytics.ts` — the pure contract. Reuses `outcomeOf` (input narrowed to `SiOutcomeInput`, no behaviour change), `listingIdentity`, `sourceInfoOf` (new export of the existing source description), `siRate` / sample labels, `parseInsightsWindow`, and Feature 16's `createTitleGrouper`, `arrangementOf`, `seniorityOf`.
- `database/src/personal-analytics-repository.ts` — `PrismaPersonalAnalyticsRepository.facts()`: read-only SELECTs (opportunities with originating record, deferral, MARK_APPLIED and no-longer-listed; evaluations with recommendation, profile, JSON paths and Resume Match prompt version; applications with events and interviews; sources; profiles; active profile).
- `apps/web/src/server/personal-analytics-service.ts` — validates before reading; time zone from budget settings (UTC fallback).
- API `GET /api/my-search` (`window`, `from`, `to`, `titleGroup`, `recommendation`, `arrangement`, `seniority`, `source`, `profile`); 400 `REQUEST_INVALID`.
- UI `/my-search` ("My search" in the main navigation after Applications), seven sections, GET-form filters (with a note on which sections each affects) and a role ordering control; CSS bars with equivalent tables; no colouring.

**Schema / migration:** none. 24 migrations, unchanged.

**Tests.** Unit `personal-analytics.test.ts` (31: the six timing cases, the eight offer-maturity cases, rate denominators, Application + MARK_APPLIED once, PLANNED/NOT_SUBMITTED excluded, screens/final rounds, cohorts and windows, unevaluated applications kept, title-group roles and n ≥ 5 ranking, filters, sources, gap grouping and profile/version cohorts, not-progressing threshold, company type, fit versus outcome without accuracy, sample labels) and `my-search-ui.test.tsx` (3); `navigation.test.tsx` updated. Integration `personal-analytics.test.ts` (7, isolated test database; seeded histories across stages, timing cases, sources, gaps, two profile versions, two Resume Match versions, unevaluated and failed-evaluation applications; table counts unchanged by a read; the active profile is never changed). E2E `my-search.spec.ts` (2, own `my-search` project after `market`; a seeded history applied in March 2025, read with `profile=none`).

**Verified:** October 31, 2026; isolated test database `ai_career_assistant_test` only; no live or provider calls; the normal and acceptance databases were not touched: typecheck and lint; `prisma validate`; `db:verify-migrations` (24, unchanged); unit 74 files / 1,824 tests; integration 42 / 348; E2E 52/52 on the first full run (including the new `my-search` project); web and extension builds; `git diff --check`; `apps/web/next-env.d.ts` restored.

**Known limitations.** Exact application time exists only through `MARK_APPLIED`; tracker applications are date-granular, so same-day evaluations are often "Same-day order unknown". Personal volume is small, so most rates start as insufficient samples. Exact-wording gap groups fragment (similar wording stays separate). Fit and gap figures depend on recorded profile ids and Resume Match telemetry; evaluations without them are shown apart. Calendar days use the budget time zone (UTC when no budget is configured).

**Docs and specs.** Core AI Framework PRD v1.17 (§20 descriptive outcomes; accuracy deferred), Customer Success PRD v1.15 (§19 Personal Job-Search Analytics definitions; Feature 15/16/17 deliverable labels corrected), Core Platform TDD v1.18 (§51 Personal Job-Search Analytics), Customer Success TDD v1.15 (evaluator outputs read; evaluator contracts unchanged); previous versions moved unchanged to Archive. HANDOFFS records the Resume Match v2 → v3/v4 Genuine Gap boundary.

### Feature 16 — Job-Market Analytics (implemented, verified and accepted October 31, 2026; committed)

**What it does.** A read-only view of what the collected Customer Success job market looks like, from what was actually collected (Development Plan item 16: salary, role, location, skills/requirements, seniority and recommendation trends). It never evaluates, retrieves, calls a provider, writes, ranks sources or aggregates companies.

**Approved contract (October 31, 2026).** Recorded in Customer Success PRD v1.14 §19 (after the Source Intelligence definitions, so section numbers are unchanged) and Core Platform TDD v1.17 §51.
- **Observation unit (D1):** one canonical `Opportunity`, every lifecycle status; never `SourceRecord` or listing counts; a multi-source job counts once.
- **Collected by (D1a):** default **Automated only** = the opportunity's originating `SourceRecord` (earliest by `createdAt ASC, id ASC`, the established origin rule) has a source type other than `MANUAL` or `BROWSER_EXTENSION`. A job captured first by hand or with the extension stays out even when automated retrieval lists it later; an automated-origin job stays in when the user captures it later. **All collected** adds the jobs the user captured first, with the note "These are user-selected captures and may introduce selection bias." *(Pre-commit correction, approved October 31, 2026; the first implementation had used "any automated `SourceRecord`".)*
- **Probable duplicates (D2):** both opportunities count; the unresolved pairs are shown once (newer side, the Feature 15 rule); nothing merged.
- **Cohort (D3):** `firstSeenAt` in the window (7/30/90 days, all time, custom UTC); trends by first-seen week (Monday UTC, latest 26). No-longer-listed jobs stay in unless "Exclude no longer listed" (the shared Feature 13 `noLongerListedCondition`). No snapshot mode. Historical note when the window starts before October 18, 2026.
- **Salary (D4):** one currency and one basis (BASE / OTE / Unknown basis) at a time, never converted or combined; selected currency = the filter (a stated three-letter code only), else the most common stated currency (USD first). Per basis: median minimum (stated minimums), median maximum (stated maximums), median midpoint (both bounds; exact = its own midpoint), exact / range / min-only / max-only counts, n and sample label, fixed 10k midpoint bands (CSS bars + table), and median midpoint by title group, seniority, arrangement and job region within that currency and basis. Tiered pay never enters medians: listed tier by tier (opportunity, tier, minimum, maximum, currency), tiered-job count shown; a three-tier job is one job. An annual amount with no stated currency is shown as "Currency not stated — N jobs with annual salary amounts that cannot be included in currency-based market statistics": it counts toward salary coverage only, never enters a median, band or breakdown, cannot be selected, and no currency is assumed. *(Pre-commit correction; the first implementation had computed statistics for it as its own group.)*
- **Titles (D5):** title group = longest whole-phrase Customer Success discovery term (core then adjacent, configured order breaks ties; the discovery matcher's normalization, parity unit-tested), else "Other title"; no fuzzy grouping, AI or stored field. Views: distribution, top exact titles, trend, salary, seniority and recommendations by title group. Evaluator role classification is a separate evaluated-only view.
- **Requirements (D6, option A, stricter versions):** job-side `hardFilters.reconstruction.requirements` of the latest completed evaluation only (never Resume Match, Genuine Gaps, Alex Fit, Opportunity Priority). Headline categories EXPERIENCE, CAPABILITY, TOOL, INDUSTRY, EDUCATION, CERTIFICATION, TECHNICAL_KNOWLEDGE, LANGUAGE (not LOCATION/TRAVEL): share of evaluated jobs with ≥1 per category, REQUIRED vs PREFERRED (other strengths apart), the "Highest stated minimum experience requirement per job" distribution (the highest minimum years stated in any one EXPERIENCE requirement, labelled so it is not read as one total-experience requirement; open-ended counted), top exact phrases (case-folded, counted per job). Version = the `promptVersion` of the evaluation's latest successful `customer-success.jd-reconstruction` attempt; coverage by version; versions combine only within a declared compatibility group (`reconstructionCompatibilityGroups`: only `cs-jd-reconstruction-v3` today; any other version is its own group; no recorded version = "unrecorded"); the largest group is shown with the reason when others are left out. Persisted facts unchanged; no parser, dictionary or AI.
- **Segment (D7):** "Customer segment — evaluated jobs only" (SMB … UNKNOWN) with coverage; industry unsupported.
- **Geography:** job location (location only, unambiguous, else explicit global wording, else Unknown), hiring eligibility (residency regions; `US_REQUIRED` alone = United States), work authorization, sponsorship, relocation, EOR regions and time-zone requirements are separate; Feature 15 buckets; Unknown visible. Arrangement: Remote / Hybrid / On-site / Several options (with combinations) / Unknown.
- **Seniority:** persisted values only, Unknown visible; distribution, trend, salary, recommendations, by title group; seniority labels as written.
- **Recommendations (D9):** latest completed evaluation, as stored; APPLY/REVIEW/SKIP ÷ completed evaluations with a recommendation, coverage beside every figure; separate states Waiting: AI budget, Waiting: usage limit, Evaluation in progress, Evaluation failed, Not yet evaluated, Completed without recommendation (Feature 15's `evaluationStateOf`; dismissed or no-longer-listed jobs never evaluated count as not yet evaluated); trend by first-seen week showing, per week, jobs, evaluated (n), evaluation coverage and the Apply / Review / Skip shares of that week's completed evaluations with a recommendation (percentage and count, with sample labels; raw counts kept) *(pre-commit correction; the first implementation showed counts only)*; the disclosure «Evaluations are jobs you chose to evaluate. These results describe evaluated opportunities, not the entire collected market.»
- **Coverage and samples:** total, salary-, seniority-, location- and arrangement-known, evaluated, requirement data, unresolved possible duplicates; "% of all jobs" and "% of known jobs" labelled separately; n < 5 "Insufficient sample" (lists then alphabetical, never ranked or highlighted), 5–19 "Small sample".

**Implementation.**
- `packages/core/src/market-analytics.ts` — the pure contract (facts → analytics, query parsing, title grouping, salary, geography, requirements with version groups, recommendations, trends, samples). Reuses Feature 15's `parseInsightsWindow`, `siRate`/`sampleLabel`, `geographyBucketOf`/`geographyBuckets` and `evaluationStateOf` (its parameter type narrowed to the fields it reads; no behaviour change).
- `database/src/market-analytics-repository.ts` — `PrismaMarketAnalyticsRepository.facts()`: two read-only SELECTs (opportunities; evaluations with recommendation, three `domainResult` JSON paths and the reconstruction prompt version).
- `apps/web/src/server/market-analytics-service.ts` — validates before reading; terms from `customerSuccessDiscoveryConfiguration`.
- API: `GET /api/market` (`window`, `from`, `to`, `titleGroup`, `seniority`, `arrangement`, `region`, `currency`, `collected`, `excludeRemoved`); 400 `REQUEST_INVALID` for invalid parameters.
- UI: `/market`, a top-level **Market** entry in the main navigation; one page with Overview, Salary, Roles and titles, Location and work arrangement, Seniority, Requirements, Customer segment and Recommendations; GET-form filters; CSS bars with equivalent tables (`Bars` exported from the Source insights components); dashboard drill-in links where the dashboard supports the filter (seniority, single arrangements, recommendation, role family, segment, title text, first-seen dates). No chart library, no good/bad colouring, no new drill-down pages.

**Schema / migration:** none. 24 migrations, unchanged.

**Tests.** Unit `market-analytics.test.ts` (32) and `market-ui.test.tsx` (6); `navigation.test.tsx` updated for Market. Integration `market-analytics.test.ts` (9, isolated test database, seeded and removed; table counts unchanged by a read). E2E `market.spec.ts` (2, own `market` project after `source-insights`; a seeded cohort first seen in March 2025, a window no other spec writes to).

**Verified (October 31, 2026; isolated test database `ai_career_assistant_test` only; no live or provider calls; the normal and acceptance databases were not touched):** after the pre-commit corrections: typecheck and lint; `prisma validate`; `db:verify-migrations` (24, unchanged); unit 72 files / 1,790 tests; integration 41 / 341; E2E 50/50 (including the `market` project) on the first full run; web and extension builds; `git diff --check`; `apps/web/next-env.d.ts` restored. (Before the corrections, one full E2E run had a single timing failure in `budget.spec.ts`, unrelated to this diff — no budget, evaluation or worker code changed — and the unchanged suite then passed 50/50.)

**Pre-commit corrections (October 31, 2026, approved).** (1) "Automated only" now uses the originating source record, not any automated record; (2) amounts without a stated currency are coverage only, never numerical statistics; (3) the weekly recommendation trend adds Apply / Review / Skip rates with n and evaluation coverage; (4) the experience figure is labelled "Highest stated minimum experience requirement per job". Regression tests: integration (automated-origin included; manual-origin and extension-origin later found automatically excluded; automated-origin later captured manually and with the extension included; an unknown-currency amount in coverage only), unit (unknown currency never selected or aggregated even when most common; weekly rates with n, coverage and sample labels at 2, 5 and 20), UI (the "Currency not stated" note, no unknown option in the currency control, the trend columns, the experience heading) and E2E (the seeded week's 25% (1 of 4) coverage and 100% (1 of 1) · Insufficient sample Apply share).

**Known limitations.** Aggregation is in memory over per-opportunity rows (fine at personal scale). Reconstruction versions are identified only from recorded semantic-call telemetry; evaluations without it are "unrecorded" and shown apart. Title groups are the discovery terms, so user-collected titles outside them are "Other title". Dashboard drill-in links approximate the cohort (the dashboard filters by discovery date and lists every collected job; title is text-contains). Trends show the latest 26 weeks; the tier table the first 100 tiers.

**Docs and specs.** Core AI Framework PRD v1.16 (§20 note, status), Customer Success PRD v1.14 (§19 Job-Market Analytics definitions), Core Platform TDD v1.17 (§51 Job-Market Analytics), Customer Success TDD v1.14 (the evaluator outputs Feature 16 reads; evaluator contracts unchanged); previous versions moved unchanged to Archive. HANDOFFS records the JD Reconstruction v3 → v7 compatibility boundary.

### Feature 15 — Source Intelligence (implemented, verified and accepted October 31, 2026; committed)

**What it does.** Measurable, read-only evidence of what each discovery source contributes, so source decisions can be made from what actually happened (CS PRD §19: "Sources should remain because they provide measurable value, not merely because they exist"). Source Intelligence never ranks, judges, disables or changes a source, never evaluates or retrieves, and never calls a provider.

**Approved contract (October 31, 2026).** Recorded in Customer Success PRD v1.13 §19 and Core Platform TDD v1.16 §51.
- **Rows (D4):** one row per configured `RetrievalSource`; adapter grouping is a secondary view. A separate **User-collected** section holds Browser extension (per captured site) and Manual entry, never ranked against automated sources.
- **Listing:** a `SourceRecord` chain head. A configured source that saw an already-stored listing writes no record (re-observation is keyed by adapter and listing ID), so its Feature 13 ledger row counts as its listing. No record is manufactured.
- **Duplicates, kept apart:** already known on arrival (the source's duplicate rate), repost on the same source, possible duplicate (the newer side of an unresolved probable pair, so a pair counts once), exclusive (as of today), and the platform duplicate rate ((listings − distinct opportunities) ÷ listings). A record whose normalization failed is "not processed" (operational).
- **Attribution (D2):** first discovery — the earliest record by (createdAt, id), the repository's existing origin rule — gets new-opportunity credit, evaluation cost and outcomes; every other source has presence ("also listed", "also listed before the outcome"), never summed. Credit never moves (later employer ATS, canonical link, removal).
- **Useful (D1):** latest completed evaluation APPLY or REVIEW; useful rate = useful ÷ evaluated; Apply rate shown separately. Neutral states, never negative: Waiting: AI budget (incl. legacy BUDGET_UNAVAILABLE), Waiting: usage limit, Evaluation in progress, Evaluation failed, User dismissed/archived, No longer listed before evaluation (the dashboard's Feature 13 rule, now one shared SQL condition), Not yet evaluated (incl. a cancelled deferral). Coverage = evaluated ÷ cohort.
- **Outcomes (D5):** application = submitted tracked application, or a lifecycle MARK_APPLIED without one (both count once); interview = reached SCREENING or later, or a non-cancelled interview record (recruiter screens included), once per opportunity; offer = OFFER stage or offer outcome. Under 30 days without progress = awaiting response, excluded from interview/offer rates (D6).
- **Cost (D3):** completed-evaluation spend in the report currency (budget currency, else pricing currency, as `/budget`) ÷ useful, re-evaluations included; failed and in-progress spend and unknown-cost attempts shown apart, unknown never zero; "No useful jobs yet" when useful = 0; pricing basis shown. All-time platform spend reconciles with the persisted attempts and the budget usage breakdown (integration test).
- **Reliability:** Feature 12 health and staleness, plus successful ÷ (successful + source failures) runs in the window (neutral runs apart), latest listings scanned, median role-family yield, and "waiting for details" ledger placeholders. No runs / no successful retrieval is a note, never low yield.
- **Geography (D7):** United States, Canada, United Kingdom, Europe (excluding UK), Latin America, APAC, Global / Anywhere, Other, Unknown; from residency regions → work-authorization regions → unambiguous location → explicit global-remote wording; multi-valued (shares may exceed 100%, stated in the UI), Unknown in the denominator, EMEA / North America / Americas → Other.
- **ATS (D8):** per-source ATS mix and direct ATS coverage, from direct ATS provenance, `atsPlatform`, or the one shared known-site table (moved from extension capture to `packages/core/src/known-sites.ts`; extension capture now uses it).
- **Samples and verdicts (D6):** every rate shows its counts; n < 5 "Insufficient sample" (shown, never used to order or highlight), 5–19 "Small sample". No verdicts, no colouring, no auto-disable. Ordering applies within one section only.
- **Windows:** 7 / 30 / 90 days, all time, custom (UTC dates). Listing figures by listing date; evaluation, cost and outcome figures by discovery cohort; runs by run date.
- **Evaluator boundary (clarification 6):** recommendations are read as stored; no evaluator-version filtering or second recommendation layer. HANDOFFS records that rates may span evaluator versions.

**Implementation.**
- `packages/core/src/source-intelligence.ts` — the pure contract (facts → metrics, attribution, states, outcomes, cost, geography, ATS, windows, samples, sorting, drill-down, path segments).
- `packages/core/src/known-sites.ts` — the shared host → site/category table (`apps/web/src/server/extension-capture.ts` now imports it; behaviour unchanged).
- `database/src/source-intelligence-repository.ts` — `PrismaSourceIntelligenceRepository.facts()`, read-only SELECTs; `database/src/opportunity-list-repository.ts` exports `noLongerListedCondition` (the dashboard query is unchanged).
- `apps/web/src/server/source-intelligence-service.ts` — overview, drill-down and per-card value strips; `budget-service.ts` gains `costBasis()` (the same currency rule as the report, shared).
- API: `GET /api/sources/insights` (`window`, `from`, `to`, `groupBy`, `archived`, `sort`) and `GET /api/sources/[id]/insights` (a configured source's id, `adapter--<key>`, `extension--<site>` or `manual`); 400 for an invalid window, 404 for an unknown source.
- UI: `/sources/insights` (summary tiles, controls, automated and user-collected tables, notes), `/sources/[id]/insights` (funnel, listings and duplicates, evaluation states, cost, reliability, geography, ATS, weekly trend, every listing's provenance per opportunity), a "Manage sources / Source insights" section nav, and a last-30-days line on each `/sources` card linking to the drill-down. No new top-level navigation; no chart library (CSS bars with table equivalents).
- **Test-DB guard (D10):** `tests/support/test-database-guard.ts`, called by `vitest.integration.config.ts` and `playwright.config.ts` (not for `--list`): refuses any target database whose name does not end in `_test` (so `ai_career_assistant` and `ai_career_assistant_acceptance` are refused) before a test starts. Reads only the URL; no runtime change.

**Pre-commit corrections (October 31, 2026, approved).**
- **Deterministic first record.** Two production paths chose an opportunity's first source record by `createdAt` alone, so records sharing a timestamp could resolve either way: the attempt-attribution fallback for an evaluation with no source-version binding (`database/src/evaluation-task-repository.ts`, `SemanticOperationAttempt.sourceRecordId` and `jobSource`) and the opportunity detail's source records (`findRecord`, whose first record is the page's "Found via"). Both now order by `createdAt ASC, id ASC`, the same rule as `originatingVersion` and Feature 15 attribution. Persistence only; no evaluator behaviour change. The flaky `foundation-provenance` snapshot read the same way and now orders by `(createdAt, id)`. New `tests/integration/origin-ordering.test.ts` (2) failed before the fix (3 of 3 runs on the detail order, 1 of 3 on the attempt fallback) and passes after.
- **No double counting.** New unit (2) and integration (1) tests prove that a configured source's own record plus its ledger rows (current, Feature 13 baseline and earlier tracking scopes), a changed version (same-source re-observation), a cross-source MATCH and a later employer ATS each count once; ledger presence only fills a source that wrote no record.
- **Sample ordering.** New unit tests (2 + 1 display): insufficient samples (n < 5) never move by value under any rate-based order and keep their value and label; small samples (5–19) rank normally and show "Small sample"; no good/bad styling.
- **E2E locator.** The Source insights spec's alert check now matches the page's own message (Next.js's route announcer is also an alert).
- **Docs.** Remaining Feature 14 "awaiting review/acceptance" status labels in README, PRODUCT_STATUS and DEVELOPMENT_PLAN now say accepted (earlier wording kept); HANDOFFS status lines gained appended update notes, nothing rewritten.

**Schema / migration:** none. 24 migrations, unchanged.

**Tests.** Unit `source-intelligence.test.ts` (29: every definition and attribution scenario, deferral neutrality, outcomes, cost, geography, ATS, reliability, windows, samples, sorting), `source-insights-ui.test.tsx` (7: service, API 400/404, value strips, views without good/bad colouring), `test-database-guard.test.ts` (4). Integration `source-intelligence.test.ts` (9, isolated test database, seeded synthetic histories: high-volume/high-duplicate board, low-volume/high-quality ATS, a second configured ATS seen only in the ledger, unreliable source, budget- and usage-limit-deferred source with a cancelled deferral, multi-source opportunity with an offer, applications without interviews (recent and rejected), a lifecycle-only application, failed evaluation and an other-currency reevaluation, a listing removed after application, a probable pair, a failed normalization, manual and extension captures, spend reconciliation with `periodUsageBreakdown`, a 7-day window, the drill-down). E2E `source-insights.spec.ts` (2, own project after `extension`): value strip → drill-down with credit vs presence, the comparison page with the user-collected section, window and grouping switches, an invalid custom window and an unknown source.

**Verified (October 31, 2026; isolated test database `ai_career_assistant_test` only; no live or provider calls; the normal and acceptance databases were not touched):** typecheck and lint; `prisma validate`; `db:verify-migrations` (24, unchanged); unit 70 files / 1,752 tests; integration 40 / 332; E2E 48/48 (including the new `source-insights` project); re-run after the pre-commit corrections; web and extension builds; `git diff --check`. The guard was shown refusing `ai_career_assistant` (integration) and `ai_career_assistant_acceptance` (E2E) without connecting.

**Known limitations.** Data is aggregated in memory from per-opportunity rows (fine at personal scale; revisit beyond tens of thousands of opportunities). Ledger presence starts with Feature 13 (October 19, 2026) and automated runs with Feature 11 (October 18, 2026); earlier periods have manual entries only (the page says so). The weekly trend shows at most 26 weeks; the drill-down lists the latest 200 opportunities. Co-discovery is a 1-hour tag only; credit stays with the earliest record. The `foundation-provenance` flake seen once is fixed (deterministic ordering, above).

**Docs and specs.** Core AI Framework PRD v1.15, Customer Success PRD v1.13 (§19 definitions), Core Platform TDD v1.16 (§51 Source Intelligence, §39 status), Customer Success TDD v1.13; previous versions moved unchanged to Archive. The accepted October 27, 2026 currency rule (a recognized currency symbol is its currency; a stated code or name wins) is now written into Core Platform TDD §51 and Core AI Framework PRD §13, with the superseded text quoted, as a documentation-only correction (the rule was implemented and committed then).

### Feature 14B live acceptance, round 2 (verified in the real environment October 29, 2026; committed; live acceptance passed)

**Why and how.** The live round of `76ce118` showed that several earlier fixes had passed against synthetic pages while failing in Alex's real browser. Round 2 therefore used only real evidence:
- **Connection:** Alex's WSL repository was connected through Remote Control. A read-only helper session on his computer verified the repository (branch, `76ce118`, clean tree), `~/safebreach-case.json`, the running app on `localhost:3000` and its database (`ai_career_assistant_acceptance`, 24 migrations). It also verified Playwright's own Chromium. His Chrome tabs and installed extension stayed out of reach, so the final check was his own captures.
- **Stored captures:** 30 real extension captures were exported read-only (plain JSON, checksum-verified) and replayed exactly through the production normalizer.
- **Live pages:** the pages were rendered in Playwright's Chromium on his machine (Greenhouse, SmartRecruiters, Workday) and in this session (Remote OK, We Work Remotely). The page reader then ran inside each rendered page, first the committed version and then the candidate.
- **Final check:** Alex captured each case through the installed extension into the live acceptance app.

**Root causes (from the real evidence) and fixes.**
- **SafeBreach location.**
  - *Cause:* the real posting writes `📍 Locations (Remote): United States (East Coast)`. The leading 📍 icon kept the label from being read at all, so the page header's bare "United States" won. The earlier synthetic test had no icon.
  - *Fix:* leading icons are ignored when items and labels are read (posting text and page context). When page context and the posting state one place at different precision ("United States" and "United States (East Coast)", one contained in the other, same countries), the more specific statement is kept; places that are not one inside the other still conflict.
  - No East Coast residency and no Eastern time zone are inferred.
- **SmartRecruiters Application URL.**
  - *Cause:* the live "I'm interested" buttons are ordinary links to `jobs.smartrecruiters.com/oneclick-ui/company/<Company>/publication/<id>`, and pressing one leads there. Each page also carries **hidden** "Apply with Smartr" duplicates (`www.smartr.me/oneclick-ui/…`), which the reader counted as a second destination, giving up as ambiguous.
  - *Fix:* controls the page does not show (computed `display:none`/`visibility:hidden`, `[hidden]`, `aria-hidden`) are not counted.
  - A round-1 guess (a `?oga=true` application entry from the public API) was disproved by the live click and is not used.
- **Remote OK Application URL.**
  - *Cause:* after its scripts run, the page lists about 50 other jobs, each with a hidden expanded copy carrying its own `<h1>` and Apply buttons, so the job's own Apply was ambiguous.
  - *Fix:* an Apply control inside another job's container doesn't count. Such a container sits below the job's own heading and holds another heading of the job title's level, or a heading linking to another posting. Hidden controls don't count either.
  - Also: apply links in the job's own side panel, or in a sticky header that repeats the job, count; buttons that carry their address in an attribute are read.
- **We Work Remotely default capture.**
  - *Cause:* WWR pages have no `<main>` or job `<article>`, so the reader took the title's nearest ancestor with 500+ characters, which is the header. The posting body sits in a sibling section. The stored default captures were 950 (Dropbox) and 544 (NLBM) characters; highlighting only helped because the selection replaced the description.
  - *Fix:* the job container now widens past the header, to the nearest ancestor that at least doubles the job's content, stopping before any container that holds another job. Navigation, side panels, site header/footer and other-job lists are not counted.
  - Also:
    - a "Related Jobs" heading carrying a nested link is recognized as other jobs;
    - a metadata sidebar stays out of the description but in page context;
    - a parenthetical note between a label and its value ("Country" / "(This job is GeoLocked)") is skipped;
    - page-context Region/Country values are read for residency, with their own `pageContext:explicit-residency-statement` marker;
    - a posting's own range wins over a page's coarser salary bucket that contains it ("$75,000 - $99,999" vs "$85,000 – $95,000 / annualized").
- **New Law Business Model company.**
  - *Cause:* WWR titles its pages "Remote <title> at <Company>". The leading "Remote" kept every page-title form from matching (the earlier fix assumed "<title> | <Company> | <platform>").
  - *Fix:* an arrangement word written before the job title is ignored for the page-title company.
- **ServiceTitan default capture (PST/MST hours).**
  - *Cause:* the default capture uses the page's JSON-LD description, which has **no line breaks**, so "Able to work PST/MST hours" sat inside an over-long run-on sentence. The highlighted capture keeps the page's 137 lines and reads it. The parser needed no change.
  - *Fix:* the page's own line-structured rendering is preferred when it is about as long as the structured copy with many more lines. The comparison ignores whitespace (adjacent elements often join without a space) and also probes with the first sentence, because the page renders "Ready to be a Titan?" and "As a CSM…" as separate elements while JSON-LD runs them together.
  - The rendered description leaves out the employer's closing boilerplate and privacy-notice link (accepted by Alex as non-blocking).
- **ServiceTitan zone tiers.**
  - *Cause:* the real text, "Zone 1: $76,900 USD - $115,300 USD Applicable for: CA, CT, DC, MD, MA, NJ, NY, VA, and WA Zone 2: …", was rejected.
  - *Fix:* a statement naming several numbered zones, tiers or bands, each with exactly one range (label first or amount first), is split into labelled tiers. Also:
    - a tier label on one line with its amounts on the next ("US Zone 2" / "$142,700—$193,100 USD") is one tier;
    - tier lines without a pay word are read;
    - "locations" is never read as a tier label;
    - every stored tier statement must parse, so a tier can no longer be stored without its amounts.
  - Ranges without tier labels, and base with OTE, stay ambiguous.

**Real installed-extension acceptance (Alex, October 29, 2026; candidate patch `cb900138…090e` applied, extension rebuilt and reloaded, app on `ai_career_assistant_acceptance`):**

| Case | Result |
|---|---|
| SafeBreach | "United States (East Coast)", Remote, Time zone Unknown |
| SmartRecruiters QAD and ServiceNow | Application URL is the `oneclick-ui/…/publication/<id>` page |
| Remote OK INNERGY and Renaissance | Application URL is `https://remoteok.com/l/<id>` |
| WWR Dropbox (default capture) | Company, U.S. location, "US Zone 2 · US Zone 3" tiers, Remote, Full-time |
| WWR NLBM (default capture) | Company, 85,000–95,000 USD, Worldwide eligibility, Pacific Time overlap |
| ServiceTitan (default capture) | "Zone 1 · Zone 2" tiers, "Able to work PST/MST hours", requisition JR115657 |

All PASS.

**Known edge cases, explicitly non-blocking.**
- Lever Bluesight's employment type.
- Jobs for Humanity's monthly pay (pay-period rule).
- Remote OK Renaissance's short description: the live page itself shows only that text.
- NLBM's "Region: Anywhere" is not shown as a location (eligibility, arrangement and time zone already carry it).

**Evaluator boundary.** No evaluator prompt, schema, model, routing, stage or policy change; no new fields; no migration.

**Tests.**
- New `tests/unit/live-round-2-real-captures.test.ts` (10 tests):
  - the real stored captures replayed exactly: SafeBreach; ServiceTitan default and highlighted; WWR Dropbox and NLBM default and highlighted; SmartRecruiters and Remote OK without a stored link;
  - the real rendered pages through the reader, envelope, capture mapping and normalizer: Remote OK with other jobs' hidden copies, the WWR Dropbox and NLBM pages.
- New fixtures:
  - `tests/fixtures/real-captures/feature-14b-live-round-2.json`: the stored captures, pairing IDs removed;
  - `tests/fixtures/pages/remote-ok-innergy.html`, `we-work-remotely-dropbox.html`, `we-work-remotely-nlbm.html`: rendered DOM with scripts, styles and tracking tokens removed.
- Updated: the reader's fact list (`pageRegionStatements`).

**Verified (October 29, 2026):**
- typecheck and lint;
- unit: 67 files / 1,707 tests;
- integration: 38 files / 320 tests;
- E2E: 46/46. The first run had one 30-second timeout on a cold dev server, in the application-tracker test, code this diff does not touch; the full rerun passed;
- extension and web builds; `git diff --check`;
- adapter regression snapshot: all 36 fixture listings unchanged (facts and content hashes).

**Databases.** Automated tests used only the isolated `ai_career_assistant_test` database. The acceptance work used only `ai_career_assistant_acceptance`: read-only SELECTs by the helper session, plus Alex's own captures through the app. The normal application database (`ai_career_assistant`, named in the local `.env`) was not touched.


### Feature 14B live acceptance batch (implemented and verified October 29, 2026; committed; awaiting the targeted live verification)

**Why.** The latest full live round (handoff "Feature 14B Live Acceptance Batch-Fix", October 29, 2026). Protected passing sources: Working Nomads, Ashby, Workable, Wellfound, Greenhouse Healthie, Lever Mongoose and Wing, Workday Thomson Reuters, LinkedIn Serrala's tiers, Welcome to the Jungle AlphaSense's "$80-95k". Adzuna stays out of scope.

**Root causes and fixes, by shared subsystem.**
- **Extension page context (the job's own sidebar).** Page context left out every side panel, so sidebars that state a job's metadata (We Work Remotely's "About the job", Himalayas' salary, job type and level) never reached Core: Dropbox's location, SMB Team's salary and job type, and the corroboration a page-title company needs. Page context now adds the job's own metadata panel: a side panel (aside, complementary or sidebar) outside the job's content, or excluded inside it, that names at least two job-metadata labels and lists no other jobs. A stray single label ("Location: Asideville") or a "Similar jobs" panel is still never read. *(`apps/extension/src/extract.ts`)*
- **Extension apply links.** Three gaps left a visible apply button without an Application URL:
  - other postings' rows on the same page (Remote OK) made the job's own Apply ambiguous; an Apply inside another job's card (a container below the job's own heading with a heading linking to another posting) no longer counts;
  - the job's own side panel and a sticky header that repeats the job's title were excluded (SmartRecruiters' "I'm interested" in the sidebar, sticky header and bottom); they count now, while navigation, other-job widgets and a site header that does not repeat the job still never do;
  - buttons that carry their destination in an attribute (`data-href`, `data-url`, `data-apply-url`, `formaction`, an enclosing form's action) are read, and apply phrases may end "… for this job/position/role".
  - Two different destinations in the job's own content stay ambiguous.
- **LinkedIn.** A LinkedIn page that also has JSON-LD was read only through the structured path, so the top card's posted age ("12 hours ago") and the employer's Apply link were never read (Serrala). The top card's facts now fill what the structured data leaves out. The posted age is also read from the signed-in view's description row ("Canada · 12 hours ago · …"), and the Apply link from the top card's apply anchor (directly off LinkedIn, or LinkedIn's external-apply redirect, whose `url` parameter names the destination). Easy Apply stays on LinkedIn and gives no URL.
- **Shared normalizer: pay.**
  - **Tiers inside one statement** (ServiceTitan: "Zone 1 (CA, CT, DC, MD, MA, NJ, NY, VA, WA): $76,900 - $115,300 USD Zone 2 (All other U.S. locations): $71,800 - $107,800 USD") parsed as one ambiguous statement, so Salary was Unknown. A statement naming several numbered zones, tiers or bands, each with exactly one range (label first or amount first), is now split into labelled tiers; the same applies to a source's own salary text. Ranges without tier labels, and base with OTE, stay ambiguous.
  - **Tier label and amount on separate lines** (Dropbox: "US Zone 2" / "$142,700—$193,100 USD"): a line holding only a tier label followed by a line holding only amounts is that tier's statement. "This role is not available in Zone 1" is no tier.
  - **Salary with a trailing variable-pay clause** (SMB Team: "The salary for this role is $85,000 - $90,000 with bonus potential up to $10,000.") was ambiguous; the salary is now the range before the clause, and the clause ("bonus potential up to $10,000") is the `bonus` fact. A tail that goes on to state other earnings ("plus commission; OTE $140,000") keeps the statement ambiguous. *(`compensation.ts`, `job-text-facts.ts`)*
- **Shared normalizer: arrangement and employment.**
  - A label may be separated from its value by a spaced dash ("WORK STYLE – WFH or come to the office. The choice is yours!"); only a labelled value's first sentence is read.
  - Labelled arrangement values now include working from home (Remote) and working from or coming to the office (On-site), as labelled values only, never prose.
  - When the posting offers several arrangements and the source's own single value is one of them (Himalayas' structured remote with SMB Team's "WFH or come to the office"), the options are kept ("Remote / On-site"); a different single value from the source still wins.
  - A page header item joining categories with dashes or slashes ("Full Time - Remote - In-person meeting attendance required", Lever Bluesight) states the one part that is an employment type; two employment types state none.
- **Shared normalizer: location and company.**
  - A labelled location that refines the source's place now also refines a place written with its arrangement ("Remote, United States") and a remote role's stated hiring places; the arrangement and the residency stated by the source are kept (SafeBreach: "United States (East Coast)", Remote, no time zone).
  - Page items "Only US" and "Anywhere in the US" name the U.S.; "Anywhere in the World" names no place.
  - The page-title company is also read from "<title> | <Company> | <platform>" and "<Company> - <title>" titles (New Law Business Model), still only when the name appears in the posting and names no place, arrangement or team.
- **Capture mapping (Welcome to the Jungle and Otta).** The structured `validThrough` moved from 2026-11-10 to 2026-11-12 between two captures: a rolling listing expiry, not an application deadline. It is no longer the closing date there (a deadline the posting itself states still is). `datePosted` (2025-10-03T02:01:34Z) is kept as stated: it is the page's own deterministic field and was identical in both captures. *(`apps/web/src/server/extension-capture.ts`)*

**Investigated, intentionally unchanged.**
- **Workday ServiceTitan location** "US CA Remote, United States of America": the posting's structured `jobLocation` (its primary location, as Workday publishes it); the header's "US Remote" is the page's own summary. Both are the source's statements; nothing was changed.
- **Jobs for Humanity "$1,500–$3,000 per month":** non-annual pay is never stored as salary amounts (there is no pay-period field) and is never annualized silently. Salary stays Unknown; the text stays in the data. A product decision: keep, or add a pay-period fact.
- **ServiceTitan time zone** ("Able to work PST/MST hours", read in the earlier capture as `rawText:explicit-time-zone-statement`): the statement is read on every synthetic layout tried; the live regression needs the stored evidence (`--evidence`) to find what in the current capture conflicts with it.

**Evaluator boundary.** No evaluator prompt, schema, model, routing, stage or policy change. No new fields; `compensationTiers` and `bonus` stay withheld from the evaluator subject. No migration.

**Tests.**
- New `tests/unit/live-acceptance-batch.test.ts` (28): each defect through the real extension reader, envelope, capture mapping and normalizer (SafeBreach both location paths; Bluesight's header; SmartRecruiters' sidebar, sticky-header, bottom and attribute buttons; Remote OK rows; Dropbox and New Law Business Model sidebars; SMB Team and Jobs for Humanity; ServiceTitan's one-statement zones, amount-first zones and source salary text; LinkedIn public and signed-in views; Welcome to the Jungle's dates), with negatives: a site header that does not repeat the job, two destinations in the job's content, other jobs' panels and stray labels, two employment types, prose about home or the office, ranges without tier labels, base with OTE, Easy Apply, a hyphenated word that is not a label separator, a worldwide region.
- New `tests/integration/live-acceptance-batch.test.ts` (3, test database): SMB Team's salary, job type, both work styles and bonus persisted (bonus withheld from the evaluator); Dropbox's tiers and region persisted and displayed; Remote OK's apply link stored on the source version and the opportunity; no rolling closing date from Welcome to the Jungle.
- New E2E case in `tests/e2e/extension.spec.ts`: in Chromium, the job's own sidebar in page context, the job's own Apply among other jobs' rows, and LinkedIn's top card beside its structured data.
- Updated deliberately: the October 26 Welcome to the Jungle case (its `validThrough` is no closing date); the reader's fact list (`broaderRemoteLocation`).

**Cross-source regression.** All 13 adapter fixtures (36 listings) were snapshotted against the previous baseline: no listing changed (facts and content hashes identical). The October 26 and 27 cross-source suites pass unchanged apart from the Welcome to the Jungle closing date. Extension captures whose page context gains the job's sidebar may record one changed version on recapture (accepted rule D6).

**Verified (October 29, 2026; isolated test database only; no live third-party requests; no provider calls):** typecheck and lint; unit 66 files / 1,697 tests; integration 38 files / 320 tests (the browser-driver file with the local Chromium path); E2E 46/46; extension and web builds; `git diff --check`. No persistence change, so no migration verification was needed.

**Targeted live verification (Alex).** `pnpm extension:build`, reload the extension, then recapture one posting each: Greenhouse SafeBreach (location "United States (East Coast)", Remote, no time zone); Lever Bluesight (Full-time, Remote); SmartRecruiters QAD and ServiceNow (Application URL); Remote OK INNERGY and Renaissance (Application URL); We Work Remotely Dropbox (location, the Zone 2 and Zone 3 tiers) and New Law Business Model (company); Himalayas SMB Team (salary 85,000–90,000 USD, bonus apart, Full-time, Remote / On-site); Workday ServiceTitan (the two zone tiers); LinkedIn Serrala (posted date, Application URL); Welcome to the Jungle AlphaSense (no closing date). Any case that still fails: run `pnpm acceptance:check-source-version --database <acceptance database> --opportunity <URL> --evidence ~/case.json` and send the file; for a missing Application URL, also send the apply button's markup (the console snippet in the extension README).


### Feature 14B currency symbol correction (implemented and verified October 27, 2026; committed; awaiting the targeted live verification)

**Product rule (Alex, October 27, 2026):** a recognized currency symbol is read directly as its currency ("$" US dollars, "€" euros, "£" pounds sterling, "₹" rupees, "¥" yen), with no geography or other context; a currency code or name the posting states ("$100,000 CAD", "Canadian dollars") takes precedence over the symbol. The user's selected currency in manual entry also takes precedence over a symbol, never over a different stated code. Two different stated currencies, or two different symbols with none stated, stay Unknown.

**Root cause.** The shared `parseCompensation` (`packages/normalization/src/compensation.ts`) read a bare "$" as USD only when the location, eligibility regions, work-authorization regions or statement named only U.S. geography (`unitedStatesEvidence`), treated "¥" as ambiguous, and let a symbol conflict with a stated code ("€60,000 USD" was Unknown). This is one shared rule for every path (extension, retrieval, manual entry, regional tiers), so the correction is in that one function; the geography plumbing into it was removed from both normalizers.

**Changes.**
- `compensation.ts`: symbols ($, €, £, ₹, ¥) map directly to their currencies; prefixed dollar signs (US$, CA$, C$, A$, AU$, NZ$, S$, MX$, R$) and currency names ("Canadian dollars", "euros", "pounds sterling", …) are explicit like codes; explicit codes and names, then the user's selection, take precedence over symbols. The provenance marker `compensationText:bare-dollar-as-usd` is kept for "$".
- `retrieved.ts`, `index.ts`: no geography passed to compensation parsing; tiers read each tier's currency from its own statement.
- Previously affected cases now: Healthie, Mongoose, PeopleGrove, AlphaSense and New Law Business Model ("$85,000–$95,000 / annualized") are USD.

**Tests updated deliberately:** the bare-"$" cases in `opportunity-normalization`, `job-text-fallback`, `shared-normalization-convergence`, `cross-source-live-findings`, `opportunity-residency` and `cross-source-final-batch` (unit), and `job-text-fallback`, `manual-opportunity-persistence` and `normalized-opportunity-filters` (integration; its "conflicting currency" fixture is now two symbols with no code, "€60,000 – $70,000", because a stated code now takes precedence over a symbol).

**Regression:** of the 36 adapter-fixture listings, only New Law Business Model changed (currency → USD); all content hashes unchanged.

**Verified (October 27, 2026; isolated test database only; no live or provider calls):** typecheck and lint; unit 65 files / 1,669 tests; integration 37 / 317; E2E 45/45; extension and web builds; `git diff --check`.

**Specs:** Core Platform TDD v1.15 §51 and Core AI Framework PRD v1.14 still state the superseded geography rule for a bare "$"; they were not edited (versioned specs). The rule above supersedes them until the next spec version.

### Feature 14B final cross-source batch (implemented and verified October 27, 2026; committed; awaiting the targeted live verification)

**Why.** Alex's final human retest captured, on every supported source, the original posting from the earlier round and one more current Customer Success posting. Ashby, Workable and Wellfound passed (regression protection). Greenhouse, Lever, SmartRecruiters, Remote OK, We Work Remotely, Himalayas, Working Nomads, Workday, LinkedIn and Welcome to the Jungle each still had defects. Adzuna stays out of scope (no direct Adzuna-hosted capture).

**Root causes, by shared subsystem.**
- **Page-context reading (shared normalizer).** Page metadata items were read only as `Label: value`, while pages write a label and its value in one item without a colon ("Job type Full-Time", "Region United States", "Apply before Nov 18, 2026"); items carried layout separators ("Full Time /", "Remote /"); and a salary split across two elements ("$80" / "-95k") was read as "-95k" alone. Now colon-less labels are read in page metadata only, each value checked as its kind (a place, a date, an employment type, an amount); separators are dropped; split ranges are rejoined; and a range's dangling end is never a salary. (Lever, We Work Remotely, Welcome to the Jungle.)
- **Labelled location vs arrangement (shared normalizer).** "Location: Remote" was read as a place and then conflicted with the real place ("USA"), losing both. An arrangement-only location now states the arrangement, not a place; "Remote - US" keeps the place and states Remote; "Remote with up to 25% Regional Travel" states Remote; a label's qualifier counts ("Locations (Remote): …"); and a labelled location that states the source's place more precisely ("United States (East Coast)" for "United States") replaces it. (Working Nomads, SmartRecruiters, Greenhouse.)
- **Explicit statements the reader did not know.** Added, all explicit and bounded: "Fully remote work" / "100% Remote Work at …"; "remote work is the primary experience" (Virtual First); a labelled "Work Persona: Flexible or Remote" (Flexible counts as hybrid only as a labelled arrangement value); "Full-Time, Non-Exempt (W2) 40 Hours / Week"; a time zone written as an abbreviation ("EST or CST", "9–5 ET") or a required "minimum … overlap with Pacific Time", also on a labelled line; closing dates labelled "End Date" or stated as "This job posting will close 12/31/2026"; a labelled posted age ("posted on: Posted 11 Days Ago", page metadata only).
- **Compensation agreement (shared normalizer).** A rounded restatement of the same range ("$88K–$118K" and "$88,089.75—$118,440") conflicted; now they agree and the precise one is kept. A bonus stated on its own ("Bonus potential up to $10,000") conflicted with the range; variable pay that a statement leads with is now never the salary and is kept as the existing `bonus` fact. Hourly pay with its stated annual equivalent ("$40.87–$45.67 ($85,000 – $95,000 / annualized)") now gives the annual range; hourly pay alone still does not.
- **Currency.** *(Corrected the same day, see "Currency symbol correction" above: a recognized currency symbol is read directly as its currency ("$" US dollars, "€" euros, "£" pounds sterling, "₹" rupees, "¥" yen), with no geography or other context; a currency code or name the posting states ("$100,000 CAD", "Canadian dollars") takes precedence over the symbol. The batch as first committed counted a U.S. work-authorization requirement as U.S. context for a bare "$", which is superseded.)*
- **Regional tiers (new normalized fact, display).** Labelled ranges for several zones or places were kept only as salary text, so Salary showed Unknown. They are now a normalized fact, `Opportunity.compensationTiers` ([{ label, minimum, maximum, currency }], additive migration `20261027090000_compensation_tiers`), shown as the Salary side by side and never merged ("Zone 1: 92,600–139,000 USD · Zone 2: 86,600–129,800 USD"; "United States: 63,000–75,000 USD · Canada: 88,000–110,000 CAD"). `salaryMin`/`salaryMax` stay null. (We Work Remotely, Workday, LinkedIn.)
- **Extension collection.**
  - **Job title:** pages whose only h1 is the careers site's name ("ServiceTitan Careers", "Careers at Thomson Reuters") took that as the job title. The reader now finds the posting's own heading: a Workday-style posting header, the first h1 that is not a site title, else the first such h2. Pages titled with an h2 (Lever, Workday) now also get page context.
  - **Page context** keeps the job's own header and footer inside its container (side panels, navigation and other-job cards stay out).
  - **Microdata pay:** `baseSalary` microdata is read like JSON-LD (SmartRecruiters).
  - **Apply link:** "I’m interested" with a typographic apostrophe matched no apply phrase, and the same application page linked twice with different parameters was ambiguous; both are fixed. Apply links in the job's own header or footer count.
  - **Shortened structured description:** when a page's job data holds a teaser (Remote OK: it ends "Apply now and work remotely at …"), the page's own rendering of the same description is read instead.
  - **Default worldwide place:** a remote-hiring place of "Anywhere" no longer replaces a location the page states ("Location: IL"), so no worldwide eligibility is derived from it.
- **Persistence and display.** The opportunity's requisition ID (read from the page or text) was stored but shown nowhere; the source panel showed the source's own empty requisition field as Unknown. The opportunity's facts now show "Requisition ID"; a source panel shows a requisition only when that source states one.
- **"Use my selected text instead" (Remote OK).** Traced end to end: the selected text becomes a new source version, the opportunity's description, the evaluator's subject and the reconstruction stage's input. What misled was the popup: it showed the earlier version's evaluation as current. It now says when the evaluation shown is of an earlier version and offers a new evaluation.

**Intentionally unchanged.** Company Unknown on Unite Us (the posting does not state the employer plainly); Workable employment type and time zone (preferences only, nothing required); Wellfound work authorization ("Requirement not stated", sponsorship not available); LinkedIn and Welcome to the Jungle application URLs (no concrete destination on those pages); Welcome to the Jungle's posting date (the page's own JSON-LD `datePosted`, mapped as stated; see the live verification plan).

**Evaluator boundary.** No evaluator prompt, schema, model, routing, stage or policy change. The new `compensationTiers` and the newly read `bonus` are withheld from the evaluator subject (`fieldsWithheldFromEvaluator`). Existing visible fields (title, location, salary text, description, application URL, requisition ID) carry corrected values where this batch fixes them.

**Tests.**
- New `tests/unit/cross-source-final-batch.test.ts` (36): one case per failure class through the real extension reader, envelope, capture mapping and normalizer (the New Law Business Model case uses the posting's real text from the committed We Work Remotely fixture), with negative cases: no time zone from geography, no seniority from years, no work authorization from sponsorship, colon-less labels only in page metadata, Flexible only as a labelled value, variable pay never the salary, genuinely different ranges still conflict, hourly pay alone is not a salary, two different application pages stay ambiguous, a full structured description is kept.
- New `tests/integration/cross-source-final-batch.test.ts` (3, test database): tiers and bonus persisted, listed, displayed, re-projected by a changed version and withheld from the evaluator; a page-labelled requisition ID persisted; "Use my selected text instead" through to the evaluator's reconstruction input, with the popup's earlier-version note.
- New E2E case in `tests/e2e/dashboard.spec.ts`: regional tiers as the Salary on the opportunity and the dashboard, and the Requisition ID row.
- Updated deliberately: the We Work Remotely annualized fixture listing; tiers shown in the Salary; Healthie in USD; the reader's fact list (`bonus`); the source panel's requisition row; the adapter time-zone contract (the one fixture listing that states one).

**Cross-source regression.** All 13 adapter fixtures (36 listings) were snapshotted before and after. All 36 content hashes are unchanged. Two listings changed, both intended: New Law Business Model (We Work Remotely; the annualized range, Remote, the Pacific overlap) and one Workday listing (its three labelled pay ranges now structured as tiers). The v7 cross-source suite passes unchanged except the deliberate tier display.

**Replay helper.** `pnpm acceptance:check-source-version` now also compares tiers and bonus, and `--evidence <file>` saves a stored version's exact evidence to a local file, so any case that still fails can be replayed offline.

**Verified (October 27, 2026; isolated test database only; no live third-party requests; no provider calls):**
- typecheck and lint;
- unit tests: 65 files, 1,677 tests;
- integration: 37 files, 317 tests;
- the full E2E chain: 45/45 (5.2 min), including the extension project;
- `pnpm extension:build` and the production web build;
- `db:verify-migrations` (24 migrations; the new one applied to `ai_career_assistant_test` only);
- `git diff --check`.

**Targeted live verification (Codex/local), the smallest set covering every changed path:**
1. Without recapturing, replay the stored originals with `pnpm acceptance:check-source-version` (normalization-only fixes): Healthie (USD), Mongoose (USD), PeopleGrove (location, Remote, USD), Samsara and SMB Team (salary, bonus), AlphaSense (80,000–95,000 USD), New Law Business Model (company, full-time, Remote, 85,000–95,000), Serrala, Dropbox and ServiceTitan (tiers as Salary), Hostaway (EST or CST).
2. Recapture after reloading the rebuilt extension (collection fixes): one Lever posting (Bluesight or Wing: Full-time and Remote), one SmartRecruiters posting (QAD: salary, Remote, application URL), one Remote OK posting (INNERGY: the full description; Renaissance: location IL, no worldwide eligibility), one Workday posting (Thomson Reuters: title, requisition ID, posted and end dates), one We Work Remotely posting (Dropbox or New Law Business Model, through the page sidebar), one Greenhouse posting (SafeBreach: United States (East Coast), Remote).
3. Welcome to the Jungle (AlphaSense): note the date the page itself shows as posted. If it differs from 2025-10-03, send it with `--evidence`; the JSON-LD `datePosted` is kept until then.

### Feature 14B original-JD retest helper (implemented and verified October 26, 2026; acceptance tooling only)

**Why.** The live retest reuses the existing acceptance database `ai_career_assistant_acceptance`. Its opportunities were normalized by pre-v7 code, and re-saving an unchanged page reports "Already saved. Nothing changed." without re-normalizing. So the app keeps showing the old values, even where v7 fixed them.

**What it is.** `pnpm acceptance:check-source-version --database <name> --opportunity <opportunity page URL or ID>` (or `--source-record <id>`).
- It reads one stored source version: by default the opportunity's most recently observed one, which is the version a "Nothing changed" recapture just observed.
- It rebuilds the exact `RawOpportunity` ingestion persisted, runs it through the production normalizer for that kind of version (retrieved/extension, or manual) and prints each fact twice, as stored now and as the current code reads the same evidence, with v7's provenance markers. Differences are marked `*`.
- **Read-only.** The session is opened with `default_transaction_read_only`, and the reads run in one `READ ONLY` transaction, so PostgreSQL itself refuses any write. It never updates the opportunity, source versions, provenance, history or evaluations.
- **Isolated.** No evaluator stage, provider call or network access. It refuses to read anything unless `--database` names the database `DATABASE_URL` points to.

**Files.**
- `database/src/source-version-reader.ts`: read-only client, `READ ONLY` transaction, the stored-version read.
- `apps/web/src/server/source-version-check.ts`: rebuild, production normalizer, comparison and report.
- `apps/web/src/server/source-version-check-cli.ts`, plus the `package.json` script.

**Tests.**
- `tests/unit/source-version-check.test.ts` (7): the rebuilt input equals the original; the result equals the production normalizer's output for retrieved and manual versions; a relative posted age is dated from the observation; argument and database-name guards.
- `tests/integration/source-version-check.test.ts` (6, test database):
  - an extension capture and an automated Greenhouse version reproduce the stored facts and the exact stored provenance rows;
  - a record made to look pre-v7 shows the OTE salary differences, after an UNCHANGED recapture;
  - a whole-database fingerprint (every row of every table) is unchanged, with no network call and no evaluation;
  - PostgreSQL refuses an update and a delete;
  - the actual `pnpm` command prints the report, changes nothing, and refuses a mismatched database name.

**Runbook:** `apps/extension/README.md`, cross-source live retest.

### Feature 14B cross-source correction (implemented and verified October 26, 2026; committed `6536ef8` as checkpoint v7, October 26, 2026; awaiting the cross-source live retest)

**Why.** Alex's live acceptance sweep captured a current Customer Success posting on every supported source. Greenhouse was the only source with no remaining defect. The failures were not independent source bugs: each belonged to collection, transport or shared normalization, so they were fixed at the lowest shared layer and verified across every source.

**Root causes and what changed.**
- **Remote-hiring geography was not a carried fact** (Wellfound Oakland, Workable and SmartRecruiters location Unknown, Himalayas "United States only", Remote OK state lists, LinkedIn U.S.+Canada, Ashby location).
  - **New `sourceFacts.remoteLocations`:** where a source says a remote role may be done from. It becomes the location ("Remote (United States)") and the eligible geography.
  - **Mapped by:** the extension's JobPosting reading (`applicantLocationRequirements`), Wellfound's accepted remote locations, Himalayas' location restrictions.
  - **An office is never a remote role's location.** A remote posting's `jobLocation` with a street or city is an office.
  - **An ordinary job or office location never sets eligibility.** A posting's own statement that the remote role is based somewhere ("This is a U.S.-based, full-time remote role.") does, as the weakest reading; any explicit eligibility statement replaces it. *(Review correction, October 26, 2026: an earlier draft read a remote role's plain country location as eligibility.)*
  - **Eligible places listed one per line** under a lead-in ("must reside in one of the following states:") are read as one statement, and the **continental U.S.** is U.S. geography.
- **One pay range read as conflicting evidence** (Lever: "$65,000 - $75,000 a year" with "OTE = $75,000" and "$65,000 base + $10,000 variable" left salary Unknown).
  - Statements now agree when exactly one range is stated and the others only detail that same pay.
  - **Regional tiers** (LinkedIn U.S./Canada, Workday Zone 1/2, WWR Zone 2/3) have no single range, even when a source field states one tier. The tiers are the salary text, each with its own place or zone ("U.S.: USD 63,000 - 75,000 / Canada: CAD 88,000 - 110,000"), and their currency is kept only when shared. Ranges that do not each name their place are not tiers: they stay Unknown.
- **Facts a page states outside the job text** (LinkedIn employment type, seniority and posted age; WTTJ salary, office days and seniority; Working Nomads employment type, seniority, posting age and apply link; Workday requisition ID; Wellfound sponsorship; SmartRecruiters' fields).
  - Page context is now sent with **every** non-LinkedIn description, **one visible item per line**, so a label and value in separate elements ("Visa Sponsorship" / "Not Available") are read together.
  - Core reads whole metadata items: a salary, an employment type, a work arrangement or office cadence, a seniority label, a country or region list, a posting age.
  - The extension also reads **JobPosting microdata**, uses **structured data without a description** (taking the description from the main content), and on LinkedIn reads the **criteria list and posted age** the automated adapter already read.
- **New shared readings:** a **time-zone preference** kept as a preference; a **source-stated posting age** dated at day precision and marked approximate; a **stated seniority label** kept in the new `seniorityLabel` (so "Mid-Senior level" and "Junior and Mid level" are shown as stated while the normalized level stays Unknown); a **labelled requisition ID** ("JR115971"); a posting's **fuller labelled location** when it contains the source's location and says more; **several stated work arrangements kept as options**, in order, in the new `workArrangements` ("Office or Remote" → On-site / Remote, "Remote or Hybrid" → Remote / Hybrid, "Hybrid or On-site" → Hybrid / On-site; `remoteStatus` is then null, and only ambiguous or conflicting statements stay Unknown); **one to four office days a week** as hybrid; "**Full-time/Permanent**" as full-time.
- **The content boundary** (We Work Remotely: the saved description was the Related Jobs list, which also produced a false worldwide eligibility).
  - The job's container is `<main>`, else the `<article>` holding the job's title, else the title's nearest substantial container, never another job's card.
  - Lists of other jobs ("Related Jobs", "Similar roles", "More jobs at …") are excluded from both the description and the page context.
- **Application-link precedence** (Ashby and Workable stored the posting page although a distinct `/application` or `/apply/` page exists).
  - An explicit application link, including this posting's own `…/apply` or `…/application` page, now outranks structured `directApply`, which still marks the posting page when nothing else is stated.

**Product decisions implemented.**
- **Department removed from the product:** no detail row, no dashboard filter or chip, no manual-entry input. An old `department=` URL is ignored. The column and its normalization stay for compatibility, and the evaluator never used it.
- **Salary only:** the opportunity shows "Salary": the normalized range with its basis and currency, or Unknown when there is none (regional tiers included). There is no separate Compensation row, and the raw compensation text is never shown in place of a salary. The dashboard card and the evaluation panel use the same formatter. `salaryText`, the bounds, currency, `compensationBasis` and provenance are unchanged internally.

**Migration** `20261026090000_cross_source_normalization` (additive: `seniorityLabel`, and `workArrangements` defaulting to an empty list; rollback comments in the file). Applied only to `ai_career_assistant_test`. No backfill. 23 migrations in total.

**Source-specific work (collection only).** Wellfound and Himalayas map their own remote-geography fields; the LinkedIn page reader reads LinkedIn's criteria list and posted age. Each maps into the shared generic contract: no source has its own semantics.

**Tests.**
- **New `tests/unit/cross-source-live-findings.test.ts` (28):** every confirmed finding reproduced through the real extractor, envelope, capture mapping and normalizer, per source, plus negative cases (no work authorization from geography, no residency from sponsorship, no time zone from geography, no USD without U.S. evidence, no tier applied globally, no prose relative dates, no listing page as an application URL, loose office or experience wording ignored; several stated arrangements kept in order while "and" and conflicting statements stay Unknown; an ordinary job or office location never sets eligibility; unlabelled ranges are not tiers; the Salary field shows only a normalized amount).
- **`tests/integration/shared-normalization-convergence.test.ts`** gains the LinkedIn case persisted on the test database, with per-field provenance; `seniorityLabel`, `workArrangements` and the approximate posting date withheld from the evaluator subject; and the dashboard's arrangement filter finding the job under each offered option, not as Unknown.
- **Updated deliberately:** the Department filter, chip, form and E2E expectations; the "Salary range"/"Compensation" rows; the preference time-zone case; the remote-posting JSON-LD location; page context beside a main-content description; the shared reader's fact list; the requisition-ID invariant.

**Cross-source regression.** All 13 adapter fixtures (36 listings) were snapshotted before and after and diffed field by field. **All 36 content hashes are unchanged.** Changed listings: Himalayas 6, LinkedIn 2, SmartRecruiters 1, Workday 1, Wellfound 1; Greenhouse, Lever, Ashby, Remote OK, We Work Remotely, Working Nomads, Workable and Adzuna unchanged. Every change is one of the intended corrections (remote geography as location and eligibility, stated seniority labels, the Workday tiers' labelled salary text and shared currency, the Himalayas labelled requisition ID). No fixture states several work arrangements. *(Review corrections, October 26, 2026: several stated arrangements kept as options in `workArrangements`; Salary shows Unknown without a normalized range; tiers keep their labels and must each name their place; a remote role's plain country location no longer sets eligibility, which reverted the earlier Ashby and Workable residency changes; an approximate posting date is withheld from the evaluator subject.)*

**Verified (October 26, 2026; isolated test database only; no live third-party requests; no provider calls):**
- typecheck and lint;
- unit tests: 63 files, 1,634 tests;
- integration: 35 files, 308 tests;
- the full E2E chain: 44/44 (3.7 min), including the extension project;
- `pnpm extension:build` and the production web build;
- `db:verify-migrations` (23 migrations);
- `git diff --check`.

**Not changed:** deduplication logic; the evaluator's stages, prompts, models, routing and schemas (the new facts are withheld); the OTE/BASE rules; the bare-"$" currency rule; work authorization versus residency; application-URL basis markers; the listing-page rule; version projection and source history; the LinkedIn logged-out operating rule.

**Open:** Adzuna had no clean live capture in the sweep, so it is neither passed nor failed; it stays in automated regression and is live-retested only if a genuine Adzuna-hosted capture is available.

### Feature 14B v5 — compensation-basis OTE precedence (implemented and verified October 25, 2026; awaiting review; not committed)

**Why.** The review of the Codex Milestone 4 handoff (next entry) found that a single range stated as OTE that also mentions "base" normalized with a `null` basis, which the evaluator would evaluate as ordinary salary. Alex approved the conservative Core fix the same day.

**What changed (shared Core normalization only; no adapter, evaluator, dedup, schema or currency change).**
- **OTE precedence** (`resolveBasis`, `packages/normalization/src/compensation.ts`):
  - OTE or on-target wording in a compensation statement gives `OTE`, whatever else it says about base.
  - `BASE` applies only to base wording without OTE wording.
  - Otherwise the basis is `null`.
  - Separate figures in one statement keep the existing ambiguity, with the amounts Unknown.
- **The description's statement of the same range** (`onTargetStatementFor`, `packages/normalization/src/job-text-facts.ts`, used by the retrieved and manual normalizers):
  - **Applies when:** the amounts come from structured source fields, a source salary field or a user-stated salary text, and their basis is not already `OTE`.
  - **Effect:** the basis becomes `OTE` only when a compensation statement in the posting's own description states that same range as OTE.
  - **Matching rules:** both bounds equal, including an open end; no other currency; the statement names no other figure.
  - **What never counts:** page context; OTE wording about any other figure, or with no figure.
  - **Provenance:** recorded under that statement (`rawText:explicit-compensation-statement`). The bounds and currency keep their own provenance.
- **Unchanged:** `compensationBasis` is still `BASE` | `OTE` | `null`, the bounds and the original currency are preserved, nothing is converted, and the basis stays in `fieldsWithheldFromEvaluator`.

**Tests.**
- **`tests/unit/shared-normalization-convergence.test.ts`** (50, up from 31):
  - the both-cue cases;
  - BASE, plain and separate-figure controls;
  - structured or source-text bounds with the description's same-range OTE;
  - five negative cases: no figure, a different range, another currency, several figures, one end different;
  - a source BASE overridden by the same-range OTE, and a source basis kept;
  - page-only OTE ignored;
  - manual entry.

  The earlier case "$100,000 - $120,000 base, OTE" changed deliberately from `null` to `OTE`. The existing ambiguity tests (`opportunity-normalization.test.ts`) are unchanged.
- **`tests/integration/shared-normalization-convergence.test.ts`** (5, up from 4): structured bounds plus description OTE persisted with per-field provenance, and the basis still withheld from the evaluator subject.
- **Mutation checks:**
  - the old both-cue rule fails 5 tests;
  - a disabled description lookup fails 4;
  - a lookup without the same-range bound fails the negative test.

**Verified (October 25, 2026; isolated test database only; no live third-party requests; no provider calls):**
- typecheck and lint;
- unit tests: 62 files, 1,606 tests;
- integration: 35 files, 307 tests;
- the full E2E chain: 44/44 (5.3 min);
- `pnpm extension:build` and the production web build;
- `db:verify-migrations` (22 migrations);
- `git diff --check`.

The browser-driver integration tests and E2E use the installed Chromium through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, as before. `apps/web/next-env.d.ts` was restored after E2E.

**Documentation.**
- **Core Platform TDD v1.15:** §51 compensation rule and the version-history line, edited in place.
- **Current-state docs:** PRODUCT_STATUS, AI_Architecture_README, EVALUATOR_STATUS, CHANGELOG, HANDOFFS (the open decision is recorded as resolved), and this file.

### Milestone 4 compensation-basis correction — Codex evaluator handoff reviewed (October 25, 2026; documentation only)

Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility.

**The evaluator side (Codex).** It is on the `codex/evaluator-live-diagnostic` worktree over `267124f`, not committed and not merged.
- **Basis:** the evaluator consumes the shared-Core `compensationBasis` (exactly `BASE` | `OTE` | `null`).
  - `BASE` and an ordinary `null` range are evaluated normally under the unchanged bands.
  - `OTE` keeps its bounds and is Unknown for salary eligibility unless separate base-salary evidence exists.
- **Currency:** FX stays evaluator-only, and the evaluator reads Core's currency without repeating the bare-"$" rule.
- **Residency:** residency selects the policy branch. Work authorization and `UserEligibility` are never used.
- **Identifiers:** `cs-hard-filters-v3` and `cs-salary-policy-v3-ecb-2026-10-14`. Prompts, models and routing are unchanged.
- **Compatibility boundary:** it reads the basis through a temporary compatibility path until integration supplies the native Core field.

**Review against the Feature 14B Core contract on this branch.**
- **Compatible:**
  - the basis values;
  - preserved OTE bounds and original currency;
  - evaluator-only FX;
  - residency unchanged and separate from work authorization;
  - work-authorization fields and `UserEligibility` withheld from evaluator input;
  - no evaluator bare-"$" logic needed.
- **One edge case (resolved by v5, below):** a single range stated as OTE that also mentions "base" ("$120,000 - $150,000 OTE (base + commission)") normalized with its bounds and a `null` basis. Under the evaluator's rule it would have been treated as ordinary salary. Before integration it had no effect, because `compensationBasis` and the salary bounds stay withheld from the evaluator on this branch.

**Changed.** Documentation only:
- `PRODUCT_STATUS.md`, `AI_Architecture_README.md`, `DEVELOPMENT_PLAN.md`, `EVALUATOR_STATUS.md` and this file;
- `HANDOFFS.md`, with a new final-integration contract record;
- the root `README.md`.

Historical Milestone 4 sections are preserved as written. No evaluator code was copied, and the Codex work was neither applied nor merged.

### Feature 14B correction — shared-normalization convergence (implemented and verified October 25, 2026; awaiting review; not committed)

**Why.** Alex's final acceptance capture of the Greenhouse Healthie posting (`job-boards.greenhouse.io/healthie/jobs/4425790009`) showed facts the posting states but the opportunity left Unknown: the salary range (an OTE range), department ("You'll join Healthie's Customer Success team"), work authorization ("U.S. work authorization is required.", shown only as an unrelated "Residency requirement: Unknown"), and the application URL, although the page holds Greenhouse's application form. The audit (approved October 25, 2026) grouped the causes:
- **evaluator policy in Core:** OTE removed the bounds;
- **missing concepts:** work authorization and compensation basis;
- **an implicit, untagged posting-page fallback in the adapters, and no application-link collection in the extension;**
- **collection gaps:** JSON-LD `validThrough`/`directApply`, and Greenhouse `application_deadline`;
- **a labelled-only department parser.**

**What changed (domain-neutral; extension, automated retrieval and manual entry alike).**
- **Compensation.** A stated range keeps its numbers whatever its basis.
  - **New `compensationBasis`:** BASE / OTE, or Unknown when the statement says neither. *(v5, October 25, 2026: OTE wording takes precedence over a mention of base; previously a statement naming both was Unknown.)*
  - **Currency:** amounts stay in their original currency, and no conversion is stored. A bare "$" keeps the existing deterministic geography rule, with the derived-currency marker.
  - **Not changed:** non-annual pay (deliberately not broadened).
  - The evaluator alone decides whether an OTE range qualifies as base salary. Core preserves OTE numeric facts. Milestone 4 treats OTE-only compensation as Unknown for confirmed base-salary eligibility (evaluator side complete on the Codex branch; see above).
- **Work authorization**, a new normalized fact for every job and country, never residency. Statements read:
  - a required right to work or permit, or citizenship, and the countries named;
  - visa sponsorship available or not;
  - relocation support available or not;
  - employer-of-record countries.

  Page context counts only through labels. Residency and location eligibility stay separate internally.
- **Personalized relevance (not normalization).**
  - **`workAuthorizationRelevance`** (`packages/core/src/eligibility.ts`) compares the facts with the user's own work eligibility.
  - **The user's eligibility** is stored in **`UserEligibility`** (authorized and citizenship countries), set on the profile page under "Work eligibility". It is not part of the evaluation profile and is never evaluator input.
  - **What Alex sees** (U.S.):
    - a U.S. requirement → `SATISFIED`, with no warning;
    - a non-U.S. requirement, citizenship restriction or unavailable sponsorship → "Check work eligibility";
    - sponsorship, relocation or EOR outside the U.S. → a neutral note;
    - a non-U.S. job that states nothing → stays Unknown, flagged "worth checking".
- **Department.** After the source's own field and a labelled line, an explicit team statement counts ("join Healthie's Customer Success team"). The name must be Title Case, at most four words, and not the employer or a description. It is never read from the title or responsibilities, and two names give Unknown.
- **Application URL**, with its basis in provenance on every path:
  - **Basis markers:** `source.applyUrl` (a distinct apply destination), `source.postingPageIsApplication` (an ATS or marketplace posting page that hosts the application: Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Wellfound), `page:apply-link`, `page:application-form` (the extension finds an application form on the page), and `structured.directApply`.
  - **The posting URL equals the application URL only on such evidence.** A job board's own listing page (WWR, Working Nomads, Remote OK and Himalayas without an apply field, jobs.workable.com, Adzuna) is not an application destination. It is stored as no application URL, with its content hash unchanged, so nothing reads as changed.
  - **A changed originating listing updates the link** only when the current link came from that listing, or there is none. A user-entered or higher-precedence attached link is kept.
  - **The extension** also takes one explicit "Apply" link, outside navigation and related-job widgets. Two destinations are ambiguous, and an in-page anchor is ignored.
- **Closing date.** JSON-LD `validThrough` (extension) and Greenhouse `application_deadline` reach `source.closingDate`, above the text.
- **UI.**
  - **Detail page:**
    - "Salary range" shows the basis, e.g. "105,000–155,000 (currency unknown) (OTE)".
    - The new "Work authorization" row shows the fact as stored, e.g. "United States authorization required · Sponsorship: Unknown".
    - "Residency requirement" becomes "Location eligibility", shown only when stated.
    - "Application URL" carries a basis note.
  - **Eligibility note and dashboard badge:** "Check work eligibility", from the relevance layer only.
- **Unchanged:** deduplication logic, the evaluator's prompts, models and routing, the version projection and its provenance superseding, evaluation binding, and lifecycle.
  - New normalized fields are added to `fieldsWithheldFromEvaluator` (`compensationBasis`, the work-authorization fields), so evaluator input is unchanged.
  - The withheld salary bounds already reach the evaluator as null on this branch.

**Migration** `20261025090000_work_authorization_and_compensation_basis` (additive; rollback comments in the file).
- **`Opportunity` columns:** `compensationBasis`, `workAuthorizationRequirement`, `workAuthorizationRegions`, `visaSponsorship`, `relocationSupport` and `employerOfRecordRegions`.
- **Table `UserEligibility`:** `id`, `authorizedRegions`, `citizenshipRegions` and `updatedAt`.
- No backfill.
- Applied only to `ai_career_assistant_test`. While developing it, it was rolled back and re-applied there once to add `citizenshipRegions`. Not applied to the normal database or to either acceptance database.

**One-time changes accepted.**
- An extension capture whose page newly shows an application form, apply link or structured closing date records one CHANGED version on recapture.
- Adapter hashes do not change.

**Tests.**
- **New `tests/unit/shared-normalization-convergence.test.ts` (31):**
  - the synthetic Healthie posting through the real Greenhouse adapter and through the extension extractor, envelope and capture mapping converges on identical normalized facts, with path-specific provenance (the only difference is the API's publish date);
  - the compensation table (USD, EUR, GBP, CAD, bare "$", BASE, OTE, both);
  - manual entry;
  - department rules;
  - work-authorization rules 1–4;
  - application URL bases and the listing-page drop;
  - extension apply link, form and `directApply`/`validThrough`, and the LinkedIn exclusion.
- **New `tests/unit/work-eligibility-ui.test.tsx` (4).**
- **New `tests/integration/shared-normalization-convergence.test.ts` (4):** persistence, provenance, detail formatting, evaluator withholding, a one-time CHANGED on a newly shown form, a higher-precedence link kept, and the `UserEligibility` API.
- **Updated deliberately:** the OTE expectations (`opportunity-normalization`, `job-text-fallback`, `normalized-opportunity-filters`, where the OTE fixture now sorts and filters by its 120,000 USD), the WWR application URL (now null, with an unchanged hash), and the withheld-field loops (empty lists).

**Verified (October 25, 2026; isolated test database only; no live third-party requests; no provider calls):**
- typecheck and lint;
- unit tests: 61 files, 1,554 tests;
- integration: 34 files, 293 tests;
- the full E2E chain: 44/44 (5.2 min), including the extension project;
- `pnpm extension:build` and the production web build;
- `db:verify-migrations` (22 migrations);
- `git diff --check`.

**Adapter regression check (October 25, 2026, before human acceptance).** Every implemented adapter was followed from its fixture through collection, the shared normalizer and persistence on the test database: Greenhouse, Lever, Ashby, SmartRecruiters, Remote OK, We Work Remotely, Himalayas, Working Nomads, Workday, Workable and Wellfound, plus synthetic fixtures for the unverified LinkedIn and Adzuna adapters. Welcome to the Jungle is registered but never produces listings.
- **New tests:**
  - `tests/support/adapter-fixture-harness.ts`;
  - `tests/unit/adapter-normalization-contract.test.ts` (33 tests): the invariants on every listing, the per-adapter facts, and a content-hash snapshot taken at `e6bacc6` (`tests/fixtures/sources/content-hashes-e6bacc6.json`, 36 listings, none changed);
  - `tests/integration/adapter-normalization-persistence.test.ts` (13 tests).
- **Defects found and fixed:**
  - Remote OK's `apply_url` and Himalayas' `applicationLink` repeat the board's own listing page in every fixture item. They were labelled distinct apply URLs; a new `boardApplyBasis` now treats them as listing pages, so no application URL is stored, with the hash unchanged.
  - LinkedIn's "$90,000.00/yr - $110,000.00/yr" lost its numbers. The parser now accepts cents on comma-grouped amounts and an annual "/yr" unit between the two ends of a range; non-annual pay is unchanged.
- ~~**Left as the approved rule:** SmartRecruiters' "Sunnyvale, CA, United States" keeps a bare "$" Unknown, because "CA" is ambiguous; the bounds and BASE basis are kept.~~ Corrected the same day at Alex's direction: a shared geography fix, `readLocationGeography` in `packages/core/src/geography.ts`.
  - An explicit country in a full location settles an ambiguous region abbreviation. The SmartRecruiters listing is now 185,000–205,000 USD, BASE, with the derived-currency marker.
  - The same reading places jobs for the work-eligibility relevance layer.
  - Unit tests: 62 files, 1,592 tests. Integration: 35 files, 306 tests. Content hashes unchanged.
- **Verified:** typecheck and lint; unit tests, 62 files and 1,587 tests; integration, 35 files and 306 tests; the web build; `db:verify-migrations`; `git diff --check`. Deduplication and evaluator code were untouched in this round.

**Specifications.** Core Platform TDD v1.15 §51 (compensation, work authorization, application URL, department, provenance markers, revision entry) and Core AI Framework PRD v1.14 (revision entry, application URL, compensation, work authorization) were edited in place, both still uncommitted. The Customer Success PRD ¶241 ("OTE-only → Salary: Unknown") is the evaluator's display policy and stays as written.

### Feature 14B correction — current-version projection of changed listings (implemented and verified October 23, 2026; awaiting review; not committed)

**Why.** The Feature 14 closeout found stale current facts. A listing that moved from Hybrid to Remote was a correct CHANGED re-observation, with a new linked source record, but the opportunity still showed Hybrid. That was the documented contract, not a defect in the change detection:
- Task 7 anticipated re-normalizing changed listings, but left it incomplete ("blocked on dedup and re-observation").
- Feature 11A (Core TDD v1.8) then deliberately left the opportunity and its canonical description unchanged on a CHANGED re-observation.
- Versions 1.8–1.14 of the Core TDD said so.

Alex approved correcting the contract (October 23, 2026). Core TDD v1.15 §51 now records the history above; it does not claim §51 always said this.

**The corrected contract.** A CHANGED observation of the opportunity's originating listing keeps the old and new SourceRecords, re-runs shared normalization on the new version, re-projects the current normalized facts, and keeps all historical source and evaluation evidence.
- **The originating listing owns the projection.** It is the opportunity's first source record and its same source and source listing ID (`originatingVersion`); its newest version is current.
  - An attached cross-site copy never writes facts; it keeps only the existing application-link precedence.
  - There is no newest-website-wins rule and no cross-source merging.
  - A manual opportunity is never re-projected by retrieval.
- **What is projected:** title, company, location, work arrangement, employment type, seniority, department, time-zone and residency requirements, salary text, bounds and currency, posting and closing dates, and the job description. The usual precedence applies.
  - Identity and link fields (listing IDs, canonical URL, application link) keep their existing rules.
  - A fact the newest version no longer supports becomes Unknown.
  - The current description is the current version's; the old one is not preserved on the opportunity, only in its source record.
- **User-corrected values stay.** A value with `userCorrected:*` provenance is kept, unless the capture is itself the user's edit of that field (the authorized user action; today, an extension capture in which the user edited it).
- **Provenance is never deleted or rewritten.** New nullable column `FieldProvenance.supersededAt`.
  - Replaced rows are marked superseded, and new rows linked to the new SourceRecord are added.
  - Current views (`fieldProvenance` in the detail, the evaluator subject) show only non-superseded rows. The opportunity page lists the earlier rows under "Earlier provenance" with the date each was replaced.
  - Evidence references by `provenanceId` stay valid.
  - For V1 → V2 → V3, all three are stored and V3 alone is current.
- **Evaluations are bound to a source version.** New nullable column `Evaluation.sourceRecordId` (foreign key, `ON DELETE SET NULL`). It is set when the user's request creates the evaluation, to the current originating version; for a manual opportunity, to its source record.
  - `loadSubject` gains an optional `evaluationId` and returns `subjectSourceRecordId`. The subject is the bound version as it stood: the provenance current at binding, and, if the listing changed later, the bound record's description and title, company, location, salary text and posting date.
  - The Customer Success stages read the bound record through the new `evaluatedSource(context)` helper instead of `rawSources[0]`. That is the only domain change: no stage, prompt, model, routing, schema or recommendation logic changed.
  - Semantic-operation attempts record the bound `sourceRecordId` (and its source as `jobSource`).
  - An evaluation made before this binding existed is treated as having evaluated the first source record.
- **No automatic work.** A change never evaluates, queues or reserves budget. There is no new lifecycle status and no MATERIAL_CHANGE_REVIEW. Reevaluation stays the user's request and adds an evaluation.
- **UI wording.**
  - **Version hint** (opportunity page, beside the profile-version hint), when the latest completed evaluation used an earlier version: "The latest evaluation was made using the listing version first seen on <date>. The listing has changed since then (latest version seen on <date>). Reevaluate to evaluate the current version; the earlier evaluation is kept."
  - **The "Listing changed since first seen" notice** now says that the opportunity shows the latest version of the listing it was found from, every earlier version is kept, an earlier evaluation may describe an earlier version, and reevaluating is up to you.
  - **The dashboard "Listing changed" badge** has a tooltip saying the same.
- **Unchanged:** the deduplication engine and decisions (a CHANGED observation still bypasses the capture path); content hashing and page-context change detection; `fieldsWithheldFromEvaluator`; the Codex branch.

**Migration** `20261023090000_superseded_provenance_and_evaluated_source`. It is additive and nullable, and it carries rollback comments.
- Applied only to the isolated test database, `ai_career_assistant_test`, with the target checked first.
- **Not** applied to the normal application database or to `ai_career_assistant_acceptance`. Applying it anywhere else needs Alex's separate authorization.
- No backfill: existing opportunities keep their facts until their originating listing is next observed as changed.
- `prisma migrate dev --create-only` wanted to reset the test database over an old migration checksum, so the SQL was written by hand, checked with `db:verify-migrations` and applied with `db:migrate`. Nothing was reset.

**Tests.**
- **New `tests/integration/listing-version-projection.test.ts` (12 tests)** covers the 26 approved cases:
  - Hybrid → Remote;
  - location and salary changes, and closing-date changes;
  - a fact that disappears becoming Unknown;
  - a user-corrected title kept, then replaced by the user's own edit;
  - structured evidence outranking text;
  - no current contradiction across V1 → V2 → V3;
  - history queryable, and superseded rows excluded from current views;
  - an attached copy and a manual opportunity not re-projected;
  - `sourceFacts` department and seniority changes;
  - identical and reformatted re-observations unchanged;
  - no duplicate opportunity, and no deduplication decision.

  It also runs a real queued evaluation through the production processor with the deterministic fixture transport. That covers no automatic evaluation, the earlier evaluation and its evidence kept, a reevaluation bound to V2 (not `rawSources[0]`) with V2's text reaching JD reconstruction, the historical evaluation still bound to V1, the new evaluation's provenance current, the hint appearing and clearing, and an unchanged re-observation creating no work.
- **Updated to the new contract:**
  - `job-text-fallback` "3 and 4" (page context Hybrid → Remote is CHANGED and the opportunity is now Remote / Chicago, with the V1 provenance superseded);
  - "1, 2 and 6" (noise changes nothing);
  - `retrieval-ingestion` "adds a linked observation…" (the opportunity now shows the latest description and salary).
- **New unit tests:** `evaluated-source.test.ts`, the hint, the notice and badge wording in `retrieval-ui.test.tsx`.

**Verified (October 23, 2026; isolated test database only; no live third-party requests; no provider calls, only the fixture transport):**
- typecheck and lint;
- unit tests: 59 files, 1,519 tests;
- integration: 33 files, 288 tests;
- the full E2E chain: 44/44 (5.8 min), including the extension project;
- `pnpm extension:build` and the production web build;
- `db:verify-migrations` (21 migrations, schema matches);
- `git diff --check`, with `apps/web/next-env.d.ts` untouched.

**Specifications.** Core Platform TDD v1.15 §51 and Core AI Framework PRD v1.14, both still uncommitted from the job-text correction, were edited in place: the re-observation contract, current-version projection, the evaluated source version and the history of the rule. The archived versions are unchanged. The Customer Success PRD and TDD are not versioned: their reevaluation-eligibility wording (CS TDD §39) already covers a changed description.

### Feature 14B correction — shared Core job-text fallback (implemented and verified October 23, 2026; awaiting review; not committed)

**Why.** Alex's local acceptance of Feature 14B (`e6bacc6`) passed for the local fixture, LinkedIn (Incognito, logged out), Welcome to the Jungle and revocation. It showed a shared normalization gap on three real pages, though each had collected and preserved the full job description:
- **A Greenhouse page** read through main content: company, location and date Unknown.
- **A Lever page** read through structured data: the salary and the closing date were stated only in the description and stayed Unknown.
- **An employer careers page** read through structured data: the salary and "Hybrid" stayed Unknown.

The cause is not in the extension or any adapter. Both shared normalizers, manual (`createManualOpportunityNormalizer`) and retrieved (`createRetrievedOpportunityNormalizer`), read already-supported facts only from structured or dedicated fields, and never from the posting text. The Task 7 implementation notes and the code comments had narrowed the broader Core requirement: Core Platform TDD §51 says these facts are populated "when deterministic source evidence supports them". Alex approved restoring it in shared Core on October 23, 2026, with a safer currency rule.

**Built (shared Core only; no adapter or extension semantic parsing).**
- **`packages/normalization/src/job-text-facts.ts`.** `readJobTextFacts({ text, title, pageTitle })` is one pure, deterministic reader of the posting's own text.
  - **What it reads:** labelled lines ("Location: …", "Remote type: …", "Employment type: …", "Posted on: …", "Closing date: …", "Department: …", "Seniority: …", "Company: …"), plus a few bounded job-specific constructions:
    - "This position is based in New York.";
    - "This role is located in Chicago.";
    - "Work from our Boston office.";
    - "This is a full-time, NYC-Hybrid position." (Full-time, Hybrid and NYC);
    - "This position is hybrid.";
    - "This is a fully remote role.";
    - "As a <title> at <Company>, …";
    - a compensation statement with a clear cue;
    - an explicit time-zone requirement.
  - **What it rejects:** two candidates that disagree make the fact Unknown. It never uses word frequency, company prose ("offices around the world"), vague wording ("flexible", "remote-friendly", "full-time employees"), relative, ambiguous or unlabelled dates, or platform names (Greenhouse, Lever, LinkedIn, …) as the employer.
- **Both normalizers** call it the same way, only for facts still missing. Precedence:
  1. the user's stated or corrected value;
  2. the source's structured value;
  3. a deterministic reading of a dedicated field (title, location, salary text);
  4. the page title (company only);
  5. the job text;
  6. Unknown.

  A fallback never overwrites. A stated but unrecognized employment type stays Unknown, and a field the user cleared in the extension preview stays Unknown.
- **Facts now read from the job text when missing:**
  - company, location, work arrangement and employment type;
  - salary text, with salary minimum and maximum through the existing `parseCompensation`;
  - posting date and closing date;
  - time-zone requirement;
  - seniority (labelled only, after the title rule);
  - department (labelled only).

  Residency keeps its existing reader (`parseResidency`), unchanged, called the same way by both paths.
- **Compensation.** A statement counts only with a clear cue (salary, pay or pays, base, compensation, OTE or on-target, per year, annual, hiring range) and an amount of at least 10,000. Business metrics and perks are excluded: ARR, revenue, book of business, quota, funding, valuation, spend, contract value, customer base, stipends and similar. The whole statement becomes `salaryText` and is parsed as one unit. Statements that disagree leave it Unknown.
  - OTE stays out of base salary: "$105,000–$155,000 OTE" keeps the statement, with salary minimum and maximum Unknown. *(Superseded October 25, 2026: the bounds are kept, with compensation basis OTE; see "shared-normalization convergence".)*
  - "$145,000–$160,000 per year plus variable commission" uses the base range.
  - The unused `bonus`, `equity` and `compensationNotes` columns are not populated.
- **Currency, a product-wide change.** A bare "$" is USD only with clear U.S. evidence: the location, the residency regions or the statement itself name only U.S. geography (the country, a state, DC or Puerto Rico).
  - Canada, Australia, New Zealand, Singapore, a global or ambiguous location ("CA", "Remote"), a city alone, or no location leave the currency Unknown, with reason `BARE_DOLLAR_WITHOUT_US_EVIDENCE`.
  - A region abbreviation that could mean two places ("CA") is settled by a country the same location names as its last or first part: "Sunnyvale, CA, United States", "San Francisco, CA, USA" and Workday's "USA, CA, Pleasanton" are U.S. evidence; "Sunnyvale, CA" or "US or CA" stay ambiguous; "Toronto, ON, Canada" is never USD (and CAD is never inferred). An explicit currency always wins. (Added October 25, 2026.)
  - CAD, AUD and other currencies are never inferred from a place.
  - Explicit codes, symbols and the manual currency selection are unchanged.
  - The rule applies to every path, including salary text the source supplied. The marker `compensationText:bare-dollar-as-usd` is kept.
- **Time zone.** `timeZoneRequirements` is an existing normalized Opportunity field (schema column, normalized contract, manual stated detail). So an explicit requirement in the job text is now read, for example:
  - "Must overlap Eastern Time business hours.";
  - "Required working hours: 9am–5pm PT";
  - "Candidates must be available for CET working hours."

  A requirement word and a zone are needed. It is never inferred from a place, and "CT" or "MT" count as zones only next to a time or "hours". Preferred or flexible wording, and conflicting zones, stay Unknown.
- **Provenance.** Text-derived facts are DETERMINISTIC, never DIRECT, with markers that include `rawText:explicit-compensation-statement`, `rawText:explicit-work-arrangement-statement`, `rawText:explicit-employment-type-statement`, `rawText:explicit-posting-date-statement`, `rawText:explicit-closing-date-statement`, `rawText:explicit-location-statement`, `rawText:explicit-company-statement`, `rawText:explicit-time-zone-statement`, `rawText:labelled-company`, `rawText:labelled-location`, `rawText:labelled-work-arrangement`, `rawText:labelled-employment-type`, `rawText:labelled-time-zone`, `rawText:labelled-seniority` and `rawText:labelled-department`.
  - A company read from the page title is marked `pageContext:page-title-company`.
  - Fields the user corrected in the extension preview are now DIRECT with `userCorrected:<field>` (title, company, location, description).
- **Bounded job-page context (added after Alex's review, October 23, 2026).** A fact a page shows beside its structured description, such as "Remote Type: Hybrid" in a job-metadata block outside the JSON-LD description, now reaches shared normalization. Before, a structured-data capture never sent it.
  - **What the extension sends:** with a structured-data or selection capture, the page reader sends `pageText`: plain text of the job's main content, or on a page without one, the nearest container of the job heading that holds substantial text. It never sends the whole body.
  - **What it leaves out:** navigation, header, footer, side panels, forms, and recommendation, related-job, sharing, newsletter and cookie widgets. The text is capped at 20,000 characters and left out rather than exceeding the 128 KB envelope.
  - **When it is not sent:** never on LinkedIn (the server discards it there too), and not when the description already is the main content. The extension does not interpret it.
  - **How Core reads it:** `readJobTextFacts` reads page context only through labelled values (the same labels and rules as the posting text), never as prose. Its facts carry `pageContext:*` markers: `pageContext:labelled-work-arrangement`, `pageContext:labelled-location`, `pageContext:labelled-employment-type`, `pageContext:explicit-compensation-statement`, the date markers and so on.
  - **Precedence:** structured and user values still win. A page-context value that disagrees with the posting text, or with itself, leaves the fact Unknown.
  - **Hashing:** `sourceMetadata.pageText` is not part of the content hash, so a repeat capture stays UNCHANGED.
- **Product-wide collection audit (after Alex's second review, October 23, 2026).** Every retrieval adapter was checked for the same loss: a supported fact the source states in its own field, collected (kept in metadata and hashed as material), but never given to the shared normalizer. Found:
  - **department:** Greenhouse (a single department), Lever and Ashby (department, else team), SmartRecruiters and Workable;
  - **seniority or experience level:** SmartRecruiters, Himalayas and LinkedIn;
  - **compensation text:** Wellfound.

  The fix is collection only: a neutral `sourceFacts` record (`retrievedSourceFactsSchema`, carried in `sourceMetadata.sourceFacts`) holding the values as stated. The shared retrieved normalizer interprets them:
  - **Department:** DIRECT `source.department`, above a labelled line.
  - **Seniority:** a level in the shared vocabulary only (`standardizeSeniorityLabel`), `source.seniority`. A level the title also states must agree, otherwise Unknown, and two stated levels are Unknown. A label outside the vocabulary ("Mid-Senior level", "Associate") states no level.
  - **Wellfound compensation:** kept as salary text (`source.compensation`). Wellfound states no pay period, so amounts are read only when the text itself states an annual period.

  Every value was already one of the adapter's hashed material fields, so no stored listing's content hash changed. A test rebuilds each fixture listing with and without `sourceFacts`.
- **Audited without change:**
  - **Workday:** remoteType "Flex" stays deliberately Unknown, and pay appears only in its description.
  - **Remote OK:** the feed's salary amounts state no currency.
  - **Himalayas time-zone restrictions** are UTC offsets: whether they are a requirement is Alex's decision.
  - **Greenhouse pay ranges** require a different, unverified API request.
  - **Lever `salaryRange`** has not been seen on a verified site.
  - **We Work Remotely, Working Nomads and Adzuna** state nothing further.
  - **Manual entry** has no source fields beyond the form.

  Structured salary, workplace and employment fields already reach the normalizer for every source that has them.
- **Page-context change detection (after Alex's second review).** The raw page text is never hashed, so layout, navigation and widget noise is no change. A capture's content hash now includes, as material, the canonical page-context evidence (`pageContextEvidence`): the sorted, case-folded labelled values the shared reader takes from the page context, and the employer the page title names. It covers only facts the capture does not already supply at a higher precedence (a structured workplace type, a stated company, location, salary, employment type or posting date, or a title level).
  - The same meaningful evidence stays UNCHANGED. A changed labelled value ("Remote Type: Hybrid" → "Remote", a new location, salary or closing date) is a CHANGED re-observation, and the new source record carries the new evidence.
  - A capture with no such evidence keeps exactly the hash it had before.
  - Under the existing re-observation contract (Feature 13), a CHANGED listing, from any source and for a changed description too, adds a new linked source record. The opportunity's own facts are not rewritten. Whether changed facts should update a saved opportunity is a separate, product-wide decision for Alex. *(Superseded the same day: Alex approved current-version projection; see the section above.)*
- **Page-title company safeguard (tightened after Alex's review).** A page-title part is never the employer when it names:
  - a place: a supported geography, "City, ST", the posting's own location, or a name the posting places ("based in X", "Location: X", "X office");
  - a work arrangement or employment type;
  - a common department.

  Such parts ("<title> - New York", "<title> - Remote") are set aside. A dash-separated name must also appear in the posting itself. Exact-title anchoring, the platform-name exclusions and conflict → Unknown are kept.
- **Extension and server (neutral context only).** The page reader now returns the tab's `document.title` as `pageTitle`, never on LinkedIn, and does not interpret it.
  - The envelope gains an optional `pageTitle`, so an older envelope without it still validates.
  - The server stores `sourceMetadata.pageTitle`, dropped for LinkedIn as well, and `sourceMetadata.userCorrectedFields`.
  - Neither changes the listing's content hash, so a repeat capture stays UNCHANGED.
- **Unchanged:**
  - the deduplication engine, its thresholds and rules;
  - the unknown-host site-ID rule;
  - application-link precedence;
  - the evaluator, model routing, semantic schemas and recommendation logic;
  - `fieldsWithheldFromEvaluator`.

  There is no schema change or migration, and no backfill utility was built or run. Existing records keep their stored facts. *(The later current-version projection adds one additive migration; see the section above.)*

**Deduplication after the corrected inputs (normalization first, deduplication second).** The engine (`core-dedup-v2`) was not changed. With the corrected inputs:
- **A cross-site copy of one job is flagged, not merged.** The copy is a job-board listing with a company and "New York, NY", and an employer-page capture whose company now comes from its page title and whose location ("NYC") comes from the text. It is a PROBABLE_MATCH (flagged), never auto-attached, and the other listing's link is kept. Before the correction the employer copy had no company, so the engine could not compare the two at all.
- **The same title at a different company** is NO_MATCH.
- **Text similarity alone never auto-merges.** MATCH still needs a shared listing URL, or a shared listing or requisition ID with the same company.
- **A capture of the ATS page itself** attaches by URL and keeps the ATS application link.

No separate deduplication defect was found, so none is proposed.

**Evaluator input (unchanged contract, richer data).** The Task 7 facts stay withheld. Company, location, salary text and posting date already reach the evaluator subject. When a source left them empty they may now carry values read from the same job text the evaluator already receives. HANDOFFS records this for final integration.

**Verified (October 23, 2026; isolated test database only; no live third-party requests; no provider or evaluator calls beyond the fixture transport).**
- typecheck and lint;
- unit tests: 58 files and 1,516 tests (after the product-wide audit and change detection). They include:
  - the new `job-text-fallback` suite: 50 tests covering approved regression items 1–37, the eight page-context and page-title cases, and the shared reader's own checks;
  - three new page-reader tests in `extension-extract`: bounded page context, the heading-container fallback, and none on LinkedIn or for main content;
  - a new envelope test in `extension-client`.

  Items 38–42 are covered by the existing extension, pairing, evaluation-wrapper and E2E tests, which pass.
- integration on the test database: 32 files and 276 tests, including the new `job-text-fallback` suite (11). It covers a structured-data capture with labelled page metadata persisted with `pageContext:*` provenance; page-context change detection (same evidence, noise, no context → UNCHANGED; Hybrid→Remote and a new location → CHANGED with linked records carrying the new evidence; structured Remote unaffected); and source facts persisted from a retrieved listing;
- the full E2E chain: 44/44 (5.9 min on the final run), including the new extension test in Chromium. In it, a JSON-LD page's "Remote Type: Hybrid" and "Location" rows outside the description reach the opportunity with `pageContext:` provenance, while a related-jobs widget, the header and the footer are ignored. One earlier run of the chain stopped on a 30-second timeout in `applications.spec.ts` (a browser "session closed" while loading the tracker's notes; code this change does not touch). That spec then passed alone (4/4), and the full chain passed on the re-run;
- `pnpm extension:build` and the production web build;
- `git diff --check`, with `apps/web/next-env.d.ts` untouched (restored after the E2E dev server rewrote it).

Tests encoding the superseded rules were updated deliberately:
- the bare-"$" USD cases now give U.S. evidence or expect Unknown;
- the G5 "never reads it from the job text" tests now expect the explicit fallback and still refuse a place-only inference;
- integration fixtures that relied on bare "$" without a U.S. location now state one (or `US$`);
- the sparse manual evaluation test now expects the job text's "Salary:" line as `salaryText`.

**Versioned specifications.** Core Platform TDD v1.15 and Core AI Framework PRD v1.14 restore the Core requirement, with the precedence, markers, currency rule, time-zone decision and work-authorization gap. Their previous versions moved unchanged into `Archive/`. The Customer Success PRD and TDD are unchanged: the domain contract did not change.

**Known gaps recorded, not built.**
- ~~Work authorization and visa eligibility: no normalized field. It is still never read as residency (HANDOFFS, DEVELOPMENT_PLAN).~~ Decided and implemented October 25, 2026: a normalized fact, separate from residency.
- ~~Re-observation updates: a CHANGED listing does not rewrite the saved opportunity's facts (Feature 13 contract, every source). A decision is needed if changed facts should flow into an opportunity.~~ Decided and implemented on October 23, 2026: current-version projection (section above).
- Himalayas time-zone restrictions (UTC offsets) as a time-zone requirement; Greenhouse pay ranges (a different API request needing live verification); Lever `salaryRange` (unseen on a verified site).
- ~~Generic employer apply-link extraction: a possible future enhancement, kept separate because application URLs carry identity.~~ Approved and implemented October 25, 2026 (explicit apply links and on-page application forms; the deduplication logic is unchanged).
- A bare "$" with only a city ("NYC", "Chicago") stays currency-Unknown, because cities are not in the geography vocabulary.

**What remains.** Alex's review, then the minimal human retest on fresh isolated records (collection, then normalized fields and provenance, then deduplication), then acceptance and the checkpoint commit on Alex's approval. The acceptance database `ai_career_assistant_acceptance` is preserved until then. The normal application database was not touched.

### Feature 14B — browser-extension companion (committed `e6bacc6`, October 20, 2026; local acceptance found the normalization gap corrected above; still open)

*(Heading updated on October 23, 2026. It read "implemented and verified October 20, 2026; awaiting review and local acceptance; not committed". The record below is as written at implementation time.)*

**What it is.** A TypeScript Manifest V3 extension in `apps/extension` that saves the job page Alex is viewing into the local AI Job Assistant, only when asked. It is a source-collection boundary only: no evaluator, model calls, prompts, budget, recommendation logic, lifecycle or database of its own.

**Approved decisions it implements (October 20, 2026).**
- **D1, evaluation.** A capture only saves. After a save, an explicit **Request evaluation** goes through an authenticated extension wrapper to the existing production evaluation handler. The popup shows only the persisted queued, running, completed or failed state and the recommendation, read-only.
- **D2, LinkedIn.** Job pages only, read through structured data, then a reader limited to LinkedIn's job-detail areas, then Alex's selection. There is no whole-page fallback. Account, profile, messaging, feed, cookies and other tabs are never read. It complements 14A and does not address 14A's HTTP 429.
- **D3, WTTJ/Otta.** Generic extraction only; there is no site reader.
- **D4, authentication.** A revocable pairing credential, shown once and stored server-side only as a SHA-256 hash. The extension keeps it only in `chrome.storage.local`.
- **O1, unknown hosts.** Accepted as AGGREGATOR, the lowest link precedence, with the real host and capture provenance kept.
- **O2, acceptance database.** A dedicated local acceptance database.
- **O3, stale Core TDD wording.** Corrected at the 14B closeout spec version.
- **O4, evaluation routes.** The credential protects the extension's evaluation request and status wrappers under `/api/extension/*`.

**Built.**
- **The extension** (`apps/extension`):
  - `manifest.json` with exactly `activeTab`, `scripting` and `storage`, host access to `127.0.0.1` and `localhost` only, no content scripts, and a minimal service worker (`service-worker.ts`).
  - The service worker only restricts the extension's storage to its own pages, on installation and every browser start.
  - `extract.ts`: one self-contained page reader, injected only on "Read this page", taking no arguments and using no storage, cookies or network.
  - `envelope.ts`: local validation with the server's own schema, and the user's corrections from the editable preview, named in `editedFields`.
  - `api.ts`: the only `fetch`, limited to `/api/extension/*` on a local backend.
  - `settings.ts`: `chrome.storage.local` only, restricted with `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`.
  - The popup: an editable preview (title, company, location, description; nothing sent before Save), Save, Request evaluation, and the persisted state.
  - The options page, and `build.mjs` (esbuild, writing `dist/`, which is git-ignored).
  - `pnpm extension:build`.
- **Core:** `packages/core/src/extension-capture.ts`, the strict capture envelope (128 KB body, 50,000-character description, no HTML), the user-corrected `editedFields`, text cleaning, URL cleaning and LinkedIn job-ID parsing, shared by the server and the extension.
- **Server:**
  - `extension-auth.ts`: credential generation and hashing; the Bearer check with constant-time comparison; refusal of web origins; same-origin-only pairing management that refuses Bearer credentials; JSON bodies capped, with 415, 413 and 400 responses.
  - `extension-capture.ts`: site classification (known ATS, job-board and marketplace hosts, everything else AGGREGATOR); page identity (LinkedIn canonical `/jobs/view/<id>` and `linkedin:<id>`, otherwise `<site>:<cleaned URL key>`); and the mapping to `buildRetrievedListing` with `BROWSER_EXTENSION` / `BROWSER_ASSISTED`, then `createRetrievalIngestionService`. Captures are not title-filtered; `outsideRoleFamilies` is informational.
  - `extension-api.ts`: the handlers.
  - Seven route files under `apps/web/src/app/api/extension/`: captures, status, lookup, pairings, pairings/[id]/revoke, opportunities/[id]/evaluation-requests and opportunities/[id]/evaluation. `OPTIONS` returns 405 and no CORS headers are emitted.
- **App:** an **Extension** page (`/extension`) to create, list and revoke pairings, added to the header navigation. The doctor names the connected database (name and host only) and counts paired browsers.
- **Database:** one additive migration, `20261020090000_extension_pairing` (the `ExtensionPairing` table, with no foreign keys; rollback is `DROP TABLE "ExtensionPairing";`). It was applied only to the isolated test database, and `db:verify-migrations` passes with 20 migrations. Also `PrismaExtensionPairingRepository` and the read-only `PrismaExtensionLookupRepository`.
- **Unchanged:** evaluator internals, model routing, semantic schemas and recommendation logic.

**Differences from the approved plan's wording, all approved or required by the implementation prompt.**
- **Unknown-host identity (approved refinement, October 20, 2026).** An unrecognised site's listing identity is its cleaned page URL. Any identifier the page declares (for example a JSON-LD `identifier`) is kept as capture metadata (`siteJobId`) and not trusted as identity. Known sites keep their URL-based ID rules (LinkedIn's job ID).
- **A minimal service worker.** The plan text said "no service worker". The Feature 14B implementation prompt lists one, with an E2E check that it starts. It only restricts storage.
- **An editable preview.** The plan text said the preview is read-only. The implementation prompt requires it to be editable and testable. Corrected fields are named in the capture (`editedFields`) for provenance.

**Implementation-time checks from the plan.**
- **Chrome storage restriction:** `chrome.storage.local.setAccessLevel` is supported (Chrome 102 and later; the manifest requires 120). In Chromium 141 a scratch control showed that a page-injected script reads `chrome.storage.local` by default and is refused after `TRUSTED_CONTEXTS` is set. The extension E2E checks that a page-injected script cannot read the extension's storage, while its own pages can.
- **Shell `DATABASE_URL` precedence:** proved with a temporary decoy `.env` naming a nonexistent database, removed afterwards. With the shell variable, `pnpm app:doctor`, Prisma (`db:status`, the same config `app:setup` uses), `next dev` (`/api/health`) and `dotenv/config` (the worker's loader) each used the shell's database. Without it, each read the decoy, which proves `.env` is loaded otherwise. The normal application database was never involved.

**Verified (October 20, 2026; isolated test database only; no live third-party requests; no provider or evaluator calls beyond the fixture transport).**
- typecheck and lint, including the new extension package;
- unit tests: 57 files and 1,433 tests, among them `extension-extract` (13), `extension-client` (16) and `extension-server` (41), plus doctor and navigation checks;
- integration on the test database: 31 files and 265 tests, including `extension-capture` (7);
- E2E: the `extension` Playwright project (6 tests) loads the built unpacked extension into Chromium 141 with `launchPersistentContext`, with DNS limited to `127.0.0.1` and `localhost`. The full E2E chain passed 43/43 (7.2 min) after the service worker and editable preview were added (and 39/39 before them);
- the production web build; `pnpm extension:build`; `db:verify-migrations`; `git diff --check`; `apps/web/next-env.d.ts` left unchanged.

The extension E2E covers:
- the service worker starting, and storage closed to page scripts;
- pairing through the UI, and the editable preview;
- that no capture request is made before Save;
- created, unchanged and possible-duplicate results, and a corrected title being saved;
- Open in AI Job Assistant;
- Request evaluation with its queued, running, completed (with the recommendation) and failed states;
- a page with no job;
- the LinkedIn reader in real Chromium, with profile, message and feed decoys and no whole-page fallback, and the Welcome to the Jungle generic path, on pages Playwright answers itself;
- revocation (then 401), and the routes' refusals.

**Versioned specifications.** Core Platform TDD v1.14, Customer Success TDD v1.12, Core AI Framework PRD v1.13 and Customer Success PRD v1.12 are built from the previous versions, which moved unchanged into `Archive/`. Core Platform TDD v1.14:
- records Feature 14B's implementation status (Section 51);
- notes in Section 45 that evaluation after capture is only ever the user's explicit request;
- records the approved pairing-credential exception to the general rule against secrets in browser storage;
- corrects Section 9's stale wording (D7/O3): browser-assisted support for LinkedIn is implemented, but the source remains unverified and disabled after the local check (search page HTTP 200 with 60 cards, first job page HTTP 429), and Upwork belongs to the Freelance Writing domain, implying no Customer Success verification.

The others refresh the 14B status and their dependencies.

**What remains.** Alex's review of this implementation, then Alex's local acceptance in Chrome on a dedicated acceptance database (runbook in `apps/extension/README.md`), then the checkpoint commit (only on Alex's approval). Feature 14 is complete only then, and Alex's personal documentation copies are exported only then.

### Feature 14A — browser-assisted retrieval and source corrections (committed `dd77d29` and accepted, October 20, 2026)

*(Heading corrected on October 20, 2026 from "Feature 14 — …": this record covers Feature 14A only. Feature 14B, the browser-extension companion, is required and not yet implemented, so Feature 14 as a whole is not complete.)*

*(Heading updated on October 20, 2026 after the commit and acceptance; it read "implemented and verified October 19, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Acceptance (October 20, 2026).** On October 20, 2026 the committed adapter (`dd77d29`) was run from the local WSL runtime with one search page and one job page: the public search page returned HTTP 200 and 60 public job cards were discovered (the "Sign in to view more jobs" modal did not prevent it); the first job-detail page returned HTTP 429, and the run stopped at once as RATE_LIMITED, with no retry and no listing emitted. Feature 14A was accepted on that result; LinkedIn itself stays unverified and disabled (a source-side rate limit, not an implementation defect) and is not retried.

**Scope (approved October 19, 2026, with a scope change).** Part A: browser-assisted, automated retrieval for **public, logged-out LinkedIn** job pages only. Part B: source audits and corrections. Part C: the Manifest V3 manual-capture extension is **deferred** (an optional future idea): no manifest, popup, `activeTab`/`scripting` permissions, localhost bridge, pairing token or extension E2E were built. No evaluator change, no migration, no AI calls, no broad crawling. *(Correction, October 20, 2026: An October 19, 2026 implementation instruction incorrectly treated Feature 14B, the required browser-extension companion, as deferred, an optional future idea and not required. No approved roadmap or authoritative product-scope revision removed Feature 14B from the main product. This correction (October 20, 2026) resolves that inconsistency while preserving Feature 14A's accepted implementation. Part C above records that instruction as it was given; Feature 14B remains required main-product work and is next.)*

**Access model (A1).** A fresh, non-persistent browser context per run, asserted to start with no cookies; no profile, `userDataDir`, storage state, credentials or account; no login, applying, saving, following, messaging or connections; no proxy rotation, IP hopping, stealth, fingerprint or user-agent changes, CAPTCHA solving, or challenge/authwall/access-control bypass. The adapter only opens URLs and reads the returned document (the session API exposes only `open`). An account cookie (`li_at`) appearing would stop the run.

**What changed.**

- **Runner (A2–A4)** (`packages/discovery/src/browser.ts`): `createBrowserSession(driver, options)`: sequential navigation with at least the adapter's minimum interval between starts (LinkedIn 5 s; no concurrency); a per-run navigation cap; a 30 s timeout; a 5 MB page limit; generic friction detection (authwall, login, signup, checkpoint, challenge, `uas/login` or CAPTCHA paths; CAPTCHA or challenge widgets) plus the adapter's own (LinkedIn's join form or security-check page). 429 → `RATE_LIMITED` (with Retry-After); 401/403/999, friction or an account cookie → `ACCESS_DENIED`; 5xx → `SERVER_ERROR`; a failed load → `NETWORK`. After any stop, every later `open` is refused without navigating. Feature 12 then backs the source off (at least a day after an access refusal); nothing is retried.
- **Driver** (new `packages/browser-retrieval`): `launchBrowserDriver({ executablePath })` with `playwright-core` (headless Chromium, `serviceWorkers: "block"`, no downloads, images/fonts/media aborted), and `parseHtml` with jsdom (scripts not run). Configured by the optional `RETRIEVAL_BROWSER_EXECUTABLE`; loaded dynamically by the retrieval worker CLI and `sources:verify` only.
- **Worker:** for `requiresBrowser` adapters, one driver per run, closed in `finally`; no browser configured → `ADAPTER_UNAVAILABLE`; a launch failure → `INTERNAL` (neutral for health). It passes `pendingListings` and records `discovered` and `unavailable`.
- **LinkedIn adapter (A5–A8)** (`packages/discovery/src/adapters/linkedin.ts`; `BROWSER_ASSISTED`, `JOB_BOARD`, `PUBLIC_SEARCH`, `verified: false`):
  - deterministic public search URLs (`keywords`, optional `location`, `f_TPR`, `f_WT=2` for remote, `start`), keywords defaulting to the domain's search query (`"customer success"`);
  - discovery: pages by the number of results each page actually returned (never an assumed page size), ending on an empty, repeated or short page, within `maxSearchPages` (default 4, hard cap 8) and `maxDiscovered` (default 100, hard cap 200). The existing Customer Success title filter runs on the cards. Coverage is reported (all card IDs) and never complete;
  - details, a separate budget: `maxDetailsPerRun` (default 20, hard cap 25). Order: pending matches from earlier runs (oldest first, up to 30 days), then this run's unseen matches, then stored matches last checked over 7 days ago. 404/410 marks a pending job unavailable; three unreadable pages in a row halt the run;
  - parsing: schema.org JobPosting JSON-LD first, then the public page's title, description, criteria and salary; no value is invented; the source URL is the public job page and `applicationUrl` only the external apply address the page states;
  - bounded and never removal-capable (Feature 13 rules unchanged). No query segmentation to get around caps.
- **Cross-run pool (no migration):** title matches without stored details are kept as current-scope `RetrievedListing` rows with no opportunity (LISTED, not removal-capable); `pendingListings(sourceId, scopeKey, since)` returns them oldest first; the existing stored-listing path attaches the opportunity when their details are read; an unavailable job's placeholder is deleted. Stored jobs are detected with the existing `lastCheckedListings`.
- **`sources:verify`:** a browser-assisted adapter is verified through a fresh logged-out browser: one search page and the first job page it lists (`verificationFollowUpUrl` now receives the page as a `Document`), saved outside the repository and replayed offline.
- **We Work Remotely (B1):** the official all-jobs feed `https://weworkremotely.com/remote-jobs.rss` with our own title filter; attribution and links kept; a legacy `category` setting is accepted and ignored; no HTML, browser or extension.
- **Wellfound (B2):** `minRequestIntervalMs` 12,000 (was 2,000); sequential; embedded state unchanged.
- **Welcome to the Jungle / Otta (B11, revised by the October 19 addendum):** reclassified as public logged-out webpage retrieval (`retrievalType` `PUBLIC_HTML`; no public jobs API identified; bounded; not removal-capable) and treated as an active candidate, not disabled because of its terms. Live inspection (October 19, 2026): one plain GET of `https://www.welcometothejungle.com/en/jobs?query=customer%20success` (through the existing verification tool) answered 200 with 537 KB of HTML for a sign-up and matching landing page: no listings, no job links, no job data in its embedded React data, and the query ignored. One logged-out headless-browser load of the same page (through the Feature 14 session) was refused by WTTJ's CloudFront firewall: HTTP 403 "Request blocked". That is a stop condition, so no further WTTJ request was made (no retry, no company page, no workaround). At that point no public listing surface had been retrieved without a block; the adapter's comment records all of the evidence below. *Local check (later on October 19, 2026; the scheduled cloud company-page check was cancelled):* a local WSL browser check run by Alex then loaded the public company jobs page (`/en/companies/wttj/jobs`, which ends at `/en/companies-v1/wttj/jobs`) logged out with no 403, 429, CAPTCHA, sign-in wall or challenge, and with JavaScript rendering showed the company shell and a "Jobs 16" tab but "We didn’t find any jobs for your search": no job cards, links, IDs, descriptions, locations, employment types or dates. Plain HTML is insufficient and JavaScript rendering is required for the page state, but even rendered, this public company page exposed no usable job records. So: Claude cloud headless browser, HTTP 403 (environment-specific, not a universal block); local WSL browser, page reachable; public rendered page, no usable job records. **Final Feature 14 status:** registered candidate, `PUBLIC_HTML`, bounded and not removal-capable, public logged-out webpage retrieval technically possible in principle, but unverified and disabled because the tested public surfaces expose no usable job records (not because of its terms, and not because it is universally blocked). No hidden or internal API discovery or reverse engineering was done, and no other WTTJ route was tried.

**Audits (no code change).**

- **Workday (B3):** the tenant career-site JSON (`/wday/cxs/<tenant>/<site>/jobs`), stateless POST, bounded; preserved. No adapter reads `robots.txt` (reported; supporting it would be a framework addition).
- **Workable (B4):** the anonymous Jobs by Workable search JSON; left alone; the ~850 MB XML feed is not used.
- **Working Nomads (B5):** the public `https://www.workingnomads.com/api/exposed_jobs/` JSON feed; `/jobsapi/_search` is **not** intercepted or replayed.
- **Remote OK, SmartRecruiters, Himalayas (B6–B8):** their official public API/feed endpoints, as verified in 11A. Himalayas' `expiresAt` stays display-only (Feature 13).
- **Adzuna (B9):** disabled (unverified, needs credentials). **Greenhouse, Lever, Ashby (B10):** no work.

**Tests.**

- **Unit:** new `browser-retrieval.test.ts` (40): sequential one-at-a-time navigation and the interval; the navigation cap; stops on 429 (Retry-After), 403, 999, 401, 503, authwall/login/checkpoint redirects, a CAPTCHA, a challenge iframe, LinkedIn's anti-bot interstitial (with 200 or 429), an account cookie, an oversized page and a failed load, each with no later navigation; the adapter's friction check; the `open`-only API; search-card parsing (URN or link IDs, unidentified cards, no-results versus unrecognized); job pages with and without JSON-LD, null on a changed layout, no invented application URL; deterministic URLs and defaults; the verification pair (one search page and the first job page it lists); strict config rejecting credentials, cookies, profiles, proxies and over-cap budgets; registration (browser-assisted, unverified, not removal-capable, scope excluding budgets); the 100-result pool across 4 pages with a 20-page detail budget; caps; paging by actual counts and early ends; pending-first ordering, no refetch of fresh stored jobs and the 7-day refresh; mapping and normalization; unavailable pages and the three-in-a-row halt; first-page blocks failing the run; later blocks keeping what was found. New `browser-retrieval-worker.test.ts` (7): no browser or executable → unavailable; launch failure → internal; one fresh browser per run, paced and closed; the discovered pool and unavailable IDs reaching the ledger; 999/429/authwall failing the run with Feature 12 data (Retry-After) and no further navigation; a stop during details keeping stored listings. `retrieval-adapters.test.ts` (+1): WWR reads only the all-jobs feed and filters titles itself. `retrieval-adapters-11b.test.ts` (+1): Wellfound 12-second sequential cadence through the polite transport, and a 429 or 403 stopping with no further request.
- **Integration:** new `linkedin-retrieval.test.ts` (3, isolated test database): the discovered pool persisted as pending rows and worked through over four runs within a 2-page budget, never refetching stored jobs, bounded rows never MISSING, no evaluation created and the provenance recorded; a gone pending job leaving the queue; HTTP 999 failing the run with at least a day of backoff, no further navigation and Run now refused. New `browser-driver.test.ts` (4): the real Playwright driver and headless Chromium against a local 127.0.0.1 server: no cookie carried into a new run, images and fonts not requested, statuses and Retry-After reported, a closed driver refusing navigation, an authwall redirect stopping the session, and a self-reloading 429 page producing exactly one request with headers kept and cookie values dropped.
- **E2E:** `retrieval.spec.ts` (extended): a LinkedIn source on `/sources` shows "LinkedIn (job board · browser-assisted)" and cannot be enabled.

**Verification** (isolated test database only; no paid or provider calls; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 54 files / 1,362 tests; integration 30 files / 258 tests; E2E 37/37; production build succeeds; `pnpm db:verify-migrations` (19 migrations, only the known documented drift; no new migration);
- `apps/web/next-env.d.ts` unchanged (the dev server rewrote it during E2E and the build; it was reverted each time).

**LinkedIn live verification (Part E).** *First attempt (earlier on October 19, recorded as written):* The Claude cloud environment's egress proxy answered HTTP 403 to `CONNECT www.linkedin.com:443` (policy denial; re-checked on October 19, 2026 with a single CONNECT probe that reached no LinkedIn server). No LinkedIn page was loaded, so the parsers rest on synthetic pages modelled on the public layout, and the adapter stays `verified: false` and cannot be enabled. To verify it, add `www.linkedin.com` to the environment's allowed domains (Network access in the environment settings), then run `pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}' --raw-dir <dir outside the repository>` with `RETRIEVAL_BROWSER_EXECUTABLE` set, and mark the adapter verified only if both pages map.

*Network check and second attempt (after the October 19 addendum):* the environment's allowlist is enforced by the upstream gateway and is not readable from the session, so each host was probed with a CONNECT and a TLS handshake only (no HTTP request). `www.linkedin.com`, `linkedin.com`, `static.licdn.com`, `www.welcometothejungle.com` and `app.welcometothejungle.com` all completed TLS with their own certificates and the gateway logged no refusal, so nothing further needs allowlisting and no setting was changed (the minimum LinkedIn set is `www.linkedin.com`; images and media are not loaded, and `static.licdn.com` is reachable too). One minimal logged-out verification then ran (`pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}'`, fresh browser): the first and only request, one public search page, was answered with **HTTP 429** and LinkedIn's anti-bot interstitial (24 KB: an obfuscated script that computes a cookie and a one-second meta refresh to the home page; a Cloudflare `__cf_bm` cookie was set). The session stopped as RATE_LIMITED and made no second request; the interstitial was not executed, solved or retried. The raw page stays outside Git. Outcome (environment-specific): the Claude cloud environment's automated headless Chromium received HTTP 429 and an anti-bot response; this does not establish how LinkedIn treats a local runtime or an ordinary local Chrome, which remain a separate future decision. The adapter stays `verified: false` and disabled, and the LinkedIn friction check now also recognises this interstitial (a refresh-only page with no job content) whatever its status. Node's built-in `fetch` in this environment needs `NODE_USE_ENV_PROXY=1` to reach the proxy (used for the WTTJ check); Chromium uses the proxy without configuration.

*Offline diagnosis of that single 429 (no further LinkedIn request; the challenge script was read as text, never executed):*

- **Verified:**
  - The response was HTTP 429 for `https://www.linkedin.com/jobs/search?keywords=%22customer+success%22&f_TPR=r604800&f_WT=2&start=0`, with no redirect: the final address equals the request.
  - The 24,644-byte body has no visible content. It holds one inline script, no external resources, and `<meta http-equiv="refresh" content="1;url=https://www.linkedin.com">` (the fallback for clients without JavaScript).
  - The script is an obfuscated CryptoJS HMAC-SHA256 routine. On `window.onload` it sets a 20-minute `ccookie=<value>|<hash>` cookie, then reloads the same URL with an added `original_referer` parameter (the referrer, truncated to 200 characters).
  - The script reads no `navigator`, `webdriver`, `userAgent`, screen, canvas or WebGL properties. The decision to serve it was therefore made on the server from the request alone, before any page-side check.
  - After the response the context held one cookie, `__cf_bm`. That is Cloudflare's bot-management cookie name; its domain and value were not recorded. There was no `ccookie`, so the script had not completed when the cookies were read.
  - The run stopped as RATE_LIMITED and our code issued no further navigation.
  - Response headers, including any Retry-After, were not recorded: the driver then kept only the parsed Retry-After, and the verification tool logged no headers.
  - **Browser configuration** (measured locally against a 127.0.0.1 echo server with the same launch options): Chromium 141.0.7390.37, `headless: true` (Playwright's headless mode, no display).
  - **User agent:** `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36`.
  - **Request headers:** `sec-ch-ua: "Chromium";v="141", "Not?A_Brand";v="8"`, `sec-ch-ua-platform: "Linux"`, `accept-language: en-US,en;q=0.9`, ordinary `accept` and `sec-fetch-*` values, and `pragma: no-cache` / `cache-control: no-cache`. A first navigation in ordinary Chrome sends neither of the last two; here they come from the driver's request interception, which disables the cache.
  - **Visible to the page:** `navigator.webdriver` is `true`, the timezone is UTC, the screen is 1280×720 and there are 4 cores.
  - **Network path:** direct egress is impossible (a direct HTTPS request to example.com fails), so Chromium necessarily went through the environment's agent proxy and gateway. At the moment of the verification launch the gateway logged Chromium's background requests to www.google.com as refused. The CONNECT tunnel to LinkedIn is end to end: its certificate is LinkedIn's own (DigiCert), so Chromium's own TLS and HTTP reached LinkedIn unmodified.
  - The block came on the first request, before any LinkedIn parsing or paging logic ran.
  - The request was well formed: the URL is the documented public search form and the headers are standard. No evidence of a malformed request exists.
- **Plausible inferences:**
  - The request left from a shared cloud or datacenter egress, not a residential connection. The egress IP was not looked up.
  - IP or ASN reputation, or rate limits on that shared egress, are a likely factor (the status is 429, and it came on the very first request, with no earlier traffic of ours).
  - Automated-browser signals visible in the request itself are a likely contributing factor: the `HeadlessChrome` user agent, the Chromium-only client hints and the no-cache headers. The headless TLS fingerprint may also differ from desktop Chrome, but this was not verifiable.
  - The challenge is a JavaScript-capability check served to traffic already classified as suspicious.
- **Unknown from one response:**
  - LinkedIn's actual reasons and which signal weighed most.
  - Whether the same request from a residential local runtime, or from an ordinary local Chrome, would be served normally.
  - Whether a Retry-After was sent.
  - The cookie's issuing domain.
  - Whether Chromium's own execution of the page script began its reload before the browser closed. The missing `ccookie` suggests not, but it cannot be proven.
- **Best-supported explanation:** a combination of a shared cloud egress and plainly automated-browser request signals (the `HeadlessChrome` user agent), classified server-side before any page script ran. Malformed implementation behaviour is not supported by the evidence.
- **Changes made from this diagnosis** (no LinkedIn request, no change to proxy, network, user agent or fingerprint, and no stealth):
  - The driver now refuses any main-frame navigation the page starts by itself, such as a script reload or meta refresh, so a challenge page can never cause a further request after a stop. A local test shows a self-reloading 429 page producing exactly one request.
  - The driver now records the response headers (Set-Cookie reduced to cookie names), and `sources:verify` saves them, so a future approved check keeps them.

*Local LinkedIn check (later on October 19, 2026, run by Alex outside Claude cloud):* a controlled logged-out check from a local browser-automation environment (not Claude cloud) then loaded `https://www.linkedin.com/jobs/search/?keywords=Customer%20Success&location=United%20States&f_WT=2` successfully (no 429, 403, 999, CAPTCHA, challenge or login interaction), with public job cards (title, company, location, public job link, relative posting time) for about 11,000 results under a dismissible "Sign in to view more jobs" modal. Examples included Trustpilot, Commas, JustPark, MongoDB, Copado, MaintainX and Cvent; the final address added `position=1&pageNum=0`. The exact user agent and egress type were not recorded. **Interpretation:** the Claude cloud 429 is environment-specific (Claude cloud headless Chromium → 429 anti-bot response); LinkedIn public, logged-out retrieval remains a viable Feature 14 source and is not generally blocked; the MV3 extension is not needed for it and stays deferred. The adapter stays `verified: false` until one controlled local-runtime verification of the Feature 14 adapter itself (`pnpm sources:verify linkedin --config '{"maxSearchPages":1,"maxDetailsPerRun":1}' --raw-dir <dir>` with `RETRIEVAL_BROWSER_EXECUTABLE` set) succeeds after this code is synced locally. **Changes from it (no LinkedIn request from Claude cloud):** the sign-in modal over still-present public results is no longer treated as a login wall (it was, which would have stopped a run); a sign-in form with no job content still is. The search URL now uses the verified `/jobs/search/` form.

**Final bounded live source pass (October 20, 2026, approved; one request per source, production adapter code and routes, the real fetch transport through the environment proxy, raw responses kept outside Git, no browser, no retries):**

- **We Work Remotely** (required contract check): `GET https://weworkremotely.com/remote-jobs.rss` → 200, valid RSS, 91 items. The existing parser mapped all 91 with no issues; the Customer Success title filter kept 3 (for example "Client Success Manager - Enterprise Accounts", FIXD Automotive), each with its WWR link as source and application link and "We Work Remotely" as source name. The committed fixture was re-captured from this response (3 of 91 items, byte-for-byte, no contact data), and its tests updated. WWR stays verified.
- **Wellfound:** `GET https://wellfound.com/role/customer-success-specialist` (one page) → 200; embedded Next.js data present; 41 listings parsed, 18 kept by the title filter; 12-second interval, sequential, bounded.
- **Working Nomads:** `GET https://www.workingnomads.com/api/exposed_jobs/` → 200 JSON; 41 jobs mapped with no issues (none matched Customer Success at the time); no `/jobsapi/_search`, no Elasticsearch request and no browser.
- **Remote OK:** `GET https://remoteok.com/api` → 200 JSON; 99 jobs mapped, 3 kept, each with the Remote OK link and "via Remote OK" attribution.
- **Himalayas:** `GET https://himalayas.app/jobs/api?limit=20` → 200 JSON; 20 jobs mapped (none matched at the time); `nextCursor` present and not followed; links taken from `applicationLink`, which now carries `?utm_source=api` (tracking parameters are already dropped from listing URL keys, so no false changes).
- **SmartRecruiters:** `GET https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=10` → 200 JSON; the list contract parsed (10 postings, coverage IDs read). No detail request was made (minimal smoke test); mapping, which uses details, is covered by the verified fixture and is unchanged by Feature 14.
- **Not repeated:** LinkedIn (cloud 429 anti-bot response; local logged-out browser success), Welcome to the Jungle (cloud 403; local rendered page with no job records), Workday and Workable (routes unchanged since their 11B verification), Greenhouse, Lever and Ashby (unchanged), Adzuna (disabled, needs credentials).
- No implementation defect was found; no production code changed in this pass.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/`. *(Status correction, October 20, 2026: Core Platform TDD v1.13, Core AI Framework PRD v1.12, Customer Success PRD v1.11 and Customer Success TDD v1.11 supersede the versions below. They record Feature 14A as accepted, with the local LinkedIn evidence, and Feature 14B as required, pending and next, replacing wording that called the extension deferred or optional. The versions below moved unchanged into `Archive/`.)*

- **Core Platform TDD v1.12:** a §51 "Browser-Assisted Retrieval and Source Corrections (Feature 14)" section, the sequence and the dependency.
- **Core AI Framework PRD v1.11** and **Customer Success PRD v1.10:** current status, revision history and dependencies.
- **Customer Success TDD v1.10:** status, revision history and the dependencies.

The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- The LinkedIn parsers have not met a live page (the cloud check was stopped by an anti-bot interstitial; the successful local check was a manual browser load, not this adapter). The public search may show more results only to signed-in users; the adapter reads what is public and stops on a real sign-in wall. Its public layout may differ (class names, a guest search endpoint instead of the full page, a consent or sign-in modal); the adapter fails closed (a contract mismatch or a stop), never guessing.
- The We Work Remotely fixture is now captured from the all-jobs feed (see the live source pass below); the October 17 category-feed fixture it replaced used the same RSS item format.
- A LinkedIn search past its last page may answer something other than an empty list; a non-200 later page halts discovery for that run (PARTIAL) rather than failing it.
- A 404 job page counts as a listing issue, so a run whose only detail is gone finishes `LISTING_FAILURES` (neutral for health).
- No adapter honours `robots.txt`; the controls are the cadence, caps, stop rules and backoff.
- The browser-driver integration test needs a Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE` here (as for E2E), or Playwright's own.

### Feature 13 — posting history and listing removal (committed `d1bf217`, October 19, 2026)

*(Heading updated on October 19, 2026 after the commit; it read "implemented and verified October 19, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved, with the final corrections of October 19, 2026).** An objective, conservative posting history per retrieved listing: sightings, confirmed removal only where a source provably shows its whole board, reappearance, the source's stated expiry, and deterministic posting-history facts. No adapter retrieval change beyond coverage, no ingestion or deduplication change, no evaluator change, no live source requests and no AI calls. Out of scope: feeding the evaluator, text-based ghost signals, new-ID repost and requisition-frequency patterns (feature 18), browser-assisted sources (feature 14).

**Approved decisions.**

- The facts are built and contract-tested but **withheld** from `loadSubject()` and the evaluator. The first question for the later integration is whether Ghost Job Risk can become deterministic from them rather than activating the dormant paid semantic path.
- REMOVED requires two consecutive qualifying complete misses **and** at least 24 hours between the first miss and confirmation; the first miss gives MISSING only.
- `UNCHANGED_OVER_TIME`: 30 days, measured on content observations only.
- `Opportunity.status` is never changed automatically; source expiry dates are display-only (no removal, no `closingDate`); We Work Remotely is bounded until separately verified.
- Corrections: coverage IDs are collected before the title filter; Wellfound never confirms removal; tracking scopes are opaque **generations** (A → B → A gives three, and A₂ never inherits A₁'s history); the legacy backfill is HISTORICAL, never currently listed; where a source states a total, unique IDs must **equal** it exactly; the dashboard badge uses current-scope logic.

**What changed.**

- **Coverage** (`packages/discovery`): `CollectResult.coverage` (`observedListingIds`, `complete`); `listingCoverage()` (complete only for a whole read, every item with an ID, and unique IDs equal to any stated total), `trackingScopeOf()`, `itemId()`, `isRemovalCapable()`; `listingCoverage` and `trackingScope` declared on Greenhouse (`board`; `meta.total` checked), Lever (`site`), Ashby (`board`; unlisted postings excluded), SmartRecruiters (`company`; complete only when `totalFound` is read in full within the page cap) and Workday (host/tenant/site; complete only when the first page's `total` is read in full). The others stay bounded.
- **Migration** `20261019090000_retrieved_listing_history`: enum `RetrievedListingState`, table `RetrievedListing` (unique on source, scope generation and listing ID), `RetrievalSource.trackingScopeKey`, `RetrievalRun.listingCoverageComplete`, and the HISTORICAL backfill (one row per pre-feature-13 retrieved listing: first discovered, last observed, its opportunity, removal capability from the adapter, the `''` baseline scope).
- **Repository:** a fresh scope key on create; `update(…, { rotateTrackingScope })` assigns a new key and makes every earlier row UNTRACKED in the same transaction; `claimNextRun` initialises a legacy null key and adopts the baseline; `recordListingObservations` (one transaction: rows for stored listings, sightings, reappearance, `Opportunity.lastSeenAt`, then MISSING/REMOVED on qualifying runs; nothing if the scope changed mid-run); `listingsForOpportunity`; `remove` counts ledger rows.
- **Worker:** records observations after ingestion; a run qualifies only when the adapter is removal-capable, its coverage is complete, it was not halted, and it was a successful retrieval (Feature 12 sense). Source expiry is read from `expiresAt`/`endDate` metadata. A recording failure is logged and never fails the run.
- **Service:** rotates the scope only when the adapter's scope fields change (a display-only change, such as a Lever or Workday fallback company name or the SmartRecruiters page size, does not).
- **Facts** (`packages/core/src/posting-history.ts`): `derivePostingHistoryFacts`, `listingStatus`, `isNoLongerListed`, `isRecentlyListed`.
- **UI:** a "Posting history" section on the opportunity page; a "No longer listed" dashboard badge (SQL equal to `isNoLongerListed`); an evaluation warning, not a block; "Read the whole list" / "Limited window" and tracked-listing counts in `/sources` run history.
- **No change** to `loadSubject()`, the evaluator, ingestion, `core-dedup-v2` or adapter retrieval behaviour.

**Tests.**

- **Unit:** new `posting-history.test.ts` (18): coverage below/above/equal to a stated total, a missing ID, Greenhouse IDs before the title filter, Lever/Ashby coverage, SmartRecruiters and Workday conditional completeness (cap, halt, shift, unsafe path), the removal-capability matrix, scope fields, every fact rule including the content-only `UNCHANGED_OVER_TIME`, the evaluator-schema contract test, listing status and badge rules, the worker's qualifying decision, and the service's rotation. `retrieval-ui.test.tsx` (+2) covers the section's wording and the badge.
- **Integration:** new `posting-history.test.ts` (8): removal after two complete misses ≥ 24 h apart (not sooner; a total mismatch run ignored), the dashboard badge, no lifecycle change and reappearance; a title change keeping a listing LISTED while `Opportunity.lastSeenAt` moves and `SourceRecord.lastObservedAt` does not; a bounded source never removing; **A → B → A** giving three scope keys with no inherited history; the migration's backfill SQL producing HISTORICAL rows; baseline adoption (seen → LISTED keeping `firstSeenAt`, absent → stays HISTORICAL); baseline UNTRACKED when a scope change comes first; and `loadSubject()` unchanged.
- **E2E:** `retrieval.spec.ts` (+1): a complete Greenhouse fixture board shrinks across two runs a day apart (helper clock), the dashboard shows "No longer listed", the opportunity page shows the history and an evaluation warning with the button still enabled, and the listing is "Listed again" after a later run.

**Verification** (isolated test database only; no live source requests; no AI or provider calls; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 52 files / 1,313 tests; integration 28 files / 251 tests; E2E 37/37; production build succeeds; `pnpm db:verify-migrations` (19 migrations, only the known documented drift; it caught an over-long unique-index name, corrected before closeout, and the test database's copy of the migration was rolled back and re-applied);
- `apps/web/next-env.d.ts` unchanged.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core Platform TDD v1.11:** a §51 "Posting History and Listing Removal (Feature 13)" section (four paragraphs), the sequence and the dependency.
- **Core AI Framework PRD v1.10** and **Customer Success PRD v1.9:** current status, revision history and dependencies.
- **Customer Success TDD v1.9:** status, the §45 and §49 Ghost Job Risk notes annotated, and the dependencies.

The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- The committed Greenhouse fixture states `meta.total` 232 for three jobs, so ordinary fixture runs are (correctly) incomplete; the E2E uses a consistent whole-board variant.
- SmartRecruiters and Workday confirm removal only for employers whose total fits the run's window (500 and 100 postings); larger employers record sightings only.
- `UNCHANGED_OVER_TIME` for SmartRecruiters and Workday advances only when a listing gets one of the 25 detail requests per run.
- Pre-feature-13 listings that are no longer live stay "current status unknown" (HISTORICAL) indefinitely, by design.
- A code change to a configuration-free adapter's fixed query must rotate its sources' scopes explicitly (documented in the adapter contract); no such change exists today.

### Feature 12 — source health and conservative retrieval (committed `f10a02b`, October 18, 2026)

*(Heading updated on October 19, 2026 after the commit; it read "implemented and verified October 18, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved).** Deterministic source health and conservative retrieval around the existing adapters: no adapter or contract redesign, no in-run retries, no automatic disabling, no live source requests and no AI calls. Listing expiry/removal detection moved to feature 13 (DEVELOPMENT_PLAN updated). Out of scope: features 13–15 and evaluator changes.

**Approved decisions.**

- Access, contract, settings and oversized-response failures use long deterministic backoff (at least a day, escalating to at most once per 7 days); no auto-disable and no manual repair step.
- Internal backoff is capped at 7 days. A valid provider Retry-After (429, or 503 with Retry-After) is honoured in full with no cap: the gate is the later of it and the backoff. Invalid, unparsable, zero, negative or past values fall back to the deterministic policy.
- A successful retrieval is COMPLETED, or PARTIAL caused solely by `LISTING_FAILURES`; a PARTIAL caused by a source failure never counts as success or clears the failure state.
- Within a run, any 5xx stops further requests to that host (not only a 503 with Retry-After). Across runs, the first transient failure keeps the normal schedule, repeats escalate, and a valid Retry-After extends the gate.
- A 429 is a rate limit ("Rate limited until …", `SOURCE_RATE_LIMITED`); a 503 with Retry-After is a generic provider wait ("Retry after … (requested by the source)", `SOURCE_PROVIDER_WAIT`). Both are non-bypassable. When our backoff outlasts the source's date, the gate is a provider wait until `retryAfterUntil` and then our backoff, which can be overridden.
- Run now: our own backoff only through an explicit "Run now anyway" (one run; its outcome recalculates the gate). A settings change clears only our own backoff, never a rate limit or provider wait; enable/disable never touches any gate.
- Schema: `RetrievalSource.nextEligibleAt` plus `RetrievalRun.retryAfterUntil` (the flagged, accepted deviation), both nullable; everything else derived from runs. Stale = no successful retrieval for 2× the schedule; disabled/archived sources stay neutral; zero results are informational.

**What changed.**

- **Transport and adapters** (`packages/discovery`): `SERVER_ERROR` for 5xx (`ensureSuccess`); `parseRetryAfter` and `TransportResponse.retryAfterSeconds` (429/503); politeness stops a host after any 5xx and carries Retry-After on the stop error; `isStopError()` used where SmartRecruiters and Workday stop detail requests.
- **Policy** (`packages/core/src/retrieval-health.ts`): `classifyRunOutcome` (success / source failure / neutral / active), `failureStreak`, `computeNextEligibleAt`, `activeGate`/`gateKind` (rate_limited, provider_wait, backoff) and `deriveSourceHealth` (status, streak, last attempt, last success, latest failure, gate, next run, stale, never succeeded, empty result).
- **Migration** `20261018120000_retrieval_source_health`: two nullable `TIMESTAMPTZ(3)` columns, no backfill.
- **Repository:** `finishRun` writes the run (with `retryAfterUntil`) and the gate in one transaction, never shortening a gate still in force after a failure; `enqueueDueRuns` skips gated sources; `enqueueRun(id, trigger, { override, now })` refuses with `SOURCE_RATE_LIMITED`, `SOURCE_PROVIDER_WAIT` or `SOURCE_BACKING_OFF` (with `until`); `update` clears only a backoff gate on a settings change; `healthInputs`.
- **Worker:** passes the failure's `retryAfterSeconds` to `finishRun`; safe message for `SERVER_ERROR`.
- **Service/API:** `health` on every source summary; `runNow(id, { override })`; `POST /api/sources/<id>/runs` takes an optional `{"override": true}`; refusals are 409 with `code` and `until`.
- **UI** (`/sources`): health badge, last attempt, last successful retrieval, next run and why, latest failure, stale/never-succeeded/empty-result notes; Run now disabled with distinct 429 and provider-wait wording; a "Run now anyway" confirmation for backoff.
- **`pnpm app:doctor`:** a read-only "Retrieval source health" check listing enabled sources that are rate limited, waiting, failing, need attention or are stale.
- **No change** to adapter contracts beyond the shared stop rule, ingestion, `core-dedup-v2`, the evaluator or `loadSubject()`.

**Tests.**

- **Unit:** new `retrieval-health.test.ts` (29): outcomes and streaks, every backoff family, uncapped Retry-After, the mixed provider/backoff gate, health statuses (PARTIAL-by-429 not refreshing freshness, neutral runs, disabled/archived neutral, stale, never succeeded, zero results), `parseRetryAfter`, Retry-After on 429/503 only, politeness stopping after any 5xx, `isStopError`, the worker passing Retry-After and the `SERVER_ERROR` message, service and API Run now rules, and the doctor check. `retrieval-ui.test.tsx` (+3): health lines, distinct gate wording with Run now disabled, and the "Run now anyway" confirmation. Adapter tests now cover 500/503 page stops and 5xx detail stops for SmartRecruiters and Workday; the framework test expects `SERVER_ERROR` for 5xx.
- **Integration:** `retrieval-ingestion.test.ts` (+4): a 60-day Retry-After honoured in full (scheduler, override, settings and enable/disable cannot pass it); a 503 provider wait turning into overridable backoff after its date and cleared by a settings change; access-refusal backoff escalating 1 → 2 → 4 days with an override run, a neutral interrupted run ignored and success clearing the gate; and a PARTIAL run stopped by a 429 never counting as a successful retrieval. The existing access/rate-limit test now needs an explicit override for its second run.
- **E2E:** `retrieval.spec.ts` (+1): a fixture 429 with Retry-After shows "Rate limited until …" with Run now disabled and the API refusing even with an override; after the gate expires (helper), a successful run shows Healthy.

**Verification** (isolated test database only; no live source requests; no AI or provider calls; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 51 files / 1,293 tests; integration 27 files / 243 tests; E2E 36/36; production build succeeds; `pnpm db:verify-migrations` (18 migrations, only the known documented drift);
- `pnpm app:doctor` run read-only against the test database (its new queries execute);
- `apps/web/next-env.d.ts` unchanged.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core Platform TDD v1.10:** a §51 "Source Health and Conservative Retrieval (Feature 12)" section (four paragraphs), the sequence and the dependency.
- **Core AI Framework PRD v1.9**, **Customer Success PRD v1.8** and **Customer Success TDD v1.8:** current status, revision history and dependencies.

The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- Health is derived per request from the latest 20 runs and the last successful run; `/sources` reads them per source (fine for the expected handful of sources).
- A settings change is detected by comparing the stored and submitted configuration; the `/sources` UI has no settings editor, so this path is used through `PATCH /api/sources/<id>`.
- The gate is checked when a run is queued, not again when the worker claims it; since a source has at most one queued or running run and the gate changes only when a run finishes, a queued run cannot be overtaken by a new gate.
- Listing expiry/removal detection is feature 13.

### Feature 11B — automated retrieval from the verified public/guest-endpoint and public-HTML sources (committed `2a1d8c2`, October 18, 2026)

*(Heading updated on October 18, 2026 after the commit; it read "implemented and verified October 18, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved).** The remaining non-browser Customer Success sources, on the Feature 11A framework without redesigning it: Workday and Workable (Type #3, public/guest endpoints) and Wellfound (Type #4, public HTML). Welcome to the Jungle / Otta (Type #3) is in scope but could not be verified. ProBlogger and Mediabistro, listed in Core Platform TDD §10, are Freelance Writing domain sources and not part of 11B. Out of scope: features 12–15, evaluator changes, automatic evaluation and description-based discovery.

**Live verification** (each request approved individually; no retries, alternate endpoints or probing; raw responses kept outside Git):

- **Workday** (target `https://workday.wd5.myworkdayjobs.com/Workday`, stateless: no cookies or session values):
  - the career-site document is an application shell whose configuration names `tenant: "workday"`, `siteId: "Workday"`, `appName: "cxs"`;
  - `POST /wday/cxs/workday/Workday/jobs` with `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` returned `{total: 386, jobPostings[20], facets, userAuthenticated: false}`. Each posting has only title, externalPath, locationsText, relative postedOn, remoteType and the requisition;
  - the posting detail `GET /wday/cxs/workday/Workday<externalPath>` returned the complete HTML description, locations, `startDate`, `timeType`, `jobReqId`, `externalUrl` and `hiringOrganization.name`;
  - page 2 (`offset` 20) returned 20 new postings with `total` 0: Workday reports the total on the first page only.
- **Wellfound:** `GET https://wellfound.com/jobs` returned a curated featured-jobs page (no descriptions or paging), so it is not a discovery page. The approved role page `https://wellfound.com/role/customer-success-specialist` returned usable logged-out HTML whose Next.js state holds the results (`totalJobCount` 335, `pageCount` 11, 20 companies per page) and 39 listings with complete descriptions.
- **Workable:** this environment's only request was rate-limited (HTTP 429, `Retry-After` 19517), a network/reputation condition: another network and your local environment reached the same endpoint. Your local verification established the contract: `{title, totalSize: 3156, nextPageToken, jobs[20], autoAppliedFilters}`, page 2 by `pageToken=<nextPageToken>` (20 jobs, same total, no overlap). You supplied both raw pages to this session for the fixture. The official XML feed (`workable.xml`: public, `application/xml`, 849,816,782 bytes, Range ignored; a bounded 256 KB sample held 79 complete job records with full descriptions) was compared and kept as a documented contingency only.
- **Welcome to the Jungle / Otta:** the logged-out search `GET https://www.welcometothejungle.com/en/jobs?query=customer%20success` returned HTTP 200, unblocked, but a sign-up and matching flow: no listings in markup or embedded state, and no anonymous listing endpoint, GraphQL operation, paging, job IDs or fields. Verification stopped there by decision.
- **Offline check:** every adapter maps every item of its full real responses with no contract issues: Workday's 20 postings (with the verified detail), Wellfound's 39 listings and both 20-job Workable pages.

**What changed.**

- **Framework** (`packages/discovery`):
  - a JSON POST transport method (`post`, `postJson`) with the existing ceiling, timeout, User-Agent, no-cookie and no-redirect rules, politeness and status handling; the fixture transport keys POSTs by URL and body (`fixtureRequestKey`);
  - adapter options `minRequestIntervalMs`, `maxPagesPerRun` and `verificationBody`, passed through the worker's transport factory and `pnpm sources:verify`;
  - `prioritizeDetailRequests` moved into `collection.ts` and shared by SmartRecruiters and Workday (unchanged behaviour);
  - `readJsonScript` for embedded JSON state, and `markdownToText` in the normalization package.
- **Workday adapter:** configured by "Career site address" (validated `https://<tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>`; only those hosts) and an optional company name used only when a detail names no hiring organization (then recorded as `sourceConfiguration.company`).
  - Paging by offset up to 5 pages: a bounded window of the first 100 postings the listing endpoint returns. Workday does not state the order (the verified pages looked newest first, which is not relied on). Paging stops on a short page, the first page's total or the cap; a posting shifted between pages is read once.
  - Detail requests for title matches only, at most 25 per run, unseen postings first (among those, later list positions first, as no posting dates are listed); posting paths must be `/job/...` on the same site.
  - Listing ID `<tenant>/<site>:<externalPath>`; `jobReqId` as the requisition; the posting date from `startDate`; Remote/Onsite mapped, Flex kept as source data; pay ranges left in the description; `postedOn`, `timeLeftToApply` and `similarJobs` excluded from change detection (and `similarJobs` not stored).
- **Workable adapter:** no configuration; the search for "customer success"; `pageToken` paging up to 5 pages (a bounded relevance-ordered window, not newest first); the complete text joined from `description`, `requirementsSection` and `benefitsSection`; `TELECOMMUTE` treated as a remote marker, not a place; `workplace` mapped (remote, on_site, hybrid); the `created` date; `updated`, `totalSize`, `nextPageToken` and `autoAppliedFilters` not material.
- **Wellfound adapter:** no configuration; the built-in role page only; the embedded `__NEXT_DATA__` state parsed (a page without it is a contract mismatch, never a guess); `?page=N` up to the verified `pageCount`, capped at 11 pages, at least 2 s apart; no job-page requests; Markdown-style descriptions converted to plain text; duplicate location names removed; only explicit REMOTE/ONSITE kinds mapped; compensation, `atsSource` and remote fields kept as source data; bookmark flags, logo URLs, badges, page position and counts not material.
- **Welcome to the Jungle / Otta adapter:** registered (Type #3, job board), unverified, cannot be enabled; collecting throws a configuration error.
- **Fixtures** (`tests/fixtures/sources/`): `workday/` (page 1, page 2 and the complete detail), `wellfound/` (the role page reduced to its title and embedded state, three listings) and `workable/` (pages 1 and 2, three jobs each), each with `meta.json`: requests, capture times, full-response sizes and SHA-256, "3 of N items", selection reasons and personal-data scans. No sanitization was needed; the Workday detail keeps the employer's published accommodations address.
- **No change** to the schema, migrations, the capture repository, the retrieval worker's ingestion, `core-dedup-v2`, `/sources` UI code, the evaluator or `loadSubject()`.

**Decisions recorded (user-approved).**

- Workday: the target tenant above; tenant/site + externalPath identity; company from the detail with an optional fallback; Flex never hybrid; `startDate` as posting date; no salary from multiple ranges; volatile fields not material.
- Wellfound: the verified role page only (no role-slug field); an 11-page source cap (more is documented partial coverage); a 2-second interval; no detail requests; compensation as source data.
- Workable: the JSON search as the sole production interface, Type #3 unchanged; XML a documented contingency only; no further Claude-cloud retry required.
- Welcome to the Jungle / Otta: registered but unverified for 11B; no per-company reinterpretation; reconsider with feature 14.
- The JSON POST transport extension, because Workday's verified contract requires it.

**Tests.**

- **Unit:** `retrieval-adapters-11b.test.ts` (26): Workday (configuration parsing, mapping, workplace and company rules, tenant-scoped IDs, change detection, path safety, offset paging with the first-page total, detail priority and stops), Workable (mapping, combined text, TELECOMMUTE, token paging, stops, change detection) and Wellfound (state parsing, title filter, paging and cap, contract-mismatch cases, change detection), and Welcome to the Jungle registered but unverified. `retrieval-framework.test.ts` (39) adds the JSON POST, fixture keying, POST politeness, embedded state and Markdown tests; `retrieval-worker-service.test.ts` (13) adds the adapter interval and page cap; `retrieval-adapters.test.ts` (47) is unchanged in count.
- **Integration:** `retrieval-ingestion.test.ts` (16) adds the real Workday, Workable and Wellfound fixtures through the worker: tenant-scoped records with a shared requisition attached, unchanged re-runs despite daily-changing fields, marketplace and job-board provenance, and no evaluation rows.
- **E2E:** `retrieval.spec.ts` (3) adds Workday, Workable and Wellfound sources added and run from `/sources`, "Found via" on the dashboard, provenance on the opportunity page, and Welcome to the Jungle unable to be enabled.

**Verification** (isolated test database only; no paid provider calls; no live production worker; normal application database untouched):

- typecheck and lint clean; `git diff --check` clean;
- unit 50 files / 1,261 tests; integration 27 files / 239 tests; E2E 35/35; production build succeeds;
- `apps/web/next-env.d.ts` reverted after each Next run.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core AI Framework PRD v1.8** and **Customer Success PRD v1.7:** current status and dependencies.
- **Core Platform TDD v1.9:** a §51 "Automated Retrieval: Type #3 and Type #4 Sources (Feature 11B)" summary, the sequence and the dependency.
- **Customer Success TDD v1.7:** the dated §8 implementation note, the sequence and the dependencies.

Each `.docx` passes the validator against its source. The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- **Welcome to the Jungle / Otta** is unverified and cannot be enabled (see above).
- **Coverage windows:** Workday reads the first 100 postings its listing endpoint returns per run (5 pages of 20; the order is not stated), Workable a bounded relevance window (up to 5 pages), Wellfound up to 11 pages (the current page count). Beyond them is out of scope for 11B.
- **Workable rate limiting** depends on the network the worker runs from; a 429 stops the run, and Retry-After/backoff is feature 12.
- **Wellfound** may block non-browser clients in future; a 403 or a page without the verified state stops the run.
- **Test database cluster:** it stopped again after environment restarts and was restarted; one E2E attempt failed only for that reason and passed on rerun.
- **E2E log line:** the full run logged one dev-server "destination stream closed early" message during an evaluation-results test unrelated to retrieval; all tests passed.

### Feature 11A — automated retrieval from the verified official API and feed sources (committed `fad2341`, October 18, 2026)

*(Heading until October 18, 2026: "implemented and verified October 18, 2026; awaiting user review; not committed". The record below is preserved as written.)*

**Scope (approved).** Feature 11 is split into two acceptance units. 11A is the collection framework, the Type #1 adapters, source and run storage, the retrieval worker, normalization of retrieved listings, cross-source deduplication, canonical-link selection, re-observation and change detection, the `/sources` UI and basic politeness and safety. 11B covers the verified Type #3/#4 sources (Workday, Workable, Welcome to the Jungle / Otta, Wellfound). These stay out of 11A: source health, backoff and freshness (feature 12); posting history and Ghost Job Risk input (feature 13); LinkedIn and browser-assisted sources (feature 14); and source-quality analytics (feature 15).

**Live verification** (one approved request per source; no retries, alternative endpoints or probing; raw responses kept outside Git):

- **Network:** the environment allowlist initially blocked every host at the proxy (October 17), so nothing reached a source. After the allowlist was saved, a single Greenhouse canary request succeeded, and then one request was made to each remaining source.
- **Verified:**
  - Greenhouse `gitlab`: 232 jobs, about 3.65 MB.
  - Lever `palantir`: 310 postings, about 6.0 MB.
  - Ashby `ashby`: 63 jobs.
  - Remote OK: 99 jobs plus the API terms notice.
  - We Work Remotely: the customer-support category feed, 61 items.
  - Himalayas: page 1, then one approved page-2 request with the documented `nextCursor`, which confirmed the same contract with no overlap.
  - Working Nomads: 49 jobs.
  - SmartRecruiters: the first target, `Visa`, returned an empty board, so it was stopped. The approved replacement, `BoschGroup` (5,079 postings), was verified with one list request and one detail request. At the closeout check, one further approved request (`?limit=10&offset=10`) verified offset paging: the response echoed offset 10 and limit 10, `totalFound` was unchanged, and its 10 postings did not overlap page 1 and continued page 1's newest-first order. Three of its postings are the page-2 fixture.
- **Offline check:** every adapter maps every item of its full real response with no contract issues, and every listing passes the retrieved-listing normalizer.
- **Fixtures** (`tests/fixtures/sources/<source>/`): at most 3 items per response, structure preserved, with a `meta.json` (request, status, content type, capture time, full-response size and SHA-256, "3 of N items", selection reasons and a personal-data scan).
  - No sanitization was needed. Postings with a named hiring manager (Ashby) or a recruiter `creator` name (SmartRecruiters) were left out.
  - Two organizational contact mentions were kept and recorded: `accommodations@palantir.com` and a `@gong.io` domain.

**What changed.**

- **Collection framework** (`packages/discovery`): the `SourceAdapter` contract, which collects and never judges suitability.
  - **Transport:** injectable, with an identifying User-Agent, a 20 s timeout, a hard 10 MB ceiling (refused, never truncated; raised from 5 MB after the 3.65 MB Greenhouse response), no cookies and no redirects followed.
  - **Politeness:** within a run, requests to a host are serialized at least 1 s apart. A 429 is `RATE_LIMITED` and a 401/403 is `ACCESS_DENIED` (an access failure, not a rate limit); either stops that host for the run.
  - **Other pieces:** credentials redacted from errors and logs, a minimal RSS reader, title-term matching and a content hash.
- **Adapters:** Greenhouse, Lever, Ashby, SmartRecruiters (employer ATS); Remote OK, Himalayas, Working Nomads (aggregators); We Work Remotely (job board). Adzuna is registered, unverified and cannot be enabled. Notable mappings:
  - **Greenhouse:** content arrives HTML-escaped once more; `updated_at` is metadata only.
  - **Lever:** description + lists + additional are joined into one document.
  - **Lever and Ashby:** neither returns an employer name, so "Company name" is a required source field, and field provenance records `sourceConfiguration.company`.
  - **Ashby compensation:** salary is normalized only for a single published tier. Multi-tier and mixed-currency summaries are kept as source data, never normalized.
  - **Remote OK:** salaries carry no currency, so they are source data only. The required attribution links back without `nofollow`.
  - **We Work Remotely:** "Company: Title" is split, and the `guid` is the identity.
  - **Himalayas:** cursor paging up to the page cap. Location and time-zone restrictions are source data only.
  - **Working Nomads:** the identity comes from the URL number.
  - **SmartRecruiters:** the list is paged by offset up to the 5-page cap, so a run sees at most the newest 500 postings (100 per page); older postings are out of scope for 11A. Titles are filtered from the list before any detail request. Details (whose `jobAd.sections` give the full HTML) are capped at 25 per run: postings never stored from the source go first, oldest first, then stored postings, longest since last checked first, so stored postings take turns and never displace unseen ones. A posting shifted onto the next page while paging is read once. Only an explicit remote or hybrid flag sets a workplace type.
- **Discovery terms** (Customer Success domain, CS TDD §6): a listing is kept only when its title contains a core-family name (Customer Success, Client Success, Member Success) or an adjacent term as a whole phrase. The description is never used to keep a listing, and the full description is preserved.
- **Normalization** (`createRetrievedOpportunityNormalizer`): structured facts get DIRECT provenance and text-derived facts DETERMINISTIC. Salary amounts count only as one annual range with a recognized currency. Residency is read only from explicit statements; a time-zone requirement is never inferred. Source items are stored under `rawPayload.source`. *(Superseded in part on October 23, 2026 by the Feature 14B correction: facts the source leaves missing, including an explicit time-zone requirement, are now read from the job text. A time zone is still never inferred from a place.)*
- **Persistence** (migration `20261018090000_retrieval_sources`, additive):
  - `RetrievalSource` and `RetrievalRun`;
  - `SourceRecord` gains retrieval type/category, source and run links, `contentHash` and `previousSourceRecordId`.
  - Foreign keys restrict deletion, so a source or run with records is archived; only a source that never produced anything is deleted.
- **Ingestion** (inside the existing capture transaction and lock):
  - **Same source and listing ID:** an unchanged hash only moves last-seen times. A changed hash adds a linked observation; the original record and the canonical description are left unchanged.
  - **Anything else** goes through the deduplication path.
  - **On an attach,** the application link moves to a strictly higher-precedence source (ATS/careers > job board/marketplace > aggregator) with provenance; a manual link is never replaced.
  - **Hashed fields:** the hash covers material fields only. Fetch times, counters, tracking parameters and source update stamps are not part of it.
- **Deduplication engine `core-dedup-v2`** (approved contract change): source listing IDs are scoped by source, and differing IDs conflict only within one source. Manual-only behavior is unchanged; earlier evidence keeps its v1 label.
- **Worker** (`pnpm worker:retrieval [--once]`): single-worker advisory lock (41220/4), SKIP LOCKED claim with a lease, and startup recovery of interrupted runs.
  - **Detail priority:** adapters get an optional last-checked lookup (`lastCheckedListings`: the latest `lastObservedAt` per source listing ID, scoped to the adapter key), which the SmartRecruiters adapter uses to order its detail requests.
  - **Schedule:** 12-hour default. A newly enabled source that has never run is due at the next poll.
  - **Isolation:** each listing is ingested in its own transaction.
  - **Run results:** `COMPLETED`, `PARTIAL` or `FAILED`, each with a safe error code.
  - **No evaluation:** retrieval never creates an evaluation, admission or deferral.
- **Verification command** (`pnpm sources:verify <adapter> --config '<json>' (--raw-dir <outside repo> | --offline <dir>)`): makes an adapter's single verification request (plus a derived follow-up), saves the raw response outside the repository and checks the mapping offline. It touches no database.
- **UI and API:**
  - **`/sources`:** add, configure, enable, disable, Run now, run history, remove/archive and restore, plus the Sources link in the navigation.
  - **API:** `/api/sources` (`GET`, `POST`); `/api/sources/[id]` (`GET`, `PATCH`, `DELETE`); `/api/sources/[id]/runs` (`GET`, `POST`); `/api/sources/[id]/restore` (`POST`).
  - **Opportunity page:** "Found via …", the retrieval source and run, the attribution link and a "Listing changed since first seen" notice.
  - **Dashboard rows:** "Found via …" and a "Listing changed" badge.
  - **`pnpm app:doctor`:** read-only retrieval checks.
- **Configuration:** `.env.example` documents `RETRIEVAL_WORKER_POLL_MS`, `RETRIEVAL_USER_AGENT`, `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. No new third-party dependency.

**Decisions recorded (user-approved).**

- **Verification targets:** `gitlab`, `palantir`, `ashby`, and `BoschGroup` replacing `Visa`. They serve fixture verification only and are never persistent sources.
- **Schedule and enabling:** 12-hour schedule with every source disabled by default. A source becomes due as soon as it is first enabled. Run now is available only for enabled sources.
- **Limits:** a 10 MB hard response ceiling. Himalayas cursor paging up to the page cap.
- **SmartRecruiters coverage** (closeout check): offset paging up to the existing 5-page cap, and detail-request priority within the existing 25-request cap (unseen postings first, oldest first; then stored postings by oldest last check). Neither cap was raised. Coverage is bounded to the newest 500 postings visible through the verified list interface per run.
- **Company name and compensation:** a required company-name field for Lever and Ashby; the conservative Ashby compensation rule.
- **Adzuna:** stays unverified and disabled. The excerpt-only description is an open issue, not a reason to weaken the complete-description contract.

**Tests.**

- **Unit:**
  - `retrieval-framework.test.ts` (34): HTML-to-text, title terms, RSS, the content-hash cases (volatile metadata gives no change, description and structured-field changes do, identical content is idempotent), transport classification, the 10 MB ceiling, politeness, the normalizer, scoped IDs and link precedence.
  - `retrieval-adapters.test.ts` (47): every verified adapter against its fixture, including Himalayas page 2 and the SmartRecruiters detail; SmartRecruiters offset paging against the verified page 2 (page cap, short or empty page, `totalFound`, a shifted posting read once, a 429/401/403 on a later page stopping everything, another later-page failure keeping what was read); and detail priority (unseen before stored, oldest unseen first, stored by oldest last check, rotation, the cap always respected).
  - `retrieval-worker-service.test.ts` (12), including a 401 run outcome and the last-checked lookup scoped to the adapter key, and `retrieval-ui.test.tsx` (8); a Sources entry in the navigation test.
- **Integration:** `retrieval-ingestion.test.ts` (13) on the isolated test database, covering:
  - the first run, idempotent reruns and volatile-only changes;
  - linked changed observations;
  - cross-source attach with the link upgrade, and a manual link never replaced;
  - probable matches and scoped IDs;
  - per-listing failure isolation;
  - access versus rate-limit failures;
  - the real Greenhouse fixture through the worker;
  - SmartRecruiters detail priority through the worker and repository over seven runs: unseen postings first (oldest first), stored postings rotating by last check, and a new posting going ahead of every stored one;
  - one active run per source and a single claim;
  - scheduling and archive-instead-of-delete;
  - no evaluation rows ever created.
- **E2E:** `retrieval.spec.ts` (2): add Greenhouse on `/sources`, enable it, Run now, check the run history, "Found via Greenhouse" on the dashboard and provenance on the opportunity page; then a changed listing flagged on both, and archiving a source with history.

**Verification** (isolated test database only; no paid provider calls; no live production retrieval worker; no normal application database in this environment):

- typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 17/17 (only the documented drift);
- unit 49 files / 1,218 tests; integration 27 files / 235 tests; E2E 34/34 across all five projects; production build succeeds; `git diff --check` clean;
- `pnpm app:doctor`: no blocking problems; the retrieval checks are read-only.
- **Fixture-transport browser walkthrough:**
  - all eight sources were added, enabled and run from `/sources`: 7 listings created, the counts shown in run history, and dashboard rows showing "Found via".
  - The Greenhouse provenance, the Remote OK attribution link (followed, no `nofollow`) and a changed-listing notice were all shown.
  - At 390 px, `/sources`, the opportunity page and the dashboard measure 390 px wide.

**Versioned specifications.** New versions were built from the current ones, and the previous versions moved unchanged into `Archive/` (the blobs match `HEAD`):

- **Core AI Framework PRD v1.7:** §31 status and planned work.
- **Customer Success PRD v1.6:** §23 status, the implemented employer-ATS link preference, and the dependency.
- **Core Platform TDD v1.8:**
  - a §51 "Automated Retrieval (Feature 11A)" summary, including the SmartRecruiters 500-posting window and detail-request priority;
  - the `core-dedup-v2` wording;
  - the merging and cross-source sentences;
  - the sequence and the dependency.
- **Customer Success TDD v1.6:**
  - dated implementation notes in §6–§8: the title-matching rule; title-only discovery, so the semantic and responsibility-based discovery of §7 is not implemented at discovery time; and the implemented sources;
  - a §49 paragraph on retrieved opportunities and the unchanged evaluator;
  - the planned work and the dependencies.

Each `.docx` passes the validator against its source, and the text comparison shows only these changes. The Semantic Evaluation Playbook is unchanged.

**Known issues and observations.**

- **Adzuna** is unverified (no credentials), and its description is excerpt-only.
- **Pagination:** SmartRecruiters coverage is bounded to the newest 500 postings visible through its list per run (5 pages of 100); postings outside that window are out of scope for 11A. Within it, up to 25 details per run, so a burst of matches takes several runs to work through. Remote OK, Working Nomads, We Work Remotely, Greenhouse, Lever and Ashby return their whole feed or board in one response.
- **Description-only roles:** a listing whose title has no role-family term is not retrieved even when its description is Customer Success work (CS TDD §7, by decision).
- **Retrieval is exercised only with the fixture transport.** It has never run live against real sources, and no production worker has been run.
- **Test database cluster:** it stopped several times when the environment restarted, and was restarted each time; no data was lost.
- **Date dependence:** one integration test assumed the real date was earlier than its fixed test clock, and is now direction-independent.
- **pg warning:** the pg "client.query() when the client is already executing a query" warning still appears in integration and E2E runs. It is pre-existing (see the gap-closure record); the retrieval tests produce none.


### Features 1–10 Gap Closure (committed `d573acf`, October 17, 2026)

*(Heading until October 18, 2026: "implemented and verified October 17, 2026; implementation and verification approved by the user; awaiting the commit approval". The record below is preserved as written.)*

**Audit (read-only, approved October 17, 2026).** Features 1–10 were checked against Core AI Framework PRD v1.5, Core Platform TDD v1.6, Customer Success PRD v1.4 and Customer Success TDD v1.4, in code, with targeted tests and in a browser walkthrough on the isolated test database.

- Complete: feature 1 (dashboard), feature 4 (application tracker), feature 5 (saved/rejected/archived), feature 8 (source/provenance, for manual capture) and feature 10 (backlog and budget-aware evaluation).
- Gaps found and approved for closure:
  - **G1**, feature 9: deduplication was missing. The package was an interface stub and `DuplicateReference` was unused, so an identical re-capture became a second opportunity that could be evaluated, and paid for, again.
  - **G2/G3**, features 2 and 8: every capture created its own `Company` row and `normalizedName` was never filled. The company filter therefore listed one company once per opportunity, and choosing one entry showed one job.
  - **G4**, feature 3: history rows did not show the versions behind each evaluation.
  - **G5**, feature 6: the time-zone requirement could never be anything but Unknown.
  - **G6**, feature 7: AI usage and spend were not broken down by domain and job source (Core PRD §20, Core TDD §38).
  - **G7**: horizontal overflow at phone width on the opportunity page and `/profile`.
- Boundaries accepted:
  - to feature 11: structured location, posting history, retrieval/source-specific metadata, cross-source deduplication and the merging of opportunities that already have history;
  - to features 15–17: the analytics event stream and opportunity-view events;
  - evaluator-internal changes: out of scope, recorded only.

**What changed.**

- **Deduplication engine** (`packages/deduplication`, version `core-dedup-v1`). Pure and deterministic; it holds no product data.
  - **MATCH:** the same listing URL with nothing conflicting, or the same source job or requisition ID at the same company. URL keys ignore case, `www.`, trailing slashes, tracking parameters and parameter order. A shared URL with a different title, company or job ID drops to a probable match.
  - **PROBABLE_MATCH:** the same normalized company, scored as 0.5 × title + 0.2 × location + 0.3 × description token similarity, minus 0.1 for non-overlapping salary ranges in one currency; threshold 0.6. A shared ID without both companies known also counts.
  - **Canonical opportunity:** the earliest-seen exact match.
- **Capture.**
  - **Transaction:** normalization runs in memory first. One transaction then holds a capture advisory lock and writes the raw `SourceRecord` first, then the duplicate decision and either a new `NORMALIZED` opportunity (with field provenance and any duplicate references) or the attachment of that `SourceRecord` to the existing opportunity.
  - **On failure:** a failure rolls back everything, so nothing is half-processed or orphaned. A capture whose normalization fails still preserves its raw `SourceRecord` unlinked, as before (Core TDD §11).
  - **Exact duplicates are attached by default.** The canonical opportunity's fields, lifecycle, evaluations and application do not change; only `lastSeenAt` moves. `POST /api/opportunities` returns 200 with that opportunity.
  - **The form asks first,** through the read-only `POST /api/opportunities/duplicate-check`. "Save as a separate opportunity" creates the opportunity and records the pair as `DISTINCT`.
  - **Probable matches** create the opportunity and record up to three warnings. Nothing is ever merged on a probable match.
- **Company reuse.** A capture links to the oldest company with the same normalized name. Companies that have not been backfilled are compared without being changed. Stored names are never rewritten; the spelling the user typed stays in `SourceRecord.rawCompany` and the `company.name` field provenance.
  - Normalization ignores case, width, punctuation, `&` and one recognized trailing legal-entity suffix (Inc, LLC, Ltd, Limited, Corp, Corporation, GmbH, PLC, LLP, LP, AG, SA, BV, NV, Pty Ltd, Pvt Ltd, Private Limited). Business words are never removed.
- **Dashboard company filter.** There is one entry per normalized company, with the combined count; orphan companies are excluded. The `company=` parameter takes the normalized name. An older company-id link selects that company's whole group, and a company not yet backfilled still filters by its id.
- **Backfill.** `pnpm db:backfill-dedup [--dry-run]` is explicit, additive and idempotent.
  - It fills only empty `Company.normalizedName` values and records missing `DuplicateReference` rows among existing opportunities.
  - It never renames, merges, deletes or re-links anything, and never changes an existing relationship.
  - It is not part of `pnpm app:setup`. `pnpm app:doctor` stays read-only and reports how many companies still need it.
  - Orphan companies (left only by test cleanup; the product has no delete path) are kept, excluded from views, and reused by later captures.
- **Duplicate-spend guard** (feature 10, Core TDD §33). A paid evaluation request, or a deferred resume, is refused with 409 `DUPLICATE_LISTING_ALREADY_EVALUATED` when all of the following hold:
  - the opportunity has never completed an evaluation;
  - an unresolved exact duplicate (detected live, or stored and not `DISTINCT`) already has a completed, queued or running evaluation, a live admission or an open deferred request.

  Behavior around the guard:
  - A refused resume leaves the deferral open and writes nothing.
  - Probable matches and pairs marked `DISTINCT` are never blocked, and an opportunity's own reevaluation is never blocked.
  - **The race is closed:** the check and the admission, evaluation or deferral it allows run under a session advisory lock on a dedicated connection (`withDuplicateSpendLock`). The Task 6 admission gate is unchanged. Without the lock, a test of simultaneous requests for two duplicates admitted both; with it, exactly one is admitted in every round.
  - The existing stale-state checks (archived or closed, missing pinned profile, already active) are unchanged.
- **"Not the same job" is reversible.** `POST /api/opportunities/[id]/duplicates` sets `DuplicateReference.resolution` to `DISTINCT` or clears it (Undo). A detected pair without a stored row is stored with the engine's decision.
- **UI.**
  - the capture form's match panel;
  - a "Duplicates" section on the opportunity page (the attached-capture notice, exact and probable duplicates, "Not the same job" and Undo);
  - attached sources labelled under "Source records";
  - "Duplicate listing" and "Possible duplicate" dashboard badges.
- **G4.** Each history row shows "Profile vN · Evaluation … · Prompt …", from fields the API already returned. No comparison view was built.
- **G5.** Optional "Time-zone requirements" field, recorded only as stated (DIRECT provenance; never read from the job text). It is added to `fieldsWithheldFromEvaluator`, so the evaluator's input is unchanged.
- **G6.** `/budget` adds "Usage and spend by domain and source" for the budget period (domain × source type × job source): evaluations, attempts, provider-reported tokens with unreported attempts counted, known spend in the report currency, and attempts whose cost is unknown or in another currency. Per-evaluation operation usage is unchanged; no operation/model analytics were added.
- **G7.** The audit attributed the opportunity-page overflow to the usage table. The actual causes were these, and both are now fixed:
  - **opportunity page:** long unbroken listing URLs in the provenance lists, which now wrap;
  - **`/profile`:** an absolutely positioned visually-hidden label escaping the table's scroll container, which is now contained.

  Every main page measures 390 px wide at a 390 px viewport, with all sections expanded.
- **Migration.** `20261017120000_deduplication`, additive only: enum `DuplicateResolution`, `DuplicateReference.resolution`/`resolvedAt`, `SourceRecord.duplicateDecision`/`duplicateEvidence`. The known `Recommendation.evidenceReferences` drift is excluded.
- **Shared-boundary impact** (recorded in `HANDOFFS.md` for the Codex review at final integration):
  - the core `ManualOpportunityRepository` port;
  - `loadSubject()` may now return attached duplicate sources after the original one;
  - `fieldsWithheldFromEvaluator` gains `timeZoneRequirements`;
  - reused companies give the evaluator the stored company spelling;
  - the new request/resume refusal.

**Tests.**

- **Unit:**
  - `deduplication-engine.test.ts` (21), `deduplication-ui.test.tsx` (11) and `gap-closure-ui.test.tsx` (3);
  - additions to `manual-opportunity.test.ts`, `opportunity-normalization.test.ts` and `worker-operations.test.ts`;
  - repository fakes updated to the new port.
- **Integration:**
  - `deduplication-capture.test.ts` (12);
  - `deduplication-backfill.test.ts` (7, including the company filter);
  - `duplicate-spend-guard.test.ts` (9, including the race);
  - `time-zone-requirement.test.ts` (2) and `usage-breakdown.test.ts` (1).
- **E2E:**
  - `deduplication.spec.ts` (4);
  - a 390 px `/profile` check in `profile-management.spec.ts`;
  - a history-version assertion in `golden-path.spec.ts`.
- **Fixture updates:** fixed listing URLs in `opportunity-dashboard.spec.ts` now carry a per-run token, and two fixtures were updated to the grouped company-option shape.

**Verification** (isolated test database only; no paid provider calls; no live worker; no normal application database exists in this environment):

- typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 16/16 (only the documented drift);
- unit 45 files / 1,128 tests; integration 26 files / 223 tests; E2E 32/32 across all five projects; production build succeeds; `git diff --check` clean;
- `pnpm db:backfill-dedup`: the dry run wrote nothing, the first run filled the seeded companies and the second changed nothing. `pnpm app:doctor` reported no blocking problems.
- A browser walkthrough repeated the audit scenario: the re-capture opened the original opportunity, the company group listed three opportunities, history showed versions, and `/budget` showed the breakdown.

**Versioned specifications** (checked after verification, as the workflow requires). The implementation made their current-status sections stale, so new versions were built from the current ones; only status, revision history, metadata and dependency lines changed.

- **Core AI Framework PRD v1.6:** §31 records deduplication with provenance retention; the requirements are unchanged.
- **Customer Success AI Assistant PRD v1.5:** §23 records duplicate detection; depends on Core PRD v1.6.
- **Core Platform TDD v1.7:** §51 gains a "Deduplication and Provenance Retention" summary, plus the stated time-zone rule and usage by domain and source; depends on Core PRD v1.6.
  - After review, a substantive-spec check confirmed §51 also documents: the reversible "not the same job" decision for any detected pair; that existing opportunities with history are never merged retroactively; the attached source record's provenance; the explicit, idempotent backfill outside setup; the duplicate recheck alongside the existing release rechecks; and the lock that prevents duplicate paid admission.
- **Customer Success Assistant TDD v1.5:** §49 status, the attached-source note and the withheld time-zone field; §40 now lists the user-stated time-zone requirement beside the other withheld evaluator-input fields; updated dependencies.
- The previous versions (PRD v1.5 and v1.4, TDD v1.6 and v1.4) moved unchanged into the `Archive/` folders; the blobs are identical.
- Each new `.docx` passes the docx validator against its source, and a text comparison shows only the intended changes.
- The Semantic Evaluation Playbook is unchanged (no evaluator semantics changed).
- `AGENTS.md` and `CLAUDE.md` point to the new versions.

**Known issues and observations.**

- A pg deprecation warning ("client.query() when the client is already executing a query") appears once per E2E web-server run. It was traced to Prisma's query interpreter inside existing application-tracker transactions: `applications.spec.ts` alone produces it. It is not caused by this work; the two new in-transaction parallel reads were made sequential. It is harmless today; it matters only for a future pg 9 upgrade.
- The new E2E spec bundles its helper per Playwright worker. The existing specs' shared-bundle race (noted in the Task 8 record) is unchanged.
- The duplicate-spend lock holds only while its dedicated connection stays up, like the single-worker lock.


### Post-Task-9 versioned-document update (committed October 16, 2026)

The specification update deferred until Task 9 closed. Planned, reviewed and approved before editing. Documentation only: no code, test, schema or database change, and no provider calls.

- **New current versions:** Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3.
  - Each new PRD/TDD was built from its previous current version. Each adds a newest-first revision-history entry and keeps every earlier entry and all other content unchanged.
  - The previous current versions (Core AI Framework PRD v1.4, Customer Success AI Assistant PRD v1.3, Core Platform TDD v1.5, Customer Success Assistant TDD v1.3) moved unchanged into the `Archive/` folders.
  - Playbook v1.2 and v1.1 stay unchanged beside v1.3.
- **Core AI Framework PRD v1.5:** §31 status and planned work after the Task 1–9 completion pass; a note on the evaluator-branch semantic-contract repairs.
- **Customer Success PRD v1.4:** §23 status; an evaluator-branch contract note; dependency on Core AI Framework PRD v1.5.
- **Core Platform TDD v1.6:**
  - the `USAGE_LIMIT_REACHED` deferral reason and the legacy `BUDGET_UNAVAILABLE` → `AI_BUDGET_LIMIT` mapping (§33, §38, §39 and their tests);
  - "eligible-for-evaluation" in place of the last "model-eligible";
  - §51 "Application Tracker" and "Operations and Worker Model" status subsections;
  - the updated sequence and the dependency on Core AI Framework PRD v1.5.
- **Customer Success TDD v1.4:** a §49 per-branch contract-version table and the October 10–13 evaluator-branch rules, marked effective at final integration. The evaluation design body sections are unchanged until final integration.
- **Semantic Evaluation Playbook v1.3:** keeps all of v1.2 and adds §14 (semantic closure, structured authority, deterministic reconciliation, evidence and gap rules, Unknown behavior, fail-closed prerequisites, replay methodology, residual risks, outstanding verification), plus dated notes in §11 and §13. Every §14 rule was checked against the evaluator branch's code.
- **References and status:** `AGENTS.md` and `CLAUDE.md` spec paths; `EVALUATOR_STATUS.md` pointer to Playbook v1.3; current-state documents now show the features 1–10 gap audit as next; a `CHANGELOG.md` entry.
- **Verification:**
  - each new `.docx` passes schema validation against its source;
  - a text comparison against each source shows only the intended changes;
  - archived and historical versions are byte-identical to their committed blobs;
  - no code or test file changed; `git diff --check` is clean.

### Claude Task 9 — Operations hardening completion pass (committed October 16, 2026)

**Status (October 16, 2026):** reviewed, approved and committed as `feat: complete operational hardening`, pushed to `origin/claude/gallant-pasteur-y1ou3i`. The audit, changes and verification are recorded under "Completed — Task 9 completion pass" below.

*(Status earlier on October 16, 2026: "open. Planned and approved, implemented, and verified offline on the isolated test database. The documentation synchronization is done and awaiting user review. It closes with the review and then the checkpoint commit. Not committed or pushed yet.")*

The pass audited the October 10 Task 9 operations work and added only what was missing:

- error-name-only logging in the opportunity API routes;
- `pnpm app:doctor` reporting budget deferrals and usage-limit deferrals separately;
- health-endpoint failure tests;
- a deterministic, non-live AI credential for every E2E run;
- documentation of the single-worker lock's connection-loss caveat.

It added no migration and changed no queue, worker, lease or evaluator code.

### Claude Task 8 — Application Tracker completion pass (committed `534a4c7`, October 16, 2026)

**Status (October 16, 2026):** reviewed and committed as `534a4c7` (`feat: complete application tracker`), pushed to `origin/claude/gallant-pasteur-y1ou3i`. The audit, changes and verification are recorded under "Completed — Task 8 completion pass" below.

*(Status on October 15, 2026: "implemented and verified offline; awaiting user review, then the checkpoint commit.")*

The pass audited the existing tracker against current requirements and added only missing/incomplete behavior.

Focus areas:

- persistent application state/stage;
- application and follow-up dates;
- notes;
- contacts/interviews where already part of the established design;
- outcomes;
- next action and due/overdue/due-today visibility;
- `/applications` usability;
- guarded lifecycle interaction;
- stale-write/concurrency behavior;
- persistence across refresh/restart;
- application data surviving reevaluation unchanged.

Do not add push/email/browser notifications, calendar integration, email integration, or evaluator redesign as part of Task 8.


### Documentation preservation and correction pass (October 15, 2026)

- Reconciled the October 15 project documents preserve-first.
- Completed a repository-wide documentation preservation audit (five revisions).
- Recovered the full formal PRD/TDD history:
  - 23 versions, placed under `Archive/` folders, plus Core AI Framework PRD v1.4;
  - Core Platform TDD v1.0 and v1.1 confirmed as separate versions.
- Corrected stale current-state documents:
  - `AGENT_WORKSTREAMS.md`, both READMEs, `AI_Architecture_README.md` (restored Windows/WSL environment lessons), `EVALUATOR_STATUS.md` (§19 addendum), `HANDOFFS.md` (integration and preservation notes), `AGENTS.md` (version retention);
  - Semantic Evaluation Playbook v1.2.
- No application, evaluator, schema or database changes.

### Profile and policy readiness

- Product-side profile limitations persistence and transport completed.
- Active-profile resolution and pinned-version behavior clarified.
- Policy/version override diagnostics and stale-environment warnings added.
- Final integration still must verify the stored limitation → deterministic Genuine Gap path after branch combination.

Detailed records: "Profile limitations persistence" and "Policy and profile integration readiness" below.

### Task 6 — AI budget and usage controls

- Persistent monthly budget ledger.
- Atomic reservation/reconciliation.
- Warning thresholds.
- Daily/weekly evaluation limits.
- Monthly output-token limit.
- Per-evaluation call limit within the system maximum.
- Budget/usage/capacity reporting.
- Persistent budget deferral, resume, and cancel behavior.
- `AI_BUDGET_LIMIT` for dollar-budget deferral.
- `USAGE_LIMIT_REACHED` for throughput/token limits.
- Unknown provider usage remains Unknown.
- Accepted decision: already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered.
- Completion checkpoints: `267138a`, `8d3993a`.

Detailed records: "Task 6 completion" and "Task 6 naming cleanup" below.

### Task 7 — normalized opportunity facts and dashboard completion

Final commit: `754f956dc0860149760936a61bdace0489404b9a` on `claude/gallant-pasteur-y1ou3i`.

Completed:

- salary minimum/maximum and currency normalization;
- open-range/single-value salary handling;
- bare-`$` USD provenance marker;
- work arrangement, seniority, department, employment type, and closing-date normalization;
- residency requirement and residency-region normalization across countries, U.S. subdivisions, Canadian subdivisions, UK nations, and broad regions;
- explicit precedence/provenance rules;
- numeric salary filters/sort and additional dashboard filters;
- compatibility for older records without backfilling Unknown facts.

*(Restoration note, October 23, 2026: Task 7 read these facts only from structured or dedicated fields and never from the job text. That narrowed the broader Core requirement in Core Platform TDD §51, "when deterministic source evidence supports them". The Feature 14B correction restores it with the shared job-text fallback. It also replaces the unconditional bare-"$" USD rule with "USD only with clear U.S. evidence". This record is kept as written.)*

Task 7 verification passed typecheck/lint/Prisma, 1036 unit tests, 176 integration tests, 25 E2E tests, and build using only the isolated test database.

Detailed record: "Task 7 completion amendment" below.

### Customer Success Milestone 4 — Task 7 salary-policy alignment

Commit: `267124f fix(cs): align Milestone 4 salary policy with Task 7` on `codex/evaluator-live-diagnostic`, pushed to origin.

**Branch state:** this commit is on the Codex evaluator branch and is **not merged** into `main` or `claude/gallant-pasteur-y1ou3i`. On `claude/gallant-pasteur-y1ou3i`, `fieldsWithheldFromEvaluator` still withholds all ten Task 7 fields, and the earlier version identifiers remain. The release is reconciled at final branch combination (see the October 15 addenda in `HANDOFFS.md`).

Completed (on `codex/evaluator-live-diagnostic`):

- currency- and residency-aware deterministic salary Hard Filter;
- U.S. hard minimum of `$60,000 USD-equivalent` with no Review band;
- non-U.S. `$60k+` Pass, `$55k–$59,999.99` Review, `$50k–$54,999.99` conditional Review/Unknown, `<$50k` Fail/Skip;
- versioned FX policy `cs-salary-policy-v2-ecb-2026-10-14`;
- disclosed-minimum gate and max-only conservative handling;
- evaluator release of salary min/max, currency, residency requirement, and residency regions with provenance;
- preservation of Customer Success policy inside the domain rather than Core.

Focused offline verification passed. Broader DB-backed integration, E2E, build, live provider calls, and final acceptance were intentionally deferred.

## Completed

### Product Foundation

- Core AI Framework defined.
- Core Platform architecture defined.
- Customer Success product requirements defined.
- Customer Success technical design defined.
- Semantic Evaluation Implementation Playbook established and updated.

### Platform / Product

- Manual opportunity ingestion.
- PostgreSQL persistence.
- Shared ordered evaluation framework.
- Background evaluation processing.
- Evaluation history.
- Persisted recommendation flow.
- Customer Success results UI.
- Evidence display.
- Unknown and contradiction display.
- Safe untrusted-text rendering.
- Bounded evaluation polling.
- Polling cleanup when leaving the page.
- Recommendation is read from persisted results rather than recalculated in the browser.
- Opportunity dashboard with search, filters, sorting, pagination and summaries (Task 7).
- Opportunity lifecycle and user actions with guarded transitions.
- Profile and preferences management with explicit active versions and structured limitations (Task 5 and the limitations persistence).
- AI budget ledger, deferral, throughput limits, capacity and backlog reporting (Task 6).
- Application tracker (Task 8, including the October 15–16 completion pass).
- Setup, operations hardening, single-worker evaluation processing and whole-product acceptance tests (Task 9, including the October 16 completion pass).

Details for each are in the task records under "Main Product" below.

### Evaluator

- Full Customer Success evaluation foundation.
- Hard Filters.
- JD Reconstruction.
- Job Evaluation.
- Company Alignment.
- Organizational Maturity.
- Alex Fit.
- Burnout Risk.
- Resume Match.
- Effective Seniority.
- Opportunity Priority.
- Ghost Job Risk fallback behavior.
- Deterministic Final Recommendation.
- Semantic-operation usage/cost accounting.
- Restart-safe per-evaluation semantic-call budgeting.
- Per-operation model routing.
- Accepted mixed Terra/Luna routing.
- Resume Match optimization #1.
- JD Reconstruction optimization #1.
- Resume Match optimization #2 (accepted Resume Match baseline).
- JD Reconstruction optimization #2 evaluated and rejected (its v6 and v7 candidates; State2 from optimization #1 retained).
- Final model-routing lock (October 15, 2026; see below).
- Milestone 4 salary-policy alignment with the Task 7 contract (on `codex/evaluator-live-diagnostic`; not merged).
- Evaluator semantic-contract repairs, October 10–13 (on `codex/evaluator-live-diagnostic`; not merged; see below).

#### Evaluator-branch progress (October 10–15, 2026; `codex/evaluator-live-diagnostic`, not merged)

These records come from the evaluator branch's own `Md and README Docs/CURRENT_PROGRESS.md` and its commits. The full records are carried into this document at final branch combination (`HANDOFFS.md`, October 15 annotations). Contract details, residual risks and outstanding verification are in `EVALUATOR_STATUS.md` §20.

- **Organizational Maturity mixed-state stabilization** (October 10): two over-broad guards corrected; preserved outputs replayed offline.
- **Resume Match evidence-partition stabilization** (October 11): one single-purpose evidence assignment collection; fail-closed integrity checks kept.
- **Provider-prose semantic closure** (October 11; `04611af`, `1c09924`): provider prose became display-only. Genuine Gap proof moved to a structured `gapEvidence` collection. A static guard pins the remaining text dependencies.
- **Structured requirement specialization and real-artifact replay** (October 11; `1c09924`, `cs-jd-reconstruction-v4`): preserved live request/response pairs are replayed offline from outside the repository.
- **JD Reconstruction specialization category binding** (October 12; `7149563`, `cs-jd-reconstruction-v5`).
- **Requirement-relative evidence relevance** (October 12; `f29530c`, `cs-jd-reconstruction-v6`, `cs-resume-match-v3`):
  - EXPERIENCE requirements get ladder levels;
  - structured profile limitations become the only gap proof;
  - Resume Match fails closed with `RESUME_MATCH_PREREQUISITE_OUTDATED` on an outdated map.
- **Statement groups, reconciliation and requirement-relative INDUSTRY** (October 13; `067c5dc`, `cs-jd-reconstruction-v7`, `cs-resume-match-v4`):
  - structured `requirementStatements`;
  - deterministic reconciliation of statement quotes against deterministic requirement lines;
  - INDUSTRY matches only from actual work experience;
  - Unknown without supported or unsupported portions.
  - The branch record calls this work "uncommitted pending review", but Git shows commit `067c5dc` on October 13.
- **Milestone 4 salary-policy contract update** (October 15; `267124f`).

## Current Accepted Model Routing

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

The routing policy is locked. A GPT-6 Luna Job Evaluation benchmark was rejected because it regressed Strategic Bridge Value and omitted established evidence. Remaining GPT-6 benchmarks were intentionally skipped by product decision.

**Branch state:** the GPT-6 Luna routing for Company Alignment and Burnout Risk is implemented on `codex/evaluator-live-diagnostic`. `claude/gallant-pasteur-y1ou3i` still carries the earlier accepted routing (GPT-5.6 Luna for both operations) until final branch combination. Routing is an execution detail and does not change product semantics.

## In Progress

### Main-product tasks

Feature 15 (Source Intelligence) is complete (accepted October 31, 2026). Feature 14 is complete (14A `dd77d29`, accepted October 20, 2026; 14B accepted October 29, 2026, `2ccdc7f`). Features 16–18 follow.

*(Earlier status, superseded October 31, 2026: "Feature 14B (the browser-extension companion) is implemented and verified (October 20, 2026) and awaits Alex's review and local acceptance; it is not committed. … Features 15–18 follow 14B.")*

*(Earlier status, superseded on October 20, 2026: "Feature 14 (browser-assisted LinkedIn retrieval and source corrections) is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `dd77d29` and accepted.)*

*(Earlier status, superseded on October 19, 2026: "Feature 13 (posting history and listing removal) is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `d1bf217`.)*

*(Earlier status, superseded on October 19, 2026: "Feature 12 (source health and conservative retrieval) is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `f10a02b`.)*

*(Earlier status, superseded on October 18, 2026: "Feature 11A is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." Feature 11A was committed as `fad2341` and Feature 11B as `2a1d8c2`.)*

*(Earlier status, superseded on October 18, 2026: "The Features 1–10 Gap Closure is implemented and verified and awaiting user review (see \"Recently Completed\"). It is not committed." It was committed as `d573acf`.)*

*(Earlier status, superseded on October 17, 2026: "No main-product implementation task is open. Task 9 and the post-Task-9 versioned-document update are complete (see "Recently Completed"). Next is the audit of any remaining gaps in main-product features 1–10.")*

### Evaluator

The earlier accepted sequence (JD Reconstruction optimization #2 → Resume Match optimization #2 → combined-path integration → final mixed-model evaluation) has been worked through: Resume Match optimization #2 was accepted, JD Reconstruction State2 was retained, and the routing was locked on October 15, 2026 (Codex workstream, `codex/evaluator-live-diagnostic`). The final live / whole-product evaluation is deferred to the final integration pass after main-product features 1–18 are complete.

Outstanding evaluator items (October 16, 2026) — none of them is authorized to run now:

- the final paid acceptance run of the integrated evaluator;
- measurement of the current-contract cost (`cs-jd-reconstruction-v7`, `cs-resume-match-v4`, with the GPT-6 Luna routes);
- the replay items recorded on the evaluator branch.

See "Evaluator-branch progress" below and `EVALUATOR_STATUS.md` §20.

### Main Product

Remaining non-evaluator product work is being completed in parallel by Claude. The task records below are cumulative and preserved as written; earlier records describe the state at their own date.

#### Completed — Opportunity dashboard and Domain default (October 6, 2026)

- `GET /api/opportunities`: read-only, newest-first list of persisted opportunities with their latest evaluation (task status and persisted decision). Bounded by `limit` (default 100, max 200); an invalid query returns 400.
- `/` is now a dashboard of opportunities with an empty state. Manual entry moved to `/opportunities/new`. The detail page links back to the dashboard.
- The manual-entry Domain field is now a select defaulting to `customer-success`. Previously a blank domain made the opportunity impossible to evaluate.
- The dashboard uses its own domain-neutral display helpers (`apps/web/src/components/dashboard/`). It does not import the evaluation/Customer Success result UI and does not recalculate or restyle recommendations.
- No changes to evaluator internals, schemas, routing, worker/queue behavior, or recommendation logic.
- Tests added:
  - `tests/unit/opportunity-dashboard.test.tsx`
  - `tests/integration/opportunity-list.test.ts`
  - `tests/e2e/opportunity-dashboard.spec.ts`
  - `tests/e2e/app-shell.spec.ts` updated.

#### Completed — Evaluation-experience correctness (October 6, 2026)

- **Failed latest evaluation.** When the latest evaluation failed, the page shows the most recent completed evaluation from history, labeled as such. Otherwise it accurately says whether earlier results exist. The latest status still drives the controls.
- **Safe failure details.** The persisted failure code is shown (only if it is a well-formed identifier) with a mapped user-facing message. The stored error message is never rendered, because it can contain internal validation/provider detail.
- **Per-field validation errors.** Manual entry shows server validation errors next to each field (`aria-invalid` + `aria-describedby`). Unmatched issues stay form-level.
- **Keep checking.** A "Keep checking" control appears whenever status polling stops, whether at the polling cap or after a failed refresh, and restarts bounded polling.
- **Stalled-queue notice.** If an evaluation stays queued for more than 60 seconds, a notice says the worker may not be running (`pnpm worker:evaluations`).
- **Clickable URLs.** Source and application URLs are links that open in a new tab (`noopener noreferrer`). Only http(s) URLs become links; anything else stays plain text.
- UI and product-service code only. No evaluator, schema, routing, worker, or recommendation changes. Nothing is recalculated in the browser.
- Tests:
  - `tests/unit/evaluation-experience-correctness.test.tsx` (new);
  - poller cap/restart case in `tests/unit/evaluation-poller.test.ts`;
  - two E2E flows in `tests/e2e/evaluation-results.spec.ts`: failed-reevaluation fallback, and queued-too-long plus keep checking;
  - two E2E flows in `tests/e2e/opportunity-dashboard.spec.ts`: field errors and clickable links.
  - The E2E helper gained deterministic `fail-latest` and `age-latest` commands.

#### Completed — Opportunity lifecycle and user actions (October 6, 2026; Core guard awaiting Codex review)

- **Automatic system lifecycle.** After a completed evaluation, `NORMALIZED`/`EVALUATED` → `RECOMMENDED` (or `NORMALIZED` → `EVALUATED` if there is no recommendation). A failed evaluation changes nothing.
  - Automatic sync never overwrites a user state and never downgrades.
  - It runs in a product-level wrapper around the production evaluation processor (`apps/web/src/server/opportunity-lifecycle-sync.ts`). A sync failure is logged and never fails a completed task.
  - The worker repairs any missed sync with a sweep at startup.
  - Core still never mutates the lifecycle.
- **User actions.** `POST /api/opportunities/[id]/action` accepts `SAVE`, `MARK_APPLIED`, `DISMISS`, `ARCHIVE` and `RESTORE`.
  - Each action is a compare-and-set plus a row in the new additive `OpportunityUserAction` table, in one transaction.
  - Only explicit user actions write that table; evaluations and the automatic sync never do.
- **Deterministic RESTORE.** An undo stack over the action history: each non-RESTORE action pushes, each RESTORE pops, and RESTORE targets the newest action not yet undone. Repeated RESTORE walks backward and never bounces. A system-state target is re-derived from persisted evaluations.
- **Reevaluation.** Allowed in every normalized state except `ARCHIVED`/`CLOSED`, which return 409 `OPPORTUNITY_NOT_EVALUABLE`. A user state is preserved and a new evaluation-history row is added.
- **Dashboard.** Views for Active (default), Saved, Applied, Dismissed, Archived and All; lifecycle labels on each row; `GET /api/opportunities?view=`.
- **Detail page.** Status and action buttons. Reevaluate is disabled with an explanation when the opportunity is archived or closed. Status refreshes after an evaluation completes.
- **Core guard (⚠ awaiting Codex review).** The Core executor's `NORMALIZED`-only guard is widened to `isNormalizedLifecycleState` (any state except `DISCOVERED`) in `execute()` and `executeExisting()`. Automatic lifecycle writes depend on this change and are not integration-ready until Codex reviews it. See `HANDOFFS.md`.
- **Migration.** `20261006210110_opportunity_user_actions` is additive only.
- **Tests:**
  - unit: `opportunity-lifecycle.test.ts`, `opportunity-actions.test.tsx`, executor guard cases, evaluation request guard cases;
  - integration: `opportunity-lifecycle.test.ts`, which runs real deterministic evaluations through the production wrapper;
  - E2E: the lifecycle flow.

#### Completed — AI usage and cost display (October 6, 2026)

- **Results page.** A collapsed "AI usage and estimated cost" section for the displayed evaluation. It shows provider attempts, all five token categories, estimated cost with its currency, and the pricing configuration version(s).
  - A collapsed per-operation breakdown lists operation, model, attempt, status, tokens and cost.
  - Values are rendered from the existing API `usage` (built by `summarizeSemanticUsage()`) and `operations`.
  - Unreported values show "Unknown", never 0.
  - Provider request IDs and raw error messages are never rendered; operation error codes are sanitized.
- **Dashboard.** "AI usage" totals across all evaluations: evaluations, attempts, total tokens, estimated cost and pricing basis. The totals come from a read-only product repository (`database/src/usage-summary-repository.ts`) that reuses `summarizeSemanticUsage()` as-is. When the total cost is Unknown, the page says why: attempts without a recorded cost, or mixed currencies.
- **Not changed.** No changes to the evaluator, pricing/cost calculation, usage recording, or schema, and no budget limits, deferral or ledger.
- **Tests:**
  - `tests/unit/usage-display.test.tsx`;
  - `tests/integration/usage-summary.test.ts` (attempts seeded through the existing recorder);
  - E2E usage assertions in the Apply and lifecycle flows.

#### Completed — Pre-Task-5 foundation pass: provenance and multi-source readiness (October 6, 2026)

- **Audit result.** Most provenance was already correct:
  - raw-first `SourceRecord` capture;
  - Opportunity identity, URL and timestamp fields;
  - field-level `FieldProvenance`;
  - many `SourceRecord`s per Opportunity;
  - `DuplicateReference`.

  Evaluation, reevaluation and lifecycle actions never write provenance.
- **Fixed — per-source application URL.** `SourceRecord.applicationUrl` is now a first-class column (it was previously only in JSON). Migration `20261006232000_source_record_application_url` backfills it null-safely, copying only well-formed http(s) values and leaving everything else NULL.
- **Fixed — manual capture.** It can now record an optional source job ID (`externalId`, with field provenance) and "where you found it" (`sourceMetadata.reportedSource`, informational only). Manual jobs always keep `source = "manual-input"` / `sourceType = MANUAL`.
- **Fixed — provenance in the UI.**
  - The detail page has a "Source and provenance" section: entry method, source, reported source, every source record with its URLs (safe links), source job/requisition IDs, and discovered/last-observed/normalized timestamps.
  - Opportunity-level first/last seen is also shown.
  - Dashboard rows show the source; list items carry `source`/`sourceType`.
- **Fixed — duplicate paid evaluations.** A server-side guard returns 409 `EVALUATION_ALREADY_ACTIVE` while the opportunity's latest evaluation is queued or running. The residual true-concurrency race is documented in `HANDOFFS.md`.
- **Tests:**
  - `tests/unit/foundation-provenance.test.tsx`;
  - guard cases in `evaluation-api-worker.test.ts`;
  - `tests/integration/foundation-provenance.test.ts`: full provenance snapshot unchanged across evaluation, reevaluation and all user actions; backfill edge cases; the guard;
  - a provenance E2E flow.
- **Deferred (all additive later):**
  - `SourceRecord.retrievalType`/`sourceCategory` (with the first collector);
  - posting-history observations;
  - the dedup engine and canonical-source selection;
  - submit-URL-only capture.

#### Completed — Task 5: Profile and preferences management (October 7, 2026)

- **`/profile` ("Profile & preferences", linked from the dashboard).** Shows which version new evaluations use, a displayed-version selector, the editor, and the version history.
  - The history shows each version's saved date, how many evaluations used it, Active / In use / Viewing badges, and View and Make active (with confirmation).
- **Structured form.** Edits the evaluation-relevant fields of the existing Customer Success contract:
  - salary (currency, pass and review thresholds, lower-cost countries);
  - work arrangement and the unknown-arrangement result;
  - allowed and disallowed countries, US-only roles;
  - travel allowances (recurring onsite and field travel are fixed FAIL and shown read-only);
  - role families;
  - fit areas, lower-alignment patterns and work styles;
  - business models, product types, customer types and segments;
  - career-strategy goals;
  - career goals, experience (Direct/Related/Transferable), skills, transferable skills and work preferences.

  Unset fields show their effective default with a "Default" tag and stay unset unless edited. Nothing outside the contract was added; seniority and relocation are not in the contract and are not exposed.
- **Advanced JSON editor.** The full stored document.
  - Parse errors are shown with line and column, and validation errors by path.
  - Unknown keys are rejected, including inside nested preference objects that the domain schema would otherwise silently strip.
  - The label is locked.
- **One draft, two editors.** The form and the JSON editor share one base version, and at most one of them can hold unsaved changes.
  - Form → JSON always carries the changes over.
  - JSON → form carries the changes over only when that is lossless. Otherwise it asks; "Keep editing JSON" keeps the draft byte-for-byte, and "Discard JSON changes" returns to the base.
  - Changing the displayed version while there are unsaved changes asks first, and a `beforeunload` warning covers leaving the page.
  - Each save submits only the open editor's draft, as one request that creates at most one version.
- **Append-only versions and an explicit active version.**
  - Saving always appends through the existing `PrismaUserProfileImportRepository.import()` (with hash dedupe).
  - "Save as new version" never changes what evaluations use; "Save and make active" does.
  - The new additive `ActiveUserProfile` table (one row per domain) is a pointer only. Activation never updates a `UserProfile` row.
  - Before the first save, the version currently in use is pinned, so a new version can never take over implicitly.
- **Profile resolution for new evaluations:**
  1. an explicit `userProfileId`;
  2. the active version;
  3. the previous newest-profile fallback, used only when nothing was ever activated.

  The resolved version is pinned at enqueue as before, and historical evaluations are never rebound.
- **Opportunity detail hint.** When the latest evaluation used a different version than new evaluations would, the page says so and suggests reevaluating. Nothing is reevaluated automatically.
- **CLI.** `pnpm profile:import:customer-success` keeps appending versions. `--activate` makes the imported version active; without it, the version in use is unchanged.
- **Not changed.** Evaluator, domain profile contract, prompts, stages, routing and recommendation logic are unchanged. Migration `20261007120000_active_user_profile` is additive only (the known `Recommendation.evidenceReferences` drift line was excluded again).
- **Tests:**
  - `tests/unit/profile-management.test.ts`: option lists equal the domain schema; changes apply only to changed paths; JSON → form diff; validation paths; label lock; handlers.
  - `tests/unit/profile-editor.test.tsx`: draft reducer, including a 5,000-step invariant check, plus jsdom component tests for both switch directions, confirm and cancel discard, and exactly one save request from either editor.
  - `tests/integration/profile-versioning.test.ts`:
    - historical linkage (evaluation row, API `versions.userProfile` and profile evidence `sourceReference` unchanged after v2 is saved and activated);
    - a queued evaluation keeps the pinned v1;
    - the pin guard, rollback, fallback, dedupe and cascade;
    - no `UserProfile` row is ever mutated;
    - exactly one row per save.
  - `tests/e2e/profile-management.spec.ts`, which runs after the other specs as its own Playwright project, because it changes the active version.
  - Dev dependency `jsdom` was added for the component tests.

#### Completed — Task 6: Budget ledger and deferral (October 7, 2026)

- **Budget** (`/budget`, plus a "Budget" link and an "AI budget" card on the dashboard):
  - a monthly calendar budget in a chosen IANA time zone (default UTC), with amount, currency (must match the AI pricing currency), reserve per evaluation, and an enforcement toggle;
  - "Remove budget" makes evaluations unlimited again;
  - the period resets implicitly, because spend is always computed over the current window, so no job is needed.
- **Spend accounting.**
  - Known spend is the direct sum of persisted `SemanticOperationAttempt.estimatedCost` in the budget currency within the period.
  - Null-cost attempts are counted separately as unknown, and other-currency attempts separately; neither is ever counted as $0.
  - An evaluation with $0.07 known plus one unknown attempt contributes $0.07 and raises the unknown warning.
  - `summarizeSemanticUsage()` and the existing usage displays are unchanged.
- **Reservations and holds.**
  - With a budget configured, each admitted evaluation gets a reservation (`EvaluationBudgetReservation`).
  - Its remaining hold (reserve − known cost so far) counts while the work is unresolved:
    - live or queued/running work holds in whichever period is current, including across a month boundary;
    - a finished run with unknown cost holds only in the period of its unknown attempt;
    - a finished run with all costs known holds nothing.
  - Actual cost replaces the hold automatically, and nothing is rewritten.
- **Gate and deferral.** Each request runs under one Postgres advisory lock.
  - With no budget, it is unrestricted: no reservation, no deferral, behaviour as before.
  - With enforcement on and no room, the request is recorded as a `DeferredEvaluation` (`AI_BUDGET_LIMIT`, originally persisted as `BUDGET_UNAVAILABLE`; see the Task 6 naming cleanup below; with a budget snapshot). It creates no Evaluation, Task or provider call, and the lifecycle is untouched.
  - The evaluate API returns 200 `outcome: "DEFERRED"` instead of 202.
- **Resume and cancel.**
  - From the backlog on `/budget`, or the opportunity page ("Resume deferred evaluation" / "Cancel request").
  - Resume re-checks the budget, the active-evaluation guard and the lifecycle.
  - It uses the **profile version pinned at deferral time**; a deleted pinned version is refused with a clear reason.
  - A request whose resume admission is abandoned returns to the backlog.
  - Automated draining is additive later; there is no scheduler.
- **Request integrity** (always on, separate from money).
  - Every product request creates an `EvaluationAdmission`, which the new `PrismaEvaluationTaskRepository.enqueueAdmitted()` consumes atomically in the transaction that creates the Evaluation and Task.
  - An abandoned admission (timeout after a crash before enqueue) can therefore never produce an Evaluation.
  - This closes the duplicate-active race previously documented in HANDOFFS.
  - A check-ordering race found during testing (two queued under concurrency) was fixed: the live admission is read before the active evaluation. It is covered by a repeated concurrency regression test.
- **UI:**
  - the dashboard budget card (known spend, reserved, remaining known, unknown/other-currency warnings, enforcement, reset date, deferred count);
  - rows show "Evaluation deferred";
  - the opportunity page explains the deferral from the snapshot (pinned profile, active-profile difference);
  - the results page shows "Reserved before run" next to the actual cost.
- **Migration.** `20261007200000_budget_ledger` is additive (four tables, two enums, plus a check that an admission is never both consumed and abandoned); the known `Recommendation` drift line is excluded.
- **Tests:**
  - unit: `budget.test.ts` (period/DST/time zones, holds, decision, validation) and `budget-ui.test.tsx` (card, reason, backlog, handlers, 200/202 outcomes);
  - integration: `evaluation-admission.test.ts` (recovery, durable association, delayed enqueue after abandonment, consume/abandon race ×20, failed enqueue, unchanged `enqueue()`, concurrent requests with and without budget, no-budget integrity) and `budget-deferral.test.ts` (gate, deferral with zero rows created, restart persistence, resume re-check, reconciliation, unknown cost, both concurrency cases, pinned profile, archived/cancel, abandoned resume, settings never rewrite usage, currency, period boundaries);
  - E2E: `budget.spec.ts`, its own Playwright project, run last.

#### Completed — Task 7: Dashboard search, sort, filters, and analytics polish (October 8, 2026)

- **Server-side, read-only, URL-held state** (`/`, plus `GET /api/opportunities`). Filters, search and sort never mutate anything.
- **Lifecycle views:** Active (default), **To triage** (new: system states only, so "recommended to apply, not yet acted on" is an exact view), Saved, Applied, Dismissed, Archived, All. Archived appears only in Archived/All.
- **Filters** (OR within a filter, AND across filters):
  - recommendation (latest completed evaluation: apply / review / skip / none);
  - evaluation state (none / queued / running / completed / failed / deferred);
  - priority band;
  - role family;
  - customer segment;
  - source type, source, company, domain;
  - title contains, location contains;
  - salary stated / not stated;
  - discovered date range (inclusive UTC days).
- **Evaluation-derived values** (priority, role family, segment) are read as-is from the latest completed evaluation's persisted result. They are never inferred; a "Not evaluated"/"Unknown" option covers their absence.
- **Deferred filters** (data not reliable yet), mostly completed by the Task 7 completion amendment below:
  - numeric salary range and salary sorts: **done**;
  - remote/seniority/department: **done**;
  - structured location: still deferred (no structured location columns);
  - salary analytics: still deferred.
- **Search** (`q`): case-insensitive partial matching, AND across up to 8 terms (80 characters each), over title, company, location, source, original source, salary text and listing/requisition IDs. Wildcards are escaped. Descriptions are excluded (full-text search is an additive follow-up).
- **Sorts:** newest/oldest discovered, recently updated, priority (contract band order, unknown last), company A–Z and title A–Z (missing last). All end with deterministic tie-breakers. Recommendation is a filter, not a sort.
- **URL state.**
  - A pure parser and serializer (`apps/web/src/server/opportunity-query.ts`). Invalid or stale values are dropped and never error.
  - The dashboard redirects to the canonical URL, so empty or invalid params are removed and a page past the end becomes the last valid page (`?page=99` with 63 results at 25 per page → page 3; zero results → page 1).
  - Refresh, back/forward and bookmarks all work. The filter form is a plain GET form, auto-submitting on change.
- **Pagination.** Offset-based, 25 per page. A filtered `COUNT(*)` and the page query share one predicate builder and run in one RepeatableRead read-only snapshot, so totals and items cannot disagree.
- **Dashboard.**
  - A "Needs attention" strip (not evaluated, recommended to apply, deferred for budget, evaluation failed, in progress); each count equals the total of the view it links to.
  - Removable filter chips, clear-all, a result count, and distinct "no opportunities yet" vs "no matches" empty states.
  - Pipeline overview counts and lightweight distributions (current recommendation, priority, source).
  - Richer rows: company · location, salary or "Salary not stated", source, discovered date, lifecycle, current recommendation (marked "last completed" when a reevaluation is pending or failed), priority, evaluation state, deferred badge, and a safe application link.
  - The budget card and AI usage totals are unchanged.
- **Migration.** `20261008090000_dashboard_indexes` adds Opportunity indexes only (`discoveredAt/id`, `status/discoveredAt`, `sourceType`, `updatedAt`); the known `Recommendation` drift line is excluded.
- **API.** `GET /api/opportunities` now accepts every filter/sort/page param and returns `total`, `page`, `requestedPage`, `pageCount` and `pageSize`. Unknown params and invalid values are now ignored; malformed `limit`/`page`/`pageSize` still return 400. Without `view`, the API keeps listing every lifecycle state.
- **Tests:**
  - unit: `opportunity-query.test.ts` (parsing, dropping, normalization, escaping, canonical serialization, `clampPage`, canonical redirect, contract value parity) and `dashboard-ui.test.tsx` (chips, count, form state, rows, pagination, attention links, distributions);
  - integration: `dashboard-query.test.ts` (every filter and combinations, search, sorts with nulls last, page beyond end, exact final page, zero results, count/items agreement across pages, summary counts equal linked views, read-only);
  - E2E: `dashboard.spec.ts`, its own Playwright project, run last.

#### Completed — Task 7 completion amendment: normalized Opportunity fields and the deferred filters (October 14, 2026)

**Audit (before):**
- `salaryMin`/`salaryMax`/`currency`, `remoteStatus`, `seniority`, `department` and `closingDate` existed in the schema but were never populated.
- `employmentType` was partial: the normalizer copied it, but manual entry always sent null.
- Location, salary text, posting date, source/provenance and domain were complete.
- Every other Task 7 filter, sort, search, URL state, pagination and empty state was complete.
- Numeric salary filtering and sorting, and work-arrangement, seniority and department filters, were missing.

**Normalization** (deterministic, `packages/normalization`; no AI calls):

*(Restoration note, October 23, 2026: the rules below are as implemented on October 14. Three of them are superseded by the Feature 14B correction: "from the compensation text only", "the job description is never scanned", and "only as stated". Facts the source leaves missing are now also read from explicit statements in the job text, through the shared `readJobTextFacts`. The bare-"$" rule now requires clear U.S. evidence. See "Feature 14B correction" under Recently Completed.)*

- **Compensation** (`parseCompensation`) from the compensation text only:
  - a stated range, single amount or open-ended amount ("Up to", "From", "+");
  - `72k`, `72,000` and `72.000` formats.
  - **Stays Unknown:**
    - hourly, daily, weekly or monthly pay (there is no pay-period column);
    - OTE;
    - more than one candidate figure, an inverted range, or an implausible amount.
- **Currency:**
  - from an explicit code or symbol (USD, US$, CA$, €, £…), or from the user's selection;
  - a bare "$" is read as USD (user decision, confirmed 2026-10-14). Example: "$72,000–$88,000" → 72000–88000 USD.
    - It is recorded as a derived value (`DETERMINISTIC`, source field `compensationText:bare-dollar-as-usd`), never as a stated currency, so it stays identifiable and can be revisited.
    - An explicit currency always takes precedence: US$/USD → USD, CA$/C$/CAD → CAD, A$/AU$/AUD → AUD, € → EUR, £ → GBP.
    - The rule never overrides an explicit non-USD currency. "$72,000 EUR", or a "$" with a selected non-dollar currency, leaves the currency Unknown.
  - conflicting currencies, or a "¥", stay Unknown;
  - no conversion exists.
- **Work arrangement:** a stated choice, or else the location field when it states exactly one of Remote / Hybrid / On-site. A plain place name is never read as on-site, and the job description is never scanned.
- **Seniority:** a stated choice, or else unambiguous title words only (Junior, Senior/Sr, Principal, Director, VP/Chief). "Lead", "Staff", "Associate", "Head", "Manager" and mixed titles stay Unknown.
- **Department, employment type and closing date:** only as stated.
- **Residency / geographic eligibility** (added 2026-10-16; migration `20261016090000_opportunity_residency_requirement`, additive):
  - `Opportunity.residencyRequirement` is `US_REQUIRED`, `NON_US` (residence outside the U.S. explicitly permitted or required) or null (Unknown).
  - `Opportunity.residencyRegions` lists the stated geographies (ISO country codes or regions such as `EU`, `EMEA`, `WORLDWIDE`); it is empty when not stated.
  - **Sources:**
    - the user's statement on the form ("Residency requirement", "Eligible residence");
    - otherwise only explicit statements: job text such as "must reside in the United States", "US only", "EU residents only", "must be based in Spain" or "open to candidates in the US or Canada"; or a location field such as "Remote - United States" or "Remote (Spain)".
  - **Never inferred** from salary currency, "Remote" alone, a city or country on its own, headquarters, nationality, work authorization or time zones. Preferred, negated or conflicting wording stays Unknown.
  - **Provenance:** stated values are recorded DIRECT. Parsed values are DETERMINISTIC with markers `rawText:explicit-residency-statement` / `location:explicit-eligible-geography` and the exact sentence.
  - The free-text location and the raw source record are unchanged. Older rows read as Unknown and are not backfilled.
  - **Geographic levels** (extended 2026-10-16):
    - countries, regions (EU/EEA/EMEA/LATAM/APAC/North America/Americas/Worldwide), U.S. states, DC and Puerto Rico (`US-TX`, `US-DC`, `US-PR`), Canadian provinces and territories (`CA-ON`), and UK nations (`GB-SCT`);
    - full names, plus two-letter postal codes written in capitals for U.S. states and Canadian provinces/territories;
    - **classification:** residence restricted entirely to U.S. geography → `US_REQUIRED` (e.g. "must reside in Texas or Florida" → `US-TX`, `US-FL`); any non-U.S. place allowed or required → `NON_US` (e.g. "open to residents of Ontario", "US or Ontario"). The stated places are kept in `residencyRegions`.
  - **Never resolved by guessing:**
    - "Georgia" (state or country), a bare "Washington" (state or D.C.) and "CA" (California or Canada);
    - a city ("New York City");
    - a list with an unreadable item ("Texas or Narnia").
    - Such statements leave residency Unknown.
  - **Ordinary location fields** such as "Chicago, IL" or "Toronto, ON" are never a residency requirement; explicit candidate residence or eligibility wording is required. A remote-qualified location field ("Remote - Texas", "Remote (Ontario)") still counts as stated eligibility, as before.
- **Manual form:** a new optional "Additional details" group (work arrangement, seniority, employment type, salary currency, department, closing date). Blank stays Unknown.
- **Provenance and preservation:**
  - every populated value gets `FieldProvenance`: DIRECT when stated, DETERMINISTIC when read from text;
  - original text, the `SourceRecord` and the raw payload are preserved;
  - `RawOpportunity` is unchanged, and the stated details live in `sourceMetadata.details`.
- **Existing rows:**
  - older opportunities keep null facts; there is no backfill, and they stay listed and filterable as Unknown;
  - historical evaluations and evaluated job descriptions are untouched.
- **Evaluator boundary:**
  - `loadSubject()` withholds the newly populated fields, so the evaluator's input is exactly as before;
  - the Customer Success salary hard filter would otherwise use parsed amounts without comparing currencies;
  - Codex review is requested in `HANDOFFS.md`.

**Dashboard (Task 7 completed):**
- **Filters:**
  - work arrangement and seniority (multi-select, each with "Unknown (not stated)");
  - residency requirement: U.S. residence required / Non-U.S. residence allowed / Unknown (multi-select, `residency=` in the URL);
  - department (values present in the data);
  - salary currency;
  - salary at least / at most.
- **Salary filter semantics:**
  - amounts are compared in one currency only, USD when none is chosen;
  - a range matches when it can reach the amount, including open-ended ranges;
  - opportunities without an amount, in another currency, or with an unknown currency are counted and named in a note under the result count.
- **Sorts:** "Salary, highest first" and "Salary, lowest first". Both are grouped by currency and never interleave currencies. Unknown currency comes next and no stated amount last, then deterministic tie-breakers. A note explains this when no currency is selected.
- **Semantics kept:** OR within a filter, AND across filters; malformed values are dropped; old URLs are unchanged; the canonical redirect adds `currency=USD` to a bare amount.
- **Server-side and parameterized:** filtering runs in the existing `buildFilterPredicate` and sorts in the whitelisted orders. All values are bound parameters, and the API returns `salaryExclusions`.
- **Rows and detail page:**
  - rows show the work arrangement and residency;
  - the opportunity page shows salary range, closing date, work arrangement, residency requirement (with eligible geographies), seniority (as stated), department and employment type, each "Unknown" when not stated.
- **Fixed while verifying:** a filter change made before the page finished hydrating was silently lost. The form now submits such a change on mount. A unit test guards against the form ever submitting itself unprompted.

**Not complete, and why:**
- **Structured location** (office city/region): manual entry gives free text, so it stays a "location contains" filter, deferred to retrieval. Eligible-residence geography is now structured (above).
- **Residency from cities, or from ambiguous names** (Georgia, Washington, CA): stays Unknown. U.S. states, DC, Puerto Rico, Canadian provinces/territories and UK nations are supported.
- **Time-zone requirements, bonus and equity:** not populated from manual input.
- **Re-normalizing changed listings:** there is no re-observation path yet, so it is blocked on dedup and re-observation in the scraper phase.
- **Salary analytics:** still deferred.

**Schema:** only the residency migration above. The salary and position columns already existed.

**Final data contract for Codex Milestone 4** (salary eligibility):
- Facts stored: salary bounds, currency, original compensation text, location, work arrangement, residency requirement and eligible residence. The full table is in `HANDOFFS.md`.
- Task 7 implements no salary policy: no Pass/Review/Skip, no FX conversion, no cost-of-living judgement, and no recommendation change.
- The salary policy keys on residency, not on the quoted currency.
- The evaluator subject still withholds all newly normalized fields until Milestone 4 adopts them.

**Tests:**
- unit `opportunity-normalization.test.ts` (39, including the bare-$ rule, explicit-currency precedence and provenance marking), `opportunity-filters-hydration.test.tsx` (5), plus query, UI and handler additions;
- unit `opportunity-residency.test.ts` (57, including states, DC, provinces, UK nations, ambiguous names and ordinary location fields): the geography vocabulary; explicit U.S.-required and non-U.S. statements; generic Remote, ambiguous, negated and conflicting text staying Unknown; a USD salary for a Spain-located role; a U.S.-required role quoted in EUR; provenance; the stated-precedence rule; submission validation; the query and labels;
- integration `opportunity-residency.test.ts` (8, including a U.S.-state statement, a provincial statement with an ordinary "Toronto, ON" field, and a plain "Chicago, IL" field staying Unknown): persisted facts independent of currency, provenance markers, raw records unchanged, evaluator withholding, residency filters alone and with salary/currency, malformed values, legacy rows;
- integration `normalized-opportunity-filters.test.ts` (12): persistence and provenance, evaluator withholding, salary boundaries, currencies, exclusions, malformed parameters, arrangement, seniority, department, AND/OR, null legacy rows, sorts and Unknown ordering;
- E2E: manual entry with details, then the arrangement filter, residency filters (U.S.-required and Unknown), the salary filter with its exclusion note, and the salary sort.

**Verification** (isolated test database; normal database untouched; no paid calls):
- typecheck, lint and Prisma validate pass;
- unit 1036/1036, integration 176/176, E2E 25/25 (after the geographic-levels extension);
- `db:verify-migrations` passes (14 migrations, known drift only);
- build passes.

#### Completed — Task 8: Application tracker (October 9, 2026)

An application-tracking layer beside the opportunity lifecycle. The evaluator, recommendation semantics, profile, budget, provenance and usage accounting are untouched.

- **Model** (migration `20261009090000_application_tracker`, additive; the known `Recommendation` drift line is excluded):
  - one `Application` per Opportunity (`opportunityId` unique), with `stage`, `outcome`, `appliedOn`, `closedOn`, a `version` (CAS) and `lastEventSequence`;
  - an append-only `ApplicationEvent` history with a per-application, gap-free `sequence`;
  - `ApplicationNote`, `ApplicationContact`, `ApplicationFollowUp` and `ApplicationInterview`, each with its own `version`.
  - No Opportunity data is snapshotted; title, company, URLs and provenance are read live.
- **Stages** (fixed for Task 8): Planning to apply → Applied → Recruiter screen → Interviewing → Final interview → Offer → Closed.
  - Submitted stages move freely in either direction; a submitted application never returns to planning.
  - Closing needs an outcome: offer accepted/declined (from Offer only); rejected, withdrew or no response (from any submitted stage); decided not to apply (from planning only).
  - Reopen returns to the stage held before closing.
- **`appliedOn` invariant**, enforced by a database CHECK and mirrored by `appliedOnRequired()`:
  - NULL for PLANNED and for CLOSED/NOT_SUBMITTED;
  - non-null for every submitted stage and submitted outcome.
  - Closing and reopening never change it. A correction is refused on never-submitted applications.
- **Lifecycle interaction** (explicit and conservative):
  - A plan is possible only from a system state or Saved. An opportunity already marked Applied can only be tracked as submitted, prefilled from the MARK_APPLIED behind its current state (the same undo stack as RESTORE) and with no new lifecycle action. A direct plan request returns 409 `APPLICATION_ALREADY_SUBMITTED`.
  - Submitting applies MARK_APPLIED in the same transaction. Closing (including rejected or withdrew) never changes the lifecycle, and archiving stays separate.
  - Lifecycle actions run through a guard under the Opportunity row lock:
    - MARK_APPLIED is refused while the application is unsubmitted (planned, or closed as not submitted);
    - RESTORE is refused from Applied while a submitted application exists;
    - DISMISS is refused while the application is active.
  - Reopening to planning needs a lifecycle that permits a plan. Archived opportunities make the application read-only.
- **Concurrency:**
  - every application write and guarded lifecycle action takes the Opportunity row lock;
  - the 10 commands that update existing state require `expectedVersion` (per entity), and a stale version returns 409 `APPLICATION_CHANGED` with no event, no sequence number and no partial change;
  - additive commands take no version.
- **Follow-ups** use UTC calendar dates (stated in the UI). The next action is the earliest open follow-up; states are overdue / due today / upcoming (7 days) / later / done.
- **UI:**
  - an Application section on the opportunity page: start tracking by lifecycle mode, stage controls, close and reopen, applied-date correction, follow-ups, interviews (with a "Move to Interviewing?" suggestion), contacts (mailto and safe profile links), editable notes with history, and a readable timeline;
  - the lifecycle card explains blocked actions;
  - stale-version conflicts keep typed input and offer "Load latest";
  - a new `/applications` tracker: summary counts, Active/Closed/All views, stage, outcome, follow-up and applied-date filters, search, sorts and canonical URL state;
  - dashboard rows show the stage or outcome badge, the next or overdue follow-up, and "Not tracked yet"; a "Follow-ups due" attention item equals `/applications?followUp=due`.
- **API:**
  - `POST`/`GET /api/opportunities/[id]/application`;
  - `GET /api/applications`;
  - `GET`/`POST /api/applications/[id]` (one validated command endpoint).
- **Tests:**
  - unit: `application-rules.test.ts` (rules, invariant, guards, effective date, follow-up states, schemas and version requirements, handler error mapping), `application-query.test.ts` and `application-ui.test.tsx` (jsdom: start tracking by mode, conflict keeps typed input, read-only archived view, timeline sentences);
  - integration: `application-tracker.test.ts` (34 tests, including the four DB-rejected `appliedOn` shapes, compatibility with existing APPLIED, guards, a 6-round plan/MARK_APPLIED race, stale versions for all 10 commands, concurrent equal-version pairs, independence from reevaluation and budget deferral, and tracker/dashboard counts);
  - E2E: `applications.spec.ts`;
  - three racing waits fixed in `evaluation-results.spec.ts` (test-only).

#### Completed — Task 8 completion pass (implemented October 15, 2026; committed as `534a4c7` on October 16, 2026)

*(Recorded on October 15, 2026 as "awaiting review, not yet committed"; reviewed, committed and pushed on October 16, 2026.)*

An audit-first pass over the October 9 tracker. The established model is unchanged: the same seven stages and six outcomes, "Interested" = Saved, "Applying" = Planning to apply, and assessment/case study as an interview type. No evaluator, routing, prompt, provider-schema, recommendation, Resume Match/JD Reconstruction, evidence or pricing code was touched.

- **Audit result.**
  - Complete, kept as is: persistent stages and outcomes, notes, contacts, the guarded lifecycle path, persistence across refresh/restart, and separation from evaluation.
  - Partial or inconsistent, fixed below: date rules, follow-up editing, interview editing, due-work visibility for closed/archived applications, `/applications` filter/view combinations and empty states, conflict recovery, refusal text, and the opportunity-page load failure.
  - Out of scope (later add-ons 20–23): notifications, proactive follow-ups, calendar, email, application assistance.
- **Calendar dates.**
  - Applied and closed dates cannot be later than the current UTC calendar date. A close cannot be earlier than the applied date, and an applied-date correction cannot be later than the closed date. There is no day of tolerance.
  - Refusals return 400 `APPLICATION_DATE_INVALID` and leave no trace; a submission refused for its date also leaves the lifecycle unchanged.
  - The date pickers carry the same limits. Date-only values round-trip unchanged (browser → API → `DATE` column → API → browser), verified in several process time zones and in a UTC+14 browser.
- **Follow-ups.**
  - New versioned `updateFollowUp` command (description and due date). It records a `FOLLOW_UP_UPDATED` event holding the previous values; the timeline shows "rescheduled from … to …".
  - Each follow-up has an edit form.
- **Actionable next actions.**
  - Only actionable applications (not closed, opportunity not archived) have a next action. This rule now drives the follow-up filters, the tracker tiles, the next-action sort, the dashboard row badge and the "Follow-ups due" count, so each tile still equals its linked view.
  - The follow-up rows themselves are kept; reopening or restoring makes them due again.
  - The existing Next-action cell and the panel state "closed" or "archived" instead.
- **Interviews.**
  - A full edit form (type, round, date/time, status, interviewer, notes). An untouched time is kept exactly.
  - The status is selectable when adding.
  - The quick status control follows a status saved elsewhere.
  - "Move to Interviewing?" appears only when an interview is not cancelled.
- **`/applications`.**
  - An outcome or the Closed stage chosen under the default Active view widens the view to All (canonical redirect).
  - Empty results recover inside the tracker: "Clear all filters", "Search all applications" or "View all applications", with the count in the other view. Only when nothing is tracked at all is the dashboard linked.
  - The "No open follow-up" filter is relabelled "No next action".
- **Stale writes.**
  - Typed input is kept on every refusal: the destructive remount keys on the stage, close and applied-date forms are removed, and an untouched applied-date form follows the persisted value.
  - "Load latest" is offered for `APPLICATION_CHANGED`, `OPPORTUNITY_ARCHIVED`, `APPLICATION_EXISTS`, `APPLICATION_ALREADY_SUBMITTED` and `OPPORTUNITY_NOT_TRACKABLE`. Validation and transition refusals show only their message.
  - The version is checked before the dates, so a stale form gets the conflict first.
- **Other.**
  - Tracking/reopen refusals name the opportunity's own state (dismissed, archived, closed posting, not yet processed).
  - The opportunity page shows a load-error notice instead of silently omitting the Application section.
- **Migration.** `20261017090000_application_follow_up_updated`, additive only: `ALTER TYPE "ApplicationEventType" ADD VALUE 'FOLLOW_UP_UPDATED'`. It was applied and verified on the isolated test database only.
- **Lifecycle.** The guarded path (`pendingUserActions` → `applyUserActionInTransaction` → `applyLifecycleActionGuarded`) is unchanged. New tests cover the 409 `APPLICATION_BLOCKS_ACTION` mapping, the route's use of the guarded writer, and reevaluation, sync and sweep never downgrading Applied or touching application rows.
- **Later analytics (features 15/17).** No analytics were built. A test asserts that the dated, gap-free history yields submission → stages → interview → outcome with dates.
- **Tests.**
  - unit: `application-completion.test.ts` and `application-completion-ui.test.tsx` (new); `application-rules.test.ts` updated for the eleventh versioned command and the 400 mapping;
  - integration: `application-tracker-completion.test.ts` (new, 15 tests);
  - E2E: two tests added to `applications.spec.ts`, running in a UTC+14 browser.
- **Verification** (isolated test database only; no paid provider calls; normal database transaction count 0): typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 15/15 migrations in order (only the documented `Recommendation.evidenceReferences` drift); unit 41 files / 1,077 tests; integration 21 files / 191 tests; production build succeeds; E2E 27/27 across all five projects.
  - Two earlier E2E runs failed on wrong assertions in the new tests, which were then fixed; the product behaved correctly both times.
  - The second of those runs also failed the existing `opportunity-dashboard.spec.ts` cleanup, because its compiled helper was deleted by another worker. This is a latent race in that spec when Playwright splits the file across workers after a worker restart. It was not changed in Task 8 and passes in normal runs.

#### Completed — Task 9: Final setup, operations, integration and acceptance (October 10, 2026)

The manual-input product is ready to use as one product. It is ready for the evaluator freeze and the final integration checkpoint; scraper/retrieval work has not started. No evaluator semantics, stages, routing, prompts or recommendation logic changed.

- **Setup and operations** (the root `README.md` "Local Development" section is now the authoritative guide):
  - new scripts:
    - `pnpm app:setup` (generate + migrate)
    - `pnpm db:migrate`
    - `pnpm db:status`
    - `pnpm db:verify-migrations`
    - `pnpm app:doctor`
  - The `app:` prefix is needed because `pnpm setup` and `pnpm doctor` are built-in pnpm commands.
  - `pnpm app:doctor` is strictly read-only (SELECTs and environment checks; never prints values; never runs recovery). It reports:
    - configuration by variable name;
    - database, migrations and the generated client;
    - the active profile;
    - whether a worker is connected;
    - the queue, including leases that expired, reported without claiming the worker stopped.
  - `/api/health` now checks the database (503 when unavailable) and reports whether AI is configured.
  - `.env.example` is grouped (required, real AI, optional, test-only), and its OpenAI key is blank.
- **AI configuration:**
  - Reading results and history no longer needs an OpenAI key; only requesting or resuming an evaluation does.
  - A missing or placeholder key returns 503 `PRODUCTION_CONFIGURATION_MISSING` before anything is written.
  - The worker refuses to start with a named-variable message.
- **Worker and queue:**
  - Single-worker advisory lock: a second worker exits non-zero.
  - Worker-owned recovery of tasks orphaned on their final attempt (`EVALUATION_LEASE_EXPIRED`). It runs only under the lock and only while idle, so it can never fail a live run.
  - Error classes:
    - transient infrastructure errors back off (capped at 30 s) and continue;
    - configuration errors and unexpected/fatal errors exit non-zero instead of looping;
    - evaluation failures are persisted as before.
  - The lifecycle sweep runs every 5 minutes.
  - Sanitized operational logs.
  - Graceful stop on the first Ctrl-C; immediate exit on the second.
- **Honest queue states** (server time): `QUEUED`, `QUEUED_LONG`, `RUNNING`, `RUNNING_STALE`, `FAILED`, `COMPLETED`. `RUNNING_STALE` means the lease expired; the UI says the run may still be in progress or the worker may have stopped.
- **Safe errors:**
  - The public evaluation JSON no longer returns stored error messages or provider request IDs.
  - Every failure code the system produces has a safe message, including `PROVIDER_HTTP_*` and `OPERATION_METADATA_PERSISTENCE_*`.
  - "Request another evaluation" is offered only when the opportunity is evaluable.
- **Production start:** one Prisma client per process in every environment (previously one per repository under `next start`).
- **Navigation and coherence:**
  - a shared header (Dashboard, Applications, New opportunity, Profile & preferences, Budget) with a skip link and current-section marking;
  - a not-found page and an error page;
  - page titles;
  - a visible opportunity title (h1) on the detail page;
  - a bad id is a 404, while a load failure is an error page.
- **Labels and copy:**
  - "Application: …" badges on dashboard rows;
  - a "Due today" tracker tile that links to a matching `followUp=today` view;
  - readable lifecycle and provenance labels ("Found via", "Manual entry (manual-input)");
  - "Save opportunity" button;
  - the interview status selection is kept after "Load latest".
- **Migrations:** `pnpm db:verify-migrations` applies all 11 migrations to a temporary database. It confirms they are recorded in order and that the only schema difference is the known `Recommendation.evidenceReferences` default line, then drops the database.
- **Test infrastructure:**
  - opt-in `TEST_DATABASE_URL` (integration and E2E) and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`;
  - new final Playwright project `acceptance`;
  - E2E helper commands `expire-lease` and `run-recovery` (the recovery command takes the lock).
- **Tests added:**
  - unit: `worker-operations.test.ts` (classifier, loop, AI configuration, doctor) and `navigation.test.tsx`; queue-state and failure-code cases in `evaluation-experience-correctness.test.tsx`;
  - integration: `worker-recovery.test.ts` (recovery, lock, doctor makes no writes, public JSON shape, reads without AI) and `product-acceptance.test.ts`, one connected scenario:
    1. capture and provenance;
    2. profile pinning;
    3. budget deferral and resume;
    4. deterministic worker completion: recommendation, evidence, usage and cost;
    5. dashboard state;
    6. lifecycle and application tracking;
    7. reevaluation under a newly active profile;
    8. history;
  - E2E: `golden-path.spec.ts` (golden path, plus recovery: polling resumes after a refresh, the stale-lease copy, worker recovery, and the 404 page).
- **Verification (no paid provider calls):**
  - typecheck, lint, Prisma validate pass;
  - `db:verify-migrations` passes;
  - unit 896/896, integration 138/138;
  - build and a `next start` health smoke check pass;
  - E2E 23/23;
  - `pnpm app:doctor` reports no blocking problems.

#### Completed — Task 9 completion pass (October 16, 2026; committed as `feat: complete operational hardening`)

*(Heading before the commit, October 16, 2026: "In progress — Task 9 completion pass (October 16, 2026; implementation verified; documentation synchronized; awaiting review; not committed)".)*

An audit-first pass over the October 10 Task 9 operations work, planned and approved before implementation. The worker loop, single-worker lock, task claiming, recovery, error classification, backoff, shutdown, lifecycle sweep, queue states, AI-configuration handling, health behavior, public evaluation API, navigation and acceptance tests were audited as complete and left unchanged. No evaluator, routing, prompt, queue, lease or shared-persistence code changed, and there is no migration.

- **Audit result.**
  - Complete: setup, migrations and their verification, health behavior, AI configuration, worker startup and shutdown, single-worker enforcement, claiming and recovery, exhausted leases, error classification and backoff, queue-state truthfulness, the Prisma/process model, navigation, and acceptance coverage (which tracks applications through the Task 8 tracker).
  - Inconsistent or partial, fixed below: two API routes logged raw error objects; the doctor's deferral line predated usage-limit deferrals; the health endpoint's failure path had no unit test; and the README omitted usage-limit deferrals.
- **The three documented queue limitations** (`HANDOFFS.md`, Task 9 handoff) remain accurately described and acceptable for the one-worker product:
  - no lease heartbeat or claim ownership;
  - `Evaluation.status` lag (every product read uses task status first);
  - task-level retries unused (provider-call retries and user reevaluation cover retryable AI failures).
  - They stay for the final-integration/Codex review.
- **Log hygiene.** `POST /api/opportunities` and `GET /api/opportunities/[id]` now log only the error name, like every other route. A raw error could carry submitted job text or database details. Response bodies are unchanged.
- **`pnpm app:doctor`.** The deferral line now separates requests waiting for the AI budget (including legacy `BUDGET_UNAVAILABLE` rows) from those waiting for usage limits (`USAGE_LIMIT_REACHED`). The query is still a single SELECT; the doctor stays read-only.
- **E2E credential.** `playwright.config.ts` and `e2eEnvironment()` always use the deterministic, non-live `OPENAI_API_KEY`, so the test runner, its helpers and the web server never inherit a real key from `.env`. Other AI settings still follow `.env`. Production AI configuration is unchanged.
- **Worker-lock caveat (documented, not changed).** The single-worker lock lives on the worker's own database connection and is not a heartbeat. If that connection drops during a run and a second worker starts, the second worker's recovery can fail a still-running task whose lease expired on its final attempt. The README now states this and the one-worker rule; the October 10 record above is left as written.
- **README.** Usage-limit deferral in §5, §7 and troubleshooting; the E2E credential note in §6; the lock caveat in §5.
- **Documentation synchronization (October 16, 2026).** This follows a separate documentation audit.
  - Current-state documents now show Task 8 complete and Task 9 current: `AGENTS.md`, `AGENT_WORKSTREAMS.md`, `PRODUCT_STATUS.md`, `DEVELOPMENT_PLAN.md`, the root `README.md`, `AI_Career_Platform_README.md`, and the status sections of `AI_Architecture_README.md`.
  - Additions:
    - `EVALUATOR_STATUS.md` §20: evaluator-branch contract history, residual risks, outstanding verification;
    - dated annotations in `HANDOFFS.md`;
    - Task 8 and Git-recorded history in `CHANGELOG.md`;
    - a Git-record addendum to `MILESTONES_1_10.md`.
  - PRDs, TDDs and the Semantic Evaluation Playbook are unchanged; their next versions follow Task 9.
- **Test infrastructure.** `vitest.config.ts` resolves the web app's `@/` alias, so route handlers can be unit-tested.
- **Tests.**
  - unit: `operations-hardening.test.ts` (new): health 200/503 with no detail leakage; error-name-only logging in both routes (these tests fail on the previous route code); the deterministic E2E key. `worker-operations.test.ts`: the deferral breakdown.
  - integration: `worker-recovery.test.ts` gained a test checking the doctor's per-reason counts against independent counts.
- **Verification** (isolated test database only; no paid provider calls; normal database transaction count 0):
  - typecheck and lint clean; Prisma schema valid; `db:verify-migrations` 15/15 (only the documented `Recommendation.evidenceReferences` drift);
  - unit 42 files / 1,086 tests; integration 21 files / 192 tests; production build succeeds; E2E 27/27.
- **Closure (October 16, 2026).** The user reviewed and approved the pass. The current-state documents were then updated from "Task 9 current" to "Task 9 complete", a Task 9 entry was added to `CHANGELOG.md` and a closure note to `HANDOFFS.md`. The pass was committed as `feat: complete operational hardening` and pushed to `origin/claude/gallant-pasteur-y1ou3i`; `main` was not merged. The full suites were not rerun for the documentation-only closure edits; the implementation and tests are byte-identical to the verified state above.
  - Operational checks on the test database: `pnpm app:doctor` (no blocking problems); `pnpm db:status` (up to date); `pnpm app:setup` (no pending migrations); `pnpm worker:evaluations:once` refuses the placeholder key and exits 1; `next start` `/api/health` returns 200 on the test database and 503 `degraded` on an unreachable one, with no URL in the response or log.

#### Completed — Profile limitations persistence (main-product completion, task 1; October 14, 2026)

The product persistence boundary can now carry structured profile `limitations`, which the accepted evaluator's Resume Match needs before a requirement can become a Genuine Gap. Only product-owned plumbing was added. No evaluator-owned domain schema, enum, prompt, Resume Match logic or bundled-profile content was ported or changed, and the installed strict profile contract was not loosened.

- **Schema:** additive nullable `UserProfile.limitations` (JSONB), migration `20261014090000_user_profile_limitations`. Existing rows keep NULL and are never rewritten.
- **Import and versioning:**
  - `VersionedUserProfileData.limitations` is optional (`database/src/user-profile-import-repository.ts`).
  - Content identity includes limitations when present. A version without them, absent or null, hashes and stores exactly as before, so existing versions keep their identity and re-saving them creates no duplicate.
  - Changing limitations appends a new version; identical content does not.
- **Repository:** `PrismaUserProfileRepository.getVersion()` returns `document.limitations` only when stored. So the JSON editor round-trips limitations, and versions without them look exactly as before.
- **Evaluator delivery:** `loadSubject()` adds `userProfile.data.limitations` only when the pinned version stores them (shared persistence; flagged in `HANDOFFS.md`).
- **Pinning:** active-profile, evaluation and deferral pinning are unchanged. A newer version with limitations never changes queued or deferred work.
- **Editor and API:** documents pass to the domain validator unchanged. With the currently installed contract, `limitations` is rejected as an unknown field. Once Codex's profile contract is integrated, the same path accepts it with no product change.
- **Tests:** `tests/integration/profile-limitations.test.ts` (7):
  1. import → database → repository round trip;
  2. identity and versioning (duplicate, change, removal, old rows unchanged);
  3. absent and null identity;
  4. legacy rows still building the evaluator profile context;
  5. `loadSubject` delivery with evaluation and deferral pinning;
  6. the starting-profile web save path;
  7. the editor deferring to the installed domain contract.
- **Isolated test database:** all verification ran against a separate database (`ai_career_assistant_test`) via `TEST_DATABASE_URL`. The normal application database recorded zero transactions throughout.
- **Verification:**
  - typecheck, lint, Prisma validate, and `db:verify-migrations` (12 migrations, known drift only) pass;
  - unit 896/896, integration 145/145, E2E 23/23;
  - build passes.
  - No paid calls.
- **Post-integration acceptance tests (run when the evaluator branch is integrated):**
  1. the editor accepts valid limitations and rejects invalid ones per Codex's `profileLimitationSchema`;
  2. `pnpm profile:import:customer-success` and "Create from the starting profile" persist the migrated bundled profile, including its limitation;
  3. a persisted profile with a limitation lets deterministic Resume Match produce a Genuine Gap end to end;
  4. re-import and activate the migrated profile before any acceptance run.

#### Completed — Policy and profile integration readiness (main-product completion, task 2; October 14, 2026)

The audit found no change that would require evaluator semantics to change.

- **Stale policy pin removed:**
  - `.env.example` no longer sets `AI_EXECUTION_POLICY_VERSION=customer-success-semantic-policy-v3-mixed-terra-luna`. It now explains why the variable stays unset.
  - The policy version comes only from the evaluator's built-in `customerSuccessProductionSemanticPolicyVersion` (`packages/shared`, evaluator-owned, unchanged), so the integrated evaluator supplies its own version.
  - No policy identifier was invented.
  - The worker's fail-closed policy-mismatch check, and the policy and pricing metadata stored on evaluations, are unchanged.
- **`pnpm app:doctor` (still read-only)** now reports:
  - the effective policy version, with a WARN when `.env` overrides it;
  - the active profile version and whether it stores structured limitations;
  - open deferrals pinned to a profile version other than the active one, with guidance to resume or cancel and request again through the existing UI.
- **Profile resolution audit:** explicit ID → active version → newest fallback (only when nothing was ever activated). Evaluation and deferral pinning are unchanged. No product code resolves "newest" where the active version applies.
- **Docs:**
  - README environment table, troubleshooting, a new "Updating the evaluator or the bundled profile" operator section, and the current development status;
  - `PRODUCT_STATUS.md` main-product status.
- **Tests:**
  - unit: doctor policy, active-profile and deferral reporting;
  - integration: doctor reads against a migrated profile and a deferral pinned to the older version, on the isolated test database.
- **Verification:** see the commit for this task. No paid calls; normal database untouched.

#### Completed — Task 6 completion: AI budget, throughput, capacity and backlog (main-product completion, task 3; October 15, 2026)

Completes the Core PRD v1.3 "Configurable AI Budget and Throughput Controls" and "AI Capacity and Budget Visibility" requirements, and Core TDD v1.4 "AI Usage and Budget Persistence", "Budget and Deferral API Boundary" and "AI Budget Observability". No evaluator stage, prompt, routing, model, schema or recommendation changed.

**Already complete before this task (Task 6):**
- monthly spending limit (calendar month in a chosen time zone; enforced or advisory);
- atomic, concurrency- and restart-safe reservation through admissions under an advisory lock;
- reconciliation, derived from persisted attempt costs (unknown cost is never $0);
- remaining budget;
- persistent deferred backlog pinned to the profile version, with resume and cancel; resume rechecks budget, eligibility, active work and the pinned profile;
- Unknown token and cost handling in usage totals.

**Added by this task:**
- **Settings** (migration `20261015090000_budget_throughput_limits`, all additive): warning thresholds (up to five percentages), evaluations per day, evaluations per week (ISO week, Monday start, in the budget time zone), output tokens per month, and AI calls per evaluation. Blank means no limit. Nothing is ever raised automatically.
- **Admission:**
  - Every configured limit is checked under the existing admission lock against persisted rows only, so concurrent requests cannot overshoot and restarts never reset counts.
  - Volume counts non-abandoned admissions in the local day and week.
  - The output-token limit counts provider-reported output tokens in the budget month. Unreported tokens stay Unknown and are reported, never counted as zero. Running evaluations always finish.
  - A limit hit is an operational deferral: reason `USAGE_LIMIT_REACHED`, or `AI_BUDGET_LIMIT` when the monetary budget is among the limits reached.
  - The snapshot records every limit reached.
  - Resume rechecks the budget and all limits, plus the existing eligibility, active-work and pinned-profile checks.
  - The enforcement switch covers the budget and the limits; when off, limits are reported but never defer.
- **AI calls per evaluation:**
  - The user may only lower the system maximum (`AI_CALL_BUDGET`), and never below the evaluator's operation count, which is what a normal evaluation needs.
  - It is applied through the existing persisted `executionMetadata.semanticCallBudget` at enqueue, so evaluations already queued keep their allowance.
  - No monthly call-count cap was added (decision recorded with the user).
- **Warnings:** derived from configured thresholds over spent plus reserved, and shown on the dashboard budget card and `/budget`.
- **Reporting** (`GET /api/budget/report`, the `/budget` "AI usage and capacity" section):
  - counts of eligible-not-yet-evaluated, evaluated, queued, running and deferred, with a domain × source-type breakdown;
  - provider-reported tokens this month, with unreported attempts counted separately;
  - estimated remaining capacity (by budget, by today's limit, by this week's limit), Unknown when a budget is set without a cost basis;
  - estimated cost of the deferred and of the eligible backlog (average recorded cost of the last ten fully costed completed evaluations; Unknown without one);
  - known spend per day for the month and per month for six months, with unknown-cost attempts shown;
  - the pricing and configuration basis: policy version, configured pricing versions, the pricing versions behind the estimates, call-allowance bounds, and when the budget was last changed.
  - No credentials, provider error text or request IDs are returned.
- **Also fixed:** the shared site header from Task 9 had no styles and rendered as a bullet list; it is now styled.
- **Tests:**
  - unit `budget-throughput.test.tsx` (24): windows across time zones, DST and year end; warnings; limits; estimates; validation; card, deferral and report rendering; API error sanitization;
  - integration `budget-throughput.test.ts` (10): daily and weekly limits and resets; six simultaneous requests against a limit of two; budget plus limit; enforcement off; output-token cap with unreported tokens and untouched queued work; warnings; invalid settings; call allowance bounds and persistence; report counts, tokens, estimates, spend over time and no secrets;
  - E2E: a daily limit defers the next request, and `/budget` shows the report.
- **Verification** (isolated test database; normal database untouched; no paid calls):
  - typecheck, lint, Prisma validate, and `db:verify-migrations` (13 migrations, known drift only) pass;
  - unit 923/923, integration 155/155, E2E 24/24;
  - build passes.

**Still open (recorded in `HANDOFFS.md`):**
- Already-queued evaluations are still not cancelled when the budget is lowered (unchanged, still awaiting explicit acceptance).
- Source Analytics exclusion of budget deferral is implemented by Feature 15 (October 31, 2026): deferred jobs are neutral states, never in a source's quality rates.

**Resolved by the Task 6 naming cleanup (below):** the deferral reason name (now `AI_BUDGET_LIMIT`, matching the TDD) and the eligibility wording (neutral "eligible for evaluation").

#### Task 6 naming cleanup — completed (2026-10-14)

A small alignment patch. Task 6 stays complete; admission behaviour is unchanged.

- **Deferral reason renamed:**
  - The monthly dollar budget now defers with `AI_BUDGET_LIMIT`, the TDD name. It replaces `BUDGET_UNAVAILABLE`.
  - Non-dollar limits keep `USAGE_LIMIT_REACHED`.
  - The constants and `normalizeDeferralReason()` live in `packages/core/src/budget.ts`.
  - The backlog label reads "AI budget limit".
- **Backward compatibility:**
  - Handled at read time. `PrismaDeferredEvaluationRepository` maps a stored legacy `BUDGET_UNAVAILABLE` to `AI_BUDGET_LIMIT`, so the API, UI and resume results only ever show the current name.
  - There is no migration and no bulk rewrite; the column is free text.
  - A legacy row keeps its stored value until a normal resume recheck writes the current reason (existing behaviour).
  - No code filters on the stored reason.
- **Eligibility wording:**
  - Product-owned text uses "eligible for evaluation" (`eligibleNotEvaluated`, "Eligible, not yet evaluated").
  - Model-specific eligibility wording was only in the HANDOFFS contract question, which is now resolved.
  - No Codex-owned text was touched.
- **Unchanged:** queued evaluations are not cancelled when limits are lowered; running evaluations finish; new and resumed evaluations are checked against current limits.
- **Tests:**
  - a unit test for the constants and the normalizer;
  - an integration test: a legacy row reads as `AI_BUDGET_LIMIT` through the list and the gate, the stored value is not rewritten on read, and a still-deferred resume reports `AI_BUDGET_LIMIT`;
  - existing assertions are updated to the new name.

#### Remaining main-product order

Revised roadmap:

- Task 5 — Profile + Preferences: done (see above).
- Task 6 — Budget Ledger + Deferral: done (see above).
- Task 7 — Product UI: dashboard, search, sort, filters, analytics polish: done, including the completion amendment (normalized fields, salary/arrangement/seniority/department filters and salary sorts; structured location and salary analytics deferred).
- Task 8 — Application Tracker: done (see above).
- Task 9 — Final setup, operations, integration, E2E: done (see above).
- Next: freeze the evaluator, then the deliberate final integration checkpoint (see the final integration checklist in `HANDOFFS.md`), then retrieval/scraper work.
- Then retrieval/scraper; then source, job-market and posting-history intelligence; later ecosystem features.

**Current order (updated October 16, 2026; supersedes the "Next" line above):** the Task 1–9 completion pass is complete: Task 8 completion pass committed (`534a4c7`, October 16, 2026); Task 9 completion pass committed (`feat: complete operational hardening`, October 16, 2026). The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete (October 16, 2026). Next comes an audit of any remaining gaps in main-product features 1–10. Then main-product features 11–18 (retrieval, source health, posting-history/ghost intelligence, browser extension, source intelligence, market analytics, personal job-search analytics, company intelligence). Only after all of that: deliberate evaluator/product integration, full isolated verification, E2E acceptance, evaluator freeze and merge. Features 19–23 are later add-ons. See `DEVELOPMENT_PLAN.md`.

#### Known issues found during main-product work

- **Resolved (test-only): evaluator test-harness drift.** On `main` (`ebd5911`), 11 integration tests and both E2E evaluation flows failed because test harnesses lagged accepted evaluator contract changes:
  - the Burnout Risk transport (`65dcaab`);
  - the Resume Match compatibility model (`fe8b0d2`);
  - the mixed-routing execution policy (`a307631`).

  The harnesses are repaired without production changes. Integration is now 25/25 and E2E 4/4. See `HANDOFFS.md` ("Evaluator Test-Harness Drift Repaired").
- **Playwright Chromium mismatch.** In environments with a different preinstalled Chromium build, Playwright 1.62.1 needs a matching browser or a `launchOptions.executablePath` override.

## Planned Next

Task 8 (`534a4c7`) and Task 9 (`feat: complete operational hardening`) are complete.

The post-Task-9 versioned PRD/TDD/Semantic Evaluation Playbook update is complete (October 16, 2026). The features 1–10 gap audit is complete, and the Features 1–10 Gap Closure is committed (`d573acf`, October 17, 2026). Features 11A (`fad2341`), 11B (`2a1d8c2`), 12 (`f10a02b`), 13 (`d1bf217`) and 14A (`dd77d29`, accepted October 20, 2026) are committed; Feature 14B is implemented and verified (October 20, 2026), awaiting review and local acceptance, and not committed.

1. Next: Alex's review and local Chrome acceptance of Feature 14B (implemented October 20, 2026), then its checkpoint commit and documentation closeout; Feature 14 is not complete until it is accepted. *(Earlier steps: "Next: Feature 14B, the browser-extension companion", superseded October 20, 2026 when it was implemented; "Next: user review of Feature 11A …", of Feature 11B, of Feature 12, of Feature 13 and of Feature 14A, superseded October 18–20, 2026 after the commits `fad2341`, `2a1d8c2`, `f10a02b`, `d1bf217` and `dd77d29`; "Next: audit any remaining main-product gaps in features 1–10", superseded October 17, 2026; "Next: user review of the gap closure, the check of the versioned PRDs/TDDs against what changed, then the checkpoint commit", superseded October 18, 2026 after the commit `d573acf`.)*
2. Then features 15–18 in order: source intelligence (complete, October 31, 2026), market analytics, personal job-search analytics, and company intelligence. *(Feature 14 completed October 29, 2026, when 14B's live acceptance passed.)* *(Earlier step: "main-product features 14–18: browser extension, …"; on October 19, 2026 the browser-assisted LinkedIn retrieval and source corrections became feature 14A, and the browser-extension companion remains feature 14B, next.)*
3. Only after features 1–18 are complete: deliberate evaluator/product integration, migrations/full isolated verification, E2E acceptance, any explicitly authorized live verification, evaluator freeze, and merge.

Features 19–23 remain later add-ons.

Retrieval must connect to the existing normalization and deduplication pipeline and feed normalized opportunities into the existing evaluator; source coverage expands within features 11–18.

## Settled Decisions

- Customer Success is the first implemented domain.
- The Core Platform remains domain-agnostic.
- Customer Success salary thresholds and affordability policy remain domain-owned.
- Residency requirement selects salary policy; currency never selects residency policy.
- No salary maximum is imposed by the Customer Success hard filter.
- The evaluator should not be redesigned merely to accommodate model/provider quirks.
- Provider transport schemas may differ from persisted domain schemas.
- Authoritative application data should be restored deterministically rather than regenerated by a model.
- Predetermined results belong in code rather than paid semantic calls.
- Unknowns remain Unknown.
- Final Apply / Review / Skip is deterministic application logic.
- Model routing is an execution detail, not a product-semantic change.
- Retrieval must feed the existing normalization/dedup/evaluator architecture. *(Earlier wording: "Retrieval/scraping comes after the first usable product and must feed the existing evaluator." Since October 15, 2026 retrieval is main-product work in features 11–18, built after the Task 1–9 completion pass and before final acceptance.)*
- Main-product scope is features 1–18; only features 19–23 are later add-ons.
- Codex and Claude may work in parallel only with clear ownership boundaries.
- Paid provider calls require explicit authorization.
- Normal application database use for experiments/tests is prohibited unless explicitly authorized.
- Optimization candidates are judged against the last known-good implementation as BETTER / SAME / WORSE.
- Do not fix evaluator issues as isolated one-off symptoms; validate the whole affected contract/path.
- Already-admitted queued/running evaluations are not retroactively cancelled when limits are lowered (accepted; recorded in the October 15 annotations in `HANDOFFS.md`).

## Open Integration Items

These are intentionally not Task 9 work:

- final branch combination and handoff resolution;
- DB-backed acceptance of the Task 7 → Milestone 4 contract, including removing the five released fields from `fieldsWithheldFromEvaluator` on this branch and updating its withholding tests (see the October 15 annotations in `HANDOFFS.md`);
- profile limitation end-to-end acceptance after branch integration (the four post-integration acceptance tests in "Profile limitations persistence" below);
- persisted-attempt seeding / pre-send marker decisions for crash recovery;
- Recommendation evidence-reference schema drift decision;
- full migrations/typecheck/lint/build/integration/E2E acceptance, re-run in full whenever evaluator contracts change;
- any final live provider acceptance run;
- evaluator freeze and deliberate main merge;
- carry the evaluator branch's October 10–15 records into the canonical documentation. They currently live in the Codex branches' root-level `Md and README Docs/CURRENT_PROGRESS.md`, a different path from this file. At branch combination, merge them into this file and `EVALUATOR_STATUS.md` (§19 lists them) without dropping either side (see `HANDOFFS.md`, October 15 annotations, item 3).

Codex reviews still open from the `HANDOFFS.md` Final Integration Checklist:

- the Task 6 `enqueueAdmitted()` shared-persistence change;
- the Task 7 dashboard read dependency on persisted Customer Success result fields;
- the Task 8 guarded lifecycle path (`pendingUserActions`, `applyUserActionInTransaction`, `applyLifecycleActionGuarded`);
- the Core executor lifecycle guard (`isNormalizedLifecycleState`);
- the Task 9 additions (`failExpiredExhaustedTasks`, the worker lock, the Prisma singleton, the public API shape);
- the profile limitations persistence boundary (`loadSubject()` and `UserProfile.limitations`);
- the Features 1–10 Gap Closure shared-boundary changes (October 17, 2026; see `HANDOFFS.md`):
  - the capture transaction and the `ManualOpportunityRepository` port;
  - attached duplicate sources in `loadSubject()`;
  - `timeZoneRequirements` added to `fieldsWithheldFromEvaluator`;
  - the reused-company spelling;
  - the duplicate-spend refusal and its lock.
- the Feature 11A shared-boundary changes (October 18, 2026; see `HANDOFFS.md`):
  - `ingestRetrievedListing()` and `preserveUnnormalizedListing()` on the capture repository, which now implements the new `RetrievalIngestionRepository` port and shares its capture path with manual capture;
  - deduplication engine `core-dedup-v2` (source-scoped listing IDs; listing-ID conflicts only within one source);
  - new `SourceRecord` columns and the retrieval models;
  - no evaluator or `loadSubject()` change: retrieval creates and updates opportunities through the existing capture path, and a retrieved opportunity becomes an evaluator subject only through the existing evaluation workflow (for awareness: its first source record is the first retrieved one, changed observations follow it, and source items live under `rawPayload.source`, with no posting history);
  - the Customer Success discovery configuration (no evaluator code).

Main-product follow-up (not an integration blocker):

- Source Analytics excludes budget/usage-limit deferrals (implemented by Feature 15, October 31, 2026).
- Feature 11 must reuse the capture transaction and the deduplication engine for retrieved sources. It must add cross-source matching, canonical-source selection by source type, posting history and any merging of opportunities that already have history (not done in the gap closure, by decision). *(Status October 18, 2026: Feature 11A reuses the capture transaction and engine and adds cross-source matching and canonical-link selection. Posting history is feature 13. Merging opportunities that already have history remains undone by decision.)*
- Adzuna stays registered, unverified and disabled until the user provides credentials and authorizes its verification. Its documented search response carries only a description excerpt, which conflicts with the complete-description contract; this is an open Adzuna-specific design decision.
- Run `pnpm db:backfill-dedup --dry-run`, then `pnpm db:backfill-dedup`, on the normal application database. Only when the user chooses to; it changes data.

Documentation items carried from the earlier Open Items list, with their status after the October 15 documentation preservation audit and correction pass:

- exact current local setup/run commands for README: **resolved**. The root `README.md` "Local Development" section is the authoritative operator guide (Task 9 setup tooling).
- complete Milestones 1–10 historical documentation: **resolved**. `MILESTONES_1_10.md` contains all ten milestones.
- complete evaluator-history/status document: **resolved**. `EVALUATOR_STATUS.md` §1–18 are preserved, and §19 adds the October 10–15 state.
- final evaluator benchmark: superseded by the October 15 routing lock. The final live / whole-product evaluation is part of final integration.

Documentation status (October 15, 2026):

- **PRD/TDD archive complete.**
  - All 23 recovered formal PRD/TDD versions, August 2026 → October 15, are in git and hash-verified.
  - Superseded versions are frozen in the `Archive/` folders beside the current PRDs and TDDs.
  - Core AI Framework PRD v1.4 is the new current Core PRD; v1.3 is archived unchanged.
  - Current authoritative versions are listed in `AGENTS.md`.
- **Semantic Evaluation Playbook v1.2** is current; v1.1 is preserved unchanged beside it.
- **Update (October 16, 2026):** the post-Task-9 versioned-document update made Core AI Framework PRD v1.5, Customer Success AI Assistant PRD v1.4, Core Platform TDD v1.6, Customer Success Assistant TDD v1.4 and Semantic Evaluation Playbook v1.3 current. The previous PRD/TDD versions are archived unchanged; Playbooks v1.1 and v1.2 stay beside v1.3. `AGENTS.md` lists the current versions.
- **P13 (specification version index in `CHANGELOG.md`): intentionally deferred.** It was an optional proposal in the documentation preservation audit, never an approved required item, and is not required for the Task 8 documentation gate. The specification history remains recorded in each document's own revision table and in the archived versions.

## Known-Good Principle

When a change introduces instability or semantic regression, revert to the last known-good implementation rather than forcing the change through.
