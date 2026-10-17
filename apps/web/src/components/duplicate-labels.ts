// Readable descriptions of the deduplication engine's evidence.
const matchedOnLabels: Record<string, string> = {
  url: "same listing URL",
  listingId: "same source job ID",
  requisitionId: "same requisition ID",
  company: "same company",
  title: "similar title",
  location: "similar location",
  description: "similar description",
};

const conflictLabels: Record<string, string> = {
  title: "the titles differ",
  company: "the companies differ",
  listingId: "the source job IDs differ",
  salary: "the salary ranges do not overlap",
  "company-unknown": "the company is not known for both",
};

function list(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function describeMatchedOn(matchedOn: string[]): string {
  const labels = matchedOn.map((value) => matchedOnLabels[value] ?? value);
  return list(labels);
}

export function describeConflicts(conflicts: string[]): string | null {
  return conflicts.length ? list(conflicts.map((value) => conflictLabels[value] ?? value)) : null;
}

export function confidencePercent(confidence: number | null): string | null {
  return confidence === null ? null : `${Math.round(confidence * 100)}%`;
}
