import type { DiscoveryConfiguration } from "@ai-career/core";

// Customer Success discovery configuration (CS TDD §6). The Core discovery
// engine collects; this module only supplies the terms. A retrieved listing
// is kept when its title contains one of these phrases as a whole phrase
// (case-insensitive); the description is never used to keep a listing.
// Matching a term broadens discovery only: it does not classify a job as
// relevant, and suitability is decided by evaluation alone.

// Core role families. The family names cover every listed title ("Customer
// Success Manager", "Specialist", "Associate", ...) and its seniority
// variants.
export const customerSuccessCoreTitleTerms = [
  "Customer Success",
  "Client Success",
  "Member Success",
] as const;

// Adjacent role families.
export const customerSuccessAdjacentTitleTerms = [
  "Customer Experience",
  "Client Experience",
  "Member Experience",
  "Customer Enablement",
  "Customer Education",
  "Onboarding",
  "Partner Success",
  "Adoption",
  "Customer Journey",
  "Customer Outcomes",
  "User Success",
  "Implementation",
] as const;

export const customerSuccessDiscoveryConfiguration: DiscoveryConfiguration = {
  domain: "customer-success",
  titleTerms: [...customerSuccessCoreTitleTerms, ...customerSuccessAdjacentTitleTerms],
  searchQueries: ["customer success"],
};
