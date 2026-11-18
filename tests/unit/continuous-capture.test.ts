// Continuous capture (Mode B, November 15, 2026): the extension's run
// controller against a simulated search (LinkedIn's "See more jobs" list and
// Welcome to the Jungle's numbered pages), server (selection, staging,
// sessions), retrieval worker and background-tab reader, with a controllable
// clock and stored state (a new controller over the same storage is a
// restarted service worker).
import { describe, expect, it } from "vitest";
import {
  cardKey,
  continuousTimings,
  classifyResultsPage,
  createContinuousCapture,
  isResumable,
  type ContinuousEnvironment,
  type ContinuousRunState,
} from "../../apps/extension/src/continuous-capture";
import { continuousView, discardQuestion } from "../../apps/extension/src/continuous-view";
import type { ResultCardsReading } from "../../apps/extension/src/results";
import type { PageDescription } from "../../apps/extension/src/continuation";

type ItemStatus = "QUEUED" | "ACQUIRING" | "INGESTED" | "AWAITING_DETAILS" | "UNAVAILABLE" | "ALREADY_SAVED" | "DISMISSED";
interface Item {
  itemId: string;
  key: string;
  url: string;
  status: ItemStatus;
  lastReason: string | null;
  attempts: number;
}

const linkedInSearch = "https://www.linkedin.com/jobs/search?keywords=Customer%20Success&location=New%20York";
const wttjSearch = "https://www.welcometothejungle.com/en/jobs?query=customer%20success&page=1";
const linkedInJob = (index: number) => `https://www.linkedin.com/jobs/view/${4_100_000_000 + index}`;
const wttjJob = (index: number) => `https://www.welcometothejungle.com/en/companies/acme-${index}/jobs/customer-success-manager-${index}`;

class World {
  clock = Date.parse("2026-11-15T20:00:00.000Z");
  stored: string | null = null;
  tab: { id: number; url: string; closed: boolean } = { id: 7, url: linkedInSearch, closed: false };
  // The search: LinkedIn's loaded list, or Welcome to the Jungle's pages.
  jobs: string[] = [];
  loaded = 0;
  loadStep = 25;
  stallAfter: number | null = null;
  markerAtEnd = true;
  // LinkedIn page behaviours (November 18, 2026): loads that add only links
  // to jobs already shown; jobs (1-based) whose cards render only some time
  // after they load (Infinity: never); the page's job links beyond one per
  // job; every "See more jobs" press.
  duplicateLoads = 0;
  renderDelayMs = new Map<number, number>();
  loadedAt = new Map<number, number>();
  extraLinks = 0;
  loads = 0;
  pages: string[][] = [];
  paginationSignals = true;
  friction = false;
  // The server.
  captured = new Set<string>();
  items = new Map<string, Item>();
  sessions = new Map<string, string[]>();
  batches: Array<{ batchId: string; keys: string[] }> = [];
  stagedBatchIds = new Set<string>();
  backendDown = false;
  failCaptureOnce = false;
  // Runs inside the next batch submission, before the server answers.
  duringCapture: (() => Promise<void>) | null = null;
  workerOn = true;
  // The background-tab reader.
  tabRun: { runId: string; queue: Array<{ itemId: string; url: string }>; current: null; finished: { reason: string; at: number } | null; lastNavigationAt: number | null } | null = null;
  tabsOn = true;
  tabBudget = Infinity;
  nextId = 1;
  sleeps = 0;
  navigations: string[] = [];

  site(): "linkedin" | "wttj" {
    return this.tab.url.includes("linkedin") ? "linkedin" : "wttj";
  }
  page(): number {
    return Number(new URL(this.tab.url).searchParams.get("page") ?? "1");
  }
  item(key: string) {
    return [...this.items.values()].find((item) => item.key === key);
  }

