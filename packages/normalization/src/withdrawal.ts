// Explicit withdrawals (Workstream B, November 5–6, 2026). A saved job's
// fact is cleared by a later read only when the posting itself says, in its
// own words, that the fact no longer holds. These read the employer's job
// description only: never page metadata, a site's template labels ("Salary:
// Not specified", "Remote: Not specified") or anything an extractor produced,
// and never the absence of a statement. Each returns the sentence, or null.

const sentence = (pattern: RegExp, description: string | null): string | null => {
  const match = pattern.exec(description ?? "");
  return match ? match[0].trim() : null;
};

// "Open until filled", "there is no application deadline", "applications
// are accepted/reviewed on a rolling basis".
const noDeadlineStatement =
  /[^.!?\n]*\b(?:open\s+until\s+(?:the\s+(?:position|role)\s+is\s+)?filled|(?:there\s+is\s+)?no\s+(?:application\s+)?(?:deadline|closing\s+date)|applications?\s+(?:are|will\s+be)\s+(?:accepted|reviewed)\s+on\s+a\s+rolling\s+basis)\b[^.!?\n]*/i;
export function explicitNoDeadline(description: string | null): string | null {
  return sentence(noDeadlineStatement, description);
}

// The posting says it does not disclose pay: "Salary: not disclosed",
// "Compensation is confidential", "we do not publicly disclose salary".
// Not: "not specified", "competitive", "negotiable", "DOE" (none says the
// pay is withheld), nor a template label outside the description.
const salaryWithheldStatement =
  /[^.!?\n]*\b(?:(?:salary|compensation|pay|base\s+(?:salary|pay))(?:\s+range)?\s*(?::|-|–|is|will\s+not\s+be)?\s*(?:not\s+disclosed|undisclosed|confidential|not\s+(?:being\s+)?(?:published|shared))|(?:we|the\s+company)\s+(?:do(?:es)?\s+not|don['’]t|will\s+not)\s+(?:publicly\s+)?(?:disclose|publish|share)\s+(?:the\s+|our\s+|its\s+)?(?:salary|salaries|compensation|pay)(?:\s+range)?)\b[^.!?\n]*/i;
export function explicitSalaryWithheld(description: string | null): string | null {
  return sentence(salaryWithheldStatement, description);
}

// The posting says its work arrangement is not decided: "Work arrangement:
// to be determined", "remote eligibility is TBD", "whether this role is
// remote or hybrid will be decided with the hiring manager". Not "Remote:
// Not specified" (a template label), and not a location left open
// ("Location: TBD" says nothing about remote or on-site).
const arrangementOpenStatement =
  /[^.!?\n]*\b(?:(?:work(?:ing)?\s+arrangement|workplace\s+type|remote\s+(?:eligibility|status|policy|work\s+eligibility))\s*(?::|-|–|is|are|will\s+be)?\s*(?:to\s+be\s+(?:determined|confirmed|decided|discussed|agreed)|TBD|TBC|not\s+yet\s+(?:determined|decided|confirmed))|whether\s+(?:this|the)\s+(?:role|position)\s+(?:is|will\s+be)\s+(?:remote|hybrid|on-?site|in[- ]office)[^.!?\n]{0,80}?\s(?:is|will\s+be)\s+(?:determined|decided|discussed|agreed|confirmed))\b[^.!?\n]*/i;
export function explicitArrangementOpen(description: string | null): string | null {
  return sentence(arrangementOpenStatement, description);
}

// Provenance source fields of the withdrawals ("explicit-withdrawal:<group>").
export const withdrawalSourceFields = {
  closingDate: "explicit-withdrawal:closingDate",
  salary: "explicit-withdrawal:salary",
  workArrangement: "explicit-withdrawal:workArrangement",
} as const;
