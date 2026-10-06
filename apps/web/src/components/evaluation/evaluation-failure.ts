// User-facing failure presentation. Only the persisted error code is shown;
// the stored error message can contain internal validation or provider detail
// and is never rendered.

const codePattern = /^[A-Z][A-Z0-9_]{0,63}$/;

const messagesByCode: Record<string, string> = {
  PROVIDER_TIMEOUT: "The AI provider did not respond in time.",
  PROVIDER_REQUEST_FAILED: "The AI provider request could not be completed.",
  PROVIDER_FAILURE: "The AI provider request could not be completed.",
  PROVIDER_RESPONSE_INCOMPLETE: "The AI provider returned an incomplete response.",
  PROVIDER_OUTPUT_MISSING: "The AI provider returned no usable output.",
  STRUCTURED_OUTPUT_INVALID:
    "An AI response did not pass validation, so it was not accepted.",
  SEMANTIC_CALL_BUDGET_EXHAUSTED:
    "The evaluation reached its AI call limit before it could finish.",
  SEMANTIC_EXECUTION_POLICY_MISMATCH:
    "The evaluation worker is running a different AI configuration than the one this evaluation was queued with.",
  SEMANTIC_PRICING_CONFIGURATION_MISMATCH:
    "The evaluation worker is running a different pricing configuration than the one this evaluation was queued with.",
  PRICING_CONFIGURATION_MISMATCH:
    "The evaluation worker is running a different pricing configuration than the one this evaluation was queued with.",
  USER_PROFILE_NOT_FOUND: "The user profile used for this evaluation is no longer available.",
  CUSTOMER_SUCCESS_CONFIGURATION_INVALID:
    "The selected profile does not contain valid evaluation preferences.",
  DOMAIN_UNSUPPORTED: "This opportunity's domain cannot be evaluated by the worker.",
  DATABASE_UNAVAILABLE: "The database was unavailable while the evaluation was running.",
};

export interface EvaluationFailurePresentation {
  code: string;
  message: string;
}

export function evaluationFailure(
  errorCode: string | null | undefined,
): EvaluationFailurePresentation {
  const code = errorCode && codePattern.test(errorCode) ? errorCode : "UNKNOWN";
  return {
    code,
    message:
      messagesByCode[code] ??
      "The evaluation stopped before it could produce a validated result.",
  };
}

// A queued task the worker has not started within this window usually means
// no evaluation worker is running.
export const queuedTooLongMs = 60_000;

export function isQueuedTooLong(
  status: string | undefined,
  queuedAt: string | undefined,
  checkedAt: number | null,
): boolean {
  if (status !== "PENDING" || !queuedAt || checkedAt === null) return false;
  const queued = Date.parse(queuedAt);
  return Number.isFinite(queued) && checkedAt - queued > queuedTooLongMs;
}