  environment(): ContinuousEnvironment {
    const world = this;
    const down = { ok: false as const, status: 0, code: "UNREACHABLE", error: "AI Job Assistant could not be reached" };
    return {
      api: {
        async selection(body) {
          if (world.backendDown) return down;
          const wttj = body.site === "welcome-to-the-jungle";
          return {
            ok: true,
            status: 200,
            body: {
              site: body.site,
              stoppedUntil: null,
              cards: body.cards.map((card) => {
                const key = cardKey(card.url);
                const item = world.item(key);
                const selectable = !world.captured.has(key) && (!item || (wttj && item.status === "AWAITING_DETAILS"));
                return { url: card.url, disposition: selectable ? "NEW" : "ALREADY_SAVED", selectable, reason: null };
              }),
            },
          };
        },
        async pageCapture(batch) {
          const during = world.duringCapture;
          world.duringCapture = null;
          if (during) await during();
          if (world.backendDown) return down;
          if (world.failCaptureOnce) {
            world.failCaptureOnce = false;
            return down;
          }
          const wttj = batch.site === "welcome-to-the-jungle";
          if (!world.stagedBatchIds.has(batch.batchId)) {
            world.stagedBatchIds.add(batch.batchId);
            const ids: string[] = [];
            for (const card of batch.cards) {
              const key = cardKey(card.url);
              let item = world.item(key);
              if (!item) {
                item = { itemId: `item-${world.nextId++}`, key, url: card.url, status: world.captured.has(key) ? "ALREADY_SAVED" : "QUEUED", lastReason: null, attempts: 0 };
                world.items.set(item.itemId, item);
              } else if (wttj && item.status === "AWAITING_DETAILS") {
                item.status = "QUEUED";
                item.lastReason = null;
              }
              ids.push(item.itemId);
            }
            world.sessions.set(batch.batchId, ids);
            world.batches.push({ batchId: batch.batchId, keys: batch.cards.map((card) => cardKey(card.url)) });
          }
          const ids = world.sessions.get(batch.batchId)!;
          const queued = ids.map((id) => world.items.get(id)!).filter((item) => item.status === "QUEUED");
          return {
            ok: true,
            status: 200,
            body: {
              batchId: batch.batchId,
              sessionId: batch.batchId,
              site: { key: batch.site, name: wttj ? "Welcome to the Jungle / Otta" : "LinkedIn", automaticDetails: true },
              counts: { queued: queued.length, seenAgain: 0, alreadySaved: ids.length - queued.length, refreshing: 0, rejected: 0 },
              outcomes: [],
              progressUrl: "/extension/jobs",
              ...(wttj
                ? { acquisition: { mechanism: "extension-tabs" as const, items: queued.map((item) => ({ itemId: item.itemId, url: item.url })), minIntervalMs: 12_000, loadTimeoutMs: 30_000, rereadDelaysMs: [2_000], stoppedUntil: null } }
                : {}),
            },
          };
        },
        async captureSession(id) {
          if (world.backendDown) return down;
          const ids = world.sessions.get(id);
          if (!ids) return { ok: false, status: 404, code: "NOT_FOUND", error: "Capture not found" };
          const items = ids.map((itemId) => world.items.get(itemId)!);
          return {
            ok: true,
            status: 200,
            body: {
              settled: items.every((item) => item.status !== "QUEUED" && item.status !== "ACQUIRING"),
              stoppedUntil: null,
              items: items.map((item) => ({ itemId: item.itemId, externalId: item.key, url: item.url, status: item.status, lastReason: item.lastReason, opportunityId: null })),
              queuedTabItems: world.site() === "wttj" ? items.filter((item) => item.status === "QUEUED").map((item) => ({ itemId: item.itemId, url: item.url })) : [],
              session: null,
            },
          };
        },
      },
      tabs: {
        async get(tabId) {
          if (tabId !== world.tab.id || world.tab.closed) return null;
          return { url: world.tab.url, status: "complete" };
        },
        async update(tabId, url) {
          if (tabId === world.tab.id) world.tab.url = url;
          world.navigations.push(url);
        },
        async create(url) {
          world.tab = { id: world.tab.id + 1, url, closed: false };
          if (world.site() === "linkedin") world.loaded = Math.min(world.jobs.length, world.loadStep);
          return world.tab.id;
        },
      },
      page: {
        async read(tabId, input): Promise<ResultCardsReading | null> {
          if (tabId !== world.tab.id || world.tab.closed) return null;
          if (world.friction) return { pageUrl: world.tab.url, pageTitle: null, cards: [], counts: { loaded: 0, skippedUnloaded: 0, overCap: 0 }, problem: "FRICTION", keys: [] };
          const onPage = world.site() === "linkedin" ? world.jobs.slice(0, world.loaded) : (world.pages[world.page() - 1] ?? []);
          const readable = (url: string) => {
            const index = world.jobs.indexOf(url) + 1;
            const delay = world.renderDelayMs.get(index);
            return delay === undefined || world.clock >= (world.loadedAt.get(index) ?? 0) + delay;
          };
          const urls = onPage.filter(readable);
          const unreadableKeys = onPage.filter((url) => !readable(url)).map(cardKey);
          const keys = urls.map(cardKey);
          const excluded = new Set(input.excludeKeys ?? []);
          const open = urls.filter((url) => !excluded.has(cardKey(url)));
          return {
            pageUrl: world.tab.url,
            pageTitle: "Customer Success jobs",
            cards: open.slice(0, input.maxCards).map((url) => ({ url, title: `Job ${url.slice(-12)}`, siteJobId: world.site() === "linkedin" ? url.split("/").at(-1)! : null, company: "Acme", location: null, postedText: null })),
            counts: { loaded: urls.length, skippedUnloaded: unreadableKeys.length, overCap: 0, excluded: urls.length - open.length },
            keys,
            pageJobs: { rawLinks: onPage.length + world.extraLinks, unreadableKeys, excludedJobs: 0 },
            problem: urls.length || unreadableKeys.length ? null : "NO_CARDS",
          };
        },
        async advance(_tabId, input) {
          const atEnd = world.loaded >= world.jobs.length;
          const diagnostics = { buttonPresent: true, buttonVisible: true, buttonDisabled: false, markerPresent: true, markerVisible: atEnd && world.markerAtEnd, cardCount: world.loaded, headerCount: null };
          if (atEnd && world.markerAtEnd) return { action: "END", diagnostics };
          if (input.checkOnly) return { action: "CHECKED", diagnostics };
          world.loads += 1;
          if (world.duplicateLoads > 0) {
            // The site answers with jobs it already showed.
            world.duplicateLoads -= 1;
            world.extraLinks += 10;
            return { action: "CLICKED", diagnostics };
          }
          const before = world.loaded;
          if (world.stallAfter === null || world.loaded < world.stallAfter) world.loaded = Math.min(world.jobs.length, world.stallAfter ?? Infinity, world.loaded + world.loadStep);
          for (let index = before + 1; index <= world.loaded; index += 1) world.loadedAt.set(index, world.clock);
          return { action: "CLICKED", diagnostics };
        },
        async describe(): Promise<PageDescription | null> {
          const page = world.page();
          const signals = world.paginationSignals;
          return {
            href: world.tab.url,
            activePage: signals ? page : null,
            highestPage: signals ? world.pages.length : null,
            nextPresent: signals && page < world.pages.length,
            nextDisabled: false,
            nextPage: signals && page < world.pages.length ? page + 1 : null,
            total: null,
            empty: false,
            summary: signals ? `nav[Pagination] | ${world.pages.length} pages` : "no pagination found",
          };
        },
      },
      acquisition: {
        async enqueue(input) {
          if (!world.tabRun || world.tabRun.finished) world.tabRun = { runId: `run-${world.nextId++}`, queue: [], current: null, finished: null, lastNavigationAt: world.tabRun?.lastNavigationAt ?? null };
          const held = new Set(world.tabRun.queue.map((item) => item.itemId));
          world.tabRun.queue.push(...input.items.filter((item) => !held.has(item.itemId)));
          return world.tabRun as never;
        },
        async state() {
          return world.tabRun as never;
        },
        async stop() {
          if (!world.tabRun || world.tabRun.finished) return;
          for (const queued of world.tabRun.queue) {
            const item = world.items.get(queued.itemId)!;
            if (item.status === "QUEUED") {
              item.status = "AWAITING_DETAILS";
              item.lastReason = "BATCH_STOPPED";
            }
          }
          world.tabRun.queue = [];
          world.tabRun.finished = { reason: "USER_STOPPED", at: world.clock };
        },
      },
      hasPermission: async () => true,
      storage: {
        load: async () => (world.stored ? (JSON.parse(world.stored) as ContinuousRunState) : null),
        save: async (state) => {
          world.stored = state ? JSON.stringify(state) : null;
        },
      },
      now: () => world.clock,
      uuid: () => `00000000-0000-4000-8000-${String(world.nextId++).padStart(12, "0")}`,
      async sleep(ms) {
        world.sleeps += 1;
        if (world.sleeps > 100_000) throw new Error("runaway loop");
        world.clock += ms;
      },
      extensionVersion: "0.3.0",
      keepAlive: () => undefined,
      setAlarm: () => undefined,
    };
  }

