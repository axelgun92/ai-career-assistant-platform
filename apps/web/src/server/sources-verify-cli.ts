import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  AdapterError,
  createBrowserSession,
  createFetchTransport,
  createFixtureTransport,
  createPoliteTransport,
  defaultAdapterRegistry,
  fixtureRequestKey,
  missingEnvironment,
  redactUrl,
  type AnySourceAdapter,
  type BrowserDriver,
  type BrowserSession,
  type TransportResponse,
} from "@ai-career/discovery";

// pnpm sources:verify <adapter> --config '<json>' --raw-dir <dir>
// pnpm sources:verify <adapter> --config '<json>' --offline <dir>
//
// Verifies one adapter's response contract with the single low-volume
// request it declares (a GET, or a JSON POST where the adapter gives a
// body), plus, for a list without full descriptions, the one detail request
// derived from it. The responses are saved byte for byte,
// with metadata, in a directory outside the repository; then the adapter's
// mapping runs over them offline and a summary is printed. --offline reruns
// only the mapping over responses saved earlier, with no network access.
// No database is read or written.
//
// A browser-assisted adapter (LinkedIn, feature 14) is verified the same way
// through a fresh, logged-out browser (RETRIEVAL_BROWSER_EXECUTABLE): one
// public page and the one page its follow-up names, with the run's usual
// interval and stop checks. Pass a configuration with one search page and
// one job page, for example --config '{"maxSearchPages":1,"maxDetailsPerRun":1}'.

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function fail(message: string): never {
  console.error(`[sources:verify] ${message}`);
  process.exit(1);
}

function withCredentials(adapter: AnySourceAdapter, url: string): string {
  return adapter.requiredEnv.reduce((value, name) => {
    const secret = encodeURIComponent(process.env[name] ?? "");
    return value.replaceAll(`{${name}}`, secret).replaceAll(encodeURIComponent(`{${name}}`), secret);
  }, url);
}

interface SavedResponse {
  file: string;
  // The fixture-transport key: the URL, or "POST <url> <body>".
  url: string;
  status: number;
  contentType: string | null;
  bytes: number;
  capturedAt: string;
  // Browser-assisted pages: where the browser ended up, the names (never
  // values) of the cookies it held, and the response headers (Set-Cookie as
  // names only).
  finalUrl?: string;
  cookieNames?: string[];
  headers?: Record<string, string>;
}

async function capture(adapter: AnySourceAdapter, config: unknown, rawDir: string): Promise<Record<string, TransportResponse>> {
  const repository = path.resolve(process.cwd());
  const target = path.resolve(rawDir);
  if (target === repository || target.startsWith(`${repository}${path.sep}`)) {
    fail("--raw-dir must be outside the repository: raw responses are never committed");
  }
  const missing = missingEnvironment(adapter, process.env);
  if (missing.length) fail(`set ${missing.join(" and ")} first`);
  mkdirSync(target, { recursive: true });
  if (adapter.requiresBrowser) return captureInBrowser(adapter, config, target);
  const transport = createPoliteTransport(
    createFetchTransport({ userAgent: process.env.RETRIEVAL_USER_AGENT }),
    adapter.minRequestIntervalMs ? { minIntervalMs: adapter.minRequestIntervalMs } : {},
  );
  const recorded: Record<string, TransportResponse> = {};
  const saved: SavedResponse[] = [];

  async function request(url: string, index: number, body?: unknown) {
    const accept = "application/json, text/html;q=0.9, application/rss+xml, application/xml;q=0.9, */*;q=0.5";
    const response =
      body === undefined
        ? await transport.get(withCredentials(adapter, url), { accept })
        : await transport.post(withCredentials(adapter, url), body, { accept });
    const file = `response-${index}.body`;
    writeFileSync(path.join(target, file), response.body);
    const key = fixtureRequestKey(url, body);
    recorded[key] = { ...response, url };
    saved.push({
      file,
      url: body === undefined ? redactUrl(url) : fixtureRequestKey(redactUrl(url), body),
      status: response.status,
      contentType: response.contentType,
      bytes: Buffer.byteLength(response.body),
      capturedAt: new Date().toISOString(),
    });
    console.info(`[sources:verify] ${body === undefined ? "GET" : "POST"} ${redactUrl(url)} -> ${response.status} ${response.contentType ?? "-"} ${Buffer.byteLength(response.body)} bytes`);
    return response;
  }

  const firstUrl = adapter.verificationUrl(config);
  const first = await request(firstUrl, 1, adapter.verificationBody?.(config));
  if (first.status >= 200 && first.status < 300 && adapter.verificationFollowUpUrl) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(first.body);
    } catch {
      // Reported by the mapping check below.
    }
    const followUp = parsed === null ? null : adapter.verificationFollowUpUrl(parsed, config);
    if (followUp) await request(followUp, 2);
    else console.info("[sources:verify] no posting id in the first response; the detail request was not made");
  }
  writeFileSync(path.join(target, "responses.json"), `${JSON.stringify({ adapter: adapter.key, config, responses: saved }, null, 2)}\n`);
  return recorded;
}

