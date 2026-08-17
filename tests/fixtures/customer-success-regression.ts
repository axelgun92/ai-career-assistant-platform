export const customerSuccessRegressionCategories = [
  "CLEAR_GOOD_FIT",
  "CLEAR_BAD_FIT",
  "AMBIGUOUS",
  "MISLEADING_TITLE",
  "INFLATED_REQUIREMENTS",
  "SCOPE_CREEP",
  "CONFLICTING_JD",
] as const;

export const customerSuccessRegressionCases = [
  { id: "synthetic-good-fit", category: "CLEAR_GOOD_FIT", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { role: "CORE_CS", recommendation: "APPLY" } },
  { id: "synthetic-bad-fit", category: "CLEAR_BAD_FIT", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { role: "UNRELATED", recommendation: "SKIP" } },
  { id: "synthetic-ambiguous", category: "AMBIGUOUS", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { unknowns: true, recommendation: "REVIEW" } },
  { id: "synthetic-misleading-title", category: "MISLEADING_TITLE", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { titleDoesNotControlRole: true } },
  { id: "synthetic-inflated-requirements", category: "INFLATED_REQUIREMENTS", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { contradiction: true } },
  { id: "synthetic-scope-creep", category: "SCOPE_CREEP", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { ownershipConcern: true } },
  { id: "synthetic-conflicting-jd", category: "CONFLICTING_JD", sourceStatus: "SYNTHETIC", sourceUrl: null, reviewedAt: "2026-08-17", expected: { contradiction: true, unresolved: true } },
] as const;
