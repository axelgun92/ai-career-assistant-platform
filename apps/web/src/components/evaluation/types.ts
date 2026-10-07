export type EvaluationTaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface OpportunityPresentation {
  id: string;
  title: string;
  company: string;
  salary: string;
  location: string;
  workArrangement: string;
  timeZoneRequirements: string;
}

export interface EvidencePresentation {
  id: string;
  referenceId: string;
  stageId: string;
  criterionId: string | null;
  claim: string;
  sourceType: string;
  sourceField: string | null;
  sourceReference: string | null;
  sourceText: string | null;
  evidenceType: string;
  origin: "EXPLICIT" | "DERIVED" | "INFERRED";
  evidenceLevel: string;
}

export interface ContradictionPresentation {
  id: string;
  stageId: string;
  claimA: string;
  claimB: string;
  interpretation: string;
  significance: string | null;
  evidenceIdsA: string[];
  evidenceIdsB: string[];
  resolutionStatus: "UNRESOLVED" | "RESOLVED";
  resolutionNote: string | null;
}

export interface EvaluationHistoryPresentation {
  evaluationId: string;
  isLatest: boolean;
  status: EvaluationTaskStatus;
  evaluationStatus: EvaluationTaskStatus;
  decision: string | null;
  evaluationVersion: string;
  promptVersion: string | null;
  userProfileVersion: number | null;
  createdAt: string;
  completedAt: string | null;
}

// Persisted semantic-operation attempt as returned by the evaluation API.
// errorMessage and providerRequestId are intentionally not part of the
// presentation contract and are never rendered.
export interface SemanticOperationPresentation {
  id: string;
  operationId: string;
  attempt: number;
  provider: string;
  model: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  pricingConfigurationVersion: string | null;
  pricingCurrency: string | null;
  durationMs: number | null;
  errorCode: string | null;
}

// Output of the existing summarizeSemanticUsage(); null means Unknown.
export interface SemanticUsagePresentation {
  attemptCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  currency: string | null;
  pricingConfigurationVersions: string[];
}

export interface EvaluationPresentation {
  opportunityId: string;
  evaluationId: string;
  isLatest: boolean;
  domain: string;
  status: EvaluationTaskStatus;
  evaluationStatus: EvaluationTaskStatus;
  task: {
    id: string;
    status: EvaluationTaskStatus;
    attempt: number;
    maxAttempts: number;
    errorCode: string | null;
    errorMessage: string | null;
  };
  versions: {
    evaluation: string;
    domain: string;
    rules: string;
    prompt: string | null;
    userProfile: number | null;
  };
  startedAt: string | null;
  completedAt: string | null;
  stages: Array<{
    stageId: string;
    status: EvaluationTaskStatus;
    failureCode: string | null;
    errorMessage: string | null;
  }>;
  evidence: EvidencePresentation[];
  contradictions: ContradictionPresentation[];
  result: unknown;
  recommendation: {
    decision: string;
    explanation: string;
    strongestPositives: unknown;
    strongestConcerns: unknown;
    reviewConditions: unknown;
    unknowns: unknown;
    contradictions: unknown;
    evidenceReferences: string[];
  } | null;
  error: string | null;
  operations?: SemanticOperationPresentation[];
  usage?: SemanticUsagePresentation;
  // Budget held before the run, when a budget was configured.
  reservation?: { amount: number; currency: string } | null;
  history: EvaluationHistoryPresentation[];
}