async function captureInBrowser(adapter: AnySourceAdapter, config: unknown, target: string): Promise<Record<string, TransportResponse>> {
  const { launchBrowserDriver, parseHtml } = await import("@ai-career/browser-retrieval");
  const driver = await launchBrowserDriver({ executablePath: process.env.RETRIEVAL_BROWSER_EXECUTABLE! });
  const recorded: Record<string, TransportResponse> = {};
  const saved: SavedResponse[] = [];
  // Saves each page as the browser returned it, before the stop checks.
  const recording: BrowserDriver = {
    async navigate(url, options) {
      const page = await driver.navigate(url, options);
      const file = `response-${saved.length + 1}.html`;
      writeFileSync(path.join(target, file), page.html);
      recorded[url] = { url: page.finalUrl, status: page.status ?? 0, contentType: "text/html", body: page.html };
      saved.push({
        file,
        url: redactUrl(url),
        status: page.status ?? 0,
        contentType: "text/html",
        bytes: Buffer.byteLength(page.html),
        capturedAt: new Date().toISOString(),
        finalUrl: redactUrl(page.finalUrl),
        cookieNames: [...page.cookieNames],
        ...(page.headers ? { headers: { ...page.headers } } : {}),
      });
      console.info(`[sources:verify] BROWSER ${redactUrl(url)} -> ${page.status ?? "-"} ${redactUrl(page.finalUrl)} ${Buffer.byteLength(page.html)} bytes`);
      return page;
    },
    close: () => driver.close(),
  };
  const session = browserSession(adapter, recording, parseHtml, 2);
  try {
    const first = await session.open(adapter.verificationUrl(config));
    const followUp = first.status === 200 ? (adapter.verificationFollowUpUrl?.(first.document, config) ?? null) : null;
    if (followUp) await session.open(followUp);
    else console.info("[sources:verify] no job in the first page; the follow-up page was not opened");
  } catch (error) {
    if (!(error instanceof AdapterError)) throw error;
    console.error(`[sources:verify] the browser stopped: ${error.code} ${error.message}`);
  } finally {
    await driver.close();
  }
  writeFileSync(path.join(target, "responses.json"), `${JSON.stringify({ adapter: adapter.key, config, responses: saved }, null, 2)}\n`);
  return recorded;
}

function browserSession(adapter: AnySourceAdapter, driver: BrowserDriver, parse: (html: string, url: string) => Document, maxNavigations: number): BrowserSession {
  return createBrowserSession(driver, {
    minIntervalMs: adapter.minRequestIntervalMs ?? 5_000,
    maxNavigations,
    ...(adapter.browser?.authCookieNames ? { authCookieNames: adapter.browser.authCookieNames } : {}),
    ...(adapter.browser?.detectFriction ? { detectFriction: adapter.browser.detectFriction } : {}),
    parse,
  });
}

