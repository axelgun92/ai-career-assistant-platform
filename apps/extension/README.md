# AI Job Assistant Companion (browser extension, Feature 14B, with results-page Mode B)

A Chrome Manifest V3 extension that saves the job posting you are viewing into your **local** AI Job Assistant, when you ask it to. It is a source-collection companion only. It has no evaluator, model calls, prompts, budget, recommendation logic or database of its own. Captured jobs go through Core's existing ingestion: normalization, deduplication, provenance and lifecycle.

## The side panel and its two modes (November 5, 2026)

The extension works in Chrome's **side panel**, which stays open while you browse. Click the AI Job Assistant button in the toolbar to open it. That click also lets it read the page shown. The extension asks for no broad host permission, so after you move to another page the panel says "click the AI Job Assistant button in the toolbar" until you click it once on that page.

- **Single Job** reads one job posting: the review, edit and save steps below (Mode A). It is the mode on a job's own page. On a results page it never reads the whole list as one job; it tells you to open a job's page or use Batch Capture.
- **Batch Capture** saves the jobs already loaded on a supported results page (Mode B, below) and shows their progress. It is the mode on a supported results page. It never shows the single-job Title, Company, Location and Description fields.
- The **Single Job | Batch Capture** switch is always shown, and your choice stays as you move between pages.
- **Captures:**
  - Batch Capture lists the **current capture** (jobs still being read: **View current capture**), the latest finished one (**View results**) and **Previous captures**.
  - Each capture opens in the panel with every job's current state and a link to the added opportunity.
  - When you reopen the panel, a banner offers your latest capture straight away, so a running or finished capture never needs to be redone.
  - **View Captured Jobs in AI Job Assistant** opens that capture, or all of them, in the app.
- Closing the panel stops nothing: background-tab reading runs in the extension's service worker, and LinkedIn details are read by the app.
- *(Before November 5, 2026, the extension used a toolbar popup that showed both modes together and always reopened at its first screen.)*

## What it does

