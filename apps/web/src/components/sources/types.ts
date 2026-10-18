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
}
