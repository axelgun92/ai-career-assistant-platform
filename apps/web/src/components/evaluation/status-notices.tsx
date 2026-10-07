import type { EvaluationFailurePresentation } from "./evaluation-failure";
import type { EvaluationQueueState } from "./types";

export interface StatusNoticesProps {
  latestStatus: string | undefined;
  // Server-computed queue state of the latest evaluation, when known.
  queueState?: EvaluationQueueState;
  failure: EvaluationFailurePresentation | null;
  fallbackCompletedAt: string | null;
  hasEarlierCompleted: boolean;
  // Whether another evaluation may be requested (not archived).
  evaluable?: boolean;
  isolatedFailure: boolean;
}

export function StatusNotices(props: StatusNoticesProps) {
  const queued = props.latestStatus === "PENDING";
  const running = props.latestStatus === "RUNNING";
  const again = props.evaluable === false ? "" : " You may request another evaluation.";
  return (
    <>
      {queued ? (
        <p>Evaluation is queued, waiting for the evaluation worker. Results will appear here when complete.</p>
      ) : null}
      {running && props.queueState !== "RUNNING_STALE" ? (
        <p>Evaluation is running. Results will appear here when complete.</p>
      ) : null}
      {queued && props.queueState === "QUEUED_LONG" ? (
        <p className="warning-message">
          This evaluation has been queued for over a minute without starting. If the evaluation worker
          isn&apos;t running, start it (see Setup: <code>pnpm worker:evaluations</code>). This page keeps checking.
        </p>
      ) : null}
      {running && props.queueState === "RUNNING_STALE" ? (
        <p className="warning-message">
          This evaluation has run longer than its worker lease. It may still be in progress, or the worker may
          have stopped. If the worker isn&apos;t running, start it (<code>pnpm worker:evaluations</code>); it will
          recover this evaluation.
        </p>
      ) : null}
      {props.failure ? (
        <div className="error-message" role="alert">
          <p>
            The latest evaluation could not complete safely. {props.failure.message}
          </p>
          <p>
            Failure code: <code>{props.failure.code}</code>
          </p>
          <p>
            {props.fallbackCompletedAt
              ? `The most recent completed evaluation (completed ${props.fallbackCompletedAt}) is shown below.${again}`
              : props.hasEarlierCompleted
                ? `Earlier completed results remain available in the evaluation history.${again}`
                : `No completed evaluation is available yet.${again}`}
          </p>
        </div>
      ) : null}
      {props.isolatedFailure ? (
        <p className="warning-message">
          Evaluation completed with an isolated stage issue. Available validated
          results are shown below.
        </p>
      ) : null}
    </>
  );
}
