"use client";

// Controlled inputs for the structured profile form. They hold no state of
// their own: every change goes straight to the shared draft.

import { optionLabel } from "./labels";

export function fieldDomId(key: string): string {
  return `field-${key.replaceAll(".", "-")}`;
}

export function FieldErrors({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p className="field-error" id={`${id}-error`}>
      {messages.join(" ")}
    </p>
  );
}

export function errorAttributes(id: string, messages?: string[]) {
  return messages?.length ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

export function DefaultTag({ show }: { show: boolean }) {
  return show ? (
    <span className="default-tag" title="Not set in this version; the default applies">
      Default
    </span>
  ) : null;
}

// Keeps the reference order (the saved or default list) so toggling an
// option off and on again returns exactly the original value.
function ordered(values: string[], reference: readonly string[]): string[] {
  const rank = (value: string) => {
    const index = reference.indexOf(value);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...values].sort((left, right) => rank(left) - rank(right));
}

export function CheckboxGroup({
  id,
  legend,
  help,
  options,
  value,
  reference,
  isDefault,
  errors,
  disabled,
  onChange,
}: {
  id: string;
  legend: string;
  help?: string;
  options: readonly string[];
  value: string[];
  reference: readonly string[];
  isDefault: boolean;
  errors?: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="profile-field" id={id} {...errorAttributes(id, errors)}>
      <legend>
        {legend} <DefaultTag show={isDefault} />
      </legend>
      {help ? <p className="field-help">{help}</p> : null}
      <div className="checkbox-grid">
        {options.map((option) => (
          <label key={option} className="checkbox-label">
            <input
              type="checkbox"
              checked={value.includes(option)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? ordered([...value, option], [...reference, ...options])
                    : value.filter((item) => item !== option),
                )
              }
            />
            {optionLabel(option)}
          </label>
        ))}
      </div>
      <FieldErrors id={id} messages={errors} />
    </fieldset>
  );
}

export function RadioGroup({
  id,
  legend,
  options,
  value,
  isDefault,
  errors,
  disabled,
  onChange,
}: {
  id: string;
  legend: string;
  options: readonly string[];
  value: string;
  isDefault: boolean;
  errors?: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="profile-field" id={id} {...errorAttributes(id, errors)}>
      <legend>
        {legend} <DefaultTag show={isDefault} />
      </legend>
      <div className="checkbox-grid">
        {options.map((option) => (
          <label key={option} className="checkbox-label">
            <input
              type="radio"
              name={id}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            {optionLabel(option)}
          </label>
        ))}
      </div>
      <FieldErrors id={id} messages={errors} />
    </fieldset>
  );
}

export function StringListEditor({
  id,
  legend,
  help,
  value,
  isDefault,
  errors,
  disabled,
  onChange,
}: {
  id: string;
  legend: string;
  help?: string;
  value: string[];
  isDefault: boolean;
  errors?: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="profile-field" id={id} {...errorAttributes(id, errors)}>
      <legend>
        {legend} <DefaultTag show={isDefault} />
      </legend>
      {help ? <p className="field-help">{help}</p> : null}
      {value.length === 0 ? <p className="field-help">None.</p> : null}
      <ul className="list-editor">
        {value.map((item, index) => (
          <li key={index}>
            <input
              aria-label={`${legend} ${index + 1}`}
              value={item}
              disabled={disabled}
              onChange={(event) => onChange(value.map((current, position) => (position === index ? event.target.value : current)))}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              aria-label={`Remove ${legend} ${index + 1}`}
              onClick={() => onChange(value.filter((_, position) => position !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        aria-label={`Add to ${legend}`}
        onClick={() => onChange([...value, ""])}
      >
        Add
      </button>
      <FieldErrors id={id} messages={errors} />
    </fieldset>
  );
}

export interface Statement {
  id: string;
  statement: string;
  relationship?: string;
}

function newStatementId(prefix: string, existing: Statement[]): string {
  const taken = new Set(existing.map((item) => item.id));
  for (;;) {
    const candidate = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function StatementListEditor({
  id,
  legend,
  idPrefix,
  relationshipOptions,
  value,
  errors,
  disabled,
  onChange,
}: {
  id: string;
  legend: string;
  idPrefix: string;
  relationshipOptions?: readonly string[];
  value: Statement[];
  errors?: string[];
  disabled?: boolean;
  onChange: (value: Statement[]) => void;
}) {
  const update = (index: number, patch: Partial<Statement>) =>
    onChange(value.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  return (
    <fieldset className="profile-field" id={id} {...errorAttributes(id, errors)}>
      <legend>{legend}</legend>
      {value.length === 0 ? <p className="field-help">None.</p> : null}
      <ol className="statement-editor">
        {value.map((item, index) => (
          <li key={item.id}>
            <textarea
              aria-label={`${legend} ${index + 1}`}
              rows={3}
              value={item.statement}
              disabled={disabled}
              onChange={(event) => update(index, { statement: event.target.value })}
            />
            <div className="statement-controls">
              {relationshipOptions ? (
                <label className="inline-label">
                  Relationship
                  <select
                    value={item.relationship}
                    disabled={disabled}
                    onChange={(event) => update(index, { relationship: event.target.value })}
                  >
                    {relationshipOptions.map((option) => (
                      <option key={option} value={option}>
                        {optionLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                aria-label={`Remove ${legend} ${index + 1}`}
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...value,
            relationshipOptions
              ? { id: newStatementId(idPrefix, value), relationship: relationshipOptions[0]!, statement: "" }
              : { id: newStatementId(idPrefix, value), statement: "" },
          ])
        }
      >
        Add {legend.toLowerCase().replace(/s$/, "")}
      </button>
      <FieldErrors id={id} messages={errors} />
    </fieldset>
  );
}
