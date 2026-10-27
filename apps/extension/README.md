# AI Job Assistant Companion (browser extension, Feature 14B)

A Chrome Manifest V3 extension that saves the job posting you are viewing into your **local** AI Job Assistant, when you ask it to. It is a source-collection companion only. It has no evaluator, model calls, prompts, budget, recommendation logic or database of its own. Captured jobs go through Core's existing ingestion: normalization, deduplication, provenance and lifecycle.

## What it does

1. You open a job page in Chrome and click the extension's toolbar icon.
2. The popup checks its pairing with AI Job Assistant and whether the page is already saved. Only the page's URL is sent for that check.
3. **Read this page** reads that one page, once, and shows an editable preview of the title, company, location and description. You can correct any of them, and a field the page did not state is left empty (Unknown). Nothing is sent yet. On LinkedIn it reads only the job details.
4. **Save to AI Job Assistant** sends the job's fields, naming any you corrected so their provenance shows they were edited by you. The popup reports the outcome:
   - saved;
   - already saved (nothing changed);
   - updated (the posting changed);
   - added to an opportunity you already have (only when it shares that listing's URL, or its listing or requisition ID at the same company);
   - a possible duplicate (the same company with a similar title, location and description: flagged, never merged).
5. Saving never evaluates anything. After a save, **Request evaluation** is offered. It goes through the app's existing evaluation path, with the same budget, duplicate-spend protection, queue and retries. While the popup is open it shows the persisted state (queued, running, completed or failed) and any recommendation, read-only.
6. **Open in AI Job Assistant** opens the opportunity in the app.

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

## Permissions

- `activeTab`, so it can read the current tab only after you click the toolbar icon;
- `scripting`, to run the one-off page reader;
- `storage`, for its two settings;
- host access to `http://127.0.0.1/*` and `http://localhost/*` only, to reach your local AI Job Assistant.

It has no content scripts and no `tabs`, `cookies`, `webRequest` or all-sites access. Its minimal service worker does one thing: on installation and every browser start it restricts the extension's storage to the extension's own pages.

## Pairing and privacy

- **Creating a pairing:** pairings are created on the app's **Extension** page (`/extension`). The credential (`aija_…`) is shown once. The app stores only its SHA-256 hash, along with a label, the last four characters, and the created, last-used and revoked times.
- **Where the extension keeps it:** in `chrome.storage.local`, never in synced storage, with the app's address. Storage is restricted to the extension's own pages with `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` (Chrome 102 and later; the extension requires Chrome 120), so a script running in a web page cannot read it. In Chromium 141, a page-injected script reads `chrome.storage.local` by default but is refused ("Access to storage is not allowed from this context") once the restriction is set, and the extension's E2E test checks the restriction. The page reader receives no arguments and never touches storage, so the credential never enters a web page.
- **What it's used for:** the credential is sent only in the `Authorization` header, and only to the configured local app's `/api/extension/*` routes (captures, status, lookup, evaluation request and evaluation status). It is never logged and never shown again.
- **What it can't do:** it authenticates no other route of the app. The pairing-management routes refuse it.
- **Revoking:** revoke a pairing on the Extension page and the next request from that browser gets 401. **Forget pairing** in the extension's options removes the credential from the browser.
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

**7. Cleanup (optional).** Stop the servers, delete `database/.e2e-acceptance-helper.mjs`, then run `dropdb -h localhost -U postgres ai_career_assistant_acceptance`.

## Known limits

- **LinkedIn:** the logged-in markup changes often. If the job-detail reader stops finding the job, select the description text and read again. The extension does not change or work around Feature 14A's automated LinkedIn adapter, which stays unverified and disabled after its HTTP 429.
- **Pages whose URL doesn't change:** a page whose URL stays the same while it shows different jobs is identified by its URL, so a capture of a second job there is recorded as a change to the first. Open the job's own page (most sites give each job its own URL) before saving.
- **What Chrome blocks:** Chrome does not let extensions read some pages (the Chrome Web Store, `chrome://` pages).
