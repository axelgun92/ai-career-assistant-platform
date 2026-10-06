import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  evaluationFailure,
  isQueuedTooLong,
  queuedTooLongMs,
} from "../../apps/web/src/components/evaluation/evaluation-failure";
import {
  StatusNotices,
  type StatusNoticesProps,
} from "../../apps/web/src/components/evaluation/status-notices";
import { ExternalLink, safeExternalUrl } from "../../apps/web/src/components/external-link";
import {
  fieldErrorsFromIssues,
  ManualOpportunityFields,
} from "../../apps/web/src/components/manual-opportunity-fields";

describe("evaluation failure presentation", () => {
  it("maps known codes to safe messages", () => {
    expect(evaluationFailure("PROVIDER_TIMEOUT")).toEqual({
      code: "PROVIDER_TIMEOUT",
      message: "The AI provider did not respond in time.",
    });
    expect(evaluationFailure("STRUCTURED_OUTPUT_INVALID").message).toMatch(/did not pass validation/);
  });

  it("uses a generic message for unmapped codes and rejects malformed codes", () => {
    expect(evaluationFailure("SOME_NEW_CODE")).toEqual({
      code: "SOME_NEW_CODE",
      message: "The evaluation stopped before it could produce a validated result.",
    });
    for (const code of [null, undefined, "", "lowercase", "<script>", "CODE WITH SPACES", "A".repeat(65)]) {
      expect(evaluationFailure(code).code).toBe("UNKNOWN");
    }
  });
});

describe("queued-too-long detection", () => {
  const queuedAt = "2026-10-06T12:00:00.000Z";
  const queued = Date.parse(queuedAt);

  it("flags a pending task past the threshold only", () => {
    expect(isQueuedTooLong("PENDING", queuedAt, queued + queuedTooLongMs + 1)).toBe(true);
    expect(isQueuedTooLong("PENDING", queuedAt, queued + queuedTooLongMs)).toBe(false);
    expect(isQueuedTooLong("RUNNING", queuedAt, queued + 10 * queuedTooLongMs)).toBe(false);
    expect(isQueuedTooLong("COMPLETED", queuedAt, queued + 10 * queuedTooLongMs)).toBe(false);
  });

  it("does not guess without a valid queue time or check time", () => {
    expect(isQueuedTooLong("PENDING", undefined, Date.now())).toBe(false);
    expect(isQueuedTooLong("PENDING", "not a date", Date.now())).toBe(false);
    expect(isQueuedTooLong("PENDING", queuedAt, null)).toBe(false);
  });
});

describe("evaluation status notices", () => {
  const base: StatusNoticesProps = {
    latestStatus: "COMPLETED",
    failure: null,
    fallbackCompletedAt: null,
    hasEarlierCompleted: false,
    queuedTooLong: false,
    isolatedFailure: false,
  };
  const render = (props: Partial<StatusNoticesProps>) =>
    renderToStaticMarkup(<StatusNotices {...base} {...props} />);

  it("shows the failure code, a safe message, and that the last completed result is displayed", () => {
    const html = render({
      latestStatus: "FAILED",
      failure: evaluationFailure("PROVIDER_TIMEOUT"),
      fallbackCompletedAt: "10/6/2026, 12:00:00 PM",
      hasEarlierCompleted: true,
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("<code>PROVIDER_TIMEOUT</code>");
    expect(html).toContain("The AI provider did not respond in time.");
    expect(html).toContain("most recent completed evaluation (completed 10/6/2026, 12:00:00 PM) is shown below");
  });

  it("is accurate about earlier results when none is displayed", () => {
    const failure = evaluationFailure("UNKNOWN");
    expect(render({ latestStatus: "FAILED", failure, hasEarlierCompleted: true }))
      .toContain("remain available in the evaluation history");
    expect(render({ latestStatus: "FAILED", failure }))
      .toContain("No completed evaluation is available yet.");
  });

  it("points at the worker when a task has been queued too long", () => {
    const html = render({ latestStatus: "PENDING", queuedTooLong: true });
    expect(html).toContain("Evaluation is queued");
    expect(html).toContain("worker may not be running");
    expect(html).toContain("pnpm worker:evaluations");
    expect(render({ latestStatus: "PENDING" })).not.toContain("worker may not be running");
  });
});

describe("external links", () => {
  it("only links http and https URLs", () => {
    expect(safeExternalUrl("https://example.com/jobs/1")).toBe("https://example.com/jobs/1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    for (const value of ["javascript:alert(1)", "data:text/html,hi", "/relative", "not a url", "", null]) {
      expect(safeExternalUrl(value)).toBeNull();
    }
  });

  it("opens safe links in a new tab without opener access and leaves unsafe ones as text", () => {
    const safe = renderToStaticMarkup(<ExternalLink href="https://example.com/apply" />);
    expect(safe).toContain('href="https://example.com/apply"');
    expect(safe).toContain('target="_blank"');
    expect(safe).toContain('rel="noopener noreferrer"');
    const unsafe = renderToStaticMarkup(<ExternalLink href="javascript:alert(1)" />);
    expect(unsafe).not.toContain("<a");
    expect(unsafe).toContain("javascript:alert(1)");
    expect(renderToStaticMarkup(<ExternalLink href={null} />)).toBe("Unknown");
  });
});

describe("manual opportunity field errors", () => {
  it("maps API issues to fields and keeps unmatched issues form-level", () => {
    expect(
      fieldErrorsFromIssues([
        { path: "rawText", message: "Must contain visible text" },
        { path: "sourceUrl", message: "Invalid URL" },
        { path: "sourceUrl", message: "Second message is ignored" },
        { path: "", message: "Unrecognized key: extra" },
        { path: "rawText" },
      ]),
    ).toEqual({
      fieldErrors: { rawText: "Must contain visible text", sourceUrl: "Invalid URL" },
      formErrors: ["Unrecognized key: extra"],
    });
    expect(fieldErrorsFromIssues(undefined)).toEqual({ fieldErrors: {}, formErrors: [] });
  });

  it("marks invalid fields and associates their messages", () => {
    const html = renderToStaticMarkup(
      <ManualOpportunityFields fieldErrors={{ rawText: "Must contain visible text" }} />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="rawText-error"');
    expect(html).toContain('id="rawText-error"');
    expect(html).toContain("Must contain visible text");
    expect(html.match(/aria-invalid/g)).toHaveLength(1);
  });

  it("defaults the domain to Customer Success", () => {
    const html = renderToStaticMarkup(<ManualOpportunityFields fieldErrors={{}} />);
    expect(html).toMatch(/<option value="customer-success" selected="">Customer Success<\/option>/);
  });
});
