// Display-only formatting for persisted AI usage. Values are shown exactly as
// recorded and summarized; anything not reported stays "Unknown", never 0.

export function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unknown" : value.toLocaleString("en-US");
}

export function formatCost(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || !currency) return "Unknown";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export function formatPricingVersions(versions: readonly string[] | null | undefined): string {
  return versions && versions.length > 0 ? versions.join(", ") : "Unknown";
}
