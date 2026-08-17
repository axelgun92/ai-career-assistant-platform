export * from "./config/preferences";
export * from "./evaluator";
export * from "./extraction/extractor";
export * from "./schemas/maps";
export * from "./schemas/results";

import { createCustomerSuccessEvaluator } from "./evaluator";

export const customerSuccessDomain = {
  id: "customer-success",
  name: "Customer Success",
  createEvaluator: createCustomerSuccessEvaluator,
} as const;