  // The retrieval worker and the background-tab reader, between alarms.
  work() {
    if (this.site() === "linkedin" && this.workerOn) {
      for (const item of this.items.values()) if (item.status === "QUEUED") item.status = "INGESTED";
    }
    if (this.site() === "wttj" && this.tabsOn && this.tabRun && !this.tabRun.finished) {
      let budget = this.tabBudget;
      while (this.tabRun.queue.length && budget > 0) {
        const next = this.tabRun.queue.shift()!;
        const item = this.items.get(next.itemId)!;
        if (item.status === "QUEUED") item.status = "INGESTED";
        this.tabRun.lastNavigationAt = this.clock;
        budget -= 1;
      }
      if (!this.tabRun.queue.length) this.tabRun.finished = { reason: "COMPLETED", at: this.clock };
    }
  }

  state(): ContinuousRunState | null {
    return this.stored ? (JSON.parse(this.stored) as ContinuousRunState) : null;
  }
}

const terminal = (state: ContinuousRunState | null) => !state || !["RUNNING", "STOPPING"].includes(state.status);

// Alarm ticks (30 s apart), with the worker or the tab reader working
// between them, until the run ends or `until` holds.
async function drive(world: World, capture = createContinuousCapture(world.environment()), until: (world: World) => boolean = () => false, maxTicks = 400) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    await capture.tick();
    if (terminal(world.state()) || until(world)) return capture;
    world.work();
    world.clock += 30_000;
  }
  throw new Error(`the run did not end: ${JSON.stringify({ status: world.state()?.status, activity: world.state()?.activity })}`);
}

function linkedInWorld(total: number, options: { captured?: number[]; loaded?: number } = {}) {
  const world = new World();
  world.jobs = Array.from({ length: total }, (_unused, index) => linkedInJob(index + 1));
  world.loaded = Math.min(total, options.loaded ?? 25);
  for (const index of options.captured ?? []) world.captured.add(cardKey(linkedInJob(index)));
  return world;
}

