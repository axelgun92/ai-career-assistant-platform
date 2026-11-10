// LinkedIn's logged-out results page as Alex's Chrome showed it on November
// 5, 2026 (E3), and the results reader's friction checks. Offline: the
// reader runs as Chrome runs it, serialized into a jsdom page.
//
// What E3 proves, and what it does not:
// - the same five reCAPTCHA nodes are in the page in every state (the list
//   alone, the app promotion, the central sign-in modal): the invisible
//   reCAPTCHA Enterprise badge (div.grecaptcha-badge, display:none) and its
//   logo, anchor iframe, error and response field, none with a box. The
//   reader matched them by presence ([class*="captcha"], iframe[src*="captcha"])
//   and answered FRICTION while 120 job cards were loaded and shown: the
//   original false FRICTION;
// - LinkedIn's Apply and Save sign-in modals (with a password form) are in
//   the page in every state, hidden (visibility:hidden overlay, a hidden form);
// - the central "Sign in to view more jobs" modal is not in the export (it
//   kept only the first 40 dialog-like elements); its state shows only as the
//   body's overflow-hidden scroll lock. Its markup below follows LinkedIn's
//   contextual sign-in modal classes seen in the export, shown; Alex's
//   screenshot shows its controls (Continue with Google, Sign in with Email,
//   Join now) and the dismiss button;
// - the "LinkedIn is better on the app" promotion is not in any export at
//   all; the screenshot shows it (Open the app, a dismiss button, no sign-in
//   control).
// What it does not prove: that every job detail is retrievable while the
// central modal is shown. The reader only reads cards already in the page;
// LinkedIn job details are read separately, server-side, in a fresh
// logged-out browser (P1), so the modal in Alex's tab is not on that path.
// Agreed contract (Decision 2, November 5, 2026): a shown sign-in modal over
// loaded, readable cards is not FRICTION; the cards are read, the modal is
// never dismissed or used, and the user is told it is there. FRICTION is a
// sign-in or checkpoint address, a shown challenge, or a sign-in prompt with
// no readable card behind it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readingSummary } from "../../apps/extension/src/page-capture-view";
import { linkedInF0ResultsPage } from "../support/linkedin-guest-pages";
import { runResultsReader } from "../support/page-capture-pages";
import { runProbe } from "../support/wttj-tab-pages";

interface Node {
  tag: string;
  className: string | null;
  rects: number;
  display: string;
  hiddenBy: string | null;
  outerHTML: string;
}
const e3 = JSON.parse(readFileSync("tests/fixtures/real-captures/linkedin-e3-friction.json", "utf8")) as {
  states: Record<"list" | "promo" | "modal", { loadedCards: number; bodyClass: string; frictionNodes: Node[]; dialogs: Array<Node & { hasPassword: boolean }> }>;
};
const f0 = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/page-capture/linkedin-f0-cards.json"), "utf8")) as { page: string; cards: string[] };
const searchUrl = "https://www.linkedin.com/jobs/search?keywords=Customer%20Success%20Manager&location=United%20States&geoId=103644278";

// The real badge markup as exported (its inline style hides it).
const badge = e3.states.list.frictionNodes[0]!.outerHTML;
const withBody = (extra: string, bodyClass = "") =>
  linkedInF0ResultsPage(f0.cards).replace("<body>", `<body class="${bodyClass}">`).replace("</body>", `${extra}</body>`);
// LinkedIn's contextual sign-in modal (Apply/Save), as the export shows its
// structure; `open` shows it.
const contextualModal = (open: boolean) => `<div class="contextual-sign-in-modal"><div class="modal modal--contextual-sign-in" role="dialog">
  <div class="modal__overlay" style="visibility:${open ? "visible" : "hidden"}">
    <section class="modal__wrapper" style="width:360px">
      <button class="modal__dismiss" aria-label="Dismiss"></button>
      <h2 class="contextual-sign-in-modal__context-screen-title">Sign in to view more jobs</h2>
      <div class="contextual-sign-in-modal__google-sign-in-primary"><button>Continue with Google</button></div>
      <form class="contextual-sign-in-modal__sign-in-form" style="display:none"><input type="email"><input type="password"><button>Sign in</button></form>
      <button class="contextual-sign-in-modal__sign-in-with-email-cta">Sign in with Email</button>
      <p class="contextual-sign-in-modal__join-now">New to LinkedIn? <a class="contextual-sign-in-modal__join-link" href="/signup">Join now</a></p>
    </section>
  </div>
</div></div>`;
const promotion = `<div class="app-promo-toast"><button aria-label="Dismiss">×</button><p>LINKEDIN</p><h3>LinkedIn is better on the app</h3><p>Don't have the app? Get it in the Microsoft Store.</p><a href="ms-windows-store://pdp/?productid=x">Open the app</a></div>`;

describe("the E3 exports", () => {
  it("hold the same hidden reCAPTCHA badge in every state, with job cards loaded", () => {
    for (const [name, state] of Object.entries(e3.states)) {
      expect(state.loadedCards, name).toBe(120);
      expect(state.frictionNodes.map((node) => node.className ?? node.tag), name).toEqual(["grecaptcha-badge", "grecaptcha-logo", "", "grecaptcha-error", "g-recaptcha-response"]);
      expect(state.frictionNodes.every((node) => node.rects === 0 && node.hiddenBy !== null), name).toBe(true);
    }
    expect(badge).toContain('class="grecaptcha-badge"');
    expect(badge).toContain("display: none");
  });

  it("show the central modal only as the body's scroll lock, and the promotion not at all", () => {
    expect(e3.states.list.bodyClass).toBe("");
    expect(e3.states.promo.bodyClass).toBe("");
    expect(e3.states.modal.bodyClass).toBe("overflow-hidden");
    for (const state of Object.values(e3.states)) {
      expect(state.dialogs).toHaveLength(40);
      // The only password fields are the hidden Apply/Save sign-in forms.
      const forms = state.dialogs.filter((dialog) => dialog.tag === "form");
      expect(forms.every((form) => form.display === "none")).toBe(true);
    }
  });
});

