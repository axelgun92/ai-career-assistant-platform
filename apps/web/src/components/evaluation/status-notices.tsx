import type { EvaluationFailurePresentation } from "./evaluation-failure";

export interface StatusNoticesProps {
  latestStatus: string | undefined;
  failure: EvaluationFailurePresentation | null;
  fallbackCompletedAt: string | null;
  hasEarlierCompleted: boolean;
  queuedTooLong: boolean;
  isolatedFailure: boolean;
}

export function StatusNotices(props: StatusNoticesProps) {
  return (
    <>
      {props.latestStatus === "PENDING" || props.latestStatus === "RUNNING" ? (
        <p>
          Evaluation is {props.latestStatus === "PENDING" ? "queued" : "running"}.
          Results will appear here when complete.
        </p>
      ) : null}
      {props.queuedTooLong ? (
        <p className="warning-message">
          This evaluation has been queued for over a minute without starting. The
          evaluation worker may not be running; start it with{" "}
          <code>pnpm worker:evaluations</code> and keep checking.
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
              ? `The most recent completed evaluation (completed ${props.fallbackCompletedAt}) is shown below. You may request another evaluation.`
              : props.hasEarlierCompleted
                ? "Earlier completed results remain available in the evaluation history. You may request another evaluation."
                : "No completed evaluation is available yet. You may request another evaluation."}
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
