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
  EVALUATION_LEASE_EXPIRED:
    "The evaluation worker stopped before this evaluation finished, and no attempts remained. You may request another evaluation.",
  WORKER_INTERRUPTED: "The evaluation worker was interrupted before this evaluation finished.",
  STAGE_EXECUTION_FAILED: "An evaluation stage could not be completed.",
  EVALUATION_STAGE_FAILED: "An evaluation stage could not be completed.",
  EVALUATION_FAILED: "The evaluation could not be completed.",
  EVALUATION_WORKER_FAILED: "The evaluation worker hit an unexpected error.",
  EVALUATION_NOT_FOUND: "The evaluation worker could not find this evaluation.",
  SEMANTIC_EXECUTION_FAILED: "An AI step could not be completed.",
  SEMANTIC_EXECUTION_POLICY_INVALID: "The AI execution configuration is invalid.",
};

// Code families produced with a variable suffix.
function familyMessage(code: string): string | null {
  const http = /^PROVIDER_HTTP_(\d{3})$/.exec(code);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 403) {
      return "The AI provider rejected the API key or denied access. Check the OpenAI API key configuration.";
    }
    if (status === 429) return "The AI provider rate-limited the request.";
    if (status >= 500) return "The AI provider had a server error.";
    return "The AI provider rejected the request.";
  }
  if (code === "OPERATION_METADATA_PERSISTENCE_DATABASE_UNAVAILABLE") return messagesByCode.DATABASE_UNAVAILABLE!;
  if (code.startsWith("OPERATION_METADATA_PERSISTENCE_")) {
    return "The evaluation's AI usage could not be recorded, so the run was stopped.";
  }
  return null;
}

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
      familyMessage(code) ??
      "The evaluation stopped before it could produce a validated result.",
  };
}
