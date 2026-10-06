// Domain-neutral display helpers for the opportunity dashboard. They only
// reformat persisted values; they never interpret or recalculate them.

export function formatLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return "Unknown";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatText(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === "" ? "Unknown" : value;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toISOString().slice(0, 10);
}