// Replays saved pages; a page that was not captured fails like a load error.
function savedPagesDriver(responses: Record<string, TransportResponse>): BrowserDriver {
  return {
    async navigate(url) {
      const page = responses[url];
      if (!page) throw new Error("not captured");
      return { status: page.status, finalUrl: page.url, html: page.body, cookieNames: [] };
    },
    async close() {},
  };
}

function loadSaved(rawDir: string): Record<string, TransportResponse> {
  const index = JSON.parse(readFileSync(path.join(rawDir, "responses.json"), "utf8")) as { responses: SavedResponse[] };
  return Object.fromEntries(
    index.responses.map((saved) => [
      saved.url,
      { url: saved.finalUrl ?? saved.url.replace(/^POST (\S+) .*$/s, "$1"), status: saved.status, contentType: saved.contentType, body: readFileSync(path.join(rawDir, saved.file), "utf8") },
    ]),
  );
}

async function checkMapping(adapter: AnySourceAdapter, config: unknown, responses: Record<string, TransportResponse>) {
  // Every listing is mapped (no title filter) so the contract check does
  // not depend on the response containing a Customer Success job.
  let browser: BrowserSession | undefined;
  if (adapter.requiresBrowser) {
    const { parseHtml } = await import("@ai-career/browser-retrieval");
    browser = browserSession({ ...adapter, minRequestIntervalMs: 0 }, savedPagesDriver(responses), parseHtml, adapter.browser?.maxNavigations ?? 2);
  }
  try {
    const result = await adapter.collect(
      {
        transport: createFixtureTransport(responses),
        discovery: customerSuccessDiscoveryConfiguration,
        keepTitle: () => true,
        env: process.env,
        now: () => new Date(),
        maxPages: 1,
        maxDetailRequests: 1,
        ...(browser ? { browser } : {}),
      },
      config,
    );
    console.info(
      `[sources:verify] mapping: fetched=${result.fetched} mapped=${result.listings.length} issues=${result.issues.length} halted=${result.halted?.code ?? "-"}`,
    );
    for (const listing of result.listings.slice(0, 3)) {
      console.info(
        `[sources:verify]   id=${listing.externalId ?? "-"} title=${JSON.stringify(listing.title)} company=${JSON.stringify(listing.company)} ` +
          `location=${JSON.stringify(listing.location)} description=${listing.description?.length ?? 0} chars ` +
          `apply=${listing.applicationUrl ? new URL(listing.applicationUrl).host : "-"} posted=${listing.postingDate ?? "-"}`,
      );
    }
    return result.issues.length === 0 && result.listings.length > 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof AdapterError) {
      console.error(`[sources:verify] mapping failed: ${error.code} ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function main() {
  const key = process.argv[2];
  if (!key || key.startsWith("--")) fail("usage: pnpm sources:verify <adapter> --config '<json>' (--raw-dir <dir> | --offline <dir>)");
  const adapter = defaultAdapterRegistry.get(key) ?? fail(`unknown adapter ${key}`);
  let rawConfig: unknown = {};
  try {
    rawConfig = JSON.parse(argument("--config") ?? "{}");
  } catch {
    fail("--config must be JSON");
  }
  const config = adapter.configSchema.safeParse(rawConfig);
  if (!config.success) fail("the configuration is invalid for this adapter");
  const offline = argument("--offline");
  const rawDir = argument("--raw-dir");
  if (!offline && !rawDir) fail("pass --raw-dir <dir> (outside the repository) or --offline <dir>");
  const responses = offline ? loadSaved(offline) : await capture(adapter, config.data, rawDir!);
  process.exitCode = await checkMapping(adapter, config.data, responses);
}

main().catch((error: unknown) => {
  console.error(`[sources:verify] failed: ${error instanceof AdapterError ? `${error.code} ${error.message}` : error instanceof Error ? error.name : "UnknownError"}`);
  process.exitCode = 1;
});
