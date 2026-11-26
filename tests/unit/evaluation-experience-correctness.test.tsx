import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluationFailure } from "../../apps/web/src/components/evaluation/evaluation-failure";
import {
  evaluationQueueState,
  queuedTooLongMs,
} from "../../apps/web/src/server/evaluation-queue-state";
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

describe("server-computed queue state", () => {
  const createdAt = new Date("2026-10-06T12:00:00.000Z");
  const at = (ms: number) => new Date(createdAt.getTime() + ms);

  it("flags a pending task only past the threshold", () => {
    const pending = { status: "PENDING", leaseExpiresAt: null, createdAt };
    expect(evaluationQueueState(pending, at(queuedTooLongMs))).toBe("QUEUED");
    expect(evaluationQueueState(pending, at(queuedTooLongMs + 1))).toBe("QUEUED_LONG");
    expect(evaluationQueueState({ ...pending, createdAt: "not a date" }, at(10 * queuedTooLongMs))).toBe("QUEUED");
  });

  it("reports an expired lease as stale, never as a stopped worker", () => {
    const running = { status: "RUNNING", leaseExpiresAt: at(300_000), createdAt };
    expect(evaluationQueueState(running, at(300_000))).toBe("RUNNING");
    expect(evaluationQueueState(running, at(300_001))).toBe("RUNNING_STALE");
    expect(evaluationQueueState({ ...running, leaseExpiresAt: null }, at(10_000_000))).toBe("RUNNING");
    expect(evaluationQueueState({ ...running, status: "FAILED" }, at(0))).toBe("FAILED");
    expect(evaluationQueueState({ ...running, status: "COMPLETED" }, at(0))).toBe("COMPLETED");
  });
});

describe("evaluation status notices", () => {
  const base: StatusNoticesProps = {
    latestStatus: "COMPLETED",
    failure: null,
    fallbackCompletedAt: null,
    hasEarlierCompleted: false,
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
    const html = render({ latestStatus: "PENDING", queueState: "QUEUED_LONG" });
    expect(html).toContain("Evaluation is queued");
    expect(html).toContain("If the evaluation worker isn&#x27;t running");
    expect(html).toContain("pnpm worker:evaluations");
    expect(render({ latestStatus: "PENDING", queueState: "QUEUED" })).not.toContain("worker isn");
  });

  it("describes a stale lease honestly, without claiming the worker stopped", () => {
    const html = render({ latestStatus: "RUNNING", queueState: "RUNNING_STALE" });
    expect(html).toContain("run longer than its worker lease");
    expect(html).toContain("may still be in progress, or the worker may have stopped");
    expect(html).not.toContain("Evaluation is running.");
    expect(html).not.toMatch(/worker (has )?stopped\./);
    expect(render({ latestStatus: "RUNNING", queueState: "RUNNING" })).toContain("Evaluation is running.");
  });

  it("offers another evaluation only when the opportunity is evaluable", () => {
    const failure = evaluationFailure("PROVIDER_TIMEOUT");
    expect(render({ latestStatus: "FAILED", failure })).toContain("You may request another evaluation.");
    expect(render({ latestStatus: "FAILED", failure, evaluable: false })).not.toContain("request another evaluation");
  });

  it("maps every produced failure-code family to a safe message", () => {
    expect(evaluationFailure("PROVIDER_HTTP_401").message).toContain("rejected the API key");
    expect(evaluationFailure("PROVIDER_HTTP_429").message).toContain("rate-limited");
    expect(evaluationFailure("PROVIDER_HTTP_503").message).toContain("server error");
    expect(evaluationFailure("PROVIDER_HTTP_400").message).toBe("The AI provider rejected the request.");
    expect(evaluationFailure("OPERATION_METADATA_PERSISTENCE_DATABASE_UNAVAILABLE").message).toContain("database was unavailable");
    expect(evaluationFailure("OPERATION_METADATA_PERSISTENCE_UNKNOWN_DATABASE_ERROR").message).toContain("usage could not be recorded");
    for (const code of [
      "EVALUATION_LEASE_EXPIRED", "WORKER_INTERRUPTED", "STAGE_EXECUTION_FAILED", "EVALUATION_STAGE_FAILED",
      "EVALUATION_FAILED", "EVALUATION_WORKER_FAILED", "EVALUATION_NOT_FOUND", "SEMANTIC_EXECUTION_FAILED",
      "SEMANTIC_EXECUTION_POLICY_INVALID",
    ]) {
      expect(evaluationFailure(code).message, code).not.toBe("The evaluation stopped before it could produce a validated result.");
    }
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
