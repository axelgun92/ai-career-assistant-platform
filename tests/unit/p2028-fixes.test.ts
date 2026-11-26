// The P2028 fix (approved November 9, 2026): F1 per-step timing of the
// capture-lock transactions, F2 the statement timeout after the capture lock
// and its context-aware SQLSTATE 57014 classification, and F3's resolution of
// an uncertain commit. The November 9 P2028's root cause is NOT identified by
// any of this: these make the next one diagnosable and bounded.
import { describe, expect, it } from "vitest";
import { beginCaptureTiming, captureStatementTimeoutFor, createCaptureTimingRecorder, withCaptureTiming } from "@ai-career/database";
import { observationFields, observeIngestion, resolveUncertainCommit, type CaptureOutcomeVerification } from "../../apps/web/src/server/page-capture-acquisition";
import { classifyJobDatabaseFailure, classifyRetrievalWorkerError, formatWorkerError, isCaptureStatementTimeout, sanitizeWorkerError } from "../../apps/web/src/server/worker-errors";

const statementTimeout = (overrides: { transaction?: string | null; armed?: boolean; message?: string } = {}) =>
  Object.assign(new Error("Raw query failed. password=hunter2 host=db.internal"), {
    name: "PrismaClientKnownRequestError",
    code: "P2010",
    meta: { driverAdapterError: { cause: { kind: "postgres", code: "57014", message: overrides.message ?? "canceling statement due to statement timeout" } } },
    ...(overrides.transaction === null ? {} : { captureTransaction: overrides.transaction ?? "ingestRetrievedListing" }),
    ...(overrides.armed === false ? {} : { captureStatementTimeoutMs: 10_000 }),
  });

describe("F2: the statement timeout after the capture lock", () => {
  it("is 10 s, or less when the 30 s transaction has less left (2 s margin), never below 1 s", () => {
    expect(captureStatementTimeoutFor(0)).toBe(10_000);
    expect(captureStatementTimeoutFor(17_000)).toBe(10_000);
    expect(captureStatementTimeoutFor(19_500)).toBe(8_500);
    expect(captureStatementTimeoutFor(27_500)).toBe(1_000);
    expect(captureStatementTimeoutFor(40_000)).toBe(1_000);
  });

  it("classifies a 57014 as transient only from a capture-lock transaction that armed it, and never an operator's cancellation", () => {
    expect(isCaptureStatementTimeout(statementTimeout())).toBe(true);
    expect(classifyJobDatabaseFailure(statementTimeout())).toBe("TRANSIENT");
    for (const transaction of ["ingestManualOpportunity", "probeCaptureLock", "preserveUnnormalizedListing"]) {
      expect(isCaptureStatementTimeout(statementTimeout({ transaction })), transaction).toBe(true);
    }
    // Not armed by the capture transaction, not a capture transaction, no
    // transaction named, or PostgreSQL's "user request" cancellation: as
    // before (UNKNOWN for a job, fatal for the worker).
    for (const error of [statementTimeout({ armed: false }), statementTimeout({ transaction: "stageBatch" }), statementTimeout({ transaction: null }), statementTimeout({ message: "canceling statement due to user request" })]) {
      expect(isCaptureStatementTimeout(error)).toBe(false);
      expect(classifyJobDatabaseFailure(error)).toBe("UNKNOWN");
      expect(classifyRetrievalWorkerError(error)).toBe("fatal");
    }
    // A statement timeout stays distinct from a transaction expiry and from
    // lock contention.
    expect(sanitizeWorkerError(statementTimeout())).toEqual({
      name: "PrismaClientKnownRequestError",
      prismaCode: "P2010",
      kind: "postgres",
      sqlState: "57014",
      transaction: "ingestRetrievedListing",
      statementTimeoutMs: "10000",
      cancelReason: "statement-timeout",
    });
    expect(sanitizeWorkerError(statementTimeout({ message: "something else entirely" }))).toMatchObject({ cancelReason: "other" });
    // Nothing of the message beyond PostgreSQL's fixed reason is kept.
    expect(formatWorkerError(statementTimeout())).not.toMatch(/hunter2|db\.internal|canceling/);
  });
});

