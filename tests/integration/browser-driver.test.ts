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
  // LinkedIn Option A: a job page with every kind of subresource, whose
  // scripts would change the page and fetch more if they ran.
  if (path === "/app.js") return { status: 200, type: "text/javascript", body: 'document.querySelector("h1").textContent = "Changed by script"; fetch("/xhr");' };
  if (path === "/style.css") return { status: 200, type: "text/css", body: "h1 { color: red; }" };
  if (path === "/xhr" || path === "/frame") return { status: 200, type: "text/html", body: "<html><body>more</body></html>" };
  if (path === "/moved") return { status: 301, type: "text/html", body: "", headers: { location: "/rich-job" } };
  if (path === "/rich-job") {
    return {
      status: 200,
      type: "text/html",
      body: `<html><head><title>Job</title><link rel="stylesheet" href="/style.css"><link rel="preload" href="/font.woff2" as="font" crossorigin>
        <script src="/app.js"></script><script>document.documentElement.setAttribute("data-inline-script", "ran");</script></head>
        <body><h1 class="top-card-layout__title">Customer Success Manager</h1><div class="show-more-less-html__markup"><p>The full job description.</p></div>
        <img src="/pixel.png"><iframe src="/frame"></iframe></body></html>`,
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
      // The page as the site sent it, before any script ran (November 6,
      // 2026: LinkedIn's employer apply link is read from it when the
      // rendered page no longer has it). No second request is made for it.
      expect(job.servedHtml).toContain('<h1 class="top-card-layout__title">Customer Success Manager</h1>');
      expect(requests.filter((request) => request.path === "/job")).toHaveLength(1);
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

describe("the Playwright browser driver without page scripts (LinkedIn Option A)", () => {
  const paths = () => requests.map((request) => request.path);

  it("requests only the job page's document: no script runs, every subresource is refused, and the counts say so", async () => {
    requests.length = 0;
    const driver = await launchBrowserDriver({ executablePath, pageScripts: "skip" });
    try {
      const page = await driver.navigate(`${origin}/rich-job`, { timeoutMs: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(paths()).toEqual(["/rich-job"]);
      const document = parseHtml(page.html, page.finalUrl);
      // The document as sent: no script changed it.
      expect(document.querySelector("h1")?.textContent).toBe("Customer Success Manager");
      expect(document.documentElement.getAttribute("data-inline-script")).toBeNull();
      expect(document.querySelector(".show-more-less-html__markup")?.textContent).toBe("The full job description.");
      expect(page.servedHtml).toContain("The full job description.");
      expect(page.requests).toMatchObject({ pageScripts: "skip", documentRequests: 1, redirects: 0, sentRequests: 1 });
      // With JavaScript off the browser does not even ask for the script
      // file; the stylesheet, preloaded font, image and frame are refused.
      expect(page.requests!.blockedByType).toEqual({ stylesheet: 1, font: 1, image: 1, document: 1 });
      expect(page.requests!.blockedRequests).toBe(4);
    } finally {
      await driver.close();
    }
  });

  it("the same page with scripts on (the restored setting) runs them and fetches their requests, as before", async () => {
    requests.length = 0;
    const driver = await launchBrowserDriver({ executablePath });
    try {
      const page = await driver.navigate(`${origin}/rich-job`, { timeoutMs: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(paths()).toEqual(expect.arrayContaining(["/rich-job", "/app.js", "/style.css", "/frame"]));
      expect(paths().some((path) => path.startsWith("/pixel.png") || path.startsWith("/font.woff2"))).toBe(false);
      expect(parseHtml(page.html, page.finalUrl).documentElement.getAttribute("data-inline-script")).toBe("ran");
      expect(page.requests).toMatchObject({ pageScripts: "run", documentRequests: 1, redirects: 0 });
      expect(page.requests!.sentRequests).toBeGreaterThan(1);
      expect(page.requests!.blockedByType).toMatchObject({ image: 1 });
    } finally {
      await driver.close();
    }
  });

  it("follows the document's own redirects (each hop counted), and still refuses a page navigating by itself", async () => {
    requests.length = 0;
    const driver = await launchBrowserDriver({ executablePath, pageScripts: "skip" });
    try {
      const moved = await driver.navigate(`${origin}/moved`, { timeoutMs: 15_000 });
      expect(moved).toMatchObject({ status: 200, finalUrl: `${origin}/rich-job` });
      expect(moved.requests).toMatchObject({ documentRequests: 2, redirects: 1, sentRequests: 2 });
      expect(paths()).toEqual(["/moved", "/rich-job"]);
      requests.length = 0;
      const reload = await driver.navigate(`${origin}/self-reload`, { timeoutMs: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(reload.status).toBe(429);
      expect(paths()).toEqual(["/self-reload"]);
    } finally {
      await driver.close();
    }
  });

  it("a stop carries the navigation's counts: a 429, a redirect to a sign-in wall, and a failed load", async () => {
    requests.length = 0;
    const driver = await launchBrowserDriver({ executablePath, pageScripts: "skip" });
    try {
      const options = { minIntervalMs: 10, maxNavigations: 5, authCookieNames: ["li_at"], detectFriction: detectLinkedInFriction, parse: parseHtml };
      await expect(createBrowserSession(driver, options).open(`${origin}/limited`)).rejects.toMatchObject({
        code: "RATE_LIMITED",
        details: { status: 429, requests: { pageScripts: "skip", documentRequests: 1, sentRequests: 1 } },
      });
      await expect(createBrowserSession(driver, options).open(`${origin}/to-authwall`)).rejects.toMatchObject({
        code: "ACCESS_DENIED",
        details: { requests: { documentRequests: 2, redirects: 1 } },
      });
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      await expect(createBrowserSession(driver, options).open(`http://127.0.0.1:${port}/job`)).rejects.toMatchObject({
        code: "NETWORK",
        details: { requests: { pageScripts: "skip", blockedRequests: 0 } },
      });
      expect(paths()).toEqual(["/limited", "/to-authwall", "/authwall?trk=x"]);
    } finally {
      await driver.close();
    }
  });
});
