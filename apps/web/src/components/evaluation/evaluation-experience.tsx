"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerSuccessResults } from "../customer-success/customer-success-results";
import { createEvaluationPoller } from "./poller";
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

export function EvaluationExperience({
  opportunity,
}: {
  opportunity: OpportunityPresentation;
}) {
  const [evaluation, setEvaluation] = useState<EvaluationPresentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const selectedHistoryId = useRef<string | null>(null);
  const poller = useRef<ReturnType<typeof createEvaluationPoller<StatusResult>> | null>(null);

  useEffect(() => {
    const controller = createEvaluationPoller<StatusResult>({
      fetchStatus: (signal) => fetchEvaluation(opportunity.id, signal),
      shouldContinue: (value) =>
        value.found && activeStatus(value.evaluation.status),
      onUpdate: (value) => {
        setLoading(false);
        setError(null);
        setEvaluation((current) => {
          if (!value.found) return null;
          if (selectedHistoryId.current && current) {
            return { ...current, history: value.evaluation.history };
          }
          return value.evaluation;
        });
      },
      onError: (message) => {
        setLoading(false);
        setError(message);
      },
    });
    poller.current = controller;
    controller.start();
    return () => {
      controller.stop();
      poller.current = null;
    };
  }, [opportunity.id]);

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
    const controller = new AbortController();
    try {
      const value = await fetchEvaluation(opportunity.id, controller.signal, evaluationId);
      if (value.found) {
        selectedHistoryId.current = isLatest ? null : evaluationId;
        setEvaluation(value.evaluation);
      }
      else setError("That historical evaluation is no longer available.");
    } catch {
      setError("The historical evaluation could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const latestStatus = evaluation?.history[0]?.status ?? evaluation?.status;
  const active = activeStatus(latestStatus);
  const isolatedFailure = evaluation?.evaluationStatus === "COMPLETED" &&
    evaluation.stages.some((stage) => stage.status === "FAILED");

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
        <button
          type="button"
          onClick={requestEvaluation}
          disabled={requesting || active}
          aria-describedby="evaluation-status-message"
        >
          {requesting ? "Requesting…" : active ? "Evaluation in progress" :
            evaluation ? "Reevaluate opportunity" : "Evaluate Customer Success fit"}
        </button>
        <div id="evaluation-status-message" aria-live="polite">
          {active ? <p>Evaluation is {latestStatus === "PENDING" ? "queued" : "running"}. Results will appear here when complete.</p> : null}
          {notice ? <p className="success-message">{notice}</p> : null}
          {error ? <p className="error-message">{error}</p> : null}
          {latestStatus === "FAILED" ? (
            <p className="error-message">Evaluation could not complete safely. You may request another evaluation; earlier completed results remain available below.</p>
          ) : null}
          {isolatedFailure ? (
            <p className="warning-message">Evaluation completed with an isolated stage issue. Available validated results are shown below.</p>
          ) : null}
        </div>
      </section>

      {evaluation?.history.length ? (
        <details className="history-panel">
          <summary>Evaluation history ({evaluation.history.length})</summary>
          <ul>
            {evaluation.history.map((item) => (
              <li key={item.evaluationId}>
                <button
                  className="history-button"
                  type="button"
                  onClick={() => showHistory(item.evaluationId, item.isLatest)}
                  aria-current={evaluation.evaluationId === item.evaluationId ? "true" : undefined}
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
