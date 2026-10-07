// Readable labels for profile enum values. Display only: stored values are
// never rewritten. Unlisted values fall back to a generic title-case label.

import { formatLabel } from "../dashboard/format";
import { structuredFields } from "./structured-fields";

const optionLabels: Record<string, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "Onsite",
  REVIEW: "Flag for review",
  UNKNOWN: "Leave as unknown",
  CORE_CS: "Core Customer Success",
  CS_ADJACENT: "Customer Success–adjacent",
  SUPPORT_HEAVY: "Support-heavy",
  SALES_HEAVY: "Sales-heavy",
  IMPLEMENTATION_HEAVY: "Implementation-heavy",
  TECHNICAL_CS: "Technical Customer Success",
  SAAS: "SaaS",
  EDTECH: "EdTech",
  NO_CODE: "No-code",
  LOW_CODE: "Low-code",
  B2C: "B2C",
  B2B2C: "B2B2C",
  LIGHT_B2B: "Light B2B",
  ENTERPRISE_HEAVY_B2B: "Enterprise-heavy B2B",
  SMB: "SMB",
  MID_MARKET: "Mid-market",
  CALL_VOLUME_KPIS: "Call-volume KPIs",
  ASYNC_WORK: "Async work",
  DIRECT: "Direct",
  RELATED: "Related",
  TRANSFERABLE: "Transferable",
};

export function optionLabel(value: string): string {
  return optionLabels[value] ?? formatLabel(value);
}

// Groups validation issues by form field. An issue belongs to a field when
// its path is the field's path, lies inside it, or is one of the field's
// object-level paths (for example the salary threshold rule). Everything
// else is a form-level error.
export function issuesByField(issues: Array<{ path: string; message: string }>): {
  fieldErrors: Record<string, string[]>;
  formErrors: Array<{ path: string; message: string }>;
} {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: Array<{ path: string; message: string }> = [];
  for (const issue of issues) {
    const field = structuredFields.find(
      (candidate) =>
        issue.path === candidate.key ||
        issue.path.startsWith(`${candidate.key}.`) ||
        (candidate.objectErrorPaths ?? []).includes(issue.path),
    );
    if (field) (fieldErrors[field.key] ??= []).push(issue.message);
    else formErrors.push(issue);
  }
  return { fieldErrors, formErrors };
}