describe("the results reader on LinkedIn's logged-out results page", () => {
  it("reads the loaded cards beside the hidden reCAPTCHA badge (the false FRICTION)", () => {
    const result = runResultsReader(withBody(badge), searchUrl, "linkedin");
    expect(result.problem).toBeNull();
    expect(result.cards).toHaveLength(5);
  });

  it("reads the cards beside the hidden Apply/Save sign-in modals and the app promotion", () => {
    const result = runResultsReader(withBody(`${badge}${contextualModal(false)}${contextualModal(false)}${promotion}`), searchUrl, "linkedin");
    expect(result.problem).toBeNull();
    expect(result.cards).toHaveLength(5);
  });

  it("reads the loaded cards behind a shown sign-in modal, leaving the modal untouched, and says it is there", () => {
    const html = withBody(`${badge}${contextualModal(true)}${promotion}`, "overflow-hidden");
    const result = runResultsReader(html, searchUrl, "linkedin");
    expect(result.problem).toBeNull();
    expect(result.cards).toHaveLength(5);
    expect(result.cards.map((card) => card.siteJobId)).toEqual(runResultsReader(withBody(""), searchUrl, "linkedin").cards.map((card) => card.siteJobId));
    expect(result.notice).toBe("SIGN_IN_PROMPT_SHOWN");
    // Read only: no click, focus, scroll or navigation (the dismiss button is never used).
    expect(result.calls).toEqual([]);
    expect(readingSummary(result)).toContain("the prompt was left as it is");
    // Without the modal there is no notice.
    expect(runResultsReader(withBody(`${badge}${contextualModal(false)}${promotion}`), searchUrl, "linkedin").notice).toBeNull();
  });

  it("reports FRICTION for a shown sign-in modal with no readable card behind it", () => {
    const page = `<!doctype html><html><head><title>LinkedIn</title></head><body class="overflow-hidden"><main><p>Jobs</p></main>${badge}${contextualModal(true)}</body></html>`;
    const result = runResultsReader(page, searchUrl, "linkedin");
    expect(result.problem).toBe("FRICTION");
    expect(result.cards).toEqual([]);
    expect(readingSummary(result)).toMatch(/^This page shows a sign-in wall or security check instead of the results/);
    // Without the modal the same page is simply empty.
    expect(runResultsReader(page.replace(contextualModal(true), ""), searchUrl, "linkedin").problem).toBe("NO_CARDS");
  });

  it("does not take a job link inside a shown sign-in modal as a result card", () => {
    const modalWithJob = contextualModal(true).replace("</h2>", '</h2><a href="https://www.linkedin.com/jobs/view/4999999999">Some other job</a>');
    const result = runResultsReader(withBody(`${badge}${modalWithJob}`, "overflow-hidden"), searchUrl, "linkedin");
    expect(result.cards).toHaveLength(5);
    expect(result.cards.map((card) => card.siteJobId)).not.toContain("4999999999");
  });

  it("never takes a page-wide wrapper with a modal class (such as modal-open) for the prompt", () => {
    const wrapped = withBody("").replace("<body>", "").replace(/<body[^>]*>/, '<body class="modal-open"><div class="app-modal-root">').replace("</body>", "</div></body>");
    const result = runResultsReader(wrapped, searchUrl, "linkedin");
    expect(result.problem).toBeNull();
    expect(result.cards).toHaveLength(5);
    expect(result.notice).toBeNull();
  });

  it("stops at a shown reCAPTCHA challenge, and still at a sign-in or checkpoint address", () => {
    const challenge = `<iframe src="https://www.google.com/recaptcha/enterprise/bframe?k=x" title="recaptcha challenge expires in two minutes"></iframe>`;
    expect(runResultsReader(withBody(`${badge}${challenge}`), searchUrl, "linkedin").problem).toBe("FRICTION");
    expect(runResultsReader(withBody(""), "https://www.linkedin.com/authwall?trk=x", "linkedin").problem).toBe("FRICTION");
    expect(runResultsReader(withBody(""), "https://www.linkedin.com/checkpoint/challenge/abc", "linkedin").problem).toBe("FRICTION");
  });

  it("does not count a reCAPTCHA badge that is shown (a branding badge, not a challenge)", () => {
    const shownBadge = badge.replace("display: none;", "display: block;");
    expect(runResultsReader(withBody(shownBadge), searchUrl, "linkedin").problem).toBeNull();
  });
});

describe("the background-tab job-page check", () => {
  const job = "https://www.welcometothejungle.com/en/companies/x/jobs/customer-success-manager_chicago_abc";
  const page = (extra: string) => `<!doctype html><html><head><title>Customer Success Manager - X</title></head><body><main><h1>Customer Success Manager</h1>${extra}</main></body></html>`;

  it("ignores challenge markup the page keeps hidden, and stops at one it shows", () => {
    expect(runProbe(page('<div id="challenge-form" style="display:none"></div>'), job, 200).hard).toBeNull();
    expect(runProbe(page('<div id="challenge-form"></div>'), job, 200).hard).toBe("CHALLENGE");
    expect(runProbe(page('<iframe style="visibility:hidden" src="https://challenges.cloudflare.com/x"></iframe>'), job, 200).hard).toBeNull();
  });
});
