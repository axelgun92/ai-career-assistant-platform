"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "./budget-format";
import type { BudgetStatusView } from "./types";

type FieldName = "amount" | "currency" | "timeZone" | "reservePerEvaluation" | "enforced";

const fieldIds: Record<FieldName, string> = {
  amount: "budget-amount",
  currency: "budget-currency",
  timeZone: "budget-time-zone",
  reservePerEvaluation: "budget-reserve",
  enforced: "budget-enforced",
};

function errorProps(name: FieldName, errors: Partial<Record<FieldName, string>>) {
  return errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${fieldIds[name]}-error` } : {};
}

function FieldError({ name, errors }: { name: FieldName; errors: Partial<Record<FieldName, string>> }) {
  return errors[name] ? (
    <p className="field-error" id={`${fieldIds[name]}-error`}>
      {errors[name]}
    </p>
  ) : null;
}

const timeZones = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

// Suggested reserve: the most a recent evaluation cost, rounded up to a cent.
export function suggestedReserve(max: number): number {
  return Math.max(0.01, Math.ceil(max * 100) / 100);
}

export function BudgetSettingsForm({
  status,
  defaultCurrency,
}: {
  status: BudgetStatusView;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const current = status.configured ? status.settings : null;
  const [amount, setAmount] = useState(current ? String(current.amount) : "");
  const [currency, setCurrency] = useState(current?.currency ?? defaultCurrency);
  const [timeZone, setTimeZone] = useState(current?.timeZone ?? "UTC");
  const [reserve, setReserve] = useState(current ? String(current.reservePerEvaluation) : "");
  const [enforced, setEnforced] = useState(current?.enforced ?? true);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const recent = status.configured ? status.recentCosts : null;

  async function send(method: "PUT" | "DELETE") {
    setPending(true);
    setErrors({});
    setFormError(null);
    setSaved(null);
    try {
      const response = await fetch("/api/budget", {
        method,
        headers: { "Content-Type": "application/json" },
        body:
          method === "PUT"
            ? JSON.stringify({
                amount: amount.trim() === "" ? null : Number(amount),
                currency: currency.trim().toUpperCase(),
                timeZone: timeZone.trim(),
                reservePerEvaluation: reserve.trim() === "" ? (enforced ? null : 0) : Number(reserve),
                enforced,
              })
            : undefined,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        issues?: Array<{ path: string; message: string }>;
      };
      if (!response.ok) {
        const fieldErrors: Partial<Record<FieldName, string>> = {};
        const unmatched: string[] = [];
        for (const issue of body.issues ?? []) {
          if (issue.path in fieldIds) fieldErrors[issue.path as FieldName] ??= issue.message;
          else unmatched.push(issue.message);
        }
        setErrors(fieldErrors);
        setFormError(unmatched.length ? unmatched.join(" ") : body.error ?? "The budget could not be saved.");
        return;
      }
      setConfirmRemove(false);
      setSaved(method === "PUT" ? "Budget saved." : "Budget removed. Evaluations are no longer limited.");
      if (method === "DELETE") {
        setAmount("");
        setReserve("");
      }
      router.refresh();
    } catch {
      setFormError("The application could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="budget-form"
      aria-labelledby="budget-settings-title"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send("PUT");
      }}
    >
      <h2 id="budget-settings-title">Budget settings</h2>
      <p className="field-help">
        A monthly limit on AI evaluation cost. Spend is the recorded cost of AI calls; the budget starts over on the
        1st of each month in the time zone you choose.
      </p>
      <div className="form-grid">
        <label htmlFor={fieldIds.amount}>
          Monthly budget
          <input
            id={fieldIds.amount}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            {...errorProps("amount", errors)}
          />
          <FieldError name="amount" errors={errors} />
        </label>
        <label htmlFor={fieldIds.currency}>
          Currency
          <input
            id={fieldIds.currency}
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value)}
            {...errorProps("currency", errors)}
          />
          <FieldError name="currency" errors={errors} />
        </label>
        <label htmlFor={fieldIds.timeZone}>
          Time zone
          <input
            id={fieldIds.timeZone}
            list="budget-time-zones"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            {...errorProps("timeZone", errors)}
          />
          <datalist id="budget-time-zones">
            {timeZones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <FieldError name="timeZone" errors={errors} />
        </label>
        <label htmlFor={fieldIds.reservePerEvaluation}>
          Reserve per evaluation
          <input
            id={fieldIds.reservePerEvaluation}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={reserve}
            onChange={(event) => setReserve(event.target.value)}
            {...errorProps("reservePerEvaluation", errors)}
          />
          <FieldError name="reservePerEvaluation" errors={errors} />
        </label>
      </div>
      <p className="field-help">
        Before an evaluation starts, this amount is held from the remaining budget until its actual cost is
        recorded. It is an estimate: an evaluation can cost more than its reserve, and the actual cost is always
        what counts.
      </p>
      {recent ? (
        <p className="field-help">
          Your last {recent.count === 1 ? "evaluation" : `${recent.count} evaluations`} with a fully recorded cost
          cost up to {formatMoney(recent.max, currency)} (average {formatMoney(recent.average, currency)}).{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setReserve(String(suggestedReserve(recent.max)))}
          >
            Use {formatMoney(suggestedReserve(recent.max), currency)}
          </button>
        </p>
      ) : null}
      <label className="checkbox-label" htmlFor={fieldIds.enforced}>
        <input
          id={fieldIds.enforced}
          type="checkbox"
          checked={enforced}
          onChange={(event) => setEnforced(event.target.checked)}
        />
        Enforce the budget (defer evaluations that would not fit)
      </label>
      {!enforced ? (
        <p className="field-help">
          While not enforced, every evaluation starts and spend is still tracked against the budget.
        </p>
      ) : null}
      {formError ? (
        <p className="error-message" role="alert">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p className="success-message" role="status">
          {saved}
        </p>
      ) : null}
      <div className="evaluation-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : status.configured ? "Save budget" : "Set budget"}
        </button>
        {status.configured ? (
          confirmRemove ? (
            <span className="confirm-inline" role="group" aria-label="Confirm removing the budget">
              <span>Evaluations will no longer be limited.</span>
              <button type="button" className="secondary-button danger-button" disabled={pending} onClick={() => void send("DELETE")}>
                Remove budget
              </button>
              <button type="button" className="secondary-button" onClick={() => setConfirmRemove(false)}>
                Keep budget
              </button>
            </span>
          ) : (
            <button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirmRemove(true)}>
              Remove budget…
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
