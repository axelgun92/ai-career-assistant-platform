// Wording for bulk evaluation (November 26, 2026). A plain module: the
// dashboard panel, the server and the tests share it.

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// One line per limit the whole selection would exceed.
export function limitShortfallText(limit: string, remaining: number, selected: number): string {
  const jobs = plural(selected, "job", "jobs");
  const evaluations = plural(remaining, "evaluation", "evaluations");
  switch (limit) {
    case "DAILY_EVALUATIONS":
      return `You selected ${jobs}, but your remaining daily limit allows ${evaluations}.`;
    case "WEEKLY_EVALUATIONS":
      return `You selected ${jobs}, but your remaining weekly limit allows ${evaluations}.`;
    case "BUDGET":
      return `You selected ${jobs}, but your remaining AI budget can reserve ${evaluations}.`;
    case "MONTHLY_OUTPUT_TOKENS":
      return `You selected ${jobs}, but your remaining monthly output-token allowance can cover ${evaluations}.`;
    default:
      return `You selected ${jobs}, but a Budget limit allows ${evaluations}.`;
  }
}

// Why a selected job cannot be evaluated with the others right now.
export const ineligibleReasonText: Record<string, string> = {
  NOT_FOUND: "No longer exists",
  NOT_EVALUABLE: "Archived or closed (restore it first)",
  NOT_NORMALIZED: "Not ready for evaluation yet",
  SOURCE_CONTENT_MISSING: "Has no job description to evaluate",
  DOMAIN_UNSUPPORTED: "Not a Customer Success job",
  PROFILE_UNUSABLE: "Your active profile can't be used for evaluation",
  TRIAGE_NEEDS_REVIEW: "Held by triage for your review",
  TRIAGE_REJECTED: "Rejected by triage",
  ALREADY_ACTIVE: "Already queued or running",
  ALREADY_EVALUATED: "Already evaluated (re-evaluate it from its page)",
  DEFERRED: "Has a deferred request (resume or cancel it on Budget)",
  DUPLICATE_OF_EVALUATED: "Duplicate of a job that already has an evaluation or request",
  SAME_LISTING_SELECTED: "Same listing as another selected job",
};

export const ineligibleText = (reason: string) => ineligibleReasonText[reason] ?? "Can't be evaluated right now";

export function confirmationText(count: number): string {
  return `Evaluate ${plural(count, "selected job", "selected jobs")}? ${count === 1 ? "It" : "They"} will be added to the evaluation queue and will use your configured AI budget.`;
}

export function reservationText(reservation: { perEvaluation: number; total: number; currency: string }): string {
  const money = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: reservation.currency, maximumFractionDigits: 2 }).format(amount);
  return `Up to ${money(reservation.total)} will be reserved (${money(reservation.perEvaluation)} per evaluation).`;
}

export function queuedText(count: number): string {
  // The dashboard does not poll, so it says how to see the new statuses.
  if (count === 1) return "1 evaluation queued. Refresh the page to see its latest status.";
  return `${count} evaluations queued. They will run one at a time. Refresh the page to see their latest statuses.`;
}
