// Presentational fields for manual opportunity entry, with per-field
// validation messages from the API's `issues` array.

// Domains the platform can currently evaluate. A blank domain cannot be
// evaluated, so the form always submits one of these slugs.
export const domainOptions = [
  { value: "customer-success", label: "Customer Success" },
] as const;
const defaultDomain = domainOptions[0].value;

export const manualOpportunityFieldNames = [
  "rawText",
  "title",
  "company",
  "location",
  "compensationText",
  "postingDate",
  "domain",
  "sourceUrl",
  "applicationUrl",
] as const;

export type ManualOpportunityFieldName = (typeof manualOpportunityFieldNames)[number];
export type FieldErrors = Partial<Record<ManualOpportunityFieldName, string>>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export function fieldErrorsFromIssues(issues: unknown): {
  fieldErrors: FieldErrors;
  formErrors: string[];
} {
  const fieldErrors: FieldErrors = {};
  const formErrors: string[] = [];
  if (!Array.isArray(issues)) return { fieldErrors, formErrors };
  for (const issue of issues as Partial<ValidationIssue>[]) {
    if (typeof issue?.message !== "string") continue;
    const field = String(issue.path ?? "").split(".")[0];
    if ((manualOpportunityFieldNames as readonly string[]).includes(field)) {
      fieldErrors[field as ManualOpportunityFieldName] ??= issue.message;
    } else {
      formErrors.push(issue.message);
    }
  }
  return { fieldErrors, formErrors };
}

function errorProps(name: ManualOpportunityFieldName, fieldErrors: FieldErrors) {
  return fieldErrors[name]
    ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` }
    : {};
}

function FieldError({ name, fieldErrors }: { name: ManualOpportunityFieldName; fieldErrors: FieldErrors }) {
  const message = fieldErrors[name];
  return message ? (
    <span id={`${name}-error`} className="field-error">
      {message}
    </span>
  ) : null;
}

const optionalTextFields = [
  ["title", "Title (optional)", "text"],
  ["company", "Company (optional)", "text"],
  ["location", "Location (optional)", "text"],
  ["compensationText", "Compensation text (optional)", "text"],
  ["postingDate", "Posting date (optional)", "date"],
] as const;

const urlFields = [
  ["sourceUrl", "Source URL (optional)"],
  ["applicationUrl", "Application URL (optional)"],
] as const;

export function ManualOpportunityFields({ fieldErrors }: { fieldErrors: FieldErrors }) {
  return (
    <>
      <label>
        Raw opportunity or job-description text
        <textarea name="rawText" rows={14} required {...errorProps("rawText", fieldErrors)} />
        <FieldError name="rawText" fieldErrors={fieldErrors} />
      </label>

      <div className="form-grid">
        {optionalTextFields.map(([name, label, type]) => (
          <label key={name}>
            {label}
            <input name={name} type={type} {...errorProps(name, fieldErrors)} />
            <FieldError name={name} fieldErrors={fieldErrors} />
          </label>
        ))}
        <label>
          Domain
          <select name="domain" defaultValue={defaultDomain} {...errorProps("domain", fieldErrors)}>
            {domainOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError name="domain" fieldErrors={fieldErrors} />
        </label>
        {urlFields.map(([name, label]) => (
          <label key={name}>
            {label}
            <input name={name} type="url" {...errorProps(name, fieldErrors)} />
            <FieldError name={name} fieldErrors={fieldErrors} />
          </label>
        ))}
      </div>
    </>
  );
}
