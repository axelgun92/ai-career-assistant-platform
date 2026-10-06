"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerSuccessResults } from "../customer-success/customer-success-results";
import { createEvaluationPoller } from "./poller";
import { evaluationFailure, isQueuedTooLong } from "./evaluation-failure";
import { StatusNotices } from "./status-notices";
import { ClassificationBadge, humanize } from "./shared-results";
import type {
  EvaluationPresentation,
  OpportunityPresentation,
} from "./types";

type StatusResult =
  | { found: true; evaluation: EvaluationPresentation }
  | { found: false };

async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return typeof body.error === "string" ? body.error : fallback;
}

async function fetchEvaluation(
  opportunityId: string,
  signal: AbortSignal,
  evaluationId?: string,
): Promise<StatusResult> {
  const query = evaluationId
    ? `?evaluationId=${encodeURIComponent(evaluationId)}`
    : "";
  const response = await fetch(
    `/api/opportunities/${encodeURIComponent(opportunityId)}/evaluation${query}`,
    { signal, cache: "no-store" },
  );
  if (response.status === 404) return { found: false };
  if (!response.ok) {
    throw new Error(await responseMessage(response, "Evaluation status is unavailable"));
  }
  return { found: true, evaluation: await response.json() as EvaluationPresentation };
}

function activeStatus(status: string | undefined) {
  return status === "PENDING" || status === "RUNNING";
}

function formatTimestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : null;
}