describe("F1: per-step timing that survives a failed transaction", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("records each step, the body's end and the commit for a committed transaction", async () => {
    const recorder = createCaptureTimingRecorder();
    await withCaptureTiming(recorder, async () => {
      const timing = beginCaptureTiming("ingestRetrievedListing");
      timing.bodyStarted();
      await timing.step("capture-lock", () => sleep(5));
      timing.statementTimeout(10_000);
      await timing.step("candidates", () => sleep(5));
      await timing.step("candidates", () => sleep(5));
      timing.bodyEnded();
      timing.settled("ok");
    });
    const [transaction] = recorder.snapshot();
    expect(transaction).toMatchObject({ transaction: "ingestRetrievedListing", outcome: "committed", bodyEnded: true, inFlight: null, statementTimeoutMs: 10_000 });
    expect(Object.keys(transaction!.stepsMs)).toEqual(["connect-begin", "capture-lock", "candidates", "commit"]);
    expect(transaction!.stepsMs.candidates).toBeGreaterThanOrEqual(8);
  });

  it("a failure inside the body: rolled back, with the step that was running reported in flight (not as proven stalled)", async () => {
    const recorder = createCaptureTimingRecorder();
    await withCaptureTiming(recorder, async () => {
      const timing = beginCaptureTiming("ingestRetrievedListing");
      timing.bodyStarted();
      const stalled = timing.step("opportunity", () => sleep(30));
      await sleep(10);
      timing.settled("error");
      await stalled;
    });
    const [transaction] = recorder.snapshot();
    expect(transaction).toMatchObject({ outcome: "rolled-back", bodyEnded: false, inFlight: "opportunity" });
    expect(transaction!.inFlightMs).toBeGreaterThanOrEqual(5);
  });

  it("a step whose statement fails ends the transaction: that step is reported in flight, with how long it ran (found by the real-database test)", async () => {
    const recorder = createCaptureTimingRecorder();
    await withCaptureTiming(recorder, async () => {
      const timing = beginCaptureTiming("ingestRetrievedListing");
      timing.bodyStarted();
      await timing.step("lookup", () => sleep(1));
      await timing
        .step("opportunity", async () => {
          await sleep(20);
          throw new Error("canceling statement due to statement timeout");
        })
        .catch(() => undefined);
      timing.settled("error");
    });
    const [transaction] = recorder.snapshot();
    expect(transaction).toMatchObject({ outcome: "rolled-back", bodyEnded: false, inFlight: "opportunity" });
    expect(transaction!.inFlightMs).toBeGreaterThanOrEqual(15);
    expect(transaction!.stepsMs.opportunity).toBeGreaterThanOrEqual(15);
  });

  it("a step that failed but was handled, followed by a step that succeeded, is not reported in flight", async () => {
    const recorder = createCaptureTimingRecorder();
    await withCaptureTiming(recorder, async () => {
      const timing = beginCaptureTiming("ingestRetrievedListing");
      timing.bodyStarted();
      await timing.step("lookup", () => Promise.reject(new Error("x"))).catch(() => undefined);
      await timing.step("opportunity", () => sleep(1));
      timing.settled("error");
    });
    expect(recorder.snapshot()[0]).toMatchObject({ outcome: "rolled-back", inFlight: null });
  });

  it("a failure after the body ended: the commit's outcome is unknown", async () => {
    const recorder = createCaptureTimingRecorder();
    await withCaptureTiming(recorder, async () => {
      const timing = beginCaptureTiming("ingestRetrievedListing");
      timing.bodyStarted();
      timing.bodyEnded();
      await sleep(5);
      timing.settled("error");
    });
    expect(recorder.snapshot()[0]).toMatchObject({ outcome: "unknown", bodyEnded: true, inFlight: null });
    expect(recorder.snapshot()[0]!.stepsMs.commit).toBeGreaterThanOrEqual(3);
  });

  it("records nothing and changes nothing without a recorder (Single Capture, tests)", async () => {
    const timing = beginCaptureTiming("ingestRetrievedListing");
    expect(await timing.step("lookup", async () => 42)).toBe(42);
    expect(() => timing.settled("error")).not.toThrow();
  });

  it("an ingestion observation holds only fixed names and integers", async () => {
    const observation = observeIngestion();
    await observation.run(async () => {
      const timing = beginCaptureTiming("ingestRetrievedListing");
      timing.bodyStarted();
      await timing.step("lookup", () => sleep(2));
      timing.bodyEnded();
      timing.settled("ok");
    });
    const fields = observationFields(observation.finish());
    expect(Object.keys(fields)).toEqual(["transactions", "eventLoopMaxMs", "eventLoopP99Ms", "rssMb", "heapUsedMb"]);
    const flat = JSON.stringify(fields);
    expect(flat).toMatch(/"transaction":"ingestRetrievedListing"/);
    for (const value of [fields.eventLoopMaxMs, fields.eventLoopP99Ms, ...(fields.rssMb as number[]), ...(fields.heapUsedMb as number[])]) expect(Number.isInteger(value)).toBe(true);
    // finish() is idempotent.
    expect(observation.finish()).toBe(observation.finish());
  });
});

describe("F3: an uncertain commit is resolved from the database, never from UNCHANGED alone", () => {
  const verified = (overrides: Partial<CaptureOutcomeVerification> = {}): CaptureOutcomeVerification => ({
    sameListing: true,
    recordsWithThisContent: 1,
    opportunitiesForListing: 1,
    recordLinkedToOpportunity: true,
    recordWrittenDuringFirstAttempt: true,
    recordWrittenBeforeFirstAttempt: false,
    ...overrides,
  });

  it("committed only when the one version with this content was written during the first attempt and belongs to the one opportunity", () => {
    expect(resolveUncertainCommit("UNCHANGED", verified())).toBe("FIRST_ATTEMPT_COMMITTED");
    // UNCHANGED onto a version saved before the first attempt (an earlier
    // save): the first attempt's commit is not shown.
    expect(resolveUncertainCommit("UNCHANGED", verified({ recordWrittenDuringFirstAttempt: false, recordWrittenBeforeFirstAttempt: true }))).toBe("UNDETERMINED");
    // Any duplicate or mismatch: undetermined.
    for (const overrides of [{ recordsWithThisContent: 2 }, { opportunitiesForListing: 2 }, { recordLinkedToOpportunity: false }, { sameListing: false }]) {
      expect(resolveUncertainCommit("UNCHANGED", verified(overrides)), JSON.stringify(overrides)).toBe("UNDETERMINED");
    }
  });

  it("not committed when the retry created the only version itself", () => {
    expect(resolveUncertainCommit("CREATED", verified({ recordWrittenDuringFirstAttempt: false }))).toBe("FIRST_ATTEMPT_NOT_COMMITTED");
    expect(resolveUncertainCommit("CREATED", verified())).toBe("UNDETERMINED");
  });
});