function wttjWorld(sizes: number[]) {
  const world = new World();
  let index = 0;
  world.pages = sizes.map((size) => Array.from({ length: size }, () => wttjJob(++index)));
  world.tab = { id: 7, url: wttjSearch, closed: false };
  return world;
}

const allSubmitted = (world: World) => world.batches.flatMap((batch) => batch.keys);
const sizes = (world: World) => world.batches.map((batch) => batch.keys.length);

async function start(world: World, site: "linkedin" | "welcome-to-the-jungle") {
  const capture = createContinuousCapture(world.environment());
  const started = await capture.start({ site, tabId: world.tab.id, url: world.tab.url, title: "Customer Success jobs" });
  expect(started.ok).toBe(true);
  return capture;
}

describe("LinkedIn: 'See more jobs'", () => {
  it("skips jobs captured before without using batch slots, continues past 25 automatically, and completes only on the visible end marker (63 jobs, 10 captured: 25 + 25 + 3)", async () => {
    const world = linkedInWorld(63, { captured: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] });
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("COMPLETED");
    expect(state.reason).toBe("All results captured");
    expect(sizes(world)).toEqual([25, 25, 3]);
    const submitted = allSubmitted(world);
    expect(new Set(submitted).size).toBe(53);
    for (const key of world.captured) expect(submitted).not.toContain(key);
    expect(state.totals).toMatchObject({ captured: 53, skipped: 10, failures: 0 });
    expect(state.buffer).toEqual([]);
    expect(state.inFlight).toBeNull();
  });

  it("50 eligible jobs are exactly two batches (60 jobs, 10 captured)", async () => {
    const world = linkedInWorld(60, { captured: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    await drive(world, await start(world, "linkedin"));
    expect(world.state()!.status).toBe("COMPLETED");
    expect(sizes(world)).toEqual([25, 25]);
  });

  it("stalled loading without the end marker: the 7 discovered jobs are submitted and settled, then the run stops with the end not confirmed (never Completed)", async () => {
    const world = linkedInWorld(40, {});
    world.stallAfter = 32;
    world.markerAtEnd = false;
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("STOPPED_NO_MORE_RESULTS");
    expect(state.reason).toMatch(/end of the search was not confirmed/);
    expect(sizes(world)).toEqual([25, 7]);
    expect(state.totals.captured).toBe(32);
    expect(state.diagnostics.some((entry) => entry.event === "NO_MORE_RESULTS")).toBe(true);
  });

  it("a sign-in wall in place of the results stops the run as restricted at once; nothing discovered is lost", async () => {
    const world = linkedInWorld(120);
    const capture = await start(world, "linkedin");
    await drive(world, capture, (current) => current.batches.length === 1);
    world.friction = true;
    await drive(world, capture);
    const state = world.state()!;
    expect(state.status).toBe("STOPPED_RESTRICTED");
    expect(state.reason).toMatch(/sign-in wall or challenge/);
    // Every discovered job is submitted or kept for Resume.
    const kept = [...allSubmitted(world), ...state.buffer.map((item) => item.key)];
    expect(new Set(kept).size).toBe(kept.length);
    expect(world.loaded).toBeLessThan(120);
  });

  it("the next batch is not submitted while any job of the previous one is still queued (the retrieval worker is not running)", async () => {
    const world = linkedInWorld(80);
    world.workerOn = false;
    const capture = await start(world, "linkedin");
    for (let tick = 0; tick < 40; tick += 1) {
      await capture.tick();
      world.clock += 30_000;
    }
    const state = world.state()!;
    expect(state.status).toBe("RUNNING");
    expect(world.batches).toHaveLength(1);
    expect(state.activity).toMatch(/Waiting for the retrieval worker/);
    // Discovery continued up to one buffered batch.
    expect(state.buffer).toHaveLength(25);
    world.workerOn = true;
    await drive(world, capture);
    expect(world.state()!.status).toBe("COMPLETED");
    expect(sizes(world)).toEqual([25, 25, 25, 5]);
  });

  it("LinkedIn rewriting volatile parameters does not pause the run; leaving the search does, keeping the buffer; Resume reopens the search and finishes", async () => {
    const world = linkedInWorld(80);
    world.workerOn = false;
    const capture = await start(world, "linkedin");
    await drive(world, capture, (current) => current.batches.length === 1 && (current.state()?.buffer.length ?? 0) > 0);
    world.tab.url = `${linkedInSearch}&currentJobId=4100000003&trk=public_jobs`;
    world.clock += 30_000;
    await capture.tick();
    expect(world.state()!.status).toBe("RUNNING");
    world.tab.url = "https://www.linkedin.com/feed/";
    await drive(world, capture);
    const paused = world.state()!;
    expect(paused).toMatchObject({ status: "PAUSED", reason: "TAB_NAVIGATED" });
    expect(paused.buffer.length).toBeGreaterThan(0);
    expect(paused.inFlight).not.toBeNull();
    expect(continuousView(paused, world.clock, false)!.buttons).toMatchObject({ resume: true, stop: false, start: false, discard: true });
    // Resume: nothing more is submitted until the batch in flight settles.
    const resumed = await capture.resume({ tabId: null });
    expect(resumed.ok).toBe(true);
    world.clock += 30_000;
    await capture.tick();
    expect(world.batches).toHaveLength(1);
    world.workerOn = true;
    await drive(world, capture);
    expect(world.state()!.status).toBe("COMPLETED");
    expect(new Set(allSubmitted(world)).size).toBe(80);
    expect(allSubmitted(world)).toHaveLength(80);
  });

  it("a closed search tab pauses the run", async () => {
    const world = linkedInWorld(30);
    const capture = await start(world, "linkedin");
    world.tab.closed = true;
    await drive(world, capture);
    expect(world.state()).toMatchObject({ status: "PAUSED", reason: "TAB_CLOSED" });
  });
});

describe("Welcome to the Jungle: numbered pages", () => {
  it("collects 10 + 10 + 5 for batch 1, keeps page 3's other 5 and moves on while batch 1 is in flight, and completes on two-read last-page evidence (10/10/10/10/10/2)", async () => {
    const world = wttjWorld([10, 10, 10, 10, 10, 2]);
    world.tabsOn = false;
    const capture = await start(world, "welcome-to-the-jungle");
    await drive(world, capture, (current) => current.navigations.some((url) => url.endsWith("page=4")));
    // Page 4 opened while batch 1 was still being read.
    expect(world.batches).toHaveLength(1);
    expect([...world.items.values()].every((item) => item.status === "QUEUED")).toBe(true);
    world.tabsOn = true;
    await drive(world, capture);
    const state = world.state()!;
    expect(state.status).toBe("COMPLETED");
    const pageKeys = world.pages.map((page) => page.map(cardKey));
    expect(world.batches[0]!.keys).toEqual([...pageKeys[0]!, ...pageKeys[1]!, ...pageKeys[2]!.slice(0, 5)]);
    expect(world.batches[1]!.keys).toEqual([...pageKeys[2]!.slice(5), ...pageKeys[3]!, ...pageKeys[4]!]);
    expect(world.batches[2]!.keys).toEqual(pageKeys[5]);
    expect(new Set(allSubmitted(world)).size).toBe(52);
    expect(allSubmitted(world)).toHaveLength(52);
    expect(state.diagnostics.some((entry) => entry.event === "LAST_PAGE_CONFIRMED")).toBe(true);
  });

  it("without a last-page signal, an empty next page is retried within bounds, the discovered jobs are submitted, and the run stops with the end not confirmed", async () => {
    const world = wttjWorld([10, 10]);
    world.paginationSignals = false;
    await drive(world, await start(world, "welcome-to-the-jungle"));
    const state = world.state()!;
    expect(state.status).toBe("STOPPED_UNCONFIRMED");
    expect(state.reason).toMatch(/Could not confirm results beyond page 2/);
    expect(sizes(world)).toEqual([20]);
    // Three re-reads, then two reloads of page 3: at most three navigations of it.
    expect(world.navigations.filter((url) => url.endsWith("page=3")).length).toBeLessThanOrEqual(3);
    expect(state.diagnostics.filter((entry) => entry.event === "PAGE_RETRY").length).toBeGreaterThanOrEqual(5);
  });

  it("the user going to another page of the site pauses the run (no navigation of ours was pending)", async () => {
    const world = wttjWorld([10, 10, 10, 10, 10, 10, 10, 10]);
    world.tabsOn = false;
    const capture = await start(world, "welcome-to-the-jungle");
    await capture.tick();
    expect(world.state()!.status).toBe("RUNNING");
    world.tab.url = "https://www.welcometothejungle.com/en/companies/acme";
    await drive(world, capture);
    expect(world.state()).toMatchObject({ status: "PAUSED", reason: "TAB_NAVIGATED" });
  });

  it("Resume with a batch in flight and buffered jobs: the batch is reconciled first, its stopped jobs return to the front of the buffer, and every job is captured once", async () => {
    const world = wttjWorld([10, 10, 10, 10, 10, 10]);
    const capture = await start(world, "welcome-to-the-jungle");
    // Batch 2 submitted; then its reading is slow.
    await drive(world, capture, (current) => current.batches.length === 2);
    world.tabBudget = 3;
    world.work();
    world.tabsOn = false;
    await drive(world, capture, (current) => (current.state()?.buffer.length ?? 0) >= 9);
    const before = world.state()!;
    expect(before.inFlight?.batchNumber).toBe(2);
    await capture.stop();
    const stopped = world.state()!;
    expect(stopped.status).toBe("STOPPED_BY_USER");
    const stoppedKeys = [...world.items.values()].filter((item) => item.lastReason === "BATCH_STOPPED").map((item) => item.key);
    expect(stoppedKeys).toHaveLength(22);
    expect(discardQuestion(stopped)).toMatch(/discovered jobs were not submitted/);
    world.tabsOn = true;
    world.tabBudget = Infinity;
    const resumed = await capture.resume({ tabId: world.tab.id });
    expect(resumed.ok).toBe(true);
    await drive(world, capture);
    const state = world.state()!;
    expect(state.status).toBe("COMPLETED");
    // Batch 3 starts with the returned jobs, in their order.
    expect(world.batches[2]!.keys.slice(0, 22)).toEqual(stoppedKeys);
    expect(world.items.size).toBe(60);
    expect([...world.items.values()].every((item) => item.status === "INGESTED")).toBe(true);
    expect(state.totals.captured).toBe(60);
    expect(state.totals.failures).toBe(0);
  });

  it("after a browser restart, Resume hands the batch's still-queued jobs to the tab reader again, and returns the expired ones to the buffer", async () => {
    const world = wttjWorld([10, 10, 10, 10]);
    world.tabsOn = false;
    const capture = await start(world, "welcome-to-the-jungle");
    await drive(world, capture, (current) => current.batches.length === 1);
    await capture.browserStarted();
    expect(world.state()).toMatchObject({ status: "PAUSED", reason: "BROWSER_RESTARTED" });
    // Chrome cleared the tab reader; an hour later the server expired five jobs.
    world.tabRun = null;
    const expired = [...world.items.values()].slice(0, 5);
    for (const item of expired) Object.assign(item, { status: "AWAITING_DETAILS", lastReason: "INTERRUPTED" });
    world.tabsOn = true;
    const restarted = createContinuousCapture(world.environment());
    expect((await restarted.resume({ tabId: world.tab.id })).ok).toBe(true);
    await drive(world, restarted);
    expect(world.state()!.status).toBe("COMPLETED");
    expect(world.items.size).toBe(40);
    expect([...world.items.values()].every((item) => item.status === "INGESTED")).toBe(true);
    // The expired jobs went back through intake (a later batch), each once.
    const later = world.batches.slice(1).flatMap((batch) => batch.keys);
    for (const item of expired) expect(later.filter((key) => key === item.key)).toHaveLength(1);
  });
});

describe("LinkedIn: what a load brought (November 18, 2026 acceptance follow-up)", () => {
  const events = (world: World) => world.state()!.diagnostics.map((entry) => entry.event);
  const since = (world: World, at: number) => world.clock - at;

  it("the November 18 sequence: loads that add links but no readable card no longer stop the run; jobs that render late are collected and the run completes", async () => {
    const world = linkedInWorld(90, { loaded: 60 });
    world.loadStep = 10;
    // Jobs 61-80 render only 30 s after they load (as in the stopped run,
    // where the page grew 61 -> 71 -> 81 links while 60 cards stayed
    // readable): longer than three loads, within the bounded re-reads.
    for (let index = 61; index <= 80; index += 1) world.renderDelayMs.set(index, 30_000);
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("COMPLETED");
    expect(new Set(allSubmitted(world))).toEqual(new Set(world.jobs.map(cardKey)));
    expect(allSubmitted(world)).toHaveLength(90);
    expect(events(world)).not.toContain("NO_MORE_RESULTS");
  });

  it("jobs on the page that never become readable: bounded re-reads, then Stopped (end not confirmed) naming how many, never Completed; every readable job is captured", async () => {
    const world = linkedInWorld(50, { loaded: 25 });
    world.loadStep = 25;
    for (const index of [30, 31, 32]) world.renderDelayMs.set(index, Infinity);
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("STOPPED_UNCONFIRMED");
    expect(state.reason).toMatch(/^3 loaded job\(s\) on the LinkedIn results could not be read/);
    expect(allSubmitted(world)).toHaveLength(47);
    expect(events(world).filter((event) => event === "UNREAD_RECHECK")).toHaveLength(continuousTimings.unreadRecheckDelaysMs.length);
    expect(state.diagnostics.find((entry) => entry.event === "UNREAD_JOBS")!.detail).toContain(cardKey(linkedInJob(30)));
  });

  it("links to jobs already captured or handled, and links outside the results, never block completion", async () => {
    const world = linkedInWorld(50, { loaded: 25, captured: [3, 4, 40] });
    world.loadStep = 25;
    world.extraLinks = 12;
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("COMPLETED");
    expect(allSubmitted(world)).toHaveLength(47);
    expect(events(world)).not.toContain("UNREAD_RECHECK");
  });

  it("loads that bring only repeated jobs (the page still grows) do not stop the run; new jobs after them are collected", async () => {
    const world = linkedInWorld(50, { loaded: 25 });
    world.loadStep = 25;
    // Five loads in a row repeat earlier jobs (the old rule stopped after 3).
    world.duplicateLoads = 5;
    await drive(world, await start(world, "linkedin"));
    expect(world.state()!.status).toBe("COMPLETED");
    expect(allSubmitted(world)).toHaveLength(50);
  });

  it("repeated jobs without end: at most 10 such loads, one recheck a minute later and one more load, then Stopped (end not confirmed), in bounded time", async () => {
    const world = linkedInWorld(30, { loaded: 25 });
    world.loadStep = 25;
    world.markerAtEnd = false;
    world.duplicateLoads = Infinity;
    const startedAt = world.clock;
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("STOPPED_NO_MORE_RESULTS");
    expect(world.loads).toBe(continuousTimings.maxLoadsWithoutNewJobs + 1);
    expect(events(world)).toContain("STALL_RECHECK");
    // 25 jobs, no more: the loads, their spacing and the recheck stay within
    // a few minutes of alarm ticks (batch settling included).
    expect(since(world, startedAt)).toBeLessThan(15 * 60_000);
    expect(allSubmitted(world)).toHaveLength(25);
  });

  it("a page that stops growing: 3 loads that add nothing, one recheck, one more load, then Stopped (end not confirmed)", async () => {
    const world = linkedInWorld(40, { loaded: 25 });
    world.loadStep = 25;
    world.stallAfter = 32;
    world.markerAtEnd = false;
    await drive(world, await start(world, "linkedin"));
    const state = world.state()!;
    expect(state.status).toBe("STOPPED_NO_MORE_RESULTS");
    // One load to 32, then 3 that add nothing, then the recheck's one load.
    expect(world.loads).toBe(1 + continuousTimings.maxStalledLoads + 1);
    expect(events(world).filter((event) => event === "STALL_RECHECK")).toHaveLength(1);
    expect(allSubmitted(world)).toHaveLength(32);
  });

  it("each load's diagnostics name readable, unread, distinct and raw counts", async () => {
    const world = linkedInWorld(30, { loaded: 25 });
    world.loadStep = 5;
    world.extraLinks = 2;
    await drive(world, await start(world, "linkedin"));
    const click = world.state()!.diagnostics.find((entry) => entry.event === "CLICKED")!;
    expect(JSON.parse(click.detail)).toMatchObject({ readable: 25, unread: 0, uniqueJobs: 25, rawLinks: 27, excludedJobs: 0 });
  });
});

describe("recovery and idempotence", () => {
  it("a restarted service worker continues from storage; a batch stored but not acknowledged is sent again with the same id, staged once", async () => {
    const world = linkedInWorld(30);
    // The backend goes away exactly when the first batch is sent.
    world.failCaptureOnce = true;
    const capture = await start(world, "linkedin");
    await capture.tick();
    const stored = world.state()!;
    expect(stored.inFlight).toMatchObject({ submitted: false });
    expect(stored.activity).toMatch(/Backend unreachable/);
    const batchId = stored.inFlight!.batchId;
    expect(world.batches).toHaveLength(0);
    // A new service worker over the same storage.
    const restarted = createContinuousCapture(world.environment());
    world.clock += 6 * 60_000;
    await drive(world, restarted);
    expect(world.state()!.status).toBe("COMPLETED");
    expect(world.batches[0]!.batchId).toBe(batchId);
    expect(world.items.size).toBe(30);
    expect(world.state()!.workerStarts).toBeGreaterThanOrEqual(2);
  });

  it("a second run in the same service-worker instance counts that instance once for itself", async () => {
    const world = linkedInWorld(30);
    const capture = await start(world, "linkedin");
    await drive(world, capture);
    expect(world.state()!).toMatchObject({ status: "COMPLETED", workerStarts: 1 });
    await capture.discard();
    // The same search again: every job is skipped as captured before.
    expect((await capture.start({ site: "linkedin", tabId: world.tab.id, url: world.tab.url, title: null })).ok).toBe(true);
    await drive(world, capture);
    expect(world.state()!).toMatchObject({ status: "COMPLETED", workerStarts: 1, batchNumber: 0 });
  });

  it("a second service worker does not step while another holds the lease", async () => {
    const world = linkedInWorld(30);
    world.workerOn = false;
    const capture = await start(world, "linkedin");
    await capture.tick();
    const state = world.state()!;
    state.lease = { owner: "another-worker", until: world.clock + 60_000 };
    world.stored = JSON.stringify(state);
    const other = createContinuousCapture(world.environment());
    const before = world.stored;
    await other.tick();
    expect(world.stored).toBe(before);
  });

  it("the user's Stop during a step wins over the step's own copy; the step's bookkeeping is kept and Resume finishes the run", async () => {
    const world = linkedInWorld(30);
    const capture = await start(world, "linkedin");
    // Stop is pressed while the first batch is being sent.
    world.duringCapture = async () => {
      await capture.stop();
    };
    await drive(world, capture);
    const stopped = world.state()!;
    expect(stopped.status).toBe("STOPPED_BY_USER");
    // The batch the step sent is remembered for Resume.
    expect(stopped.inFlight).toMatchObject({ batchNumber: 1 });
    expect(stopped.diagnostics.map((entry) => entry.event)).toContain("STOPPED_BY_USER");
    await capture.resume({ tabId: null });
    await drive(world, capture);
    expect(world.state()!.status).toBe("COMPLETED");
    expect(world.items.size).toBe(30);
    expect(new Set(allSubmitted(world)).size).toBe(allSubmitted(world).length);
  });

  it("a worker stopped mid-step: the instance that takes the run over after the lease counts itself, and the stopped step's late write is discarded", async () => {
    const world = linkedInWorld(30);
    const first = await start(world, "linkedin");
    let takeover: Promise<void> | null = null;
    // While the first instance is sending a batch, its lease runs out and a
    // new instance takes the run over and finishes it.
    world.duringCapture = async () => {
      world.clock += 61_000;
      const second = createContinuousCapture(world.environment());
      takeover = drive(world, second);
      await takeover;
    };
    await first.tick();
    await takeover;
    const state = world.state()!;
    expect(state.status).toBe("COMPLETED");
    expect(state.workerStarts).toBe(2);
    expect(state.diagnostics.map((entry) => entry.event)).toContain("WORKER_RESUMED");
    // The batch is staged once, under one id.
    expect(world.items.size).toBe(30);
    expect(new Set(world.batches.map((batch) => batch.batchId)).size).toBe(world.batches.length);
  });

  it("Start is refused while a run can be resumed; Discard clears it; a restricted run resumes only after the site's stop", async () => {
    const world = linkedInWorld(30);
    const capture = await start(world, "linkedin");
    await capture.stop();
    const again = await capture.start({ site: "linkedin", tabId: world.tab.id, url: world.tab.url, title: null });
    expect(again.ok).toBe(false);
    await capture.discard();
    expect(world.stored).toBeNull();
    const restricted = { ...JSON.parse(JSON.stringify(createRestricted(world.clock + 3_600_000))) } as ContinuousRunState;
    expect(isResumable(restricted, world.clock)).toBe(false);
    expect(isResumable(restricted, world.clock + 3_600_001)).toBe(true);
    expect(continuousView(restricted, world.clock, true)!.resumeNote).toMatch(/Resume is available after/);
  });
});

function createRestricted(until: number): Partial<ContinuousRunState> & Pick<ContinuousRunState, "status" | "stoppedUntil"> {
  return {
    version: 1,
    status: "STOPPED_RESTRICTED",
    stoppedUntil: new Date(until).toISOString(),
    site: "linkedin",
    siteName: "LinkedIn",
    kind: "show-more",
    buffer: [],
    inFlight: null,
    totals: { captured: 0, skipped: 0, failures: 0, refreshed: 0, awaiting: 0 },
    diagnostics: [],
    batchNumber: 0,
    searchUrl: linkedInSearch,
    pageTitle: null,
    page: null,
    activity: "",
    reason: "LinkedIn restricted access",
  } as never;
}

describe("what a numbered results page shows", () => {
  const reading = (keys: string[], skippedUnloaded = 0): ResultCardsReading => ({
    pageUrl: wttjSearch,
    pageTitle: null,
    cards: [],
    counts: { loaded: keys.length, skippedUnloaded, overCap: 0 },
    keys,
    problem: keys.length ? null : "NO_CARDS",
  });
  const description = (patch: Partial<PageDescription> = {}): PageDescription => ({
    href: wttjSearch,
    activePage: 3,
    highestPage: 6,
    nextPresent: true,
    nextDisabled: false,
    nextPage: 4,
    total: null,
    empty: false,
    summary: "",
    ...patch,
  });
  const verdict = (patch: Partial<Parameters<typeof classifyResultsPage>[0]>) =>
    classifyResultsPage({ reading: reading(["a", "b"]), description: description(), page: 3, previousPageKeys: [], seen: 0, ...patch });

  it("a rendered page, and the last page only on its own pagination or a reached total", () => {
    expect(verdict({})).toBe("RENDERED");
    expect(verdict({ page: 6, description: description({ activePage: 6, nextPresent: false }) })).toBe("LAST_PAGE_EVIDENCE");
    expect(verdict({ page: 6, description: description({ activePage: 6, nextDisabled: true }) })).toBe("LAST_PAGE_EVIDENCE");
    expect(verdict({ description: description({ total: 40 }), seen: 40 })).toBe("LAST_PAGE_EVIDENCE");
    // No next control but no page numbers either: not evidence.
    expect(verdict({ description: description({ nextPresent: false, highestPage: null }) })).toBe("RENDERED");
  });

  it("an empty page, repeated jobs, cards still loading, a 'no results' state or a page other than the one asked for are never the end", () => {
    expect(verdict({ reading: reading([]) })).toBe("UNCERTAIN");
    expect(verdict({ previousPageKeys: ["a", "b", "c"] })).toBe("UNCERTAIN");
    expect(verdict({ reading: reading(["a"], 3) })).toBe("UNCERTAIN");
    expect(verdict({ description: description({ empty: true }) })).toBe("UNCERTAIN");
    expect(verdict({ description: description({ activePage: 2 }) })).toBe("UNCERTAIN");
    expect(verdict({ description: null })).toBe("UNCERTAIN");
  });

  it("a sign-in wall or challenge is a restriction", () => {
    expect(verdict({ reading: { ...reading([]), problem: "FRICTION" } })).toBe("RESTRICTED");
  });
});
