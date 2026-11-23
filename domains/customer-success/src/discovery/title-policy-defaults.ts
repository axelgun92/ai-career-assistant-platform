import type { TitlePolicyPatterns } from "@ai-career/core";

// Default target job titles for automatic acquisition (November 22, 2026).
// They are Alex's established Customer Success career targets, written as
// precise title phrases rather than broad single words ("Onboarding
// Specialist", not "Onboarding"). The saved Target Job Titles setting on the
// Profile page replaces them entirely once saved; these apply only while
// nothing is saved.
//
// Education, learning, training and enablement titles need an explicit
// Customer or Client qualifier ("Customer Education Specialist", not
// "Education Specialist"). Other families need no qualifier.
//
// Matching a pattern only means the job is inside the target scope for
// retrieval; its actual suitability is decided by the job-description
// analysis, the hard filters, the triage and the evaluator.
export const customerSuccessAcceptedTitlePatterns = [
  // Customer Success and its core variants.
  "Customer Success",
  "Client Success",
  "Member Success",
  "User Success",
  "Partner Success",
  "CSM",
  // Customer, client and member experience.
  "Customer Experience",
  "Client Experience",
  "Member Experience",
  // Onboarding (Onboarding Specialist is a high-priority target).
  "Onboarding Specialist",
  "Onboarding Manager",
  "Onboarding Coordinator",
  "Onboarding Consultant",
  "Onboarding Lead",
  "Customer Onboarding",
  "Client Onboarding",
  // Customer education (Customer Education Specialist is a high-priority
  // target) and customer-facing learning and training.
  "Customer Education Specialist",
  "Customer Education",
  "Client Education",
  "Customer Learning",
  "Client Learning",
  "Customer Training",
  "Client Training",
  // Customer enablement.
  "Customer Enablement",
  "Client Enablement",
  // Customer-facing implementation.
  "Implementation Specialist",
  "Implementation Manager",
  "Implementation Consultant",
  "Implementation Lead",
  "Implementation Coordinator",
  "Implementation Project Manager",
  "Customer Implementation",
  "Client Implementation",
  // Adoption.
  "Product Adoption",
  "Customer Adoption",
  "Digital Adoption",
  "Adoption Specialist",
  "Adoption Manager",
  // Customer engagement, learner, student and community success.
  "Customer Engagement",
  "Client Engagement",
  "Learner Success",
  "Student Success",
  "Community Success",
  "Customer Journey",
  "Customer Outcomes",
] as const;

// Only titles that are clearly unrelated careers although an accepted
// pattern appears in them. An exclusion wins only when it is at least as
// specific (as many words) as the accepted pattern it competes with.
export const customerSuccessExcludedTitlePatterns = [
  "Customer Experience Designer",
  "Customer Experience Design",
  "Customer Experience Researcher",
  "Employee Onboarding",
  "HR Onboarding",
  "People Onboarding",
  "New Hire Onboarding",
] as const;

export const customerSuccessDefaultTitlePolicy: TitlePolicyPatterns = {
  accepted: customerSuccessAcceptedTitlePatterns,
  excluded: customerSuccessExcludedTitlePatterns,
};
