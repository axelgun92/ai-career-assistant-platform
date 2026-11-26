import type { WorkAuthorizationRelevance } from "@ai-career/core";
import { geographyName } from "@ai-career/core";

// What a job's work-authorization facts mean for the user (never a fact of
// its own: the facts are shown as stated in the normalized fields). A
// requirement the user already meets shows nothing here.
export function WorkEligibilityNote({ relevance }: { relevance: WorkAuthorizationRelevance | null }) {
  if (!relevance) return null;
  const facts = relevance.statedFacts.join("; ");
  const where = relevance.jobRegions.map(geographyName).join(", ");
  if (relevance.status === "REVIEW") {
    return (
      <p className="unknown-callout work-eligibility-note" role="note">
        <strong>Check work eligibility.</strong> This job states: {facts}. That is outside the countries you are eligible to work in.
      </p>
    );
  }
  if (relevance.status === "UNKNOWN_CHECK") {
    return (
      <p className="unknown-callout work-eligibility-note" role="note">
        <strong>Work eligibility unknown.</strong> This job is in {where}, outside the countries you are eligible to work in, and states nothing
        about work authorization or sponsorship. Worth checking before applying.
      </p>
    );
  }
  if (relevance.status === "FAVORABLE") {
    return (
      <p className="work-eligibility-note" role="note">
        <strong>Work eligibility.</strong> This job is outside the countries you are eligible to work in and states: {facts}.
      </p>
    );
  }
  return null;
}
