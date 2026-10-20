// Feature 14: the production browser driver (packages/browser-retrieval)
// with a real headless Chromium against a local fixture server on
// 127.0.0.1; nothing reaches the network. Checks the fresh, logged-out
// context (no cookies carried between runs), that images, fonts and media
// are not downloaded, the statuses and Retry-After it reports, a redirect to
// a sign-in wall stopping the session with no further request, a page that
// tries to reload itself (as LinkedIn's anti-bot interstitial does) sending
// nothing more, response headers kept with cookie values dropped, and clean
// disposal. Uses PLAYWRIGHT_CHROMIUM_EXECUTABLE when set, else Playwright's
// own Chromium.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowserDriver, parseHtml } from "@ai-career/browser-retrieval";
import { createBrowserSession, detectLinkedInFriction } from "@ai-career/discovery";
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
const requests: Array<{ path: string; cookie: string | undefined }> = [];
let server: Server;
let origin = "";

function respond(request: IncomingMessage) {
  const path = request.url ?? "/";
  if (path.startsWith("/pixel.png") || path.startsWith("/font.woff2")) return { status: 200, type: "application/octet-stream", body: "x" };
  if (path === "/set-cookie") return { status: 200, type: "text/html", body: "<html><body><p>hello</p></body></html>", headers: { "set-cookie": "visitor=1; Path=/" } };
  if (path === "/limited") return { status: 429, type: "text/html", body: "<html><body>slow down</body></html>", headers: { "retry-after": "120" } };
  if (path === "/refused") return { status: 999, type: "text/html", body: "<html><body></body></html>" };
  if (path === "/to-authwall") return { status: 302, type: "text/html", body: "", headers: { location: "/authwall?trk=x" } };
  if (path.startsWith("/self-reload")) {
    return {
      status: 429,
      type: "text/html",
      headers: { "set-cookie": "challenge=secret-value; Path=/", "x-test": "1" },
      body: `<html><head><meta http-equiv="refresh" content="0;url=/home"><script>window.onload = function () { document.cookie = "ccookie=1"; location.search = "?again=1"; };</script></head><body></body></html>`,
    };
  }
  if (path.startsWith("/authwall")) return { status: 200, type: "text/html", body: '<html><body><form class="join-form"><input name="email"></form></body></html>' };
  return {
    status: 200,
    type: "text/html",
    body: `<html><head><title>Job</title><link rel="preload" href="/font.woff2" as="font" crossorigin></head>
      <body><h1 class="top-card-layout__title">Customer Success Manager</h1><img src="/pixel.png"></body></html>`,
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ path: request.url ?? "/", cookie: request.headers.cookie });
    const reply = respond(request);
    response.writeHead(reply.status, { "content-type": reply.type, ...(reply.headers ?? {}) });
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the Playwright browser driver", () => {
  it("starts every run logged out with no cookies, and skips images and fonts", async () => {
    requests.length = 0;
    const first = await launchBrowserDriver({ executablePath });
    try {
      const page = await first.navigate(`${origin}/set-cookie`, { timeoutMs: 15_000 });
      expect(page).toMatchObject({ status: 200, finalUrl: `${origin}/set-cookie`, cookieNames: ["visitor"] });
      const job = await first.navigate(`${origin}/job`, { timeoutMs: 15_000 });
      expect(parseHtml(job.html, job.finalUrl).querySelector(".top-card-layout__title")?.textContent).toBe("Customer Success Manager");
    } finally {
      await first.close();
    }
    const second = await launchBrowserDriver({ executablePath });
    try {
      const page = await second.navigate(`${origin}/job`, { timeoutMs: 15_000 });
      expect(page.cookieNames).toEqual([]);
    } finally {
      await second.close();
    }
    // The second run's browser sent no cookie from the first.
    expect(requests.filter((request) => request.path === "/job").map((request) => request.cookie)).toEqual(["visitor=1", undefined]);
    expect(requests.some((request) => request.path.startsWith("/pixel.png") || request.path.startsWith("/font.woff2"))).toBe(false);
  });

  it("reports statuses and Retry-After, and a closed driver navigates no more", async () => {
    const driver = await launchBrowserDriver({ executablePath });
    const limited = await driver.navigate(`${origin}/limited`, { timeoutMs: 15_000 });
    expect(limited).toMatchObject({ status: 429, retryAfterSeconds: 120 });
    expect(await driver.navigate(`${origin}/refused`, { timeoutMs: 15_000 })).toMatchObject({ status: 999 });
    await driver.close();
    await expect(driver.navigate(`${origin}/job`, { timeoutMs: 15_000 })).rejects.toThrow();
  });

  it("never lets a page navigate by itself, and keeps headers without cookie values", async () => {
    requests.length = 0;
    const driver = await launchBrowserDriver({ executablePath });
    try {
      const page = await driver.navigate(`${origin}/self-reload`, { timeoutMs: 15_000 });
      expect(page.status).toBe(429);
      expect(page.headers).toMatchObject({ "x-test": "1", "set-cookie": "challenge" });
      expect(JSON.stringify(page.headers)).not.toContain("secret-value");
      // Long enough for the onload reload and the meta refresh to fire.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(requests.map((request) => request.path)).toEqual(["/self-reload"]);
    } finally {
      await driver.close();
    }
  });

  it("stops the session when a page redirects to a sign-in wall, with no further request", async () => {
    requests.length = 0;
    const driver = await launchBrowserDriver({ executablePath });
    try {
      const session = createBrowserSession(driver, {
        minIntervalMs: 10,
        maxNavigations: 5,
        authCookieNames: ["li_at"],
        detectFriction: detectLinkedInFriction,
        parse: parseHtml,
      });
      await expect(session.open(`${origin}/to-authwall`)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(session.open(`${origin}/job`)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      expect(requests.map((request) => request.path)).toEqual(["/to-authwall", "/authwall?trk=x"]);
    } finally {
      await driver.close();
    }
  });
});
