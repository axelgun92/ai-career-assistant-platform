// Display labels for retrieval vocabulary (shared by /sources and the
// opportunity provenance view).

export const retrievalTypeLabels: Record<string, string> = {
  OFFICIAL_PUBLIC_API_FEED: "official API or feed",
  BROWSER_ASSISTED: "browser-assisted",
  PUBLIC_GUEST_INTERNAL_ENDPOINT: "public guest endpoint",
  PUBLIC_HTML: "public page",
};

export const sourceCategoryLabels: Record<string, string> = {
  ATS: "employer ATS",
  COMPANY_CAREERS: "company careers site",
  JOB_BOARD: "job board",
  MARKETPLACE: "marketplace",
  AGGREGATOR: "aggregator",
};

export const runStatusLabels: Record<string, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  PARTIAL: "Partly completed",
  FAILED: "Failed",
};

export function retrievalSummary(category: string | null | undefined, type: string | null | undefined): string {
  return [category ? sourceCategoryLabels[category] ?? category : null, type ? retrievalTypeLabels[type] ?? type : null]
    .filter(Boolean)
    .join(" · ");
}

export function scheduleLabel(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "every day" : `every ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }
  return `every ${minutes} minutes`;
}
