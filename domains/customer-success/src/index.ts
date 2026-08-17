export * from "./config/preferences";
export * from "./evaluator";
export * from "./extraction/extractor";
export * from "./schemas/maps";
export * from "./schemas/results";
export * from "./schemas/company-alignment";
export * from "./schemas/organizational-maturity";
export * from "./schemas/alex-fit";
export * from "./schemas/burnout-risk";
export * from "./profile/user-profile";
export { burnoutRiskBand } from "./evaluation/burnout-risk";

import { createCustomerSuccessEvaluator } from "./evaluator";

export const customerSuccessDomain = {
  id: "customer-success",
  name: "Customer Success",
  createEvaluator: createCustomerSuccessEvaluator,
} as const;
