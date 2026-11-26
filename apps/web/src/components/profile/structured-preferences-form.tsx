"use client";

import {
  CheckboxGroup,
  DefaultTag,
  errorAttributes,
  FieldErrors,
  fieldDomId,
  RadioGroup,
  StatementListEditor,
  StringListEditor,
  type Statement,
} from "./field-inputs";
import { fieldDisplay, type ProfileDraftState } from "./profile-draft";
import { fieldGroups, findField, readPath, type StructuredField } from "./structured-fields";

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asStatements(value: unknown): Statement[] {
  return Array.isArray(value) ? (value as Statement[]) : [];
}

function FieldInput({
  field,
  state,
  errors,
  disabled,
  onChange,
}: {
  field: StructuredField;
  state: ProfileDraftState;
  errors?: string[];
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const id = fieldDomId(field.key);
  const { value, isDefault } = fieldDisplay(state, field.key);
  const set = (next: unknown) => onChange(field.key, next);
  const reference = asStrings(readPath(state.base.document, field.path) ?? state.defaults[field.key]);

  switch (field.kind) {
    case "text":
    case "number":
      return (
        <div className="profile-field">
          <label htmlFor={id}>
            <span>
              {field.label} <DefaultTag show={isDefault} />
            </span>
          </label>
          {field.help ? <p className="field-help">{field.help}</p> : null}
          <input
            id={id}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "numeric" : undefined}
            min={field.kind === "number" ? 0 : undefined}
            value={value === undefined || value === null ? "" : String(value)}
            disabled={disabled}
            {...errorAttributes(id, errors)}
            onChange={(event) => {
              const text = event.target.value;
              if (field.kind === "text") return set(text);
              const number = Number(text);
              // An incomplete number stays as typed so nothing is lost; it
              // is reported as an error on save.
              set(text.trim() !== "" && Number.isFinite(number) ? number : text);
            }}
          />
          <FieldErrors id={id} messages={errors} />
        </div>
      );
    case "boolean":
      return (
        <div className="profile-field">
          <label className="checkbox-label" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              disabled={disabled}
              {...errorAttributes(id, errors)}
              onChange={(event) => set(event.target.checked)}
            />
            <span>
              {field.label} <DefaultTag show={isDefault} />
            </span>
          </label>
          <FieldErrors id={id} messages={errors} />
        </div>
      );
    case "enumSingle":
      return (
        <RadioGroup
          id={id}
          legend={field.label}
          options={field.options ?? []}
          value={typeof value === "string" ? value : ""}
          isDefault={isDefault}
          errors={errors}
          disabled={disabled}
          onChange={set}
        />
      );
    case "enumMulti":
      return (
        <CheckboxGroup
          id={id}
          legend={field.label}
          help={field.help}
          options={field.options ?? []}
          value={asStrings(value)}
          reference={reference}
          isDefault={isDefault}
          errors={errors}
          disabled={disabled}
          onChange={set}
        />
      );
    case "stringList":
      return (
        <StringListEditor
          id={id}
          legend={field.label}
          help={field.help}
          value={asStrings(value)}
          isDefault={isDefault}
          errors={errors}
          disabled={disabled}
          onChange={set}
        />
      );
    case "statements":
    case "experience":
      return (
        <StatementListEditor
          id={id}
          legend={field.label}
          idPrefix={field.idPrefix ?? "item"}
          relationshipOptions={field.kind === "experience" ? field.options : undefined}
          value={asStatements(value)}
          errors={errors}
          disabled={disabled}
          onChange={set}
        />
      );
  }
}

export function StructuredPreferencesForm({
  state,
  fieldErrors,
  disabled,
  onChange,
}: {
  state: ProfileDraftState;
  fieldErrors: Record<string, string[]>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="structured-form">
      {fieldGroups.map((group) => (
        <section key={group.id} className="profile-group" aria-labelledby={`group-${group.id}`}>
          <h3 id={`group-${group.id}`}>{group.title}</h3>
          <p className="field-help">{group.description}</p>
          {group.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={findField(field.key)!}
              state={state}
              errors={fieldErrors[field.key]}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
          {group.id === "hard-filters" ? (
            <p className="field-help">
              Recurring customer onsite travel and field travel always fail the travel filter; they are not
              configurable.
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
