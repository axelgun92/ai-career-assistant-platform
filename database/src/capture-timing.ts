import { AsyncLocalStorage } from "node:async_hooks";

// Per-step timing of the capture-lock transactions (P2028 fix F1, approved
// November 9, 2026). A caller (the Mode B worker) creates a recorder before a
// job's ingestion and runs the ingestion inside it; the repository records
// each step of every capture-lock transaction into the recorder it finds.
// The recorder lives outside the transaction, so its timings survive a
// rollback, a statement timeout, a P2028 expiry or a failed commit. Without a
// recorder (Single Capture, tests) nothing is recorded and nothing changes.
//
// Data-minimal by construction: fixed step and transaction names, integer
// milliseconds and a fixed commit-outcome word. Never text, HTML, values,
// credentials or connection strings.

export type CaptureCommitOutcome = "committed" | "rolled-back" | "unknown";

export interface CaptureTransactionTiming {
  transaction: string;
  // Step name → milliseconds, in the order first seen (a repeated step adds
  // up). "connect-begin": from the call until the transaction body began
  // (connection acquisition and BEGIN; Prisma does not expose them apart).
  // "commit": from the end of the body until the transaction settled.
  stepsMs: Record<string, number>;
  // The step running when the transaction failed, if it had not ended, and
  // how long it had been running at that moment (not proof that it stalled).
  inFlight: string | null;
  inFlightMs: number | null;
  // Whether the body finished: a failure after it is a commit whose outcome
  // is unknown to this process.
  bodyEnded: boolean;
  outcome: CaptureCommitOutcome | null;
  totalMs: number | null;
  // The statement timeout set after the capture lock, if it was (F2).
  statementTimeoutMs: number | null;
}

interface OpenTransaction extends CaptureTransactionTiming {
  startedAt: number;
  bodyEndedAt: number | null;
  current: { step: string; startedAt: number } | null;
}

const now = () => performance.now();
const round = (value: number) => Math.max(0, Math.round(value));

export class CaptureTimingRecorder {
  private readonly transactions: OpenTransaction[] = [];

  begin(transaction: string): OpenTransaction {
    const open: OpenTransaction = {
      transaction,
      stepsMs: {},
      inFlight: null,
      inFlightMs: null,
      bodyEnded: false,
      outcome: null,
      totalMs: null,
      statementTimeoutMs: null,
      startedAt: now(),
      bodyEndedAt: null,
      current: null,
    };
    this.transactions.push(open);
    return open;
  }

  // The timings so far, as plain data (an unfinished step is reported as
  // in flight with its elapsed time).
  snapshot(): CaptureTransactionTiming[] {
    const at = now();
    return this.transactions.map((open) => ({
      transaction: open.transaction,
      stepsMs: { ...open.stepsMs },
      inFlight: open.current?.step ?? open.inFlight,
      inFlightMs: open.current ? round(at - open.current.startedAt) : open.inFlightMs,
      bodyEnded: open.bodyEnded,
      outcome: open.outcome,
      totalMs: open.totalMs ?? round(at - open.startedAt),
      statementTimeoutMs: open.statementTimeoutMs,
    }));
  }
}

const storage = new AsyncLocalStorage<CaptureTimingRecorder>();

export function createCaptureTimingRecorder(): CaptureTimingRecorder {
  return new CaptureTimingRecorder();
}

// Runs work with the recorder as the current one for every capture-lock
// transaction it starts.
export function withCaptureTiming<T>(recorder: CaptureTimingRecorder, work: () => Promise<T>): Promise<T> {
  return storage.run(recorder, work);
}

// The current transaction's timing handle (no-ops without a recorder).
export interface CaptureTimingHandle {
  step<T>(name: string, work: () => Promise<T> | T): Promise<T>;
  bodyStarted(): void;
  bodyEnded(): void;
  statementTimeout(ms: number): void;
  settled(outcome: "ok" | "error"): void;
}

const noHandle: CaptureTimingHandle = {
  step: async (_name, work) => work(),
  bodyStarted: () => undefined,
  bodyEnded: () => undefined,
  statementTimeout: () => undefined,
  settled: () => undefined,
};

export function beginCaptureTiming(transaction: string): CaptureTimingHandle {
  const recorder = storage.getStore();
  if (!recorder) return noHandle;
  const open = recorder.begin(transaction);
  const add = (name: string, ms: number) => {
    open.stepsMs[name] = (open.stepsMs[name] ?? 0) + round(ms);
  };
  // The last step that failed, until another step starts: the step the
  // transaction failed in when its error ends the transaction.
  let failed: { step: string; ms: number } | null = null;
  return {
    async step(name, work) {
      const started = now();
      failed = null;
      open.current = { step: name, startedAt: started };
      try {
        return await work();
      } catch (error) {
        failed = { step: name, ms: round(now() - started) };
        throw error;
      } finally {
        add(name, now() - started);
        if (open.current?.step === name && open.current.startedAt === started) open.current = null;
      }
    },
    bodyStarted() {
      add("connect-begin", now() - open.startedAt);
    },
    bodyEnded() {
      open.bodyEnded = true;
      open.bodyEndedAt = now();
      open.current = null;
    },
    statementTimeout(ms) {
      open.statementTimeoutMs = ms;
    },
    settled(outcome) {
      const at = now();
      if (open.bodyEndedAt !== null) add("commit", at - open.bodyEndedAt);
      if (outcome === "ok") open.outcome = "committed";
      else {
        // A failure before the body ended rolled the transaction back; a
        // failure after it is a commit whose outcome this process cannot
        // know.
        open.outcome = open.bodyEnded ? "unknown" : "rolled-back";
        if (open.current) {
          open.inFlight = open.current.step;
          open.inFlightMs = round(at - open.current.startedAt);
          open.current = null;
        } else if (failed && !open.bodyEnded) {
          open.inFlight = failed.step;
          open.inFlightMs = failed.ms;
        }
      }
      open.totalMs = round(at - open.startedAt);
    },
  };
}
