// Display helpers for the budget. Money is shown with the existing usage
// formatter, so an unknown amount is always "Unknown", never $0.

export { formatCost as formatMoney } from "../usage/usage-format";

// "2026-10" → "October 2026".
export function formatPeriodLabel(label: string): string {
  const [year, month] = label.split("-").map(Number);
  if (!year || !month) return label;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

// The local date (in the budget's time zone) on which the next period starts.
export function formatResetDate(endIso: string, timeZone: string): string {
  try {
    const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(
      new Date(endIso),
    );
    return `${date} (${timeZone})`;
  } catch {
    return endIso.slice(0, 10);
  }
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;
