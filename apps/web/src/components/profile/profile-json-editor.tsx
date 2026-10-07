"use client";

export interface JsonParseError {
  message: string;
  line?: number;
  column?: number;
}

export function ProfileJsonEditor({
  text,
  parseError,
  issues,
  disabled,
  onChange,
}: {
  text: string;
  parseError: JsonParseError | null;
  issues: Array<{ path: string; message: string }>;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const hasErrors = Boolean(parseError) || issues.length > 0;
  return (
    <div className="json-editor">
      <label htmlFor="profile-json">Profile JSON</label>
      <p className="field-help">
        The complete stored profile for this version. Fields that are absent use their defaults. Unknown fields
        are rejected, and the label cannot be changed.
      </p>
      <textarea
        id="profile-json"
        className="json-textarea"
        spellCheck={false}
        rows={28}
        value={text}
        disabled={disabled}
        aria-invalid={hasErrors || undefined}
        aria-describedby={hasErrors ? "profile-json-errors" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hasErrors ? (
        <div id="profile-json-errors" className="json-errors">
          {parseError ? (
            <p className="field-error">
              {parseError.line ? `Line ${parseError.line}, column ${parseError.column}: ` : ""}
              {parseError.message}
            </p>
          ) : null}
          {issues.length ? (
            <ul className="issue-list">
              {issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
