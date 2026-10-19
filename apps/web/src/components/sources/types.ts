// Serializable views for the /sources page.

export interface RunCountsView {
  fetched: number;
  keptByTerms: number;
  created: number;
  attached: number;
  unchanged: number;
  changed: number;
  probable: number;
  failed: number;
  listings?: { observed: number; missing: number; removed: number; reappeared: number };
}

export interface RunView {
  id: string;
  trigger: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: RunCountsView | null;
  errorCode: string | null;
  errorMessage: string | null;
  // Feature 13: whether the run read the source's whole listing.
  listingCoverageComplete: boolean | null;
}

export interface AdapterConfigFieldView {
  name: string;
  label: string;
  help: string;
  required: boolean;
}

export interface AdapterView {
  key: string;
  name: string;
  retrievalType: string;
  sourceCategory: string;
  verified: boolean;
  missingEnvironment: string[];
  attribution: string | null;
  configFields: AdapterConfigFieldView[];
}

// A source's health (feature 12), derived on the server from its runs.
export interface SourceHealthView {
  status: string;
  streak: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailure: { at: string; code: string; message: string | null } | null;
  // rate_limited and provider_wait are set by the source and cannot be
  // overridden; backoff is ours and can be, once.
  gate: { kind: "rate_limited" | "provider_wait" | "backoff"; until: string } | null;
  nextRunAt: string | null;
  // Whether nextRunAt had already passed when the page was rendered.
  nextRunDue: boolean;
  stale: boolean;
  neverSucceeded: boolean;
  emptyResult: boolean;
}

export interface SourceView {
  id: string;
  adapterKey: string;
  adapterName: string;
  name: string;
  retrievalType: string;
  sourceCategory: string;
  enabled: boolean;
  config: Record<string, unknown>;
  scheduleMinutes: number;
  lastRunAt: string | null;
  archivedAt: string | null;
  enableBlockedReason: string | null;
  configFields: AdapterConfigFieldView[];
  runs: RunView[];
  health: SourceHealthView;
}