export function EvaluationExperience({
  opportunity,
  evaluable = true,
}: {
  opportunity: OpportunityPresentation;
  // False for archived/closed opportunities; the API enforces the same rule.
  evaluable?: boolean;
}) {
  // `evaluation` is what is displayed; `latest` is the newest evaluation, which
  // drives status, failure details, and the queued-too-long notice.
  const [evaluation, setEvaluation] = useState<EvaluationPresentation | null>(null);
  const [latest, setLatest] = useState<EvaluationPresentation | null>(null);
  const [fallbackEvaluationId, setFallbackEvaluationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const router = useRouter();
  // Set while an evaluation is queued/running, so its completion can refresh
  // server-rendered lifecycle status on the page.
  const wasActive = useRef(false);
  const requestInFlight = useRef(false);
  const selectedHistoryId = useRef<string | null>(null);
  const fallbackController = useRef<AbortController | null>(null);
  const poller = useRef<ReturnType<typeof createEvaluationPoller<StatusResult>> | null>(null);

  useEffect(() => {
    // When the latest evaluation failed, show the newest completed evaluation
    // from history rather than an empty result area.
    async function showLastCompleted(failed: EvaluationPresentation) {
      const completed = failed.history.find(
        (item) => !item.isLatest && item.status === "COMPLETED",
      );
      if (!completed) {
        setFallbackEvaluationId(null);
        setEvaluation(failed);
        return;
      }
      fallbackController.current?.abort();
      const controller = new AbortController();
      fallbackController.current = controller;
      try {
        const value = await fetchEvaluation(opportunity.id, controller.signal, completed.evaluationId);
        if (controller.signal.aborted || selectedHistoryId.current) return;
        if (value.found && value.evaluation.status === "COMPLETED") {
          setFallbackEvaluationId(value.evaluation.evaluationId);
          setEvaluation(value.evaluation);
        } else {
          setFallbackEvaluationId(null);
          setEvaluation(failed);
        }
      } catch {
        if (controller.signal.aborted) return;
        setFallbackEvaluationId(null);
        setEvaluation(failed);
      }
    }

    const controller = createEvaluationPoller<StatusResult>({
      fetchStatus: (signal) => fetchEvaluation(opportunity.id, signal),
      shouldContinue: (value) =>
        value.found && activeStatus(value.evaluation.status),
      onUpdate: (value) => {
        setLoading(false);
        setError(null);
        setCheckedAt(Date.now());
        if (!value.found) {
          setLatest(null);
          setEvaluation(null);
          return;
        }
        setLatest(value.evaluation);
        if (activeStatus(value.evaluation.status)) {
          wasActive.current = true;
        } else if (wasActive.current) {
          wasActive.current = false;
          router.refresh();
        }
        if (selectedHistoryId.current) {
          setEvaluation((current) =>
            current ? { ...current, history: value.evaluation.history } : value.evaluation,
          );
          return;
        }
        if (value.evaluation.status === "FAILED") {
          void showLastCompleted(value.evaluation);
          return;
        }
        setFallbackEvaluationId(null);
        setEvaluation(value.evaluation);
      },
      onError: (message) => {
        setLoading(false);
        setError(message);
        setPollStopped(true);
      },
    });
    poller.current = controller;
    controller.start();
    return () => {
      controller.stop();
      fallbackController.current?.abort();
      poller.current = null;
    };
  }, [opportunity.id, router]);

  function keepChecking() {
    setPollStopped(false);
    setError(null);
    poller.current?.stop();
    poller.current?.start();
  }

  async function requestEvaluation() {
    if (requestInFlight.current || activeStatus(evaluation?.history[0]?.status)) return;
    requestInFlight.current = true;
    setRequesting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/opportunities/${encodeURIComponent(opportunity.id)}/evaluate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (response.status !== 202) {
        setError(await responseMessage(response, "Evaluation could not be requested"));
        return;
      }
      setNotice("Evaluation accepted and queued. This page will update automatically.");
      selectedHistoryId.current = null;
      setPollStopped(false);
      poller.current?.stop();
      poller.current?.start();
    } catch {
      setError("The application could not reach the evaluation service.");
    } finally {
      requestInFlight.current = false;
      setRequesting(false);
    }
  }

  async function showHistory(evaluationId: string, isLatest: boolean) {
    setLoading(true);
    setError(null);
    fallbackController.current?.abort();
    const controller = new AbortController();
    try {
      const value = await fetchEvaluation(opportunity.id, controller.signal, evaluationId);
      if (value.found) {
        selectedHistoryId.current = isLatest ? null : evaluationId;
        setFallbackEvaluationId(null);
        setEvaluation(value.evaluation);
      }
      else setError("That historical evaluation is no longer available.");
    } catch {
      setError("The historical evaluation could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const history = latest?.history ?? evaluation?.history ?? [];
  const latestStatus = history[0]?.status ?? latest?.status ?? evaluation?.status;
  const active = activeStatus(latestStatus);
  const isolatedFailure = evaluation?.evaluationStatus === "COMPLETED" &&
    evaluation.stages.some((stage) => stage.status === "FAILED");
  const failure = latestStatus === "FAILED" && latest
    ? evaluationFailure(latest.task.errorCode)
    : null;
  const fallbackShown = fallbackEvaluationId !== null &&
    evaluation?.evaluationId === fallbackEvaluationId;

  return (
    <div className="evaluation-shell">
      <section className="evaluation-controls" aria-labelledby="evaluation-status-title">
        <div>
          <p className="eyebrow">Evaluation status</p>
          <h2 id="evaluation-status-title">
            {loading && !evaluation ? "Checking evaluation…" :
              evaluation ? humanize(latestStatus) : "Not evaluated"}
          </h2>
        </div>
        <div className="evaluation-actions">
          <button
            type="button"
            onClick={requestEvaluation}
            disabled={requesting || active || !evaluable}
            aria-describedby="evaluation-status-message"
          >
            {requesting ? "Requesting…" : active ? "Evaluation in progress" :
              evaluation ? "Reevaluate opportunity" : "Evaluate Customer Success fit"}
          </button>
          {pollStopped ? (
            <button type="button" className="secondary-button" onClick={keepChecking}>
              Keep checking
            </button>
          ) : null}
        </div>
        <div id="evaluation-status-message" aria-live="polite">
          {!evaluable && !active ? (
            <p>This opportunity is archived or closed. Restore it to request another evaluation.</p>
          ) : null}
          {notice ? <p className="success-message">{notice}</p> : null}
          {error ? <p className="error-message">{error}</p> : null}
          <StatusNotices
            latestStatus={latestStatus}
            failure={failure}
            fallbackCompletedAt={fallbackShown ? formatTimestamp(evaluation?.completedAt) : null}
            hasEarlierCompleted={history.some((item) => !item.isLatest && item.status === "COMPLETED")}
            queuedTooLong={isQueuedTooLong(latestStatus, history[0]?.createdAt, checkedAt)}
            isolatedFailure={isolatedFailure}
          />
        </div>
      </section>

      {history.length ? (
        <details className="history-panel">
          <summary>Evaluation history ({history.length})</summary>
          <ul>
            {history.map((item) => (
              <li key={item.evaluationId}>
                <button
                  className="history-button"
                  type="button"
                  onClick={() => showHistory(item.evaluationId, item.isLatest)}
                  aria-current={evaluation?.evaluationId === item.evaluationId ? "true" : undefined}
                >
                  {item.isLatest ? "Latest · " : ""}
                  {item.decision ? <><ClassificationBadge value={item.decision} /> · </> : null}
                  {humanize(item.status)} · {item.completedAt ? new Date(item.completedAt).toLocaleString() : "In progress"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {evaluation?.status === "COMPLETED" && evaluation.result ? (
        <CustomerSuccessResults opportunity={opportunity} evaluation={evaluation} />
      ) : null}
    </div>
  );
}