1. You open a job page in Chrome and click the extension's toolbar button; the side panel opens in **Single Job**.
2. The panel checks its pairing with AI Job Assistant and whether the page is already saved. Only the page's URL is sent for that check.
3. **Read this page** reads that one page, once, and shows an editable preview of the title, company, location and description. You can correct any of them, and a field the page did not state is left empty (Unknown). Nothing is sent yet. On LinkedIn it reads only the job details.
4. **Save to AI Job Assistant** sends the job's fields, naming any you corrected so their provenance shows they were edited by you. The popup reports the outcome:
   - saved;
   - already saved (nothing changed);
   - updated (the posting changed);
   - added to an opportunity you already have (only when it shares that listing's URL, or its listing or requisition ID at the same company);
   - a possible duplicate (the same company with a similar title, location and description: flagged, never merged).
5. Saving never evaluates anything. After a save, **Request evaluation** is offered. It goes through the app's existing evaluation path, with the same pre-evaluator triage, budget, duplicate-spend protection, queue and retries. While the popup is open it shows the persisted state (queued, running, completed or failed) and any recommendation, read-only.
   - **Held for review before evaluation** (Needs Review): nothing was spent. Choose **Evaluate** or **Reject** on the job's page in AI Job Assistant. The extension offers no decision of its own.
   - **Rejected before evaluation**: nothing was spent.

   Only a queued evaluation is followed. *(Added November 3, 2026, per the triage handoff's extension contract.)*

   **Triage at save** (November 5, 2026): when AI Job Assistant has an active profile, every saved job immediately gets the deterministic pre-evaluator triage. That is triage only, with no evaluation, admission or spend. The panel shows it on its own line:
   - **Evaluate**: request evaluation when you want it;
   - **Needs Review before evaluation**, with the reason: decide on the job's page;
   - **Rejected before evaluation**, with the reason.

   With no active profile the job is still saved, and the panel says triage was not run because no profile is active; no outcome is invented.
6. **Open in AI Job Assistant** opens the opportunity in the app.

## Save jobs on this page (Mode B: bounded results-page ingestion)

The steps above are Mode A, the single-job capture. It stays unchanged and optional. Mode B saves the jobs a supported results page has already loaded, and AI Job Assistant then reads each job's full posting automatically. Nobody has to open the jobs one by one.

1. On a supported results or search page, the popup offers **Save jobs on this page**. It is shown only for a site the app enables (see *Supported sites* below), and only on that site's results pages, never on account, feed, messaging or profile pages.
2. Pressing it reads the job cards **already loaded** in the page, once: up to **25**, in page order, each card's title, link, company, location and posted text as the card shows them. The extension never scrolls, pages, clicks, opens or navigates anything, and makes no request to the site. A card the page has not rendered yet is skipped and counted, never invented. So are the page's header, navigation, side panels, detail pane and "Similar jobs"-style lists. A sign-in or security-check page is not read at all, and neither is a shown challenge or a sign-in prompt with no loaded job behind it. A sign-in prompt shown over results that are still loaded does not stop the read: the loaded cards are read, the prompt is left as it is, and the summary says it is there. Only what the page shows counts: markup the page keeps hidden, such as LinkedIn's invisible reCAPTCHA badge or its hidden Apply/Save sign-in dialogs, never stops a read, and neither do a scroll lock or an app promotion. The extension never closes, dismisses or uses a prompt, never signs in and never works around a challenge. A link inside a shown sign-in prompt is never taken as a result. For LinkedIn the job details are then read by the app's worker in its own fresh logged-out browser (step 5), not in your tab, so a prompt in your tab is not on that path.
3. A preview lists the jobs, all ticked. Untick any you don't want. Nothing is sent until **Save selected jobs**.
4. The selected jobs are staged in AI Job Assistant, not yet added as opportunities. The popup reports, for example, "3 queued to get their details · 1 already in AI Job Assistant". A job the app already has, from Mode A, a source or an earlier results-page capture, is recognised by the same identity Mode A uses, is reported as already in AI Job Assistant and is not read or queued again; a job an earlier capture is still reading is reported as already in progress. That capture marks such jobs "already saved before this capture", and every earlier capture keeps its own jobs. Saving the same page again is idempotent.
5. **Automatic details:** for a site whose detail reading is verified, the app's retrieval worker reads each staged job's own page. It does this in a fresh, logged-out headless browser (`RETRIEVAL_BROWSER_EXECUTABLE`), the same access model as browser-assisted retrieval: one page at a time, at least the site's interval apart, at most 25 per pass. Any refusal, sign-in wall, challenge or rate limit stops it, and the site is not contacted again for at least a day. The page is read by the same single-job reader Mode A uses, and the job is ingested through the same path as a Mode A capture: normalization, deduplication and re-observation, recorded as "Found via <site> (browser extension)". For LinkedIn (Option A, November 8, 2026), the worker's browser does not run the job page's scripts. JavaScript is off, and only the job page itself is requested (its redirects followed). Its scripts, stylesheets, images, fonts and frames are refused in the browser, so each job costs one page request. The page LinkedIn sends already holds the whole posting. A page that arrives without a complete posting (a title, and a description of at least 200 characters; a heuristic, so an unusually short legitimate posting can be refused, shown with its reason and Retry) is never saved: a single one counts as that job's failed attempt ("Awaiting details" after three), and two in a row mean the site's pages need their scripts, so every LinkedIn job waits an hour with nothing counted. The server setting `PAGE_CAPTURE_LINKEDIN_PAGE_SCRIPTS=run` (restart the worker) restores reading with scripts. Welcome to the Jungle / Otta is read in your Chrome and is not affected.
6. Each newly added job is then handed once to the app's existing evaluation request. Its pre-evaluator triage decides before any spend:
   - **Evaluate:** goes to the normal admission and backlog (budget and queue), then the evaluator.
   - **Needs Review before evaluation:** waits for your **Evaluate** or **Reject** on the job's page. This is distinct from the evaluator's final Review.
   - **Reject:** stops with no evaluator work.

   Mode B decides none of these and never calls the evaluator itself.
7. **Open progress in AI Job Assistant** opens **Captured Jobs** (`/extension/jobs`; formerly "Jobs from results pages"). It shows each job as Getting details, Added (with its triage or evaluation state and a link to the opportunity), Already in AI Job Assistant, Awaiting details, No longer available or Dismissed.
   - Single-job captures are listed there too, one row per job.
   - **Capture history** lists every results-page save; each can be opened with its own jobs (`/extension/jobs?session=…`).
   - A batch job saved while no profile is active shows "Added; not triaged yet: no active profile". It is triaged once a profile is active and evaluation is requested.
8. **Awaiting details** is a per-job fallback only. It is used when a job's page could not be read: an unreadable page, repeated failures, or a site whose automatic details are not verified yet. *(Earlier also "no browser configured": since November 7, 2026 a worker without a browser leaves the jobs in the batch, shown as "Waiting: No browser is configured…", and reads them automatically once a worker has a browser; no Retry is needed. Jobs an earlier version moved to Awaiting details for that reason return to the batch on their own.)* Jobs waiting behind a site stop show "Waiting: …" with the reason. Such a job is never an opportunity and never evaluable. It offers **Retry**, **Dismiss** (and **Restore**) and **Open job ↗**, where Mode A's **Read this page** stays available.

**Saving the same page again (November 6, 2026).** A job already in AI Job Assistant is normally reported as already saved and not read again. It is read again (the popup says "to read again"; Captured Jobs shows "Reading again to update", then "Updated from a new read" or "Read again: no change") only when its last read needs it:
- it was read by an older reader (each read records the reader's revision; the November 4–5 records predate it), or
- its last read was incomplete (no page context, or no application route) and is at least a day old, at most 3 times in a row, or
- it was last read 14 or more days ago.

It is never re-read while the site is stopped, if you dismissed it, or more than once per save, and it counts within the same 25. It lands on the same job, is never handed to triage or evaluation again, and only updates what the page states: a fact the page no longer mentions is kept, a salary is replaced only by a complete new one (a range with its currency, or tiers), and only the posting's own explicit words clear a closing date ("open until filled"), a salary ("not disclosed") or a work arrangement ("to be determined"); a "Not specified" label never does. If the page is gone (shown with the date its page was opened), restricted or unreadable, the saved job stays exactly as it was, and a restriction met while reading saved jobs still stops the site for the full wait. For Welcome to the Jungle the way to read jobs again after a restriction is still your next save of the results page once the wait ends (Retry is not offered for background-tab sites).

**Apply links from LinkedIn.** The employer's or ATS application link is used whenever the page names one. Otherwise the job's LinkedIn listing is kept, labelled "Apply on LinkedIn (listing page)", never shown as a direct employer link and never a careers site's front page. A later employer link replaces it; it never replaces an employer link.

**Locations on Captured Jobs.** A job's company and location come from the saved job once it is added; Welcome to the Jungle cards state no location, so the preview says "Locations are read with each job's details."

**When the database is briefly unavailable.** The worker no longer stops on one job's database error. A busy capture lock puts the job back without counting it; a job whose own data is refused counts one attempt; a transient failure is counted only once the next job (or a lock check) shows the database is fine, so an outage never uses up any job's 3 attempts. A job already saved when a later step failed is never charged: it is read again onto the same job. A saved job being read again keeps its refresh state through any of this. Interrupted jobs return to the queue uncounted when the worker restarts.

**Supported sites.** Mode B's V1 sites are LinkedIn and Welcome to the Jungle / Otta. Wellfound is not a Mode B site.
- **LinkedIn: enabled** (November 4, 2026). F0: its real results cards are read 5/5. P1: PASS, 5/5 job pages read in a fresh logged-out browser. It is not complete until its targeted end-to-end acceptance.
- **Welcome to the Jungle / Otta: not offered by default, not complete.** F0 done. P1 BLOCKED (HTTP 403 on the first job page). P3 unsupported: its cards hold no job description. Its mechanism is P2, which is implemented and verified offline (November 4, 2026; see *Background-tab detail reading* below) but not live-accepted. The single **Save selected jobs** action for up to 25 already-loaded jobs reads each job automatically, in sequential background tabs of your Chrome, with no second action. Until its live acceptance it is offered only when the app runs with `PAGE_CAPTURE_ACCEPTANCE_SITES=welcome-to-the-jungle`. *(Earlier, November 4, before implementation: "It is not yet implemented (implementation needs separate approval), then needs live acceptance." Superseded plan: a separate three-job proof-of-concept phase, removed November 4, 2026.)*

*(Earlier wording: "Neither site is enabled yet.")* A site is offered only after its card reading has been checked on real results-page fixtures (step F0 below). Its jobs are read automatically only after its detail reading has passed the bounded P1 experiment (step P1 below). Mode B is complete for a site only when an approved automatic detail mechanism moves its batch-captured jobs into real opportunities without anyone opening them one by one. Awaiting details never counts as completion. If P1 fails for a site, the site stays incomplete, and any other mechanism (such as reading the jobs in background tabs of your own Chrome) needs Alex's separate decision.

## What it reads, in order

1. The page's schema.org `JobPosting` data, if it has any: JSON-LD, or the same fields written into the page as microdata (`itemprop`). Structured data without its own description takes the page's main content as the description. On a remote posting, an office address in the structured data is not sent as the location; the places it says a remote candidate may be in (`applicantLocationRequirements`) are sent instead.
2. On LinkedIn only: a reader limited to LinkedIn's job-detail areas (the job's top card, description and criteria list, which states the seniority level and employment type, and the posting's stated age). It runs only on a job page (`/jobs/view/<id>`, or a jobs page showing one job with `currentJobId=<id>`).
3. The text you selected on the page, if any.
4. Everywhere except LinkedIn: the page's main content, without its navigation, header, footer, side panels and lists of other jobs ("Related Jobs", "Similar roles"). The job's own container is `<main>`, or else the `<article>` that holds the job's title, never another job's card.

On LinkedIn there is no whole-page fallback. If neither the structured data nor the job-detail areas yield the job, the extension asks you to select the job description text. It never reads account or profile data, messages, the feed, cookies, other tabs or browsing history.

Welcome to the Jungle and Otta pages go through the generic path (steps 1, 3 and 4); there is no site-specific reader for them. The same is true of any other site.

A field the page doesn't state is left unknown. The extension never invents a company, an ID or an application link.

The extension does not interpret the posting. It sends what it read, plus neutral context, never on LinkedIn:
- the tab's title;
- the job's own page content, with every description: the job's container without navigation, header, footer, side panels, forms, lists of other jobs, and related-job, sharing or cookie widgets, one visible item per line, up to 20,000 characters. It lets a detail shown beside the description be used: a labelled row ("Remote Type: Hybrid", "Visa Sponsorship" / "Not Available"), or an item that is only a salary, an employment type, office days, a seniority label, a country or a posting age ("$80K – $95K", "1 day a week in office", "Junior and Mid level", "Posted 1 week ago"). *(Before October 26, 2026 it was sent only beside structured data or a selection.)* AI Job Assistant's shared normalization then fills facts the page states only in its text, such as "Location: Chicago, IL", "This is a full-time, hybrid position." or a salary statement. It does this the same way for every source. A field you corrected in the preview is recorded as user-corrected, and a field you cleared stays unknown.

## Background-tab detail reading (Mode B, P2: Welcome to the Jungle / Otta)

For a site whose job pages AI Job Assistant cannot read itself (Welcome to the Jungle / Otta refused a logged-out browser with HTTP 403), the extension reads each saved job's page in your own Chrome instead. It is started by the same **Save selected jobs** click; there is no second action.

1. **Permission, inside the Save click.** The first time, Chrome asks to let the extension read `www.welcometothejungle.com` and `app.welcometothejungle.com` pages. Decline, and nothing is saved or sent. Grant, and the batch is saved. If Chrome closes the popup while it asks, granting still saves the batch. The permission can be removed at any time in Chrome's extension settings; a run in progress then stops.
2. **One job at a time.** The extension's service worker checks with AI Job Assistant that the job is still to be read, then opens its page in a **new background tab**, at least 12 seconds after the previous one started. Your own tabs are never switched, navigated or closed. You can keep browsing.
3. **Reading.** When the page has loaded (at most 30 seconds), the extension checks it for an access restriction, then runs the same single-job reader as **Read this page**. If no posting is found yet, it reads the same page again after 2 and 5 seconds, without reloading. It then closes its own tab and sends the posting. AI Job Assistant checks that the page is the saved job, then ingests it and hands it to the pre-evaluator triage, exactly as for LinkedIn. Only the job's own page is used, never the card's text.
4. **Stops.**
   - An access restriction stops the whole batch: HTTP 401, 403, 429, 999 or 5xx, a sign-in redirect or sign-in form in place of the job, a challenge or CAPTCHA, or the tab leaving the site. The site is then not contacted for at least 24 hours, and the remaining jobs wait as Awaiting details. When the wait ends nothing resumes by itself: save a results page again to read them.
   - A page that is not the saved job stops the batch.
   - A job that is gone (404 or 410) is marked No longer available, and an unreadable page is Awaiting details; the next job is read.
   - If you close one of the extension's tabs, that job is interrupted and never reopened.
5. **Progress and Stop.** While a run is active, the side panel's Batch Capture shows its progress and a **Stop reading details** button. The job being read finishes; nothing more opens. If the browser closes, the run ends and is not resumed at the next start. Its jobs show as interrupted on `/extension/jobs` after an hour. For these jobs `/extension/jobs` offers no **Retry**: save the results page that shows them again.

## Permissions

- `activeTab`, so it can read the current tab only after you click the toolbar icon;
- `scripting`, to run the one-off page reader;
- `storage`, for its two settings, the latest capture's identifier (so the panel can offer it at once), and session storage (cleared when the browser closes) for a background-tab run in progress;
- `sidePanel`, for the side panel (it gives no access to any page; the toolbar button that opens it is the per-page activeTab grant);
- `alarms`, only to continue a background-tab run if Chrome stops the service worker mid-run;
- host access to `http://127.0.0.1/*` and `http://localhost/*` only, to reach your local AI Job Assistant;
- **optional** host access to `https://www.welcometothejungle.com/*` and `https://app.welcometothejungle.com/*`, asked only inside **Save selected jobs** on a Welcome to the Jungle results page, for the background-tab detail reading above.

It has no content scripts and no `tabs`, `cookies`, `webRequest` or all-sites access. It has no popup: the toolbar button opens the side panel. Its service worker:
- opens the side panel from the toolbar button and tells it that it may read the page shown;
- on installation and every browser start, restricts the extension's storage to the extension's own pages;
- during a background-tab run only, opens, reads and closes its own background tabs;
- accepts messages from the extension's own popup only.

*(Earlier, before P2: "Its minimal service worker does one thing: on installation and every browser start it restricts the extension's storage to the extension's own pages.")*

## Pairing and privacy

- **Creating a pairing:** pairings are created on the app's **Extension** page (`/extension`). The credential (`aija_…`) is shown once. The app stores only its SHA-256 hash, along with a label, the last four characters, and the created, last-used and revoked times.
- **Where the extension keeps it:** in `chrome.storage.local`, never in synced storage, with the app's address. Storage is restricted to the extension's own pages with `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` (Chrome 102 and later; the extension requires Chrome 120), so a script running in a web page cannot read it. In Chromium 141, a page-injected script reads `chrome.storage.local` by default but is refused ("Access to storage is not allowed from this context") once the restriction is set, and the extension's E2E test checks the restriction. The single-job page reader receives no arguments, and the results-page reader receives only its site's reader settings (plain selectors and patterns, no credential). Neither touches storage, so the credential never enters a web page.
- **What it's used for:** the credential is sent only in the `Authorization` header, and only to the configured local app's `/api/extension/*` routes (captures, page captures, status, lookup, evaluation request and evaluation status). It is never logged and never shown again.
- **What it can't do:** it authenticates no other route of the app. The pairing-management routes refuse it.
- **Revoking:** on **Setup & Connection** (`/extension`), **Unpair / Revoke Access** on one pairing asks you to confirm, naming that pairing; then the next request from that browser gets 401. Other pairings, jobs already captured and capture history are kept. **Forget pairing** in the extension's options removes the credential from the browser. *(Before November 5, 2026 the button read "Revoke…" on the Extension page.)*
- **Setup & Connection** (`/extension`) is the extension's management page:
  - **Pair New Extension**, with its steps;
  - the paired browsers, each with when its extension last reached the app and the version it reported (the extension sends its version with each request);
  - connection troubleshooting (this app's address, what each extension error means);
  - installation and update steps for the unpacked build;
  - the supported sites and modes, derived from the app's own registry and settings.
  The other destination is **Captured Jobs** (`/extension/jobs`).
- **What is never in the extension:** provider credentials (OpenAI, Terra, Luna) and app-wide secrets.

## Build and load

```bash
pnpm extension:build          # bundles into apps/extension/dist (git-ignored)
```

1. In Chrome or Chromium, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`.
2. In AI Job Assistant, open **Extension**, enter a name and press **Create pairing**, then copy the credential.
3. Open the extension's **Options** (the popup's Options link, or the Details page in `chrome://extensions`). Enter the app's address, for example `http://localhost:3000`, paste the credential and press **Save**. It should say *Connected*.

After changing the extension's code, run `pnpm extension:build` again and press the reload button on its card in `chrome://extensions`.

## Local acceptance runbook (Feature 14B)

Feature 14B acceptance uses a **dedicated, isolated local acceptance database**, `ai_career_assistant_acceptance`. Never use your normal application database for these steps. Do not put the acceptance address in `.env`: set it in the shell, and set it again in every terminal you open for these steps.

**1. Create and select the acceptance database.**

```bash
# Once:
createdb -h localhost -U postgres ai_career_assistant_acceptance

# In every terminal used below:
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_career_assistant_acceptance?schema=public"
```

A variable set in the shell takes precedence over `.env`. Prisma's config, the doctor, the evaluation worker and `next.config.ts` all load `.env` with dotenv, which never overrides a value already in the environment. This was checked for 14B with a decoy `.env` naming a nonexistent database: with the shell variable, each command used the intended database.

**2. Confirm the database before anything touches it.**

```bash
pnpm app:doctor     # Database must read "database ai_career_assistant_acceptance on localhost:5432". If not, STOP.
pnpm app:setup      # generates the Prisma client and migrates this database only
pnpm app:doctor     # the same Database line again; Migrations: 20 applied
```

**3. Start the app in offline evaluation mode.** In this mode no paid provider call is possible:
- the web server only queues evaluations, with the deterministic key below;
- the real evaluation worker is not started;
- the deterministic test worker completes queued evaluations with the fixture provider transport, without the network.

```bash
export OPENAI_API_KEY=deterministic-e2e-key AI_MODEL=gpt-5.6-terra AI_MAX_OUTPUT_TOKENS=12000 AI_RETRY_LIMIT=1 AI_CALL_BUDGET=16 AI_REQUEST_TIMEOUT_MS=120000
pnpm dev                                   # terminal 1; do NOT start pnpm worker:evaluations

# Terminal 2 (same DATABASE_URL): bundle the deterministic test helper, as the E2E specs do
# (database/.e2e-*.mjs is git-ignored), then create and activate a test profile; note the printed IDs.
pnpm exec esbuild tests/support/e2e-evaluation-helper.ts --bundle --platform=node --format=esm --target=node20 \
  "--external:@prisma/*" --external:pg --external:dotenv --external:zod --outfile=database/.e2e-acceptance-helper.mjs
node database/.e2e-acceptance-helper.mjs create-profile
```

**4. Build, load and pair the extension.**
1. Run `pnpm extension:build`.
2. In Chrome on Windows (reaching the WSL app at `http://localhost:3000`) or Chromium under WSLg, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select `apps/extension/dist`.
3. Open `http://localhost:3000/extension`, create a pairing and copy the credential.
4. Paste it, with the address `http://localhost:3000`, into the extension's Options.
5. Check that Options shows **Connected**.

**5. Capture the local fixture first.** Serve it with `python3 -m http.server 8765 --bind 127.0.0.1 --directory apps/extension/fixtures` (terminal 3), then check:
- [ ] Open `http://127.0.0.1:8765/acceptance-job.html` and the extension's popup. It shows *Connected* and the site.
- [ ] **Read this page** shows an editable preview of the page's structured data. Nothing has been saved yet.
- [ ] **Save** reports *Saved as a new opportunity*. **Open in AI Job Assistant** shows the job with "Found via 127.0.0.1 (browser extension)" and *Not evaluated*.
- [ ] Reopen the popup: it shows *Already saved*. **Read this page**, then **Save**, reports *Already saved. Nothing changed.*
- [ ] **Request evaluation** reports *Evaluation requested and queued.* In terminal 2, run `node database/.e2e-acceptance-helper.mjs run-worker`. While the popup is open, it then shows *Evaluation completed. Recommendation: …*, read-only.

**6. Real pages, in your normal browser** (no evaluation needed). *(October 26, 2026: the Feature 14B acceptance retest now covers every supported source domain; see the cross-source list after this step. Generic employer careers pages are not part of it.)* Check:
- [ ] A **LinkedIn** job page (being logged in is fine): it saves with LinkedIn's job details only. The preview shows nothing from your profile, messages or feed. A non-job LinkedIn page is refused.
- [ ] A **Welcome to the Jungle** or **Otta** job page: it saves through the generic path.
- [ ] A **Greenhouse** or **Lever** job page you already have from that ATS source (the same page URL): it is added to the existing opportunity, and the employer link is kept. A copy of a job you saved from a *different* site, with no shared listing URL or ID, is not attached automatically. It may stay separate, or be flagged as a possible duplicate when the company, title, location and description agree closely enough. *(Corrected October 23, 2026: this step previously implied that any copy you already have is attached.)*
- [ ] An **unrecognised employer careers page**: it saves as a lower-priority source with its real host shown. It never replaces an existing ATS link.
- [ ] **Revoke** the pairing on `/extension`: the popup then reports the pairing is no longer valid.

A real evaluation is optional. If you want one, restart the app with your own AI configuration instead of the deterministic key, and start `pnpm worker:evaluations` with the same `DATABASE_URL`. It is your own paid, local action, within your budget.

**Cross-source live retest (October 26, 2026).** Capture a current Customer Success posting on each supported source:
- Greenhouse, Lever, Ashby and SmartRecruiters;
- Remote OK, We Work Remotely, Himalayas and Working Nomads;
- Workday, Workable, Wellfound, LinkedIn (logged out, as before) and Welcome to the Jungle / Otta;
- Adzuna, only from a genuine Adzuna-hosted page; otherwise record it as not retested.

On each opportunity, check both the fields fixed in this batch and the fields that already worked:
- title, company and location (a remote role shows where it may be done from, never only an optional office);
- Salary (a normalized range, otherwise Unknown);
- work arrangement (every option the posting offers, such as "On-site / Remote"), employment type, seniority (as stated), posting and closing dates, and time zone;
- work authorization, sponsorship and location eligibility;
- the application URL and its basis, and the full description (no other jobs in it).

**Original postings that report "Already saved. Nothing changed."** The opportunity keeps the values it was normalized with when it was first saved, so the page does not show whether the current code fixed it. Check it read-only instead:
1. In the popup, press **Open in AI Job Assistant** and copy the opportunity page's address (`http://localhost:3000/opportunities/<id>`).
2. In a terminal where `DATABASE_URL` is the acceptance database, run:
   ```bash
   pnpm acceptance:check-source-version --database ai_career_assistant_acceptance --opportunity "http://localhost:3000/opportunities/<id>"
   ```
3. Each fact is printed twice: **stored now** (what the app shows) and **current** (the same stored evidence through the current normalization, with its provenance markers). A `*` marks a fact that differs.

The command writes nothing: PostgreSQL refuses writes for its session. It calls no evaluator, provider or network, and it refuses to read anything unless `--database` names the database `DATABASE_URL` points to.

Add `--evidence ~/case.json` to also save that version's stored evidence (its description, page context, page title and fields, exactly as stored) to a local file, to send when a case still fails; the database is not changed.

**Final cross-source batch: targeted live verification (October 27, 2026).** Apply the new migration to the acceptance database first (`pnpm db:status`, then `pnpm db:migrate`; it adds one column, `Opportunity.compensationTiers`, and changes no rows), then `pnpm extension:build` and reload the extension.
1. **Replay without recapturing** (the normalization fixes), with the command above, on the stored originals: Healthie (USD), Mongoose (USD), PeopleGrove (location, Remote, USD), Samsara and SMB Team (salary; SMB Team's bonus apart), AlphaSense (80,000–95,000 USD), New Law Business Model (company, Full-time, Remote, 85,000–95,000 USD), Serrala, Dropbox and ServiceTitan (the labelled ranges as the Salary), Hostaway (EST or CST).
2. **Recapture** (the collection fixes), one posting each: Lever (Bluesight or Wing: Full-time and Remote), SmartRecruiters (QAD: salary, Remote, application URL), Remote OK (INNERGY: the full description; Renaissance: location IL, no worldwide eligibility), Workday (Thomson Reuters: the job title, requisition ID, posted and end dates), We Work Remotely (Dropbox or New Law Business Model), Greenhouse (SafeBreach: "United States (East Coast)", Remote).
3. **Welcome to the Jungle (AlphaSense):** note the posting date the page itself shows; if it is not 2025-10-03, send the case with `--evidence`.

**Live acceptance batch: targeted live verification (October 29, 2026).** No migration this time. Run `pnpm extension:build`, reload the extension, then recapture one posting each and check:
1. Greenhouse SafeBreach: Location "United States (East Coast)", Remote, Time zone Unknown.
2. Lever Bluesight: Employment type Full-time, Remote.
3. SmartRecruiters QAD and ServiceNow: an Application URL (the "I'm interested" page).
4. Remote OK INNERGY and Renaissance: an Application URL (the job's own Apply).
5. We Work Remotely Dropbox: a U.S. location and the Salary "US Zone 2: 142,700–193,100 USD · US Zone 3: 126,800–171,600 USD"; New Law Business Model: the company.
6. Himalayas SMB Team: Salary 85,000–90,000 USD, the bonus apart, Full-time, Work arrangement "Remote / On-site". (Jobs for Humanity's monthly pay stays Unknown as a salary, by design.)
7. Workday ServiceTitan: the Salary shows Zone 1 and Zone 2 side by side.
8. LinkedIn Serrala: a posting date (from "12 hours ago") and an Application URL.
9. Welcome to the Jungle AlphaSense: Closing date Unknown; Posting date 2025-10-03 (the page's own structured date). If the page shows a different posted date, send the case.

**When a case still fails, send its evidence.** Run the source-version check above with `--evidence ~/case.json` for that opportunity. For a missing Application URL, a missing sidebar fact or a wrong date, also open the job page, open DevTools (Console), paste the snippet below and send what it copies. It only reads the page; it changes nothing and sends nothing.

```js
copy(JSON.stringify({
  url: location.href,
  title: document.title,
  jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
  applyControls: [...document.querySelectorAll("a, button, [role=button]")]
    .filter((e) => /apply|interested/i.test(e.textContent || "") && (e.textContent || "").trim().length < 80)
    .map((e) => e.outerHTML.slice(0, 1500)),
  sidePanels: [...document.querySelectorAll('aside, [role=complementary], [class*="sidebar" i]')].map((e) => e.outerHTML.slice(0, 4000)),
  linkedInTopCard: (document.querySelector(".top-card-layout, .job-details-jobs-unified-top-card") || {}).outerHTML?.slice(0, 6000) ?? null,
}, null, 1));
```

**Live acceptance, round 2: result (October 29, 2026).** The live round above still failed on seven cases; round 2 traced each one on real evidence and Alex verified the fixes through this installed extension into the live acceptance app. All eight blocker cases pass: Greenhouse SafeBreach, SmartRecruiters QAD and ServiceNow, Remote OK INNERGY and Renaissance, We Work Remotely Dropbox and New Law Business Model (default capture, no highlighting needed), and Workday ServiceTitan (default capture). The real evidence was Alex's stored captures, exported read-only from the acceptance database, and the live pages rendered in Playwright's own Chromium with the page reader run inside them. See CURRENT_PROGRESS.md, "Feature 14B live acceptance, round 2".

How to gather real evidence when a capture is wrong (the method round 2 used):
- **Stored capture:** `pnpm acceptance:check-source-version --database <acceptance database> --opportunity <URL> --evidence ~/case.json` saves the exact capture the extension sent. Compare a default capture with a highlighted ("Use my selected text instead") one when the result depends on it.
- **Rendered page:** run the DevTools snippet above on the job page, so the apply controls (including hidden ones), the side panels and the JSON-LD are visible.

**7. Cleanup (optional).** Stop the servers, delete `database/.e2e-acceptance-helper.mjs`, then run `dropdb -h localhost -U postgres ai_career_assistant_acceptance`.

## Mode B site verification (Alex, local runtime only)

Neither step can run from the cloud environment, and neither touches a database.

**F0: results-page fixtures, once per site.**
1. Open a jobs results page in your normal Chrome: a LinkedIn job search, or a Welcome to the Jungle / Otta jobs search.
2. Press F12 and open the **Console** tab. Paste the whole of `tests/support/page-capture-fixture-export.js` (Chrome may ask you to type `allow pasting` first) and press Enter.
3. The sanitized result is now on your clipboard: at most 5 cards, one not-yet-rendered card if any, and the list's structure as tag and class names only. Links have no query strings, and personal-state text ("Viewed", "Applied", profile insights) is blanked. Paste it into the session. The snippet makes no request and changes nothing.

The fixtures become the site's card-reader tests, and its job links become the P1 sample.

**P1: the bounded detail-reading experiment, once per site, only with Alex's authorization (local runtime).**
```bash
export RETRIEVAL_BROWSER_EXECUTABLE=/path/to/chrome-or-chromium
mkdir -p ~/aija-p1
pnpm page-capture:verify linkedin <up to 5 job URLs from the F0 cards> --raw-dir ~/aija-p1/linkedin 2>&1 | tee ~/aija-p1/linkedin-p1.log
echo "exit=${PIPESTATUS[0]}"
pnpm page-capture:verify welcome-to-the-jungle <up to 5 job URLs from its F0 cards> --raw-dir ~/aija-p1/wttj 2>&1 | tee ~/aija-p1/wttj-p1.log
```
- It takes at most 5 job URLs from that site's F0 cards. It opens each once, in the canonical form production acquisition fetches (LinkedIn: `https://www.linkedin.com/jobs/view/<id>`, whatever slug the card link had). It reads them one at a time in a fresh, logged-out headless browser (no profile, cookies or stored state), at least 5 s (LinkedIn) or 12 s (Welcome to the Jungle / Otta) apart, and runs the unchanged single-job reader on each. Nothing is retried, and no database is read or written.
- **BLOCKED** (exit 3): the first access restriction stops it, with no further request:
  - HTTP 401, 403, 429 or 999;
  - a sign-in, authwall, checkpoint, challenge or CAPTCHA page;
  - LinkedIn's login wall, security check or anti-bot interstitial (even with HTTP 200);
  - an account cookie (`li_at`).
- **FAIL** (exit 2): a page loaded without restriction but was not a readable posting of the requested job, and it stops there. That means:
  - no title, or a description under 200 characters;
  - a redirect to another job or a search page;
  - HTTP 404, 410 or another non-2xx status;
  - a 5xx, timeout or network error.
- **PASS** (exit 0): every given URL loaded without restriction, stayed on the requested job and gave a readable posting. Use all 5 F0 jobs: only a PASS on all of them makes the site eligible for automatic details. Enabling it is a separate, reviewed change.
- Exit 1 is a usage or setup error. Nothing is opened then, or the run stopped before a verdict; it is not a P1 result. *(The first local LinkedIn run, on November 3, 2026, ended this way with "__name is not defined". That runtime defect is fixed and has a regression test; re-run it.)*
- `--raw-dir` (outside the repository) keeps each page's HTML (`p1-<site>-<n>.html`) and `p1-<site>-summary.json` (the verdict and per-page results; no cookies or headers).
- BLOCKED or FAIL means stop and report. There is no further investigation of that site's server-side retrieval (no hidden endpoints, no logged-in access, no repeated probing) unless Alex explicitly authorizes more. Another mechanism (P2) is a separate decision.
- Prior evidence: LinkedIn's first logged-out job-detail request answered HTTP 429 (October 20, 2026). Welcome to the Jungle / Otta has no verified logged-out job-detail path yet; this path has not been tested either way.

## Worker diagnostics and failure evidence (Alex, local runtime)

Added November 6, 2026. Nothing here is uploaded anywhere.

**Automatic: the worker's diagnostics file.** `pnpm worker:retrieval` appends one JSON line per event to `~/.ai-job-assistant/diagnostics/logs/retrieval-worker-<UTC date>.jsonl` (or under `RETRIEVAL_WORKER_LOG_DIR`). The folder is owner-only (0700), the files 0600; files older than `RETRIEVAL_WORKER_LOG_RETENTION_DAYS` (default 30) are deleted when the worker starts; `RETRIEVAL_WORKER_LOG_DIR=off` turns it off. It records ids (worker session, capture batch, job, listing, opportunity), the stage, decisions, attempts, next retry, timings, the Git commit and reader revision at start, crashes and exits, and for a database failure the Prisma code, which P2028 form it was (start-timeout or expired, with the timeout and elapsed ms), the transaction's name and settings and a sanitized message. It never holds page content, passwords, tokens, cookies or connection strings. The worker prints the file's path when it starts. To read it: `tail -n 50 ~/.ai-job-assistant/diagnostics/logs/retrieval-worker-$(date -u +%F).jsonl`, or filter one job with `grep '"itemId":"<id>"'`.

**Opt-in: page evidence (controlled runs only).**
```bash
mkdir -p ~/aija-evidence && chmod 700 ~/aija-evidence
PAGE_CAPTURE_EVIDENCE_DIR=~/aija-evidence pnpm worker:retrieval
```
Each job read leaves `<job id>.rendered.html`, `<job id>.served.html` (the page as the site sent it) and `<job id>.json` (status, timing, the apply-link evidence and which route the application link took, the fields read or missing, any error) in `~/aija-evidence/<worker session>/`. The folder must be outside the repository; files are 0600; session folders older than `PAGE_CAPTURE_EVIDENCE_RETENTION_DAYS` (default 7) are deleted when the worker starts. Pages can hold personal or session data: keep the folder local, never commit or upload it, and delete it after review. Leave the variable unset for normal use.

**Cleanup at any time.** The worker prunes only when it starts (and page evidence only while `PAGE_CAPTURE_EVIDENCE_DIR` is set). To apply retention now, or to remove every page-evidence session:
```bash
pnpm diagnostics:cleanup --evidence-dir ~/aija-evidence            # logs > 30 days, evidence sessions > 7 days
pnpm diagnostics:cleanup --evidence-dir ~/aija-evidence --all-evidence
```
It deletes only `retrieval-worker-<date>.jsonl` files and worker-session folders. Evidence packages are separate folders you delete yourself (`rm -rf ~/aija-failure-<time>`).

**Where these files may live.** The diagnostics folder, the page-evidence folder and a package's `--out` folder are refused inside this repository or any other Git checkout (also through a symbolic link, and whichever folder you run the command from). Folders are owner-only (0700) and files 0600, also when they already existed. Every logged string has credentials, tokens, API keys and cookies removed, and logged page URLs carry no query string. Nothing is uploaded: there is no upload step anywhere in these tools.

**After a failure: the evidence package.** Stop the worker, then:
```bash
DATABASE_URL=<the acceptance database URL> pnpm diagnostics:package --database ai_career_assistant_acceptance \
  --latest --site linkedin --out ~/aija-failure-$(date -u +%Y%m%dT%H%M) [--evidence-dir ~/aija-evidence]
```
(or `--capture-session <id>` for a particular save). It writes a new owner-only folder with `manifest.json`, the capture session, its jobs, their source records (including any not linked to a job), the jobs saved and their triage outcome, a combined timeline, the worker's diagnostics for the window and the page evidence for those jobs. It reads in one read-only transaction, only from a database whose name says test or acceptance (never the normal database), and reruns nothing, contacts no site and calls no provider. Share the folder only as Alex decides; it may contain job and page data.

## Known limits

- **LinkedIn:** the logged-in markup changes often. If the job-detail reader stops finding the job, select the description text and read again. The extension does not change or work around Feature 14A's automated LinkedIn adapter, which stays unverified and disabled after its HTTP 429.
- **Pages whose URL doesn't change:** a page whose URL stays the same while it shows different jobs is identified by its URL, so a capture of a second job there is recorded as a change to the first. Open the job's own page (most sites give each job its own URL) before saving.
- **Mode B:** offered on LinkedIn results pages. Welcome to the Jungle / Otta is offered only when the app runs with `PAGE_CAPTURE_ACCEPTANCE_SITES=welcome-to-the-jungle`, for its live acceptance (see *Supported sites*); its details are read in background tabs of your Chrome, not by the worker. LinkedIn's automatic details need `pnpm worker:retrieval` with `RETRIEVAL_BROWSER_EXECUTABLE`; without a browser, saved LinkedIn jobs wait in the batch ("Waiting: No browser is configured…"), uncounted, until a worker with a browser reads them; that is not Mode B completion. *(Earlier: "wait as Awaiting details".)* LinkedIn's logged-out job pages are rate-limited by LinkedIn: on November 7, 2026 its fourth logged-out job page in about five minutes answered HTTP 429, and the site then stops for at least a day; reading resumes on its own after the stop, with nothing counted against any job. Since Option A (November 8, 2026; not yet live-tested), each LinkedIn job page is one request, without its scripts or other subresources; whether that keeps a batch under LinkedIn's limit is what the next controlled live test measures. Each read's request counts are in the worker's diagnostics and `pnpm diagnostics:package` (`retrieval-summary.json`). The logged-out pages carry no employer apply link, so LinkedIn jobs get "Apply on LinkedIn (listing page)". *(Earlier: "offered on LinkedIn results pages only. Welcome to the Jungle / Otta is not offered.")* The real F0 cards were LinkedIn's logged-out results markup; the logged-in results markup is covered by synthetic tests until the end-to-end acceptance. It reads only cards already loaded: scroll the results and save again for more. It never pages or scrolls for you.
- **What Chrome blocks:** Chrome does not let extensions read some pages (the Chrome Web Store, `chrome://` pages).
